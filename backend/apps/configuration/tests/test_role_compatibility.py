"""Cobertura de `get_effective_role_compatibility` — Fase 24 (ver
docs/AUDIT_LOG.md § 2026-08-20), réplica de
`getEffectiveRoleCompatibility` (`src/lib/systemConfig.ts`)."""

import json
from datetime import datetime
from datetime import timezone as dt_timezone

import pytest

from apps.configuration.services import get_effective_role_compatibility, set_config_value
from apps.users.models import User

pytestmark = pytest.mark.django_db


@pytest.fixture
def actor():
    return User.objects.create_user(username="admin", email="admin@example.com", password="Sup3r-Secr3t!")


def _now() -> datetime:
    return datetime.now(dt_timezone.utc)


def test_empty_by_default():
    assert get_effective_role_compatibility("ANALISTA_CC", _now()) == []


def test_returns_configured_list(actor):
    set_config_value("analytics_role_compatibility_analista_cc", json.dumps(["COORDINADOR_ZS", "ANALISTA_SELECCION"]), actor)
    assert get_effective_role_compatibility("ANALISTA_CC", _now()) == ["COORDINADOR_ZS", "ANALISTA_SELECCION"]


def test_empty_for_malformed_json(actor):
    set_config_value("analytics_role_compatibility_analista_cc", "{not valid", actor)
    assert get_effective_role_compatibility("ANALISTA_CC", _now()) == []


def test_empty_for_non_list_json(actor):
    set_config_value("analytics_role_compatibility_analista_cc", json.dumps({"not": "a list"}), actor)
    assert get_effective_role_compatibility("ANALISTA_CC", _now()) == []


def test_ignores_non_string_entries(actor):
    set_config_value("analytics_role_compatibility_analista_cc", json.dumps(["COORDINADOR_ZS", 42, None]), actor)
    assert get_effective_role_compatibility("ANALISTA_CC", _now()) == ["COORDINADOR_ZS"]


def test_scoped_per_role(actor):
    set_config_value("analytics_role_compatibility_analista_cc", json.dumps(["COORDINADOR_ZS"]), actor)
    assert get_effective_role_compatibility("COORDINADOR_ZS", _now()) == []


def test_directional_not_mutual(actor):
    """La compatibilidad es direccional — configurar ANALISTA_CC→
    COORDINADOR_ZS no habilita el sentido inverso."""
    set_config_value("analytics_role_compatibility_analista_cc", json.dumps(["COORDINADOR_ZS"]), actor)
    assert get_effective_role_compatibility("COORDINADOR_ZS", _now()) == []
    assert get_effective_role_compatibility("ANALISTA_CC", _now()) == ["COORDINADOR_ZS"]
