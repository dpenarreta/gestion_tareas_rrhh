"""Helpers puros compartidos del motor de KPIs/Analytics — Fase 4b (ver
docs/AUDIT_LOG.md § 2026-08-11). Portado de `src/lib/utils.ts`."""

from datetime import date, datetime

from apps.tasks.business_time import business_calendar_day


def utc_calendar_day(value: date | datetime) -> date:
    """Normaliza a día calendario UTC — réplica de `utcCalendarDay`."""
    if isinstance(value, datetime):
        return value.date()
    return value


def is_task_overdue(end_date: date | datetime, status: str, reference_date: datetime) -> bool:
    """Réplica exacta de `isTaskOverdue`. Una tarea `COMPLETADA` nunca
    está vencida. Si no, vence el día calendario SIGUIENTE a `end_date`
    (comparación estrictamente posterior), no en el instante `end_date <
    now`."""
    if status == "COMPLETADA":
        return False
    return business_calendar_day(reference_date) > utc_calendar_day(end_date)
