"""Cobertura de apps.analytics.recommendations — Fase 24 (ver
docs/AUDIT_LOG.md § 2026-08-20), réplica de `computeTeamRecommendations`
(`src/lib/analytics.ts`). `compute_team_capacity_forecast` se mockea
para controlar con precisión los valores de capacidad por miembro —
esa función ya está cubierta por sus propios tests
(`test_capacity_forecast.py`)."""

import json
from datetime import datetime
from datetime import timezone as dt_timezone

import pytest

from apps.analytics import recommendations as module
from apps.analytics.recommendations import compute_team_recommendations
from apps.configuration.services import set_config_value
from apps.users.models import User

pytestmark = pytest.mark.django_db

NOW = datetime(2026, 8, 20, 10, 0, tzinfo=dt_timezone.utc)


@pytest.fixture
def actor():
    return User.objects.create_user(username="admin", email="admin@example.com", password="Sup3r-Secr3t!")


def _capacity(disponible, disponible_pct, base_futura_total=100.0, estado="alta"):
    return {"disponible": disponible, "disponible_pct": disponible_pct, "base_futura_total": base_futura_total, "estado": estado}


def _patch_capacity(monkeypatch, values: dict):
    monkeypatch.setattr(module, "compute_team_capacity_forecast", lambda *, user_ids, now: values)


def test_returns_empty_for_fewer_than_two_members():
    assert compute_team_recommendations(members=[], now=NOW) == []
    assert compute_team_recommendations(members=[{"id": 1, "name": "A", "role": "ANALISTA_CC"}], now=NOW) == []


def test_no_recommendations_when_nobody_overloaded(monkeypatch):
    members = [{"id": 1, "name": "A", "role": "ANALISTA_CC"}, {"id": 2, "name": "B", "role": "ANALISTA_CC"}]
    _patch_capacity(monkeypatch, {1: _capacity(10, 20), 2: _capacity(5, 10)})
    assert compute_team_recommendations(members=members, now=NOW) == []


def test_overloaded_redistributed_to_same_role_available(monkeypatch):
    members = [{"id": 1, "name": "Ana", "role": "ANALISTA_CC"}, {"id": 2, "name": "Beto", "role": "ANALISTA_CC"}]
    _patch_capacity(monkeypatch, {1: _capacity(-8, -20, estado="sobrecarga"), 2: _capacity(15, 30)})

    result = compute_team_recommendations(members=members, now=NOW)
    assert len(result) == 1
    rec = result[0]
    assert rec["id"] == 1
    assert rec["has_candidate"] is True
    assert "Ana" in rec["text"]
    assert "Beto" in rec["text"]
    assert rec["affected_count"] == 2


@pytest.mark.parametrize(
    "excess,pct,expected_priority",
    [(-12, -20, "alta"), (-5, -35, "alta"), (-3, -10, "media")],
)
def test_priority_thresholds(monkeypatch, excess, pct, expected_priority):
    members = [{"id": 1, "name": "Ana", "role": "ANALISTA_CC"}, {"id": 2, "name": "Beto", "role": "ANALISTA_CC"}]
    _patch_capacity(monkeypatch, {1: _capacity(excess, pct, estado="sobrecarga"), 2: _capacity(20, 40)})
    result = compute_team_recommendations(members=members, now=NOW)
    assert result[0]["priority"] == expected_priority
    assert result[0]["priority_color"] == ("red" if expected_priority == "alta" else "yellow")


def test_never_crosses_hierarchy_levels(monkeypatch):
    """ANALISTA_CC (nivel 2) y JEFE_NACIONAL (nivel 4) nunca deben
    cruzarse, ni siquiera si estuvieran configurados como compatibles
    (la Regla 4 es dura, no depende de la matriz)."""
    members = [{"id": 1, "name": "Ana", "role": "ANALISTA_CC"}, {"id": 2, "name": "Jefe", "role": "JEFE_NACIONAL"}]
    _patch_capacity(monkeypatch, {1: _capacity(-8, -20, estado="sobrecarga"), 2: _capacity(50, 80)})

    result = compute_team_recommendations(members=members, now=NOW)
    assert result[0]["has_candidate"] is False
    assert "No existe actualmente un colaborador compatible" in result[0]["text"]


def test_uses_role_compatibility_matrix_as_fallback(monkeypatch, actor):
    """ANALISTA_CC y COORDINADOR_ZS comparten nivel 2 — sin
    compatibilidad configurada, no se cruzan (Regla 1: mismo cargo
    primero, sin respaldo); configurando la matriz, sí."""
    members = [{"id": 1, "name": "Ana", "role": "ANALISTA_CC"}, {"id": 2, "name": "Coord", "role": "COORDINADOR_ZS"}]
    _patch_capacity(monkeypatch, {1: _capacity(-8, -20, estado="sobrecarga"), 2: _capacity(15, 30)})

    without_matrix = compute_team_recommendations(members=members, now=NOW)
    assert without_matrix[0]["has_candidate"] is False

    set_config_value("analytics_role_compatibility_analista_cc", json.dumps(["COORDINADOR_ZS"]), actor)
    # `now` debe ser posterior al `valid_from` real que `set_config_value`
    # acaba de escribir (tiempo real de ejecución) — reusar la constante
    # `NOW` (fija, del pasado) dejaría el config recién creado fuera de
    # vigencia y el test fallaría por una carrera de reloj, no por lógica.
    after_config_change = datetime.now(dt_timezone.utc)
    with_matrix = compute_team_recommendations(members=members, now=after_config_change)
    assert with_matrix[0]["has_candidate"] is True
    assert "Coord" in with_matrix[0]["text"]


def test_no_candidate_message_when_pool_empty(monkeypatch):
    members = [{"id": 1, "name": "Ana", "role": "ANALISTA_CC"}, {"id": 2, "name": "Beto", "role": "ANALISTA_CC"}]
    _patch_capacity(monkeypatch, {1: _capacity(-8, -20, estado="sobrecarga"), 2: _capacity(-2, -5, estado="sobrecarga")})

    result = compute_team_recommendations(members=members, now=NOW)
    assert result[0]["has_candidate"] is False
    assert result[0]["impact_score_pts"] == 0
    assert result[0]["impact_risk_pts"] == 0
    assert result[0]["ease_rank"] == 99


def test_evaluates_at_most_five_overloaded(monkeypatch):
    members = [{"id": i, "name": f"U{i}", "role": "ANALISTA_CC"} for i in range(1, 8)]
    capacities = {i: _capacity(-1 - i, -10 - i, estado="sobrecarga") for i in range(1, 7)}
    capacities[7] = _capacity(100, 100)
    _patch_capacity(monkeypatch, capacities)

    result = compute_team_recommendations(members=members, now=NOW)
    assert len(result) == 5


def test_sorts_alta_priority_first(monkeypatch):
    members = [
        {"id": 1, "name": "Media", "role": "ANALISTA_CC"},
        {"id": 2, "name": "Alta", "role": "ANALISTA_CC"},
        {"id": 3, "name": "Disponible", "role": "ANALISTA_CC"},
    ]
    _patch_capacity(
        monkeypatch,
        {1: _capacity(-3, -10, estado="sobrecarga"), 2: _capacity(-15, -40, estado="sobrecarga"), 3: _capacity(50, 80)},
    )
    result = compute_team_recommendations(members=members, now=NOW)
    assert [r["priority"] for r in result] == ["alta", "media"]
    assert result[0]["id"] == 2
