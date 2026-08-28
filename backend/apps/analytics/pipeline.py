"""Validación de consistencia + Pipeline orquestador — Fase 4l (ver
docs/AUDIT_LOG.md § 2026-08-12). Puerto de `src/lib/analytics.ts` §S3-C
(Validación de consistencia entre KPIs) y el "Pipeline único del motor"
(§Sprint 4 S4-F). Con esta pieza, todos los KPIs individuales de
`analytics.ts` quedan ensamblables desde un solo punto de entrada
(`run_analytics_pipeline`), igual que en el TS.

NO se porta el objeto `diagnostics` (contador de `cacheHits`/
`cacheMisses`/`validationsRun` en memoria del proceso Next.js) — es
instrumentación de proceso sin consumidor en Django todavía, no una
regla de negocio (ver docs/AUDIT_LOG.md § 2026-08-12, Fase 4l)."""

import math
from datetime import datetime

from apps.core.rounding import round_half_up
from apps.tasks.business_time import business_calendar_day

from .alerts_engine import compute_alerts, get_resolved_alerts_history
from .capacity_forecast import compute_capacity_forecast
from .health_score import compute_health_score
from .history import compute_consistency, compute_trends
from .performance_score import compute_performance_score
from .prediction import compute_prediction, detect_anomalies
from .scoring import audit_calculation, compute_data_quality


def _round2(x: float) -> float:
    """`Math.round_half_up(x*100)/100` — a diferencia del `round_half_up()` nativo de
    Python, `Math.round` en JS nunca lanza con `Infinity`/`NaN` (los
    devuelve tal cual). Este helper preserva ese comportamiento para que
    `valor_no_finito` (más abajo) sea quien detecte el problema, en vez
    de que `round_half_up()` reviente antes de llegar a ese chequeo."""
    return x if not math.isfinite(x) else round_half_up(x * 100) / 100


def validate_analytics_consistency(*, user, health_score: dict, performance_score: dict, prediction: dict, capacity: dict, now: datetime) -> list[dict]:
    """Réplica exacta de `validateAnalyticsConsistency` — 6 chequeos de
    sanidad matemática sobre KPIs YA CALCULADOS (nunca recalcula nada).
    Audita en `AnalyticsAuditLog` (kind="validation_failure",
    best-effort vía `audit_calculation`) solo si hay fallas — nunca
    bloquea la respuesta del caller."""
    failures: list[dict] = []

    if capacity["disponible"] > capacity["base_futura_total"] + 0.01:
        failures.append(
            {"rule": "capacidad_excede_base", "detail": f"Disponible ({capacity['disponible']}h) > base futura ({capacity['base_futura_total']}h)"}
        )
    if capacity["comprometido_futuro"] < 0:
        failures.append({"rule": "comprometido_negativo", "detail": f"Comprometido futuro negativo ({capacity['comprometido_futuro']}h)"})

    sum_health_factors = _round2(sum(f["points"] for f in health_score["factors"]))
    if abs(sum_health_factors - health_score["score"]) > 0.5:
        failures.append(
            {"rule": "score_no_coincide", "detail": f"Suma de factores del Score Legacy ({sum_health_factors}) ≠ score ({health_score['score']})"}
        )
    sum_perf_factors = _round2(sum(f["points"] for f in performance_score["factors"]))
    if abs(sum_perf_factors - performance_score["score"]) > 0.5:
        failures.append(
            {
                "rule": "performance_score_no_coincide",
                "detail": f"Suma de factores del Performance Score ({sum_perf_factors}) ≠ score ({performance_score['score']})",
            }
        )

    if performance_score["score"] > 100 or performance_score["score"] < 0:
        failures.append({"rule": "performance_score_fuera_de_rango", "detail": f"Performance Score {performance_score['score']} fuera de [0,100]"})

    if prediction.get("available") and (not prediction.get("confidence") or prediction["weeks_of_data"] <= 0):
        failures.append({"rule": "prediccion_incompleta", "detail": "Predicción disponible sin confianza o sin semanas de datos"})

    numeric_values = [capacity["disponible"], capacity["base_futura_total"], capacity["comprometido_futuro"], health_score["score"], performance_score["score"]]
    if prediction.get("available"):
        numeric_values += [prediction["confidence_pct"], prediction["cumplimiento_estimado_cierre_mes"]]
    if any(not math.isfinite(n) for n in numeric_values):
        failures.append({"rule": "valor_no_finito", "detail": "Se detectó NaN o Infinity en un valor calculado"})

    if failures:
        today = business_calendar_day(now)
        year, month = today.year, today.month
        audit_calculation(
            user=user, kind="validation_failure", period=f"{year}-{month:02d}",
            inputs={}, result={"failures": failures, "detected_at": now.isoformat()},
        )

    return failures


def run_analytics_pipeline(*, user, now: datetime) -> dict:
    """Réplica exacta de `runAnalyticsPipeline` — ensambla, en el mismo
    orden documentado en el TS (leer → calidad → KPIs → validar →
    anomalías → alertas), todos los KPIs individuales ya portados. Sin
    `Promise.all`: Django/estas funciones ya son síncronas, se llaman en
    secuencia (mismo criterio ya usado en `compute_alerts`, que también
    combina varias dependencias sin paralelismo)."""
    # 1+2. Leer datos y validar su calidad ANTES de calcular ningún KPI.
    data_quality = compute_data_quality(user_ids=[user.id])

    # 3. Calcular KPIs — Consistencia se calcula UNA vez y se reutiliza en
    # Equilibrio Operativo y Performance Score.
    consistency = compute_consistency(user=user, now=now)
    health_score = compute_health_score(user=user, now=now, precomputed_consistency=consistency)
    performance_score = compute_performance_score(user=user, now=now, precomputed_consistency=consistency)
    trends = compute_trends(user=user, now=now)
    prediction = compute_prediction(user=user, now=now)

    # 4. Validar consistencia matemática entre los KPIs recién calculados.
    capacity = compute_capacity_forecast(user=user, now=now)
    validation_failures = validate_analytics_consistency(
        user=user, health_score=health_score, performance_score=performance_score, prediction=prediction, capacity=capacity, now=now
    )

    # 5. Detectar anomalías respecto al historial personal.
    anomalies = detect_anomalies(user=user, now=now)

    # 6. Generar recomendaciones (alertas automáticas + su historial resuelto).
    alerts = compute_alerts(user=user, now=now)
    alerts_history = get_resolved_alerts_history(user=user, current_alerts=alerts, now=now) if len(alerts) == 0 else []

    return {
        "data_quality": data_quality,
        "health_score": health_score,
        "performance_score": performance_score,
        "consistency": consistency,
        "trends": trends,
        "prediction": prediction,
        "anomalies": anomalies,
        "alerts": alerts,
        "alerts_history": alerts_history,
        "validation_failures": validation_failures,
    }
