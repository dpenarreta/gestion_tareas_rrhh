"""Equilibrio Operativo (Health Score) — Fase 4g (ver
docs/AUDIT_LOG.md § 2026-08-11). Réplica exacta de `computeHealthScore`
(`src/lib/analytics.ts`). A diferencia de Performance Score (Fase 4e),
NO usa NormalizationEngine/curvas — sus 4 funciones de score ya
producen directamente un valor 0-100, solo se pasan por
`weighted_points` para ponderar."""

from datetime import datetime

from apps.configuration.services import get_effective_analytics_config
from apps.core.rounding import round_half_up
from apps.tasks.business_time import business_calendar_day
from apps.tasks.models import Task

from .capacity_forecast import compute_capacity_forecast
from .history import compute_consistency
from .models import ANALYTICS_ENGINE_VERSION
from .scoring import _month_bounds, audit_calculation, compute_completed_pct_any, weighted_points
from .utils import is_task_overdue
from .workload import compute_carga_tiempo, monthly_business_base


def carga_health_score(real_hours: float, base_hours: float, limit_high_hours: float, limit_overload_hours: float) -> int:
    """Mapea horas reales del mes a un puntaje 0-100 usando los 4
    límites REALES (no el % con techo en 100 usado para mostrar el
    semáforo) — Óptimo=100, decrece simétricamente hacia ambos
    extremos. Réplica exacta de `cargaHealthScore`."""
    if base_hours <= 0:
        return 100
    if base_hours <= real_hours <= limit_high_hours:
        return 100
    if real_hours < base_hours:
        return round_half_up(max(0.0, min(100.0, (real_hours / base_hours) * 100)))
    over_by = real_hours - limit_high_hours
    span = max((limit_overload_hours - limit_high_hours) * 2, 1)
    return round_half_up(max(0.0, 100 - (over_by / span) * 100))


def _consistency_to_score(consistency: dict) -> int:
    """Réplica exacta de `consistencyToScore` — 70 neutro sin
    historial suficiente."""
    if not consistency.get("available"):
        return 70
    return {"muy-consistente": 100, "consistente": 80, "variable": 55, "muy-variable": 25}[consistency["level"]]


def capacity_to_score(estado: str, disponible_pct: float) -> int:
    """Réplica exacta de `capacityToScore`. El estado `sobrecarga`
    decrece linealmente (`100 + 2×pct`, acotado a [0,100]) en vez de
    caer directo a 0 — único cambio matemático autorizado del Sprint
    Analytics 2.0 Bloque 9. El resto de los estados NO cambia."""
    if estado == "alta":
        return 100
    if estado == "limitada":
        return 70
    if estado == "sin-planificacion":
        return 70
    if estado == "sobrecarga":
        return max(0, round_half_up(100 + 2 * disponible_pct))
    return 40


# --- Estado Operativo — 5 niveles (Sprint Analytics 2.0 Bloque 11/12) -----------
# Capa de PRESENTACIÓN adicional sobre el score de compute_health_score — no
# reemplaza "classification"/"classification_color" (que se conservan con sus
# 4 valores de siempre). Escala genuinamente nueva, cortes en 90/75/60/40.

ESTADO_OPERATIVO_TIERS: list[dict] = [
    {"min": 90, "estado": "Equilibrio Óptimo", "color": "green", "emoji": "🟢", "rango": "90–100", "explicacion_ejecutiva": "Puede asumir nuevos desafíos."},
    {"min": 75, "estado": "Equilibrio Estable", "color": "blue", "emoji": "🔵", "rango": "75–89", "explicacion_ejecutiva": "Operación saludable."},
    {"min": 60, "estado": "Requiere Atención", "color": "yellow", "emoji": "🟡", "rango": "60–74", "explicacion_ejecutiva": "Se recomienda seguimiento."},
    {"min": 40, "estado": "Riesgo Operativo", "color": "orange", "emoji": "🟠", "rango": "40–59", "explicacion_ejecutiva": "Es conveniente intervenir."},
    {"min": 0, "estado": "Desequilibrio Crítico", "color": "red", "emoji": "🔴", "rango": "0–39", "explicacion_ejecutiva": "Se recomienda una revisión inmediata."},
]

# Escala de interpretación completa — para mostrarla siempre visible, no solo
# el nivel del score actual.
ESCALA_INTERPRETACION_EQUILIBRIO = ESTADO_OPERATIVO_TIERS


def classify_estado_operativo(score: float) -> dict:
    """Réplica exacta de `classifyEstadoOperativo`."""
    tier = next((t for t in ESTADO_OPERATIVO_TIERS if score >= t["min"]), ESTADO_OPERATIVO_TIERS[-1])
    return {k: v for k, v in tier.items() if k != "min"}


def compute_health_score(*, user, now: datetime, precomputed_consistency: dict | None = None) -> dict:
    """Réplica exacta de `computeHealthScore`. `precomputed_consistency`
    evita recalcular la misma consulta cuando esta función se invoque
    desde un pipeline mayor (sub-fase futura) que ya la calculó."""
    config = get_effective_analytics_config(now)
    today = business_calendar_day(now)
    year, month = today.year, today.month
    start, end = _month_bounds(year, month)

    tasks = list(
        Task.objects.filter(assigned_to=user, end_date__gte=start, end_date__lte=end).only("status", "priority", "end_date")
    )
    carga_tiempo = compute_carga_tiempo(user=user, now=now)
    capacity = compute_capacity_forecast(user=user, now=now)
    consistency = precomputed_consistency if precomputed_consistency is not None else compute_consistency(user=user, now=now)
    biz = monthly_business_base(year, month)

    completed_pct = compute_completed_pct_any(tasks, empty_value=100)
    overdue = [t for t in tasks if is_task_overdue(t.end_date, t.status, now)]
    overdue_alta = sum(1 for t in overdue if t.priority == Task.Priority.ALTA)
    overdue_normal = len(overdue) - overdue_alta

    carga_score = carga_health_score(
        carga_tiempo["mensual"]["real_hours"], biz["limit_base_hours"], biz["limit_high_hours"], biz["limit_overload_hours"]
    )
    overdue_score = max(0, 100 - overdue_normal * 10 - overdue_alta * 20)
    consistency_score = _consistency_to_score(consistency)
    capacity_score = capacity_to_score(capacity["estado"], capacity["disponible_pct"])

    def mk(name: str, raw_label: str, weight_key: str, raw_score: float) -> dict:
        weight = config[weight_key]
        points = weighted_points(raw_score, weight)
        return {"name": name, "raw_label": raw_label, "weight": weight, "points": points, "detail": f"{raw_label} × {weight}% = {points} pts"}

    factors = [
        mk("Cumplimiento", f"{completed_pct}%", "health_weight_cumplimiento", completed_pct),
        mk(
            "Carga laboral", f"{carga_tiempo['mensual']['label']} ({carga_tiempo['mensual']['pct']}%)",
            "health_weight_carga", carga_score,
        ),
        mk("Tareas vencidas", f"{len(overdue)}", "health_weight_vencidas", overdue_score),
        mk(
            "Consistencia", consistency["label"] if consistency.get("available") else "Sin historial suficiente",
            "health_weight_consistencia", consistency_score,
        ),
        mk("Capacidad futura", f"{capacity['disponible_pct']}%", "health_weight_capacidad", capacity_score),
    ]

    score = round_half_up(sum(f["points"] for f in factors), 2)
    classification = "Excelente" if score >= 90 else "Bueno" if score >= 75 else "Riesgo" if score >= 60 else "Crítico"
    classification_color = "green" if score >= 75 else ("yellow" if score >= 60 else "red")

    steps = [f"{f['name']} {f['raw_label']} × {f['weight']}% = {f['points']} pts" for f in factors]
    steps.append(f"Total: {score} → {classification}")

    result = {
        "score": score,
        "classification": classification,
        "classification_color": classification_color,
        "factors": factors,
        "engine_version": ANALYTICS_ENGINE_VERSION,
        "explain": {"formula": "Σ (valor_normalizado_factor × peso_factor%)", "steps": steps},
    }

    audit_calculation(
        user=user,
        kind="health_score",
        period=f"{year}-{month:02d}",
        inputs={
            "completed_pct": completed_pct,
            "carga_score": carga_score,
            "overdue_score": overdue_score,
            "consistency_score": consistency_score,
            "capacity_score": capacity_score,
            "weights": config,
        },
        result=result,
    )
    return result
