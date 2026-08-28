"""Cobertura de la config del motor de Analytics — Fase 4d (ver
docs/AUDIT_LOG.md § 2026-08-11): `get_effective_analytics_config`
(apps.configuration.services) y `get_effective_curve`/
`get_all_effective_curves` (apps.analytics.normalization)."""

import json
from datetime import datetime
from datetime import timezone as dt_timezone

import pytest

from apps.analytics.normalization import (
    DEFAULT_CURVES,
    get_all_effective_curves,
    get_effective_curve,
)
from apps.configuration.models import SystemConfigHistory
from apps.configuration.services import ANALYTICS_CONFIG_DEFAULTS, get_effective_analytics_config
from apps.users.models import User

pytestmark = pytest.mark.django_db

NOW = datetime(2026, 8, 11, tzinfo=dt_timezone.utc)


@pytest.fixture
def admin():
    return User.objects.create_user(username="admin", email="admin@example.com", password="Sup3r-Secr3t!")


def test_get_effective_analytics_config_defaults_without_override():
    cfg = get_effective_analytics_config(NOW)
    assert cfg == ANALYTICS_CONFIG_DEFAULTS
    assert len(cfg) == 26


def test_get_effective_analytics_config_respects_override(admin):
    SystemConfigHistory.objects.create(
        key="analytics_health_weight_cumplimiento", value="40", valid_from=NOW, updated_by=admin
    )
    cfg = get_effective_analytics_config(NOW)
    assert cfg["health_weight_cumplimiento"] == 40
    assert cfg["health_weight_carga"] == ANALYTICS_CONFIG_DEFAULTS["health_weight_carga"]


def test_get_effective_curve_falls_back_to_default_without_override():
    assert get_effective_curve("carga", NOW) == DEFAULT_CURVES["carga"]


def test_get_effective_curve_uses_valid_json_override(admin):
    custom = [{"x": 0, "y": 10}, {"x": 100, "y": 90}]
    SystemConfigHistory.objects.create(
        key="analytics_curve_cumplimiento", value=json.dumps(custom), valid_from=NOW, updated_by=admin
    )
    assert get_effective_curve("cumplimiento", NOW) == custom


def test_get_effective_curve_falls_back_on_invalid_json(admin):
    SystemConfigHistory.objects.create(
        key="analytics_curve_cumplimiento", value="not-json", valid_from=NOW, updated_by=admin
    )
    assert get_effective_curve("cumplimiento", NOW) == DEFAULT_CURVES["cumplimiento"]


def test_get_effective_curve_falls_back_on_invalid_curve_shape(admin):
    SystemConfigHistory.objects.create(
        key="analytics_curve_cumplimiento", value=json.dumps([{"x": 0, "y": 999}]), valid_from=NOW, updated_by=admin
    )
    assert get_effective_curve("cumplimiento", NOW) == DEFAULT_CURVES["cumplimiento"]


def test_get_all_effective_curves_returns_all_6():
    curves = get_all_effective_curves(NOW)
    assert set(curves.keys()) == set(DEFAULT_CURVES.keys())
