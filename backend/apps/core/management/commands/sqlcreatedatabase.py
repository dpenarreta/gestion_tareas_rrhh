"""Genera UN único script SQL que deja la base de datos lista para entrar
(ver `backend/scripts/sql/README.md` y docs/DEPLOYMENT_IIS.md).

El archivo generado hace, en un solo `sqlcmd`:

1. `CREATE DATABASE` con la collation del proyecto.
2. Las tablas del sistema con todos sus campos, índices, `CHECK` y claves
   foráneas — el estado actual de los modelos.
3. `django_migrations` completa, para que Django no intente re-aplicar nada.
4. El catálogo que normalmente siembran las migraciones de datos: content
   types, permisos, grupos de rol y la jerarquía de visibilidad.
5. El usuario ADMINISTRADOR inicial, con su contraseña ya hasheada.

**Estado final, no historial:** el DDL sale de
`schema_editor.create_model()` sobre el estado final del grafo de
migraciones, no de concatenar las migraciones una por una (eso crearía
columnas para borrarlas después, como `legacy_postgres_id`). Es lo que
hacía el `manage.py sqlall` que Django retiró en 1.9.

**De dónde sale el catálogo:** por defecto (`--catalog-source temp`) el
comando crea una base temporal, le corre `migrate`, lee el catálogo ya
sembrado y la borra. Es la única fuente canónica: la base de desarrollo
divergió del seed hace tiempo (ver docs/AUDIT_LOG.md § 2026-09-08), así que
volcarla produciría un catálogo con permisos de menos. `--catalog-source
current` lee la base configurada — sirve para los tests, donde la base de
pytest se crea con `migrate` y por lo tanto sí es canónica.

**El script generado contiene el hash Argon2 de la contraseña del
administrador**, así que es de un solo uso: no se commitea (está en
`.gitignore`) ni se comparte. La contraseña en claro no aparece en ningún
momento en el archivo.

Uso:
    python manage.py sqlcreatedatabase --admin-email admin@empresa.com
    python manage.py sqlcreatedatabase --admin-email admin@empresa.com \
        --database nexo_prod --output C:\\temp\\nexo_prod.sql

La contraseña se toma de `--admin-password`, de la variable de entorno
`SUPERADMIN_PASSWORD` o, si no hay ninguna, se pide de forma interactiva y
oculta — nunca queda un valor por defecto adivinable.
"""

import datetime
import decimal
import json
import os
import subprocess
import sys
import uuid
from getpass import getpass

from django.contrib.auth.hashers import make_password
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.management.base import BaseCommand, CommandError
from django.db import connection
from django.db.migrations.loader import MigrationLoader
from django.db.migrations.recorder import MigrationRecorder
from django.db.utils import ConnectionHandler

SEPARATOR = "-- " + "=" * 74
# Nombre de la base de PRODUCCIÓN (decisión del usuario, 2026-09-08) — no el
# de desarrollo, que es `gestion_tareas` y vive en `backend/.env`. Este
# comando genera el script de despliegue, así que su default es el productivo.
DEFAULT_DATABASE = "ia_gestion_tareas"
COLLATION = "SQL_Latin1_General_CP1_CI_AS"
ADMINISTRADOR_GROUP_NAME = "ADMINISTRADOR"
ROWS_PER_INSERT = 100


class Command(BaseCommand):
    help = "Genera un único script SQL que crea la base entera, lista para entrar."

    def add_arguments(self, parser):
        parser.add_argument(
            "--output",
            default=os.path.join("scripts", "sql", "nexo_create_database.sql"),
            help="Archivo destino (por defecto scripts/sql/nexo_create_database.sql).",
        )
        parser.add_argument(
            "--database",
            default=DEFAULT_DATABASE,
            help=f"Nombre de la base a crear (por defecto {DEFAULT_DATABASE}).",
        )
        parser.add_argument(
            "--admin-email", required=True, help="Correo del administrador inicial."
        )
        parser.add_argument(
            "--admin-username",
            default="admin",
            help="Username del administrador (por defecto 'admin').",
        )
        parser.add_argument(
            "--admin-password",
            default=None,
            help="Si se omite, se toma de SUPERADMIN_PASSWORD o se pide interactivamente.",
        )
        parser.add_argument(
            "--skip-create-database",
            action="store_true",
            help=(
                "No incluir el CREATE DATABASE: la base ya existe (la creó el DBA) y el "
                "script solo crea el esquema, el catálogo y el usuario dentro de ella."
            ),
        )
        parser.add_argument(
            "--no-force-password-change",
            action="store_true",
            help=(
                "No exigir el cambio de contraseña en el primer login. Usalo cuando la "
                "contraseña la eligió el propio titular de la cuenta, no quien despliega."
            ),
        )
        parser.add_argument(
            "--catalog-source",
            choices=("temp", "current"),
            default="temp",
            help="'temp': base temporal migrada al vuelo (canónica). 'current': la base configurada.",
        )
        parser.add_argument(
            "--catalog-db",
            default="nexo_catalog_tmp",
            help="Nombre de la base temporal para el catálogo.",
        )

    def handle(self, *args, **options):
        password = self._resolve_password(options["admin_password"])
        loader = MigrationLoader(None, ignore_no_migrations=True)

        if options["catalog_source"] == "temp":
            catalog = self._catalog_from_temporary_database(options["catalog_db"])
        else:
            catalog = self._read_catalog(connection)
            # `current` vuelca TODA fila que encuentre. Sobre una base recién
            # migrada eso es exactamente el catálogo, pero sobre una base en
            # uso arrastraría datos de negocio al script, así que se listan
            # las tablas para que el desfase se vea.
            self.stderr.write(
                self.style.WARNING(
                    "--catalog-source current: se vuelca todo lo que tenga filas en "
                    f"'{connection.settings_dict['NAME']}'. Revisá que sean solo tablas de "
                    "catálogo: " + ", ".join(f"{e['table']} ({len(e['rows'])})" for e in catalog)
                )
            )

        text = self._build_script(
            database=options["database"],
            loader=loader,
            catalog=catalog,
            admin_email=options["admin_email"].strip(),
            admin_username=options["admin_username"].strip(),
            password=password,
            force_password_change=not options["no_force_password_change"],
            create_database=not options["skip_create_database"],
        )

        output = options["output"]
        directory = os.path.dirname(output)
        if directory:
            os.makedirs(directory, exist_ok=True)
        # utf-8-sig, no utf-8: el BOM es lo que hace que sqlcmd y SSMS
        # detecten la codificación del archivo. Sin él, sqlcmd lo lee con la
        # codepage ANSI del sistema y los 12 nombres de permisos con acentos
        # entran con mojibake ("catÃ¡logo") — terminando con exit 0, sin
        # ningún error, y esos textos son los que muestra Roles y Permisos.
        # Verificado empíricamente en las dos variantes (ver README.md).
        with open(output, "w", encoding="utf-8-sig", newline="\r\n") as handle:
            handle.write(text)

        self.stdout.write(self.style.SUCCESS(f"Script escrito en {output}"))
        self.stdout.write(
            "Contiene el hash de la contraseña del administrador: no lo commitees ni lo compartas."
        )
        self.stdout.write(
            f"Ejecutalo con:  sqlcmd -S <servidor> -d master -b -i {os.path.basename(output)}"
        )

    # ------------------------------------------------------------------
    # Contraseña del administrador
    # ------------------------------------------------------------------

    def _resolve_password(self, given):
        password = given or os.environ.get("SUPERADMIN_PASSWORD")
        if not password:
            password = getpass("Contraseña para el administrador inicial: ")
            if password != getpass("Repetí la contraseña: "):
                raise CommandError("Las contraseñas no coinciden.")
        try:
            validate_password(password)
        except DjangoValidationError as exc:
            raise CommandError("Contraseña inválida: " + "; ".join(exc.messages)) from exc
        return password

    # ------------------------------------------------------------------
    # Catálogo
    # ------------------------------------------------------------------

    def _catalog_from_temporary_database(self, name):
        """Crea una base temporal, le corre `migrate` y lee el catálogo.

        Es la fuente canónica del catálogo: refleja exactamente lo que
        sembrarían las migraciones de datos en una base nueva. La base de
        desarrollo no sirve — divergió del seed (el grupo `Superusuario`
        tiene 14 permisos donde una base nueva tiene 26).
        """
        with connection.cursor() as cursor:
            cursor.execute("SELECT DB_ID(%s)", [name])
            if cursor.fetchone()[0] is not None:
                raise CommandError(
                    f"La base temporal '{name}' ya existe. Borrala o pasá otro --catalog-db."
                )
            self.stdout.write(f"Creando base temporal '{name}' para leer el catálogo...")
            cursor.execute(f"CREATE DATABASE [{name}] COLLATE {COLLATION}")

        handler = None
        try:
            result = subprocess.run(
                [sys.executable, "manage.py", "migrate", "--noinput"],
                capture_output=True,
                text=True,
                env={**os.environ, "DB_NAME": name},
            )
            if result.returncode != 0:
                raise CommandError(
                    "El `migrate` sobre la base temporal falló:\n" + result.stdout + result.stderr
                )
            handler = ConnectionHandler({"default": {**connection.settings_dict, "NAME": name}})
            return self._read_catalog(handler["default"])
        finally:
            if handler is not None:
                handler.close_all()
            with connection.cursor() as cursor:
                cursor.execute(f"ALTER DATABASE [{name}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE")
                cursor.execute(f"DROP DATABASE [{name}]")
            self.stdout.write(f"Base temporal '{name}' eliminada.")

    def _read_catalog(self, target_connection):
        """Lee todas las tablas con filas, ordenadas por dependencias.

        No hay una lista fija de tablas de catálogo: se toman las que
        quedaron con filas después de `migrate`, así una migración de datos
        nueva entra sola. `django_migrations` se excluye — se genera aparte,
        desde el grafo.
        """
        with target_connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT t.name
                FROM sys.tables t
                JOIN sys.partitions p ON p.object_id = t.object_id AND p.index_id IN (0, 1)
                GROUP BY t.name
                HAVING SUM(p.rows) > 0
                """
            )
            tables = sorted(row[0] for row in cursor.fetchall())
            tables = [table for table in tables if table != "django_migrations"]

            cursor.execute(
                """
                SELECT parent.name, referenced.name
                FROM sys.foreign_keys fk
                JOIN sys.tables parent ON parent.object_id = fk.parent_object_id
                JOIN sys.tables referenced ON referenced.object_id = fk.referenced_object_id
                """
            )
            dependencies = {(child, parent) for child, parent in cursor.fetchall()}

            catalog = []
            for table in self._ordered_by_dependencies(tables, dependencies):
                cursor.execute(
                    """
                    SELECT c.name, CAST(IIF(ic.object_id IS NULL, 0, 1) AS bit)
                    FROM sys.columns c
                    LEFT JOIN sys.identity_columns ic
                        ON ic.object_id = c.object_id AND ic.column_id = c.column_id
                    WHERE c.object_id = OBJECT_ID(%s)
                    ORDER BY c.column_id
                    """,
                    [table],
                )
                columns = cursor.fetchall()
                names = [name for name, _ in columns]
                has_identity = any(is_identity for _, is_identity in columns)
                quoted = ", ".join(f"[{name}]" for name in names)
                cursor.execute(f"SELECT {quoted} FROM [{table}] ORDER BY 1")
                catalog.append(
                    {
                        "table": table,
                        "columns": names,
                        "identity": has_identity,
                        "rows": cursor.fetchall(),
                    }
                )
            return catalog

    @staticmethod
    def _ordered_by_dependencies(tables, dependencies):
        """Orden topológico: una tabla va después de aquellas a las que apunta.

        Necesario porque el script inserta las filas con sus ids reales y las
        claves foráneas ya existen — `auth_permission` no puede insertarse
        antes que `django_content_type`. Las autorreferencias se ignoran (una
        FK de una tabla a sí misma no impone orden entre tablas).
        """
        pending = list(tables)
        ordered = []
        while pending:
            ready = [
                table
                for table in pending
                if not any((table, parent) in dependencies for parent in pending if parent != table)
            ]
            if not ready:
                # Ciclo entre tablas: no ocurre en este esquema, pero si
                # ocurriera es mejor emitir algo que colgarse.
                ordered.extend(pending)
                break
            for table in ready:
                ordered.append(table)
                pending.remove(table)
        return ordered

    # ------------------------------------------------------------------
    # Esquema
    # ------------------------------------------------------------------

    def _models(self, loader):
        """Modelos a crear, en orden determinista.

        Los toma del estado final del grafo de migraciones, no del registro
        de modelos en runtime: la tabla intermedia `auth_group_permissions`
        queda con `id bigint` renderizada desde el estado (el
        `DEFAULT_AUTO_FIELD` del proyecto) y con `id int` renderizada desde
        el registro (el `default_auto_field` que fija `AuthConfig`). La base
        real la crea `migrate`, así que el estado del grafo es la referencia
        correcta.

        Incluye `django_migrations` (el modelo interno del
        `MigrationRecorder`, que Django crea aparte y por eso no está en el
        estado) y excluye los `auto_created` — las tablas intermedias de M2M
        las crea `create_model()` al procesar el modelo dueño.
        """
        models = [
            model
            for model in loader.project_state().apps.get_models(include_auto_created=True)
            if model._meta.managed and not model._meta.auto_created
        ]
        models.append(MigrationRecorder.Migration)
        return sorted(models, key=lambda m: (m._meta.app_label, m._meta.model_name))

    def _statements_for(self, model):
        """DDL de un modelo, separado en (tablas + índices, claves foráneas).

        Las FKs van todas al final del script, cuando ya existen las tablas
        referenciadas, y así el orden de creación de tablas deja de importar.
        Los índices se ordenan alfabéticamente porque Django los junta en
        conjuntos y su orden cambia entre procesos.
        """
        with connection.schema_editor(collect_sql=True, atomic=False) as editor:
            editor.create_model(model)

        tables, indexes, foreign_keys = [], [], []
        for statement in editor.collected_sql:
            if statement.startswith("ALTER TABLE") and "FOREIGN KEY" in statement:
                foreign_keys.append(statement)
            elif statement.startswith("CREATE TABLE"):
                tables.append(statement)
            else:
                indexes.append(statement)
        return tables + sorted(indexes), foreign_keys

    # ------------------------------------------------------------------
    # Usuario administrador
    # ------------------------------------------------------------------

    def _admin_statements(self, email, username, password, force_password_change):
        """INSERT del usuario ADMINISTRADOR, construido desde el modelo.

        Se instancia un `User` sin guardarlo y se serializan todos sus
        campos concretos con los valores por defecto del modelo, en vez de
        escribir la lista de columnas a mano: así un campo nuevo en `User`
        entra solo en el script en vez de romperlo.

        Queda con `is_superuser=True` además del grupo `ADMINISTRADOR`:
        según `apps/roles/migrations/0001_initial.py`, en este sistema
        "administrador real se define por `is_superuser=True` y no por la
        sola pertenencia a un rol".

        No replica el registro de auditoría que hace
        `UserAdminService.create_user` — es un bootstrap sin actor humano, y
        el resto de las auditorías empiezan con el primer login real.
        """
        from apps.users.models import User

        user = User(
            username=username,
            email=email,
            password=make_password(password),
            is_superuser=True,
            is_staff=True,
            is_active=True,
            must_change_password=force_password_change,
        )
        now = datetime.datetime.now(datetime.timezone.utc)

        columns, values = [], []
        for field in user._meta.concrete_fields:
            if field.primary_key:
                continue
            value = getattr(user, field.attname)
            if value is None and (
                getattr(field, "auto_now", False) or getattr(field, "auto_now_add", False)
            ):
                # `created_at`/`updated_at` los completa Django en `pre_save`,
                # que acá nunca corre porque la instancia no se guarda.
                value = now
            columns.append(field.column)
            # Lo prepara el propio campo, no `str()`: `view_preferences` es un
            # JSONField cuyo default es `["KANBAN", "TABLA"]`, y el repr de
            # Python usa comillas simples — no es JSON y la columna tiene un
            # CHECK de ISJSON, así que el INSERT fallaba.
            values.append(self._literal(field.get_db_prep_save(value, connection)))

        lines = [
            SEPARATOR,
            "-- Usuario ADMINISTRADOR inicial",
            "--",
            "-- Único usuario que se crea acá: los demás se crean desde la aplicación,",
            "-- ya logueado con este. Queda con is_superuser y en el grupo ADMINISTRADOR",
            "-- (el rol con el catálogo completo de permisos), y su contraseña está",
            "-- hasheada con Argon2, el hasher del proyecto.",
            (
                "-- `must_change_password` obliga a cambiarla en el primer login real."
                if force_password_change
                else "-- `must_change_password` queda en 0: la contraseña la eligió el titular"
                " de la cuenta, así que no se le exige cambiarla al entrar."
            ),
            SEPARATOR,
            "",
            f"INSERT INTO [users_user] ({', '.join(f'[{c}]' for c in columns)})",
            f"VALUES ({', '.join(values)});",
            "",
            "-- Pertenencia al grupo ADMINISTRADOR (el rol con el catálogo completo).",
            "INSERT INTO [users_user_groups] ([user_id], [group_id])",
            "SELECT u.[id], g.[id]",
            "FROM [users_user] u",
            "CROSS JOIN [auth_group] g",
            f"WHERE u.[username] = {self._literal(username)}"
            f" AND g.[name] = {self._literal(ADMINISTRADOR_GROUP_NAME)};",
            "GO",
            "",
        ]
        return lines

    # ------------------------------------------------------------------
    # Literales SQL
    # ------------------------------------------------------------------

    @staticmethod
    def _literal(value):
        if value is None:
            return "NULL"
        if isinstance(value, bool):
            return "1" if value else "0"
        if isinstance(value, (int, float, decimal.Decimal)):
            return str(value)
        if isinstance(value, (datetime.datetime, datetime.date, datetime.time)):
            return "'" + value.isoformat() + "'"
        if isinstance(value, uuid.UUID):
            return "N'" + str(value) + "'"
        if isinstance(value, (bytes, bytearray)):
            return "0x" + bytes(value).hex()
        if isinstance(value, (dict, list, tuple)):
            # Un JSONField sin pasar por get_db_prep_save: se serializa como
            # JSON de verdad, nunca con el repr de Python (comillas simples,
            # que no pasan el CHECK de ISJSON de las columnas JSON).
            value = json.dumps(value, ensure_ascii=False)
        return "N'" + str(value).replace("'", "''") + "'"

    # ------------------------------------------------------------------
    # Ensamblado del script
    # ------------------------------------------------------------------

    def _build_script(
        self,
        database,
        loader,
        catalog,
        admin_email,
        admin_username,
        password,
        force_password_change,
        create_database,
    ):
        models = self._models(loader)
        migrations = sorted(loader.graph.nodes)
        catalog_rows = sum(len(entry["rows"]) for entry in catalog)
        schema_lines, foreign_keys, table_count = self._schema_lines(models)

        lines = [
            SEPARATOR,
            f"-- Nexo — creación completa de la base de datos [{database}] (SQL Server)",
            SEPARATOR,
            "--",
            "-- GENERADO AUTOMÁTICAMENTE — no editar a mano. Se regenera con:",
            "--   python manage.py sqlcreatedatabase --admin-email <correo>",
            "--",
            "-- Un solo archivo, un solo comando, y la base queda lista para entrar:",
            (
                f"--   1. CREATE DATABASE [{database}] (collation {COLLATION}, opciones ANSI en ON)"
                if create_database
                else f"--   1. (la base [{database}] tiene que existir ya — generado con"
                " --skip-create-database)"
            ),
            f"--   2. {table_count} tablas con todos sus campos, índices y claves foráneas",
            f"--   3. {len(migrations)} filas en django_migrations (bitácora de Django)",
            f"--   4. {catalog_rows} filas de catálogo: roles, permisos y jerarquía",
            f"--   5. el usuario ADMINISTRADOR inicial ({admin_username} / {admin_email})",
            "--",
            "-- NO CONTIENE datos de negocio: ni tareas, ni proyectos, ni más usuarios.",
            "--",
            "-- ATENCIÓN: incluye el hash Argon2 de la contraseña del administrador.",
            "-- Es de un solo uso — no lo commitees ni lo compartas. La contraseña en",
            "-- claro no aparece en el archivo.",
            "--",
            (
                "-- Ejecutar CONECTADO A [master], con una cuenta que pueda crear bases."
                if create_database
                else "-- Ejecutar CONECTADO A [master] (el script hace el USE a la base)."
            ),
            "-- El `-b` es importante: sin él sqlcmd sigue después de un error y deja",
            "-- la base a medio crear.",
            "--   sqlcmd -S <servidor> -d master -b -i nexo_create_database.sql",
            "--",
            "-- Si falla a mitad: borrar la base y volver a correrlo (ver README.md).",
            SEPARATOR,
            "",
            "-- QUOTED_IDENTIFIER y ANSI_NULLS tienen que estar en ON: los índices",
            "-- filtrados (los `CREATE UNIQUE INDEX ... WHERE ... IS NOT NULL` con que",
            "-- mssql-django implementa un unique_together sobre columnas nullable) los",
            "-- exigen. No es redundante: sqlcmd conecta con QUOTED_IDENTIFIER en OFF y",
            "-- sin estas dos líneas falla con el error 1934.",
            "SET QUOTED_IDENTIFIER ON;",
            "SET ANSI_NULLS ON;",
            "SET XACT_ABORT ON;",
            "SET NOCOUNT ON;",
            "GO",
            "",
            SEPARATOR,
            "-- 1. La base",
            SEPARATOR,
            "",
        ]
        lines += self._database_lines(database, create_database)
        lines += [
            SEPARATOR,
            "-- 2. El esquema",
            SEPARATOR,
            "",
        ]

        lines += schema_lines
        lines += [
            SEPARATOR,
            "-- Claves foráneas",
            "--",
            "-- Al final a propósito: así el orden de creación de las tablas de arriba",
            "-- no importa y no hay que resolver un orden topológico entre apps.",
            SEPARATOR,
            "",
        ]
        lines += [self._terminate(statement) for statement in sorted(foreign_keys)]
        lines += ["GO", ""]

        lines += self._migration_rows(migrations)
        lines += self._catalog_rows(catalog)
        lines += self._admin_statements(
            admin_email, admin_username, password, force_password_change
        )
        lines += self._verification(table_count, admin_username, database)

        return "\n".join(lines)

    @staticmethod
    def _abort(message):
        """Guard que detiene el script en cualquier herramienta.

        `THROW` aborta con `sqlcmd -b`, pero **SSMS sigue ejecutando los
        batches siguientes** cuando uno falla — medido en este proyecto. Con
        `RAISERROR` + `SET NOEXEC ON` se detienen las dos: NOEXEC salta el
        resto del batch actual y todos los siguientes. El `SET NOEXEC OFF`
        del final del script deja la sesión usable otra vez (si no, en SSMS
        la ventana queda muda y confunde).
        """
        return [
            "BEGIN",
            f"    RAISERROR('{message}', 16, 1);",
            "    SET NOEXEC ON;",
            "END",
        ]

    def _database_lines(self, database, create_database):
        """Sección 1: la base, y los dos guards que la hacen verificable.

        El `USE` no puede ser lo primero que falle si el `CREATE DATABASE`
        no funcionó: `Msg 911 La base de datos no existe` no dice nada del
        motivo real (típicamente, la cuenta no tiene permiso para crear
        bases). Por eso va antes un guard que aborta con un mensaje que sí
        lo explica.

        Y después del `USE` va un segundo guard sobre `DB_NAME()`: SSMS, a
        diferencia de `sqlcmd -b`, sigue ejecutando los batches siguientes
        cuando uno falla. Sin ese guard, un `USE` fallido dejaría el
        contexto en [master] y las 59 tablas se crearían ahí.
        """
        lines = ["USE [master];", "GO", ""]

        if create_database:
            lines += [
                f"IF DB_ID(N'{database}') IS NOT NULL",
                *self._abort(
                    "La base de datos ya existe. Revisala antes de continuar (este script no la sobrescribe)."
                ),
                "GO",
                "",
                "-- La collation es la misma que la de desarrollo. De ella dependen el orden",
                "-- de los ORDER BY de texto y la sensibilidad a mayusculas/acentos de las",
                "-- comparaciones, y con eso las busquedas y los UNIQUE de la aplicacion.",
                f"CREATE DATABASE [{database}] COLLATE {COLLATION};",
                "GO",
                "",
                "-- Si el CREATE DATABASE de arriba fallo, el motivo esta en SU mensaje de",
                "-- error (lo mas comun: la cuenta no tiene permiso para crear bases). Este",
                "-- guard corta aca para que no se encadenen errores que no dicen nada.",
                f"IF DB_ID(N'{database}') IS NULL",
                *self._abort(
                    "No se pudo crear la base: revise el error del CREATE DATABASE de arriba. "
                    "Si la base la crea el DBA, regenere el script con --skip-create-database "
                    "y ejecutelo sobre la base ya creada."
                ),
                "GO",
                "",
                "-- Opciones de la base. Las cinco ANSI se fijan explicitamente porque una",
                "-- base nueva las HEREDA de [model], y ahi suelen estar en OFF (es el caso",
                "-- de la base de desarrollo de este proyecto). Microsoft las marca como",
                "-- obsoletas: en una version futura seran siempre ON.",
                "--",
                "-- Ojo: el error 1934 lo decide la opcion de SESION, no esta. La conexion",
                "-- de la aplicacion (mssql-django/pyodbc) fija las cinco en ON por su",
                "-- cuenta — medido — y por eso desarrollo funciona con las cinco en OFF.",
                "-- Se fijan igual para que cualquier DDL ejecutado a mano desde una",
                "-- herramienta que no las fije tampoco falle.",
                f"ALTER DATABASE [{database}] SET ANSI_NULL_DEFAULT ON;",
                f"ALTER DATABASE [{database}] SET ANSI_NULLS ON;",
                f"ALTER DATABASE [{database}] SET ANSI_PADDING ON;",
                f"ALTER DATABASE [{database}] SET ANSI_WARNINGS ON;",
                f"ALTER DATABASE [{database}] SET CONCAT_NULL_YIELDS_NULL ON;",
                f"ALTER DATABASE [{database}] SET QUOTED_IDENTIFIER ON;",
                "GO",
                "",
                "-- RECOVERY FULL permite restaurar a un punto exacto en el tiempo, que es",
                "-- lo que corresponde a datos de RRHH. EXIGE respaldos periodicos del log",
                "-- de transacciones: sin ellos el .ldf crece hasta llenar el disco. Si este",
                "-- servidor no va a tener esos respaldos programados, cambiar a SIMPLE",
                "-- conscientemente (se pierde el point-in-time recovery).",
                f"ALTER DATABASE [{database}] SET RECOVERY FULL;",
                f"ALTER DATABASE [{database}] SET PAGE_VERIFY CHECKSUM;",
                "GO",
                "",
            ]
        else:
            lines += [
                "-- Script generado con --skip-create-database: la base tiene que existir",
                "-- ya, vacia (la crea el DBA). No se crea ni se modifica aca.",
                f"IF DB_ID(N'{database}') IS NULL",
                *self._abort(
                    f"La base de datos no existe. Creala vacia primero (CREATE DATABASE "
                    f"[{database}] COLLATE {COLLATION};) o regenere el script sin "
                    "--skip-create-database."
                ),
                "GO",
                "",
            ]

        lines += [
            f"USE [{database}];",
            "GO",
            "",
            "-- Guard de contexto: si el USE de arriba fallo y la herramienta siguio",
            "-- ejecutando (SSMS lo hace; sqlcmd -b no), todo lo que sigue se crearia en",
            "-- [master]. Mejor abortar que contaminar master con 59 tablas.",
            f"IF DB_NAME() <> N'{database}'",
            *self._abort(
                f"El contexto de base de datos no es [{database}]. Se aborta para no crear "
                "los objetos en la base equivocada."
            ),
            "GO",
            "",
        ]
        return lines

    def _schema_lines(self, models):
        """El DDL de todos los modelos, más la cuenta de tablas que crea.

        La cuenta no es `len(models)`: `create_model()` de un modelo con M2M
        crea también su tabla intermedia, así que hay más `CREATE TABLE` que
        modelos en la lista. Se cuentan las sentencias emitidas para que la
        verificación del final del script no compare contra un número que no
        corresponde.
        """
        lines, foreign_keys, table_count = [], [], 0
        current_app = None
        for model in models:
            own, model_foreign_keys = self._statements_for(model)
            foreign_keys.extend(model_foreign_keys)
            table_count += sum(1 for s in own if s.startswith("CREATE TABLE"))

            app_label = model._meta.app_label
            if app_label != current_app:
                current_app = app_label
                lines += [f"-- App: {app_label}", ""]

            lines.append(f"-- Tabla: {model._meta.db_table}")
            lines += [self._terminate(statement) for statement in own]
            lines += ["GO", ""]
        return lines, foreign_keys, table_count

    def _migration_rows(self, migrations):
        lines = [
            SEPARATOR,
            "-- 3. Bitácora de migraciones de Django",
            "--",
            "-- `django_migrations` es la bitácora interna de Django: si queda vacía, el",
            "-- primer `migrate` intenta crear tablas que ya existen y falla. Se marcan",
            "-- todas, incluidas las de datos, porque la sección 4 ya siembra lo que",
            "-- esas migraciones habrían sembrado. Es metadata de Django, no datos de",
            "-- negocio.",
            SEPARATOR,
            "",
        ]
        values = [
            f"    ({self._literal(app)}, {self._literal(name)}, SYSDATETIMEOFFSET())"
            for app, name in migrations
        ]
        lines += self._insert_batches("django_migrations", ["app", "name", "applied"], values)
        return lines

    def _catalog_rows(self, catalog):
        lines = [
            SEPARATOR,
            "-- 4. Catálogo: roles, permisos y jerarquía",
            "--",
            "-- Lo que en un despliegue con `migrate` siembran las migraciones de datos",
            "-- (apps.hierarchy, apps.permissions, apps.roles, apps.users). Sin esto no",
            "-- existen los grupos de rol ni sus permisos, y no se puede entrar.",
            "--",
            "-- Se insertan con sus ids reales (IDENTITY_INSERT) porque las filas se",
            "-- referencian entre sí: un permiso apunta a su content type, y una",
            "-- asignación apunta al grupo y al permiso.",
            SEPARATOR,
            "",
        ]
        for entry in catalog:
            table, columns, rows = entry["table"], entry["columns"], entry["rows"]
            lines.append(f"-- {table} ({len(rows)} filas)")
            if entry["identity"]:
                lines += [f"SET IDENTITY_INSERT [{table}] ON;", ""]
            values = [
                "    (" + ", ".join(self._literal(value) for value in row) + ")" for row in rows
            ]
            lines += self._insert_batches(table, columns, values)
            if entry["identity"]:
                lines += [f"SET IDENTITY_INSERT [{table}] OFF;", "GO", ""]
        return lines

    def _insert_batches(self, table, columns, values):
        """Un INSERT por cada ROWS_PER_INSERT filas.

        SQL Server admite hasta 1000 filas por cláusula VALUES; el corte más
        bajo mantiene el archivo legible y los errores localizables.
        """
        lines = []
        quoted = ", ".join(f"[{column}]" for column in columns)
        for start in range(0, len(values), ROWS_PER_INSERT):
            chunk = values[start : start + ROWS_PER_INSERT]
            lines.append(f"INSERT INTO [{table}] ({quoted}) VALUES")
            lines.append(",\n".join(chunk) + ";")
            lines.append("")
        lines += ["GO", ""]
        return lines

    def _verification(self, expected_tables, admin_username, database):
        return [
            SEPARATOR,
            "-- 5. Verificación",
            "--",
            "-- Falla si el script no dejó la base como se esperaba, en vez de dar por",
            "-- buena una instalación a medias.",
            SEPARATOR,
            "",
            "DECLARE @tables int = (",
            "    SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE = 'BASE TABLE'",
            ");",
            f"IF @tables <> {expected_tables}",
            *self._abort("La cantidad de tablas creadas no es la esperada."),
            "",
            "IF NOT EXISTS (SELECT 1 FROM [auth_group])",
            *self._abort("El catalogo de roles quedo vacio."),
            "",
            "IF NOT EXISTS (",
            "    SELECT 1 FROM [users_user] u",
            "    JOIN [users_user_groups] ug ON ug.[user_id] = u.[id]",
            "    JOIN [auth_group] g ON g.[id] = ug.[group_id]",
            f"    WHERE u.[username] = {self._literal(admin_username)}"
            f" AND g.[name] = {self._literal(ADMINISTRADOR_GROUP_NAME)}",
            ")",
            *self._abort(
                "El usuario administrador no quedo creado o no quedo en el grupo ADMINISTRADOR."
            ),
            "",
            f"PRINT 'Nexo: base [{database}] creada. Entrar como {admin_username}.';",
            "GO",
            "",
            "-- Si algun guard de arriba corto el script, NOEXEC quedo activo: esto",
            "-- devuelve la sesion a su estado normal (importante en SSMS, donde la",
            "-- ventana seguiria sin ejecutar nada hasta reconectar).",
            "SET NOEXEC OFF;",
            "GO",
            "",
        ]

    @staticmethod
    def _terminate(statement):
        statement = statement.strip()
        return statement if statement.endswith(";") else statement + ";"
