"""Cobertura de apps.analytics.trend_engine — Fase 9 (ver
docs/AUDIT_LOG.md § 2026-08-18), réplica de src/lib/trendEngine.ts."""

from datetime import datetime
from datetime import timezone as dt_timezone

import pytest

from apps.analytics.trend_engine import (
    TREND_INDICATORS,
    classify_trend_direction,
    compute_trend_engine,
)
from apps.users.models import User

pytestmark = pytest.mark.django_db

NOW = datetime(2026, 8, 12, 10, 0, tzinfo=dt_timezone.utc)


@pytest.fixture
def user():
    return User.objects.create_user(username="target", email="target@example.com", password="Sup3r-Secr3t!")


# --- classify_trend_direction ------------------------------------------------


def test_less_than_two_points_is_stable_with_zero_slope():
    assert classify_trend_direction([50]) == {"direction": "estable", "slope": 0, "cv": 0}


def test_flat_series_is_stable():
    result = classify_trend_direction([50, 50, 50, 50])
    assert result["direction"] == "estable"
    assert result["cv"] == 0


def test_strong_rising_line_is_positive_with_near_zero_cv():
    result = classify_trend_direction([10, 20, 30, 40, 50])
    assert result["direction"] == "positiva"
    assert result["slope"] > 0
    assert result["cv"] < 1


def test_strong_falling_line_is_negative():
    result = classify_trend_direction([50, 40, 30, 20, 10])
    assert result["direction"] == "negativa"
    assert result["slope"] < 0


def test_noisy_series_without_trend_is_variable():
    result = classify_trend_direction([50, 5, 50, 5, 50, 5])
    assert result["direction"] == "variable"
    assert result["cv"] >= 35


def test_abrupt_change_on_last_point_overrides_variable():
    # 4 puntos estables seguidos de un salto brusco en el último.
    result = classify_trend_direction([50, 51, 49, 50, 200])
    assert result["direction"] == "cambio_brusco"


# --- compute_trend_engine -----------------------------------------------------


def test_default_window_weeks_is_3(user):
    result = compute_trend_engine(user=user, now=NOW)
    assert result["window_weeks"] == 3
    assert result["user_id"] == user.id
    assert set(result["indicators"].keys()) == set(TREND_INDICATORS)


def test_window_weeks_override_is_respected(user):
    result = compute_trend_engine(user=user, now=NOW, window_weeks_override=6)
    assert result["window_weeks"] == 6


def test_proyectos_and_actividades_always_have_window_weeks_points_even_with_no_data(user):
    result = compute_trend_engine(user=user, now=NOW, window_weeks_override=4)
    assert result["indicators"]["proyectos"]["available"] is True
    assert len(result["indicators"]["proyectos"]["data_points"]) == 4
    assert all(p["value"] == 0 for p in result["indicators"]["proyectos"]["data_points"])
    assert result["indicators"]["actividades"]["available"] is True
    assert len(result["indicators"]["actividades"]["data_points"]) == 4


def test_indicators_without_history_are_unavailable_with_reason(user):
    result = compute_trend_engine(user=user, now=NOW)
    assert result["indicators"]["productividad"]["available"] is False
    assert result["indicators"]["productividad"]["reason"]
    assert result["indicators"]["equilibrio_operativo"]["available"] is False
    assert result["indicators"]["consistencia_operativa"]["available"] is False
