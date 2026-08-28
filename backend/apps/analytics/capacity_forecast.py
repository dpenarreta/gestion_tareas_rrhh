"""Capacidad Proyectada — Fase 4f (ver docs/AUDIT_LOG.md § 2026-08-11).
Réplica exacta de `src/lib/capacityForecast.ts`: capacidad disponible
para asumir NUEVAS tareas — proyección hacia adelante (desde ahora
hasta fin de mes), no un balance del mes ya transcurrido (a diferencia
de `compute_carga_tiempo.mensual`, que mide cuánto de la base mensual
completa queda por debajo del límite óptimo)."""

from datetime import date, datetime, timedelta
from datetime import timezone as dt_timezone

from apps.configuration.models import Holiday, LeaveRecord
from apps.configuration.services import (
    count_business_days,
    get_effective_horas_efectivas,
    get_effective_workday_end_hour,
    get_holiday_set,
    get_team_special_status_day_map,
    is_working_day,
    leave_hours_for_day,
)
from apps.core.rounding import round_half_up
from apps.tasks.business_time import (
    BUSINESS_TZ_OFFSET_HOURS,
    business_calendar_day,
    business_day_real_range,
)
from apps.tasks.models import Task, TaskActivity
from apps.users.models import User

from .target_time import get_official_target_time
from .workload import sum_weighted_base_hours


def classify_capacity(disponible: float, base_futura_total: float, disponible_pct: float) -> dict:
    """Semáforo de capacidad disponible — función pura, réplica exacta
    de `classifyCapacity`. Extraída para que el motor real y el
    simulador (sub-fase futura) usen la MISMA clasificación."""
    if base_futura_total <= 0:
        return {"estado": "sin-planificacion", "estado_color": "gray", "estado_label": "Sin planificación disponible este mes"}
    if disponible < 0:
        return {"estado": "sobrecarga", "estado_color": "red", "estado_label": f"Sobrecarga proyectada: {disponible}h"}
    if disponible_pct > 20:
        return {"estado": "alta", "estado_color": "green", "estado_label": "Puede asumir proyectos"}
    if disponible_pct >= 10:
        return {"estado": "limitada", "estado_color": "yellow", "estado_label": "Capacidad limitada"}
    return {"estado": "no-asignar", "estado_color": "red", "estado_label": "No asignar nuevas tareas"}


def _utc_month_start(d: date) -> date:
    return d.replace(day=1)


def _utc_month_end(d: date) -> date:
    next_year, next_month = (d.year + 1, 1) if d.month == 12 else (d.year, d.month + 1)
    return date(next_year, next_month, 1) - timedelta(days=1)


def _build_leave_maps(records) -> dict[int, dict[date, dict]]:
    """Agrupa `LeaveRecord` por usuario y día, mismo shape que
    `apps.configuration.services.get_leave_minutes_by_day` — pero para
    VARIOS usuarios en una sola consulta ya resuelta (sin la N+1 de
    llamar esa función por usuario). Réplica de `buildLeaveMaps`."""
    by_user: dict[int, dict[date, dict]] = {}
    for r in records:
        user_map = by_user.setdefault(r.user_id, {})
        entry = user_map.setdefault(
            r.date,
            {
                "medico_minutes": 0, "medico_full_day": False,
                "personal_minutes": 0, "personal_full_day": False,
                "vacaciones_full_day": False,
            },
        )
        if r.type == LeaveRecord.Type.MEDICO:
            if r.is_full_day:
                entry["medico_full_day"] = True
            else:
                entry["medico_minutes"] += r.duration_minutes or 0
        elif r.type == LeaveRecord.Type.PERSONAL:
            if r.is_full_day:
                entry["personal_full_day"] = True
            else:
                entry["personal_minutes"] += r.duration_minutes or 0
        else:
            entry["vacaciones_full_day"] = True
    return by_user


def _empty_forecast(user_id: int) -> dict:
    return {
        "user_id": user_id,
        "horas_restantes_hoy": 0,
        "dias_laborables_restantes": 0,
        "base_futura_total": 0,
        "comprometido_en_progreso": 0,
        "comprometido_pendiente": 0,
        "comprometido_futuro": 0,
        "disponible": 0,
        "disponible_pct": 0,
        "estado": "sin-planificacion",
        "estado_color": "gray",
        "estado_label": "Sin planificación disponible este mes",
        "tasks_sin_estimar": 0,
        "confiabilidad": {"pct": 100, "holidays_configured": True, "tasks_without_estimate": 0},
    }


def compute_team_capacity_forecast(*, user_ids: list[int], now: datetime) -> dict[int, dict]:
    """Réplica función por función de `computeTeamCapacityForecast` —
    1 sola tanda de queries para todos los `user_ids`, después un loop
    en memoria por usuario."""
    result: dict[int, dict] = {}
    if not user_ids:
        return result

    today = business_calendar_day(now)
    month_start = _utc_month_start(today)
    month_end = _utc_month_end(today)
    tomorrow = today + timedelta(days=1)
    today_start_dt = datetime(today.year, today.month, today.day, tzinfo=dt_timezone.utc)
    month_end_dt = datetime(month_end.year, month_end.month, month_end.day, 23, 59, 59, 999999, tzinfo=dt_timezone.utc)

    local_hour = (now - timedelta(hours=BUSINESS_TZ_OFFSET_HOURS)).hour

    hours_per_day = get_effective_horas_efectivas(now)
    workday_end_hour = get_effective_workday_end_hour(now)
    holidays = get_holiday_set()
    holidays_this_year_count = Holiday.objects.filter(year=today.year).count()
    leave_records = list(
        LeaveRecord.objects.filter(user_id__in=user_ids, date__gte=month_start, date__lte=month_end).only(
            "user_id", "type", "date", "is_full_day", "duration_minutes"
        )
    )
    special_map_by_user = get_team_special_status_day_map(User.objects.filter(id__in=user_ids), month_start, month_end)
    open_tasks = list(
        Task.objects.filter(
            assigned_to_id__in=user_ids, status__in=[Task.Status.PENDIENTE, Task.Status.EN_PROGRESO],
            archived_month__isnull=True,
        ).only("assigned_to_id", "status", "estimated_hours", "target_time_validated", "real_hours", "start_date", "end_date")
    )

    real_start, _ = business_day_real_range(month_start)
    _, real_end = business_day_real_range(today)
    fija_tasks = list(
        Task.objects.filter(
            assigned_to_id__in=user_ids, type=Task.Type.FIJA, archived_month__isnull=True,
            completed_at__gte=real_start, completed_at__lte=real_end,
        ).only("assigned_to_id", "completed_at", "real_hours")
    )
    activities = list(
        TaskActivity.objects.filter(author_id__in=user_ids, created_at__gte=real_start, created_at__lte=real_end).only(
            "author_id", "created_at", "duration"
        )
    )
    by_user_day: dict[int, dict[date, float]] = {}
    for t in fija_tasks:
        if t.completed_at:
            day_key = business_calendar_day(t.completed_at)
            day_map = by_user_day.setdefault(t.assigned_to_id, {})
            day_map[day_key] = day_map.get(day_key, 0) + t.real_hours
    for a in activities:
        day_key = business_calendar_day(a.created_at)
        day_map = by_user_day.setdefault(a.author_id, {})
        day_map[day_key] = day_map.get(day_key, 0) + a.duration / 60

    workday_ended = local_hour >= workday_end_hour
    leave_map_by_user = _build_leave_maps(leave_records)
    holidays_configured = holidays_this_year_count > 0

    for user_id in user_ids:
        leave_map = leave_map_by_user.get(user_id, {})
        special_map = special_map_by_user.get(user_id, {})
        day_hours_map = by_user_day.get(user_id, {})

        # --- Horas restantes hoy (parcial) ---
        today_cfg = special_map.get(today)
        today_daily_hours = today_cfg["daily_hours"] if today_cfg else hours_per_day
        today_is_biz_day = is_working_day(today, holidays)
        horas_restantes_hoy = 0.0
        if today_is_biz_day and not workday_ended:
            today_leave_hours = leave_hours_for_day(leave_map.get(today), today_daily_hours)
            today_effective_hours = max(0.0, today_daily_hours - today_leave_hours)
            horas_ya_trabajadas_hoy = day_hours_map.get(today, 0)
            horas_restantes_hoy = max(0.0, round_half_up((today_effective_hours - horas_ya_trabajadas_hoy) * 100) / 100)

        # --- Días laborables restantes (futuros, sin contar hoy) ---
        dias_laborables_restantes = count_business_days(tomorrow, month_end, holidays)
        base_futura_full_days = sum_weighted_base_hours(
            tomorrow, month_end, hours_per_day, holidays, leave_map, special_map, "daily_hours"
        )
        base_futura_total = round_half_up((horas_restantes_hoy + base_futura_full_days) * 100) / 100

        # --- Comprometido futuro ---
        user_tasks = [t for t in open_tasks if t.assigned_to_id == user_id]
        en_progreso = [t for t in user_tasks if t.status == Task.Status.EN_PROGRESO]
        en_progreso_estimadas = [
            t for t in en_progreso if get_official_target_time(t.estimated_hours, t.target_time_validated) > 0
        ]
        en_progreso_sin_estimar = len(en_progreso) - len(en_progreso_estimadas)
        comprometido_en_progreso = round_half_up(
            sum(
                max(0.0, get_official_target_time(t.estimated_hours, t.target_time_validated) - t.real_hours)
                for t in en_progreso_estimadas
            )
            * 100
        ) / 100

        pendientes = [
            t
            for t in user_tasks
            if t.status == Task.Status.PENDIENTE and t.start_date <= month_end_dt and t.end_date >= today_start_dt
        ]
        pendientes_estimadas = [
            t for t in pendientes if get_official_target_time(t.estimated_hours, t.target_time_validated) > 0
        ]
        pendientes_sin_estimar = len(pendientes) - len(pendientes_estimadas)
        comprometido_pendiente = round_half_up(
            sum(get_official_target_time(t.estimated_hours, t.target_time_validated) for t in pendientes_estimadas) * 100
        ) / 100

        comprometido_futuro = round_half_up((comprometido_en_progreso + comprometido_pendiente) * 100) / 100
        tasks_sin_estimar = en_progreso_sin_estimar + pendientes_sin_estimar

        # --- Disponible ---
        disponible = round_half_up((base_futura_total - comprometido_futuro) * 100) / 100
        disponible_pct = round_half_up(disponible / base_futura_total * 100) if base_futura_total > 0 else 0

        classification = classify_capacity(disponible, base_futura_total, disponible_pct)

        # Confiabilidad: NO se infieren permisos/ausencias por falta de
        # actividad registrada (falsos positivos) — solo se penaliza por
        # señales verificables: tareas sin estimar y feriados no
        # configurados este año.
        confiabilidad_pct = max(0, min(100, 100 - tasks_sin_estimar * 5 - (0 if holidays_configured else 3)))

        result[user_id] = {
            "user_id": user_id,
            "horas_restantes_hoy": horas_restantes_hoy,
            "dias_laborables_restantes": dias_laborables_restantes,
            "base_futura_total": base_futura_total,
            "comprometido_en_progreso": comprometido_en_progreso,
            "comprometido_pendiente": comprometido_pendiente,
            "comprometido_futuro": comprometido_futuro,
            "disponible": disponible,
            "disponible_pct": disponible_pct,
            "estado": classification["estado"],
            "estado_color": classification["estado_color"],
            "estado_label": classification["estado_label"],
            "tasks_sin_estimar": tasks_sin_estimar,
            "confiabilidad": {
                "pct": confiabilidad_pct,
                "holidays_configured": holidays_configured,
                "tasks_without_estimate": tasks_sin_estimar,
            },
        }

    return result


def compute_capacity_forecast(*, user, now: datetime) -> dict:
    """Wrapper de 1 usuario — réplica exacta de `computeCapacityForecast`,
    incluyendo el fallback defensivo "sin planificación" (caso
    imposible en la práctica: `user_ids=[user.id]` siempre se procesa,
    pero se porta tal cual)."""
    forecasts = compute_team_capacity_forecast(user_ids=[user.id], now=now)
    return forecasts.get(user.id) or _empty_forecast(user.id)
