"""Helpers compartidos para los comandos `migrate_*_from_postgres` — Fase
80 de la migración de stack (ver docs/AUDIT_LOG.md § 2026-08-27). Extraído
de la lógica ya probada de `apps.users.management.commands.migrate_users_from_postgres`
(el único comando de este tipo hasta ahora) para no repetirla en los ~40
comandos nuevos, uno por entidad de negocio.

4 hallazgos de esta fase que motivan este módulo, en vez de que cada
comando reimplemente su propia versión (y su propio riesgo de bug):

1. **`bulk_create` SÍ dispara `auto_now`/`auto_now_add` — igual que
   `.objects.create()`.** Verificado empíricamente contra datos
   sintéticos (no solo leyendo la documentación): Django llama a
   `field.pre_save(obj, add=True)` para CADA fila durante el INSERT,
   sin importar si el camino fue `bulk_create()` o `.save()` uno por
   uno (`SQLInsertCompiler.pre_save_val`, en
   `django/db/models/sql/compiler.py`) — la creencia inicial de este
   módulo (que `bulk_create` "esquivaba" `auto_now_add` por no llamar a
   `save()`) era incorrecta y quedó descartada tras reproducir el bug
   con `ActivityReason`/`Holiday` sintéticos: los timestamps legacy se
   pisaban con la hora de la corrida pese a usar `bulk_create`. La
   corrección real: `bulk_import_rows` hace un `bulk_update()` de
   corrección INMEDIATAMENTE después del `bulk_create()` — `.update()`
   (y por lo tanto `bulk_update()`, que arma un
   `UPDATE ... SET campo = CASE WHEN pk=... THEN ... END`) nunca pasa
   por `pre_save()`, así que restaura el valor legacy sin que Django lo
   vuelva a pisar. Esto ocurre automáticamente para cualquier modelo con
   `created_at`/`updated_at` (`BaseModel`) — los 40 comandos no
   necesitan saber nada de este detalle, solo setear el valor legacy en
   la instancia antes de pasarla a `bulk_import_rows`, igual que ya
   hacían.

2. **El backend de SQL Server NO soporta
   `bulk_create(ignore_conflicts=True)`**
   (`mssql.features.DatabaseFeatures.supports_ignore_conflicts = False`,
   confirmado leyendo el driver instalado) — a diferencia de Postgres,
   donde ese parámetro es la forma habitual de hacer una carga masiva
   idempotente. La idempotencia acá se logra de otra forma: filtrar los
   `legacy_postgres_id` YA importados ANTES de construir las instancias
   (`filter_not_yet_imported`), y nunca intentar insertar una fila cuyo
   id legacy ya existe — sin depender de ningún manejo de conflictos a
   nivel de base de datos.

3. **El backend de SQL Server tampoco soporta `RETURNING` en bulk insert**
   (`can_return_rows_from_bulk_insert = False`) — a diferencia de
   Postgres, las instancias que salen de `bulk_create()` NO tienen su
   `pk` de Django poblado, así que no se puede usar esa misma lista de
   instancias para el `bulk_update()` de corrección del punto 1
   (`bulk_update` exige `pk` no nulo). La solución: releer las filas
   recién creadas por `legacy_postgres_id` (que si quedó seteado, sin
   depender de ningún mecanismo específico del backend) para obtener su
   `pk` real antes del `bulk_update`.

4. **Un modelo sin timestamp legacy real para alguno de sus campos
   `auto_now` (ej. `MeetingInvitee`, que en Prisma no tiene
   `createdAt`/`updatedAt` propios) rompía la corrección del punto 1.**
   Descubierto corriendo `migrate_meeting_invitees_from_postgres` contra
   datos sintéticos (`IntegrityError`: `created_at` no admite NULL). La
   causa: el comando deliberadamente no setea esos campos en la
   instancia (quiere el valor "ahora" que `bulk_create` ya generó), pero
   el snapshot capturaba ese `None` igual y el `bulk_update` de
   corrección lo escribía tal cual, pisando el valor correcto recién
   generado. Corregido: el snapshot solo registra un campo por instancia
   si su valor NO es `None` — un campo sin valor legacy simplemente no
   se toca en la corrección, dejando el valor ya releído de la base
   (que `bulk_create` generó correctamente) intacto."""

from collections.abc import Iterable, Sequence
from typing import Any

import psycopg2
import psycopg2.extras
from django.conf import settings
from django.core.management.base import CommandError
from django.db import models, transaction

# Límite real de SQL Server es 2100 parámetros por consulta — se deja un
# margen conservador (no 2100 exactos) para no rozar el límite ante
# columnas ocultas (ids autogenerados, etc.) que Django pueda agregar.
_SQL_SERVER_PARAM_LIMIT = 2000
_DEFAULT_BATCH_SIZE = 500


def parse_data_url_mime(data_url: str | None) -> str | None:
    """Extrae el mime type del prefijo `data:<mime>;base64,...` de un
    adjunto guardado como data URL completo (`saveAttachment`,
    `src/lib/storage.ts`) — usado por los modelos Django que separaron
    `attachment_mime` como campo propio sin equivalente directo en
    Prisma (`ImprovementIdea`, `DeskNote`, `PersonalReminder`: el mime
    vivía embebido en el data URL, nunca en una columna aparte).
    Devuelve `None` si `data_url` es `None`/vacío o no matchea el
    prefijo esperado."""
    if not data_url or not data_url.startswith("data:"):
        return None
    header = data_url.split(",", 1)[0]
    mime = header[len("data:") :].split(";")[0]
    return mime or None


def legacy_postgres_connection():
    """Conexión de solo lectura a `settings.LEGACY_POSTGRES_URL` — mismo
    patrón que `migrate_users_from_postgres`, ahora compartido. Lanza
    `CommandError` (mensaje ya listo para `manage.py`) si la variable no
    está configurada, igual que el comando original."""
    dsn = settings.LEGACY_POSTGRES_URL
    if not dsn:
        raise CommandError("LEGACY_POSTGRES_URL no está configurada (ver backend/.env.example).")
    connection = psycopg2.connect(dsn)
    connection.set_session(readonly=True)
    return connection


def fetch_legacy_rows(connection, query: str, params: Sequence[Any] | None = None) -> list[dict]:
    """Ejecuta `query` contra la conexión legacy y devuelve filas como
    dicts (`RealDictCursor`) — mismo cursor que ya usaba
    `migrate_users_from_postgres`."""
    with connection.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cursor:
        cursor.execute(query, params or ())
        return list(cursor.fetchall())


def resolve_legacy_ids(model: type[models.Model], legacy_ids: Iterable[str]) -> dict[str, int]:
    """Devuelve `{legacy_postgres_id: id_django}` para las filas de
    `model` YA importadas — para resolver el id de un padre (ej. el
    `user_id` de Django de una `Task`) durante el ETL de un hijo. Usar
    UNA vez por lote de ids necesarios (preload), nunca fila por fila —
    mismo patrón ya usado para `groups_by_role` en
    `migrate_users_from_postgres`."""
    ids = [i for i in legacy_ids if i]
    if not ids:
        return {}
    rows = model.objects.filter(legacy_postgres_id__in=ids).values_list("legacy_postgres_id", "id")
    return dict(rows)


def safe_batch_size(model: type[models.Model], requested: int = _DEFAULT_BATCH_SIZE) -> int:
    """`batch_size` de `bulk_create` que nunca excede el límite de ~2100
    parámetros por consulta de SQL Server, dado el número de columnas de
    `model`. Tablas angostas (pocas columnas) usan `requested` tal cual;
    tablas anchas (`Task`, `TaskActivity`, `ExecutiveReportSnapshot`, con
    decenas de columnas) bajan automáticamente."""
    field_count = len(model._meta.fields) or 1
    max_by_params = max(1, _SQL_SERVER_PARAM_LIMIT // field_count)
    return min(requested, max_by_params)


def filter_not_yet_imported(model: type[models.Model], legacy_ids: Sequence[str]) -> set[str]:
    """Devuelve el subconjunto de `legacy_ids` que TODAVÍA no tiene fila
    en `model` — el filtro de idempotencia que reemplaza a
    `bulk_create(ignore_conflicts=True)` (no soportado por el backend de
    SQL Server, ver docstring del módulo). Correr ANTES de construir las
    instancias del ETL — nunca construir/pasar a `bulk_create` una fila
    cuyo `legacy_postgres_id` ya está importado."""
    if not legacy_ids:
        return set()
    already = set(
        model.objects.filter(legacy_postgres_id__in=legacy_ids).values_list("legacy_postgres_id", flat=True)
    )
    return {i for i in legacy_ids if i not in already}


_DEFAULT_AUTO_NOW_FIELDS = ("created_at", "updated_at")


def bulk_import_rows(
    model: type[models.Model],
    instances: Sequence[models.Model],
    batch_size: int | None = None,
    auto_now_fields: Sequence[str] = _DEFAULT_AUTO_NOW_FIELDS,
) -> int:
    """`bulk_create` sin `ignore_conflicts` (no soportado, ver hallazgo 2
    del docstring del módulo) — el caller es responsable de haber
    filtrado `instances` con `filter_not_yet_imported` antes de llegar
    acá, así que no debería haber conflictos de todos modos.

    Cada instancia debe traer `legacy_postgres_id` ya seteado (todos los
    modelos en alcance de esta migración lo tienen) y, si el modelo
    define alguno de `auto_now_fields` (por defecto `created_at`/
    `updated_at`, los de `BaseModel`), el valor legacy real que se
    quiere preservar — `bulk_import_rows` se encarga de que ese valor
    sobreviva al `pre_save()` que Django dispara igual durante el INSERT
    (ver hallazgo 1 del docstring del módulo) con un `bulk_update()` de
    corrección inmediatamente después, releyendo las filas por
    `legacy_postgres_id` para recuperar su `pk` real (ver hallazgo 3).

    Devuelve la cantidad de filas insertadas."""
    if not instances:
        return 0
    resolved_batch_size = batch_size or safe_batch_size(model)

    model_field_names = {field.name for field in model._meta.fields}
    present_auto_now_fields = [f for f in auto_now_fields if f in model_field_names]
    # Solo se registra un valor en el snapshot si el caller lo seteó
    # explícitamente en la instancia (valor no-None) — un modelo sin
    # timestamp legacy real (ej. `MeetingInvitee`, sin `createdAt` en
    # Prisma) deja el campo sin setear a propósito, para que el valor
    # "ahora" que `bulk_create` ya generó (ver hallazgo 1) quede tal
    # cual. Si se incluyera un valor `None` en el snapshot, la corrección
    # de más abajo lo pisaría con NULL — bug real, reproducido corriendo
    # `migrate_meeting_invitees_from_postgres` contra datos sintéticos
    # (`IntegrityError`: `created_at` no admite NULL).
    timestamp_snapshot = (
        {
            instance.legacy_postgres_id: {
                f: v for f in present_auto_now_fields if (v := getattr(instance, f)) is not None
            }
            for instance in instances
        }
        if present_auto_now_fields
        else {}
    )

    with transaction.atomic():
        model.objects.bulk_create(list(instances), batch_size=resolved_batch_size)

        if present_auto_now_fields:
            legacy_ids = list(timestamp_snapshot.keys())
            created_objs = list(model.objects.filter(legacy_postgres_id__in=legacy_ids))
            for obj in created_objs:
                values = timestamp_snapshot.get(obj.legacy_postgres_id)
                if not values:
                    # Sin valor legacy que restaurar — se deja el valor que
                    # `bulk_create` ya generó (recién releído de la base),
                    # nunca se pisa con None.
                    continue
                for field, value in values.items():
                    setattr(obj, field, value)
            model.objects.bulk_update(created_objs, present_auto_now_fields, batch_size=resolved_batch_size)

    return len(instances)
