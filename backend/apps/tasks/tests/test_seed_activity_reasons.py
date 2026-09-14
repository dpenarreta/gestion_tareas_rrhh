"""Cobertura de `manage.py seed_activity_reasons`.

El comando existe porque el catálogo de motivos no tenía carga inicial y
toda instalación nueva arrancaba con el selector vacío (ver
docs/AUDIT_LOG.md § 2026-09-14). Lo que se protege acá es lo que haría daño
si se rompiera: que el catálogo referencie un rol inexistente —un motivo
así no se le mostraría nunca a nadie, sin ningún error— y que volver a
correr el comando no duplique ni pise lo que Ajustes haya editado.
"""

from io import StringIO

import pytest
from django.core.management import call_command

from apps.hierarchy.services import ALL_ROLES
from apps.tasks.management.commands.seed_activity_reasons import CATALOGO, TODOS
from apps.tasks.models import ActivityReason


def _correr(*args) -> str:
    salida = StringIO()
    call_command("seed_activity_reasons", *args, stdout=salida)
    return salida.getvalue()


# --- El catálogo en sí (sin base de datos) ---


def test_todos_los_roles_del_catalogo_existen():
    # Un rol mal escrito no rompe nada visible: el motivo simplemente no le
    # aparece a nadie, que es justo el síntoma que este comando vino a
    # resolver.
    validos = set(ALL_ROLES)
    for label, roles in CATALOGO:
        assert set(roles) <= validos, f"{label} referencia roles inexistentes"


def test_todos_incluye_exactamente_los_roles_del_sistema():
    assert set(TODOS) == set(ALL_ROLES)


def test_no_hay_etiquetas_repetidas():
    etiquetas = [label for label, _ in CATALOGO]
    assert len(etiquetas) == len(set(etiquetas))


def test_ningun_motivo_queda_sin_roles():
    # `assigned_roles` vacío pasa la validación del modelo pero deja el
    # motivo invisible para todo el mundo.
    for label, roles in CATALOGO:
        assert roles, f"{label} no tiene ningún rol asignado"


# --- El comando contra la base ---


@pytest.mark.django_db
def test_crea_todo_el_catalogo_en_una_base_vacia():
    _correr()
    assert ActivityReason.objects.count() == len(CATALOGO)


@pytest.mark.django_db
def test_correrlo_dos_veces_no_duplica():
    _correr()
    salida = _correr()
    assert ActivityReason.objects.count() == len(CATALOGO)
    assert "ya existen" in salida


@pytest.mark.django_db
def test_no_pisa_los_roles_editados_desde_ajustes():
    # El catálogo se administra desde Ajustes: un re-seed no puede deshacer
    # una edición hecha ahí.
    _correr()
    motivo = ActivityReason.objects.get(label="Visita Domiciliaria")
    motivo.assigned_roles = ["ADMINISTRADOR"]
    motivo.is_active = False
    motivo.save()

    _correr()

    motivo.refresh_from_db()
    assert motivo.assigned_roles == ["ADMINISTRADOR"]
    assert motivo.is_active is False


@pytest.mark.django_db
def test_dry_run_no_escribe_nada():
    salida = _correr("--dry-run")
    assert ActivityReason.objects.count() == 0
    assert "no se creó nada" in salida


@pytest.mark.django_db
def test_las_claves_generadas_son_unicas():
    _correr()
    claves = list(ActivityReason.objects.values_list("key", flat=True))
    assert len(claves) == len(set(claves))
    assert all(clave for clave in claves)
