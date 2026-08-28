"""Cumplimiento por prioridad — Fase 4b (ver docs/AUDIT_LOG.md §
2026-08-11). Portado de `src/lib/priorityCompliance.ts`."""

from apps.core.rounding import round_half_up
from apps.tasks.business_time import business_calendar_day
from apps.tasks.models import Task

from .utils import utc_calendar_day

PRIORITY_ORDER = [Task.Priority.ALTA, Task.Priority.MEDIA, Task.Priority.BAJA]


def is_completed_on_time(task) -> bool:
    """Definición canónica de "cumplida a tiempo" — comparación por DÍA
    CALENDARIO (no por instante): `completed_at` se lee en huso de
    negocio (real), `end_date` como fecha pura UTC-medianoche. Fix legacy
    2026-07-24: antes comparaba instantes crudos, lo que clasificaba mal
    como tardías las tareas cerradas el mismo día de vencimiento."""
    if task.status != Task.Status.COMPLETADA or task.completed_at is None:
        return False
    return business_calendar_day(task.completed_at) <= utc_calendar_day(task.end_date)


def compute_priority_compliance(tasks) -> list[dict]:
    """Siempre devuelve 3 elementos, ALTA/MEDIA/BAJA en ese orden, incluso
    con `total=0` cuando no hay tareas de esa prioridad en el período."""
    result = []
    for priority in PRIORITY_ORDER:
        for_priority = [t for t in tasks if t.priority == priority]
        completed_on_time = sum(1 for t in for_priority if is_completed_on_time(t))
        total = len(for_priority)
        pct = round_half_up(completed_on_time / total * 100) if total > 0 else 0
        result.append({"priority": priority, "total": total, "completed_on_time": completed_on_time, "pct": pct})
    return result
