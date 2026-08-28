"""Base horaria del motor de KPIs/Analytics — Fase 4a (base pura, ver
docs/AUDIT_LOG.md § 2026-08-11) completada en la Fase 4b (ver
docs/AUDIT_LOG.md § 2026-08-11) con `compute_carga_tiempo`/
`compute_carga_history`/`redact_sensitive_workload_detail`, que ya
consultan `Task`/`TaskActivity`. Portado de `src/lib/workload.ts`."""

from datetime import date, datetime, timedelta

from django.db.models import Sum

from apps.configuration.services import (
    business_base_for_range,
    count_business_days,
    get_effective_horas_efectivas,
    get_effective_workload_limit_high,
    get_effective_workload_limit_low,
    get_effective_workload_limit_overload,
    get_holiday_set,
    get_leave_minutes_by_day,
    get_special_status_day_map,
    get_team_special_status_day_map,
    is_business_day,
    is_working_day,
    leave_hours_for_day,
    total_leave_minutes,
)
from apps.core.rounding import round_half_up
from apps.tasks.business_time import business_calendar_day, business_day_real_range
from apps.tasks.models import MonthClosure, Task, TaskActivity

_MONTH_NAMES = [
    "enero", "febrero", "marzo", "abril", "mayo", "junio",
    "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
]


def sum_weighted_base_hours(
    start: date,
    end: date,
    hours_per_day: float,
    holidays: set[date],
    leave_map: dict[date, dict],
    special_map: dict[date, dict] | None = None,
    field: str = "daily_hours",
) -> float:
    """Suma, día a día, una base "leave-aware" (horas por día - permisos
    ese día) de los días laborables del rango — réplica 1:1 de
    `sumWeightedBaseHours`. `field` decide qué usar como horas del día en
    días con estado especial vigente (`daily_hours` para la base de
    exhibición, `limit_base` para el umbral real de clasificación)."""
    special_map = special_map or {}
    total = 0.0
    current = start
    while current <= end:
        if is_working_day(current, holidays):
            cfg = special_map.get(current)
            day_value = cfg[field] if cfg else hours_per_day
            leave_hours = leave_hours_for_day(leave_map.get(current), day_value)
            total += max(0.0, day_value - leave_hours)
        current += timedelta(days=1)
    return round_half_up(total, 2)


def sum_weighted_limit(
    start: date,
    end: date,
    holidays: set[date],
    special_map: dict[date, dict],
    global_limit_per_day: float,
    field: str,
) -> float:
    """Suma, día a día, uno de los 3 límites externos del semáforo (low/
    high/overload, NUNCA ajustados por permisos) de los días laborables
    del rango — réplica 1:1 de `sumWeightedLimit`."""
    total = 0.0
    current = start
    while current <= end:
        if is_working_day(current, holidays):
            cfg = special_map.get(current)
            total += cfg[field] if cfg else global_limit_per_day
        current += timedelta(days=1)
    return round_half_up(total, 2)


def compute_workload_range(
    real_hours: float, base_hours: float, limit_low: float, limit_high: float, limit_overload: float
) -> dict:
    """Semáforo de carga laboral por RANGO, 5 zonas — réplica 1:1 de
    `computeWorkloadRange`:
      Subutilización: real_hours <  limit_low
      Moderado:       limit_low <= real_hours < base_hours
      Óptimo:         base_hours <= real_hours <= limit_high
      Carga elevada:  limit_high <  real_hours <= limit_overload
      Sobrecarga:     real_hours > limit_overload
    """
    if base_hours <= 0:
        if real_hours > 0:
            return {"min": 0, "max": 0, "elevated_max": 0, "color": "orange", "label": "Carga elevada"}
        return {"min": 0, "max": 0, "elevated_max": 0, "color": "green", "label": "Óptimo"}

    min_ = round_half_up(limit_low, 2)
    max_ = round_half_up(limit_high, 2)
    elevated_max = round_half_up(limit_overload, 2)
    if real_hours < min_:
        return {"min": min_, "max": max_, "elevated_max": elevated_max, "color": "red", "label": "Subutilización"}
    if real_hours < base_hours:
        return {"min": min_, "max": max_, "elevated_max": elevated_max, "color": "yellow", "label": "Moderado"}
    if real_hours <= max_:
        return {"min": min_, "max": max_, "elevated_max": elevated_max, "color": "green", "label": "Óptimo"}
    if real_hours <= elevated_max:
        return {"min": min_, "max": max_, "elevated_max": elevated_max, "color": "orange", "label": "Carga elevada"}
    return {"min": min_, "max": max_, "elevated_max": elevated_max, "color": "red", "label": "Sobrecarga"}


def compute_workload_pct(real_hours: float, base_hours: float, optimal_max: float) -> int:
    """Porcentaje de carga con techo en 100% dentro del rango óptimo —
    réplica 1:1 de `computeWorkloadPct`."""
    if base_hours <= 0:
        return 0
    if real_hours <= base_hours:
        return round_half_up(real_hours / base_hours * 100)
    if real_hours <= optimal_max:
        return 100
    if optimal_max <= 0:
        return 100
    return round_half_up(100 + (real_hours - optimal_max) / optimal_max * 100)


def get_month_closure_period(year: int, month: int) -> tuple[MonthClosure | None, date, date]:
    """Réplica de `getMonthClosurePeriod` — si `(year, month)` tiene un
    `MonthClosure` con corte anticipado (EARLY/MANUAL), `effective_end` es
    `closure.cutoff_date`; si no, el último día calendario del mes.
    Devuelve `(closure, natural_end, effective_end)`."""
    next_month, next_year = (1, year + 1) if month == 12 else (month + 1, year)
    natural_end = date(next_year, next_month, 1) - timedelta(days=1)
    closure = MonthClosure.objects.filter(year=year, month=month).first()
    effective_end = closure.cutoff_date.date() if closure else natural_end
    return closure, natural_end, effective_end


def monthly_business_base(year: int, month: int) -> dict:
    """Motor de Cierre Inteligente con Fecha de Corte — réplica de
    `monthlyBusinessBase`: si el mes tiene un cierre con corte anticipado,
    el rango de cálculo se trunca a esa fecha, sin cambiar la firma
    pública. Un mes sin cierre formal, o cerrado en el último día
    (`closure_type` NORMAL), se comporta igual que antes de este motor."""
    start = date(year, month, 1)
    _, _, effective_end = get_month_closure_period(year, month)
    return business_base_for_range(start, effective_end)


def monthly_business_base_for_users(users, year: int, month: int) -> dict:
    """Variante multi-usuario de `monthly_business_base` — réplica de
    `monthlyBusinessBaseForUsers`: si alguno de `users` tiene un
    `SpecialStatus` (maternidad/lactancia) vigente en `(year, month)`,
    su base/límites se recalculan con la configuración de ese estado en
    vez de la global, sin afectar al resto del equipo (`shared`).
    Devuelve `{"shared": dict, "per_user": {user_id: dict}}` — usado por
    `/kpis/me/range` (Fase 4c, ver docs/AUDIT_LOG.md § 2026-08-11) para
    que el semáforo de carga por rango respete un estado especial de
    ESTE usuario, algo que `monthly_business_base` (global) no puede
    diferenciar por usuario."""
    start = date(year, month, 1)
    _, _, effective_end = get_month_closure_period(year, month)
    # `business_base_for_range` no incluye `start`/`end` (nunca los
    # necesitó ningún consumidor hasta ahora, ver Fase 3d/4a) — este
    # caller sí (los reusa para `business_day_real_range`), se agregan
    # aquí sobre una copia local.
    shared = {**business_base_for_range(start, effective_end), "start": start, "end": effective_end}
    per_user: dict[int, dict] = {}

    team_special_map = get_team_special_status_day_map(users, start, effective_end)
    if not team_special_map:
        return {"shared": shared, "per_user": per_user}

    holidays = get_holiday_set()
    for user_id, day_map in team_special_map.items():
        if not day_map:
            continue
        base_hours = sum_weighted_base_hours(start, effective_end, shared["hours_per_day"], holidays, {}, day_map, "daily_hours")
        limit_base_hours = sum_weighted_base_hours(start, effective_end, shared["hours_per_day"], holidays, {}, day_map, "limit_base")
        limit_low_hours = sum_weighted_limit(start, effective_end, holidays, day_map, shared["limit_low_per_day"], "limit_low")
        limit_high_hours = sum_weighted_limit(start, effective_end, holidays, day_map, shared["limit_high_per_day"], "limit_high")
        limit_overload_hours = sum_weighted_limit(start, effective_end, holidays, day_map, shared["limit_overload_per_day"], "limit_overload")
        per_user[user_id] = {
            **shared,
            "base_hours": base_hours,
            "limit_base_hours": limit_base_hours,
            "limit_low_hours": limit_low_hours,
            "limit_high_hours": limit_high_hours,
            "limit_overload_hours": limit_overload_hours,
        }
    return {"shared": shared, "per_user": per_user}


# --- Helpers de calendario (Fase 4b) -----------------------------------------


def _utc_week_start(d: date) -> date:
    return d - timedelta(days=d.weekday())


def _utc_week_end(d: date) -> date:
    return _utc_week_start(d) + timedelta(days=6)


def _utc_month_start(d: date) -> date:
    return d.replace(day=1)


def _utc_month_end(d: date) -> date:
    next_month, next_year = (1, d.year + 1) if d.month == 12 else (d.month + 1, d.year)
    return date(next_year, next_month, 1) - timedelta(days=1)


def _first_business_day(start: date, end: date, holidays: set[date]) -> date | None:
    current = start
    while current <= end:
        if is_working_day(current, holidays):
            return current
        current += timedelta(days=1)
    return None


def _last_business_day(start: date, end: date, holidays: set[date]) -> date | None:
    current = end
    while current >= start:
        if is_working_day(current, holidays):
            return current
        current -= timedelta(days=1)
    return None


def _special_status_type_in_range(special_map: dict[date, dict], start: date, end: date) -> str | None:
    current = start
    while current <= end:
        cfg = special_map.get(current)
        if cfg:
            return cfg["type"]
        current += timedelta(days=1)
    return None


def _format_short_date(d: date) -> str:
    return f"{d.day:02d}/{d.month:02d}"


def _format_month_label(d: date) -> str:
    return f"{_MONTH_NAMES[d.month - 1]} {d.year}"


# --- Horas reales (consultan Task/TaskActivity — Fase 4b) --------------------


def _real_hours_in_window(user, cal_start: date, cal_end: date) -> float:
    real_start, _ = business_day_real_range(cal_start)
    _, real_end = business_day_real_range(cal_end)
    fija_hours = (
        Task.objects.filter(
            assigned_to=user, type=Task.Type.FIJA, archived_month__isnull=True,
            completed_at__gte=real_start, completed_at__lte=real_end,
        ).aggregate(total=Sum("real_hours"))["total"]
        or 0
    )
    activity_minutes = (
        TaskActivity.objects.filter(
            author=user, created_at__gte=real_start, created_at__lte=real_end,
        ).aggregate(total=Sum("duration"))["total"]
        or 0
    )
    return round_half_up(fija_hours + activity_minutes / 60, 2)


def _weekend_hours_in_range(user, range_start: date, range_end: date) -> float:
    """Suma solo las horas reales de los días sábado/domingo dentro del
    rango."""
    total = 0.0
    current = range_start
    while current <= range_end:
        if not is_business_day(current):
            total += _real_hours_in_window(user, current, current)
        current += timedelta(days=1)
    return round_half_up(total, 2)


def _holiday_hours_in_range(user, range_start: date, range_end: date, holidays: set[date]) -> float:
    """Suma solo las horas reales de días feriados que NO caen en fin de
    semana (para no duplicar con `_weekend_hours_in_range`)."""
    total = 0.0
    current = range_start
    while current <= range_end:
        if is_business_day(current) and current in holidays:
            total += _real_hours_in_window(user, current, current)
        current += timedelta(days=1)
    return round_half_up(total, 2)


def _to_metric(
    real_hours: float, base_hours: float, classification_base: float, hours_per_day: float,
    limit_low: float, limit_high: float, limit_overload: float,
) -> dict:
    """`base_hours` es la base de exhibición (horas objetivo); `classification_base`
    es el umbral real de clasificación Moderado/Óptimo — para todo período
    sin estado especial ambos valores son idénticos."""
    range_ = compute_workload_range(real_hours, classification_base, limit_low, limit_high, limit_overload)
    pct = (
        compute_workload_pct(real_hours, classification_base, range_["max"])
        if classification_base > 0
        else (round_half_up(real_hours / hours_per_day * 100) if hours_per_day else 0)
    )
    return {
        "real_hours": real_hours,
        "base_hours": base_hours,
        "pct": pct,
        "color": range_["color"],
        "range_min": round_half_up(classification_base, 2) if classification_base > 0 else 0,
        "range_max": range_["max"],
        "label": range_["label"],
        "is_weekend": False,
    }


def compute_carga_tiempo(*, user, now: datetime) -> dict:
    """Snapshot diaria/semanal/mensual de carga laboral — réplica función
    por función de `computeCargaTiempo`. Sensible a permisos/estado
    especial vigente HOY (factor proporcional sobre toda la envolvente
    del día) y al ajuste puntual `User.kpi_start_date`.
    `daily_history`/`weekly_history` quedan vacíos aquí (los llena
    `compute_carga_history` aparte, mismo criterio de costo que el
    legacy). `sensitive_detail_visible=True` siempre — la redacción es
    responsabilidad del caller (ver `redact_sensitive_workload_detail`)."""
    today = business_calendar_day(now)
    month_start = _utc_month_start(today)
    month_end = _utc_month_end(today)

    week_start_raw = _utc_week_start(today)
    week_end_raw = _utc_week_end(today)
    week_start = max(week_start_raw, month_start)
    week_end = min(week_end_raw, month_end)

    hours_per_day = get_effective_horas_efectivas(now)
    limit_low_per_day = get_effective_workload_limit_low(now)
    limit_high_per_day = get_effective_workload_limit_high(now)
    limit_overload_per_day = get_effective_workload_limit_overload(now)
    holidays = get_holiday_set()
    leave_map = get_leave_minutes_by_day(user, month_start, month_end)
    special_map = get_special_status_day_map(user, month_start, month_end)

    kpi_start_day = user.kpi_start_date.date() if user.kpi_start_date else None
    kpi_start_applies = kpi_start_day is not None and kpi_start_day > month_start
    effective_month_start = kpi_start_day if kpi_start_applies else month_start
    effective_week_start = kpi_start_day if (kpi_start_day and kpi_start_day > week_start) else week_start

    today_is_weekend = not is_business_day(today)
    today_is_holiday = not today_is_weekend and today in holidays
    today_leave_info = leave_map.get(today)
    today_cfg = special_map.get(today)
    today_special_status_type = today_cfg["type"] if today_cfg else None

    today_daily_hours = today_cfg["daily_hours"] if today_cfg else hours_per_day
    today_classification_base = today_cfg["limit_base"] if today_cfg else hours_per_day
    today_limit_low_per_day = today_cfg["limit_low"] if today_cfg else limit_low_per_day
    today_limit_high_per_day = today_cfg["limit_high"] if today_cfg else limit_high_per_day
    today_limit_overload_per_day = today_cfg["limit_overload"] if today_cfg else limit_overload_per_day
    today_leave_hours = leave_hours_for_day(today_leave_info, today_daily_hours)
    day_factor = max(0.0, 1 - today_leave_hours / today_daily_hours) if today_daily_hours > 0 else 1.0
    daily_base_hours = 0.0 if (today_is_weekend or today_is_holiday) else today_daily_hours * day_factor
    daily_classification_base = today_classification_base * day_factor
    daily_limit_low = today_limit_low_per_day * day_factor
    daily_limit_high = today_limit_high_per_day * day_factor
    daily_limit_overload = today_limit_overload_per_day * day_factor

    weekly_business_days = count_business_days(effective_week_start, week_end, holidays)
    weekly_base_hours = sum_weighted_base_hours(
        effective_week_start, week_end, hours_per_day, holidays, leave_map, special_map, "daily_hours"
    )
    weekly_classification_base = sum_weighted_base_hours(
        effective_week_start, week_end, hours_per_day, holidays, leave_map, special_map, "limit_base"
    )
    weekly_limit_low_hours = sum_weighted_limit(effective_week_start, week_end, holidays, special_map, limit_low_per_day, "limit_low")
    weekly_limit_high_hours = sum_weighted_limit(effective_week_start, week_end, holidays, special_map, limit_high_per_day, "limit_high")
    weekly_limit_overload_hours = sum_weighted_limit(
        effective_week_start, week_end, holidays, special_map, limit_overload_per_day, "limit_overload"
    )
    weekly_special_status_type = _special_status_type_in_range(special_map, effective_week_start, week_end)

    monthly_business_days = count_business_days(effective_month_start, month_end, holidays)
    monthly_base_hours = sum_weighted_base_hours(
        effective_month_start, month_end, hours_per_day, holidays, leave_map, special_map, "daily_hours"
    )
    monthly_classification_base = sum_weighted_base_hours(
        effective_month_start, month_end, hours_per_day, holidays, leave_map, special_map, "limit_base"
    )
    monthly_limit_low_hours = sum_weighted_limit(effective_month_start, month_end, holidays, special_map, limit_low_per_day, "limit_low")
    monthly_limit_high_hours = sum_weighted_limit(effective_month_start, month_end, holidays, special_map, limit_high_per_day, "limit_high")
    monthly_limit_overload_hours = sum_weighted_limit(
        effective_month_start, month_end, holidays, special_map, limit_overload_per_day, "limit_overload"
    )
    monthly_special_status_type = _special_status_type_in_range(special_map, effective_month_start, month_end)

    diaria_hours = _real_hours_in_window(user, today, today)
    semanal_hours = _real_hours_in_window(user, effective_week_start, week_end)
    mensual_hours = _real_hours_in_window(user, effective_month_start, month_end)
    weekend_hours = _weekend_hours_in_range(user, effective_week_start, week_end)
    monthly_weekend_hours = _weekend_hours_in_range(user, effective_month_start, month_end)
    monthly_holiday_hours = _holiday_hours_in_range(user, effective_month_start, month_end, holidays)
    monthly_leave_totals = total_leave_minutes(leave_map, effective_month_start, month_end, hours_per_day)

    week_biz_start = _first_business_day(week_start, week_end, holidays) or week_start
    week_biz_end = _last_business_day(week_start, week_end, holidays) or week_end

    leave_fields = {
        "medico_leave_minutes": today_leave_info["medico_minutes"] if today_leave_info else 0,
        "medico_leave_full_day": today_leave_info["medico_full_day"] if today_leave_info else False,
        "personal_leave_minutes": today_leave_info["personal_minutes"] if today_leave_info else 0,
        "personal_leave_full_day": today_leave_info["personal_full_day"] if today_leave_info else False,
        "vacaciones_full_day": today_leave_info["vacaciones_full_day"] if today_leave_info else False,
        "special_status_type": today_special_status_type,
    }

    if today_is_weekend or today_is_holiday:
        diaria_metric = {
            "real_hours": diaria_hours, "base_hours": 0, "pct": 0, "color": "green",
            "range_min": 0, "range_max": 0, "label": "Óptimo",
            "is_weekend": today_is_weekend, "is_holiday": today_is_holiday,
            **leave_fields,
        }
    else:
        diaria_metric = {
            **_to_metric(
                diaria_hours, daily_base_hours, daily_classification_base, today_daily_hours,
                daily_limit_low, daily_limit_high, daily_limit_overload,
            ),
            "is_holiday": False,
            **leave_fields,
        }

    return {
        "diaria": diaria_metric,
        "semanal": {
            **_to_metric(
                semanal_hours, weekly_base_hours, weekly_classification_base, hours_per_day,
                weekly_limit_low_hours, weekly_limit_high_hours, weekly_limit_overload_hours,
            ),
            "week_start_label": _format_short_date(week_biz_start),
            "week_end_label": _format_short_date(week_biz_end),
            "business_days": weekly_business_days,
            "weekend_hours": weekend_hours,
            "special_status_type": weekly_special_status_type,
        },
        "mensual": {
            **_to_metric(
                mensual_hours, monthly_base_hours, monthly_classification_base, hours_per_day,
                monthly_limit_low_hours, monthly_limit_high_hours, monthly_limit_overload_hours,
            ),
            "month_label": _format_month_label(today),
            "business_days": monthly_business_days,
            "weekend_hours": monthly_weekend_hours,
            "holiday_hours": monthly_holiday_hours,
            "medico_leave_minutes": monthly_leave_totals["medico_minutes"],
            "personal_leave_minutes": monthly_leave_totals["personal_minutes"],
            "vacaciones_minutes": monthly_leave_totals["vacaciones_minutes"],
            "special_status_type": monthly_special_status_type,
        },
        "horas_efectivas_por_dia": hours_per_day,
        "workload_limit_low": limit_low_per_day,
        "workload_limit_high": limit_high_per_day,
        "workload_limit_overload": limit_overload_per_day,
        "effective_hours_per_dia": today_daily_hours,
        "effective_limit_low": today_limit_low_per_day,
        "effective_limit_base": today_classification_base,
        "effective_limit_high": today_limit_high_per_day,
        "effective_limit_overload": today_limit_overload_per_day,
        "kpi_start_date": user.kpi_start_date.isoformat() if kpi_start_applies else None,
        "daily_history": [],
        "weekly_history": [],
        "sensitive_detail_visible": True,
    }


def compute_carga_history(*, user, now: datetime) -> dict:
    """Histórico diario/semanal para los gráficos — réplica de
    `computeCargaHistory`: todos los días del mes en curso desde
    `kpi_start_date`/día 1 hasta HOY (nunca futuro), y las semanas del
    mes en curso hasta la semana de hoy."""
    today = business_calendar_day(now)
    month_start = _utc_month_start(today)
    hours_per_day = get_effective_horas_efectivas(now)
    limit_low_per_day = get_effective_workload_limit_low(now)
    limit_high_per_day = get_effective_workload_limit_high(now)
    limit_overload_per_day = get_effective_workload_limit_overload(now)
    holidays = get_holiday_set()

    kpi_start_day = user.kpi_start_date.date() if user.kpi_start_date else None
    effective_month_start = kpi_start_day if (kpi_start_day and kpi_start_day > month_start) else month_start
    range_end = today

    daily: list[dict] = []
    if effective_month_start <= range_end:
        leave_map = get_leave_minutes_by_day(user, effective_month_start, range_end)
        daily_special_map = get_special_status_day_map(user, effective_month_start, range_end)
        daily_real_start, _ = business_day_real_range(effective_month_start)
        _, daily_real_end = business_day_real_range(range_end)

        daily_fija_tasks = list(
            Task.objects.filter(
                assigned_to=user, type=Task.Type.FIJA, archived_month__isnull=True,
                completed_at__gte=daily_real_start, completed_at__lte=daily_real_end,
            ).values("completed_at", "real_hours")
        )
        daily_activities = list(
            TaskActivity.objects.filter(
                author=user, created_at__gte=daily_real_start, created_at__lte=daily_real_end,
            ).values("created_at", "duration")
        )

        def real_hours_for_day(day: date) -> float:
            start, end = business_day_real_range(day)
            fija_hours = sum(t["real_hours"] for t in daily_fija_tasks if start <= t["completed_at"] <= end)
            activity_hours = sum(a["duration"] for a in daily_activities if start <= a["created_at"] <= end) / 60
            return round_half_up(fija_hours + activity_hours, 2)

        current = effective_month_start
        while current <= range_end:
            real_hours = real_hours_for_day(current)
            day_cfg = daily_special_map.get(current)
            base = {
                "date": current.isoformat(),
                "day_label": _format_short_date(current),
                "special_status_type": day_cfg["type"] if day_cfg else None,
            }

            if not is_business_day(current):
                if real_hours > 0:
                    daily.append(
                        {**base, "real_hours": real_hours, "base_hours": 0, "color": "orange",
                         "label": "Carga elevada", "kind": "weekend-extra"}
                    )
                current += timedelta(days=1)
                continue

            if current in holidays:
                daily.append(
                    {**base, "real_hours": real_hours, "base_hours": 0, "color": "green",
                     "label": "Óptimo", "kind": "holiday"}
                )
                current += timedelta(days=1)
                continue

            leave_info = leave_map.get(current)
            if leave_info and leave_info["medico_full_day"]:
                daily.append({**base, "real_hours": real_hours, "base_hours": 0, "color": "green", "label": "Óptimo", "kind": "leave-medico"})
                current += timedelta(days=1)
                continue
            if leave_info and leave_info["personal_full_day"]:
                daily.append({**base, "real_hours": real_hours, "base_hours": 0, "color": "green", "label": "Óptimo", "kind": "leave-personal"})
                current += timedelta(days=1)
                continue
            if leave_info and leave_info["vacaciones_full_day"]:
                daily.append({**base, "real_hours": real_hours, "base_hours": 0, "color": "green", "label": "Óptimo", "kind": "leave-vacaciones"})
                current += timedelta(days=1)
                continue

            day_daily_hours = day_cfg["daily_hours"] if day_cfg else hours_per_day
            day_classification_base = day_cfg["limit_base"] if day_cfg else hours_per_day
            day_limit_low = day_cfg["limit_low"] if day_cfg else limit_low_per_day
            day_limit_high = day_cfg["limit_high"] if day_cfg else limit_high_per_day
            day_limit_overload = day_cfg["limit_overload"] if day_cfg else limit_overload_per_day
            leave_hours = leave_hours_for_day(leave_info, day_daily_hours)
            day_factor = max(0.0, 1 - leave_hours / day_daily_hours) if day_daily_hours > 0 else 1.0
            day_base_hours = day_daily_hours * day_factor
            day_class_base = day_classification_base * day_factor
            range_ = compute_workload_range(
                real_hours, day_class_base, day_limit_low * day_factor, day_limit_high * day_factor,
                day_limit_overload * day_factor,
            )
            is_empty = real_hours == 0 and leave_hours == 0
            daily.append(
                {**base, "real_hours": real_hours, "base_hours": day_base_hours,
                 "color": range_["color"], "label": range_["label"], "kind": "empty" if is_empty else "normal"}
            )
            current += timedelta(days=1)

    # --- Semanal: semanas del mes en curso, hasta la semana de hoy ----------
    month_end = _utc_month_end(today)
    floored_month_start = effective_month_start
    week_slices: list[tuple[date, date]] = []
    cursor = floored_month_start
    while cursor <= month_end and cursor <= today:
        week_start_raw = _utc_week_start(cursor)
        week_end_raw = _utc_week_end(cursor)
        slice_start = max(week_start_raw, floored_month_start)
        slice_end = min(min(week_end_raw, month_end), today)
        week_slices.append((slice_start, slice_end))
        cursor = week_end_raw + timedelta(days=1)

    if not week_slices:
        return {"daily": daily, "weekly": []}

    weekly_range_start = week_slices[0][0]
    weekly_range_end = week_slices[-1][1]
    weekly_real_start, _ = business_day_real_range(weekly_range_start)
    _, weekly_real_end = business_day_real_range(weekly_range_end)
    weekly_special_map = get_special_status_day_map(user, weekly_range_start, weekly_range_end)

    weekly_fija_tasks = list(
        Task.objects.filter(
            assigned_to=user, type=Task.Type.FIJA, archived_month__isnull=True,
            completed_at__gte=weekly_real_start, completed_at__lte=weekly_real_end,
        ).values("completed_at", "real_hours")
    )
    weekly_activities = list(
        TaskActivity.objects.filter(
            author=user, created_at__gte=weekly_real_start, created_at__lte=weekly_real_end,
        ).values("created_at", "duration")
    )

    weekly: list[dict] = []
    for index, (slice_start, slice_end) in enumerate(week_slices):
        base_hours = sum_weighted_base_hours(slice_start, slice_end, hours_per_day, holidays, {}, weekly_special_map, "daily_hours")
        classification_base = sum_weighted_base_hours(slice_start, slice_end, hours_per_day, holidays, {}, weekly_special_map, "limit_base")
        limit_low_hours = sum_weighted_limit(slice_start, slice_end, holidays, weekly_special_map, limit_low_per_day, "limit_low")
        limit_high_hours = sum_weighted_limit(slice_start, slice_end, holidays, weekly_special_map, limit_high_per_day, "limit_high")
        limit_overload_hours = sum_weighted_limit(slice_start, slice_end, holidays, weekly_special_map, limit_overload_per_day, "limit_overload")
        real_start, _ = business_day_real_range(slice_start)
        _, real_end = business_day_real_range(slice_end)
        fija_hours = sum(t["real_hours"] for t in weekly_fija_tasks if real_start <= t["completed_at"] <= real_end)
        activity_hours = sum(a["duration"] for a in weekly_activities if real_start <= a["created_at"] <= real_end) / 60
        real_hours = round_half_up(fija_hours + activity_hours, 2)
        range_ = compute_workload_range(real_hours, classification_base, limit_low_hours, limit_high_hours, limit_overload_hours)
        weekly.append(
            {
                "week_label": f"Sem {index + 1}",
                "real_hours": real_hours,
                "base_hours": round_half_up(base_hours, 2),
                "color": range_["color"],
                "label": range_["label"],
                "special_status_type": _special_status_type_in_range(weekly_special_map, slice_start, slice_end),
            }
        )

    return {"daily": daily, "weekly": weekly}


def redact_sensitive_workload_detail(carga_tiempo: dict) -> dict:
    """Reduce el detalle de tipo de permiso/estado especial a un
    indicador genérico de "ausencia justificada" — para viewers que no
    son el propio titular ni el Administrador (Art. 26 LOPDP). Réplica
    exacta de `redactSensitiveWorkloadDetail`."""
    diaria = carga_tiempo["diaria"]
    diaria_leave_minutes = (diaria.get("medico_leave_minutes") or 0) + (diaria.get("personal_leave_minutes") or 0)
    diaria_full_day = (
        diaria.get("medico_leave_full_day", False)
        or diaria.get("personal_leave_full_day", False)
        or diaria.get("vacaciones_full_day", False)
    )

    mensual = carga_tiempo["mensual"]
    mensual_leave_minutes = (
        (mensual.get("medico_leave_minutes") or 0)
        + (mensual.get("personal_leave_minutes") or 0)
        + (mensual.get("vacaciones_minutes") or 0)
    )

    leave_kinds = {"leave-medico", "leave-personal", "leave-vacaciones"}
    return {
        **carga_tiempo,
        "diaria": {
            **diaria,
            "medico_leave_minutes": 0,
            "medico_leave_full_day": False,
            "personal_leave_minutes": diaria_leave_minutes,
            "personal_leave_full_day": diaria_full_day,
            "vacaciones_full_day": False,
            "special_status_type": None,
        },
        "semanal": {**carga_tiempo["semanal"], "special_status_type": None},
        "mensual": {
            **mensual,
            "medico_leave_minutes": 0,
            "personal_leave_minutes": mensual_leave_minutes,
            "vacaciones_minutes": 0,
            "special_status_type": None,
        },
        "daily_history": [
            {**p, "special_status_type": None, "kind": "leave-generic" if p["kind"] in leave_kinds else p["kind"]}
            for p in carga_tiempo["daily_history"]
        ],
        "weekly_history": [{**p, "special_status_type": None} for p in carga_tiempo["weekly_history"]],
        "sensitive_detail_visible": False,
    }
