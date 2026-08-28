"""Cobertura HTTP de `/api/v1/analytics/<user_id>/` — Fase 4m (ver
docs/AUDIT_LOG.md § 2026-08-12), primer endpoint HTTP real del
territorio KPIs/Analytics. Mockea `run_analytics_pipeline`
(`pipeline.py`, ya probado en `test_pipeline.py`) para aislar el
ensamblado de payload/auth/visibilidad nuevos de esta vista — mismo
criterio que el resto de la migración."""

import pytest
from django.contrib.auth.models import Group
from rest_framework.test import APIClient

from apps.analytics import pipeline as pipeline_module
from apps.analytics.models import ANALYTICS_ENGINE_VERSION, FORMULA_SET_VERSION
from apps.users.models import User

pytestmark = pytest.mark.django_db


def _client_for(user: User) -> APIClient:
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.fixture
def admin():
    admin = User.objects.create_user(username="admin", email="admin@example.com", password="Sup3r-Secr3t!")
    admin.is_superuser = True
    admin.save()
    return admin


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
def asistente_seleccion():
    user = User.objects.create_user(username="asist_sel", email="asist_sel@example.com", password="Sup3r-Secr3t!")
    user.groups.set([Group.objects.get(name="ASISTENTE_SELECCION")])
    return user


def _fake_pipeline_result(validation_failures=None):
    return {
        "data_quality": {"pct": 100, "issues": []},
        "health_score": {"score": 80, "factors": []},
        "performance_score": {"score": 75, "factors": []},
        "consistency": {"available": False},
        "trends": {"cumplimiento": {"mes_anterior": {"available": False}}},
        "prediction": {"available": False, "reason": "Sin historial suficiente"},
        "anomalies": {"available": False, "reason": "x", "anomalies": []},
        "alerts": [],
        "alerts_history": [],
        "validation_failures": validation_failures or [],
    }


@pytest.fixture(autouse=True)
def _mock_run_analytics_pipeline(monkeypatch):
    monkeypatch.setattr(pipeline_module, "run_analytics_pipeline", lambda *, user, now: _fake_pipeline_result())


def test_analytics_bundle_requires_authentication():
    response = APIClient().get("/api/v1/analytics/1/")
    assert response.status_code == 401


def test_analytics_bundle_404_for_missing_user(analista):
    response = _client_for(analista).get("/api/v1/analytics/999999/")
    assert response.status_code == 404


def test_analytics_bundle_403_for_peer_outside_hierarchy(asistente_seleccion):
    other_peer = User.objects.create_user(username="peer", email="peer@example.com", password="Sup3r-Secr3t!")
    other_peer.groups.set([Group.objects.get(name="ASISTENTE_GH")])
    response = _client_for(asistente_seleccion).get(f"/api/v1/analytics/{other_peer.id}/")
    assert response.status_code == 403


def test_analytics_bundle_200_for_self(analista):
    response = _client_for(analista).get(f"/api/v1/analytics/{analista.id}/")
    assert response.status_code == 200
    assert response.data["health_score"]["score"] == 80


def test_analytics_bundle_200_for_visible_subordinate(coordinador_nacional, analista):
    response = _client_for(coordinador_nacional).get(f"/api/v1/analytics/{analista.id}/")
    assert response.status_code == 200
    assert response.data["performance_score"]["score"] == 75


def test_analytics_bundle_includes_engine_metadata(analista):
    response = _client_for(analista).get(f"/api/v1/analytics/{analista.id}/")
    assert response.data["engine_version"] == ANALYTICS_ENGINE_VERSION
    assert response.data["formula_set_version"] == FORMULA_SET_VERSION
    assert response.data["cache_active"] is False
    assert "last_updated" in response.data


def test_analytics_bundle_omits_validation_failures_key(analista):
    response = _client_for(analista).get(f"/api/v1/analytics/{analista.id}/")
    assert "validation_failures" not in response.data


def test_analytics_bundle_validation_warnings_present_for_admin_with_failures(admin, analista, monkeypatch):
    failures = [{"rule": "comprometido_negativo", "detail": "x"}]
    monkeypatch.setattr(pipeline_module, "run_analytics_pipeline", lambda *, user, now: _fake_pipeline_result(failures))
    response = _client_for(admin).get(f"/api/v1/analytics/{analista.id}/")
    assert response.data["validation_warnings"] == failures


def test_analytics_bundle_no_validation_warnings_for_non_admin_even_with_failures(coordinador_nacional, analista, monkeypatch):
    failures = [{"rule": "comprometido_negativo", "detail": "x"}]
    monkeypatch.setattr(pipeline_module, "run_analytics_pipeline", lambda *, user, now: _fake_pipeline_result(failures))
    response = _client_for(coordinador_nacional).get(f"/api/v1/analytics/{analista.id}/")
    assert "validation_warnings" not in response.data


def test_analytics_bundle_no_validation_warnings_for_admin_without_failures(admin, analista):
    response = _client_for(admin).get(f"/api/v1/analytics/{analista.id}/")
    assert "validation_warnings" not in response.data
