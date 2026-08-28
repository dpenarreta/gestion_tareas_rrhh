"""Cobertura de `get_effective_role_target` — Fase 22 (ver
docs/AUDIT_LOG.md § 2026-08-20), réplica de `getEffectiveRoleTarget`
(`src/lib/systemConfig.ts`, Sprint 7)."""

import json
from datetime import datetime
from datetime import timezone as dt_timezone

import pytest

from apps.configuration.services import get_effective_role_target, set_config_value
from apps.users.models import User

pytestmark = pytest.mark.django_db

def _now() -> datetime:
    return datetime.now(dt_timezone.utc)


@pytest.fixture
def actor():
    return User.objects.create_user(username="admin", email="admin@example.com", password="Sup3r-Secr3t!")


def test_returns_none_when_never_configured():
    assert get_effective_role_target("ANALISTA_CC", _now()) is None


def test_returns_configured_target(actor):
    set_config_value(
        "analytics_role_target_analista_cc",
        json.dumps({"performance": 85, "riesgo_max": 40, "cumplimiento": 90}),
        actor,
    )
    target = get_effective_role_target("ANALISTA_CC", _now())
    assert target == {"performance": 85, "riesgo_max": 40, "cumplimiento": 90}


def test_returns_none_for_malformed_json(actor):
    set_config_value("analytics_role_target_analista_cc", "{not valid json", actor)
    assert get_effective_role_target("ANALISTA_CC", _now()) is None


def test_returns_none_for_non_object_json(actor):
    set_config_value("analytics_role_target_analista_cc", "42", actor)
    assert get_effective_role_target("ANALISTA_CC", _now()) is None


def test_ignores_non_numeric_fields(actor):
    set_config_value(
        "analytics_role_target_analista_cc",
        json.dumps({"performance": "no-es-numero", "riesgo_max": 40, "cumplimiento": None}),
        actor,
    )
    target = get_effective_role_target("ANALISTA_CC", _now())
    assert target == {"performance": None, "riesgo_max": 40, "cumplimiento": None}


def test_scoped_per_role(actor):
    set_config_value("analytics_role_target_analista_cc", json.dumps({"performance": 85, "riesgo_max": None, "cumplimiento": None}), actor)
    assert get_effective_role_target("COORDINADOR_NACIONAL", _now()) is None
