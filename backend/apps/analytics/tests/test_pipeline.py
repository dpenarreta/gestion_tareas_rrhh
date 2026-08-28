"""Cobertura de apps.analytics.pipeline — Fase 4l (ver
docs/AUDIT_LOG.md § 2026-08-12). `run_analytics_pipeline` combina 9
dependencias ya probadas en sus propios archivos — mockearlas aísla el
ensamblado nuevo, mismo criterio que `test_alerts_engine.py`."""

from datetime import datetime
from datetime import timezone as dt_timezone

import pytest

from apps.analytics import pipeline as module
from apps.analytics.models import AnalyticsAuditLog
from apps.analytics.pipeline import run_analytics_pipeline, validate_analytics_consistency
from apps.users.models import User

pytestmark = pytest.mark.django_db

NOW = datetime(2026, 8, 12, 10, 0, tzinfo=dt_timezone.utc)


@pytest.fixture
def user():
    return User.objects.create_user(username="target", email="target@example.com", password="Sup3r-Secr3t!")


_HEALTH_SCORE = {"score": 80.0, "factors": [{"points": 50.0}, {"points": 30.0}]}
_PERFORMANCE_SCORE = {"score": 70.0, "factors": [{"points": 40.0}, {"points": 30.0}]}
_PREDICTION_AVAILABLE = {"available": True, "confidence": "alta", "weeks_of_data": 4, "confidence_pct": 80, "cumplimiento_estimado_cierre_mes": 75}
_PREDICTION_UNAVAILABLE = {"available": False, "reason": "Sin historial suficiente"}
_CAPACITY = {"disponible": 10.0, "base_futura_total": 20.0, "comprometido_futuro": 10.0}


# --- validate_analytics_consistency --------------------------------------------------


def test_validate_analytics_consistency_no_failures_when_everything_coherent(user):
    failures = validate_analytics_consistency(
        user=user, health_score=_HEALTH_SCORE, performance_score=_PERFORMANCE_SCORE, prediction=_PREDICTION_AVAILABLE, capacity=_CAPACITY, now=NOW
    )
    assert failures == []
    assert AnalyticsAuditLog.objects.filter(user=user, kind="validation_failure").count() == 0


def test_validate_analytics_consistency_capacidad_excede_base(user):
    capacity = {**_CAPACITY, "disponible": 25.0}  # > base_futura_total (20)
    failures = validate_analytics_consistency(
        user=user, health_score=_HEALTH_SCORE, performance_score=_PERFORMANCE_SCORE, prediction=_PREDICTION_UNAVAILABLE, capacity=capacity, now=NOW
    )
    assert any(f["rule"] == "capacidad_excede_base" for f in failures)


def test_validate_analytics_consistency_comprometido_negativo(user):
    capacity = {**_CAPACITY, "comprometido_futuro": -1.0}
    failures = validate_analytics_consistency(
        user=user, health_score=_HEALTH_SCORE, performance_score=_PERFORMANCE_SCORE, prediction=_PREDICTION_UNAVAILABLE, capacity=capacity, now=NOW
    )
    assert any(f["rule"] == "comprometido_negativo" for f in failures)


def test_validate_analytics_consistency_score_no_coincide(user):
    health_score = {"score": 99.0, "factors": [{"points": 50.0}, {"points": 30.0}]}  # suma real = 80
    failures = validate_analytics_consistency(
        user=user, health_score=health_score, performance_score=_PERFORMANCE_SCORE, prediction=_PREDICTION_UNAVAILABLE, capacity=_CAPACITY, now=NOW
    )
    assert any(f["rule"] == "score_no_coincide" for f in failures)


def test_validate_analytics_consistency_performance_score_fuera_de_rango(user):
    performance_score = {"score": 150.0, "factors": [{"points": 150.0}]}
    failures = validate_analytics_consistency(
        user=user, health_score=_HEALTH_SCORE, performance_score=performance_score, prediction=_PREDICTION_UNAVAILABLE, capacity=_CAPACITY, now=NOW
    )
    rules = {f["rule"] for f in failures}
    assert "performance_score_fuera_de_rango" in rules


def test_validate_analytics_consistency_prediccion_incompleta(user):
    prediction = {"available": True, "confidence": None, "weeks_of_data": 3, "confidence_pct": 60, "cumplimiento_estimado_cierre_mes": 70}
    failures = validate_analytics_consistency(
        user=user, health_score=_HEALTH_SCORE, performance_score=_PERFORMANCE_SCORE, prediction=prediction, capacity=_CAPACITY, now=NOW
    )
    assert any(f["rule"] == "prediccion_incompleta" for f in failures)


def test_validate_analytics_consistency_valor_no_finito(user):
    health_score = {"score": float("inf"), "factors": [{"points": float("inf")}]}
    failures = validate_analytics_consistency(
        user=user, health_score=health_score, performance_score=_PERFORMANCE_SCORE, prediction=_PREDICTION_UNAVAILABLE, capacity=_CAPACITY, now=NOW
    )
    assert any(f["rule"] == "valor_no_finito" for f in failures)


def test_validate_analytics_consistency_audits_only_when_failures(user):
    capacity = {**_CAPACITY, "comprometido_futuro": -1.0}
    validate_analytics_consistency(
        user=user, health_score=_HEALTH_SCORE, performance_score=_PERFORMANCE_SCORE, prediction=_PREDICTION_UNAVAILABLE, capacity=capacity, now=NOW
    )
    entry = AnalyticsAuditLog.objects.get(user=user, kind="validation_failure")
    assert entry.result["formula_versions"] == {}
    assert any(f["rule"] == "comprometido_negativo" for f in entry.result["failures"])


# --- run_analytics_pipeline -----------------------------------------------------------


def _mock_pipeline_dependencies(monkeypatch, *, alerts=None):
    monkeypatch.setattr(module, "compute_data_quality", lambda *, user_ids: {"pct": 100, "issues": []})
    monkeypatch.setattr(module, "compute_consistency", lambda *, user, now: {"available": False})
    monkeypatch.setattr(module, "compute_health_score", lambda *, user, now, precomputed_consistency: _HEALTH_SCORE)
    monkeypatch.setattr(module, "compute_performance_score", lambda *, user, now, precomputed_consistency: _PERFORMANCE_SCORE)
    monkeypatch.setattr(module, "compute_trends", lambda *, user, now: {"cumplimiento": {"mes_anterior": {"available": False}}})
    monkeypatch.setattr(module, "compute_prediction", lambda *, user, now: _PREDICTION_UNAVAILABLE)
    monkeypatch.setattr(module, "compute_capacity_forecast", lambda *, user, now: _CAPACITY)
    monkeypatch.setattr(module, "detect_anomalies", lambda *, user, now: {"available": False, "reason": "x", "anomalies": []})
    monkeypatch.setattr(module, "compute_alerts", lambda *, user, now: alerts if alerts is not None else [])
    monkeypatch.setattr(module, "get_resolved_alerts_history", lambda *, user, current_alerts, now: [{"rule": "resolved_rule"}])


def test_run_analytics_pipeline_assembles_expected_bundle(user, monkeypatch):
    _mock_pipeline_dependencies(monkeypatch, alerts=[])
    result = run_analytics_pipeline(user=user, now=NOW)
    assert set(result.keys()) == {
        "data_quality", "health_score", "performance_score", "consistency", "trends",
        "prediction", "anomalies", "alerts", "alerts_history", "validation_failures",
    }
    assert result["health_score"] == _HEALTH_SCORE
    assert result["performance_score"] == _PERFORMANCE_SCORE
    assert result["alerts"] == []
    assert result["alerts_history"] == [{"rule": "resolved_rule"}]
    assert result["validation_failures"] == []


def test_run_analytics_pipeline_skips_alerts_history_when_alerts_active(user, monkeypatch):
    _mock_pipeline_dependencies(monkeypatch, alerts=[{"rule": "tareas_vencidas"}])
    result = run_analytics_pipeline(user=user, now=NOW)
    assert result["alerts"] == [{"rule": "tareas_vencidas"}]
    assert result["alerts_history"] == []
