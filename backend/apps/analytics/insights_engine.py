"""Motor de Insights (Sprint 6 — Decision Intelligence Engine) — Fases 4j
y 4k (ver docs/AUDIT_LOG.md § 2026-08-12). Puerto COMPLETO de
`src/lib/insightsEngine.ts` (999 líneas), en 2 sub-fases:
- **4j**: el núcleo consumido directamente por el panel de Insights —
  confianza, insights de Performance/Equilibrio, plantillas de
  significado/impacto, el orquestador `computeInsights` y la explicación
  de tendencia de score.
- **4k**: relaciones entre indicadores (S6-C), benchmark personal (S6-D),
  reevaluación de recomendaciones (S6-G) y priorización (S6-H).

Construye interpretación y apoyo a la decisión ENCIMA de los KPIs ya
calculados por `performance_score.py`/`health_score.py`/
`operational_risk.py`. NUNCA recalcula un KPI de negocio ni usa IA/ML para
calcular: solo compone, correlaciona con reglas determinísticas, compara
contra el historial propio del colaborador (`AnalyticsAuditLog`, sin tabla
nueva) y prioriza. Sin endpoint HTTP todavía (mismo criterio que las
sub-fases anteriores)."""

from datetime import datetime, timedelta

from apps.configuration.services import get_effective_analytics_config
from apps.core.rounding import round_half_up

from .audit_history import AuditKind, closest_factor_point, get_factor_audit_history
from .explain import derived_normalized_value, score_level
from .history import compute_monthly_history
from .models import AnalyticsAuditLog
from .normalization import get_effective_curve, normalize
from .workload import _utc_week_start

INSIGHTS_ENGINE_VERSION = "1.0.0"

# ── S6-F: Confianza de los Insights (★ 1-5) ──────────────────────────────────

CONFIDENCE_LABEL = {5: "Muy alta", 4: "Alta", 3: "Media", 2: "Baja", 1: "Muy baja"}


def compute_confidence(*, observations: int, data_quality_pct: float, consistent: bool | None, max_observations: int = 6) -> dict:
    """Compuesto de: cantidad de observaciones históricas, calidad del
    dato y consistencia — nunca depende de Gemini. Réplica exacta de
    `computeConfidence`."""
    data_score = max(0.0, min(1.0, observations / max_observations))
    quality_score = max(0.0, min(1.0, data_quality_pct / 100))
    consistency_score = 0.5 if consistent is None else (1 if consistent else 0.3)
    composite = data_score * 0.4 + quality_score * 0.35 + consistency_score * 0.25
    stars = 5 if composite >= 0.85 else 4 if composite >= 0.65 else 3 if composite >= 0.45 else 2 if composite >= 0.25 else 1
    return {"stars": stars, "label": CONFIDENCE_LABEL[stars]}


# ── S6-A: Motor de Insights (4 bloques) ──────────────────────────────────────

FACTOR_EXPLANATION = {
    "Sobrecarga proyectada": "Relación observada: las horas comprometidas en tareas pendientes o en progreso superan la base laboral disponible para lo que resta del mes.",
    "Tareas críticas vencidas": "Posible causa principal: acumulación de tareas de prioridad Alta sin cerrar dentro del plazo comprometido.",
    "Horas extras recurrentes": "Relación observada: registro de horas en fin de semana por encima del promedio histórico personal.",
    "Baja capacidad futura (<10%)": "Posible causa principal: la carga ya comprometida deja muy poco margen sobre la base laboral restante del mes.",
    "Variabilidad excesiva entre semanas": "Relación observada: el ritmo de horas trabajadas y tareas completadas varía fuertemente semana a semana (coeficiente de variación alto).",
    "Alta concentración en un solo tipo de actividad": "Posible causa principal: un solo motivo de consulta concentra la mayoría del tiempo de Seguimiento del período.",
    "Muchas tareas sin planificación": "Relación observada: varias tareas abiertas no tienen tiempo objetivo definido, lo que reduce la confiabilidad de la proyección de capacidad.",
}

FACTOR_ACTION = {
    "Sobrecarga proyectada": lambda f: {
        "what": "Redistribuir tareas pendientes o en progreso hacia un compañero con capacidad disponible.",
        "who": "El coordinador directo del colaborador.",
        "how_much": f["detail"],
        "when": "Esta semana, antes de asignar trabajo nuevo.",
    },
    "Tareas críticas vencidas": lambda f: {
        "what": "Priorizar el cierre inmediato de las tareas de prioridad Alta vencidas.",
        "who": "El colaborador y su coordinador directo.",
        "how_much": f["detail"],
        "when": "Hoy.",
    },
    "Tendencia negativa de cumplimiento": lambda f: {
        "what": "Revisar con el colaborador las causas de la caída y reajustar prioridades de la semana.",
        "who": "El coordinador directo.",
        "how_much": f["detail"],
        "when": "En la próxima reunión de seguimiento.",
    },
    "Horas extras recurrentes": lambda f: {
        "what": "Confirmar si el trabajo en fin de semana es puntual o refleja sobrecarga sostenida.",
        "who": "El coordinador directo.",
        "how_much": f["detail"],
        "when": "Esta semana.",
    },
    "Baja capacidad futura (<10%)": lambda f: {
        "what": "No asignar tareas nuevas hasta liberar capacidad.",
        "who": "Quien asigna tareas al colaborador.",
        "how_much": f["detail"],
        "when": "Inmediato, hasta el cierre de mes.",
    },
    "Variabilidad excesiva entre semanas": lambda f: {
        "what": "Revisar la planificación semana a semana para suavizar el ritmo de trabajo.",
        "who": "El coordinador directo.",
        "how_much": f["detail"],
        "when": "En la próxima planificación semanal.",
    },
    "Alta concentración en un solo tipo de actividad": lambda f: {
        "what": "Evaluar si se requiere apoyo adicional para ese motivo específico de consulta.",
        "who": "El coordinador del área.",
        "how_much": f["detail"],
        "when": "Este mes.",
    },
    "Muchas tareas sin planificación": lambda f: {
        "what": "Completar el Tiempo Objetivo de las tareas pendientes.",
        "who": "El colaborador.",
        "how_much": f["detail"],
        "when": "Antes de iniciar cada tarea nueva.",
    },
}

# ── Sprint A: Insights de Performance Score (fortalezas + oportunidades) ────
# Mismo patrón que FACTOR_EXPLANATION/FACTOR_ACTION arriba, pero bidireccional
# (a diferencia de Riesgo Operativo, donde todo factor activo es negativo por
# diseño): un factor normalizado alto es una fortaleza (tone "positive"), uno
# bajo es una oportunidad de mejora (tone "risk", con acción). Nunca
# recalcula PerformanceScoreResult — solo traduce factors[] ya calculados.

PERFORMANCE_FACTOR_EXPLANATION = {
    "Cumplimiento": {
        "high": "El porcentaje de tareas completadas este mes está por encima del rango esperado.",
        "low": "El porcentaje de tareas completadas este mes está por debajo del rango esperado.",
    },
    "Tareas vencidas": {
        "high": "No hay una acumulación relevante de tareas vencidas este mes.",
        "low": "Hay una acumulación de tareas vencidas — pesa más cuando son de prioridad Alta.",
    },
    "Consistencia": {
        "high": "El ritmo de trabajo (horas, tareas completadas, cumplimiento) es estable semana a semana.",
        "low": "El ritmo de trabajo varía fuertemente semana a semana (coeficiente de variación alto).",
    },
    "Índice de Trazabilidad": {
        "high": "El trabajo realizado queda bien documentado (registro diario, comentarios, actividades).",
        "low": "El trabajo realizado queda poco documentado (registro diario, comentarios, actividades).",
    },
}

PERFORMANCE_FACTOR_MAINTAIN = {
    "Cumplimiento": "Mantener el ritmo actual de cierre de tareas dentro del plazo comprometido.",
    "Tareas vencidas": "Mantener el control de plazos — seguir cerrando tareas antes de su vencimiento.",
    "Consistencia": "Mantener el ritmo de trabajo estable semana a semana.",
    "Índice de Trazabilidad": "Mantener el registro diario y la documentación del trabajo realizado.",
}

PERFORMANCE_FACTOR_ACTION = {
    "Cumplimiento": lambda f: {
        "what": "Completar las tareas pendientes de este mes, priorizando las más próximas a vencer.",
        "who": "El colaborador.",
        "how_much": f["raw_label"],
        "when": "Antes de fin de mes.",
    },
    "Tareas vencidas": lambda f: {
        "what": "Priorizar el cierre de las tareas vencidas, especialmente las de prioridad Alta.",
        "who": "El colaborador.",
        "how_much": f["raw_label"],
        "when": "Esta semana.",
    },
    "Consistencia": lambda f: {
        "what": "Mantener un registro y un cumplimiento más parejo entre semanas, evitando picos y caídas fuertes.",
        "who": "El colaborador.",
        "how_much": f["raw_label"],
        "when": "Las próximas semanas.",
    },
    "Índice de Trazabilidad": lambda f: {
        "what": "Registrar a diario el avance del trabajo: comentarios y actividades que documenten lo realizado.",
        "who": "El colaborador.",
        "how_much": f["raw_label"],
        "when": "A diario.",
    },
}

PERFORMANCE_FACTOR_HALLAZGO = {
    "Cumplimiento": lambda f, high: (
        f"Buen cumplimiento de tareas: {f['raw_label']} completadas este mes."
        if high
        else f"Cumplimiento por debajo del objetivo: {f['raw_label']} completadas este mes."
    ),
    "Tareas vencidas": lambda f, high: (
        f"Buen control de plazos: {f['raw_label']} vencidas." if high else f"Acumulación de tareas vencidas: {f['raw_label']}."
    ),
    "Consistencia": lambda f, high: (
        f"Ritmo de trabajo estable: consistencia {f['raw_label']}."
        if high
        else f"Ritmo de trabajo irregular semana a semana: consistencia {f['raw_label']}."
    ),
    "Índice de Trazabilidad": lambda f, high: (
        f"Buen registro de evidencia del trabajo: {f['raw_label']}."
        if high
        else f"Poca evidencia documentada del trabajo: {f['raw_label']}."
    ),
}


def compute_performance_insights(performance_score: dict, base_confidence: dict) -> list[dict]:
    """Sprint A — traduce `factors[]` YA CALCULADOS del Performance Score a
    Insights de 4 bloques, en ambas direcciones: `normalized_value` en
    "Alto"/"Muy alto" → fortaleza; "Bajo" → oportunidad de mejora con
    acción concreta. "Medio" no genera insight (evita ruido, mismo criterio
    que `FACTOR_INSIGHT_THRESHOLD_PTS` para Riesgo Operativo). El impacto
    de la acción es el máximo puntaje que ESE factor podría aportar si
    llegara al tope de su curva (`weight - points`, ambos ya calculados por
    el motor) — nunca un número inventado. Réplica exacta de
    `computePerformanceInsights`."""
    insights: list[dict] = []
    for factor in performance_score["factors"]:
        level = score_level(factor["normalized_value"])
        if level == "Medio":
            continue
        high = level in ("Alto", "Muy alto")

        explanation_pair = PERFORMANCE_FACTOR_EXPLANATION.get(factor["name"])
        explicacion = (
            (explanation_pair["high"] if high else explanation_pair["low"])
            if explanation_pair
            else "Relación observada entre este factor y el Performance Score actual."
        )
        hallazgo_builder = PERFORMANCE_FACTOR_HALLAZGO.get(factor["name"])
        hallazgo = hallazgo_builder(factor, high) if hallazgo_builder else factor["detail"]
        evidencia = [
            {"label": factor["name"], "before": "—", "after": factor["raw_label"]},
            {"label": "Aporte al Performance Score", "before": f"{factor['weight']}% de peso", "after": f"{factor['points']} pts"},
        ]

        if high:
            insights.append(
                {
                    "id": f"perf-factor:{factor['name']}:fortaleza",
                    "tone": "positive",
                    "hallazgo": hallazgo,
                    "explicacion": explicacion,
                    "evidencia": evidencia,
                    "accion": {
                        "what": PERFORMANCE_FACTOR_MAINTAIN.get(factor["name"], "Mantener las prácticas actuales."),
                        "who": "El colaborador.",
                        "how_much": "Sin cambios necesarios.",
                        "when": "Continuo.",
                        "impact": None,
                        "impact_note": "Impacto no estimable con los datos actuales.",
                    },
                    "confidence": base_confidence,
                }
            )
            continue

        max_upside_pts = round_half_up((factor["weight"] - factor["points"]) * 100) / 100
        action_builder = PERFORMANCE_FACTOR_ACTION.get(factor["name"])
        accion = None
        if action_builder:
            accion = {
                **action_builder(factor),
                "impact": [{"metric": "Performance Score", "delta": max_upside_pts, "unit": "pts"}] if max_upside_pts > 0 else None,
                "impact_note": "" if max_upside_pts > 0 else "Impacto no estimable con los datos actuales.",
            }

        insights.append(
            {
                "id": f"perf-factor:{factor['name']}:oportunidad",
                "tone": "risk",
                "hallazgo": hallazgo,
                "explicacion": explicacion,
                "evidencia": evidencia,
                "accion": accion,
                "confidence": base_confidence,
            }
        )
    return insights


# ── Sprint Analytics 2.0: Motor de interpretación de Equilibrio Operativo ───
# Mismo patrón exacto que compute_performance_insights (arriba) — factor alto
# = fortaleza, factor bajo = oportunidad con acción, "Medio" no genera
# insight. Los factores de Equilibrio Operativo NO traen `normalized_value`
# (a diferencia de Performance Score) — se deriva con
# `derived_normalized_value(points, weight)`, mismo cálculo que ya usa
# ExplainFactorCard para mostrarlo.

EQUILIBRIO_FACTOR_EXPLANATION = {
    **PERFORMANCE_FACTOR_EXPLANATION,
    "Carga laboral": {
        "high": "Las horas reales registradas este mes están dentro del rango óptimo de la base laboral.",
        "low": "Las horas reales registradas este mes están fuera del rango óptimo (subutilización o sobrecarga).",
    },
    "Capacidad futura": {
        "high": "Queda margen de capacidad proyectada para asumir trabajo nuevo el resto del mes.",
        "low": "Queda poco o ningún margen de capacidad proyectada para lo que resta del mes.",
    },
}

EQUILIBRIO_FACTOR_MAINTAIN = {
    **PERFORMANCE_FACTOR_MAINTAIN,
    "Carga laboral": "Mantener el ritmo de horas dentro del rango óptimo actual.",
    "Capacidad futura": "Mantener el margen de capacidad disponible antes de comprometer trabajo nuevo.",
}

EQUILIBRIO_FACTOR_ACTION = {
    "Cumplimiento": lambda f: {
        "what": "Completar las tareas pendientes de este mes, priorizando las más próximas a vencer.",
        "who": "El colaborador.",
        "how_much": f["raw_label"],
        "when": "Antes de fin de mes.",
    },
    "Tareas vencidas": lambda f: {
        "what": "Priorizar el cierre de las tareas vencidas, especialmente las de prioridad Alta.",
        "who": "El colaborador.",
        "how_much": f["raw_label"],
        "when": "Esta semana.",
    },
    "Consistencia": lambda f: {
        "what": "Mantener un registro y un cumplimiento más parejo entre semanas, evitando picos y caídas fuertes.",
        "who": "El colaborador.",
        "how_much": f["raw_label"],
        "when": "Las próximas semanas.",
    },
    "Carga laboral": lambda f: {
        "what": "Registrar actividades diariamente y ajustar la asignación de trabajo hacia el rango óptimo.",
        "who": "El colaborador y su coordinador directo.",
        "how_much": f["raw_label"],
        "when": "Esta semana.",
    },
    "Capacidad futura": lambda f: {
        "what": "Evitar comprometer trabajo nuevo hasta liberar capacidad, o redistribuir tareas pendientes.",
        "who": "Quien asigna tareas al colaborador.",
        "how_much": f["raw_label"],
        "when": "Antes de asignar trabajo nuevo.",
    },
}

EQUILIBRIO_FACTOR_HALLAZGO = {
    "Cumplimiento": lambda f, high: (
        f"Buen cumplimiento de tareas: {f['raw_label']} completadas este mes."
        if high
        else f"Cumplimiento por debajo del objetivo: {f['raw_label']} completadas este mes."
    ),
    "Tareas vencidas": lambda f, high: (
        f"Buen control de plazos: {f['raw_label']} vencidas." if high else f"Acumulación de tareas vencidas: {f['raw_label']}."
    ),
    "Consistencia": lambda f, high: (
        f"Ritmo de trabajo estable: consistencia {f['raw_label']}."
        if high
        else f"Ritmo de trabajo irregular semana a semana: consistencia {f['raw_label']}."
    ),
    "Carga laboral": lambda f, high: (
        f"Carga laboral equilibrada: {f['raw_label']}." if high else f"Carga laboral fuera del rango óptimo: {f['raw_label']}."
    ),
    "Capacidad futura": lambda f, high: (
        f"Buen margen de capacidad disponible: {f['raw_label']}." if high else f"Poco margen de capacidad disponible: {f['raw_label']}."
    ),
}


def compute_equilibrio_insights(health_score: dict, base_confidence: dict) -> list[dict]:
    """Sprint Analytics 2.0 (Bloques 5, 6, 8) — mismo patrón que
    `compute_performance_insights`, aplicado a `health_score["factors"]` (5
    dimensiones de Equilibrio Operativo). Fortalezas (Bloque 5) = insights
    con tone "positive"; aspectos a mejorar (Bloque 6) = tone "risk", cada
    uno con su `accion` (recomendación, Bloque 8) ya embebida. Réplica
    exacta de `computeEquilibrioInsights`."""
    insights: list[dict] = []
    for factor in health_score["factors"]:
        normalized_value = derived_normalized_value(factor["points"], factor["weight"])
        level = score_level(normalized_value)
        if level == "Medio":
            continue
        high = level in ("Alto", "Muy alto")

        explanation_pair = EQUILIBRIO_FACTOR_EXPLANATION.get(factor["name"])
        explicacion = (
            (explanation_pair["high"] if high else explanation_pair["low"])
            if explanation_pair
            else "Relación observada entre esta dimensión y el Equilibrio Operativo actual."
        )
        hallazgo_builder = EQUILIBRIO_FACTOR_HALLAZGO.get(factor["name"])
        hallazgo = hallazgo_builder(factor, high) if hallazgo_builder else factor["detail"]
        evidencia = [
            {"label": factor["name"], "before": "—", "after": factor["raw_label"]},
            {"label": "Aporte al Equilibrio Operativo", "before": f"{factor['weight']}% de peso", "after": f"{factor['points']} pts"},
        ]

        if high:
            insights.append(
                {
                    "id": f"equilibrio-factor:{factor['name']}:fortaleza",
                    "tone": "positive",
                    "hallazgo": hallazgo,
                    "explicacion": explicacion,
                    "evidencia": evidencia,
                    "accion": {
                        "what": EQUILIBRIO_FACTOR_MAINTAIN.get(factor["name"], "Mantener las prácticas actuales."),
                        "who": "El colaborador.",
                        "how_much": "Sin cambios necesarios.",
                        "when": "Continuo.",
                        "impact": None,
                        "impact_note": "Impacto no estimable con los datos actuales.",
                    },
                    "confidence": base_confidence,
                }
            )
            continue

        max_upside_pts = round_half_up((factor["weight"] - factor["points"]) * 100) / 100
        action_builder = EQUILIBRIO_FACTOR_ACTION.get(factor["name"])
        accion = None
        if action_builder:
            accion = {
                **action_builder(factor),
                "impact": [{"metric": "Equilibrio Operativo", "delta": max_upside_pts, "unit": "pts"}] if max_upside_pts > 0 else None,
                "impact_note": "" if max_upside_pts > 0 else "Impacto no estimable con los datos actuales.",
            }

        insights.append(
            {
                "id": f"equilibrio-factor:{factor['name']}:oportunidad",
                "tone": "risk",
                "hallazgo": hallazgo,
                "explicacion": explicacion,
                "evidencia": evidencia,
                "accion": accion,
                "confidence": base_confidence,
            }
        )
    return insights


def explain_equilibrio_factor(name: str, normalized_value: float) -> str:
    """Sprint Analytics 2.0 (Bloque 4) — explicación de UNA dimensión de
    Equilibrio Operativo, sin pasar por `compute_equilibrio_insights` (que
    solo genera un Insight para factores Alto/Bajo, no "Medio") — así las 5
    dimensiones muestran explicación siempre. Réplica exacta de
    `explainEquilibrioFactor`."""
    level = score_level(normalized_value)
    high = level in ("Alto", "Muy alto")
    pair = EQUILIBRIO_FACTOR_EXPLANATION.get(name)
    return (pair["high"] if high else pair["low"]) if pair else "Relación observada entre esta dimensión y el Equilibrio Operativo actual."


# ── Bloque 3: "¿Qué significa este resultado?" — párrafo auto-generado ─────
# Una plantilla determinística por nivel de Estado Operativo (Bloques 11/12)
# — nunca texto libre/IA. Incorpora la tendencia cuando está disponible.

EQUILIBRIO_MEANING_TEMPLATE = {
    "Equilibrio Óptimo": "El colaborador mantiene un equilibrio operativo óptimo, con un desempeño sólido en cumplimiento, carga y capacidad. No requiere intervención. No requiere seguimiento adicional más allá del habitual.",
    "Equilibrio Estable": "El colaborador mantiene una operación saludable, con un buen balance entre cumplimiento, carga laboral y capacidad. No requiere intervención inmediata. El seguimiento de rutina es suficiente.",
    "Requiere Atención": "El colaborador mantiene un desempeño adecuado, aunque existen factores operativos que podrían afectar su rendimiento si las condiciones actuales continúan. No requiere intervención inmediata. Sí requiere seguimiento.",
    "Riesgo Operativo": "El colaborador presenta señales de desequilibrio operativo que ya están afectando su rendimiento. Es conveniente intervenir para corregir el rumbo antes de que la situación se agrave. Requiere seguimiento cercano.",
    "Desequilibrio Crítico": "El colaborador presenta un desequilibrio operativo crítico que requiere atención inmediata. Se recomienda una revisión inmediata de su situación junto a su coordinador directo.",
}

TREND_PHRASE = {
    "mejora": "La tendencia de los últimos 30 días es de mejora.",
    "empeoro": "La tendencia de los últimos 30 días es de deterioro.",
    "estable": "La tendencia de los últimos 30 días es estable.",
}


def explain_equilibrio_meaning(estado: dict, trend: dict | None) -> str:
    """Réplica exacta de `explainEquilibrioMeaning`."""
    base = EQUILIBRIO_MEANING_TEMPLATE[estado["estado"]]
    if trend and trend.get("available"):
        return f"{base} {TREND_PHRASE[trend['direction']]}"
    return base


# ── Bloque 7: "¿Qué impacto tiene este resultado?" — plantilla fija por nivel ─

EQUILIBRIO_IMPACT_TEMPLATE = {
    "Equilibrio Óptimo": "Puede asumir nuevos proyectos.",
    "Equilibrio Estable": "Se recomienda mantener la carga actual.",
    "Requiere Atención": "Existe riesgo moderado de retrasos.",
    "Riesgo Operativo": "No se recomienda incrementar responsabilidades.",
    "Desequilibrio Crítico": "No se recomienda incrementar responsabilidades — se recomienda una revisión inmediata de la situación.",
}


def explain_equilibrio_impact(estado: dict) -> str:
    """Réplica exacta de `explainEquilibrioImpact`."""
    return EQUILIBRIO_IMPACT_TEMPLATE[estado["estado"]]


FACTOR_INSIGHT_THRESHOLD_PTS = 2


def compute_insights(*, user, now: datetime, pipeline: dict, operational_risk: dict) -> list[dict]:
    """S6-A — construye Insights de 4 bloques a partir de los factores YA
    CALCULADOS del Índice de Riesgo Operativo (`compute_operational_risk`)
    — cada factor activo se traduce 1:1 a un Insight (hallazgo=detail del
    motor, impacto=los mismos puntos que ese factor aporta al riesgo, cero
    números inventados). El factor "Tendencia negativa de cumplimiento"
    recibe una explicación enriquecida cruzando Seguimiento/carga del
    histórico mensual. `pipeline` trae `consistency`/`data_quality`/
    `trends`/`performance_score` ya calculados por el llamador (mismo
    criterio que `precomputed_consistency` en `performance_score.py`/
    `health_score.py`). Réplica exacta de `computeInsights`."""
    insights: list[dict] = []
    consistency = pipeline["consistency"]
    base_confidence = compute_confidence(
        observations=consistency["weeks_analyzed"] if consistency.get("available") else 2,
        data_quality_pct=pipeline["data_quality"]["pct"],
        consistent=(consistency["level"] in ("muy-consistente", "consistente")) if consistency.get("available") else None,
    )

    insights.extend(compute_performance_insights(pipeline["performance_score"], base_confidence))

    relevant_factors = sorted(
        (f for f in operational_risk["factors"] if f["points"] >= FACTOR_INSIGHT_THRESHOLD_PTS),
        key=lambda f: f["points"],
        reverse=True,
    )

    monthly_enrichment: list[dict] | None = None

    for factor in relevant_factors:
        explicacion = FACTOR_EXPLANATION.get(factor["name"], "Relación observada entre este factor y el Índice de Riesgo Operativo actual.")
        evidencia = [
            {"label": factor["name"], "before": "—", "after": factor["detail"]},
            {"label": "Contribución al Riesgo Operativo", "before": f"{factor['weight']}% de peso", "after": f"{factor['points']} pts"},
        ]

        impact = [{"metric": "Riesgo Operativo", "delta": -round_half_up(factor["points"] * 100) / 100, "unit": "pts"}] if factor["points"] > 0 else []

        if factor["name"] == "Tendencia negativa de cumplimiento":
            if monthly_enrichment is None:
                monthly_enrichment = compute_monthly_history(user=user, months_back=3, now=now)
            current = monthly_enrichment[-1] if monthly_enrichment else None
            prev = monthly_enrichment[-2] if len(monthly_enrichment) >= 2 else None
            if current and prev:
                seg_delta = current["seguimiento_count"] - prev["seguimiento_count"]
                carga_delta = current["carga_real_hours"] - prev["carga_real_hours"]
                causes: list[str] = []
                if abs(seg_delta) >= 2:
                    causes.append(
                        f"un {'incremento' if seg_delta > 0 else 'una reducción'} del tiempo invertido en actividades de "
                        f"Seguimiento ({prev['seguimiento_count']} → {current['seguimiento_count']})"
                    )
                    evidencia.append({"label": "Actividades de Seguimiento", "before": f"{prev['seguimiento_count']}", "after": f"{current['seguimiento_count']}"})
                if abs(carga_delta) >= 5:
                    causes.append(
                        f"un {'aumento' if carga_delta > 0 else 'una reducción'} de la carga laboral registrada "
                        f"({prev['carga_real_hours']}h → {current['carga_real_hours']}h)"
                    )
                    evidencia.append({"label": "Carga laboral real", "before": f"{prev['carga_real_hours']}h", "after": f"{current['carga_real_hours']}h"})

                explicacion = (
                    f"Posible causa principal: la variación de cumplimiento coincide con {' y '.join(causes)}. "
                    "Relación observada a partir del historial mensual — no implica causalidad directa."
                    if causes
                    else "No se identificó, en el historial disponible, una variable con relación observable suficientemente fuerte."
                )

                if current["completed_pct"] < prev["completed_pct"]:
                    config = get_effective_analytics_config(now)
                    curve = get_effective_curve("cumplimiento", now)
                    norm_current = normalize("cumplimiento", current["completed_pct"], curve)
                    norm_prev = normalize("cumplimiento", prev["completed_pct"], curve)
                    perf_delta = round_half_up(((norm_prev - norm_current) * config["perf_weight_cumplimiento"] / 100) * 100) / 100
                    if perf_delta > 0:
                        impact.append({"metric": "Performance Score", "delta": perf_delta, "unit": "pts"})

        action_builder = FACTOR_ACTION.get(factor["name"])
        accion = None
        if action_builder:
            accion = {
                **action_builder(factor),
                "impact": impact if impact else None,
                "impact_note": "" if impact else "Impacto no estimable con los datos actuales.",
            }

        insights.append(
            {
                "id": f"risk-factor:{factor['name']}",
                "tone": "risk",
                "hallazgo": factor["detail"],
                "explicacion": explicacion,
                "evidencia": evidencia,
                "accion": accion,
                "confidence": base_confidence,
            }
        )

    cump_trend = pipeline["trends"]["cumplimiento"]["mes_anterior"]
    if cump_trend.get("available") and cump_trend["direction"] == "mejora":
        insights.append(
            {
                "id": "positive:cumplimiento-mejora",
                "tone": "positive",
                "hallazgo": (
                    f"El cumplimiento mejoró {abs(cump_trend['absolute_diff'])}pp respecto al mes anterior "
                    f"({cump_trend['compared']}% → {cump_trend['current']}%)."
                ),
                "explicacion": "Relación observada: la mejora coincide con un cierre más consistente de tareas dentro del plazo comprometido.",
                "evidencia": [{"label": "Cumplimiento", "before": f"{cump_trend['compared']}%", "after": f"{cump_trend['current']}%"}],
                "accion": {
                    "what": "Mantener las prácticas actuales de planificación y registro.",
                    "who": "El colaborador.",
                    "how_much": "Sin cambios necesarios.",
                    "when": "Continuo.",
                    "impact": None,
                    "impact_note": "Impacto no estimable con los datos actuales.",
                },
                "confidence": base_confidence,
            }
        )

    if not relevant_factors and not insights:
        insights.append(
            {
                "id": "neutral:sin-senales",
                "tone": "neutral",
                "hallazgo": "No se detectaron cambios relevantes en los indicadores este período.",
                "explicacion": "El Índice de Riesgo Operativo se mantiene bajo y no hay factores con contribución significativa.",
                "evidencia": [{"label": "Riesgo Operativo", "before": "—", "after": f"{operational_risk['score']} pts ({operational_risk['classification']})"}],
                "accion": None,
                "confidence": base_confidence,
            }
        )

    return insights


# ── Sprint A: Explicación de tendencias (Performance Score / Equilibrio Operativo) ─
# Nunca recalcula un score: compara factors[] YA CALCULADOS de dos
# instantes en el tiempo (el actual vs. un snapshot histórico de
# AnalyticsAuditLog, leído a través de audit_history.py — capa de solo
# lectura, no del motor) y narra qué factores subieron/bajaron más. Mismo
# principio "cero números inventados" que el resto de este archivo.

TREND_STABLE_EPSILON = 0.5
FACTOR_DELTA_EPSILON = 0.5
MAX_TREND_BULLETS = 3


def explain_score_trend(current_score: float, current_factors: list[dict], previous_score: float | None, previous_factors: list[dict] | None) -> dict:
    """Pura — compara dos snapshots de factores (misma forma que
    `PerformanceFactor`/`HealthFactor`) sin volver a calcular nada. Réplica
    exacta de `explainScoreTrend`."""
    if previous_score is None or previous_factors is None:
        return {"available": False, "direction": "estable", "score_delta": 0, "bullets": [], "reason": "Sin historial suficiente para explicar la tendencia."}

    score_delta = round_half_up((current_score - previous_score) * 100) / 100
    direction = "mejora" if score_delta > TREND_STABLE_EPSILON else "empeoro" if score_delta < -TREND_STABLE_EPSILON else "estable"

    prev_by_name = {f["name"]: f for f in previous_factors}
    deltas = []
    for f in current_factors:
        prev = prev_by_name.get(f["name"])
        if not prev:
            continue
        delta = round_half_up((f["points"] - prev["points"]) * 100) / 100
        if abs(delta) < FACTOR_DELTA_EPSILON:
            continue
        deltas.append(
            {
                "name": f["name"],
                "delta": delta,
                "prev_label": prev.get("raw_label") or prev.get("detail") or "",
                "cur_label": f.get("raw_label") or f.get("detail") or "",
            }
        )
    deltas.sort(key=lambda d: abs(d["delta"]), reverse=True)
    deltas = deltas[:MAX_TREND_BULLETS]

    bullets = []
    for d in deltas:
        verb = "aportó" if d["delta"] > 0 else "restó"
        label_change = f" ({d['prev_label']} → {d['cur_label']})" if d["prev_label"] and d["cur_label"] and d["prev_label"] != d["cur_label"] else ""
        bullets.append(f"{d['name']} {verb} {abs(d['delta'])}pts{label_change}")

    result = {"available": True, "direction": direction, "score_delta": score_delta, "bullets": bullets}
    if not bullets:
        result["reason"] = "No hay un factor individual con variación relevante."
    return result


def get_score_trend_explanation(*, user, kind: AuditKind, current_score: float, current_factors: list[dict], now: datetime, days_ago: int = 30) -> dict:
    """Envoltorio: resuelve el punto histórico más cercano a `days_ago` vía
    `get_factor_audit_history`/`closest_factor_point` (`audit_history.py`)
    y delega la comparación a `explain_score_trend` (pura). Réplica exacta
    de `getScoreTrendExplanation`."""
    history = get_factor_audit_history(user=user, kind=kind, now=now, window_days=max(days_ago + 10, 40))
    point = closest_factor_point(history, now, days_ago)
    return explain_score_trend(current_score, current_factors, point["score"] if point else None, point["factors"] if point else None)


# ── S6-C: Relaciones entre indicadores (reglas determinísticas) ─────────────


def relation_confidence(observations: int, strength_ratio: float) -> str:
    """Confianza de una relación: cantidad de observaciones históricas que
    la respaldan × fuerza del efecto observado — NUNCA Machine Learning,
    solo umbrales. Réplica exacta de `relationConfidence`."""
    if observations >= 4 and strength_ratio >= 1.5:
        return "alta"
    if observations >= 2 and strength_ratio >= 1.15:
        return "media"
    return "baja"


def compute_indicator_relations(monthly: list[dict], consistency: dict, operational_risk: dict, capacity: dict) -> list[dict]:
    """S6-C — cruza indicadores YA CALCULADOS con reglas fijas (sin ML).
    Todas las entradas (histórico mensual, consistencia, factores de
    riesgo, capacidad) ya fueron calculadas por `history.py`/
    `operational_risk.py`/`capacity_forecast.py` — esta función es pura
    (sin queries propias). Réplica exacta de `computeIndicatorRelations`."""
    relations: list[dict] = []
    months_with_data = sum(1 for m in monthly if m["total_tasks"] > 0 or m["carga_real_hours"] > 0)
    current = monthly[-1] if monthly else None
    prev = monthly[-2] if len(monthly) >= 2 else None

    if (
        current
        and prev
        and prev["completed_pct"] > 0
        and current["completed_pct"] < prev["completed_pct"] - 5
        and prev["seguimiento_count"] > 0
        and current["seguimiento_count"] > prev["seguimiento_count"] * 1.2
    ):
        ratio = current["seguimiento_count"] / prev["seguimiento_count"]
        relations.append(
            {
                "id": "cumplimiento-vs-seguimiento",
                "statement": "La disminución del cumplimiento coincide con un incremento del tiempo dedicado a actividades de Seguimiento.",
                "confidence": relation_confidence(months_with_data, ratio),
                "evidencia": [
                    {"label": "Cumplimiento", "before": f"{prev['completed_pct']}%", "after": f"{current['completed_pct']}%"},
                    {"label": "Actividades de Seguimiento", "before": f"{prev['seguimiento_count']}", "after": f"{current['seguimiento_count']}"},
                ],
            }
        )

    horas_extra_factor = next((f for f in operational_risk["factors"] if f["name"] == "Horas extras recurrentes"), None)
    baja_cap_factor = next((f for f in operational_risk["factors"] if f["name"] == "Baja capacidad futura (<10%)"), None)
    if horas_extra_factor and horas_extra_factor["points"] > 0 and baja_cap_factor and baja_cap_factor["points"] > 0:
        relations.append(
            {
                "id": "horas-extra-vs-capacidad",
                "statement": "El aumento de horas extra coincide con una reducción de la capacidad futura disponible.",
                "confidence": relation_confidence(months_with_data, (horas_extra_factor["points"] + baja_cap_factor["points"]) / 10),
                "evidencia": [
                    {"label": "Horas extras recurrentes", "before": "—", "after": horas_extra_factor["detail"]},
                    {"label": "Capacidad futura disponible", "before": "—", "after": baja_cap_factor["detail"]},
                ],
            }
        )

    if (
        current
        and prev
        and prev["carga_base_hours"] > 0
        and current["carga_pct"] > prev["carga_pct"] + 10
        and consistency.get("available")
        and consistency["level"] in ("variable", "muy-variable")
    ):
        relations.append(
            {
                "id": "carga-vs-consistencia",
                "statement": "El incremento de carga laboral coincide con mayor variabilidad en el ritmo de trabajo semana a semana.",
                "confidence": relation_confidence(months_with_data, (current["carga_pct"] - prev["carga_pct"]) / 10),
                "evidencia": [
                    {"label": "Carga laboral", "before": f"{prev['carga_pct']}%", "after": f"{current['carga_pct']}%"},
                    {"label": "Consistencia", "before": "—", "after": f"{consistency['label']} (CV {consistency['coefficient_of_variation']}%)"},
                ],
            }
        )

    if capacity["tasks_sin_estimar"] >= 3 and capacity["confiabilidad"]["pct"] < 80:
        relations.append(
            {
                "id": "sin-estimar-vs-confiabilidad",
                "statement": "La falta de tiempo objetivo definido en varias tareas reduce la confiabilidad de la proyección de capacidad futura.",
                "confidence": relation_confidence(months_with_data, capacity["tasks_sin_estimar"] / 3),
                "evidencia": [
                    {"label": "Tareas sin tiempo objetivo definido", "before": "—", "after": f"{capacity['tasks_sin_estimar']}"},
                    {"label": "Confiabilidad de la proyección", "before": "100%", "after": f"{capacity['confiabilidad']['pct']}%"},
                ],
            }
        )

    return relations


# ── S6-D: Benchmarks personales (contra el propio historial, nunca entre personas) ──


def compute_personal_benchmark(*, user, current_score: float, data_quality_pct: float, now: datetime) -> dict:
    """Reutiliza `AnalyticsAuditLog` (kind="performance_score", ya existe
    — no se crea tabla ni se persiste nada nuevo) para reconstruir el
    historial PERSONAL del Performance Score. La granularidad real
    depende de cuántas veces se recalculó (cada `cache_ttl_minutes`
    mientras el colaborador/su gerencia usan Analytics) — mismo patrón ya
    usado por `get_score_trend_explanation`. Réplica exacta de
    `computePersonalBenchmark`."""
    window_start = now - timedelta(days=366)
    try:
        entries = list(
            AnalyticsAuditLog.objects.filter(user=user, kind="performance_score", created_at__gte=window_start, created_at__lt=now)
            .order_by("-created_at")
            .only("created_at", "period", "result")
        )
    except Exception:  # noqa: BLE001 — lectura best-effort, réplica fiel del TS
        entries = []

    scored: list[dict] = []
    for e in entries:
        score = e.result.get("score") if isinstance(e.result, dict) else None
        if isinstance(score, (int, float)) and not isinstance(score, bool):
            scored.append({"created_at": e.created_at, "period": e.period, "score": score})

    if not scored:
        return {
            "current": current_score,
            "average": current_score,
            "best_ever": None,
            "best_week": None,
            "last_4_weeks": None,
            "last_3_months": None,
            "percentile": 50,
            "narrative": "Sin historial personal suficiente todavía para comparar.",
            "observations": 0,
            "confidence": {"stars": 1, "label": "Muy baja"},
        }

    average = round_half_up((sum(e["score"] for e in scored) / len(scored)) * 10) / 10

    by_period: dict[str, list[float]] = {}
    for e in scored:
        by_period.setdefault(e["period"], []).append(e["score"])
    best_ever: dict | None = None
    for period, scores in by_period.items():
        avg = round_half_up((sum(scores) / len(scores)) * 10) / 10
        if best_ever is None or avg > best_ever["score"]:
            best_ever = {"score": avg, "period": period}

    by_week: dict[str, list[float]] = {}
    for e in scored:
        key = _utc_week_start(e["created_at"].date()).isoformat()
        by_week.setdefault(key, []).append(e["score"])
    best_week: dict | None = None
    for week_of, scores in by_week.items():
        avg = round_half_up((sum(scores) / len(scores)) * 10) / 10
        if best_week is None or avg > best_week["score"]:
            best_week = {"score": avg, "week_of": week_of}

    last_4_weeks_scores = [e for e in scored if e["created_at"] >= now - timedelta(days=28)]
    last_4_weeks = round_half_up((sum(e["score"] for e in last_4_weeks_scores) / len(last_4_weeks_scores)) * 10) / 10 if last_4_weeks_scores else None

    last_3_months_scores = [e for e in scored if e["created_at"] >= now - timedelta(days=91)]
    last_3_months = round_half_up((sum(e["score"] for e in last_3_months_scores) / len(last_3_months_scores)) * 10) / 10 if last_3_months_scores else None

    not_better = sum(1 for e in scored if e["score"] <= current_score)
    percentile = round_half_up(not_better / len(scored) * 100)

    diff_from_avg = round_half_up((current_score - average) * 10) / 10
    is_best_ever = best_ever is not None and len(scored) >= 4 and round_half_up(current_score) >= round_half_up(best_ever["score"])
    if is_best_ever:
        narrative = "Este es su mejor desempeño registrado en el historial disponible."
    elif diff_from_avg > 3:
        narrative = f"Actualmente se encuentra {diff_from_avg} pts por encima de su promedio histórico."
    elif diff_from_avg < -3:
        narrative = f"Actualmente se encuentra {abs(diff_from_avg)} pts por debajo de su promedio histórico."
    else:
        narrative = "Actualmente en línea con su promedio histórico personal."

    confidence = compute_confidence(observations=len(by_period), max_observations=6, data_quality_pct=data_quality_pct, consistent=len(scored) >= 8)

    return {
        "current": current_score,
        "average": average,
        "best_ever": best_ever,
        "best_week": best_week,
        "last_4_weeks": last_4_weeks,
        "last_3_months": last_3_months,
        "percentile": percentile,
        "narrative": narrative,
        "observations": len(scored),
        "confidence": confidence,
    }


# ── S6-G: Reevaluación automática de recomendaciones ─────────────────────────
# Sin tabla nueva, sin persistir nada: reutiliza AnalyticsAuditLog (kind
# "alerts"/"operational_risk", ya existentes) para comparar el ciclo actual
# contra la referencia más antigua disponible dentro de la ventana — se
# recalcula íntegramente en cada llamada.

ALERT_RULE_LABEL = {
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

REEVALUATION_WINDOW_DAYS = 14
RISK_WORSENED_THRESHOLD = 3


def compute_recommendation_reevaluation(*, user, current_alerts: list[dict], current_risk_score: float, now: datetime) -> list[dict]:
    """Réplica exacta de `computeRecommendationReevaluation`. Best-effort:
    si la lectura de auditoría falla, devuelve `[]` (mismo criterio que
    `get_resolved_alerts_history` en `alerts_engine.py`)."""
    since_date = now - timedelta(days=REEVALUATION_WINDOW_DAYS)
    try:
        alert_entries = list(
            AnalyticsAuditLog.objects.filter(user=user, kind="alerts", created_at__gte=since_date, created_at__lt=now)
            .order_by("created_at")
            .only("created_at", "result")
        )
        risk_entries = list(
            AnalyticsAuditLog.objects.filter(user=user, kind="operational_risk", created_at__gte=since_date, created_at__lt=now)
            .order_by("created_at")
            .only("created_at", "result")
        )
    except Exception:  # noqa: BLE001 — lectura best-effort, réplica fiel del TS
        return []

    if not alert_entries:
        return []

    # Referencia = el snapshot más antiguo disponible en la ventana ("ciclo anterior").
    reference = alert_entries[0]
    reference_rules_raw = reference.result.get("alerts") if isinstance(reference.result, dict) else None
    reference_rules = [r for r in reference_rules_raw if isinstance(r, str)] if isinstance(reference_rules_raw, list) else []
    if not reference_rules:
        return []

    reference_risk_entry = next(
        (e for e in risk_entries if abs((e.created_at - reference.created_at).total_seconds()) <= 3 * 86400),
        risk_entries[0] if risk_entries else None,
    )
    reference_risk_score = None
    if reference_risk_entry is not None and isinstance(reference_risk_entry.result, dict):
        score = reference_risk_entry.result.get("score")
        if isinstance(score, (int, float)) and not isinstance(score, bool):
            reference_risk_score = score

    current_rule_set = {a["rule"] for a in current_alerts}
    reference_days_ago = max(0, round_half_up((now - reference.created_at).total_seconds() / 86400))

    results: list[dict] = []
    for rule in reference_rules:
        label = ALERT_RULE_LABEL.get(rule, rule)
        if rule not in current_rule_set:
            results.append(
                {
                    "rule": rule,
                    "message": f"{label}: la situación evolucionó favorablemente respecto a la recomendación anterior.",
                    "status": "mejorada",
                    "reference_days_ago": reference_days_ago,
                }
            )
            continue
        if reference_risk_score is None:
            results.append(
                {
                    "rule": rule,
                    "message": f"{label}: no es posible evaluar todavía el impacto de la recomendación anterior.",
                    "status": "sin-datos",
                    "reference_days_ago": reference_days_ago,
                }
            )
            continue
        delta = current_risk_score - reference_risk_score
        if delta > RISK_WORSENED_THRESHOLD:
            results.append(
                {
                    "rule": rule,
                    "message": f"{label}: la condición requiere intervención prioritaria — el Riesgo Operativo aumentó desde la última recomendación.",
                    "status": "prioritaria",
                    "reference_days_ago": reference_days_ago,
                }
            )
            continue
        results.append({"rule": rule, "message": f"{label}: la recomendación continúa siendo válida.", "status": "valida", "reference_days_ago": reference_days_ago})
    return results


# ── S6-H: Priorización inteligente ───────────────────────────────────────────


def prioritize_recommendations(items: list[dict]) -> dict:
    """Orden fijo (§S6-H): 1) Riesgo Operativo (prioridad + magnitud del
    impacto en riesgo), 2) Impacto esperado combinado, 3) Facilidad de
    implementación, 4) Cantidad de colaboradores afectados. Solo las 3
    primeras se muestran — el resto queda agrupado. Réplica exacta de
    `prioritizeRecommendations`. Cada item es un dict con `priority`
    ("alta"/"media"), `impact_score_pts`, `impact_risk_pts`,
    `affected_count`, `ease_rank`."""

    def priority_rank(p: str) -> int:
        return 0 if p == "alta" else 1

    ranked = sorted(
        items,
        key=lambda x: (
            priority_rank(x["priority"]),
            -abs(x["impact_risk_pts"]),
            -(abs(x["impact_score_pts"]) + abs(x["impact_risk_pts"])),
            x["ease_rank"],
            -x["affected_count"],
        ),
    )
    return {"top": ranked[:3], "additional": ranked[3:]}


def insight_priority(i: dict) -> str:
    accion = i.get("accion")
    impact = accion.get("impact") if accion else None
    risk_impact = next((x for x in impact if x["metric"] == "Riesgo Operativo"), None) if impact else None
    return "alta" if risk_impact and abs(risk_impact["delta"]) >= 10 else "media"


def prioritize_insights(insights: list[dict]) -> dict:
    """Aplica la misma priorización (§S6-H) a los Insights individuales
    que tienen acción accionable. Réplica exacta de `prioritizeInsights`."""
    with_action = [i for i in insights if i["tone"] == "risk" and i.get("accion")]
    rankable = []
    for i in with_action:
        impact = i["accion"].get("impact") or []
        impact_score_pts = next((x["delta"] for x in impact if x["metric"] == "Performance Score"), 0)
        impact_risk_pts = next((x["delta"] for x in impact if x["metric"] == "Riesgo Operativo"), 0)
        rankable.append(
            {"insight": i, "priority": insight_priority(i), "impact_score_pts": impact_score_pts, "impact_risk_pts": impact_risk_pts, "affected_count": 1, "ease_rank": 0}
        )
    ranked = prioritize_recommendations(rankable)
    return {"top": [r["insight"] for r in ranked["top"]], "additional": [r["insight"] for r in ranked["additional"]]}
