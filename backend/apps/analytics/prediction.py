"""Trend/Predictive Engine — Fase 4l (ver docs/AUDIT_LOG.md § 2026-08-12).
Puerto de `src/lib/analytics.ts` §5 (Detección de anomalías) y §6
(Predicción simple). Ambas leen historial YA calculado
(`compute_monthly_history`/`compute_weekly_history`/`compute_carga_tiempo`/
`compute_consistency`) — ninguna introduce una fuente de datos nueva.
Coordina con Inteligencia Preventiva (fase 7 del roadmap general, fuera
de esta migración de stack), que reutilizará estos mismos archivos."""

from datetime import date, datetime
from datetime import timezone as dt_timezone

from apps.configuration.services import (
    count_business_days,
    get_effective_analytics_config,
    get_holiday_set,
)
from apps.core.rounding import round_half_up
from apps.tasks.business_time import business_calendar_day

from .history import _stddev, compute_consistency, compute_monthly_history, compute_weekly_history
from .scoring import _month_bounds
from .workload import compute_carga_tiempo, monthly_business_base

# ── Detección de anomalías (§5) ────────────────────────────────────────────────


def detect_anomalies(*, user, now: datetime) -> dict:
    """Réplica exacta de `detectAnomalies` — compara carga/cumplimiento/
    actividades de Seguimiento del mes actual contra la media de los
    meses previos con dato (hasta 5), con un umbral configurable
    (`anomaly_variation_threshold_pct`). Severidad "orange" si la
    variación supera 1.5× el umbral, si no "yellow"."""
    config = get_effective_analytics_config(now)
    monthly = compute_monthly_history(user=user, months_back=6, now=now)
    current = monthly[-1]
    history = [m for m in monthly[:-1] if m["total_tasks"] > 0 or m["carga_real_hours"] > 0]
    if len(history) < 3:
        return {"available": False, "reason": "Insuficiente historial para detectar anomalías", "anomalies": []}

    threshold = config["anomaly_variation_threshold_pct"]
    anomalies: list[dict] = []
    checks = [("carga_real_hours", "Carga laboral"), ("completed_pct", "Cumplimiento"), ("seguimiento_count", "Actividades de seguimiento")]
    for key, label in checks:
        values = [m[key] for m in history]
        mean = _stddev(values)["mean"]
        if mean == 0:
            continue
        current_val = current[key]
        variation = ((current_val - mean) / abs(mean)) * 100
        if abs(variation) >= threshold:
            direction = "un incremento" if variation > 0 else "una caída"
            anomalies.append(
                {
                    "type": key,
                    "message": (
                        f"{label}: {direction} del {abs(round_half_up(variation))}% respecto al promedio histórico personal "
                        f"({round_half_up(mean * 10) / 10} → {round_half_up(current_val * 10) / 10})"
                    ),
                    "severity": "orange" if abs(variation) >= threshold * 1.5 else "yellow",
                    "pct_variation": round_half_up(variation),
                }
            )
    return {"available": True, "anomalies": anomalies}


# ── Predicción simple (§6) ──────────────────────────────────────────────────────

PREDICTION_MAX_DAYS = 30

MAX_PREDICTION_CONFIDENCE_PCT = 92


def compute_prediction_confidence_pct(weeks_of_data: int, consistency: dict, days_remaining: int) -> int:
    """Confianza numérica de la predicción, siempre < 100% — ver Sprint 1
    S1-C del TS. Réplica exacta de `computePredictionConfidencePct`."""
    data_score = min(1.0, weeks_of_data / 6)
    if not consistency.get("available"):
        consistency_score = 0.5
    else:
        consistency_score = {"muy-consistente": 1, "consistente": 0.8, "variable": 0.5, "muy-variable": 0.25}[consistency["level"]]
    capped_days_remaining = min(days_remaining, PREDICTION_MAX_DAYS)
    horizon_score = 1 - (capped_days_remaining / PREDICTION_MAX_DAYS) * 0.4
    return round_half_up(MAX_PREDICTION_CONFIDENCE_PCT * (0.4 * data_score + 0.4 * consistency_score + 0.2 * horizon_score))


def _compute_monthly_compliance_pace(*, user, now: datetime) -> float:
    """Reutiliza `compute_monthly_history` (misma Definición A de
    "cumplimiento" que el resto del motor) para el % completado hasta
    hoy. Lo único propio de esta función es la proyección de ritmo
    (extrapolar por días hábiles transcurridos vs. totales del mes).
    Réplica exacta de `computeMonthlyCompliancePace`."""
    today = business_calendar_day(now)
    month_start = date(today.year, today.month, 1)
    holidays = get_holiday_set()
    biz = monthly_business_base(today.year, today.month)
    monthly = compute_monthly_history(user=user, months_back=1, now=now)
    elapsed_business_days = count_business_days(month_start, today, holidays)
    current = monthly[-1]
    if current["total_tasks"] == 0 or elapsed_business_days == 0:
        return 0
    projected = current["completed_pct"] * (biz["business_days"] / elapsed_business_days)
    return min(100, round_half_up(projected))


def compute_prediction(*, user, now: datetime) -> dict:
    """Réplica exacta de `computePrediction`: regresión lineal simple
    sobre horas semanales (6 semanas) para proyectar la carga de la
    próxima semana, proyección de cumplimiento por ritmo, rango de
    confianza (más ancho cuanto menor la confianza), y horas para volver
    al rango óptimo si la carga mensual está en Subutilización.

    `days_remaining` usa `_month_bounds` (`scoring.py`, UTC) en vez de
    reimplementar el `monthBounds` local-time del TS — decisión
    documentada en `docs/AUDIT_LOG.md` § 2026-08-12 (Fase 4l): el resto
    de este backend es deliberadamente UTC-only (`business_time.py`), y
    la diferencia solo afecta un conteo de días redondeado, no una
    fórmula de negocio."""
    config = get_effective_analytics_config(now)
    weekly = compute_weekly_history(user=user, weeks_back=6, now=now)
    with_data = [w for w in weekly if w["business_days"] > 0]
    if len(with_data) < 1:
        return {"available": False, "reason": "Sin historial suficiente"}

    if len(with_data) > 3:
        confidence = "alta"
    elif len(with_data) >= config["prediction_min_weeks_media"]:
        confidence = "media"
    else:
        confidence = "baja"

    n = len(with_data)
    ys = [w["real_hours"] for w in with_data]
    x_mean = (n - 1) / 2
    y_mean = sum(ys) / n
    num = 0.0
    den = 0.0
    for x, y in enumerate(ys):
        num += (x - x_mean) * (y - y_mean)
        den += (x - x_mean) ** 2
    slope = num / den if den != 0 else 0
    carga_proxima_semana_horas = max(0, round_half_up((y_mean + slope * n) * 100) / 100)

    carga_tiempo = compute_carga_tiempo(user=user, now=now)
    cumplimiento_estimado_cierre_mes = _compute_monthly_compliance_pace(user=user, now=now)
    consistency = compute_consistency(user=user, now=now)

    if carga_tiempo["mensual"]["label"] == "Subutilización":
        horas_para_rango_optimo = max(0, round_half_up((carga_tiempo["mensual"]["range_min"] - carga_tiempo["mensual"]["real_hours"]) * 100) / 100)
    else:
        horas_para_rango_optimo = 0

    today = business_calendar_day(now)
    _, month_end = _month_bounds(today.year, today.month)
    today_dt = datetime(today.year, today.month, today.day, tzinfo=dt_timezone.utc)
    days_remaining = max(0, round_half_up((month_end - today_dt).total_seconds() / 86400))

    confidence_pct = compute_prediction_confidence_pct(n, consistency, days_remaining)
    half_width = max(2, round_half_up((100 - confidence_pct) * 0.2))
    cumplimiento_estimado_rango = {
        "min": max(0, cumplimiento_estimado_cierre_mes - half_width),
        "max": min(100, cumplimiento_estimado_cierre_mes + half_width),
    }

    return {
        "available": True,
        "confidence": confidence,
        "confidence_pct": confidence_pct,
        "weeks_of_data": n,
        "carga_proxima_semana_horas": carga_proxima_semana_horas,
        "cumplimiento_estimado_cierre_mes": cumplimiento_estimado_cierre_mes,
        "cumplimiento_estimado_rango": cumplimiento_estimado_rango,
        "horas_para_rango_optimo": horas_para_rango_optimo,
        "max_projection_days": PREDICTION_MAX_DAYS,
    }
