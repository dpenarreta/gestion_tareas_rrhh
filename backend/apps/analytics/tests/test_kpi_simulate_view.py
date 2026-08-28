"""Cobertura HTTP de `POST /api/v1/analytics/simulate/<id>/` — Fase 23
(ver docs/AUDIT_LOG.md § 2026-08-20), réplica de
`src/app/api/analytics/simulate/[userId]/route.ts`. Compone sobre
`apps.analytics.kpi_simulate`, ya cubierto por sus propios tests
unitarios (`test_kpi_simulate.py`) — se prueba con datos reales para
validar el ensamblado HTTP/auth/visibilidad."""

import pytest
from django.contrib.auth.models import Group
from rest_framework.test import APIClient

from apps.tasks.models import Task
from apps.users.models import User

pytestmark = pytest.mark.django_db


def _client_for(user: User) -> APIClient:
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def _user_with_group(username: str, group_name: str) -> User:
    user = User.objects.create_user(username=username, email=f"{username}@example.com", password="Sup3r-Secr3t!")
    user.groups.set([Group.objects.get(name=group_name)])
    return user


@pytest.fixture
def analista():
    return _user_with_group("analista", "ANALISTA_CC")


@pytest.fixture
def coordinador_nacional():
    return _user_with_group("coord_nac", "COORDINADOR_NACIONAL")


@pytest.fixture
def asistente_seleccion():
    return _user_with_group("asist_sel", "ASISTENTE_SELECCION")


def test_requires_authentication():
    response = APIClient().post("/api/v1/analytics/simulate/1/", {"type": "assign_task", "hours": 5}, format="json")
    assert response.status_code == 401


def test_404_for_missing_user(analista):
    response = _client_for(analista).post("/api/v1/analytics/simulate/999999/", {"type": "assign_task", "hours": 5}, format="json")
    assert response.status_code == 404


def test_403_for_peer_outside_hierarchy(asistente_seleccion):
    other_peer = _user_with_group("peer", "ASISTENTE_GH")
    response = _client_for(asistente_seleccion).post(
        f"/api/v1/analytics/simulate/{other_peer.id}/", {"type": "assign_task", "hours": 5}, format="json"
    )
    assert response.status_code == 403


def test_400_for_invalid_scenario_type(analista):
    response = _client_for(analista).post(f"/api/v1/analytics/simulate/{analista.id}/", {"type": "not-a-scenario"}, format="json")
    assert response.status_code == 400
    assert response.data == {"error": "Escenario inválido"}


def test_400_for_out_of_range_value(analista):
    response = _client_for(analista).post(f"/api/v1/analytics/simulate/{analista.id}/", {"type": "assign_task", "hours": 5000}, format="json")
    assert response.status_code == 400


def test_200_for_self_returns_before_after_diff(analista):
    response = _client_for(analista).post(f"/api/v1/analytics/simulate/{analista.id}/", {"type": "assign_task", "hours": 5}, format="json")
    assert response.status_code == 200
    for key in ("before", "after", "diff", "scenario"):
        assert key in response.data
    assert response.data["scenario"] == {"type": "assign_task", "hours": 5}


def test_200_for_visible_subordinate(coordinador_nacional, analista):
    response = _client_for(coordinador_nacional).post(
        f"/api/v1/analytics/simulate/{analista.id}/", {"type": "increase_consistency", "delta_points": 15}, format="json"
    )
    assert response.status_code == 200
    assert response.data["after"]["performance_score_pts"] != response.data["before"]["performance_score_pts"]


def test_never_persists_scenario_changes(analista):
    task = Task.objects.create(
        title="Tarea", priority=Task.Priority.MEDIA, frequency=Task.Frequency.PUNTUAL, type=Task.Type.FIJA,
        start_date="2026-08-01T00:00:00Z", end_date="2026-08-25T00:00:00Z", estimated_hours=5,
        assigned_to=analista, created_by=analista, status=Task.Status.PENDIENTE,
    )
    _client_for(analista).post(f"/api/v1/analytics/simulate/{analista.id}/", {"type": "complete_task", "count": 1}, format="json")
    task.refresh_from_db()
    assert task.status == Task.Status.PENDIENTE
