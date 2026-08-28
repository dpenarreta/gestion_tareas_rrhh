"""Motor de alertas de riesgo — Fase 4b (ver docs/AUDIT_LOG.md §
2026-08-11). Portado de `src/lib/riskAlerts.ts`."""

from datetime import timedelta

from apps.configuration.services import (
    count_business_days,
    get_effective_alert_overdue_task_threshold,
    get_holiday_set,
)
from apps.tasks.business_time import business_calendar_day
from apps.tasks.models import Task, TaskActivity

from .utils import is_task_overdue, utc_calendar_day


def _pluralize(n: int, singular: str, plural: str) -> str:
    return singular if n == 1 else plural


def compute_risk_alerts(*, user, now, carga_label: str, carga_pct: float) -> list[dict]:
    """4 alertas independientes — réplica 1:1 de `computeRiskAlerts`.
    Devuelve una lista vacía si no hay nada que reportar."""
    open_tasks = list(
        Task.objects.filter(assigned_to=user, archived_month__isnull=True)
        .exclude(status=Task.Status.COMPLETADA)
        .only("id", "end_date", "status", "priority")
    )
    last_activity = TaskActivity.objects.filter(author=user).order_by("-created_at").first()
    threshold = get_effective_alert_overdue_task_threshold(now)
    holidays = get_holiday_set()

    today = business_calendar_day(now)
    in_3_days = today + timedelta(days=3)

    alerts: list[dict] = []

    # --- Alerta 1: tareas vencidas -----------------------------------------
    overdue = [t for t in open_tasks if is_task_overdue(t.end_date, t.status, now)]
    if len(overdue) >= threshold:
        critical = sum(1 for t in overdue if t.priority == Task.Priority.ALTA)
        severity = "red" if len(overdue) >= threshold * 2 else "yellow"
        message = (
            f"{len(overdue)} {_pluralize(len(overdue), 'tarea vencida', 'tareas vencidas')} "
            f"(umbral configurado: {threshold})"
        )
        if critical > 0:
            message += f" — {critical} {_pluralize(critical, 'crítica', 'críticas')} de prioridad alta"
        alerts.append({"severity": severity, "message": message})

    # --- Alerta 2: carga laboral --------------------------------------------
    if carga_label in ("Sobrecarga", "Carga elevada"):
        severity = "red" if carga_label == "Sobrecarga" else "yellow"
        alerts.append(
            {
                "severity": severity,
                "message": f"La carga laboral del mes está en {carga_label} ({carga_pct}%), por encima del rango óptimo",
            }
        )

    # --- Alerta 3: actividades por vencer en 3 días -------------------------
    overdue_ids = {t.id for t in overdue}
    due_soon = [
        t
        for t in open_tasks
        if t.id not in overdue_ids and today <= utc_calendar_day(t.end_date) <= in_3_days
    ]
    if due_soon:
        alerts.append(
            {
                "severity": "yellow",
                "message": (
                    f"{len(due_soon)} {_pluralize(len(due_soon), 'actividad próxima', 'actividades próximas')} "
                    "a vencer en los próximos 3 días"
                ),
            }
        )

    # --- Alerta 4: inactividad -----------------------------------------------
    if last_activity is not None:
        last_day = business_calendar_day(last_activity.created_at)
        day_after_last_activity = last_day + timedelta(days=1)
        gap = count_business_days(day_after_last_activity, today, holidays)
        if gap >= 2:
            alerts.append(
                {"severity": "red", "message": f"Sin registro de actividades en los últimos {gap} días laborables"}
            )

    return alerts
