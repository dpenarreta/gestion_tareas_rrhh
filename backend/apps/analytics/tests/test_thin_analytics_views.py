"""Cobertura HTTP de las rutas delgadas de Analytics — Fase 16 (ver
docs/AUDIT_LOG.md § 2026-08-20): `GET /api/v1/analytics/insights/<id>/`,
`GET /api/v1/analytics/equilibrio/<id>/`,
`GET /api/v1/analytics/operational-risk/<id>/`; Fase 17 (misma fecha):
`GET /api/v1/analytics/history/<id>/`,
`GET /api/v1/analytics/target-time/<id>/`,
`GET /api/v1/analytics/data-quality/`. A diferencia de
`test_analytics_bundle_view.py` (que mockea un único orquestador), estas
vistas componen sobre VARIAS funciones del motor ya cubiertas por sus
propios tests unitarios (`test_health_score.py`/`test_operational_risk.py`/
`test_insights_engine.py`/etc.) — se prueban con datos reales (colaborador
sin tareas, camino ya confirmado seguro por esos tests) para validar el
ensamblado HTTP/auth/visibilidad, sin reafirmar los valores de negocio."""

import pytest
from django.contrib.auth.models import Group
from rest_framework.test import APIClient

from apps.analytics.models import ANALYTICS_ENGINE_VERSION, FORMULA_SET_VERSION
from apps.users.models import User

pytestmark = pytest.mark.django_db


def _client_for(user: User) -> APIClient:
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.fixture
def analista():
    user = User.objects.create_user(username="analista", email="analista@example.com", password="Sup3r-Secr3t!")
    user.groups.set([Group.objects.get(name="ANALISTA_CC")])
    return user


@pytest.fixture
def coordinador_nacional():
    user = User.objects.create_user(username="coord_nac", email="coord_nac@example.com", password="Sup3r-Secr3t!")
    user.groups.set([Group.objects.get(name="COORDINADOR_NACIONAL")])
    return user


@pytest.fixture
def jefe_nacional():
    user = User.objects.create_user(username="jefe", email="jefe@example.com", password="Sup3r-Secr3t!")
    user.groups.set([Group.objects.get(name="JEFE_NACIONAL")])
    return user


@pytest.fixture
def asistente_seleccion():
    user = User.objects.create_user(username="asist_sel", email="asist_sel@example.com", password="Sup3r-Secr3t!")
    user.groups.set([Group.objects.get(name="ASISTENTE_SELECCION")])
    return user


# --- GET /analytics/insights/<id>/ -------------------------------------------------------


def test_insights_requires_authentication():
    response = APIClient().get("/api/v1/analytics/insights/1/")
    assert response.status_code == 401


def test_insights_404_for_missing_user(analista):
    response = _client_for(analista).get("/api/v1/analytics/insights/999999/")
    assert response.status_code == 404


def test_insights_403_for_peer_outside_hierarchy(asistente_seleccion):
    other_peer = User.objects.create_user(username="peer", email="peer@example.com", password="Sup3r-Secr3t!")
    other_peer.groups.set([Group.objects.get(name="ASISTENTE_GH")])
    response = _client_for(asistente_seleccion).get(f"/api/v1/analytics/insights/{other_peer.id}/")
    assert response.status_code == 403


def test_insights_200_for_self_includes_expected_keys(analista):
    response = _client_for(analista).get(f"/api/v1/analytics/insights/{analista.id}/")
    assert response.status_code == 200
    for key in (
        "insights", "prioritized", "relations", "personal_benchmark", "reevaluations",
        "performance_trend_explained", "engine_version", "insights_engine_version", "last_updated",
    ):
        assert key in response.data
    assert response.data["engine_version"] == ANALYTICS_ENGINE_VERSION


def test_insights_200_for_visible_subordinate(coordinador_nacional, analista):
    response = _client_for(coordinador_nacional).get(f"/api/v1/analytics/insights/{analista.id}/")
    assert response.status_code == 200


# --- GET /analytics/equilibrio/<id>/ -----------------------------------------------------


def test_equilibrio_requires_authentication():
    response = APIClient().get("/api/v1/analytics/equilibrio/1/")
    assert response.status_code == 401


def test_equilibrio_404_for_missing_user(analista):
    response = _client_for(analista).get("/api/v1/analytics/equilibrio/999999/")
    assert response.status_code == 404


def test_equilibrio_403_for_peer_outside_hierarchy(asistente_seleccion):
    other_peer = User.objects.create_user(username="peer2", email="peer2@example.com", password="Sup3r-Secr3t!")
    other_peer.groups.set([Group.objects.get(name="ASISTENTE_GH")])
    response = _client_for(asistente_seleccion).get(f"/api/v1/analytics/equilibrio/{other_peer.id}/")
    assert response.status_code == 403


def test_equilibrio_200_for_self_includes_expected_shape(analista):
    response = _client_for(analista).get(f"/api/v1/analytics/equilibrio/{analista.id}/")
    assert response.status_code == 200
    for key in (
        "health_score", "dimensiones", "estado", "escala", "trend", "meaning", "impact",
        "strengths", "weaknesses", "recommendations", "confidence", "calidad",
    ):
        assert key in response.data
    assert response.data["calidad"]["engine_version"] == ANALYTICS_ENGINE_VERSION
    assert response.data["calidad"]["formula_set_version"] == FORMULA_SET_VERSION
    assert response.data["calidad"]["cache_active"] is False
    assert "tiempo_calculo_ms" in response.data["calidad"]


def test_equilibrio_neutral_confidence_and_warning_without_consistency_history(analista):
    """Colaborador recién creado, sin historial — `compute_consistency`
    devuelve `available: False` (réplica confirmada por
    `test_history.py`), así que la ruta debe usar el 50% neutro y sumar
    la advertencia, réplica exacta del `route.ts`."""
    response = _client_for(analista).get(f"/api/v1/analytics/equilibrio/{analista.id}/")
    assert response.data["confidence"]["reliability_pct"] == 50
    assert response.data["calidad"]["advertencias"] != []


# --- GET /analytics/operational-risk/<id>/ -----------------------------------------------


def test_operational_risk_requires_authentication():
    response = APIClient().get("/api/v1/analytics/operational-risk/1/")
    assert response.status_code == 401


def test_operational_risk_403_for_role_outside_whitelist_even_for_self(analista):
    """`can_view_operational_risk` es un whitelist de roles puntual
    (gerencia) — ANALISTA_CC no está incluido, ni siquiera para ver su
    propio índice."""
    response = _client_for(analista).get(f"/api/v1/analytics/operational-risk/{analista.id}/")
    assert response.status_code == 403


def test_operational_risk_403_checked_before_404_for_missing_user(analista):
    """Réplica del orden exacto del `route.ts`: el whitelist de rol se
    chequea ANTES de buscar al usuario objetivo — un id inexistente
    con un actor sin permiso de rol debe dar 403 (el whitelist), no
    404 (que solo se alcanzaría si el rol pasara el primer chequeo)."""
    response = _client_for(analista).get("/api/v1/analytics/operational-risk/999999/")
    assert response.status_code == 403


def test_operational_risk_404_for_missing_user_when_role_is_whitelisted(coordinador_nacional):
    response = _client_for(coordinador_nacional).get("/api/v1/analytics/operational-risk/999999/")
    assert response.status_code == 404


def test_operational_risk_403_for_peer_outside_hierarchy(coordinador_nacional, jefe_nacional):
    """Coordinador Nacional está en el whitelist de rol, pero Jefe
    Nacional no es visible para él (jerarquía: ve a todos excepto al
    Jefe) — debe dar 403 por visibilidad, no 200."""
    response = _client_for(coordinador_nacional).get(f"/api/v1/analytics/operational-risk/{jefe_nacional.id}/")
    assert response.status_code == 403


def test_operational_risk_200_for_self_includes_expected_shape(coordinador_nacional):
    response = _client_for(coordinador_nacional).get(f"/api/v1/analytics/operational-risk/{coordinador_nacional.id}/")
    assert response.status_code == 200
    for key in ("score", "classification", "factors", "confidence", "trend_explained", "engine_version", "last_updated"):
        assert key in response.data
    assert response.data["engine_version"] == ANALYTICS_ENGINE_VERSION
    assert response.data["confidence"]["reliability_pct"] == 50


def test_operational_risk_200_for_visible_subordinate(coordinador_nacional, analista):
    response = _client_for(coordinador_nacional).get(f"/api/v1/analytics/operational-risk/{analista.id}/")
    assert response.status_code == 200


# --- GET /analytics/history/<id>/ (Fase 17) -----------------------------------------------


def test_history_requires_authentication():
    response = APIClient().get("/api/v1/analytics/history/1/")
    assert response.status_code == 401


def test_history_404_for_missing_user(analista):
    response = _client_for(analista).get("/api/v1/analytics/history/999999/")
    assert response.status_code == 404


def test_history_403_for_peer_outside_hierarchy(asistente_seleccion):
    other_peer = User.objects.create_user(username="peer3", email="peer3@example.com", password="Sup3r-Secr3t!")
    other_peer.groups.set([Group.objects.get(name="ASISTENTE_GH")])
    response = _client_for(asistente_seleccion).get(f"/api/v1/analytics/history/{other_peer.id}/")
    assert response.status_code == 403


def test_history_defaults_to_performance_score_and_3_months(analista):
    response = _client_for(analista).get(f"/api/v1/analytics/history/{analista.id}/")
    assert response.status_code == 200
    assert response.data["kind"] == "performance_score"
    assert response.data["months"] == 3
    assert response.data["points"] == []


def test_history_accepts_valid_kind_and_months_override(analista):
    response = _client_for(analista).get(f"/api/v1/analytics/history/{analista.id}/?kind=health_score&months=12")
    assert response.status_code == 200
    assert response.data["kind"] == "health_score"
    assert response.data["months"] == 12


def test_history_falls_back_to_defaults_for_invalid_kind_and_months(analista):
    response = _client_for(analista).get(f"/api/v1/analytics/history/{analista.id}/?kind=not-a-kind&months=7")
    assert response.status_code == 200
    assert response.data["kind"] == "performance_score"
    assert response.data["months"] == 3


# --- GET /analytics/target-time/<id>/ (Fase 17) -------------------------------------------


def test_target_time_requires_authentication():
    response = APIClient().get("/api/v1/analytics/target-time/1/")
    assert response.status_code == 401


def test_target_time_404_for_missing_user(analista):
    response = _client_for(analista).get("/api/v1/analytics/target-time/999999/")
    assert response.status_code == 404


def test_target_time_403_for_peer_outside_hierarchy(asistente_seleccion):
    other_peer = User.objects.create_user(username="peer4", email="peer4@example.com", password="Sup3r-Secr3t!")
    other_peer.groups.set([Group.objects.get(name="ASISTENTE_GH")])
    response = _client_for(asistente_seleccion).get(f"/api/v1/analytics/target-time/{other_peer.id}/")
    assert response.status_code == 403


def test_target_time_200_unavailable_without_completed_tasks(analista):
    response = _client_for(analista).get(f"/api/v1/analytics/target-time/{analista.id}/")
    assert response.status_code == 200
    assert response.data["available"] is False
    assert response.data["engine_version"] == ANALYTICS_ENGINE_VERSION
    assert "last_updated" in response.data


# --- GET /analytics/data-quality/ (Fase 17) -----------------------------------------------


def test_data_quality_requires_authentication():
    response = APIClient().get("/api/v1/analytics/data-quality/")
    assert response.status_code == 401


def test_data_quality_defaults_to_self_scope(analista):
    response = _client_for(analista).get("/api/v1/analytics/data-quality/")
    assert response.status_code == 200
    # Sin `SystemConfigHistory` de horas efectivas en la BD de test (mismo
    # estado que un despliegue recién inicializado) — `sin_horas_config`
    # siempre aporta ese único issue, réplica fiel de `compute_data_quality`.
    assert response.data["pct"] == 90
    assert [i["key"] for i in response.data["issues"]] == ["sin_horas_config"]


def test_data_quality_team_scope_requires_can_view_team(asistente_seleccion):
    response = _client_for(asistente_seleccion).get("/api/v1/analytics/data-quality/?scope=team")
    assert response.status_code == 403


def test_data_quality_team_scope_200_for_leadership(coordinador_nacional, analista):
    response = _client_for(coordinador_nacional).get("/api/v1/analytics/data-quality/?scope=team")
    assert response.status_code == 200
    assert response.data["pct"] == 90
    assert [i["key"] for i in response.data["issues"]] == ["sin_horas_config"]
