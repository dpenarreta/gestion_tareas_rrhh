"""Cobertura de apps.analytics.audit_history — Fase 4j (ver
docs/AUDIT_LOG.md § 2026-08-12)."""

from datetime import datetime, timedelta
from datetime import timezone as dt_timezone

import pytest

from apps.analytics.audit_history import (
    _parse_audit_result,
    closest_factor_point,
    get_factor_audit_history,
)
from apps.analytics.models import AnalyticsAuditLog
from apps.users.models import User

pytestmark = pytest.mark.django_db

NOW = datetime(2026, 8, 12, 10, 0, tzinfo=dt_timezone.utc)


@pytest.fixture
def user():
    return User.objects.create_user(username="target", email="target@example.com", password="Sup3r-Secr3t!")


def _log(user, *, kind: str, created_at: datetime, result: dict) -> AnalyticsAuditLog:
    entry = AnalyticsAuditLog.objects.create(user=user, kind=kind, period="2026-08", inputs={}, result=result, engine_version="1.5.0")
    AnalyticsAuditLog.objects.filter(pk=entry.pk).update(created_at=created_at)
    entry.refresh_from_db()
    return entry


# --- _parse_audit_result (pura) ------------------------------------------------


def test_parse_audit_result_non_dict_returns_empty():
    assert _parse_audit_result(None) == {}
    assert _parse_audit_result("not a dict") == {}


def test_parse_audit_result_extracts_score_classification_factors():
    parsed = _parse_audit_result(
        {
            "score": 82.5,
            "classification": "Bueno",
            "factors": [{"name": "Cumplimiento", "points": 30, "weight": 40, "raw_label": "80%", "detail": "d"}],
        }
    )
    assert parsed == {
        "score": 82.5,
        "classification": "Bueno",
        "factors": [{"name": "Cumplimiento", "points": 30, "weight": 40, "raw_label": "80%", "detail": "d"}],
    }


def test_parse_audit_result_ignores_malformed_factors():
    parsed = _parse_audit_result({"score": 50, "factors": ["not-a-dict", {"name": ""}, {"points": "x"}]})
    assert parsed["factors"] == []


def test_parse_audit_result_score_bool_is_rejected():
    # bool es subclase de int en Python — el TS original solo acepta number real.
    assert _parse_audit_result({"score": True})["score"] is None


# --- get_factor_audit_history ---------------------------------------------------


def test_get_factor_audit_history_empty_when_no_rows(user):
    assert get_factor_audit_history(user=user, kind="performance_score", now=NOW, window_days=30) == []


def test_get_factor_audit_history_returns_rows_within_window_desc_order(user):
    _log(user, kind="performance_score", created_at=NOW - timedelta(days=5), result={"score": 80, "factors": []})
    _log(user, kind="performance_score", created_at=NOW - timedelta(days=2), result={"score": 90, "factors": []})
    history = get_factor_audit_history(user=user, kind="performance_score", now=NOW, window_days=30)
    assert [h["score"] for h in history] == [90, 80]


def test_get_factor_audit_history_excludes_outside_window(user):
    _log(user, kind="performance_score", created_at=NOW - timedelta(days=60), result={"score": 80, "factors": []})
    assert get_factor_audit_history(user=user, kind="performance_score", now=NOW, window_days=30) == []


def test_get_factor_audit_history_skips_rows_without_numeric_score(user):
    _log(user, kind="performance_score", created_at=NOW - timedelta(days=1), result={"factors": []})
    assert get_factor_audit_history(user=user, kind="performance_score", now=NOW, window_days=30) == []


def test_get_factor_audit_history_filters_by_kind(user):
    _log(user, kind="health_score", created_at=NOW - timedelta(days=1), result={"score": 70, "factors": []})
    assert get_factor_audit_history(user=user, kind="performance_score", now=NOW, window_days=30) == []


# --- closest_factor_point (pura) ------------------------------------------------


def test_closest_factor_point_none_when_empty():
    assert closest_factor_point([], NOW, 30) is None


def test_closest_factor_point_picks_nearest_within_tolerance():
    history = [
        {"created_at": NOW - timedelta(days=28), "score": 70, "factors": []},
        {"created_at": NOW - timedelta(days=31), "score": 80, "factors": []},
        {"created_at": NOW - timedelta(days=60), "score": 90, "factors": []},
    ]
    point = closest_factor_point(history, NOW, 30)
    assert point["score"] == 80


def test_closest_factor_point_none_when_outside_tolerance():
    history = [{"created_at": NOW - timedelta(days=10), "score": 70, "factors": []}]
    assert closest_factor_point(history, NOW, 30, tolerance_days=3) is None
