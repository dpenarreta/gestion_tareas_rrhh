"""Cobertura HTTP del Simulador — Fase 9c (ver docs/AUDIT_LOG.md §
2026-08-18): `POST /api/v1/predictive/simulate/<user_id>/`,
`POST /api/v1/predictive/simulate/project/<project_id>/` y
`POST /api/v1/predictive/simulate/redistribute/`, mismo patrón de
auth/visibilidad jerárquica que `test_predictive_views.py`."""

from datetime import datetime
from datetime import timezone as dt_timezone

import pytest
from django.contrib.auth.models import Group
from rest_framework.test import APIClient

from apps.projects.models import Project, ProjectParticipant
from apps.tasks.models import Task
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


def _task(user, *, status="PENDIENTE", estimated_hours=10) -> Task:
    return Task.objects.create(
        title="T", priority="MEDIA", frequency="PUNTUAL",
        start_date=datetime(2026, 8, 1, tzinfo=dt_timezone.utc), end_date=datetime(2026, 8, 20, tzinfo=dt_timezone.utc),
        estimated_hours=estimated_hours, assigned_to=user, created_by=user, status=status,
    )


# --- SimulateAdjustTargetTimeView -------------------------------------------------


def test_simulate_adjust_target_time_requires_authentication(analista):
    task = _task(analista)
    response = APIClient().post(f"/api/v1/predictive/simulate/{analista.id}/", {"task_id": task.id, "new_target_time_hours": 5})
    assert response.status_code == 401


def test_simulate_adjust_target_time_404_for_missing_user(analista):
    response = _client_for(analista).post("/api/v1/predictive/simulate/999999/", {"task_id": 1, "new_target_time_hours": 5})
    assert response.status_code == 404


def test_simulate_adjust_target_time_403_for_peer_outside_hierarchy(analista):
    # ANALISTA_CC ve Propio + Asistente GH + Trabajo Social (CLAUDE.md) —
    # ASISTENTE_SELECCION queda fuera de ese conjunto.
    other_peer = User.objects.create_user(username="peer", email="peer@example.com", password="Sup3r-Secr3t!")
    other_peer.groups.set([Group.objects.get(name="ASISTENTE_SELECCION")])
    task = _task(other_peer)
    response = _client_for(analista).post(
        f"/api/v1/predictive/simulate/{other_peer.id}/", {"task_id": task.id, "new_target_time_hours": 5}
    )
    assert response.status_code == 403


def test_simulate_adjust_target_time_400_for_invalid_body(analista):
    response = _client_for(analista).post(f"/api/v1/predictive/simulate/{analista.id}/", {"new_target_time_hours": 5000})
    assert response.status_code == 400


def test_simulate_adjust_target_time_404_for_task_not_owned_by_user(analista):
    other = User.objects.create_user(username="other", email="other2@example.com", password="Sup3r-Secr3t!")
    other.groups.set([Group.objects.get(name="ASISTENTE_GH")])
    task = _task(other)
    response = _client_for(analista).post(
        f"/api/v1/predictive/simulate/{analista.id}/", {"task_id": task.id, "new_target_time_hours": 5}
    )
    assert response.status_code == 404


def test_simulate_adjust_target_time_400_for_completed_task(analista):
    task = _task(analista, status=Task.Status.COMPLETADA)
    response = _client_for(analista).post(
        f"/api/v1/predictive/simulate/{analista.id}/", {"task_id": task.id, "new_target_time_hours": 5}
    )
    assert response.status_code == 400


def test_simulate_adjust_target_time_200_for_self(analista):
    task = _task(analista)
    response = _client_for(analista).post(
        f"/api/v1/predictive/simulate/{analista.id}/", {"task_id": task.id, "new_target_time_hours": 5}
    )
    assert response.status_code == 200
    assert set(response.data.keys()) == {"before", "after", "diff", "scenario"}
    assert response.data["scenario"]["task_id"] == task.id


# --- SimulateAddParticipantsView --------------------------------------------------


@pytest.fixture
def project(analista):
    return Project.objects.create(
        name="P", priority="MEDIA", start_date=datetime(2026, 8, 1, tzinfo=dt_timezone.utc),
        target_date=datetime(2026, 8, 31, tzinfo=dt_timezone.utc), target_time_hours=100,
        responsible=analista, created_by=analista,
    )


def test_simulate_add_participants_404_for_missing_project(analista):
    response = _client_for(analista).post("/api/v1/predictive/simulate/project/999999/", {"additional_participants": 2})
    assert response.status_code == 404


def test_simulate_add_participants_403_for_user_outside_project(analista, project):
    other = User.objects.create_user(username="outsider", email="outsider@example.com", password="Sup3r-Secr3t!")
    other.groups.set([Group.objects.get(name="ASISTENTE_GH")])
    response = _client_for(other).post(f"/api/v1/predictive/simulate/project/{project.id}/", {"additional_participants": 2})
    assert response.status_code == 403


def test_simulate_add_participants_400_for_zero_or_negative(analista, project):
    response = _client_for(analista).post(f"/api/v1/predictive/simulate/project/{project.id}/", {"additional_participants": 0})
    assert response.status_code == 400


def test_simulate_add_participants_400_above_max(analista, project):
    response = _client_for(analista).post(f"/api/v1/predictive/simulate/project/{project.id}/", {"additional_participants": 21})
    assert response.status_code == 400


def test_simulate_add_participants_200_for_project_responsible(analista, project):
    ProjectParticipant.objects.create(project=project, user=analista, added_by=analista)
    response = _client_for(analista).post(f"/api/v1/predictive/simulate/project/{project.id}/", {"additional_participants": 2})
    assert response.status_code == 200
    assert response.data["before"]["participants"] == 1
    assert response.data["after"]["participants"] == 3


# --- SimulateRedistributeLoadView -------------------------------------------------


def test_simulate_redistribute_400_for_same_user(coordinador_nacional):
    response = _client_for(coordinador_nacional).post(
        "/api/v1/predictive/simulate/redistribute/",
        {"from_user_id": coordinador_nacional.id, "to_user_id": coordinador_nacional.id, "hours": 5},
    )
    assert response.status_code == 400


def test_simulate_redistribute_400_for_zero_hours(coordinador_nacional, analista):
    response = _client_for(coordinador_nacional).post(
        "/api/v1/predictive/simulate/redistribute/",
        {"from_user_id": coordinador_nacional.id, "to_user_id": analista.id, "hours": 0},
    )
    assert response.status_code == 400


def test_simulate_redistribute_404_for_missing_user(coordinador_nacional):
    response = _client_for(coordinador_nacional).post(
        "/api/v1/predictive/simulate/redistribute/",
        {"from_user_id": coordinador_nacional.id, "to_user_id": 999999, "hours": 5},
    )
    assert response.status_code == 404


def test_simulate_redistribute_403_when_target_not_visible(analista):
    # ANALISTA_CC ve Propio + Asistente GH + Trabajo Social (CLAUDE.md) —
    # ASISTENTE_SELECCION queda fuera de ese conjunto.
    other_peer = User.objects.create_user(username="peer2", email="peer2@example.com", password="Sup3r-Secr3t!")
    other_peer.groups.set([Group.objects.get(name="ASISTENTE_SELECCION")])
    response = _client_for(analista).post(
        "/api/v1/predictive/simulate/redistribute/",
        {"from_user_id": analista.id, "to_user_id": other_peer.id, "hours": 5},
    )
    assert response.status_code == 403


def test_simulate_redistribute_200_between_self_and_subordinate(coordinador_nacional, analista):
    response = _client_for(coordinador_nacional).post(
        "/api/v1/predictive/simulate/redistribute/",
        {"from_user_id": coordinador_nacional.id, "to_user_id": analista.id, "hours": 5},
    )
    assert response.status_code == 200
    assert response.data["from"]["user_id"] == coordinador_nacional.id
    assert response.data["to"]["user_id"] == analista.id
