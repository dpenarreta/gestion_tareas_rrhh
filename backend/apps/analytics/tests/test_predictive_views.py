"""Cobertura HTTP de `/api/v1/predictive/predictions/<user_id>/` y
`/api/v1/predictive/trend/<user_id>/` — Fase 9 (ver docs/AUDIT_LOG.md §
2026-08-18), mismo patrón de auth/visibilidad jerárquica que
`test_kpi_views.py`."""

import pytest
from django.contrib.auth.models import Group
from django.utils import timezone
from rest_framework.test import APIClient

from apps.projects.models import Project
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
def asistente_seleccion():
    user = User.objects.create_user(username="asist_sel", email="asist_sel@example.com", password="Sup3r-Secr3t!")
    user.groups.set([Group.objects.get(name="ASISTENTE_SELECCION")])
    return user


# --- PredictionBundleView -------------------------------------------------------


def test_prediction_bundle_returns_200_for_self(analista):
    response = _client_for(analista).get(f"/api/v1/predictive/predictions/{analista.id}/")
    assert response.status_code == 200
    assert set(response.data.keys()) == {"cumplimiento", "sobrecarga", "estabilidad", "task_delays"}


def test_prediction_bundle_requires_authentication(analista):
    response = APIClient().get(f"/api/v1/predictive/predictions/{analista.id}/")
    assert response.status_code == 401


def test_prediction_bundle_404_for_missing_user(analista):
    response = _client_for(analista).get("/api/v1/predictive/predictions/999999/")
    assert response.status_code == 404


def test_prediction_bundle_403_for_peer_outside_hierarchy(asistente_seleccion):
    other_peer = User.objects.create_user(username="peer", email="peer@example.com", password="Sup3r-Secr3t!")
    other_peer.groups.set([Group.objects.get(name="ASISTENTE_GH")])
    response = _client_for(asistente_seleccion).get(f"/api/v1/predictive/predictions/{other_peer.id}/")
    assert response.status_code == 403


def test_prediction_bundle_200_for_visible_subordinate(coordinador_nacional, analista):
    response = _client_for(coordinador_nacional).get(f"/api/v1/predictive/predictions/{analista.id}/")
    assert response.status_code == 200


def test_prediction_bundle_accepts_as_of_query_param(analista):
    # Fase 85 (ver docs/AUDIT_LOG.md § 2026-08-27) — `as_of` opcional, para
    # que Reportes Ejecutivos pueda regenerar con una fecha de corte pasada.
    response = _client_for(analista).get(f"/api/v1/predictive/predictions/{analista.id}/?as_of=2026-06-15T00:00:00Z")
    assert response.status_code == 200
    assert set(response.data.keys()) == {"cumplimiento", "sobrecarga", "estabilidad", "task_delays"}


def test_prediction_bundle_ignores_invalid_as_of(analista):
    response = _client_for(analista).get(f"/api/v1/predictive/predictions/{analista.id}/?as_of=no-es-una-fecha")
    assert response.status_code == 200


# --- TrendEngineView -------------------------------------------------------------


def test_trend_engine_returns_200_for_self_with_default_window(analista):
    response = _client_for(analista).get(f"/api/v1/predictive/trend/{analista.id}/")
    assert response.status_code == 200
    assert response.data["window_weeks"] == 3
    assert response.data["user_id"] == analista.id


def test_trend_engine_respects_weeks_back_override(analista):
    response = _client_for(analista).get(f"/api/v1/predictive/trend/{analista.id}/?weeks_back=6")
    assert response.status_code == 200
    assert response.data["window_weeks"] == 6


def test_trend_engine_ignores_out_of_range_weeks_back(analista):
    response = _client_for(analista).get(f"/api/v1/predictive/trend/{analista.id}/?weeks_back=999")
    assert response.status_code == 200
    assert response.data["window_weeks"] == 3


def test_trend_engine_403_for_peer_outside_hierarchy(asistente_seleccion):
    other_peer = User.objects.create_user(username="peer", email="peer@example.com", password="Sup3r-Secr3t!")
    other_peer.groups.set([Group.objects.get(name="ASISTENTE_GH")])
    response = _client_for(asistente_seleccion).get(f"/api/v1/predictive/trend/{other_peer.id}/")
    assert response.status_code == 403


def test_trend_engine_404_for_missing_user(analista):
    response = _client_for(analista).get("/api/v1/predictive/trend/999999/")
    assert response.status_code == 404


# --- PreventiveAlertsView --------------------------------------------------------


def test_preventive_alerts_returns_200_for_self(analista):
    response = _client_for(analista).get(f"/api/v1/predictive/alerts/{analista.id}/")
    assert response.status_code == 200
    assert isinstance(response.data["alerts"], list)
    assert len(response.data["alerts"]) >= 1


def test_preventive_alerts_requires_authentication(analista):
    response = APIClient().get(f"/api/v1/predictive/alerts/{analista.id}/")
    assert response.status_code == 401


def test_preventive_alerts_404_for_missing_user(analista):
    response = _client_for(analista).get("/api/v1/predictive/alerts/999999/")
    assert response.status_code == 404


def test_preventive_alerts_403_for_peer_outside_hierarchy(asistente_seleccion):
    other_peer = User.objects.create_user(username="peer", email="peer@example.com", password="Sup3r-Secr3t!")
    other_peer.groups.set([Group.objects.get(name="ASISTENTE_GH")])
    response = _client_for(asistente_seleccion).get(f"/api/v1/predictive/alerts/{other_peer.id}/")
    assert response.status_code == 403


def test_preventive_alerts_200_for_visible_subordinate(coordinador_nacional, analista):
    response = _client_for(coordinador_nacional).get(f"/api/v1/predictive/alerts/{analista.id}/")
    assert response.status_code == 200


# --- TeamPreventiveAlertsView -----------------------------------------------------


def test_team_alerts_403_below_team_visibility_threshold(asistente_seleccion):
    response = _client_for(asistente_seleccion).get("/api/v1/predictive/team-alerts/")
    assert response.status_code == 403


def test_team_alerts_200_for_coordinador_nacional(coordinador_nacional, analista):
    response = _client_for(coordinador_nacional).get("/api/v1/predictive/team-alerts/")
    assert response.status_code == 200
    assert isinstance(response.data["alerts"], list)


def test_team_alerts_requires_authentication():
    response = APIClient().get("/api/v1/predictive/team-alerts/")
    assert response.status_code == 401


# --- TeamSubutilizationView -------------------------------------------------------


def test_team_subutilization_403_below_team_visibility_threshold(asistente_seleccion):
    response = _client_for(asistente_seleccion).get("/api/v1/predictive/team-subutilization/")
    assert response.status_code == 403


def test_team_subutilization_lists_visible_subordinates(coordinador_nacional, analista):
    response = _client_for(coordinador_nacional).get("/api/v1/predictive/team-subutilization/")
    assert response.status_code == 200
    member_ids = {m["user_id"] for m in response.data["members"]}
    assert analista.id in member_ids


# --- ProjectDelayView --------------------------------------------------------------


def test_project_delay_404_for_missing_project(analista):
    response = _client_for(analista).get("/api/v1/predictive/project-delay/999999/")
    assert response.status_code == 404


def test_project_delay_403_for_user_outside_project(analista):
    other = User.objects.create_user(username="responsible", email="responsible@example.com", password="Sup3r-Secr3t!")
    other.groups.set([Group.objects.get(name="ASISTENTE_GH")])
    project = Project.objects.create(
        name="P", priority="MEDIA", start_date=timezone.now(), target_date=timezone.now(),
        target_time_hours=10, responsible=other, created_by=other,
    )
    response = _client_for(analista).get(f"/api/v1/predictive/project-delay/{project.id}/")
    assert response.status_code == 403


def test_project_delay_200_for_project_responsible(analista):
    project = Project.objects.create(
        name="P", priority="MEDIA", start_date=timezone.now(), target_date=timezone.now(),
        target_time_hours=10, responsible=analista, created_by=analista,
    )
    response = _client_for(analista).get(f"/api/v1/predictive/project-delay/{project.id}/")
    assert response.status_code == 200
    assert response.data["available"] is True


def test_project_delay_requires_authentication(analista):
    project = Project.objects.create(
        name="P", priority="MEDIA", start_date=timezone.now(), target_date=timezone.now(),
        target_time_hours=10, responsible=analista, created_by=analista,
    )
    response = APIClient().get(f"/api/v1/predictive/project-delay/{project.id}/")
    assert response.status_code == 401
