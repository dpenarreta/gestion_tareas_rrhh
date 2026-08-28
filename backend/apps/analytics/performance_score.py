"""Performance Score — Fase 4e (ver docs/AUDIT_LOG.md § 2026-08-11).
Réplica exacta de `computePerformanceScore` (`src/lib/analytics.ts`).
Responde una sola pregunta: "¿qué tan bien está ejecutando su
trabajo?" — 4 factores (Cumplimiento, Tareas vencidas, Consistencia,
Índice de Trazabilidad), deliberadamente SIN carga laboral, capacidad
futura ni riesgo operativo (esos viven en Riesgo Operativo/Equilibrio,
sub-fases futuras — dependen de `capacityForecast.ts`, todavía sin
portar)."""

from datetime import datetime

from apps.configuration.services import get_effective_analytics_config
from apps.core.rounding import round_half_up
from apps.tasks.business_time import business_calendar_day
from apps.tasks.models import Comment, Task, TaskActivity

from .history import compute_consistency, compute_weekly_history
from .models import ANALYTICS_ENGINE_VERSION, FORMULA_SET_VERSION
from .normalization import get_effective_curve, normalize
from .scoring import _month_bounds, audit_calculation, compute_completed_pct_any, weighted_points
from .utils import is_task_overdue


def _compute_trazabilidad_raw(*, user, start: datetime, end: datetime, now: datetime) -> dict:
    """Índice de Trazabilidad — mide evidencia/documentación del
    trabajo realizado (NO calidad del trabajo). Raw 0-100: % de días
    con registro (50%), comentarios del período (25%), actividades
    documentadas (25%). Réplica exacta de `computeTrazabilidadRaw`."""
    weekly = compute_weekly_history(user=user, weeks_back=4, now=now)
    comments = Comment.objects.filter(author=user, created_at__gte=start, created_at__lte=end).count()
    activities = TaskActivity.objects.filter(author=user, created_at__gte=start, created_at__lte=end).count()

    with_data = [w for w in weekly if w["business_days"] > 0]
    registro_pct = (
        sum(w["days_with_registration"] / w["business_days"] for w in with_data) / len(with_data) * 100
        if with_data
        else 0
    )
    comments_score = min(100, comments * 10)
    activities_score = min(100, activities * 10)
    raw = registro_pct * 0.5 + comments_score * 0.25 + activities_score * 0.25
    return {
        "raw": raw,
        "detail": f"{round_half_up(registro_pct)}% días con registro, {comments} comentarios, {activities} actividades documentadas",
    }


def classify_performance_score(score: float) -> dict:
    """Clasificación Excelente/Bueno/Riesgo/Crítico a partir del score
    — función pura, testeable sin BD. Réplica exacta de
    `classifyPerformanceScore`."""
    if score >= 90:
        classification = "Excelente"
    elif score >= 75:
        classification = "Bueno"
    elif score >= 60:
        classification = "Riesgo"
    else:
        classification = "Crítico"
    classification_color = "green" if score >= 75 else ("yellow" if score >= 60 else "red")
    return {"classification": classification, "classification_color": classification_color}


def compute_performance_score(*, user, now: datetime, precomputed_consistency: dict | None = None) -> dict:
    """Réplica exacta de `computePerformanceScore`. `precomputed_consistency`
    evita recalcular la misma consulta cuando esta función se invoca
    desde un pipeline mayor (sub-fase futura) que ya la calculó."""
    today = business_calendar_day(now)
    year, month = today.year, today.month
    start, end = _month_bounds(year, month)

    tasks = list(
        Task.objects.filter(assigned_to=user, end_date__gte=start, end_date__lte=end).only("status", "priority", "end_date")
    )
    consistency = precomputed_consistency if precomputed_consistency is not None else compute_consistency(user=user, now=now)
    trazabilidad = _compute_trazabilidad_raw(user=user, start=start, end=end, now=now)
    cumplimiento_curve = get_effective_curve("cumplimiento", now)
    vencidas_curve = get_effective_curve("vencidas", now)
    consistencia_curve = get_effective_curve("consistencia", now)
    trazabilidad_curve = get_effective_curve("trazabilidad", now)
    config = get_effective_analytics_config(now)

    completed_pct = compute_completed_pct_any(tasks, empty_value=100)
    overdue = [t for t in tasks if is_task_overdue(t.end_date, t.status, now)]
    overdue_alta = sum(1 for t in overdue if t.priority == Task.Priority.ALTA)
    overdue_normal = len(overdue) - overdue_alta
    weighted_overdue = overdue_normal + overdue_alta * 2

    # Sin historial suficiente -> valor neutro (mismo criterio que el
    # Score Legacy: 70 como neutro cuando no hay dato).
    consistency_raw = consistency["consistency_pct"] if consistency.get("available") else 70

    def mk(name: str, curve: str, raw_value: float, raw_label: str, weight: float, curve_points: list[dict]) -> dict:
        normalized_value = normalize(curve, raw_value, curve_points)
        points = weighted_points(normalized_value, weight)
        return {
            "name": name,
            "curve": curve,
            "raw_value": round_half_up(raw_value, 1),
            "raw_label": raw_label,
            "normalized_value": normalized_value,
            "weight": weight,
            "points": points,
            "detail": f"{raw_label} → normalizado {normalized_value} × {weight}% = {points} pts",
        }

    factors = [
        mk("Cumplimiento", "cumplimiento", completed_pct, f"{completed_pct}%", config["perf_weight_cumplimiento"], cumplimiento_curve),
        mk(
            "Tareas vencidas", "vencidas", weighted_overdue, f"{len(overdue)} ({overdue_alta} de prioridad Alta)",
            config["perf_weight_vencidas"], vencidas_curve,
        ),
        mk(
            "Consistencia", "consistencia", consistency_raw,
            f"{consistency['consistency_pct']}%" if consistency.get("available") else "Sin historial suficiente",
            config["perf_weight_consistencia"], consistencia_curve,
        ),
        mk(
            "Índice de Trazabilidad", "trazabilidad", trazabilidad["raw"], trazabilidad["detail"],
            config["perf_weight_trazabilidad"], trazabilidad_curve,
        ),
    ]

    score = round_half_up(sum(f["points"] for f in factors), 2)
    classification_info = classify_performance_score(score)

    steps = [
        f"{f['name']}: {f['raw_label']} → normalizado {f['normalized_value']} × {f['weight']}% = {f['points']} pts"
        for f in factors
    ]
    steps.append(f"Total: {score} → {classification_info['classification']}")

    result = {
        "score": score,
        "classification": classification_info["classification"],
        "classification_color": classification_info["classification_color"],
        "factors": factors,
        "engine_version": ANALYTICS_ENGINE_VERSION,
        "formula_set_version": FORMULA_SET_VERSION,
        "explain": {"formula": "Σ (NormalizationEngine(valor_original) × peso_factor%)", "steps": steps},
    }

    audit_calculation(
        user=user,
        kind="performance_score",
        period=f"{year}-{month:02d}",
        inputs={
            "completed_pct": completed_pct,
            "weighted_overdue": weighted_overdue,
            "consistency_raw": consistency_raw,
            "trazabilidad_raw": trazabilidad["raw"],
            "weights": config,
        },
        result=result,
    )
    return result
