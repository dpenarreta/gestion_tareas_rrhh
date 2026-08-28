"""Sub-fases 1, 2 y 3 del port del motor de CÁLCULO de Reportes
Ejecutivos — Fases 64/65/66 de la migración de stack (ver
docs/AUDIT_LOG.md § 2026-08-25/2026-08-26).

Réplica del bloque de `ReportMemberKpi` de `buildMonthlySnapshotData`,
`buildCustomRangeSnapshotData` y (parcialmente) `buildRangeSnapshotData`
(`src/lib/executiveReporting/buildSnapshotData.ts`) — la tabla/ranking
por colaborador de un Reporte Ejecutivo. `ReportMemberKpi` NO usa el
motor general de Analytics (`compute_performance_score`/
`compute_health_score`, ya portados y expuestos vía `/analytics/<id>/`
desde la Fase 57) — es lógica propia del reporte, con su propio score
(`compute_simple_score`, ya portado en `apps.analytics.scoring` desde
la Fase 4b) y su propia reconstrucción de "fecha de corte"
(`as_of_fecha_corte`, nueva en la Fase 64).

Deliberadamente SIN wiring a ningún endpoint HTTP todavía — mismo
criterio que usó el port original de KPIs/Analytics (Fases 4a/4d):
primero las primitivas puras + su assembler, probadas de forma
aislada; el cutover del `route.ts` real (`buildSnapshotData.ts`) queda
para una sub-fase futura, después de verificar campo por campo contra
el TS en un entorno con datos reales — un dato incorrecto acá tiene
impacto de auditoría/compliance (Reportes Ejecutivos), no solo de UI.

Cubre los builders MENSUAL (`compute_monthly_member_kpis`, Fase 64),
RANGO PERSONALIZADO (`compute_custom_range_member_kpis`, Fase 65) y
RANGO DE MESES — solo la parte de `ReportMemberKpi`/`MonthSnapshot[]`
(`compute_range_member_kpis`, Fase 66). **`compute_range_member_kpis`
NO replica el resto de `buildRangeSnapshotData`** — los ROLLUPS de
EQUIPO que ese builder calcula después de `aggregatedMembers`
(`riskQuadrant`/`findings`/`recommendations`/`insights`/
`consultasByReason`/`alerts`/`ranking`/`periodStatus`) dependen de
`src/lib/reportInsights.ts` (538 líneas, cuadrante de riesgo/
comparaciones de tendencia), que sigue sin portar — quedan
deliberadamente fuera de esta sub-fase, mismo criterio de alcance
mínimo que las Sub-fases 1/2."""

from copy import copy
from datetime import date, datetime, timedelta
from datetime import timezone as dt_timezone

from apps.analytics.health_score import classify_estado_operativo
from apps.analytics.history import compute_effective_history_start
from apps.analytics.scoring import (
    compute_completed_pct_any,
    compute_estimated_vs_real_ratio,
    compute_simple_score,
)
from apps.analytics.utils import is_task_overdue
from apps.analytics.workload import (
    compute_workload_pct,
    compute_workload_range,
    get_month_closure_period,
    monthly_business_base,
    monthly_business_base_for_users,
    sum_weighted_base_hours,
    sum_weighted_limit,
)
from apps.configuration.services import (
    business_base_for_range,
    get_holiday_set,
    get_team_special_status_day_map,
)
from apps.core.rounding import round_half_up
from apps.tasks.business_time import BUSINESS_TZ_OFFSET_HOURS, business_day_real_range
from apps.tasks.models import Task, TaskActivity
from apps.users.models import User


def _month_bounds(year: int, month: int) -> tuple[datetime, datetime]:
    # Duplicado deliberado de `apps.analytics.scoring._month_bounds` —
    # mismo criterio ya establecido ahí (evitar un import cruzado entre
    # apps solo por 3 líneas, ver ese docstring).
    next_year, next_month = (year + 1, 1) if month == 12 else (year, month + 1)
    start = datetime(year, month, 1, tzinfo=dt_timezone.utc)
    end = datetime(next_year, next_month, 1, tzinfo=dt_timezone.utc) - timedelta(microseconds=1)
    return start, end


def _local_month_bounds(year: int, month: int) -> tuple[datetime, datetime]:
    """Réplica de `monthBounds()` de TS (`buildSnapshotData.ts`) —
    a diferencia de `_month_bounds` (UTC puro), construye los límites
    del mes en hora LOCAL DEL NEGOCIO (`BUSINESS_TZ_OFFSET_HOURS`,
    igual que `business_day_real_range`). Hallazgo de la Fase 71 (ver
    docs/AUDIT_LOG.md § 2026-08-26): `new Date(year, month-1, 1)`/
    `new Date(year, month, 0, 23,59,59,999)` en TS interpretan esos
    componentes en la hora LOCAL del proceso de Next.js en producción
    (`America/Guayaquil`, UTC-5) — NO en UTC. Confirmado con
    verificación de datos sintéticos que **solo** el builder RANGO_MESES
    (`compute_range_member_kpis`) pasa el resultado de `monthBounds()`
    directamente a consultas de tareas/actividades y al prorrateo de
    base horaria — MENSUAL/RANGO_PERSONALIZADO derivan sus límites de
    otras fuentes ya en UTC explícito (`monthlyBusinessBase`/
    `Date.UTC`), verificados SIN esta divergencia. Úsese exclusivamente
    donde el TS use `monthBounds()` dentro de `buildRangeSnapshotData`
    — no reemplaza a `_month_bounds` en ningún otro lugar."""
    next_year, next_month = (year + 1, 1) if month == 12 else (year, month + 1)
    offset = timedelta(hours=BUSINESS_TZ_OFFSET_HOURS)
    start = datetime(year, month, 1, tzinfo=dt_timezone.utc) + offset
    end = datetime(next_year, next_month, 1, tzinfo=dt_timezone.utc) + offset - timedelta(microseconds=1)
    return start, end


def _ts_local_period_end_date(clamped_start_dt: datetime, period_end_instant: datetime) -> date:
    """Réplica EXACTA (bug incluido, deliberado) del límite final que
    usa el loop de pasos de 24h de `sumWeightedBaseHours`/
    `sumWeightedLimit` (TS, `workload.ts`) cuando `clamped_start_dt` no
    coincide con la hora del día de `period_end_instant` — hallazgo de
    la Fase 71 (ver docs/AUDIT_LOG.md § 2026-08-26). El loop de TS
    avanza en incrementos de EXACTAMENTE 24h desde `clampedStart.getTime()`
    mientras `t <= periodEnd.getTime()`; como `periodEnd` (vía
    `_local_month_bounds`) puede caer horas después de la medianoche
    UTC del día siguiente al fin de mes "natural", el último paso
    incluido puede ser 1 día calendario UTC más allá de
    `period_end_instant.date()` — pero SOLO si la hora del día de
    `clamped_start_dt` es tal que ese paso todavía cae dentro de
    `period_end_instant`. Es puramente aritmético (división entera de
    `timedelta`), no una aproximación: replica el resultado EXACTO del
    loop de TS para cualquier par de instantes, no solo el caso
    verificado."""
    if clamped_start_dt > period_end_instant:
        return clamped_start_dt.date()
    delta_days = (period_end_instant - clamped_start_dt) // timedelta(days=1)
    return (clamped_start_dt + timedelta(days=delta_days)).date()


def resolve_closure_cutoff(
    year: int, month: int, explicit_fecha_corte: datetime | None, fallback: datetime, now: datetime
) -> datetime:
    """Motor de Cierre Inteligente con Fecha de Corte — réplica exacta
    de `resolveClosureCutoff`. Un `fechaCorte` explícito SIEMPRE gana
    sobre el cierre; si el mes tiene un `MonthClosure`, su
    `cutoff_date` se vuelve el default (inmutable, no importa cuándo se
    genere el reporte); si no, se usa `fallback` (fin del período o
    `now`, lo que sea antes — decisión del caller)."""
    if explicit_fecha_corte:
        return min(explicit_fecha_corte, now)
    closure, _natural_end, _effective_end = get_month_closure_period(year, month)
    if closure:
        _start, cutoff_instant = business_day_real_range(closure.cutoff_date.date())
        return min(cutoff_instant, now)
    return min(fallback, now)


def as_of_fecha_corte(tasks: list[Task], cutoff: datetime) -> list[Task]:
    """Reconstruye el `status` de cada tarea "como era" en la fecha de
    corte — réplica exacta de `asOfFechaCorte`. NEXO no lleva historial
    de status por tarea (solo el status ACTUAL) — una tarea marcada
    COMPLETADA cuyo `completed_at` es POSTERIOR al corte se trata como
    si aún no estuviera completada (el más conservador, no sabemos cuál
    era su status real en ese instante). Vista de solo lectura para
    este cálculo — nunca persiste ni modifica la tarea real: opera
    sobre una copia superficial en memoria (`copy.copy`), nunca sobre
    la instancia original, y nunca llama a `.save()`. Solo aplica a
    `Task` — `TaskActivity` ya se acota directamente por
    `created_at`/`completed_at` en la consulta (son timestamps reales,
    sin ambigüedad). Recibe/devuelve instancias de `Task` (no dicts) a
    propósito — `compute_completed_pct_any`/`is_task_overdue`
    (funciones YA portadas y reutilizadas acá) esperan atributos, no
    claves de dict, mismo contrato que usan en el resto de
    `apps.analytics`."""
    result = []
    for t in tasks:
        if t.status == Task.Status.COMPLETADA and t.completed_at and t.completed_at > cutoff:
            copy_ = copy(t)
            copy_.status = Task.Status.PENDIENTE
            result.append(copy_)
        else:
            result.append(t)
    return result


def compute_effective_member_bases(
    users: list[User],
    period_start: date,
    period_end: date,
    hours_per_day: float,
    limit_low_per_day: float,
    limit_high_per_day: float,
    limit_overload_per_day: float,
    *,
    now: datetime,
    period_start_instant: datetime | None = None,
    period_end_instant: datetime | None = None,
) -> dict[int, dict]:
    """Prorratea la base horaria/límites para colaboradores nuevos a
    mitad de período — réplica exacta de `computeEffectiveMemberBases`.
    Reutiliza primitivas YA portadas: `compute_effective_history_start`
    (Fase 4d, `apps.analytics.history`), `sum_weighted_base_hours`/
    `sum_weighted_limit`/`get_team_special_status_day_map`/
    `get_holiday_set` (todas ya usadas por
    `monthly_business_base_for_users`). `leave_map` se pasa vacío en
    los 2 llamados a `sum_weighted_base_hours`, igual que el TS
    original (`new Map()` — los permisos individuales no forman parte
    de este prorrateo).

    `period_start_instant`/`period_end_instant` (Fase 71, ver
    docs/AUDIT_LOG.md § 2026-08-26) — opcionales, SOLO los pasa
    `compute_range_member_kpis` (builder RANGO_MESES), con los
    instantes exactos de `_local_month_bounds` (hora LOCAL del
    negocio, no UTC puro). Cuando se informan: (1) `period_start_instant`
    reemplaza la reconstrucción UTC-medianoche de `period_start` para
    la comparación `clamped_start_dt > period_start` (réplica de
    `effectiveStart.getTime() > periodStart.getTime()` en TS, donde
    `periodStart` YA es el instante desplazado, no una fecha
    reconstruida); (2) `period_end_instant` replica fielmente (bug
    incluido) el límite final EXACTO que usaría el loop de 24h de
    `sumWeightedBaseHours`/`sumWeightedLimit` en TS para CADA
    colaborador (`_ts_local_period_end_date`) — puede diferir por
    colaborador según la hora del día de su propio `clamped_start_dt`.
    Con ambos en `None` (default, MENSUAL/RANGO_PERSONALIZADO), el
    comportamiento es idéntico al existente desde la Fase 64."""
    result: dict[int, dict] = {}
    if not users:
        return result

    special_map = get_team_special_status_day_map(users, period_start, period_end)
    holidays = get_holiday_set()
    period_start_dt = period_start_instant or datetime(period_start.year, period_start.month, period_start.day, tzinfo=dt_timezone.utc)

    for user in users:
        effective_start = compute_effective_history_start(user=user, now=now)
        clamped_start_dt = effective_start if effective_start > period_start_dt else period_start_dt
        was_prorated = clamped_start_dt > period_start_dt
        clamped_start = clamped_start_dt.date()
        user_special_map = special_map.get(user.id, {})

        # El chequeo de "rango vacío" compara INSTANTES (réplica exacta de
        # `clampedStart.getTime() > periodEnd.getTime()`), nunca la fecha ya
        # ajustada por `_ts_local_period_end_date` — de otro modo un
        # `clamped_start_dt` posterior a `period_end_instant` nunca dispararía
        # esta rama (su propia fecha ajustada coincidiría trivialmente con la
        # de `clamped_start`).
        if period_end_instant is not None:
            is_empty_range = clamped_start_dt > period_end_instant
            user_period_end = _ts_local_period_end_date(clamped_start_dt, period_end_instant)
        else:
            is_empty_range = clamped_start > period_end
            user_period_end = period_end

        if is_empty_range:
            result[user.id] = {
                "base_hours": 0.0,
                "limit_base_hours": 0.0,
                "limit_low_hours": 0.0,
                "limit_high_hours": 0.0,
                "limit_overload_hours": 0.0,
                "effective_start": effective_start,
                "was_prorated": True,
            }
            continue

        base_hours = sum_weighted_base_hours(clamped_start, user_period_end, hours_per_day, holidays, {}, user_special_map, "daily_hours")
        limit_base_hours = sum_weighted_base_hours(clamped_start, user_period_end, hours_per_day, holidays, {}, user_special_map, "limit_base")
        limit_low_hours = sum_weighted_limit(clamped_start, user_period_end, holidays, user_special_map, limit_low_per_day, "limit_low")
        limit_high_hours = sum_weighted_limit(clamped_start, user_period_end, holidays, user_special_map, limit_high_per_day, "limit_high")
        limit_overload_hours = sum_weighted_limit(clamped_start, user_period_end, holidays, user_special_map, limit_overload_per_day, "limit_overload")
        result[user.id] = {
            "base_hours": base_hours,
            "limit_base_hours": limit_base_hours,
            "limit_low_hours": limit_low_hours,
            "limit_high_hours": limit_high_hours,
            "limit_overload_hours": limit_overload_hours,
            "effective_start": effective_start,
            "was_prorated": was_prorated,
        }
    return result


def compute_monthly_member_kpis(
    *,
    user_ids: list[int],
    year: int,
    month: int,
    explicit_fecha_corte: datetime | None = None,
    now: datetime | None = None,
) -> dict[int, dict]:
    """Assembler — réplica del bloque `ReportMemberKpi` de
    `buildMonthlySnapshotData` (solo builder MENSUAL, ver docstring del
    módulo). Devuelve un dict `{user_id: ReportMemberKpi-shaped dict}`
    — SIN `id`/`name`/`role` (esos ya los tiene el roster resuelto del
    lado de Next.js, que sigue llamando a `resolveRoster.ts`/Prisma en
    esta sub-fase — mismo patrón que `/analytics/<id>/`: Django calcula,
    el caller mergea con los datos de identidad que ya tiene)."""
    now = now or datetime.now(dt_timezone.utc)
    users = list(User.objects.filter(id__in=user_ids))
    if not users:
        return {}

    start, end = _month_bounds(year, month)
    cutoff = resolve_closure_cutoff(year, month, explicit_fecha_corte, end, now)
    data_upper_bound = min(end, cutoff)

    base = monthly_business_base(year, month)
    _closure, _natural_end, effective_end = get_month_closure_period(year, month)
    carga_start = date(year, month, 1)
    carga_end = effective_end
    carga_real_start, _ = business_day_real_range(carga_start)
    _, carga_real_end_raw = business_day_real_range(carga_end)
    carga_real_end = min(carga_real_end_raw, cutoff)

    effective_bases = compute_effective_member_bases(
        users, carga_start, carga_end, base["hours_per_day"], base["limit_low_per_day"], base["limit_high_per_day"], base["limit_overload_per_day"], now=now
    )

    all_tasks_raw = list(
        Task.objects.filter(assigned_to_id__in=user_ids, end_date__gte=start, end_date__lte=end).only(
            "assigned_to_id", "status", "end_date", "progress", "estimated_hours", "real_hours", "completed_at"
        )
    )
    all_activities = list(
        TaskActivity.objects.filter(
            author_id__in=user_ids, created_at__gte=start, created_at__lte=data_upper_bound, task__type=Task.Type.SEGUIMIENTO
        ).only("author_id", "reason", "duration")
    )
    fija_tasks_for_carga = list(
        Task.objects.filter(assigned_to_id__in=user_ids, type=Task.Type.FIJA, completed_at__gte=carga_real_start, completed_at__lte=carga_real_end).only(
            "assigned_to_id", "real_hours"
        )
    )
    activities_for_carga = list(
        TaskActivity.objects.filter(author_id__in=user_ids, created_at__gte=carga_real_start, created_at__lte=carga_real_end).only("author_id", "duration")
    )

    all_tasks = as_of_fecha_corte(all_tasks_raw, cutoff)
    ref_date = data_upper_bound

    result: dict[int, dict] = {}
    for user in users:
        tasks = [t for t in all_tasks if t.assigned_to_id == user.id]
        completed = sum(1 for t in tasks if t.status == Task.Status.COMPLETADA)
        overdue = sum(1 for t in tasks if is_task_overdue(t.end_date, t.status, ref_date))
        completed_pct = compute_completed_pct_any(tasks)

        fija_hours = sum(t.real_hours for t in fija_tasks_for_carga if t.assigned_to_id == user.id)
        activity_hours = sum(a.duration for a in activities_for_carga if a.author_id == user.id) / 60
        carga_real_hours = round_half_up((fija_hours + activity_hours) * 100) / 100
        user_base = effective_bases[user.id]
        carga_range = compute_workload_range(carga_real_hours, user_base["limit_base_hours"], user_base["limit_low_hours"], user_base["limit_high_hours"], user_base["limit_overload_hours"])
        carga_pct = compute_workload_pct(carga_real_hours, user_base["limit_base_hours"], carga_range["max"])

        in_progress = [t for t in tasks if t.status == Task.Status.EN_PROGRESO]
        avg_progress = round_half_up(sum(t.progress for t in in_progress) / len(in_progress)) if in_progress else 0

        total_estimated = sum(t.estimated_hours for t in tasks)
        total_real = sum(t.real_hours for t in tasks)
        carga_ratio = compute_estimated_vs_real_ratio(total_real, total_estimated)
        score = compute_simple_score(completed_pct, carga_ratio, avg_progress)

        user_activities = [a for a in all_activities if a.author_id == user.id]
        by_reason_map: dict[str, dict] = {}
        for act in user_activities:
            entry = by_reason_map.setdefault(act.reason, {"count": 0, "total_minutes": 0})
            entry["count"] += 1
            entry["total_minutes"] += act.duration

        result[user.id] = {
            "score": score,
            "completed_pct": completed_pct,
            "carga_pct": carga_pct,
            "carga_real_hours": carga_real_hours,
            "carga_base_hours": user_base["base_hours"],
            "carga_color": carga_range["color"],
            "carga_label": carga_range["label"],
            "carga_range_min": round_half_up(user_base["limit_base_hours"] * 100) / 100,
            "carga_range_max": carga_range["max"],
            "total_tasks": len(tasks),
            "completed_tasks": completed,
            "overdue_count": overdue,
            "seguimiento_total": len(user_activities),
            "by_reason": [{"reason": r, "count": d["count"], "total_minutes": d["total_minutes"]} for r, d in by_reason_map.items()],
            "base_was_prorated": user_base["was_prorated"],
            "base_effective_start": user_base["effective_start"].isoformat() if user_base["was_prorated"] else None,
        }

    return result


# ── Fase 65 — builder RANGO PERSONALIZADO ────────────────────────────────────

_CARGA_LABEL_SCORE: dict[str, int] = {
    "Óptimo": 100,
    "Moderado": 80,
    "Carga elevada": 60,
    "Subutilización": 30,
    "Sobrecarga": 30,
}


def derive_estado_operativo(
    *, completed_pct: float, carga_label: str, overdue_count: int, equilibrio_score: float | None = None
) -> dict:
    """Réplica de `deriveEstadoOperativo` (`src/lib/reportInsights.ts`) —
    aproxima el Equilibrio Operativo cuando no hay un score real
    disponible (reportes de rango, sin el bundle de Analytics del mes en
    curso). Reutiliza `classify_estado_operativo`, ya portado
    (`apps.analytics.health_score`, Fase 4e/4g)."""
    if equilibrio_score is not None:
        return classify_estado_operativo(equilibrio_score)
    vencidas_penalty = min(30, overdue_count * 10)
    approx_score = max(0, round_half_up(completed_pct * 0.5 + _CARGA_LABEL_SCORE[carga_label] * 0.5 - vencidas_penalty))
    return classify_estado_operativo(approx_score)


_PRINCIPAL_HALLAZGO_LABEL: dict[str, str] = {
    "sin_datos": "Sin actividad registrada",
    "sobrecarga": "Sobrecarga",
    "subutilizacion": "Subutilización",
    "capacidad_limitada": "Capacidad limitada",
    "retrasos_recurrentes": "Retrasos recurrentes",
    "consistencia_baja": "Consistencia baja",
    "sin_tareas_vencidas": "Sin tareas vencidas",
    "carga_equilibrada": "Carga equilibrada",
}


def compute_principal_hallazgo(
    *,
    carga_label: str,
    completed_pct: float,
    overdue_count: int,
    total_tasks: int,
    consistency_variable: bool | None = None,
    capacidad_limitada: bool | None = None,
) -> str:
    """Réplica exacta de `computePrincipalHallazgo`
    (`src/lib/reportInsights.ts`) — un único hallazgo predominante por
    colaborador, reglas fijas de mayor a menor severidad operativa."""
    if total_tasks == 0:
        return _PRINCIPAL_HALLAZGO_LABEL["sin_datos"]
    if carga_label == "Sobrecarga":
        return _PRINCIPAL_HALLAZGO_LABEL["sobrecarga"]
    if carga_label == "Subutilización":
        return _PRINCIPAL_HALLAZGO_LABEL["subutilizacion"]
    if capacidad_limitada:
        return _PRINCIPAL_HALLAZGO_LABEL["capacidad_limitada"]
    if overdue_count > 0:
        return _PRINCIPAL_HALLAZGO_LABEL["retrasos_recurrentes"]
    if consistency_variable:
        return _PRINCIPAL_HALLAZGO_LABEL["consistencia_baja"]
    if completed_pct >= 80:
        return _PRINCIPAL_HALLAZGO_LABEL["sin_tareas_vencidas"]
    return _PRINCIPAL_HALLAZGO_LABEL["carga_equilibrada"]


def compute_custom_range_member_kpis(
    *,
    user_ids: list[int],
    period_start: datetime,
    period_end: datetime,
    explicit_fecha_corte: datetime | None = None,
    now: datetime | None = None,
) -> dict[int, dict]:
    """Assembler — réplica del bloque `ReportMemberKpi` de
    `buildCustomRangeSnapshotData` (rango NO calendario — "Últimos 30
    días"/rango personalizado). A diferencia de
    `compute_monthly_member_kpis`, la fecha de corte NO usa
    `MonthClosure` (ese mecanismo es solo para meses calendario) —
    resolución más simple: `fechaCorte` explícita si se pasa, si no
    `period_end`, lo que sea anterior a `now`. Incluye
    `estado_operativo`/`principal_hallazgo` (ausentes en el builder
    mensual) — ver `derive_estado_operativo`/`compute_principal_hallazgo`
    arriba."""
    now = now or datetime.now(dt_timezone.utc)
    users = list(User.objects.filter(id__in=user_ids))
    if not users:
        return {}

    cutoff = min(explicit_fecha_corte, now) if explicit_fecha_corte else min(period_end, now)
    data_upper_bound = min(period_end, cutoff)

    base = business_base_for_range(period_start.date(), period_end.date())
    effective_bases = compute_effective_member_bases(
        users,
        period_start.date(),
        period_end.date(),
        base["hours_per_day"],
        base["limit_low_per_day"],
        base["limit_high_per_day"],
        base["limit_overload_per_day"],
        now=now,
    )
    carga_real_start, _ = business_day_real_range(period_start.date())
    _, carga_real_end_raw = business_day_real_range(period_end.date())
    carga_real_end = min(carga_real_end_raw, cutoff)

    all_tasks_raw = list(
        Task.objects.filter(assigned_to_id__in=user_ids, end_date__gte=period_start, end_date__lte=period_end).only(
            "assigned_to_id", "status", "end_date", "progress", "estimated_hours", "real_hours", "completed_at"
        )
    )
    all_activities = list(
        TaskActivity.objects.filter(
            author_id__in=user_ids, created_at__gte=period_start, created_at__lte=data_upper_bound, task__type=Task.Type.SEGUIMIENTO
        ).only("author_id", "reason", "duration")
    )
    fija_tasks_for_carga = list(
        Task.objects.filter(assigned_to_id__in=user_ids, type=Task.Type.FIJA, completed_at__gte=carga_real_start, completed_at__lte=carga_real_end).only(
            "assigned_to_id", "real_hours"
        )
    )
    activities_for_carga = list(
        TaskActivity.objects.filter(author_id__in=user_ids, created_at__gte=carga_real_start, created_at__lte=carga_real_end).only("author_id", "duration")
    )

    all_tasks = as_of_fecha_corte(all_tasks_raw, cutoff)
    ref_date = data_upper_bound

    result: dict[int, dict] = {}
    for user in users:
        tasks = [t for t in all_tasks if t.assigned_to_id == user.id]
        completed = sum(1 for t in tasks if t.status == Task.Status.COMPLETADA)
        overdue = sum(1 for t in tasks if is_task_overdue(t.end_date, t.status, ref_date))
        completed_pct = compute_completed_pct_any(tasks)

        fija_hours = sum(t.real_hours for t in fija_tasks_for_carga if t.assigned_to_id == user.id)
        activity_hours = sum(a.duration for a in activities_for_carga if a.author_id == user.id) / 60
        carga_real_hours = round_half_up((fija_hours + activity_hours) * 100) / 100
        user_base = effective_bases[user.id]
        carga_range = compute_workload_range(carga_real_hours, user_base["limit_base_hours"], user_base["limit_low_hours"], user_base["limit_high_hours"], user_base["limit_overload_hours"])
        carga_pct = compute_workload_pct(carga_real_hours, user_base["limit_base_hours"], carga_range["max"])

        in_progress = [t for t in tasks if t.status == Task.Status.EN_PROGRESO]
        avg_progress = round_half_up(sum(t.progress for t in in_progress) / len(in_progress)) if in_progress else 0
        total_estimated = sum(t.estimated_hours for t in tasks)
        total_real = sum(t.real_hours for t in tasks)
        carga_ratio = compute_estimated_vs_real_ratio(total_real, total_estimated)
        score = compute_simple_score(completed_pct, carga_ratio, avg_progress)

        user_activities = [a for a in all_activities if a.author_id == user.id]
        by_reason_map: dict[str, dict] = {}
        for act in user_activities:
            entry = by_reason_map.setdefault(act.reason, {"count": 0, "total_minutes": 0})
            entry["count"] += 1
            entry["total_minutes"] += act.duration

        estado_operativo = derive_estado_operativo(completed_pct=completed_pct, carga_label=carga_range["label"], overdue_count=overdue)
        principal_hallazgo = compute_principal_hallazgo(
            carga_label=carga_range["label"], completed_pct=completed_pct, overdue_count=overdue, total_tasks=len(tasks)
        )

        result[user.id] = {
            "score": score,
            "completed_pct": completed_pct,
            "carga_pct": carga_pct,
            "carga_real_hours": carga_real_hours,
            "carga_base_hours": user_base["base_hours"],
            "carga_color": carga_range["color"],
            "carga_label": carga_range["label"],
            "carga_range_min": round_half_up(user_base["limit_base_hours"] * 100) / 100,
            "carga_range_max": carga_range["max"],
            "total_tasks": len(tasks),
            "completed_tasks": completed,
            "overdue_count": overdue,
            "seguimiento_total": len(user_activities),
            "by_reason": [{"reason": r, "count": d["count"], "total_minutes": d["total_minutes"]} for r, d in by_reason_map.items()],
            "base_was_prorated": user_base["was_prorated"],
            "base_effective_start": user_base["effective_start"].isoformat() if user_base["was_prorated"] else None,
            "estado_operativo": estado_operativo,
            "principal_hallazgo": principal_hallazgo,
        }

    return result


# ── Fase 66 — builder RANGO DE MESES (solo ReportMemberKpi/MonthSnapshot) ────

_MONTH_NAMES = [
    "enero", "febrero", "marzo", "abril", "mayo", "junio",
    "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
]


def _month_label(year: int, month: int) -> str:
    # Duplicado deliberado de `apps.analytics.services._month_label_range`
    # (privada, mismo criterio que `_month_bounds` arriba — evitar un
    # import cruzado entre apps solo por 1 línea). Formato "{mes} de
    # {año}" — réplica de `monthLabelEs`/`Intl.DateTimeFormat('es-CL',
    # {month:'long', year:'numeric'})`.
    return f"{_MONTH_NAMES[month - 1]} de {year}"


def _months_in_range(from_year: int, from_month: int, to_year: int, to_month: int) -> list[tuple[int, int]]:
    """Réplica de `getMonthsInRange` — lista de `(year, month)` inclusive
    entre el inicio y el fin del rango."""
    months: list[tuple[int, int]] = []
    y, m = from_year, from_month
    while y < to_year or (y == to_year and m <= to_month):
        months.append((y, m))
        m += 1
        if m > 12:
            m = 1
            y += 1
    return months


def compute_range_member_kpis(
    *,
    user_ids: list[int],
    from_year: int,
    from_month: int,
    to_year: int,
    to_month: int,
    explicit_fecha_corte: datetime | None = None,
    now: datetime | None = None,
) -> dict:
    """Assembler — réplica PARCIAL de `buildRangeSnapshotData` (builder
    RANGO_MESES): solo el bloque de `ReportMemberKpi` por mes
    (`MonthSnapshot[]`, vía `monthSnapshots`) y agregado
    (`aggregatedMembers`) — ver docstring del módulo para lo que
    DELIBERADAMENTE queda fuera (rollups de equipo dependientes de
    `reportInsights.ts`, sin portar).

    Devuelve `{"month_snapshots": [...], "aggregated_members":
    {user_id: {...}}}`. A diferencia del TS (que arma `memberSnapshots`
    como array con `id`/`name`/`role` incluidos), acá cada
    `month_snapshots[i]["member_snapshots"]` es un dict `{user_id:
    {...}}` sin identidad — mismo criterio que `compute_monthly_member_kpis`/
    `compute_custom_range_member_kpis` (el roster resuelto del lado de
    Next.js ya tiene `id`/`name`/`role`). Tampoco se replica el "strip"
    de campos que hacía el TS antes de devolver `memberSnapshots` en la
    respuesta HTTP (quitaba `overdueCount`/`cargaRealHours`/
    `cargaBaseHours`) — sin wiring HTTP todavía, no hay payload que
    aligerar; se conservan todos los campos por fidelidad a los
    valores intermedios."""
    now = now or datetime.now(dt_timezone.utc)
    users = list(User.objects.filter(id__in=user_ids))
    if not users:
        return {"month_snapshots": [], "aggregated_members": {}}

    months = _months_in_range(from_year, from_month, to_year, to_month)
    # `_local_month_bounds` (no `_month_bounds`) — réplica de `monthBounds()`
    # de TS, hora LOCAL del negocio, no UTC puro. Fase 71 (ver
    # docs/AUDIT_LOG.md § 2026-08-26): este es el ÚNICO builder que pasa
    # el resultado de `monthBounds()` directamente a consultas de
    # tareas/actividades y al prorrateo de base horaria.
    range_start, _ = _local_month_bounds(from_year, from_month)
    _, range_end = _local_month_bounds(to_year, to_month)

    # El corte por defecto de un RANGO_MESES hereda el cierre del ÚLTIMO
    # mes del rango — réplica de `resolveClosureCutoff(toYear, toMonth, ...)`.
    cutoff = resolve_closure_cutoff(to_year, to_month, explicit_fecha_corte, range_end, now)
    data_upper_bound = min(range_end, cutoff)

    range_start_rate = monthly_business_base(from_year, from_month)
    effective_bases = compute_effective_member_bases(
        users, range_start.date(), range_end.date(),
        range_start_rate["hours_per_day"], range_start_rate["limit_low_per_day"],
        range_start_rate["limit_high_per_day"], range_start_rate["limit_overload_per_day"],
        now=now, period_start_instant=range_start, period_end_instant=range_end,
    )

    month_business_info = []
    for year, month in months:
        biz = monthly_business_base_for_users(users, year, month)
        shared = biz["shared"]
        real_start, _ = business_day_real_range(shared["start"])
        _, real_end = business_day_real_range(shared["end"])
        month_business_info.append({
            "year": year, "month": month, "shared": shared,
            "real_start": real_start, "real_end": real_end, "per_user": biz["per_user"],
        })

    def biz_for_user(biz_info: dict, user_id: int) -> dict:
        return biz_info["per_user"].get(user_id, biz_info["shared"])

    range_real_start = month_business_info[0]["real_start"]
    range_real_end = min(month_business_info[-1]["real_end"], cutoff)

    all_tasks_raw = list(
        Task.objects.filter(assigned_to_id__in=user_ids, end_date__gte=range_start, end_date__lte=range_end).only(
            "assigned_to_id", "status", "end_date", "progress", "estimated_hours", "real_hours", "completed_at"
        )
    )
    all_activities = list(
        TaskActivity.objects.filter(
            author_id__in=user_ids, created_at__gte=range_start, created_at__lte=data_upper_bound, task__type=Task.Type.SEGUIMIENTO
        ).only("author_id", "reason", "duration", "created_at")
    )
    fija_tasks_for_carga = list(
        Task.objects.filter(assigned_to_id__in=user_ids, type=Task.Type.FIJA, completed_at__gte=range_real_start, completed_at__lte=range_real_end).only(
            "assigned_to_id", "real_hours", "completed_at"
        )
    )
    activities_for_carga = list(
        TaskActivity.objects.filter(author_id__in=user_ids, created_at__gte=range_real_start, created_at__lte=range_real_end).only(
            "author_id", "duration", "created_at"
        )
    )

    all_tasks = as_of_fecha_corte(all_tasks_raw, cutoff)

    month_snapshots: list[dict] = []
    for biz_info in month_business_info:
        year, month = biz_info["year"], biz_info["month"]
        start, end = _local_month_bounds(year, month)
        ref_date = min(end, cutoff)

        month_tasks = [t for t in all_tasks if start <= t.end_date <= end]
        month_acts = [a for a in all_activities if start <= a.created_at <= end]
        month_fija = [t for t in fija_tasks_for_carga if biz_info["real_start"] <= t.completed_at <= biz_info["real_end"]]
        month_carga_acts = [a for a in activities_for_carga if biz_info["real_start"] <= a.created_at <= biz_info["real_end"]]

        member_snapshots: dict[int, dict] = {}
        for user in users:
            tasks = [t for t in month_tasks if t.assigned_to_id == user.id]
            completed_pct = compute_completed_pct_any(tasks)

            fija_hours = sum(t.real_hours for t in month_fija if t.assigned_to_id == user.id)
            activity_hours = sum(a.duration for a in month_carga_acts if a.author_id == user.id) / 60
            carga_real_hours = round_half_up((fija_hours + activity_hours) * 100) / 100
            user_biz = biz_for_user(biz_info, user.id)
            carga_range = compute_workload_range(carga_real_hours, user_biz["limit_base_hours"], user_biz["limit_low_hours"], user_biz["limit_high_hours"], user_biz["limit_overload_hours"])
            carga_pct = compute_workload_pct(carga_real_hours, user_biz["limit_base_hours"], carga_range["max"])

            in_progress = [t for t in tasks if t.status == Task.Status.EN_PROGRESO]
            avg_progress = round_half_up(sum(t.progress for t in in_progress) / len(in_progress)) if in_progress else 0
            overdue = sum(1 for t in tasks if is_task_overdue(t.end_date, t.status, ref_date))
            total_estimated = sum(t.estimated_hours for t in tasks)
            total_real = sum(t.real_hours for t in tasks)
            carga_ratio = compute_estimated_vs_real_ratio(total_real, total_estimated)
            score = compute_simple_score(completed_pct, carga_ratio, avg_progress)

            member_snapshots[user.id] = {
                "completed_pct": completed_pct,
                "carga_pct": carga_pct,
                "carga_real_hours": carga_real_hours,
                "carga_base_hours": user_biz["base_hours"],
                "carga_color": carga_range["color"],
                "carga_label": carga_range["label"],
                "score": score,
                "total_tasks": len(tasks),
                "overdue_count": overdue,
            }

        active_member_snapshots = [m for m in member_snapshots.values() if m["total_tasks"] > 0]
        team_avg_cumplimiento = round_half_up(sum(m["completed_pct"] for m in active_member_snapshots) / len(active_member_snapshots)) if active_member_snapshots else 0

        month_snapshots.append({
            "month": f"{year:04d}-{month:02d}",
            "label": _month_label(year, month),
            "team_avg_cumplimiento": team_avg_cumplimiento,
            "total_completed_tasks": sum(1 for t in month_tasks if t.status == Task.Status.COMPLETADA),
            "total_tasks": len(month_tasks),
            "total_carga_real_hours": round_half_up(sum(m["carga_real_hours"] for m in member_snapshots.values()) * 100) / 100,
            "total_carga_base_hours": round_half_up(sum(m["carga_base_hours"] for m in member_snapshots.values()) * 100) / 100,
            "total_consultas": len(month_acts),
            "member_snapshots": member_snapshots,
        })

    aggregated_members: dict[int, dict] = {}
    for user in users:
        user_tasks = [t for t in all_tasks if t.assigned_to_id == user.id]
        user_activities = [a for a in all_activities if a.author_id == user.id]
        completed_tasks = sum(1 for t in user_tasks if t.status == Task.Status.COMPLETADA)

        fija_hours = sum(t.real_hours for t in fija_tasks_for_carga if t.assigned_to_id == user.id)
        activity_hours = sum(a.duration for a in activities_for_carga if a.author_id == user.id) / 60
        carga_real_hours = round_half_up((fija_hours + activity_hours) * 100) / 100
        user_range_biz = effective_bases[user.id]
        carga_range = compute_workload_range(carga_real_hours, user_range_biz["limit_base_hours"], user_range_biz["limit_low_hours"], user_range_biz["limit_high_hours"], user_range_biz["limit_overload_hours"])
        carga_pct = compute_workload_pct(carga_real_hours, user_range_biz["limit_base_hours"], carga_range["max"])

        active_snaps = [ms for ms in month_snapshots if ms["member_snapshots"][user.id]["total_tasks"] > 0]
        avg_cumplimiento = round_half_up(sum(ms["member_snapshots"][user.id]["completed_pct"] for ms in active_snaps) / len(active_snaps)) if active_snaps else 0
        avg_score = round_half_up(sum(ms["member_snapshots"][user.id]["score"] for ms in active_snaps) / len(active_snaps)) if active_snaps else 0

        by_reason_map: dict[str, dict] = {}
        for act in user_activities:
            entry = by_reason_map.setdefault(act.reason, {"count": 0, "total_minutes": 0})
            entry["count"] += 1
            entry["total_minutes"] += act.duration

        # `overdue_count` fijo en 0 — réplica de una limitación preexistente
        # del TS original (`buildRangeSnapshotData`, comentario "no se
        # rastrea overdue por miembro en la agregación de rango"), no algo
        # introducido en este port.
        estado_operativo = derive_estado_operativo(completed_pct=avg_cumplimiento, carga_label=carga_range["label"], overdue_count=0)
        principal_hallazgo = compute_principal_hallazgo(
            carga_label=carga_range["label"], completed_pct=avg_cumplimiento, overdue_count=0, total_tasks=len(user_tasks)
        )

        aggregated_members[user.id] = {
            "score": avg_score,
            "completed_pct": avg_cumplimiento,
            "carga_pct": carga_pct,
            "carga_real_hours": carga_real_hours,
            "carga_base_hours": user_range_biz["base_hours"],
            "carga_color": carga_range["color"],
            "carga_label": carga_range["label"],
            "carga_range_min": round_half_up(user_range_biz["limit_base_hours"] * 100) / 100,
            "carga_range_max": carga_range["max"],
            "total_tasks": len(user_tasks),
            "completed_tasks": completed_tasks,
            "overdue_count": 0,
            "seguimiento_total": len(user_activities),
            "by_reason": [{"reason": r, "count": d["count"], "total_minutes": d["total_minutes"]} for r, d in by_reason_map.items()],
            "base_was_prorated": user_range_biz["was_prorated"],
            "base_effective_start": user_range_biz["effective_start"].isoformat() if user_range_biz["was_prorated"] else None,
            "estado_operativo": estado_operativo,
            "principal_hallazgo": principal_hallazgo,
        }

    return {"month_snapshots": month_snapshots, "aggregated_members": aggregated_members}
