"""Motor de alertas automáticas — Fase 4i (ver docs/AUDIT_LOG.md §
2026-08-11). Réplica exacta de `computeAlerts`/`getResolvedAlertsHistory`
(`src/lib/analytics.ts`) — la función de mayor fan-in de todo el
archivo, exigía tener casi todo lo demás portado primero (Capacidad
Proyectada, histórico mensual/semanal, tendencias, carga por día).

DISTINTO de `compute_risk_alerts` (`.risk_alerts`, Fase 4b) — motores
independientes sin solapamiento de código: ese es el de 4 reglas
simples que usa `/kpis/me`; este es el de 8 reglas de `analytics.ts`
completo, sin consumidor HTTP todavía."""

from datetime import datetime

from apps.configuration.services import get_effective_analytics_config
from apps.core.rounding import round_half_up
from apps.tasks.business_time import business_calendar_day
from apps.tasks.models import Task

from .capacity_forecast import compute_capacity_forecast
from .history import _avg_of, compute_monthly_history, compute_trends, compute_weekly_history
from .models import AnalyticsAuditLog
from .scoring import audit_calculation
from .utils import is_task_overdue
from .workload import compute_carga_history

SEVERITY_RANK = {"red": 4, "orange": 3, "yellow": 2, "green": 1}


def _consecutive_days_with_label(daily: list[dict], predicate) -> int:
    """Cuenta días consecutivos desde el más reciente hacia atrás que
    cumplen `predicate` — réplica exacta de `consecutiveDaysWithLabel`."""
    count = 0
    for point in reversed(daily):
        if predicate(point):
            count += 1
        else:
            break
    return count


def compute_alerts(*, user, now: datetime) -> list[dict]:
    """Réplica función por función de `computeAlerts` — 8 reglas
    independientes, ordenadas por severidad (red>orange>yellow>green).
    Audita de forma minimalista (`kind="alerts"`, solo las reglas que
    dispararon) para que `get_resolved_alerts_history` pueda diffear."""
    config = get_effective_analytics_config(now)
    now_iso = now.isoformat()
    alerts: list[dict] = []

    capacity = compute_capacity_forecast(user=user, now=now)
    carga_history = compute_carga_history(user=user, now=now)
    trends = compute_trends(user=user, now=now)
    monthly = compute_monthly_history(user=user, months_back=4, now=now)
    weekly = compute_weekly_history(user=user, weeks_back=4, now=now)
    open_tasks = list(
        Task.objects.filter(assigned_to=user, archived_month__isnull=True)
        .exclude(status=Task.Status.COMPLETADA)
        .only("end_date", "status", "priority")
    )

    # 1. Sobrecarga proyectada / capacidad crítica
    if capacity["estado"] == "sobrecarga":
        alerts.append(
            {
                "rule": "sobrecarga_proyectada",
                "severity": "red",
                "message": f"Sobrecarga proyectada para lo que resta del mes: {capacity['disponible']}h",
                "suggested_action": "Redistribuir tareas pendientes/en progreso antes de asignar trabajo nuevo.",
                "detected_at": now_iso,
            }
        )
    elif capacity["estado"] == "no-asignar":
        alerts.append(
            {
                "rule": "capacidad_critica",
                "severity": "orange",
                "message": f"Capacidad disponible proyectada del {capacity['disponible_pct']}%, por debajo del mínimo recomendado",
                "suggested_action": "No asignar nuevas tareas hasta liberar carga.",
                "detected_at": now_iso,
            }
        )

    # 2. Subutilización prolongada
    subutilizacion_days = _consecutive_days_with_label(
        carga_history["daily"], lambda d: d["kind"] == "normal" and d["label"] == "Subutilización"
    )
    if subutilizacion_days >= config["alert_consecutive_overload_days"]:
        alerts.append(
            {
                "rule": "subutilizacion_prolongada",
                "severity": "yellow",
                "message": f"{subutilizacion_days} días laborables consecutivos en Subutilización",
                "suggested_action": "Revisar si hay carga disponible para asignar o si faltan tareas por planificar.",
                "detected_at": now_iso,
            }
        )

    # 3. Tareas vencidas por encima del umbral configurado
    overdue = [t for t in open_tasks if is_task_overdue(t.end_date, t.status, now)]
    overdue_alta = sum(1 for t in overdue if t.priority == Task.Priority.ALTA)
    threshold = config["alert_overdue_task_threshold"]
    if len(overdue) >= threshold * 2:
        alerts.append(
            {
                "rule": "tareas_vencidas",
                "severity": "red",
                "message": (
                    f"{len(overdue)} tareas vencidas (umbral configurado: {threshold})"
                    + (f", {overdue_alta} de prioridad Alta" if overdue_alta > 0 else "")
                ),
                "suggested_action": "Revisar y reprogramar o completar las tareas vencidas de inmediato.",
                "detected_at": now_iso,
            }
        )
    elif len(overdue) >= threshold:
        alerts.append(
            {
                "rule": "tareas_vencidas",
                "severity": "orange",
                "message": f"{len(overdue)} tareas vencidas (umbral configurado: {threshold})",
                "suggested_action": "Revisar esta semana las tareas vencidas y priorizar su cierre.",
                "detected_at": now_iso,
            }
        )

    # 4. Disminución del cumplimiento respecto al mes anterior
    cump_trend = trends["cumplimiento"]["mes_anterior"]
    if cump_trend.get("available") and cump_trend["direction"] == "empeoro":
        abs_diff = abs(cump_trend["absolute_diff"])
        severity = "red" if abs_diff >= 20 else ("orange" if abs_diff >= 10 else "yellow")
        alerts.append(
            {
                "rule": "cumplimiento_bajo",
                "severity": severity,
                "message": (
                    f"Cumplimiento cayó {abs_diff}pp respecto al mes anterior "
                    f"({cump_trend['compared']}% → {cump_trend['current']}%)"
                ),
                "suggested_action": "Revisar con el colaborador las causas de la caída y ajustar prioridades.",
                "detected_at": now_iso,
            }
        )

    # 5. Incremento inusual de horas extra (fin de semana)
    current_weekend = monthly[-1]["weekend_hours"] if monthly else 0
    prior_weekend_avg = _avg_of([m["weekend_hours"] for m in monthly[:-1]])
    if current_weekend > 0 and prior_weekend_avg is not None and current_weekend > prior_weekend_avg * 1.5 + 1:
        alerts.append(
            {
                "rule": "horas_extra_inusuales",
                "severity": "yellow",
                "message": (
                    f"{current_weekend}h trabajadas en fin de semana este mes, por encima del promedio "
                    f"histórico ({round_half_up(prior_weekend_avg * 10) / 10}h)"
                ),
                "suggested_action": "Confirmar si el trabajo en fin de semana es puntual o indica sobrecarga sostenida.",
                "detected_at": now_iso,
            }
        )

    # 6. Días consecutivos sobre el rango óptimo
    overload_days = _consecutive_days_with_label(
        carga_history["daily"], lambda d: d["kind"] == "normal" and d["label"] in ("Carga elevada", "Sobrecarga")
    )
    if overload_days >= config["alert_consecutive_overload_days"]:
        alerts.append(
            {
                "rule": "dias_consecutivos_sobrecarga",
                "severity": "red" if overload_days >= config["alert_consecutive_overload_days"] * 2 else "orange",
                "message": f"{overload_days} días laborables consecutivos por encima del rango óptimo",
                "suggested_action": "Evaluar redistribución de tareas para evitar desgaste.",
                "detected_at": now_iso,
            }
        )

    # 7. Caída importante en registros diarios (señal sobre el DATO, no una inferencia de causa)
    last_week = weekly[-1] if weekly else None
    prior_weeks_avg_reg = _avg_of(
        [w["days_with_registration"] / w["business_days"] for w in weekly[:-1] if w["business_days"] > 0]
    )
    if last_week and last_week["business_days"] > 0 and prior_weeks_avg_reg is not None and prior_weeks_avg_reg > 0.3:
        last_rate = last_week["days_with_registration"] / last_week["business_days"]
        if last_rate < prior_weeks_avg_reg * 0.5:
            alerts.append(
                {
                    "rule": "caida_registros",
                    "severity": "yellow",
                    "message": (
                        f"Registros diarios de la última semana completa: "
                        f"{last_week['days_with_registration']}/{last_week['business_days']} días, "
                        "por debajo del promedio reciente"
                    ),
                    "suggested_action": "Confirmar con el colaborador si hay actividades sin registrar o dificultades para hacerlo.",
                    "detected_at": now_iso,
                }
            )

    # 8. Crecimiento excesivo de actividades de seguimiento
    current_seg = monthly[-1]["seguimiento_count"] if monthly else 0
    prior_seg_avg = _avg_of([m["seguimiento_count"] for m in monthly[:-1]])
    if current_seg > 0 and prior_seg_avg is not None and prior_seg_avg > 0 and current_seg > prior_seg_avg * 1.5:
        alerts.append(
            {
                "rule": "crecimiento_seguimiento",
                "severity": "yellow",
                "message": (
                    f"{current_seg} actividades de seguimiento este mes, "
                    f"{round_half_up((current_seg - prior_seg_avg) / prior_seg_avg * 100)}% por encima del promedio histórico"
                ),
                "suggested_action": "Revisar si el crecimiento de consultas requiere apoyo adicional.",
                "detected_at": now_iso,
            }
        )

    sorted_alerts = sorted(alerts, key=lambda a: SEVERITY_RANK[a["severity"]], reverse=True)

    today = business_calendar_day(now)
    audit_calculation(
        user=user, kind="alerts", period=f"{today.year}-{today.month:02d}",
        inputs={}, result={"alerts": [a["rule"] for a in sorted_alerts]},
    )

    return sorted_alerts


# --- Historial de alertas resueltas -------------------------------------------
# Reutiliza AnalyticsAuditLog (sin tabla nueva) — una alerta "resuelta" es una
# regla que aparecía en un cálculo anterior de compute_alerts y ya no aparece
# en el más reciente.

_RULE_LABEL = {
    "sobrecarga_proyectada": "Sobrecarga proyectada",
    "capacidad_critica": "Capacidad crítica",
    "subutilizacion_prolongada": "Subutilización prolongada",
    "tareas_vencidas": "Tareas vencidas",
    "cumplimiento_bajo": "Cumplimiento bajo",
    "horas_extra_inusuales": "Horas extra inusuales",
    "dias_consecutivos_sobrecarga": "Días consecutivos de sobrecarga",
    "caida_registros": "Caída de registros diarios",
    "crecimiento_seguimiento": "Crecimiento de actividades de seguimiento",
}


def get_resolved_alerts_history(*, user, current_alerts: list[dict], now: datetime) -> list[dict]:
    """Réplica exacta de `getResolvedAlertsHistory`. Best-effort: si la
    lectura de auditoría falla, devuelve `[]` sin registrar el error
    (igual que el TS, que tampoco lo hace)."""
    active_rules = {a["rule"] for a in current_alerts}

    try:
        entries = list(
            AnalyticsAuditLog.objects.filter(user=user, kind="alerts")
            .order_by("-created_at")
            .only("created_at", "result")[:30]
        )
    except Exception:  # noqa: BLE001 — lectura best-effort, réplica fiel del TS (sin logging)
        return []

    last_seen_active: dict[str, datetime] = {}
    for entry in entries:
        rules = entry.result.get("alerts") if isinstance(entry.result, dict) else None
        if not isinstance(rules, list):
            continue
        for rule in rules:
            if not isinstance(rule, str) or rule in active_rules or rule in last_seen_active:
                continue
            last_seen_active[rule] = entry.created_at

    resolved = [
        {"rule": rule, "message": _RULE_LABEL.get(rule, rule), "days_ago": max(0, (now - last_active_at).days)}
        for rule, last_active_at in last_seen_active.items()
    ]
    resolved.sort(key=lambda r: r["days_ago"])
    return resolved[:3]
