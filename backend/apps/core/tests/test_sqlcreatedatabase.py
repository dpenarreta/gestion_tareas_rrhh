"""Cobertura de `python manage.py sqlcreatedatabase` (ver
`backend/scripts/sql/README.md` y docs/AUDIT_LOG.md § 2026-09-08).

El script que genera este comando no se versiona (contiene el hash de la
contraseña del administrador), así que no hay un archivo con el que
compararlo: lo que se verifica es que el script generado tenga todo lo que
tiene que tener, y que no filtre la contraseña en claro.

Los tests usan `--catalog-source current` porque la base de pytest se crea
con `migrate` y por lo tanto su catálogo ya es el canónico — el modo `temp`
por defecto crearía una base extra por test.
"""

import codecs
import re

import pytest
from django.apps import apps as django_apps
from django.core.management import call_command

PASSWORD = "Contrasena-De-Prueba-2026"
EMAIL = "admin@prueba.test"


@pytest.fixture
def script_path(tmp_path):
    destination = tmp_path / "nexo_create_database.sql"
    call_command(
        "sqlcreatedatabase",
        admin_email=EMAIL,
        admin_password=PASSWORD,
        database="nexo_prueba",
        catalog_source="current",
        output=str(destination),
    )
    return destination


@pytest.fixture
def script(script_path):
    # utf-8-sig: el archivo se escribe con BOM a propósito (ver el test de
    # abajo), y sin esto el BOM quedaría pegado al primer carácter.
    return script_path.read_text(encoding="utf-8-sig")


@pytest.mark.django_db
def test_creates_the_database_with_the_requested_name_and_collation(script):
    assert "CREATE DATABASE [nexo_prueba] COLLATE SQL_Latin1_General_CP1_CI_AS;" in script
    # Sin esto, sqlcmd (que conecta con QUOTED_IDENTIFIER en OFF) falla al
    # crear los índices filtrados del esquema con el error 1934.
    assert "SET QUOTED_IDENTIFIER ON;" in script
    assert "SET ANSI_NULLS ON;" in script


@pytest.mark.django_db
def test_creates_a_table_for_every_model(script):
    missing = [
        model._meta.db_table
        for model in django_apps.get_models(include_auto_created=True)
        if model._meta.managed
        and not model._meta.proxy
        and f"CREATE TABLE [{model._meta.db_table}]" not in script
    ]
    assert not missing, f"Tablas sin CREATE TABLE en el script: {missing}"


@pytest.mark.django_db
def test_includes_the_migration_log_and_the_role_catalog(script):
    # Sin la bitácora, un `migrate` posterior intentaría recrear las tablas.
    assert "INSERT INTO [django_migrations]" in script
    assert "('users', '0001_initial'" in script.replace("N'", "'")
    # Sin el catálogo no existen los grupos de rol y no se puede entrar.
    assert "INSERT INTO [auth_group]" in script
    assert "INSERT INTO [auth_permission]" in script
    for role in ("ADMINISTRADOR", "JEFE_NACIONAL", "COORDINADOR_NACIONAL"):
        assert f"N'{role}'" in script
    # El catálogo se inserta con los ids reales, que las filas se referencian
    # entre sí (un permiso apunta a su content type).
    assert "SET IDENTITY_INSERT [auth_permission] ON;" in script


@pytest.mark.django_db
def test_creates_the_administrator_user_hashed_and_in_its_group(script):
    assert "INSERT INTO [users_user]" in script
    assert f"N'{EMAIL}'" in script
    assert "argon2$argon2id$" in script, "la contraseña tiene que ir hasheada con Argon2"
    assert "INSERT INTO [users_user_groups]" in script
    assert "N'ADMINISTRADOR'" in script


@pytest.mark.django_db
def test_never_writes_the_plain_password(script):
    assert PASSWORD not in script


@pytest.mark.django_db
def test_json_columns_are_serialized_as_json_not_python_repr(script):
    # `view_preferences` es un JSONField con default ["KANBAN", "TABLA"]: el
    # repr de Python usa comillas simples, no pasa el CHECK de ISJSON de la
    # columna y el INSERT del usuario fallaba con el error 547.
    assert 'N\'["KANBAN", "TABLA"]\'' in script
    assert "N'['" not in script.replace("N'[\"", "")


@pytest.mark.django_db
def test_verifies_itself_at_the_end(script):
    # El script comprueba su propio resultado en vez de dar por buena una
    # instalación a medias.
    expected_tables = len(re.findall(r"^CREATE TABLE ", script, flags=re.MULTILINE))
    assert f"IF @tables <> {expected_tables}" in script
    # Los guards usan RAISERROR + SET NOEXEC ON, no THROW: THROW aborta con
    # `sqlcmd -b` pero SSMS sigue ejecutando los batches siguientes.
    assert "THROW" not in script
    assert script.count("RAISERROR(") >= 5
    assert script.count("SET NOEXEC ON;") >= 5
    # Y al final se restaura, para no dejar la sesión muda si un guard cortó.
    assert "SET NOEXEC OFF;" in script


@pytest.mark.django_db
def test_is_written_with_a_bom_so_sqlcmd_detects_the_encoding(script_path):
    # Sin BOM, sqlcmd lee el archivo con la codepage ANSI del sistema y los
    # nombres de permisos con acentos entran con mojibake ("catÃ¡logo"),
    # terminando con exit 0 y sin ningún error visible.
    assert script_path.read_bytes().startswith(codecs.BOM_UTF8)


@pytest.mark.django_db
def test_accented_catalog_names_are_written_as_real_accents(script):
    # 12 de los 246 permisos llevan acentos; si el generador los escribiera
    # ya corruptos, el mojibake llegaría a la base pase lo que pase.
    assert "catálogo" in script
    assert "configuración" in script
    assert "Ã" not in script and "Â" not in script


@pytest.mark.django_db
def test_sets_the_ansi_options_on_the_new_database(script):
    # Una base nueva HEREDA estas opciones de [model], donde suelen estar en
    # OFF (es el caso de la base de desarrollo de este proyecto), así que el
    # CREATE DATABASE solo no alcanza: hay que fijarlas.
    for option in (
        "ANSI_NULL_DEFAULT",
        "ANSI_NULLS",
        "ANSI_PADDING",
        "ANSI_WARNINGS",
        "CONCAT_NULL_YIELDS_NULL",
        "QUOTED_IDENTIFIER",
    ):
        assert f"ALTER DATABASE [nexo_prueba] SET {option} ON;" in script
    assert "ALTER DATABASE [nexo_prueba] SET RECOVERY FULL;" in script
