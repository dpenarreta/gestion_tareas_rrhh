"""Trend Engine (Inteligencia Preventiva, Fase 9 — ver docs/AUDIT_LOG.md
§ 2026-08-18). Réplica exacta de `src/lib/trendEngine.ts`: capa de SOLO
LECTURA que detecta dirección/estabilidad de 8 indicadores a partir de
historial YA CALCULADO por el motor central (`history.py`/
`audit_history.py`). Nunca recalcula un KPI, nunca escribe en
AnalyticsAuditLog, nunca usa IA — toda clasificación es regresión
lineal (OLS) y coeficiente de variación, funciones puras sin llamada
externa.

"Consultas" (consultas a Nova) queda fuera de alcance: no existe
ninguna tabla que registre preguntas hechas al asistente — mismo
alcance que el TS original (ver docs/ROADMAP.md)."""

import re
from datetime import datetime, timedelta
from datetime import timezone as dt_timezone

from apps.configuration.services import get_effective_prediction_window_weeks_number
from apps.core.rounding import round_half_up
from apps.projects.models import ProjectActivity
from apps.tasks.business_time import business_calendar_day, business_day_real_range
from apps.tasks.models import TaskActivity

from .audit_history import get_factor_audit_history, get_score_series
from .history import compute_consistency, compute_weekly_history
from .workload import _utc_week_start

TREND_ENGINE_VERSION = "1.0.0"

TREND_INDICATORS = (
    "cumplimiento",
    "productividad",
    "horas_registradas",
    "consistencia_operativa",
    "capacidad_disponible",
    "equilibrio_operativo",
    "proyectos",
    "actividades",
)

INDICATOR_LABEL = {
    "cumplimiento": "Cumplimiento",
    "productividad": "Productividad",
    "horas_registradas": "Horas registradas",
    "consistencia_operativa": "Consistencia Operativa",
    "capacidad_disponible": "Capacidad Disponible",
    "equilibrio_operativo": "Equilibrio Operativo",
    "proyectos": "Proyectos",
    "actividades": "Actividades",
}


# ── Clasificador puro (sin BD) — deliberadamente independiente de la
# regresión inline de compute_prediction (prediction_engine.py):
# extraerla como helper compartido implicaría tocar un archivo de
# fórmulas protegido para esta fase. Duplicación pequeña y documentada,
# no un descuido — misma decisión ya tomada en el TS original (ver
# docs/AUDIT_LOG.md § 2026-08-18).


def _linear_slope(values: list[float]) -> float:
    n = len(values)
    if n < 2:
        return 0.0
    x_mean = (n - 1) / 2
    y_mean = sum(values) / n
    num = sum((x - x_mean) * (y - y_mean) for x, y in enumerate(values))
    den = sum((x - x_mean) ** 2 for x in range(n))
    return num / den if den != 0 else 0.0


def _residuals(values: list[float], slope: float) -> list[float]:
    """Residuos respecto a la recta de regresión (valor real - valor
    esperado por la tendencia). Trabajar sobre el residuo, no sobre el
    valor crudo, es lo que separa "hay una tendencia" de "esto es
    ruidoso"."""
    n = len(values)
    x_mean = (n - 1) / 2
    y_mean = sum(values) / n
    return [v - (y_mean + slope * (x - x_mean)) for x, v in enumerate(values)]


def _residual_coefficient_of_variation(values: list[float], resid: list[float]) -> float:
    """CV de los residuos (ruido tras remover la tendencia) como % de la
    media de la serie — mide variabilidad real, no la dispersión que la
    propia tendencia ya explica."""
    if not values:
        return 0.0
    mean = sum(values) / len(values)
    if mean == 0:
        return 0.0
    variance = sum(r**2 for r in resid) / len(resid)
    return (variance**0.5 / abs(mean)) * 100


def _has_abrupt_change(resid: list[float]) -> bool:
    """El residuo del último punto se aparta más de 2 desviaciones
    estándar de los residuos anteriores — un salto puntual, no
    variabilidad sostenida."""
    if len(resid) < 4:
        return False
    prior = resid[:-1]
    last = resid[-1]
    prior_mean = sum(prior) / len(prior)
    variance = sum((r - prior_mean) ** 2 for r in prior) / len(prior)
    sd = variance**0.5
    if sd == 0:
        return abs(last - prior_mean) > 1e-9
    return abs(last - prior_mean) > 2 * sd


def classify_trend_direction(values: list[float]) -> dict:
    """positiva/negativa/estable: pendiente relativa a la media, umbral
    3%/semana. variable: CV de residuos >= 35 — CV de RESIDUOS, no del
    valor crudo, para no confundir una tendencia fuerte con ruido.
    cambio_brusco: el último punto rompe el patrón de los anteriores —
    se evalúa antes que "variable". Réplica exacta de
    `classifyTrendDirection`."""
    slope = _linear_slope(values)
    if len(values) < 2:
        return {"direction": "estable", "slope": slope, "cv": 0.0}
    resid = _residuals(values, slope)
    cv = round_half_up(_residual_coefficient_of_variation(values, resid) * 10) / 10
    if _has_abrupt_change(resid):
        return {"direction": "cambio_brusco", "slope": slope, "cv": cv}
    if cv >= 35:
        return {"direction": "variable", "slope": slope, "cv": cv}
    mean = sum(values) / len(values)
    relative_slope_pct = (slope / abs(mean)) * 100 if mean != 0 else 0.0
    if abs(relative_slope_pct) < 3:
        return {"direction": "estable", "slope": slope, "cv": cv}
    return {"direction": "positiva" if relative_slope_pct > 0 else "negativa", "slope": slope, "cv": cv}


def _unavailable(indicator: str, reason: str) -> dict:
    return {
        "indicator": indicator,
        "label": INDICATOR_LABEL[indicator],
        "available": False,
        "reason": reason,
        "direction": "estable",
        "slope": 0,
        "coefficient_of_variation": 0,
        "data_points": [],
    }


def _from_series(indicator: str, points: list[dict], min_points: int = 2) -> dict:
    if len(points) < min_points:
        return _unavailable(indicator, "Sin historial suficiente para evaluar la tendencia")
    classified = classify_trend_direction([p["value"] for p in points])
    return {
        "indicator": indicator,
        "label": INDICATOR_LABEL[indicator],
        "available": True,
        "direction": classified["direction"],
        "slope": round_half_up(classified["slope"] * 100) / 100,
        "coefficient_of_variation": classified["cv"],
        "data_points": points,
    }


_LEADING_FLOAT_RE = re.compile(r"^\s*[+-]?(\d+\.?\d*|\.\d+)")


def _parse_pct_label(raw_label: str | None) -> float | None:
    """"42%" → 42 — réplica de `parsePctLabel`, que en el TS usa
    `parseFloat` (extrae el prefijo numérico y descarta el resto, no
    exige que la cadena completa sea un número)."""
    if not raw_label:
        return None
    match = _LEADING_FLOAT_RE.match(raw_label)
    if not match:
        return None
    return float(match.group(0))


def compute_trend_engine(*, user, now: datetime | None = None, window_weeks_override: int | None = None) -> dict:
    """`window_weeks_override` — para Tendencias Históricas, que ofrece
    ventanas independientes (3/4/8 semanas, 3/6 meses, 1 año) distintas
    de la Ventana Histórica de Predicción configurada globalmente. Sin
    override, se usa la configuración global. Réplica exacta de
    `computeTrendEngine`."""
    now = now or datetime.now(dt_timezone.utc)
    window_weeks = window_weeks_override or get_effective_prediction_window_weeks_number(now)
    window_days = window_weeks * 7

    today = business_calendar_day(now)
    current_week_start = _utc_week_start(today)
    # Mismos límites de semana que `compute_weekly_history` — para que
    # "Proyectos"/"Actividades" (indicadores sin función existente que
    # los calcule) queden bucketeados con el mismo criterio lun-vie que
    # el resto del motor, en vez de inventar un agrupamiento distinto.
    weeks = []
    for i in range(window_weeks):
        start = current_week_start - timedelta(days=(window_weeks - i) * 7)
        end = start + timedelta(days=4)
        weeks.append({"start": start, "end": end, "label": f"Sem {i + 1}"})

    range_real_start, _ = business_day_real_range(weeks[0]["start"])
    _, range_real_end = business_day_real_range(weeks[-1]["end"])

    weekly_history = compute_weekly_history(user=user, weeks_back=window_weeks, now=now)
    perf_series = get_score_series(user=user, kind="performance_score", now=now, window_days=window_days)
    health_series = get_score_series(user=user, kind="health_score", now=now, window_days=window_days)
    consistency_now = compute_consistency(user=user, now=now)
    consistency_prev = compute_consistency(user=user, now=now - timedelta(days=window_days))
    capacity_audit = get_factor_audit_history(user=user, kind="health_score", now=now, window_days=window_days)
    project_activities = list(
        ProjectActivity.objects.filter(author=user, created_at__gte=range_real_start, created_at__lte=range_real_end).only(
            "created_at", "duration"
        )
    )
    task_activities = list(
        TaskActivity.objects.filter(author=user, created_at__gte=range_real_start, created_at__lte=range_real_end).only("created_at")
    )

    with_registration = [w for w in weekly_history if w["business_days"] > 0]

    capacity_points = []
    for p in sorted(capacity_audit, key=lambda p: p["created_at"]):
        factor = next((f for f in p["factors"] if f["name"] == "Capacidad futura"), None)
        value = _parse_pct_label(factor["raw_label"] if factor else None)
        if value is not None:
            capacity_points.append({"label": p["created_at"].date().isoformat(), "value": value})

    if consistency_now.get("available") and consistency_prev.get("available"):
        consistencia_indicator = _from_series(
            "consistencia_operativa",
            [
                {"label": "Ventana anterior", "value": consistency_prev["consistency_pct"]},
                {"label": "Ventana actual", "value": consistency_now["consistency_pct"]},
            ],
        )
    else:
        reason = consistency_now.get("reason") if not consistency_now.get("available") else consistency_prev.get("reason")
        consistencia_indicator = _unavailable("consistencia_operativa", reason)

    proyectos_points = []
    actividades_points = []
    for w in weeks:
        ds, de = business_day_real_range(w["start"])
        _, we = business_day_real_range(w["end"])
        minutes = sum(a.duration for a in project_activities if ds <= a.created_at <= we)
        proyectos_points.append({"label": w["label"], "value": round_half_up(minutes / 60 * 100) / 100})
        count = len([a for a in task_activities if ds <= a.created_at <= we])
        actividades_points.append({"label": w["label"], "value": count})

    indicators = {
        "cumplimiento": _from_series(
            "cumplimiento", [{"label": f"Sem {i + 1}", "value": w["completed_pct"]} for i, w in enumerate(with_registration)]
        ),
        "horas_registradas": _from_series(
            "horas_registradas", [{"label": f"Sem {i + 1}", "value": w["real_hours"]} for i, w in enumerate(with_registration)]
        ),
        "productividad": _from_series("productividad", [{"label": p["date"][:10], "value": p["score"]} for p in perf_series]),
        "equilibrio_operativo": _from_series(
            "equilibrio_operativo", [{"label": p["date"][:10], "value": p["score"]} for p in health_series]
        ),
        "consistencia_operativa": consistencia_indicator,
        # NO se usa `compute_capacity_forecast` con `now` retroactivo — el
        # estado de `Task.status` es mutable y sin historial propio, así
        # que retroceder `now` mezclaría el cálculo de negocio del pasado
        # con asignaciones de HOY. Se usa en cambio lo que el motor ya
        # capturó realmente en cada corrida pasada, vía el factor
        # "Capacidad futura" de Equilibrio Operativo en AnalyticsAuditLog.
        "capacidad_disponible": _from_series("capacidad_disponible", capacity_points),
        # "Proyectos"/"Actividades" siempre tienen window_weeks puntos
        # (cero es un valor válido, no "sin dato") — mínimo = la ventana
        # completa, no 2.
        "proyectos": _from_series("proyectos", proyectos_points, window_weeks),
        "actividades": _from_series("actividades", actividades_points, window_weeks),
    }

    return {
        "user_id": user.id,
        "window_weeks": window_weeks,
        "indicators": indicators,
        "engine_version": TREND_ENGINE_VERSION,
        "generated_at": now.isoformat(),
    }
