"""Riesgo Operativo (Operational Risk) — Fase 4h (ver
docs/AUDIT_LOG.md § 2026-08-11). Réplica exacta de
`computeOperationalRisk` (`src/lib/analytics.ts`). Nota de fidelidad
explícita en el propio código legacy: "Sprint 5 § S5-C prohíbe
modificar reglas/pesos/alertas" — los 8 factores, sus pesos y sus
fórmulas de severidad se copian tal cual, sin ajustes."""

from datetime import datetime

from apps.configuration.services import get_effective_analytics_config
from apps.core.rounding import round_half_up
from apps.tasks.business_time import business_calendar_day
from apps.tasks.models import Task, TaskActivity

from .capacity_forecast import compute_capacity_forecast
from .history import compute_consistency, compute_trends
from .models import ANALYTICS_ENGINE_VERSION, AnalyticsAuditLog
from .scoring import _month_bounds, audit_calculation, weighted_points
from .utils import is_task_overdue
from .workload import compute_carga_tiempo


def _pluralize(n: int, singular: str, plural: str) -> str:
    return singular if n == 1 else plural


def _compute_seguimiento_concentration(*, user, year: int, month: int) -> dict:
    """Réplica exacta de `computeSeguimientoConcentration` — riesgo por
    concentrar el tiempo de Seguimiento en un solo motivo, solo si ese
    motivo supera el 70% del tiempo total del mes."""
    start, end = _month_bounds(year, month)
    activities = list(
        TaskActivity.objects.filter(
            author=user, created_at__gte=start, created_at__lte=end, task__type=Task.Type.SEGUIMIENTO
        ).only("reason", "duration")
    )
    total = sum(a.duration for a in activities)
    if total == 0:
        return {"pct": 0, "detail": "Sin actividades de seguimiento este mes"}

    by_reason: dict[str, int] = {}
    for a in activities:
        by_reason[a.reason] = by_reason.get(a.reason, 0) + a.duration
    top_reason, top_duration = max(by_reason.items(), key=lambda item: item[1])
    top_pct = round_half_up(top_duration / total * 100)
    pct = min(100, (top_pct - 70) * 3) if top_pct > 70 else 0
    detail = (
        f"{top_pct}% del tiempo de seguimiento concentrado en un solo motivo"
        if top_pct > 70
        else f"Concentración máxima entre motivos: {top_pct}%"
    )
    return {"pct": pct, "detail": detail}


def _get_risk_trend_vs_prev_month(*, user, year: int, month: int, current_score: float) -> dict:
    """Réplica exacta de `getRiskTrendVsPrevMonth` — lee el último
    `AnalyticsAuditLog` de Riesgo Operativo del mes anterior de este
    usuario. Best-effort: nunca lanza."""
    prev_year, prev_month = (year, month - 1) if month > 1 else (year - 1, 12)
    prev_period = f"{prev_year}-{prev_month:02d}"
    try:
        prev = (
            AnalyticsAuditLog.objects.filter(user=user, kind="operational_risk", period=prev_period)
            .order_by("-created_at")
            .only("result")
            .first()
        )
        prev_score = prev.result.get("score") if prev and isinstance(prev.result, dict) else None
        if not isinstance(prev_score, (int, float)) or isinstance(prev_score, bool):
            return {"available": False, "reason": "Sin historial suficiente"}
        return {"available": True, "diff": round_half_up((current_score - prev_score) * 100) / 100}
    except Exception:  # noqa: BLE001 — lectura best-effort, nunca bloquea el cálculo
        return {"available": False, "reason": "Sin historial suficiente"}


def classify_operational_risk(score: float, threshold_medio: float, threshold_alto: float, threshold_critico: float) -> dict:
    """Clasificación Bajo/Medio/Alto/Crítico a partir del score y los 3
    umbrales configurables — función pura, réplica exacta de
    `classifyOperationalRisk`."""
    if score >= threshold_critico:
        classification = "Crítico"
    elif score >= threshold_alto:
        classification = "Alto"
    elif score >= threshold_medio:
        classification = "Medio"
    else:
        classification = "Bajo"
    classification_color = {"Crítico": "red", "Alto": "orange", "Medio": "yellow", "Bajo": "green"}[classification]
    return {"classification": classification, "classification_color": classification_color}


def compute_operational_risk(*, user, now: datetime) -> dict:
    """Réplica exacta de `computeOperationalRisk` — 8 factores de
    severidad ponderados, tendencia vs. mes anterior y acciones
    sugeridas."""
    config = get_effective_analytics_config(now)
    today = business_calendar_day(now)
    year, month = today.year, today.month

    capacity = compute_capacity_forecast(user=user, now=now)
    trends = compute_trends(user=user, now=now)
    consistency = compute_consistency(user=user, now=now)
    carga_tiempo = compute_carga_tiempo(user=user, now=now)
    open_tasks = list(
        Task.objects.filter(assigned_to=user, archived_month__isnull=True)
        .exclude(status=Task.Status.COMPLETADA)
        .only("end_date", "status", "priority")
    )
    concentration = _compute_seguimiento_concentration(user=user, year=year, month=month)

    overdue_alta = sum(
        1 for t in open_tasks if is_task_overdue(t.end_date, t.status, now) and t.priority == Task.Priority.ALTA
    )

    factors: list[dict] = []

    def push(name: str, weight_key: str, raw_pct: float, detail: str) -> None:
        weight = config[weight_key]
        points = weighted_points(raw_pct, weight)
        factors.append({"name": name, "weight": weight, "points": points, "detail": detail})

    sobrecarga_pct = min(100, abs(capacity["disponible_pct"])) if capacity["disponible"] < 0 else 0
    push(
        "Sobrecarga proyectada", "risk_weight_sobrecarga", sobrecarga_pct,
        f"Sobrecarga proyectada de {abs(capacity['disponible'])}h para lo que resta del mes"
        if capacity["disponible"] < 0
        else "Sin sobrecarga proyectada",
    )

    criticas_pct = min(100, overdue_alta * 33)
    push(
        "Tareas críticas vencidas", "risk_weight_vencidas_criticas", criticas_pct,
        f"{overdue_alta} {_pluralize(overdue_alta, 'tarea vencida', 'tareas vencidas')} de prioridad Alta",
    )

    cump_trend = trends["cumplimiento"]["mes_anterior"]
    tendencia_pct = (
        min(100, abs(cump_trend["absolute_diff"]) * 3)
        if cump_trend.get("available") and cump_trend["direction"] == "empeoro"
        else 0
    )
    push(
        "Tendencia negativa de cumplimiento", "risk_weight_tendencia_negativa", tendencia_pct,
        (
            f"Cumplimiento {'cayó' if cump_trend['direction'] == 'empeoro' else 'estable/mejoró'} "
            f"{abs(cump_trend['absolute_diff'])}pp vs mes anterior"
        )
        if cump_trend.get("available")
        else "Sin historial suficiente",
    )

    extra_pct = min(100, carga_tiempo["mensual"]["weekend_hours"] * 10)
    push(
        "Horas extras recurrentes", "risk_weight_horas_extra", extra_pct,
        f"{carga_tiempo['mensual']['weekend_hours']}h trabajadas en fin de semana este mes"
        if carga_tiempo["mensual"]["weekend_hours"] > 0
        else "Sin horas extra registradas",
    )

    if capacity["disponible_pct"] < 10:
        baja_cap_pct = 100 if capacity["disponible"] < 0 else round_half_up((1 - capacity["disponible_pct"] / 10) * 100)
    else:
        baja_cap_pct = 0
    push(
        "Baja capacidad futura (<10%)", "risk_weight_baja_capacidad", baja_cap_pct,
        f"{capacity['disponible_pct']}% de capacidad disponible proyectada",
    )

    if consistency.get("available"):
        variabilidad_pct = {"muy-variable": 100, "variable": 60, "consistente": 20}.get(consistency["level"], 0)
    else:
        variabilidad_pct = 0
    push(
        "Variabilidad excesiva entre semanas", "risk_weight_variabilidad", variabilidad_pct,
        f"Consistencia: {consistency['label']} (CV {consistency['coefficient_of_variation']}%)"
        if consistency.get("available")
        else "Sin historial suficiente",
    )

    push("Alta concentración en un solo tipo de actividad", "risk_weight_concentracion", concentration["pct"], concentration["detail"])

    sin_plan_pct = min(100, capacity["tasks_sin_estimar"] * 25)
    push(
        "Muchas tareas sin planificación", "risk_weight_sin_planificacion", sin_plan_pct,
        f"{capacity['tasks_sin_estimar']} "
        f"{_pluralize(capacity['tasks_sin_estimar'], 'tarea sin tiempo objetivo definido', 'tareas sin tiempo objetivo definido')}",
    )

    score = round_half_up(sum(f["points"] for f in factors), 2)
    classification_info = classify_operational_risk(
        score, config["risk_threshold_medio"], config["risk_threshold_alto"], config["risk_threshold_critico"]
    )

    trend_vs_prev_month = _get_risk_trend_vs_prev_month(user=user, year=year, month=month, current_score=score)

    suggested_actions: list[str] = []
    if sobrecarga_pct > 0:
        suggested_actions.append("Redistribuir tareas pendientes/en progreso para evitar la sobrecarga proyectada.")
    if criticas_pct > 0:
        suggested_actions.append("Priorizar de inmediato las tareas críticas (prioridad Alta) vencidas.")
    if baja_cap_pct > 50:
        suggested_actions.append("No asignar nuevas tareas hasta liberar capacidad.")
    if variabilidad_pct >= 60:
        suggested_actions.append("Revisar la carga semana a semana — el ritmo de trabajo es muy irregular.")
    if not suggested_actions:
        suggested_actions.append("Sin acciones urgentes — mantener el seguimiento habitual.")

    steps = [f"+{f['points']} {f['name']} ({f['detail']})" for f in factors]
    steps.append(f"Total: {score} → Riesgo {classification_info['classification']}")

    result = {
        "score": score,
        "classification": classification_info["classification"],
        "classification_color": classification_info["classification_color"],
        "factors": factors,
        "trend_vs_prev_month": trend_vs_prev_month,
        "suggested_actions": suggested_actions,
        "engine_version": ANALYTICS_ENGINE_VERSION,
        "explain": {"formula": "Σ (severidad_factor% × peso_factor%)", "steps": steps},
    }

    audit_calculation(
        user=user, kind="operational_risk", period=f"{year}-{month:02d}",
        inputs={"factors": factors, "weights": config}, result=result,
    )
    return result
