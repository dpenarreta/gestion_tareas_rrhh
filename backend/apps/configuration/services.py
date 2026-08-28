"""Feriados y Configuración Global — porción mínima portada para el Motor
de Cierre Inteligente (Fase 3d, ver docs/AUDIT_LOG.md § 2026-08-07) y,
desde la Fase 4a (ver docs/AUDIT_LOG.md § 2026-08-11), la base horaria del
motor de KPIs/Analytics (`LeaveRecord`/`SpecialStatus`, portados de
`src/lib/leaves.ts`/`src/lib/specialStatus.ts`). NO incluye el resto del
catálogo de Configuración (retención, NOVA, etc.) — ver los planes de
Fase 3d/4a para el alcance exacto y por qué no hay endpoints HTTP para
esto todavía."""

import calendar
import json
from datetime import date, datetime, timedelta
from datetime import timezone as dt_timezone

from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from apps.assistant.models import KnowledgeDocument
from apps.core.rounding import round_half_up
from apps.reports.models import MonthlyReport
from apps.tasks.models import Task

from .models import DataPurgeLog, Holiday, LeaveRecord, SpecialStatus, SystemConfigHistory

CONFIG_KEY_HORAS_EFECTIVAS = "HORAS_EFECTIVAS_DIA"
DEFAULT_HORAS_EFECTIVAS = 6.5

CONFIG_KEY_WORKLOAD_LIMIT_LOW = "workload_limit_low"
DEFAULT_WORKLOAD_LIMIT_LOW = 5.5

CONFIG_KEY_WORKLOAD_LIMIT_HIGH = "workload_limit_high"
DEFAULT_WORKLOAD_LIMIT_HIGH = 7.5

CONFIG_KEY_WORKLOAD_LIMIT_OVERLOAD = "workload_limit_overload"
DEFAULT_WORKLOAD_LIMIT_OVERLOAD = 8.5

# Fase 3f (ver docs/AUDIT_LOG.md § 2026-08-07): ventana de registro
# retroactivo de horas — reusa el mismo mecanismo genérico de arriba.
CONFIG_KEY_RETROACTIVE_WINDOW_DAYS = "retroactive_window_business_days"
DEFAULT_RETROACTIVE_WINDOW_DAYS = 2

# Fase 4b (ver docs/AUDIT_LOG.md § 2026-08-11): única clave de
# `getEffectiveAnalyticsConfig` que `compute_risk_alerts` necesita — el
# resto de ese catálogo (~11 claves más) se porta en sub-fases futuras.
CONFIG_KEY_ALERT_OVERDUE_TASK_THRESHOLD = "analytics_alert_overdue_task_threshold"
DEFAULT_ALERT_OVERDUE_TASK_THRESHOLD = 3

# Fase 6a (ver docs/AUDIT_LOG.md § 2026-08-14): duración de `nexo-session`
# (la cookie de sesión de Next.js) — mismas claves/defaults que
# `src/lib/systemConfig.ts`. El login de Next.js las lee de la respuesta
# de `POST /auth/login/` (`session_policy`, ver
# `apps.authentication.services.AuthenticationService`) en vez de leer
# Postgres directamente.
CONFIG_KEY_SESSION_DURATION_DEFAULT_HOURS = "session_duration_default_hours"
DEFAULT_SESSION_DURATION_DEFAULT_HOURS = 168  # 7 días

CONFIG_KEY_SESSION_DURATION_REMEMBER_HOURS = "session_duration_remember_hours"
DEFAULT_SESSION_DURATION_REMEMBER_HOURS = 720  # 30 días

# Fase 7a (ver docs/AUDIT_LOG.md § 2026-08-17): límite de respuestas cortas
# por Nota Rápida de Escritorio Digital — mismas clave/default que
# `src/lib/systemConfig.ts`.
CONFIG_KEY_DESK_NOTE_MAX_REPLIES = "desk_note_max_replies"
DEFAULT_DESK_NOTE_MAX_REPLIES = 2

# Fase 34 (ver docs/AUDIT_LOG.md § 2026-08-21): TTL de caché de mensajes
# generados por Nova (Dashboard + Insights) — mismas clave/default que
# `src/lib/systemConfig.ts`. Solo se porta la CONFIGURACIÓN: Nova en sí
# (Groq) sigue fuera de alcance (mismo criterio que `nova-message`,
# Fase 25, y `kpis/nova-insights`).
CONFIG_KEY_NOVA_CACHE_TTL_MINUTES = "nova_cache_ttl_minutes"
DEFAULT_NOVA_CACHE_TTL_MINUTES = 240


def get_effective_config_value(key: str, as_of: datetime, fallback: float) -> float:
    """Valor de `key` vigente en el instante `as_of` — nunca retroactivo:
    un cambio posterior a `as_of` no puede alterar este resultado. Igual
    criterio que `getEffectiveConfigValue` legacy."""
    record = (
        SystemConfigHistory.objects.filter(key=key, valid_from__lte=as_of)
        .filter(Q(valid_until__isnull=True) | Q(valid_until__gt=as_of))
        .order_by("-valid_from")
        .first()
    )
    if record is None:
        return fallback
    try:
        value = float(record.value)
    except ValueError:
        return fallback
    if value != value or value in (float("inf"), float("-inf")):  # NaN/Inf
        return fallback
    return value


def get_effective_horas_efectivas(as_of: datetime) -> float:
    return get_effective_config_value(CONFIG_KEY_HORAS_EFECTIVAS, as_of, DEFAULT_HORAS_EFECTIVAS)


def get_effective_workload_limit_low(as_of: datetime) -> float:
    return get_effective_config_value(CONFIG_KEY_WORKLOAD_LIMIT_LOW, as_of, DEFAULT_WORKLOAD_LIMIT_LOW)


def get_effective_workload_limit_high(as_of: datetime) -> float:
    return get_effective_config_value(CONFIG_KEY_WORKLOAD_LIMIT_HIGH, as_of, DEFAULT_WORKLOAD_LIMIT_HIGH)


def get_effective_workload_limit_overload(as_of: datetime) -> float:
    return get_effective_config_value(CONFIG_KEY_WORKLOAD_LIMIT_OVERLOAD, as_of, DEFAULT_WORKLOAD_LIMIT_OVERLOAD)


def get_effective_retroactive_window_days(as_of: datetime) -> int:
    return int(
        get_effective_config_value(CONFIG_KEY_RETROACTIVE_WINDOW_DAYS, as_of, DEFAULT_RETROACTIVE_WINDOW_DAYS)
    )


def get_effective_alert_overdue_task_threshold(as_of: datetime) -> int:
    return int(
        get_effective_config_value(
            CONFIG_KEY_ALERT_OVERDUE_TASK_THRESHOLD, as_of, DEFAULT_ALERT_OVERDUE_TASK_THRESHOLD
        )
    )


def get_effective_session_duration_default_hours(as_of: datetime) -> int:
    return int(
        get_effective_config_value(
            CONFIG_KEY_SESSION_DURATION_DEFAULT_HOURS, as_of, DEFAULT_SESSION_DURATION_DEFAULT_HOURS
        )
    )


def get_effective_session_duration_remember_hours(as_of: datetime) -> int:
    return int(
        get_effective_config_value(
            CONFIG_KEY_SESSION_DURATION_REMEMBER_HOURS, as_of, DEFAULT_SESSION_DURATION_REMEMBER_HOURS
        )
    )


def get_effective_desk_note_max_replies(as_of: datetime) -> int:
    return int(
        get_effective_config_value(CONFIG_KEY_DESK_NOTE_MAX_REPLIES, as_of, DEFAULT_DESK_NOTE_MAX_REPLIES)
    )


def get_effective_nova_cache_ttl_minutes(as_of: datetime) -> int:
    return int(
        get_effective_config_value(CONFIG_KEY_NOVA_CACHE_TTL_MINUTES, as_of, DEFAULT_NOVA_CACHE_TTL_MINUTES)
    )


# --- Reglas de notificación configurables (Fase 35, ver
# docs/AUDIT_LOG.md § 2026-08-21) — réplica de `NotificationRulesConfig`/
# `getNotificationRules`/`saveNotificationRules`
# (`src/lib/notificationRules.ts`, retirado en el cutover de stack).
#
# GAP CERRADO (2026-08-28, ver docs/AUDIT_LOG.md § 2026-08-28) —
# `CommentService.create_comment`/`ActivityService.create_retroactive_activity`
# (`apps/tasks/services.py`) ya leen `comment_targets`/`first_comment_role`/
# `retroactive_notify_roles` de acá en vez de la jerarquía hardcodeada
# (`RoleNotificationTarget`) o la constante `RETROACTIVE_NOTIFY_ROLES`
# (retirada). Bajo la config DEFAULT (sin override guardado) el
# comportamiento es idéntico al anterior, porque `_default_comment_targets()`
# ya replica esa misma jerarquía.
CONFIG_KEY_NOTIFICATION_RULES = "notification_rules"


def _default_comment_targets() -> dict[str, list[str]]:
    from django.contrib.auth.models import Group

    from apps.hierarchy.services import ALL_ROLES, get_notification_target_groups

    return {
        role: [g.name for g in get_notification_target_groups(Group.objects.get(name=role))]
        for role in ALL_ROLES
    }


def get_default_notification_rules() -> dict:
    """Réplica de `defaultRules` — mismo comportamiento que tenía antes
    de ser configurable (notificar hacia arriba en la jerarquía)."""
    return {
        "comment_targets": _default_comment_targets(),
        "first_comment_role": None,
        "retroactive_notify_roles": ["COORDINADOR_NACIONAL"],
    }


def get_effective_notification_rules() -> dict:
    """Réplica exacta de `getNotificationRules` — a diferencia del
    resto de `get_effective_*` de este módulo, NO recibe `as_of`: el
    TS tampoco lo tiene, siempre lee el registro vigente
    (`valid_until` nulo), sin semántica de "vigente en un instante
    pasado". Si NO hay registro, o el JSON no parsea como objeto,
    devuelve los defaults completos; si SÍ hay uno que parsea, cada
    campo ausente cae a un valor VACÍO (`{}`/`None`/`[]`), nunca a su
    default individual — fidelidad exacta al operador `??` de JS, que
    no distingue "nunca configurado" de "guardado parcialmente"."""
    record = (
        SystemConfigHistory.objects.filter(key=CONFIG_KEY_NOTIFICATION_RULES, valid_until__isnull=True)
        .order_by("-valid_from")
        .first()
    )
    if record is None:
        return get_default_notification_rules()
    try:
        parsed = json.loads(record.value)
    except (TypeError, ValueError):
        return get_default_notification_rules()
    if not isinstance(parsed, dict):
        return get_default_notification_rules()
    return {
        "comment_targets": parsed.get("comment_targets") or {},
        "first_comment_role": parsed.get("first_comment_role"),
        "retroactive_notify_roles": parsed.get("retroactive_notify_roles") or [],
    }


def set_notification_rules(config: dict, actor) -> None:
    """Réplica de `saveNotificationRules` — mismo resultado neto que
    `set_config_value` (cierra el registro vigente, crea uno nuevo),
    se reutiliza directamente en vez de duplicar la transacción."""
    set_config_value(CONFIG_KEY_NOTIFICATION_RULES, json.dumps(config), actor)


def validate_notification_rules_body(body) -> tuple[dict | None, str | None]:
    """Réplica exacta de `validateConfig` (`notificationRules.ts`) —
    los 3 campos son OBLIGATORIOS (nunca parciales, a diferencia del
    resto de `settings/*`): un cuerpo que omita cualquiera de los 3 se
    rechaza, igual que el TS (`undefined` nunca es un rol válido).
    `first_comment_role` necesita un chequeo de PRESENCIA explícito
    (`"first_comment_role" in body`) porque, a diferencia de JS, un
    dict de Python no distingue "clave ausente" de "clave presente con
    valor `None`" — y acá esa distinción importa (`None` es un valor
    válido, la ausencia no)."""
    from apps.hierarchy.services import ALL_ROLES

    if not isinstance(body, dict):
        return None, "Configuración inválida"

    comment_targets = body.get("comment_targets")
    if not isinstance(comment_targets, dict):
        return None, "Configuración inválida"
    clean_targets: dict[str, list[str]] = {}
    for role, targets in comment_targets.items():
        if role not in ALL_ROLES or not isinstance(targets, list) or not all(t in ALL_ROLES for t in targets):
            return None, "Configuración inválida"
        clean_targets[role] = targets

    if "first_comment_role" not in body:
        return None, "Configuración inválida"
    first_comment_role = body["first_comment_role"]
    if first_comment_role is not None and first_comment_role not in ALL_ROLES:
        return None, "Configuración inválida"

    retroactive_notify_roles = body.get("retroactive_notify_roles")
    if not isinstance(retroactive_notify_roles, list) or not all(r in ALL_ROLES for r in retroactive_notify_roles):
        return None, "Configuración inválida"

    return (
        {
            "comment_targets": clean_targets,
            "first_comment_role": first_comment_role,
            "retroactive_notify_roles": retroactive_notify_roles,
        },
        None,
    )


# Fase 32 (ver docs/AUDIT_LOG.md § 2026-08-21): longitud mínima de
# contraseña — mismas clave/default que `src/lib/systemConfig.ts`.
# El TS la enforce en `POST /api/auth/change-password` (capa Next.js,
# antes de reenviar a Django); el `POST /auth/password/change/` de
# Django usa sus propios validadores nativos
# (`AUTH_PASSWORD_VALIDATORS.MinimumLengthValidator`, `min_length=10`
# hardcodeado, independiente de este valor). Fase 75 (ver
# docs/AUDIT_LOG.md § 2026-08-26): en vez de hacer que Django respete
# este valor dinámicamente, se clampeó el rango configurable (acá y en
# `SeguridadConfigUpdateSerializer`) a un piso de 10 — el mismo que
# Django ya impone siempre — para que la UI de Ajustes deje de
# prometer un mínimo más permisivo del que realmente se aplica.
CONFIG_KEY_PASSWORD_MIN_LENGTH = "password_min_length"
DEFAULT_PASSWORD_MIN_LENGTH = 10


def get_effective_password_min_length(as_of: datetime) -> int:
    """Clampeada a un piso de 10 en la LECTURA (no solo en la validación del
    `PUT`) — una fila de `SystemConfigHistory` guardada antes de la Fase 75
    con un valor menor no queda mostrando un mínimo por debajo del que
    Django realmente aplica hasta que un Administrador la vuelva a guardar;
    la corrección es inmediata sin necesidad de migrar datos históricos."""
    return max(10, int(get_effective_config_value(CONFIG_KEY_PASSWORD_MIN_LENGTH, as_of, DEFAULT_PASSWORD_MIN_LENGTH)))


# Retención de `LoginAttempt` (`apps.authentication.models`, ya
# existente) — mismas clave/default/opciones que
# `CONFIG_KEY_RETENTION_LOGIN_ATTEMPTS` en `src/lib/systemConfig.ts`.
# Valor STRING (enum cerrado de días), mismo criterio que
# `prediction_window_weeks`. Solo se porta la configuración — no hay
# job de purga de `LoginAttempt` en Django todavía.
CONFIG_KEY_RETENTION_LOGIN_ATTEMPTS = "retention_login_attempts"
DEFAULT_RETENTION_LOGIN_ATTEMPTS = "30"
RETENTION_LOGIN_ATTEMPTS_OPTIONS = ("7", "15", "30", "60", "90")


def get_effective_retention_login_attempts(as_of: datetime) -> str:
    return get_effective_config_string(CONFIG_KEY_RETENTION_LOGIN_ATTEMPTS, as_of, DEFAULT_RETENTION_LOGIN_ATTEMPTS)


# Fase 25 (ver docs/AUDIT_LOG.md § 2026-08-20): mensaje de bienvenida
# opcional del Dashboard — mismas clave/default que
# `CONFIG_KEY_WELCOME_MESSAGE`/`CONFIG_KEY_WELCOME_MESSAGE_ACTIVE`
# (`src/lib/systemConfig.ts`). Sin `set`/endpoint HTTP en esta sub-fase
# (Sprint O sigue sin planificar en detalle), mismo criterio que
# `get_effective_role_target`/`get_effective_role_compatibility`.
CONFIG_KEY_WELCOME_MESSAGE = "welcome_message"
CONFIG_KEY_WELCOME_MESSAGE_ACTIVE = "welcome_message_active"


def get_effective_welcome_message(as_of: datetime) -> str:
    return get_effective_config_string(CONFIG_KEY_WELCOME_MESSAGE, as_of, "")


def get_effective_welcome_message_active(as_of: datetime) -> bool:
    return get_effective_config_string(CONFIG_KEY_WELCOME_MESSAGE_ACTIVE, as_of, "false") == "true"


# Fase 4f (ver docs/AUDIT_LOG.md § 2026-08-11): hora local (huso de
# negocio) a la que se asume terminada la jornada, usada por Capacidad
# Proyectada — antes de esta hora "hoy" cuenta como parcial, después la
# proyección arranca desde el siguiente día laborable.
CONFIG_KEY_WORKDAY_END_HOUR = "capacity_workday_end_hour_local"
DEFAULT_WORKDAY_END_HOUR = 17


def get_effective_workday_end_hour(as_of: datetime) -> int:
    return int(get_effective_config_value(CONFIG_KEY_WORKDAY_END_HOUR, as_of, DEFAULT_WORKDAY_END_HOUR))


def get_effective_config_string(key: str, as_of: datetime, fallback: str) -> str:
    """Igual que `get_effective_config_value` pero para valores que no son
    numéricos (ej. JSON de una curva) — réplica de `getEffectiveConfigString`."""
    record = (
        SystemConfigHistory.objects.filter(key=key, valid_from__lte=as_of)
        .filter(Q(valid_until__isnull=True) | Q(valid_until__gt=as_of))
        .order_by("-valid_from")
        .first()
    )
    return record.value if record is not None else fallback


# Fase 9 (ver docs/AUDIT_LOG.md § 2026-08-18): ventana histórica de
# Inteligencia Preventiva — mismas clave/opciones/default que
# `src/lib/predictiveConfig.ts`. Valor STRING (no numérico): las
# opciones son un enum cerrado de semanas, no un rango libre.
CONFIG_KEY_PREDICTION_WINDOW_WEEKS = "prediction_window_weeks"
DEFAULT_PREDICTION_WINDOW_WEEKS = "3"
PREDICTION_WINDOW_OPTIONS = ("3", "4", "6", "8", "12")


def get_effective_prediction_window_weeks(as_of: datetime) -> str:
    return get_effective_config_string(CONFIG_KEY_PREDICTION_WINDOW_WEEKS, as_of, DEFAULT_PREDICTION_WINDOW_WEEKS)


def get_effective_prediction_window_weeks_number(as_of: datetime) -> int:
    """Ventana efectiva como número de semanas (parseada, nunca inválida
    — cae al default si el valor guardado no es una opción reconocida),
    réplica de `getEffectivePredictionWindowWeeksNumber`."""
    raw = get_effective_prediction_window_weeks(as_of)
    return int(raw) if raw in PREDICTION_WINDOW_OPTIONS else 3


# Fase 14 (ver docs/AUDIT_LOG.md § 2026-08-20): retención del Centro de
# Recuperación (`apps.recovery`) — mismas clave/default que
# `src/lib/systemConfig.ts` (`CONFIG_KEY_RECOVERY_RETENTION_HOURS`).
# Única para toda la plataforma (no hay valor por módulo).
CONFIG_KEY_RECOVERY_RETENTION_HOURS = "recovery_center_retention_hours"
DEFAULT_RECOVERY_RETENTION_HOURS = 48


def get_effective_recovery_retention_hours(as_of: datetime) -> int:
    return int(get_effective_config_value(CONFIG_KEY_RECOVERY_RETENTION_HOURS, as_of, DEFAULT_RECOVERY_RETENTION_HOURS))


# Fase 14 (ver docs/AUDIT_LOG.md § 2026-08-20): retención del archivo de
# notas de Escritorio Digital — mecanismo INDEPENDIENTE del Centro de
# Recuperación (no usa RecoveryItem; ver `apps.desk.services.
# purge_expired_archived_notes`), mismas clave/default que
# `CONFIG_KEY_DESK_ARCHIVE_RETENTION_DAYS` en `systemConfig.ts`.
CONFIG_KEY_DESK_ARCHIVE_RETENTION_DAYS = "desk_archive_retention_days"
DEFAULT_DESK_ARCHIVE_RETENTION_DAYS = 15


def get_effective_desk_archive_retention_days(as_of: datetime) -> int:
    return int(get_effective_config_value(CONFIG_KEY_DESK_ARCHIVE_RETENTION_DAYS, as_of, DEFAULT_DESK_ARCHIVE_RETENTION_DAYS))


# Objetivo esperado del cargo (Sprint 7, ver docs/AUDIT_LOG.md §
# 2026-08-20, Fase 22) — configuración OPCIONAL por cargo, usada
# únicamente como referencia en el Benchmark Personal
# (`apps.analytics.benchmark`). Réplica de `RoleTarget`/
# `getEffectiveRoleTarget` (`src/lib/systemConfig.ts`) — JSON en
# `SystemConfigHistory`, mismo mecanismo que las curvas de
# normalización. Sin cargo configurado → `None` (nunca un objetivo
# inventado). `set_role_target`/endpoint HTTP (`GET/PATCH
# /settings/role-targets/`) agregados en la Fase 28, ver
# docs/AUDIT_LOG.md § 2026-08-20.
def _role_target_config_key(role_name: str) -> str:
    return f"analytics_role_target_{role_name.lower()}"


def get_effective_role_target(role_name: str, as_of: datetime) -> dict | None:
    raw = get_effective_config_string(_role_target_config_key(role_name), as_of, "")
    if not raw:
        return None
    try:
        parsed = json.loads(raw)
    except (TypeError, ValueError):
        return None
    if not isinstance(parsed, dict):
        return None

    def _num(key: str) -> float | None:
        value = parsed.get(key)
        return value if isinstance(value, (int, float)) and not isinstance(value, bool) else None

    return {"performance": _num("performance"), "riesgo_max": _num("riesgo_max"), "cumplimiento": _num("cumplimiento")}


# Matriz de Compatibilidad Operativa (Fase 24, ver docs/AUDIT_LOG.md §
# 2026-08-20) — cargos ADICIONALES (más allá del propio, siempre
# prioritario) con los que un cargo puede redistribuir carga cuando no
# hay nadie disponible del mismo cargo. Solo tiene efecto entre cargos
# del MISMO nivel jerárquico — esa validación vive en el caller
# (`apps.analytics.recommendations.compute_team_recommendations`, que
# sí conoce `ROLE_LEVEL`), deliberadamente fuera de este módulo, mismo
# criterio que `get_effective_role_target` ("el caller pasa el rol,
# evita acoplar este módulo a la jerarquía"). El sentido de cada
# entrada es direccional (guardado por separado del lado de cada
# cargo). Vacío por defecto: sin configuración explícita, un cargo solo
# redistribuye con el mismo cargo (Regla 1), nunca se inventa
# compatibilidad. Réplica de `getEffectiveRoleCompatibility`
# (`src/lib/systemConfig.ts`) — mismo mecanismo JSON que `RoleTarget`.
# `set_role_compatibility`/endpoint HTTP (`GET/PATCH
# /settings/role-compatibility/`) agregados en la Fase 28, ver
# docs/AUDIT_LOG.md § 2026-08-20.
def _role_compatibility_config_key(role_name: str) -> str:
    return f"analytics_role_compatibility_{role_name.lower()}"


def get_effective_role_compatibility(role_name: str, as_of: datetime) -> list[str]:
    raw = get_effective_config_string(_role_compatibility_config_key(role_name), as_of, "")
    if not raw:
        return []
    try:
        parsed = json.loads(raw)
    except (TypeError, ValueError):
        return []
    if not isinstance(parsed, list):
        return []
    return [r for r in parsed if isinstance(r, str)]


def set_role_target(role_name: str, target: dict, actor) -> None:
    """Réplica de `setRoleTarget` — persiste los 3 campos tal cual
    llegan (ya validados por el serializer del endpoint HTTP)."""
    set_config_value(_role_target_config_key(role_name), json.dumps(target), actor)


def get_all_effective_role_targets(roles: list[str], as_of: datetime) -> dict[str, dict | None]:
    """Réplica de `getAllEffectiveRoleTargets` — usada por `GET
    /settings/role-targets/` para devolver el catálogo completo en una
    sola respuesta."""
    return {role: get_effective_role_target(role, as_of) for role in roles}


def set_role_compatibility(role_name: str, compatible_roles: list[str], actor) -> None:
    """Réplica de `setRoleCompatibility` — persiste la lista ya
    depurada (sin el propio cargo, sin niveles distintos; esas 2
    validaciones viven en el endpoint HTTP, que sí conoce `ROLE_LEVEL`)."""
    set_config_value(_role_compatibility_config_key(role_name), json.dumps(compatible_roles), actor)


def get_all_effective_role_compatibility(roles: list[str], as_of: datetime) -> dict[str, list[str]]:
    """Réplica de `getAllEffectiveRoleCompatibility` — usada por `GET
    /settings/role-compatibility/`."""
    return {role: get_effective_role_compatibility(role, as_of) for role in roles}


# Presets de posposición de recordatorios, en minutos (Escritorio
# Digital) — Fase 28 (ver docs/AUDIT_LOG.md § 2026-08-20). Réplica de
# `getEffectiveSnoozePresetsMinutes` (`src/lib/systemConfig.ts`) —
# mismo mecanismo JSON que `RoleCompatibility`. `set_snooze_presets_minutes`
# agregado en la Fase 31 (ver docs/AUDIT_LOG.md § 2026-08-21): el
# consumidor real es `PUT /settings/escritorio-digital-config/`
# (`settings/snooze-presets/route.ts` sigue siendo solo lectura).
CONFIG_KEY_SNOOZE_PRESETS_MINUTES = "desk_reminder_snooze_presets_minutes"
DEFAULT_SNOOZE_PRESETS_MINUTES = [15, 30, 60, 1440]


def get_effective_snooze_presets_minutes(as_of: datetime) -> list[int]:
    raw = get_effective_config_string(CONFIG_KEY_SNOOZE_PRESETS_MINUTES, as_of, "")
    if not raw:
        return list(DEFAULT_SNOOZE_PRESETS_MINUTES)
    try:
        parsed = json.loads(raw)
    except (TypeError, ValueError):
        return list(DEFAULT_SNOOZE_PRESETS_MINUTES)
    if isinstance(parsed, list) and all(
        isinstance(n, (int, float)) and not isinstance(n, bool) for n in parsed
    ):
        return parsed
    return list(DEFAULT_SNOOZE_PRESETS_MINUTES)


def set_snooze_presets_minutes(minutes: list[int], actor) -> None:
    set_config_value(CONFIG_KEY_SNOOZE_PRESETS_MINUTES, json.dumps(minutes), actor)


# Fase 7a/14 (ver docs/AUDIT_LOG.md § 2026-08-17/2026-08-20) — réplica
# de `getEffectiveDeskNoteMaxReplies`/`getEffectiveDeskArchiveRetentionDays`
# ya existentes arriba. `set_desk_note_max_replies`/
# `set_desk_archive_retention_days` agregados en la Fase 31 —
# consumidos por `PUT /settings/escritorio-digital-config/`.
def set_desk_note_max_replies(value: int, actor) -> None:
    set_config_value(CONFIG_KEY_DESK_NOTE_MAX_REPLIES, str(value), actor)


def set_desk_archive_retention_days(value: int, actor) -> None:
    set_config_value(CONFIG_KEY_DESK_ARCHIVE_RETENTION_DAYS, str(value), actor)


# --- Política de retención (Fase 31, ver docs/AUDIT_LOG.md §
# 2026-08-21) — réplica de `retentionPolicy.ts`/`systemConfig.ts`: 3
# claves independientes, mismo mecanismo `get_effective_config_string`
# que el resto del catálogo. `find_purge_candidates`/`execute_purge`
# (réplica de `findPurgeCandidates`/`executePurge`, la ejecución real de
# la purga) se agregan en la Fase 83 (ver docs/AUDIT_LOG.md §
# 2026-08-27) — el bloqueo original ("`MonthlyReport`/`KnowledgeDocument`/
# `DataPurgeLog` sin portar") ya no aplica: `KnowledgeDocument` se portó
# en la Fase 58 (Asistente LLM/RAG) sin que nadie reconectara esto, y
# `MonthlyReport`/`DataPurgeLog` se agregan en esta misma fase.
CONFIG_KEY_RETENTION_MONTHLY_REPORTS = "retention_monthly_reports"
DEFAULT_RETENTION_MONTHLY_REPORTS = "24"
CONFIG_KEY_RETENTION_ARCHIVED_TASKS = "retention_archived_tasks"
DEFAULT_RETENTION_ARCHIVED_TASKS = "24"
CONFIG_KEY_RETENTION_KNOWLEDGE_DOCS = "retention_knowledge_docs"
DEFAULT_RETENTION_KNOWLEDGE_DOCS = "indefinite"

MONTHLY_REPORTS_OPTIONS = ("6", "12", "24", "36")
ARCHIVED_TASKS_OPTIONS = ("6", "12", "24", "36")
KNOWLEDGE_DOCS_OPTIONS = ("12", "24", "36", "indefinite")


def get_effective_retention_monthly_reports(as_of: datetime) -> str:
    return get_effective_config_string(CONFIG_KEY_RETENTION_MONTHLY_REPORTS, as_of, DEFAULT_RETENTION_MONTHLY_REPORTS)


def get_effective_retention_archived_tasks(as_of: datetime) -> str:
    return get_effective_config_string(CONFIG_KEY_RETENTION_ARCHIVED_TASKS, as_of, DEFAULT_RETENTION_ARCHIVED_TASKS)


def get_effective_retention_knowledge_docs(as_of: datetime) -> str:
    return get_effective_config_string(CONFIG_KEY_RETENTION_KNOWLEDGE_DOCS, as_of, DEFAULT_RETENTION_KNOWLEDGE_DOCS)


def get_effective_retention_policy(as_of: datetime) -> dict[str, str]:
    """Réplica de `getEffectivePolicy` (`src/lib/retentionPolicy.ts`)."""
    return {
        "monthly_reports_months": get_effective_retention_monthly_reports(as_of),
        "archived_tasks_months": get_effective_retention_archived_tasks(as_of),
        "knowledge_docs_months": get_effective_retention_knowledge_docs(as_of),
    }


def _retention_cutoff_date(months: int, as_of: datetime) -> datetime:
    """Réplica de `cutoffDate` (`src/lib/retentionPolicy.ts`) — resta
    `months` a `as_of`. A diferencia de `Date.setMonth` en JS (que
    desborda al mes siguiente si el día de destino no existe ahí, ej.
    31 ene -> 2/3 mar), acá se clampea al último día del mes destino —
    misma decisión ya tomada para `advance_repeat`
    (`apps/desk/services.py`, ver docs/AUDIT_LOG.md § 2026-08-17, Fase
    7b): edge case raro sin impacto funcional conocido, evita sumar
    `dateutil` como dependencia nueva."""
    total_months = as_of.year * 12 + (as_of.month - 1) - months
    year, month = divmod(total_months, 12)
    month += 1
    last_day = calendar.monthrange(year, month)[1]
    return as_of.replace(year=year, month=month, day=min(as_of.day, last_day))


def find_purge_candidates(as_of: datetime) -> dict:
    """Réplica de `findPurgeCandidates` (`src/lib/retentionPolicy.ts`)
    — Fase 83 (ver docs/AUDIT_LOG.md § 2026-08-27). Solo lectura, no
    borra nada. `docs` trae `github_path`/`github_sha` (no solo ids) —
    los necesita `execute_purge` para que el caller (`route.ts`) pueda
    limpiar GitHub después de borrar en la base."""
    policy = get_effective_retention_policy(as_of)

    reports_cutoff = _retention_cutoff_date(int(policy["monthly_reports_months"]), as_of)
    report_ids = [
        r.id
        for r in MonthlyReport.objects.all().only("id", "year", "month")
        if date(r.year, r.month, 1) < reports_cutoff.date()
    ]

    tasks_cutoff = _retention_cutoff_date(int(policy["archived_tasks_months"]), as_of)
    task_ids = list(
        Task.objects.filter(archived_month__isnull=False, archived_at__lt=tasks_cutoff).values_list("id", flat=True)
    )

    docs: list[dict] = []
    if policy["knowledge_docs_months"] != "indefinite":
        docs_cutoff = _retention_cutoff_date(int(policy["knowledge_docs_months"]), as_of)
        docs = list(
            KnowledgeDocument.objects.filter(created_at__lt=docs_cutoff).values("id", "github_path", "github_sha")
        )

    return {"policy": policy, "report_ids": report_ids, "task_ids": task_ids, "docs": docs}


def execute_purge(executed_by) -> dict:
    """Réplica de `executePurge` (`src/lib/retentionPolicy.ts`) — Fase
    83. Diferencia deliberada de orden respecto del TS: el TS borra de
    GitHub ANTES de borrar en la base (best-effort, con `.catch()`,
    nunca bloqueante); acá se borra primero en la base y se devuelve la
    lista de documentos borrados (`deleted_docs`) para que el caller
    (`route.ts`) haga la limpieza de GitHub después — como ya era
    best-effort/no bloqueante, invertir el orden no cambia el resultado
    final y evita una segunda ida y vuelta HTTP."""
    candidates = find_purge_candidates(timezone.now())
    report_ids = candidates["report_ids"]
    task_ids = candidates["task_ids"]
    docs = candidates["docs"]
    doc_ids = [d["id"] for d in docs]

    if report_ids:
        MonthlyReport.objects.filter(id__in=report_ids).delete()
    if task_ids:
        # Comment/TaskActivity/TaskCommentView tienen on_delete=CASCADE sobre Task.
        Task.objects.filter(id__in=task_ids).delete()
    if doc_ids:
        # DocumentChunk tiene on_delete=CASCADE sobre KnowledgeDocument.
        KnowledgeDocument.objects.filter(id__in=doc_ids).delete()

    result = {
        "reports_deleted": len(report_ids),
        "tasks_deleted": len(task_ids),
        "docs_deleted": len(doc_ids),
    }

    DataPurgeLog.objects.create(executed_by=executed_by, **result)

    return {
        **result,
        "deleted_docs": [{"github_path": d["github_path"], "github_sha": d["github_sha"]} for d in docs],
    }


# --- Configuración del motor de Analytics (Fase 4d, ver docs/AUDIT_LOG.md
# § 2026-08-11) — réplica de `ANALYTICS_CONFIG_DEFAULTS`/
# `getEffectiveAnalyticsConfig`/curvas de `systemConfig.ts`. Se portan
# juntas porque comparten una única función/tabla, igual que el
# legacy. `set_analytics_config_value` (escritura) agregado en la
# Fase 31 (ver docs/AUDIT_LOG.md § 2026-08-21) — `setCurveConfig`
# (curvas de normalización) sigue sin endpoint HTTP propio.
ANALYTICS_CONFIG_DEFAULTS: dict[str, float] = {
    "health_weight_cumplimiento": 25,
    "health_weight_carga": 25,
    "health_weight_vencidas": 20,
    "health_weight_consistencia": 15,
    "health_weight_capacidad": 15,
    "perf_weight_cumplimiento": 35,
    "perf_weight_vencidas": 25,
    "perf_weight_consistencia": 25,
    "perf_weight_trazabilidad": 15,
    "risk_weight_sobrecarga": 22,
    "risk_weight_vencidas_criticas": 18,
    "risk_weight_tendencia_negativa": 15,
    "risk_weight_horas_extra": 12,
    "risk_weight_baja_capacidad": 11,
    "risk_weight_variabilidad": 10,
    "risk_weight_concentracion": 7,
    "risk_weight_sin_planificacion": 5,
    "risk_threshold_medio": 31,
    "risk_threshold_alto": 61,
    "risk_threshold_critico": 81,
    "alert_overdue_task_threshold": 3,
    "alert_consecutive_overload_days": 3,
    "anomaly_variation_threshold_pct": 30,
    "cache_ttl_minutes": 15,
    "prediction_min_weeks_media": 2,
    "prediction_min_weeks_alta": 4,
}

_ANALYTICS_CONFIG_KEYS: dict[str, str] = {name: f"analytics_{name}" for name in ANALYTICS_CONFIG_DEFAULTS}


def get_effective_analytics_config(as_of: datetime) -> dict[str, float]:
    """Config completa del motor de Analytics vigente en `as_of` — réplica
    de `getEffectiveAnalyticsConfig`. Las 26 claves comparten el mismo
    mecanismo (`SystemConfigHistory`) que `get_effective_config_value`."""
    return {
        name: get_effective_config_value(key, as_of, ANALYTICS_CONFIG_DEFAULTS[name])
        for name, key in _ANALYTICS_CONFIG_KEYS.items()
    }


def set_analytics_config_value(name: str, value: float, actor) -> None:
    """Réplica de `setAnalyticsConfigValue` — `name` es la clave corta
    (ej. `"health_weight_cumplimiento"`, sin el prefijo `analytics_`),
    igual que recibe `get_effective_analytics_config`."""
    set_config_value(_ANALYTICS_CONFIG_KEYS[name], str(value), actor)


def set_config_value(key: str, value: str, actor) -> None:
    """Cierra el registro actualmente vigente (si hay) y crea uno nuevo —
    igual criterio que `setConfigValue` legacy. Sin endpoint HTTP en esta
    sub-fase (ver plan de Fase 3d); usado hoy solo por tests/fixtures."""
    now = timezone.now()
    with transaction.atomic():
        SystemConfigHistory.objects.filter(key=key, valid_until__isnull=True).update(valid_until=now)
        SystemConfigHistory.objects.create(key=key, value=value, valid_from=now, updated_by=actor)


def get_holiday_set() -> set[date]:
    return set(Holiday.objects.values_list("date", flat=True))


def is_business_day(d: date) -> bool:
    """Lunes a viernes."""
    return d.weekday() < 5


def is_working_day(d: date, holidays: set[date]) -> bool:
    return is_business_day(d) and d not in holidays


def count_business_days(start: date, end: date, holidays: set[date]) -> int:
    count = 0
    current = start
    while current <= end:
        if is_working_day(current, holidays):
            count += 1
        current += timedelta(days=1)
    return count


def business_base_for_range(start: date, end: date) -> dict:
    """Réplica de `businessBaseCore` — completada en la Fase 4a con los
    campos de límites que `MonthClosureService` (Fase 3d) no necesitaba
    (esa sub-fase solo leía `business_days`/`base_hours`/`hours_per_day`,
    que siguen presentes sin cambios). El valor de configuración vigente
    al INICIO del rango es el que rige (mismo criterio legacy: cambios
    posteriores no alteran cálculos de períodos ya transcurridos)."""
    holidays = get_holiday_set()
    business_days = count_business_days(start, end, holidays)
    as_of = datetime(start.year, start.month, start.day, tzinfo=dt_timezone.utc)
    hours_per_day = get_effective_horas_efectivas(as_of)
    limit_low_per_day = get_effective_workload_limit_low(as_of)
    limit_high_per_day = get_effective_workload_limit_high(as_of)
    limit_overload_per_day = get_effective_workload_limit_overload(as_of)
    base_hours = business_days * hours_per_day
    return {
        "business_days": business_days,
        "base_hours": base_hours,
        "hours_per_day": hours_per_day,
        "limit_low_per_day": limit_low_per_day,
        "limit_high_per_day": limit_high_per_day,
        "limit_overload_per_day": limit_overload_per_day,
        "limit_low_hours": business_days * limit_low_per_day,
        # Para el equipo global (sin estado especial) coincide siempre con
        # `base_hours` (mismo `hours_per_day`) — se expone aparte porque
        # futuras funciones por-usuario sí pueden diferenciarlo.
        "limit_base_hours": base_hours,
        "limit_high_hours": business_days * limit_high_per_day,
        "limit_overload_hours": business_days * limit_overload_per_day,
    }


# --- Permisos/ausencias (Fase 4a, ver docs/AUDIT_LOG.md § 2026-08-11) -------


def get_leave_minutes_by_day(user, range_start: date, range_end: date) -> dict[date, dict]:
    """Réplica 1:1 de `getLeaveMinutesByDay` — permisos de `user` por día
    dentro de `[range_start, range_end]`."""
    records = LeaveRecord.objects.filter(user=user, date__gte=range_start, date__lte=range_end)
    day_map: dict[date, dict] = {}
    for record in records:
        entry = day_map.setdefault(
            record.date,
            {
                "medico_minutes": 0, "medico_full_day": False,
                "personal_minutes": 0, "personal_full_day": False,
                "vacaciones_full_day": False,
            },
        )
        if record.type == LeaveRecord.Type.MEDICO:
            if record.is_full_day:
                entry["medico_full_day"] = True
            else:
                entry["medico_minutes"] += record.duration_minutes or 0
        elif record.type == LeaveRecord.Type.PERSONAL:
            if record.is_full_day:
                entry["personal_full_day"] = True
            else:
                entry["personal_minutes"] += record.duration_minutes or 0
        else:
            entry["vacaciones_full_day"] = True
    return day_map


def leave_hours_for_day(info: dict | None, hours_per_day: float) -> float:
    """Horas de base a descontar ese día por permisos — un día completo
    descuenta la base entera del día."""
    if not info:
        return 0.0
    if info["medico_full_day"] or info["personal_full_day"] or info["vacaciones_full_day"]:
        return hours_per_day
    hours = info["medico_minutes"] / 60 + info["personal_minutes"] / 60
    return min(hours, hours_per_day)


def total_leave_minutes(day_map: dict[date, dict], start: date, end: date, hours_per_day: float) -> dict:
    """Totales de minutos de permiso médico/personal/vacaciones en un
    rango — para el desglose del KPI mensual."""
    medico = personal = vacaciones = 0.0
    current = start
    while current <= end:
        info = day_map.get(current)
        if info:
            medico += hours_per_day * 60 if info["medico_full_day"] else info["medico_minutes"]
            personal += hours_per_day * 60 if info["personal_full_day"] else info["personal_minutes"]
            vacaciones += hours_per_day * 60 if info["vacaciones_full_day"] else 0
        current += timedelta(days=1)
    return {
        "medico_minutes": round_half_up(medico),
        "personal_minutes": round_half_up(personal),
        "vacaciones_minutes": round_half_up(vacaciones),
    }


# --- Estado especial de personal (Fase 4a) ----------------------------------


def _special_status_day_config(record: SpecialStatus) -> dict:
    return {
        "type": record.type,
        "daily_hours": record.daily_hours,
        "limit_low": record.limit_low,
        "limit_base": record.limit_base,
        "limit_high": record.limit_high,
        "limit_overload": record.limit_overload,
    }


def get_special_status_day_map(user, range_start: date, range_end: date) -> dict[date, dict]:
    """Réplica 1:1 de `getSpecialStatusDayMap` — días con estado especial
    vigente para `user` dentro de `[range_start, range_end]`, con su
    configuración por registro."""
    records = SpecialStatus.objects.filter(user=user, start_date__lte=range_end).filter(
        Q(end_date__isnull=True) | Q(end_date__gte=range_start)
    )
    day_map: dict[date, dict] = {}
    for record in records:
        day_from = max(record.start_date, range_start)
        day_to = min(record.end_date, range_end) if record.end_date else range_end
        config = _special_status_day_config(record)
        current = day_from
        while current <= day_to:
            day_map[current] = config
            current += timedelta(days=1)
    return day_map


def get_team_special_status_day_map(users, range_start: date, range_end: date) -> dict[int, dict[date, dict]]:
    """Igual que `get_special_status_day_map` pero para varios usuarios en
    una sola consulta — solo devuelve entradas para usuarios que
    realmente tienen algún estado especial superpuesto al rango."""
    user_ids = [u.id for u in users]
    if not user_ids:
        return {}
    records = SpecialStatus.objects.filter(user_id__in=user_ids, start_date__lte=range_end).filter(
        Q(end_date__isnull=True) | Q(end_date__gte=range_start)
    )
    by_user: dict[int, list[SpecialStatus]] = {}
    for record in records:
        by_user.setdefault(record.user_id, []).append(record)

    result: dict[int, dict[date, dict]] = {}
    for user_id, recs in by_user.items():
        day_map: dict[date, dict] = {}
        for record in recs:
            day_from = max(record.start_date, range_start)
            day_to = min(record.end_date, range_end) if record.end_date else range_end
            config = _special_status_day_config(record)
            current = day_from
            while current <= day_to:
                day_map[current] = config
                current += timedelta(days=1)
        result[user_id] = day_map
    return result
