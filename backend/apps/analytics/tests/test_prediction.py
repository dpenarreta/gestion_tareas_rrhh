"""Cobertura de apps.analytics.prediction — Fase 4l (ver
docs/AUDIT_LOG.md § 2026-08-12). Mockea las dependencias ya probadas en
sus propios archivos (`compute_monthly_history`/`compute_weekly_history`/
`compute_carga_tiempo`/`compute_consistency`) — mismo criterio que
`test_alerts_engine.py`."""

from datetime import datetime
from datetime import timezone as dt_timezone

import pytest

from apps.analytics import prediction as module
from apps.analytics.prediction import (
    compute_prediction,
    compute_prediction_confidence_pct,
    detect_anomalies,
)
from apps.users.models import User

pytestmark = pytest.mark.django_db

NOW = datetime(2026, 8, 12, 10, 0, tzinfo=dt_timezone.utc)


@pytest.fixture
def user():
    return User.objects.create_user(username="target", email="target@example.com", password="Sup3r-Secr3t!")


def _monthly(total_tasks=5, carga_real_hours=80, completed_pct=70, seguimiento_count=3):
    return {"total_tasks": total_tasks, "carga_real_hours": carga_real_hours, "completed_pct": completed_pct, "seguimiento_count": seguimiento_count}


# --- detect_anomalies --------------------------------------------------------------


def test_detect_anomalies_unavailable_with_insufficient_history(user, monkeypatch):
    monkeypatch.setattr(module, "compute_monthly_history", lambda *, user, months_back, now: [_monthly(), _monthly()])
    result = detect_anomalies(user=user, now=NOW)
    assert result == {"available": False, "reason": "Insuficiente historial para detectar anomalías", "anomalies": []}


def test_detect_anomalies_no_signal_within_threshold(user, monkeypatch):
    history = [_monthly(carga_real_hours=80) for _ in range(4)]
    current = _monthly(carga_real_hours=85)
    monkeypatch.setattr(module, "compute_monthly_history", lambda *, user, months_back, now: [*history, current])
    result = detect_anomalies(user=user, now=NOW)
    assert result["available"] is True
    assert result["anomalies"] == []


def test_detect_anomalies_yellow_severity_above_threshold(user, monkeypatch):
    # Umbral default 30%; 100h vs promedio 80h = +25%... se necesita >=30% para disparar.
    history = [_monthly(carga_real_hours=80) for _ in range(4)]
    current = _monthly(carga_real_hours=110)  # +37.5% vs 80
    monkeypatch.setattr(module, "compute_monthly_history", lambda *, user, months_back, now: [*history, current])
    result = detect_anomalies(user=user, now=NOW)
    carga_anomaly = next(a for a in result["anomalies"] if a["type"] == "carga_real_hours")
    assert carga_anomaly["severity"] == "yellow"


def test_detect_anomalies_orange_severity_far_above_threshold(user, monkeypatch):
    history = [_monthly(carga_real_hours=80) for _ in range(4)]
    current = _monthly(carga_real_hours=200)  # +150% vs 80, >> 1.5x el umbral
    monkeypatch.setattr(module, "compute_monthly_history", lambda *, user, months_back, now: [*history, current])
    result = detect_anomalies(user=user, now=NOW)
    carga_anomaly = next(a for a in result["anomalies"] if a["type"] == "carga_real_hours")
    assert carga_anomaly["severity"] == "orange"


def test_detect_anomalies_skips_months_without_data(user, monkeypatch):
    history = [_monthly(total_tasks=0, carga_real_hours=0), _monthly(), _monthly(), _monthly()]
    current = _monthly()
    monkeypatch.setattr(module, "compute_monthly_history", lambda *, user, months_back, now: [*history, current])
    # Solo 3 de los 4 meses previos tienen dato -> historial suficiente (>=3).
    result = detect_anomalies(user=user, now=NOW)
    assert result["available"] is True


# --- compute_prediction_confidence_pct (pura) ---------------------------------------


def test_compute_prediction_confidence_pct_never_reaches_100():
    pct = compute_prediction_confidence_pct(6, {"available": True, "level": "muy-consistente"}, 0)
    assert pct < 100
    assert pct <= 92


def test_compute_prediction_confidence_pct_lower_with_less_data():
    high = compute_prediction_confidence_pct(6, {"available": True, "level": "muy-consistente"}, 15)
    low = compute_prediction_confidence_pct(1, {"available": True, "level": "muy-consistente"}, 15)
    assert low < high


def test_compute_prediction_confidence_pct_unavailable_consistency_uses_neutral_score():
    pct = compute_prediction_confidence_pct(6, {"available": False}, 15)
    assert isinstance(pct, int)


# --- compute_prediction --------------------------------------------------------------


def _weekly(real_hours, business_days=5):
    return {"business_days": business_days, "real_hours": real_hours}


def test_compute_prediction_unavailable_without_weekly_data(user, monkeypatch):
    monkeypatch.setattr(module, "compute_weekly_history", lambda *, user, weeks_back, now: [_weekly(0, business_days=0)] * 6)
    result = compute_prediction(user=user, now=NOW)
    assert result == {"available": False, "reason": "Sin historial suficiente"}


def test_compute_prediction_available_with_expected_shape(user, monkeypatch):
    weekly = [_weekly(30), _weekly(32), _weekly(34), _weekly(36)]
    monkeypatch.setattr(module, "compute_weekly_history", lambda *, user, weeks_back, now: weekly)
    monkeypatch.setattr(module, "compute_carga_tiempo", lambda *, user, now: {"mensual": {"label": "Óptimo", "range_min": 0, "real_hours": 0}})
    monkeypatch.setattr(module, "compute_consistency", lambda *, user, now: {"available": True, "level": "consistente"})
    monkeypatch.setattr(module, "compute_monthly_history", lambda *, user, months_back, now: [_monthly(total_tasks=5, completed_pct=60)])
    result = compute_prediction(user=user, now=NOW)
    assert result["available"] is True
    assert result["confidence"] == "alta"  # 4 semanas con dato > 3
    assert result["weeks_of_data"] == 4
    assert result["carga_proxima_semana_horas"] >= 0
    assert 0 <= result["cumplimiento_estimado_rango"]["min"] <= result["cumplimiento_estimado_cierre_mes"] <= result["cumplimiento_estimado_rango"]["max"] <= 100
    assert result["max_projection_days"] == module.PREDICTION_MAX_DAYS


def test_compute_prediction_horas_para_rango_optimo_only_when_subutilizacion(user, monkeypatch):
    weekly = [_weekly(30)]
    monkeypatch.setattr(module, "compute_weekly_history", lambda *, user, weeks_back, now: weekly)
    monkeypatch.setattr(module, "compute_carga_tiempo", lambda *, user, now: {"mensual": {"label": "Subutilización", "range_min": 100, "real_hours": 40}})
    monkeypatch.setattr(module, "compute_consistency", lambda *, user, now: {"available": False})
    monkeypatch.setattr(module, "compute_monthly_history", lambda *, user, months_back, now: [_monthly(total_tasks=5, completed_pct=50)])
    result = compute_prediction(user=user, now=NOW)
    assert result["horas_para_rango_optimo"] == 60.0


def test_compute_prediction_confidence_baja_with_single_week(user, monkeypatch):
    monkeypatch.setattr(module, "compute_weekly_history", lambda *, user, weeks_back, now: [_weekly(30)])
    monkeypatch.setattr(module, "compute_carga_tiempo", lambda *, user, now: {"mensual": {"label": "Óptimo", "range_min": 0, "real_hours": 0}})
    monkeypatch.setattr(module, "compute_consistency", lambda *, user, now: {"available": False})
    monkeypatch.setattr(module, "compute_monthly_history", lambda *, user, months_back, now: [_monthly(total_tasks=0)])
    result = compute_prediction(user=user, now=NOW)
    assert result["confidence"] == "baja"  # 1 semana < prediction_min_weeks_media (2)
    assert result["cumplimiento_estimado_cierre_mes"] == 0  # total_tasks == 0
