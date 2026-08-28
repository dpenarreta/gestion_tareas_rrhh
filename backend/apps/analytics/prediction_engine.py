"""Prediction Engine (Inteligencia Preventiva, Fase 9 — ver
docs/AUDIT_LOG.md § 2026-08-18). Réplica exacta de
`src/lib/predictionEngine.ts`: 4 predicciones explicables (Cumplimiento,
Sobrecarga, Subutilización, Retrasos) + Estabilidad Operativa, todas
reglas determinísticas sobre datos ya calculados por `history.py`/
`capacity_forecast.py`/`trend_engine.py`. Sin IA, sin persistencia de
negocio nueva (solo lee).

`compute_monthly_compliance_pace`-equivalente no existe en Python (es
privada y de ventana fija en el TS, `analytics.ts`) — la pace de
Cumplimiento se recalcula aquí de forma independiente, misma decisión
ya tomada en el TS original."""

from datetime import date, datetime, timedelta
from datetime import timezone as dt_timezone

from apps.configuration.services import (
    count_business_days,
    get_effective_prediction_window_weeks_number,
    get_holiday_set,
)
from apps.core.rounding import round_half_up
from apps.projects.models import Project, ProjectParticipant
from apps.tasks.business_time import business_calendar_day
from apps.tasks.models import Task
from apps.users.models import User

from .capacity_forecast import compute_capacity_forecast, compute_team_capacity_forecast
from .history import compute_consistency, compute_weekly_history
from .scoring import compute_data_quality
from .trend_engine import compute_trend_engine
from .utils import is_task_overdue
from .workload import get_month_closure_period, monthly_business_base

PREDICTION_ENGINE_VERSION = "1.0.0"

PREDICTION_HORIZONS = (7, 15, 30, 90)

_MAX_CONFIDENCE_PCT = 92


def nearest_horizon(days_remaining: float) -> int:
    """El horizonte fijo más cercano a `days_remaining` — nunca se
    devuelve un horizonte fuera de {7,15,30,90}. Réplica exacta de
    `nearestHorizon`."""
    best = PREDICTION_HORIZONS[0]
    best_diff = float("inf")
    for h in PREDICTION_HORIZONS:
        diff = abs(h - days_remaining)
        if diff < best_diff:
            best_diff = diff
            best = h
    return best


def compute_historical_reliability(weeks_of_data: float, data_quality_pct: float) -> str:
    """Confiabilidad del histórico — volumen de semanas + calidad de
    datos ACTUAL. Deliberadamente un eje distinto de `confidence_pct`:
    dos preguntas distintas: "¿cuánta información hay?" vs. "¿qué tan
    seguro está el modelo de esta predicción puntual?". Réplica exacta
    de `computeHistoricalReliability`."""
    volume_score = min(1, weeks_of_data / 6)
    quality_score = max(0, min(1, data_quality_pct / 100))
    composite = 0.6 * volume_score + 0.4 * quality_score
    if composite >= 0.75:
        return "alta"
    if composite >= 0.45:
        return "media"
    return "baja"


def compute_prediction_confidence(*, data_score: float, consistency_score: float, horizon: int) -> int:
    """40% datos / 40% consistencia / 20% horizonte, parametrizado
    contra el set fijo {7,15,30,90}. Nunca 100%: tope 92%. Réplica
    exacta de `computePredictionConfidence`."""
    max_horizon = PREDICTION_HORIZONS[-1]
    horizon_score = 1 - (horizon / max_horizon) * 0.4
    return round_half_up(_MAX_CONFIDENCE_PCT * (0.4 * data_score + 0.4 * consistency_score + 0.2 * horizon_score))


def _consistency_score_from_level(level: str | None) -> float:
    if level == "muy-consistente":
        return 1.0
    if level == "consistente":
        return 0.8
    if level == "variable":
        return 0.5
    if level == "muy-variable":
        return 0.25
    return 0.5  # sin historial suficiente — mismo neutro que el resto del motor.


def _days_remaining_in_month(now: datetime) -> int:
    """Réplica exacta de `daysRemainingInMonth`, incluyendo su
    granularidad mixta (hoy a medianoche vs. fin de mes a
    23:59:59.999): en el último día calendario del mes, esto devuelve 1
    (no 0) por redondeo — comportamiento heredado del TS, no un bug a
    corregir aquí."""
    today = business_calendar_day(now)
    next_month, next_year = (1, today.year + 1) if today.month == 12 else (today.month + 1, today.year)
    natural_end = date(next_year, next_month, 1) - timedelta(days=1)
    today_dt = datetime(today.year, today.month, today.day, tzinfo=dt_timezone.utc)
    end_dt = datetime(natural_end.year, natural_end.month, natural_end.day, 23, 59, 59, 999000, tzinfo=dt_timezone.utc)
    return max(0, round_half_up((end_dt - today_dt).total_seconds() / 86400))


# ── Predicción de Cumplimiento ──────────────────────────────────────────────


def compute_cumplimiento_projection(*, user, now: datetime | None = None) -> dict:
    """Réplica exacta de `computeCumplimientoProjection`."""
    now = now or datetime.now(dt_timezone.utc)
    window_weeks = get_effective_prediction_window_weeks_number(now)
    today = business_calendar_day(now)
    year, month = today.year, today.month

    weekly = compute_weekly_history(user=user, weeks_back=window_weeks, now=now)
    biz = monthly_business_base(year, month)
    _, _, effective_end = get_month_closure_period(year, month)
    month_start = date(year, month, 1)
    holidays = get_holiday_set()
    consistency = compute_consistency(user=user, now=now)
    data_quality = compute_data_quality(user_ids=[user.id])

    with_data = [w for w in weekly if w["business_days"] > 0]
    if len(with_data) < 1:
        return {"available": False, "reason": "Sin historial suficiente para proyectar el cumplimiento"}

    elapsed_business_days = count_business_days(month_start, today, holidays)
    start_dt = datetime(month_start.year, month_start.month, month_start.day, tzinfo=dt_timezone.utc)
    end_dt = datetime(effective_end.year, effective_end.month, effective_end.day, tzinfo=dt_timezone.utc)
    month_tasks = list(Task.objects.filter(assigned_to=user, end_date__gte=start_dt, end_date__lte=end_dt).only("status"))

    current_completed_pct = (
        round_half_up(len([t for t in month_tasks if t.status == Task.Status.COMPLETADA]) / len(month_tasks) * 100) if month_tasks else 0
    )
    cumplimiento_esperado_cierre_pct = (
        current_completed_pct
        if not month_tasks or elapsed_business_days == 0
        else min(100, round_half_up(current_completed_pct * (biz["business_days"] / elapsed_business_days)))
    )

    window_avg_pct = round_half_up(sum(w["completed_pct"] for w in with_data) / len(with_data))
    variacion_esperada_pct = cumplimiento_esperado_cierre_pct - window_avg_pct

    days_remaining = _days_remaining_in_month(now)
    horizon = nearest_horizon(days_remaining)
    confidence_pct = compute_prediction_confidence(
        data_score=min(1, len(with_data) / window_weeks),
        consistency_score=_consistency_score_from_level(consistency["level"] if consistency.get("available") else None),
        horizon=horizon,
    )
    historical_reliability = compute_historical_reliability(len(with_data), data_quality["pct"])

    return {
        "available": True,
        "horizon": horizon,
        "confidence_pct": confidence_pct,
        "historical_reliability": historical_reliability,
        "historical_window_weeks": window_weeks,
        "cumplimiento_esperado_cierre_pct": cumplimiento_esperado_cierre_pct,
        "variacion_esperada_pct": variacion_esperada_pct,
        "que_ocurrira": f"El cumplimiento esperado al cierre del mes es {cumplimiento_esperado_cierre_pct}%.",
        "por_que": (
            f"Con {elapsed_business_days} de {biz['business_days']} días hábiles transcurridos y "
            f"{current_completed_pct}% completado hasta hoy, el ritmo actual proyecta "
            f"{cumplimiento_esperado_cierre_pct}% al cierre — "
            f"{'por encima' if variacion_esperada_pct >= 0 else 'por debajo'} del promedio de las últimas "
            f"{window_weeks} semanas ({window_avg_pct}%)."
        ),
        "datos_utilizados": [
            f"Historial semanal de cumplimiento (últimas {window_weeks} semanas)",
            f"Días hábiles transcurridos/totales del mes en curso ({elapsed_business_days}/{biz['business_days']})",
            f"Consistencia operativa ({consistency['label'] if consistency.get('available') else 'sin historial suficiente'})",
        ],
        "variables_con_mayor_impacto": [
            "Ritmo de cumplimiento del mes en curso",
            f"Promedio de cumplimiento de las últimas {window_weeks} semanas",
        ],
        "que_hacer": (
            ["Priorizar el cierre de tareas pendientes antes del fin de mes.", "Revisar tareas de prioridad Alta próximas a vencer."]
            if variacion_esperada_pct < 0
            else ["Mantener el ritmo actual de cierre de tareas."]
        ),
    }


# ── Predicción de Sobrecarga ────────────────────────────────────────────────

CAPACITY_BASE_PROBABILITY = {
    "sobrecarga": 90,
    "no-asignar": 65,
    "limitada": 35,
    "alta": 10,
    "sin-planificacion": 20,
}


def compute_sobrecarga_probability(*, user, now: datetime | None = None) -> dict:
    """Réplica exacta de `computeSobrecargaProbability`."""
    now = now or datetime.now(dt_timezone.utc)
    window_weeks = get_effective_prediction_window_weeks_number(now)
    capacity = compute_capacity_forecast(user=user, now=now)
    consistency = compute_consistency(user=user, now=now)
    trend = compute_trend_engine(user=user, now=now)
    data_quality = compute_data_quality(user_ids=[user.id])

    probabilidad_pct = CAPACITY_BASE_PROBABILITY[capacity["estado"]]
    variables = ["Estado de capacidad disponible proyectada"]

    capacidad_trend = trend["indicators"]["capacidad_disponible"]
    if capacidad_trend["available"] and capacidad_trend["direction"] == "negativa":
        probabilidad_pct = min(100, probabilidad_pct + 10)
        variables.append("Tendencia decreciente de capacidad disponible")
    elif capacidad_trend["available"] and capacidad_trend["direction"] == "positiva":
        probabilidad_pct = max(0, probabilidad_pct - 10)
    if consistency.get("available") and consistency["level"] == "muy-variable":
        probabilidad_pct = min(100, probabilidad_pct + 5)
        variables.append("Alta variabilidad en la carga semanal")

    nivel = "Alto" if probabilidad_pct >= 70 else "Medio" if probabilidad_pct >= 40 else "Bajo"
    days_remaining = _days_remaining_in_month(now)
    horizon = nearest_horizon(days_remaining)
    confidence_pct = compute_prediction_confidence(
        data_score=min(1, len(capacidad_trend["data_points"]) / 4) if capacidad_trend["available"] else 0.3,
        consistency_score=_consistency_score_from_level(consistency["level"] if consistency.get("available") else None),
        horizon=horizon,
    )
    historical_reliability = compute_historical_reliability(window_weeks, data_quality["pct"])

    return {
        "available": True,
        "horizon": horizon,
        "confidence_pct": confidence_pct,
        "historical_reliability": historical_reliability,
        "historical_window_weeks": window_weeks,
        "probabilidad_pct": probabilidad_pct,
        "nivel": nivel,
        "que_ocurrira": f"Probabilidad de sobrecarga operativa: {probabilidad_pct}% (nivel {nivel}).",
        "por_que": (
            f'Estado actual de capacidad: "{capacity["estado_label"]}" ({capacity["disponible_pct"]}% disponible)'
            + (f", con tendencia {capacidad_trend['direction']}" if capacidad_trend["available"] else "")
            + "."
        ),
        "datos_utilizados": ["Capacidad disponible proyectada (mes en curso)", "Tendencia de capacidad disponible", "Consistencia operativa"],
        "variables_con_mayor_impacto": variables,
        "que_hacer": (
            [
                "Redistribuir tareas pendientes/en progreso para evitar la sobrecarga proyectada.",
                "Evitar asignar nuevas tareas hasta liberar capacidad.",
            ]
            if nivel != "Bajo"
            else ["Sin acción preventiva necesaria por ahora."]
        ),
    }


# ── Predicción de Subutilización (equipo) ───────────────────────────────────


def compute_subutilizacion_predictions(*, user_ids: list[int], now: datetime | None = None) -> dict[int, dict]:
    """Batch — SIEMPRE usa `compute_team_capacity_forecast` (ya
    agrupado), nunca en loop la función singular (riesgo N+1). Réplica
    exacta de `computeSubutilizacionPredictions`."""
    now = now or datetime.now(dt_timezone.utc)
    result: dict[int, dict] = {}
    if not user_ids:
        return result

    window_weeks = get_effective_prediction_window_weeks_number(now)
    capacity_map = compute_team_capacity_forecast(user_ids=user_ids, now=now)
    days_remaining = _days_remaining_in_month(now)
    horizon = nearest_horizon(days_remaining)

    for user_id in user_ids:
        capacity = capacity_map.get(user_id)
        if not capacity:
            continue
        nivel = "Alto" if capacity["disponible_pct"] >= 70 else "Medio" if capacity["disponible_pct"] >= 40 else "Bajo"
        confidence_pct = compute_prediction_confidence(
            data_score=capacity["confiabilidad"]["pct"] / 100,
            consistency_score=0.5,
            horizon=horizon,
        )
        result[user_id] = {
            "horizon": horizon,
            "confidence_pct": confidence_pct,
            "historical_reliability": (
                "alta" if capacity["confiabilidad"]["pct"] >= 75 else "media" if capacity["confiabilidad"]["pct"] >= 45 else "baja"
            ),
            "historical_window_weeks": window_weeks,
            "nivel": nivel,
            "que_ocurrira": f"Proyección de subutilización: nivel {nivel} ({capacity['disponible_pct']}% de capacidad disponible proyectada).",
            "por_que": (
                f"Capacidad disponible proyectada para lo que resta del mes: {capacity['disponible']}h de "
                f"{capacity['base_futura_total']}h ({capacity['disponible_pct']}%), con solo "
                f"{capacity['comprometido_futuro']}h comprometidas."
            ),
            "datos_utilizados": ["Capacidad disponible proyectada (mes en curso)", "Horas comprometidas futuras (tareas pendientes/en progreso)"],
            "variables_con_mayor_impacto": ["% de capacidad disponible proyectada"],
            "que_hacer": (
                ["Evaluar asignar nuevas tareas o redistribuir carga hacia este colaborador."] if nivel != "Bajo" else ["Sin acción necesaria."]
            ),
        }
    return result


# ── Predicción de Retrasos (tareas y proyectos) ─────────────────────────────


def _compute_delay_score(*, capacity_estado: str, consistency_level: str | None, overdue_count: int, pace_behind: bool = False) -> dict:
    score = 0
    motivos: list[str] = []
    if capacity_estado in ("sobrecarga", "no-asignar"):
        score += 40
        motivos.append("Sobrecarga")
    elif capacity_estado == "limitada":
        score += 15
    if consistency_level == "muy-variable":
        score += 30
        motivos.append("Baja consistencia")
    elif consistency_level == "variable":
        score += 15
        motivos.append("Baja consistencia")
    if overdue_count > 0:
        score += min(30, overdue_count * 10)
        motivos.append("Retrasos recientes")
    if pace_behind and "Retrasos recientes" not in motivos:
        score += 20
        motivos.append("Retrasos recientes")
    return {"probabilidad_pct": min(95, score), "motivos": motivos}


def compute_task_delay_prediction(*, task_id: int, now: datetime | None = None) -> dict:
    """Réplica exacta de `computeTaskDelayPrediction`."""
    now = now or datetime.now(dt_timezone.utc)
    task = Task.objects.filter(pk=task_id).select_related("assigned_to").only("assigned_to", "status", "end_date").first()
    if not task:
        return {"available": False, "reason": "Tarea no encontrada"}
    if task.status == Task.Status.COMPLETADA:
        return {"available": False, "reason": "La tarea ya está completada"}

    window_weeks = get_effective_prediction_window_weeks_number(now)
    assignee = task.assigned_to
    capacity = compute_capacity_forecast(user=assignee, now=now)
    consistency = compute_consistency(user=assignee, now=now)
    open_tasks = list(
        Task.objects.filter(assigned_to_id=task.assigned_to_id, archived_month__isnull=True)
        .exclude(status=Task.Status.COMPLETADA)
        .only("end_date", "status")
    )
    data_quality = compute_data_quality(user_ids=[task.assigned_to_id])

    overdue_count = len([t for t in open_tasks if is_task_overdue(t.end_date, t.status, now)])
    delay = _compute_delay_score(
        capacity_estado=capacity["estado"],
        consistency_level=consistency["level"] if consistency.get("available") else None,
        overdue_count=overdue_count,
    )
    probabilidad_pct, motivos = delay["probabilidad_pct"], delay["motivos"]
    nivel = "Alto" if probabilidad_pct >= 60 else "Medio" if probabilidad_pct >= 30 else "Bajo"

    today = business_calendar_day(now)
    today_dt = datetime(today.year, today.month, today.day, tzinfo=dt_timezone.utc)
    days_remaining = max(0, round_half_up((task.end_date - today_dt).total_seconds() / 86400))
    horizon = nearest_horizon(days_remaining)
    confidence_pct = compute_prediction_confidence(
        data_score=min(1, consistency["weeks_analyzed"] / window_weeks) if consistency.get("available") else 0.3,
        consistency_score=_consistency_score_from_level(consistency["level"] if consistency.get("available") else None),
        horizon=horizon,
    )

    return {
        "available": True,
        "horizon": horizon,
        "confidence_pct": confidence_pct,
        "historical_reliability": compute_historical_reliability(
            consistency["weeks_analyzed"] if consistency.get("available") else 0, data_quality["pct"]
        ),
        "historical_window_weeks": window_weeks,
        "probabilidad_pct": probabilidad_pct,
        "nivel": nivel,
        "motivos": motivos,
        "que_ocurrira": f"Probabilidad de retraso: {probabilidad_pct}% (nivel {nivel}).",
        "por_que": (
            f"Motivos identificados: {', '.join(motivos)}." if motivos else "Sin señales de riesgo identificadas para el responsable de esta tarea."
        ),
        "datos_utilizados": [
            "Capacidad disponible del responsable",
            "Consistencia operativa del responsable",
            "Tareas vencidas actuales del responsable",
        ],
        "variables_con_mayor_impacto": motivos,
        "que_hacer": ["Revisar la carga del responsable y priorizar esta tarea si es crítica."] if motivos else ["Sin acción necesaria."],
    }


def compute_project_delay_prediction(*, project_id: int, now: datetime | None = None) -> dict:
    """Réplica exacta de `computeProjectDelayPrediction`."""
    now = now or datetime.now(dt_timezone.utc)
    project = Project.objects.filter(pk=project_id).only("start_date", "target_date", "target_time_hours", "real_hours", "status").first()
    if not project:
        return {"available": False, "reason": "Proyecto no encontrado"}
    if project.status in (Project.Status.COMPLETADO, Project.Status.CANCELADO):
        return {"available": False, "reason": "El proyecto ya está cerrado"}

    window_weeks = get_effective_prediction_window_weeks_number(now)
    participant_ids = list(ProjectParticipant.objects.filter(project_id=project_id).values_list("user_id", flat=True))
    today = business_calendar_day(now)
    today_dt = datetime(today.year, today.month, today.day, tzinfo=dt_timezone.utc)

    total_span_seconds = max(1, (project.target_date - project.start_date).total_seconds())
    elapsed_seconds = max(0, min(total_span_seconds, (today_dt - project.start_date).total_seconds()))
    elapsed_pct = round_half_up(elapsed_seconds / total_span_seconds * 100)
    executed_pct = round_half_up(project.real_hours / project.target_time_hours * 100) if project.target_time_hours > 0 else 0
    pace_behind = elapsed_pct - executed_pct >= 15

    capacity_estado = "sin-planificacion"
    consistency_level = None
    data_quality_pct = 100.0

    if participant_ids:
        capacity_map = compute_team_capacity_forecast(user_ids=participant_ids, now=now)
        consistencies = [compute_consistency(user=u, now=now) for u in User.objects.filter(id__in=participant_ids)]
        data_quality = compute_data_quality(user_ids=participant_ids)

        estados = [capacity_map[uid]["estado"] for uid in participant_ids if uid in capacity_map]
        if "sobrecarga" in estados:
            capacity_estado = "sobrecarga"
        elif "no-asignar" in estados:
            capacity_estado = "no-asignar"
        elif "limitada" in estados:
            capacity_estado = "limitada"
        elif estados:
            capacity_estado = "alta"

        variable_levels = [c["level"] for c in consistencies if c.get("available")]
        if "muy-variable" in variable_levels:
            consistency_level = "muy-variable"
        elif "variable" in variable_levels:
            consistency_level = "variable"
        elif variable_levels:
            consistency_level = "consistente"
        data_quality_pct = data_quality["pct"]

    delay = _compute_delay_score(capacity_estado=capacity_estado, consistency_level=consistency_level, overdue_count=0, pace_behind=pace_behind)
    probabilidad_pct, motivos = delay["probabilidad_pct"], delay["motivos"]
    nivel = "Alto" if probabilidad_pct >= 60 else "Medio" if probabilidad_pct >= 30 else "Bajo"

    days_remaining = max(0, round_half_up((project.target_date - today_dt).total_seconds() / 86400))
    horizon = nearest_horizon(days_remaining)
    confidence_pct = compute_prediction_confidence(
        data_score=min(1, 0.7 if participant_ids else 0.3),
        consistency_score=_consistency_score_from_level(consistency_level),
        horizon=horizon,
    )

    return {
        "available": True,
        "horizon": horizon,
        "confidence_pct": confidence_pct,
        "historical_reliability": compute_historical_reliability(window_weeks, data_quality_pct),
        "historical_window_weeks": window_weeks,
        "probabilidad_pct": probabilidad_pct,
        "nivel": nivel,
        "motivos": motivos,
        "que_ocurrira": f"Probabilidad de retraso del proyecto: {probabilidad_pct}% (nivel {nivel}).",
        "por_que": (
            f"Avance ejecutado {executed_pct}% vs. {elapsed_pct}% del tiempo transcurrido" + (f"; motivos: {', '.join(motivos)}" if motivos else "") + "."
        ),
        "datos_utilizados": [
            "Horas ejecutadas vs. tiempo objetivo del proyecto",
            "Tiempo transcurrido vs. fecha objetivo",
            "Capacidad y consistencia de los participantes",
        ],
        "variables_con_mayor_impacto": motivos,
        "que_hacer": ["Revisar el ritmo de ejecución del proyecto y la carga de sus participantes."] if motivos else ["Sin acción necesaria."],
    }


# ── Estabilidad Operativa ───────────────────────────────────────────────────


def compute_operational_stability(*, user, now: datetime | None = None) -> dict:
    """Puramente derivado de la volatilidad ya calculada por el Trend
    Engine — no modifica ningún KPI existente. Réplica exacta de
    `computeOperationalStability`."""
    now = now or datetime.now(dt_timezone.utc)
    trend = compute_trend_engine(user=user, now=now)
    available = [i for i in trend["indicators"].values() if i["available"]]
    if not available:
        return {"classification": "Baja", "average_coefficient_of_variation": 0, "based_on": []}
    avg_cv = round_half_up((sum(i["coefficient_of_variation"] for i in available) / len(available)) * 10) / 10
    classification = (
        "Muy Alta"
        if avg_cv < 10
        else "Alta"
        if avg_cv < 20
        else "Media"
        if avg_cv < 35
        else "Baja"
        if avg_cv < 50
        else "Muy Baja"
    )
    based_on = [
        i["label"]
        for i in sorted((i for i in available if i["coefficient_of_variation"] >= 20), key=lambda i: i["coefficient_of_variation"], reverse=True)
    ]
    return {"classification": classification, "average_coefficient_of_variation": avg_cv, "based_on": based_on}
