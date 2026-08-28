"""Histórico mensual/semanal y tendencias — Fase 4d (ver
docs/AUDIT_LOG.md § 2026-08-11). Réplica exacta de las funciones de
historial de `src/lib/analytics.ts` (base de Consistencia, Anomalías,
Riesgo Operativo y Predicción — ninguna de esas 4 piezas se porta en
esta sub-fase, solo su cimiento)."""

from datetime import date, datetime, timedelta
from datetime import timezone as dt_timezone

from apps.configuration.services import (
    count_business_days,
    get_effective_horas_efectivas,
    get_holiday_set,
    get_leave_minutes_by_day,
    is_business_day,
    is_working_day,
)
from apps.core.rounding import round_half_up
from apps.tasks.business_time import business_calendar_day, business_day_real_range
from apps.tasks.models import MonthClosure, Task, TaskActivity

from .scoring import compute_completed_pct_any
from .services import _month_bounds, _shift_month
from .utils import is_task_overdue
from .workload import _utc_week_start, get_month_closure_period, monthly_business_base

_MONTH_ABBR = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"]

NO_HISTORY = {"available": False, "reason": "Sin historial suficiente"}


def _month_key(year: int, month: int) -> str:
    return f"{year}-{month:02d}"


def _month_label(year: int, month: int) -> str:
    return f"{_MONTH_ABBR[month - 1]}. {year % 100:02d}"


def _avg_of(values: list[float]) -> float | None:
    return sum(values) / len(values) if values else None


def _stddev(values: list[float]) -> dict:
    """`{mean, sd, cv}` — réplica exacta de `stddev`. `cv` en 0 si la
    media es 0 (evita división por cero)."""
    mean = sum(values) / len(values)
    variance = sum((v - mean) ** 2 for v in values) / len(values)
    sd = variance**0.5
    cv = (sd / abs(mean)) * 100 if mean != 0 else 0
    return {"mean": mean, "sd": sd, "cv": cv}


def _effective_month_end_datetime(year: int, month: int, natural_end: datetime) -> datetime:
    """`biz.end` en la terminología legacy — el corte de mes (`MonthClosure`)
    si hay uno anterior al fin de mes natural, si no `natural_end`."""
    closure = MonthClosure.objects.filter(year=year, month=month).first()
    if closure and closure.cutoff_date < natural_end:
        return closure.cutoff_date
    return natural_end


def compute_monthly_history(*, user, months_back: int = 6, now: datetime) -> list[dict]:
    """Últimos `months_back` meses (incluye el actual, en curso) —
    réplica exacta de `computeMonthlyHistory`."""
    today = business_calendar_day(now)
    months = [_shift_month(today.year, today.month, -(months_back - 1 - i)) for i in range(months_back)]

    month_bounds_list = [_month_bounds(yy, mm) for yy, mm in months]
    biz_starts_ends = []
    for yy, mm in months:
        start_date = date(yy, mm, 1)
        _, _, effective_end_date = get_month_closure_period(yy, mm)
        biz_starts_ends.append((start_date, effective_end_date))
    biz_by_month = [monthly_business_base(yy, mm) for yy, mm in months]

    range_start = month_bounds_list[0][0]
    range_end = month_bounds_list[-1][1]
    real_start, _ = business_day_real_range(biz_starts_ends[0][0])
    _, real_end = business_day_real_range(biz_starts_ends[-1][1])

    tasks = list(
        Task.objects.filter(assigned_to=user, end_date__gte=range_start, end_date__lte=range_end).only(
            "end_date", "status", "priority"
        )
    )
    fija_tasks = list(
        Task.objects.filter(
            assigned_to=user, type=Task.Type.FIJA, archived_month__isnull=True,
            completed_at__gte=real_start, completed_at__lte=real_end,
        ).only("completed_at", "real_hours")
    )
    activities = list(
        TaskActivity.objects.filter(
            author=user, created_at__gte=real_start, created_at__lte=real_end
        ).select_related("task").only("created_at", "duration", "task__type")
    )

    result = []
    for i, (yy, mm) in enumerate(months):
        start, end = month_bounds_list[i]
        biz = biz_by_month[i]
        biz_start_date, biz_end_date = biz_starts_ends[i]
        m_real_start, _ = business_day_real_range(biz_start_date)
        _, m_real_end = business_day_real_range(biz_end_date)
        effective_end = _effective_month_end_datetime(yy, mm, end)

        month_tasks = [t for t in tasks if start <= t.end_date <= effective_end]
        overdue = [t for t in month_tasks if is_task_overdue(t.end_date, t.status, now)]
        overdue_alta = sum(1 for t in overdue if t.priority == Task.Priority.ALTA)

        month_fija = [t for t in fija_tasks if m_real_start <= t.completed_at <= m_real_end]
        month_acts = [a for a in activities if m_real_start <= a.created_at <= m_real_end]
        fija_hours = sum(t.real_hours for t in month_fija)
        act_hours = sum(a.duration for a in month_acts) / 60
        carga_real_hours = round_half_up(fija_hours + act_hours, 2)

        weekend_hours = 0.0
        current = biz_start_date
        while current <= biz_end_date:
            if not is_business_day(current):
                ds, de = business_day_real_range(current)
                day_fija = sum(t.real_hours for t in month_fija if ds <= t.completed_at <= de)
                day_act = sum(a.duration for a in month_acts if ds <= a.created_at <= de) / 60
                weekend_hours += day_fija + day_act
            current += timedelta(days=1)

        seguimiento_count = sum(1 for a in month_acts if a.task.type == Task.Type.SEGUIMIENTO)

        result.append(
            {
                "month": _month_key(yy, mm),
                "label": _month_label(yy, mm),
                "total_tasks": len(month_tasks),
                "completed_pct": compute_completed_pct_any(month_tasks),
                "overdue_count": len(overdue),
                "overdue_alta_count": overdue_alta,
                "carga_real_hours": carga_real_hours,
                "carga_base_hours": biz["base_hours"],
                "carga_pct": round_half_up(carga_real_hours / biz["limit_base_hours"] * 100) if biz["limit_base_hours"] > 0 else 0,
                "weekend_hours": round_half_up(weekend_hours, 2),
                "seguimiento_count": seguimiento_count,
            }
        )
    return result


def compute_weekly_history(*, user, weeks_back: int = 6, now: datetime) -> list[dict]:
    """Últimas `weeks_back` semanas COMPLETAS (lunes-viernes ya
    transcurridos) — la semana en curso se excluye. Réplica exacta de
    `computeWeeklyHistory`, incluyendo su límite [inicio, viernes
    00:00 UTC) al filtrar tareas por `end_date` (no incluye el viernes
    completo) — mismo comportamiento legacy, no un bug a corregir."""
    today = business_calendar_day(now)
    current_week_start_date = _utc_week_start(today)
    current_week_start = datetime(
        current_week_start_date.year, current_week_start_date.month, current_week_start_date.day, tzinfo=dt_timezone.utc
    )
    weeks = []
    for i in range(weeks_back):
        start = current_week_start - timedelta(days=(weeks_back - i) * 7)
        end = start + timedelta(days=4)
        weeks.append((start, end))

    holidays = get_holiday_set()
    hours_per_day = get_effective_horas_efectivas(now)
    range_start = weeks[0][0]
    range_end = weeks[-1][1]
    real_start, _ = business_day_real_range(range_start.date())
    _, real_end = business_day_real_range(range_end.date())

    tasks = list(
        Task.objects.filter(assigned_to=user, end_date__gte=range_start, end_date__lte=range_end).only(
            "end_date", "status"
        )
    )
    fija_tasks = list(
        Task.objects.filter(
            assigned_to=user, type=Task.Type.FIJA, archived_month__isnull=True,
            completed_at__gte=real_start, completed_at__lte=real_end,
        ).only("completed_at", "real_hours")
    )
    activities = list(
        TaskActivity.objects.filter(author=user, created_at__gte=real_start, created_at__lte=real_end).only(
            "created_at", "duration"
        )
    )

    result = []
    for i, (start, end) in enumerate(weeks):
        business_days = count_business_days(start.date(), end.date(), holidays)
        week_tasks = [t for t in tasks if start <= t.end_date <= end]
        completed = sum(1 for t in week_tasks if t.status == Task.Status.COMPLETADA)

        real_hours = 0.0
        days_with_registration = 0
        current = start
        while current <= end:
            if is_working_day(current.date(), holidays):
                ds, de = business_day_real_range(current.date())
                day_fija = sum(t.real_hours for t in fija_tasks if ds <= t.completed_at <= de)
                day_act = sum(a.duration for a in activities if ds <= a.created_at <= de) / 60
                day_hours = day_fija + day_act
                real_hours += day_hours
                if day_hours > 0:
                    days_with_registration += 1
            current += timedelta(days=1)

        result.append(
            {
                "week_start": start.date().isoformat(),
                "label": f"Sem {i + 1}",
                "business_days": business_days,
                "real_hours": round_half_up(real_hours, 2),
                "base_hours": round_half_up(business_days * hours_per_day, 2),
                "total_tasks": len(week_tasks),
                "completed_tasks": completed,
                "completed_pct": compute_completed_pct_any(week_tasks),
                "days_with_registration": days_with_registration,
            }
        )
    return result


def _compute_trend_generic(current: float, compared: float | None, higher_is_better: bool) -> dict:
    if compared is None:
        return dict(NO_HISTORY)
    absolute_diff = round_half_up(current - compared, 2)
    pct_diff = round_half_up((absolute_diff / abs(compared)) * 1000) / 10 if compared != 0 else 0
    improved = absolute_diff > 0.5 if higher_is_better else absolute_diff < -0.5
    worsened = absolute_diff < -0.5 if higher_is_better else absolute_diff > 0.5
    direction = "mejora" if improved else ("empeoro" if worsened else "estable")
    return {"available": True, "direction": direction, "absolute_diff": absolute_diff, "pct_diff": pct_diff, "current": current, "compared": compared}


def _compute_carga_trend(current: float, compared: float | None) -> dict:
    """Para carga laboral no hay dirección monótona "mejor" — "mejora" =
    se acercó al 100% (base); "empeoró" = se alejó."""
    if compared is None:
        return dict(NO_HISTORY)
    absolute_diff = round_half_up(current - compared, 2)
    pct_diff = round_half_up((absolute_diff / abs(compared)) * 1000) / 10 if compared != 0 else 0
    current_deviation = abs(current - 100)
    compared_deviation = abs(compared - 100)
    if current_deviation < compared_deviation - 1:
        direction = "mejora"
    elif current_deviation > compared_deviation + 1:
        direction = "empeoro"
    else:
        direction = "estable"
    return {"available": True, "direction": direction, "absolute_diff": absolute_diff, "pct_diff": pct_diff, "current": current, "compared": compared}


def compute_trends(*, user, now: datetime) -> dict:
    """Réplica exacta de `computeTrends`."""
    monthly = compute_monthly_history(user=user, months_back=6, now=now)
    weekly = compute_weekly_history(user=user, weeks_back=6, now=now)

    current_month = monthly[-1]
    prev_month = monthly[-2] if len(monthly) >= 2 else None
    prior_months = [m for m in monthly[:-1] if m["total_tasks"] > 0]
    prior_months_carga = [m for m in monthly[:-1] if m["carga_real_hours"] > 0 or m["carga_base_hours"] > 0]

    last_week = weekly[-1] if weekly else None
    prev_week = weekly[-2] if len(weekly) >= 2 else None
    last_week_carga_pct = (
        round_half_up(last_week["real_hours"] / last_week["base_hours"] * 100) if last_week and last_week["base_hours"] > 0 else None
    )
    prev_week_carga_pct = (
        round_half_up(prev_week["real_hours"] / prev_week["base_hours"] * 100) if prev_week and prev_week["base_hours"] > 0 else None
    )

    cumplimiento_semana = (
        _compute_trend_generic(last_week["completed_pct"], prev_week["completed_pct"], True)
        if last_week and prev_week and last_week["total_tasks"] > 0 and prev_week["total_tasks"] > 0
        else dict(NO_HISTORY)
    )
    cumplimiento_mes = (
        _compute_trend_generic(current_month["completed_pct"], prev_month["completed_pct"], True)
        if prev_month and current_month["total_tasks"] > 0 and prev_month["total_tasks"] > 0
        else dict(NO_HISTORY)
    )
    cumplimiento_promedio = (
        _compute_trend_generic(current_month["completed_pct"], _avg_of([m["completed_pct"] for m in prior_months]), True)
        if current_month["total_tasks"] > 0
        else dict(NO_HISTORY)
    )

    carga_semana = (
        _compute_carga_trend(last_week_carga_pct, prev_week_carga_pct)
        if last_week_carga_pct is not None and prev_week_carga_pct is not None
        else dict(NO_HISTORY)
    )
    carga_mes = (
        _compute_carga_trend(current_month["carga_pct"], prev_month["carga_pct"])
        if prev_month and prev_month["carga_base_hours"] > 0
        else dict(NO_HISTORY)
    )
    carga_promedio = (
        _compute_carga_trend(current_month["carga_pct"], _avg_of([m["carga_pct"] for m in prior_months_carga]))
        if current_month["carga_base_hours"] > 0
        else dict(NO_HISTORY)
    )

    return {
        "cumplimiento": {"semana_anterior": cumplimiento_semana, "mes_anterior": cumplimiento_mes, "promedio_6_meses": cumplimiento_promedio},
        "carga": {"semana_anterior": carga_semana, "mes_anterior": carga_mes, "promedio_6_meses": carga_promedio},
    }


def compute_effective_history_start(*, user, now: datetime) -> datetime:
    """Fecha efectiva desde la que existe historial real para este
    usuario — réplica exacta de `computeEffectiveHistoryStart`. Nunca
    `None`: si no hay ninguna señal, devuelve `now`."""
    first_activity = TaskActivity.objects.filter(author=user).order_by("created_at").only("created_at").first()
    first_completed_task = (
        Task.objects.filter(assigned_to=user, status=Task.Status.COMPLETADA, completed_at__isnull=False)
        .order_by("completed_at").only("completed_at").first()
    )
    first_hour_imputation = (
        Task.objects.filter(assigned_to=user, real_hours__gt=0, completed_at__isnull=False)
        .order_by("completed_at").only("completed_at").first()
    )

    candidates: list[datetime] = []
    if first_activity is not None:
        candidates.append(first_activity.created_at)
    if first_completed_task is not None:
        candidates.append(first_completed_task.completed_at)
    if first_hour_imputation is not None:
        candidates.append(first_hour_imputation.completed_at)
    if user.kpi_start_date:
        candidates.append(user.kpi_start_date)
    if user.created_at:
        candidates.append(user.created_at)

    if not candidates:
        return now
    return max(candidates)


# --- Consistencia (corregida en Analytics Engine v1.3.1) --------------------
# El motor NO debe asumir que existen semanas anteriores al inicio real de
# los registros de un colaborador — antes se contaban como "con base
# laboral pero cero horas", inflando artificialmente el CV.

# Semanas hacia atrás consultadas — mayor que el resto del motor (6) para
# poder alcanzar el tramo ">12 semanas" de confiabilidad muy alta; el
# filtrado por historial válido decide cuántas de esas se usan realmente.
CONSISTENCY_LOOKBACK_WEEKS = 16
CONSISTENCY_MIN_WEEKS = 2

_CV_INTERPRETATION = {
    "muy-consistente": "Variabilidad muy baja entre semanas.",
    "consistente": "Variabilidad baja entre semanas.",
    "variable": "Variabilidad moderada entre semanas.",
    "muy-variable": "Variabilidad alta entre semanas.",
}

_CONSISTENCY_IMPACT_NOTE = {
    "muy-consistente": None,
    "consistente": None,
    "variable": "reduciendo la estabilidad operativa",
    "muy-variable": "afectando significativamente la previsibilidad operativa",
}


def consistency_level_from_cv(avg_cv: float) -> dict:
    """Clasificación categórica a partir del CV promedio (%) — función
    pura, réplica exacta de `consistencyLevelFromCv`."""
    if avg_cv < 10:
        return {"level": "muy-consistente", "label": "Muy consistente"}
    if avg_cv < 20:
        return {"level": "consistente", "label": "Consistente"}
    if avg_cv < 35:
        return {"level": "variable", "label": "Variable"}
    return {"level": "muy-variable", "label": "Muy variable"}


def consistency_pct_from_cv(avg_cv: float) -> float:
    """consistencia = 100 / (1 + CV_fraction) — siempre en (0,100],
    función pura, réplica exacta de `consistencyPctFromCv`."""
    return round_half_up((100 / (1 + avg_cv / 100)) * 10) / 10


def consistency_reliability_from_weeks(weeks: int) -> dict:
    """Confiabilidad de la muestra — depende SOLO del tamaño: 2-4
    semanas baja, 5-8 media, 9-12 alta, >12 muy alta. Función pura,
    réplica exacta de `consistencyReliabilityFromWeeks`."""
    if weeks <= 4:
        return {"level": "baja", "stars": 2, "label": "Confiabilidad baja"}
    if weeks <= 8:
        return {"level": "media", "stars": 3, "label": "Confiabilidad media"}
    if weeks <= 12:
        return {"level": "alta", "stars": 4, "label": "Confiabilidad alta"}
    return {"level": "muy-alta", "stars": 5, "label": "Confiabilidad muy alta"}


def _pluralize(n: int, singular: str, plural: str) -> str:
    return singular if n == 1 else plural


def compute_consistency(*, user, now: datetime) -> dict:
    """Réplica exacta de `computeConsistency` — excluye semanas
    anteriores al inicio efectivo del historial, sin base laboral, sin
    registro, o ancladas por permiso/vacaciones de día completo."""
    range_end = business_calendar_day(now)
    range_start = range_end - timedelta(days=CONSISTENCY_LOOKBACK_WEEKS * 7)

    weekly = compute_weekly_history(user=user, weeks_back=CONSISTENCY_LOOKBACK_WEEKS, now=now)
    effective_start = compute_effective_history_start(user=user, now=now)
    leave_map = get_leave_minutes_by_day(user, range_start, range_end)
    holidays = get_holiday_set()

    periods_excluded: list[dict] = []
    valid_weeks: list[dict] = []

    for w in weekly:
        week_start_date = date.fromisoformat(w["week_start"])
        week_end_date = week_start_date + timedelta(days=4)
        week_end_dt = datetime(week_end_date.year, week_end_date.month, week_end_date.day, tzinfo=dt_timezone.utc)
        period = f"Semana del {w['week_start']}"

        if week_end_dt < effective_start:
            periods_excluded.append({"period": period, "reason": "Anterior al inicio efectivo del historial"})
            continue
        if w["business_days"] == 0:
            periods_excluded.append({"period": period, "reason": "Sin base laboral esa semana (feriados/fin de semana)"})
            continue
        if w["days_with_registration"] == 0:
            periods_excluded.append({"period": period, "reason": "Sin registros esa semana"})
            continue

        fully_on_leave = True
        current = week_start_date
        while current <= week_end_date:
            if is_working_day(current, holidays):
                info = leave_map.get(current)
                if not info or not (info["medico_full_day"] or info["personal_full_day"] or info["vacaciones_full_day"]):
                    fully_on_leave = False
                    break
            current += timedelta(days=1)
        if fully_on_leave:
            periods_excluded.append({"period": period, "reason": "Semana anulada por vacaciones o permiso de día completo"})
            continue

        valid_weeks.append(w)

    if len(valid_weeks) < CONSISTENCY_MIN_WEEKS:
        days_analyzed = sum(w["days_with_registration"] for w in valid_weeks)
        reason = (
            f"Historial insuficiente ({days_analyzed} {_pluralize(days_analyzed, 'día', 'días')} con datos)"
            if days_analyzed > 0
            else "Historial insuficiente"
        )
        return {"available": False, "reason": reason}

    hours_mean = _stddev([w["real_hours"] for w in valid_weeks])["mean"]
    if hours_mean <= 0:
        return {"available": False, "reason": "Historial insuficiente para evaluar consistencia."}

    hours_cv = _stddev([w["real_hours"] for w in valid_weeks])["cv"]
    tasks_cv = _stddev([w["completed_tasks"] for w in valid_weeks])["cv"]
    compliance_cv = _stddev([w["completed_pct"] for w in valid_weeks])["cv"]
    avg_cv = (hours_cv + tasks_cv + compliance_cv) / 3

    level_info = consistency_level_from_cv(avg_cv)
    level, label = level_info["level"], level_info["label"]
    consistency_pct = consistency_pct_from_cv(avg_cv)
    reliability = consistency_reliability_from_weeks(len(valid_weeks))
    days_analyzed = sum(w["days_with_registration"] for w in valid_weeks)
    periods_used = [f"Semana del {w['week_start']}" for w in valid_weeks]

    steps = [f"Semanas válidas utilizadas: {', '.join(periods_used)}"]
    if periods_excluded:
        steps.append("Semanas excluidas: " + "; ".join(f"{p['period']} ({p['reason']})" for p in periods_excluded))
    steps.append(f"CV = promedio(CV horas, CV tareas completadas, CV cumplimiento) = {round_half_up(avg_cv * 10) / 10}%")
    steps.append(f"Consistencia = 100 / (1 + CV) = {consistency_pct}%")

    return {
        "available": True,
        "level": level,
        "label": label,
        "coefficient_of_variation": round_half_up(avg_cv * 10) / 10,
        "consistency_pct": consistency_pct,
        "weeks_analyzed": len(valid_weeks),
        "days_analyzed": days_analyzed,
        "interpretation": _CV_INTERPRETATION[level],
        "reliability": reliability,
        "explain": {
            "formula": "CV = promedio(CV horas, CV tareas completadas, CV cumplimiento) — calculado solo sobre semanas con datos válidos",
            "periods_used": periods_used,
            "periods_excluded": periods_excluded,
            "steps": steps,
            "impact_note": _CONSISTENCY_IMPACT_NOTE[level],
        },
    }
