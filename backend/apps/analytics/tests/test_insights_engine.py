"""Cobertura de apps.analytics.insights_engine — Fases 4j y 4k (ver
docs/AUDIT_LOG.md § 2026-08-12). Cubre el módulo completo: confianza,
insights de Performance/Equilibrio, plantillas de significado/impacto, el
orquestador `compute_insights`, la explicación de tendencia de score (4j),
relaciones entre indicadores, benchmark personal, reevaluación de
recomendaciones y priorización (4k)."""

from datetime import datetime, timedelta
from datetime import timezone as dt_timezone

import pytest

from apps.analytics import insights_engine as module
from apps.analytics.insights_engine import (
    compute_confidence,
    compute_equilibrio_insights,
    compute_indicator_relations,
    compute_insights,
    compute_performance_insights,
    compute_personal_benchmark,
    compute_recommendation_reevaluation,
    explain_equilibrio_factor,
    explain_equilibrio_impact,
    explain_equilibrio_meaning,
    explain_score_trend,
    insight_priority,
    prioritize_insights,
    prioritize_recommendations,
    relation_confidence,
)
from apps.analytics.models import AnalyticsAuditLog
from apps.users.models import User

pytestmark = pytest.mark.django_db

NOW = datetime(2026, 8, 12, 10, 0, tzinfo=dt_timezone.utc)


@pytest.fixture
def user():
    return User.objects.create_user(username="target", email="target@example.com", password="Sup3r-Secr3t!")


# --- compute_confidence (pura) ---------------------------------------------------


def test_compute_confidence_max_everything_is_5_stars():
    conf = compute_confidence(observations=6, data_quality_pct=100, consistent=True)
    assert conf == {"stars": 5, "label": "Muy alta"}


def test_compute_confidence_minimum_everything_is_1_star():
    conf = compute_confidence(observations=0, data_quality_pct=0, consistent=False)
    assert conf == {"stars": 1, "label": "Muy baja"}


def test_compute_confidence_consistent_none_uses_neutral_score():
    with_none = compute_confidence(observations=3, data_quality_pct=50, consistent=None)
    with_false = compute_confidence(observations=3, data_quality_pct=50, consistent=False)
    with_true = compute_confidence(observations=3, data_quality_pct=50, consistent=True)
    assert with_false["stars"] <= with_none["stars"] <= with_true["stars"]


# --- compute_performance_insights -------------------------------------------------


def _perf_factor(name, normalized_value, weight=25, points=None, raw_label="80%"):
    points = round(normalized_value * weight / 100, 2) if points is None else points
    return {"name": name, "curve": "cumplimiento", "raw_value": 80, "raw_label": raw_label, "normalized_value": normalized_value, "weight": weight, "points": points, "detail": f"{raw_label} detalle"}


def test_compute_performance_insights_medio_generates_no_insight():
    performance_score = {"factors": [_perf_factor("Cumplimiento", 55)]}
    assert compute_performance_insights(performance_score, {"stars": 3, "label": "Media"}) == []


def test_compute_performance_insights_alto_is_fortaleza_without_impact():
    performance_score = {"factors": [_perf_factor("Cumplimiento", 95)]}
    insights = compute_performance_insights(performance_score, {"stars": 3, "label": "Media"})
    assert len(insights) == 1
    insight = insights[0]
    assert insight["tone"] == "positive"
    assert insight["id"] == "perf-factor:Cumplimiento:fortaleza"
    assert insight["accion"]["impact"] is None


def test_compute_performance_insights_bajo_is_oportunidad_with_impact():
    performance_score = {"factors": [_perf_factor("Cumplimiento", 20, weight=25, points=5)]}
    insights = compute_performance_insights(performance_score, {"stars": 3, "label": "Media"})
    assert len(insights) == 1
    insight = insights[0]
    assert insight["tone"] == "risk"
    assert insight["id"] == "perf-factor:Cumplimiento:oportunidad"
    assert insight["accion"]["impact"] == [{"metric": "Performance Score", "delta": 20.0, "unit": "pts"}]


def test_compute_performance_insights_unknown_factor_name_low_has_no_accion():
    performance_score = {"factors": [_perf_factor("Factor Inexistente", 10, weight=10, points=1)]}
    insights = compute_performance_insights(performance_score, {"stars": 3, "label": "Media"})
    assert insights[0]["accion"] is None
    assert insights[0]["explicacion"] == "Relación observada entre este factor y el Performance Score actual."


# --- compute_equilibrio_insights ---------------------------------------------------


def _health_factor(name, points, weight, raw_label="50%"):
    return {"name": name, "raw_label": raw_label, "weight": weight, "points": points, "detail": f"{raw_label} detalle"}


def test_compute_equilibrio_insights_derives_normalized_value_medio_skips():
    # points/weight = 50 -> "Medio", no insight.
    health_score = {"factors": [_health_factor("Carga laboral", points=10, weight=20)]}
    assert compute_equilibrio_insights(health_score, {"stars": 3, "label": "Media"}) == []


def test_compute_equilibrio_insights_alto_is_fortaleza():
    health_score = {"factors": [_health_factor("Capacidad futura", points=19, weight=20)]}
    insights = compute_equilibrio_insights(health_score, {"stars": 3, "label": "Media"})
    assert insights[0]["tone"] == "positive"
    assert insights[0]["id"] == "equilibrio-factor:Capacidad futura:fortaleza"


def test_compute_equilibrio_insights_bajo_is_oportunidad():
    health_score = {"factors": [_health_factor("Carga laboral", points=1, weight=20)]}
    insights = compute_equilibrio_insights(health_score, {"stars": 3, "label": "Media"})
    assert insights[0]["tone"] == "risk"
    assert insights[0]["accion"]["what"].startswith("Registrar actividades")


def test_explain_equilibrio_factor_known_and_unknown():
    assert "óptimo" in explain_equilibrio_factor("Carga laboral", 95)
    assert explain_equilibrio_factor("Nombre inexistente", 95) == "Relación observada entre esta dimensión y el Equilibrio Operativo actual."


# --- explain_equilibrio_meaning / explain_equilibrio_impact -----------------------


def test_explain_equilibrio_meaning_without_trend():
    estado = {"estado": "Equilibrio Óptimo"}
    text = explain_equilibrio_meaning(estado, None)
    assert text == module.EQUILIBRIO_MEANING_TEMPLATE["Equilibrio Óptimo"]


def test_explain_equilibrio_meaning_with_available_trend_appends_phrase():
    estado = {"estado": "Riesgo Operativo"}
    trend = {"available": True, "direction": "empeoro"}
    text = explain_equilibrio_meaning(estado, trend)
    assert text.endswith(module.TREND_PHRASE["empeoro"])


def test_explain_equilibrio_meaning_with_unavailable_trend_ignores_it():
    estado = {"estado": "Equilibrio Estable"}
    trend = {"available": False}
    assert explain_equilibrio_meaning(estado, trend) == module.EQUILIBRIO_MEANING_TEMPLATE["Equilibrio Estable"]


def test_explain_equilibrio_impact():
    assert explain_equilibrio_impact({"estado": "Desequilibrio Crítico"}) == module.EQUILIBRIO_IMPACT_TEMPLATE["Desequilibrio Crítico"]


# --- compute_insights (integración) ------------------------------------------------

_MEDIO_PERFORMANCE = {"factors": [_perf_factor("Cumplimiento", 55)]}
_NO_TREND = {"cumplimiento": {"mes_anterior": {"available": False}}}


def _pipeline(*, performance_score=None, trends=None, consistency=None, data_quality_pct=100):
    return {
        "consistency": consistency or {"available": False},
        "data_quality": {"pct": data_quality_pct},
        "trends": trends or _NO_TREND,
        "performance_score": performance_score or _MEDIO_PERFORMANCE,
    }


def _risk_factor(name, points, weight=15, detail="detalle"):
    return {"name": name, "weight": weight, "points": points, "detail": detail}


def test_compute_insights_neutral_fallback_when_nothing_relevant(user):
    operational_risk = {"score": 5, "classification": "Bajo", "factors": [_risk_factor("Horas extras recurrentes", points=0)]}
    insights = compute_insights(user=user, now=NOW, pipeline=_pipeline(), operational_risk=operational_risk)
    assert len(insights) == 1
    assert insights[0]["id"] == "neutral:sin-senales"


def test_compute_insights_risk_factor_above_threshold_generates_insight(user):
    operational_risk = {"score": 20, "classification": "Medio", "factors": [_risk_factor("Horas extras recurrentes", points=6, weight=15, detail="6h fin de semana")]}
    insights = compute_insights(user=user, now=NOW, pipeline=_pipeline(), operational_risk=operational_risk)
    risk_insights = [i for i in insights if i["id"] == "risk-factor:Horas extras recurrentes"]
    assert len(risk_insights) == 1
    insight = risk_insights[0]
    assert insight["hallazgo"] == "6h fin de semana"
    assert insight["accion"]["impact"] == [{"metric": "Riesgo Operativo", "delta": -6.0, "unit": "pts"}]


def test_compute_insights_below_threshold_factor_is_ignored(user):
    operational_risk = {"score": 2, "classification": "Bajo", "factors": [_risk_factor("Horas extras recurrentes", points=1)]}
    insights = compute_insights(user=user, now=NOW, pipeline=_pipeline(), operational_risk=operational_risk)
    assert all(i["id"] != "risk-factor:Horas extras recurrentes" for i in insights)


def test_compute_insights_orders_risk_factors_by_points_desc(user):
    operational_risk = {
        "score": 30,
        "classification": "Medio",
        "factors": [_risk_factor("Horas extras recurrentes", points=5), _risk_factor("Variabilidad excesiva entre semanas", points=10)],
    }
    insights = compute_insights(user=user, now=NOW, pipeline=_pipeline(), operational_risk=operational_risk)
    risk_ids = [i["id"] for i in insights if i["id"].startswith("risk-factor:")]
    assert risk_ids == ["risk-factor:Variabilidad excesiva entre semanas", "risk-factor:Horas extras recurrentes"]


def test_compute_insights_positive_trend_insight_when_available(user):
    trends = {"cumplimiento": {"mes_anterior": {"available": True, "direction": "mejora", "absolute_diff": 8, "compared": 70, "current": 78}}}
    operational_risk = {"score": 5, "classification": "Bajo", "factors": []}
    insights = compute_insights(user=user, now=NOW, pipeline=_pipeline(trends=trends), operational_risk=operational_risk)
    positive = [i for i in insights if i["id"] == "positive:cumplimiento-mejora"]
    assert len(positive) == 1
    assert "70% → 78%" in positive[0]["hallazgo"]
    # Al haber un insight (positivo), NO debe agregarse además el fallback neutral.
    assert all(i["id"] != "neutral:sin-senales" for i in insights)


def test_compute_insights_tendencia_negativa_enrichment(user, monkeypatch):
    monthly = [
        {"seguimiento_count": 3, "carga_real_hours": 100, "completed_pct": 80},
        {"seguimiento_count": 8, "carga_real_hours": 90, "completed_pct": 60},
    ]
    monkeypatch.setattr(module, "compute_monthly_history", lambda *, user, months_back, now: monthly)
    operational_risk = {
        "score": 15,
        "classification": "Medio",
        "factors": [_risk_factor("Tendencia negativa de cumplimiento", points=6, weight=15, detail="Cumplimiento cayó 20pp")],
    }
    insights = compute_insights(user=user, now=NOW, pipeline=_pipeline(), operational_risk=operational_risk)
    insight = next(i for i in insights if i["id"] == "risk-factor:Tendencia negativa de cumplimiento")
    assert "Posible causa principal" in insight["explicacion"]
    assert any(e["label"] == "Actividades de Seguimiento" for e in insight["evidencia"])
    # completed_pct cayó (80 -> 60): debe sumar impacto estimado en Performance Score.
    metrics = {i["metric"] for i in insight["accion"]["impact"]}
    assert "Riesgo Operativo" in metrics
    assert "Performance Score" in metrics


def test_compute_insights_tendencia_negativa_without_monthly_history_falls_back(user, monkeypatch):
    monkeypatch.setattr(module, "compute_monthly_history", lambda *, user, months_back, now: [])
    operational_risk = {
        "score": 15,
        "classification": "Medio",
        "factors": [_risk_factor("Tendencia negativa de cumplimiento", points=6, weight=15, detail="Cumplimiento cayó 20pp")],
    }
    insights = compute_insights(user=user, now=NOW, pipeline=_pipeline(), operational_risk=operational_risk)
    insight = next(i for i in insights if i["id"] == "risk-factor:Tendencia negativa de cumplimiento")
    assert insight["explicacion"] == "Relación observada entre este factor y el Índice de Riesgo Operativo actual."


# --- explain_score_trend (pura) ----------------------------------------------------


def test_explain_score_trend_unavailable_without_previous():
    result = explain_score_trend(80, [], None, None)
    assert result == {"available": False, "direction": "estable", "score_delta": 0, "bullets": [], "reason": "Sin historial suficiente para explicar la tendencia."}


def test_explain_score_trend_mejora_with_bullets():
    current = [{"name": "Cumplimiento", "points": 30, "raw_label": "90%"}]
    previous = [{"name": "Cumplimiento", "points": 20, "raw_label": "70%"}]
    result = explain_score_trend(90, current, 80, previous)
    assert result["available"] is True
    assert result["direction"] == "mejora"
    assert result["score_delta"] == 10
    assert result["bullets"] == ["Cumplimiento aportó 10.0pts (70% → 90%)"]
    assert "reason" not in result


def test_explain_score_trend_stable_within_epsilon():
    result = explain_score_trend(80.3, [], 80, [])
    assert result["direction"] == "estable"


def test_explain_score_trend_no_significant_factor_delta_has_reason():
    current = [{"name": "Cumplimiento", "points": 20.1, "raw_label": "80%"}]
    previous = [{"name": "Cumplimiento", "points": 20, "raw_label": "80%"}]
    result = explain_score_trend(85, current, 80, previous)
    assert result["bullets"] == []
    assert result["reason"] == "No hay un factor individual con variación relevante."


# --- S6-C: relation_confidence / compute_indicator_relations (puras) --------------


@pytest.mark.parametrize(
    "observations,strength_ratio,expected",
    [(4, 1.5, "alta"), (3, 1.5, "media"), (2, 1.15, "media"), (1, 1.15, "baja"), (2, 1.0, "baja")],
)
def test_relation_confidence_thresholds(observations, strength_ratio, expected):
    assert relation_confidence(observations, strength_ratio) == expected


def _monthly(total_tasks, carga_real_hours, completed_pct, seguimiento_count, carga_base_hours, carga_pct):
    return {
        "total_tasks": total_tasks,
        "carga_real_hours": carga_real_hours,
        "completed_pct": completed_pct,
        "seguimiento_count": seguimiento_count,
        "carga_base_hours": carga_base_hours,
        "carga_pct": carga_pct,
    }


_NO_CONSISTENCY = {"available": False}
_EMPTY_RISK = {"factors": []}
_RELIABLE_CAPACITY = {"tasks_sin_estimar": 0, "confiabilidad": {"pct": 100}}


def test_compute_indicator_relations_empty_when_no_signal():
    assert compute_indicator_relations([], _NO_CONSISTENCY, _EMPTY_RISK, _RELIABLE_CAPACITY) == []


def test_compute_indicator_relations_cumplimiento_vs_seguimiento():
    monthly = [_monthly(5, 10, 80, 2, 100, 50), _monthly(5, 10, 70, 3, 100, 50)]
    relations = compute_indicator_relations(monthly, _NO_CONSISTENCY, _EMPTY_RISK, _RELIABLE_CAPACITY)
    ids = [r["id"] for r in relations]
    assert "cumplimiento-vs-seguimiento" in ids


def test_compute_indicator_relations_horas_extra_vs_capacidad():
    operational_risk = {"factors": [{"name": "Horas extras recurrentes", "points": 5, "detail": "5h extra"}, {"name": "Baja capacidad futura (<10%)", "points": 8, "detail": "5% disponible"}]}
    relations = compute_indicator_relations([], _NO_CONSISTENCY, operational_risk, _RELIABLE_CAPACITY)
    assert relations == [
        {
            "id": "horas-extra-vs-capacidad",
            "statement": "El aumento de horas extra coincide con una reducción de la capacidad futura disponible.",
            "confidence": relation_confidence(0, 1.3),
            "evidencia": [
                {"label": "Horas extras recurrentes", "before": "—", "after": "5h extra"},
                {"label": "Capacidad futura disponible", "before": "—", "after": "5% disponible"},
            ],
        }
    ]


def test_compute_indicator_relations_carga_vs_consistencia():
    monthly = [_monthly(5, 10, 80, 0, 100, 50), _monthly(5, 10, 80, 0, 100, 65)]
    consistency = {"available": True, "level": "muy-variable", "label": "Muy variable", "coefficient_of_variation": 45}
    relations = compute_indicator_relations(monthly, consistency, _EMPTY_RISK, _RELIABLE_CAPACITY)
    ids = [r["id"] for r in relations]
    assert "carga-vs-consistencia" in ids


def test_compute_indicator_relations_sin_estimar_vs_confiabilidad():
    capacity = {"tasks_sin_estimar": 4, "confiabilidad": {"pct": 70}}
    relations = compute_indicator_relations([], _NO_CONSISTENCY, _EMPTY_RISK, capacity)
    assert relations == [
        {
            "id": "sin-estimar-vs-confiabilidad",
            "statement": "La falta de tiempo objetivo definido en varias tareas reduce la confiabilidad de la proyección de capacidad futura.",
            "confidence": relation_confidence(0, 4 / 3),
            "evidencia": [
                {"label": "Tareas sin tiempo objetivo definido", "before": "—", "after": "4"},
                {"label": "Confiabilidad de la proyección", "before": "100%", "after": "70%"},
            ],
        }
    ]


# --- S6-D: compute_personal_benchmark ----------------------------------------------


def _perf_score_log(user, *, created_at: datetime, score: float, period: str = "2026-08") -> AnalyticsAuditLog:
    entry = AnalyticsAuditLog.objects.create(user=user, kind="performance_score", period=period, inputs={}, result={"score": score}, engine_version="1.5.0")
    AnalyticsAuditLog.objects.filter(pk=entry.pk).update(created_at=created_at)
    return entry


def test_compute_personal_benchmark_no_history_returns_neutral_defaults(user):
    benchmark = compute_personal_benchmark(user=user, current_score=80, data_quality_pct=100, now=NOW)
    assert benchmark == {
        "current": 80,
        "average": 80,
        "best_ever": None,
        "best_week": None,
        "last_4_weeks": None,
        "last_3_months": None,
        "percentile": 50,
        "narrative": "Sin historial personal suficiente todavía para comparar.",
        "observations": 0,
        "confidence": {"stars": 1, "label": "Muy baja"},
    }


def test_compute_personal_benchmark_computes_average_and_percentile(user):
    # Períodos distintos para que "mejor período histórico" (agrupado por
    # period) difiera del promedio general (que pondera cada auditoría).
    _perf_score_log(user, created_at=NOW - timedelta(days=40), score=70, period="2026-07")
    _perf_score_log(user, created_at=NOW - timedelta(days=5), score=90, period="2026-08")
    benchmark = compute_personal_benchmark(user=user, current_score=80, data_quality_pct=100, now=NOW)
    assert benchmark["observations"] == 2
    assert benchmark["average"] == 80.0
    assert benchmark["best_ever"] == {"score": 90.0, "period": "2026-08"}
    assert benchmark["percentile"] == 50  # 1 de 2 no-mejores (70) <= 80


def test_compute_personal_benchmark_best_ever_narrative(user):
    for i in range(4):
        _perf_score_log(user, created_at=NOW - timedelta(days=30 + i), score=60)
    benchmark = compute_personal_benchmark(user=user, current_score=95, data_quality_pct=100, now=NOW)
    assert benchmark["narrative"] == "Este es su mejor desempeño registrado en el historial disponible."


def test_compute_personal_benchmark_excludes_entries_outside_window(user):
    _perf_score_log(user, created_at=NOW - timedelta(days=400), score=99)
    benchmark = compute_personal_benchmark(user=user, current_score=80, data_quality_pct=100, now=NOW)
    assert benchmark["observations"] == 0


# --- S6-G: compute_recommendation_reevaluation --------------------------------------


def _alerts_log(user, *, created_at: datetime, rules: list[str]) -> AnalyticsAuditLog:
    entry = AnalyticsAuditLog.objects.create(user=user, kind="alerts", period="2026-08", inputs={}, result={"alerts": rules}, engine_version="1.5.0")
    AnalyticsAuditLog.objects.filter(pk=entry.pk).update(created_at=created_at)
    return entry


def _risk_log(user, *, created_at: datetime, score: float) -> AnalyticsAuditLog:
    entry = AnalyticsAuditLog.objects.create(user=user, kind="operational_risk", period="2026-08", inputs={}, result={"score": score}, engine_version="1.5.0")
    AnalyticsAuditLog.objects.filter(pk=entry.pk).update(created_at=created_at)
    return entry


def test_compute_recommendation_reevaluation_empty_without_alert_history(user):
    assert compute_recommendation_reevaluation(user=user, current_alerts=[], current_risk_score=10, now=NOW) == []


def test_compute_recommendation_reevaluation_mejorada_when_rule_no_longer_active(user):
    _alerts_log(user, created_at=NOW - timedelta(days=10), rules=["tareas_vencidas"])
    _risk_log(user, created_at=NOW - timedelta(days=10), score=20)
    results = compute_recommendation_reevaluation(user=user, current_alerts=[], current_risk_score=15, now=NOW)
    assert results == [{"rule": "tareas_vencidas", "message": "Tareas vencidas: la situación evolucionó favorablemente respecto a la recomendación anterior.", "status": "mejorada", "reference_days_ago": 10}]


def test_compute_recommendation_reevaluation_prioritaria_when_risk_worsened(user):
    _alerts_log(user, created_at=NOW - timedelta(days=10), rules=["tareas_vencidas"])
    _risk_log(user, created_at=NOW - timedelta(days=10), score=10)
    results = compute_recommendation_reevaluation(user=user, current_alerts=[{"rule": "tareas_vencidas"}], current_risk_score=20, now=NOW)
    assert results[0]["status"] == "prioritaria"


def test_compute_recommendation_reevaluation_valida_when_risk_stable(user):
    _alerts_log(user, created_at=NOW - timedelta(days=10), rules=["tareas_vencidas"])
    _risk_log(user, created_at=NOW - timedelta(days=10), score=10)
    results = compute_recommendation_reevaluation(user=user, current_alerts=[{"rule": "tareas_vencidas"}], current_risk_score=11, now=NOW)
    assert results[0]["status"] == "valida"


def test_compute_recommendation_reevaluation_sin_datos_without_matching_risk_entry(user):
    _alerts_log(user, created_at=NOW - timedelta(days=10), rules=["tareas_vencidas"])
    results = compute_recommendation_reevaluation(user=user, current_alerts=[{"rule": "tareas_vencidas"}], current_risk_score=20, now=NOW)
    assert results[0]["status"] == "sin-datos"


def test_compute_recommendation_reevaluation_unknown_rule_uses_raw_label(user):
    _alerts_log(user, created_at=NOW - timedelta(days=10), rules=["regla_desconocida"])
    results = compute_recommendation_reevaluation(user=user, current_alerts=[], current_risk_score=10, now=NOW)
    assert results[0]["message"].startswith("regla_desconocida:")


# --- S6-H: prioritize_recommendations / insight_priority / prioritize_insights -----


def _rankable(priority, impact_risk_pts, impact_score_pts=0, affected_count=1, ease_rank=0):
    return {"priority": priority, "impact_risk_pts": impact_risk_pts, "impact_score_pts": impact_score_pts, "affected_count": affected_count, "ease_rank": ease_rank}


def test_prioritize_recommendations_alta_priority_first():
    items = [_rankable("media", impact_risk_pts=100), _rankable("alta", impact_risk_pts=1)]
    ranked = prioritize_recommendations(items)
    assert ranked["top"][0]["priority"] == "alta"


def test_prioritize_recommendations_orders_by_risk_impact_within_same_priority():
    items = [_rankable("alta", impact_risk_pts=2), _rankable("alta", impact_risk_pts=8)]
    ranked = prioritize_recommendations(items)
    assert [r["impact_risk_pts"] for r in ranked["top"]] == [8, 2]


def test_prioritize_recommendations_splits_top_3_and_additional():
    items = [_rankable("alta", impact_risk_pts=i) for i in range(5)]
    ranked = prioritize_recommendations(items)
    assert len(ranked["top"]) == 3
    assert len(ranked["additional"]) == 2


def test_insight_priority_alta_when_risk_delta_at_least_10():
    insight = {"accion": {"impact": [{"metric": "Riesgo Operativo", "delta": -10, "unit": "pts"}]}}
    assert insight_priority(insight) == "alta"


def test_insight_priority_media_when_no_risk_impact():
    insight = {"accion": {"impact": [{"metric": "Performance Score", "delta": 5, "unit": "pts"}]}}
    assert insight_priority(insight) == "media"


def test_insight_priority_media_without_accion():
    assert insight_priority({"accion": None}) == "media"


def test_prioritize_insights_only_considers_risk_tone_with_accion():
    insights = [
        {"id": "positive-1", "tone": "positive", "accion": {"impact": None}},
        {"id": "risk-no-accion", "tone": "risk", "accion": None},
        {"id": "risk-1", "tone": "risk", "accion": {"impact": [{"metric": "Riesgo Operativo", "delta": -12, "unit": "pts"}]}},
    ]
    ranked = prioritize_insights(insights)
    assert [i["id"] for i in ranked["top"]] == ["risk-1"]
    assert ranked["additional"] == []
