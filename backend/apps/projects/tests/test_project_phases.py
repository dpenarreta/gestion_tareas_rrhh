"""Cobertura HTTP de Fases — Fase 5c (ver docs/AUDIT_LOG.md §
2026-08-13). Extiende 5a/5b (`test_project_views.py`/
`test_project_collaboration.py`) — sin Actividades/Documentos/Papelera
todavía, y SIN cutover de `route.ts`."""

import pytest
from django.contrib.auth.models import Group
from rest_framework.test import APIClient

from apps.projects.models import Project, ProjectHistory, ProjectHistoryEvent, ProjectPhase
from apps.users.models import User

pytestmark = pytest.mark.django_db


def _client_for(user: User) -> APIClient:
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.fixture
def manager_level2():
    user = User.objects.create_user(username="analista", email="analista@example.com", password="Sup3r-Secr3t!")
    user.groups.set([Group.objects.get(name="ANALISTA_CC")])
    return user


@pytest.fixture
def assistant_level1():
    user = User.objects.create_user(username="asistente", email="asistente@example.com", password="Sup3r-Secr3t!")
    user.groups.set([Group.objects.get(name="ASISTENTE_GH")])
    return user


@pytest.fixture
def stranger():
    user = User.objects.create_user(username="stranger", email="stranger@example.com", password="Sup3r-Secr3t!")
    user.groups.set([Group.objects.get(name="ASISTENTE_SELECCION")])
    return user


def _create_project(*, creator: User, responsible: User, **overrides) -> Project:
    payload = {
        "name": "Rediseño de onboarding",
        "priority": "ALTA",
        "responsible": responsible.id,
        "start_date": "2026-08-01T00:00:00Z",
        "target_date": "2026-09-01T00:00:00Z",
        "target_time_hours": 40,
    }
    payload.update(overrides)
    response = _client_for(creator).post("/api/v1/projects/", payload, format="json")
    assert response.status_code == 201, response.data
    return Project.objects.get(id=response.data["id"])


def _create_phase(*, actor: User, project: Project, **overrides) -> dict:
    payload = {"name": "Descubrimiento"}
    payload.update(overrides)
    response = _client_for(actor).post(f"/api/v1/projects/{project.id}/phases/", payload, format="json")
    assert response.status_code == 201, response.data
    return response.data


# --- Creación ----------------------------------------------------------------------


def test_manager_creates_phase(manager_level2):
    project = _create_project(creator=manager_level2, responsible=manager_level2)
    phase = _create_phase(actor=manager_level2, project=project)
    assert phase["name"] == "Descubrimiento"
    assert phase["status"] == "PENDIENTE"
    assert phase["order"] == 0
    assert phase["registered_minutes"] == 0
    assert phase["participants"] == []
    assert ProjectHistory.objects.filter(project=project, event=ProjectHistoryEvent.FASE_AGREGADA).exists()


def test_phase_order_autoincrements(manager_level2):
    project = _create_project(creator=manager_level2, responsible=manager_level2)
    _create_phase(actor=manager_level2, project=project, name="Fase 1")
    second = _create_phase(actor=manager_level2, project=project, name="Fase 2")
    assert second["order"] == 1


def test_non_manager_cannot_create_phase(manager_level2, assistant_level1, stranger):
    project = _create_project(creator=manager_level2, responsible=assistant_level1)
    response = _client_for(stranger).post(f"/api/v1/projects/{project.id}/phases/", {"name": "Fase"}, format="json")
    assert response.status_code == 403


def test_empty_phase_name_returns_400(manager_level2):
    project = _create_project(creator=manager_level2, responsible=manager_level2)
    response = _client_for(manager_level2).post(f"/api/v1/projects/{project.id}/phases/", {"name": "   "}, format="json")
    assert response.status_code == 400


def test_project_detail_includes_phases(manager_level2):
    project = _create_project(creator=manager_level2, responsible=manager_level2)
    _create_phase(actor=manager_level2, project=project)
    response = _client_for(manager_level2).get(f"/api/v1/projects/{project.id}/")
    assert len(response.data["phases"]) == 1
    assert response.data["phases"][0]["name"] == "Descubrimiento"


# --- Edición -------------------------------------------------------------------------


def test_phase_status_change_logs_history(manager_level2):
    project = _create_project(creator=manager_level2, responsible=manager_level2)
    phase = _create_phase(actor=manager_level2, project=project)
    response = _client_for(manager_level2).patch(
        f"/api/v1/projects/{project.id}/phases/{phase['id']}/", {"status": "EN_PROGRESO"}, format="json"
    )
    assert response.status_code == 200
    assert response.data["status"] == "EN_PROGRESO"
    assert ProjectHistory.objects.filter(project=project, event=ProjectHistoryEvent.FASE_ACTUALIZADA).exists()


def test_phase_progress_edit_does_not_log_history(manager_level2):
    project = _create_project(creator=manager_level2, responsible=manager_level2)
    phase = _create_phase(actor=manager_level2, project=project)
    response = _client_for(manager_level2).patch(
        f"/api/v1/projects/{project.id}/phases/{phase['id']}/", {"progress": 50}, format="json"
    )
    assert response.status_code == 200
    assert response.data["progress"] == 50
    assert not ProjectHistory.objects.filter(project=project, event=ProjectHistoryEvent.FASE_ACTUALIZADA).exists()


def test_phase_progress_out_of_range_returns_400(manager_level2):
    project = _create_project(creator=manager_level2, responsible=manager_level2)
    phase = _create_phase(actor=manager_level2, project=project)
    response = _client_for(manager_level2).patch(
        f"/api/v1/projects/{project.id}/phases/{phase['id']}/", {"progress": 150}, format="json"
    )
    assert response.status_code == 400


def test_non_manager_cannot_edit_phase(manager_level2, assistant_level1, stranger):
    project = _create_project(creator=manager_level2, responsible=assistant_level1)
    phase = _create_phase(actor=manager_level2, project=project)
    response = _client_for(stranger).patch(
        f"/api/v1/projects/{project.id}/phases/{phase['id']}/", {"name": "Otro nombre"}, format="json"
    )
    assert response.status_code == 403


# --- Eliminación ---------------------------------------------------------------------


def test_manager_deletes_phase(manager_level2):
    project = _create_project(creator=manager_level2, responsible=manager_level2)
    phase = _create_phase(actor=manager_level2, project=project)
    response = _client_for(manager_level2).delete(f"/api/v1/projects/{project.id}/phases/{phase['id']}/")
    assert response.status_code == 200
    assert not ProjectPhase.objects.filter(id=phase["id"]).exists()
    assert ProjectHistory.objects.filter(project=project, event=ProjectHistoryEvent.FASE_ELIMINADA).exists()


def test_non_manager_cannot_delete_phase(manager_level2, assistant_level1, stranger):
    project = _create_project(creator=manager_level2, responsible=assistant_level1)
    phase = _create_phase(actor=manager_level2, project=project)
    response = _client_for(stranger).delete(f"/api/v1/projects/{project.id}/phases/{phase['id']}/")
    assert response.status_code == 403


def test_phase_404_for_wrong_project(manager_level2):
    project_a = _create_project(creator=manager_level2, responsible=manager_level2)
    project_b = _create_project(creator=manager_level2, responsible=manager_level2, name="Otro proyecto")
    phase = _create_phase(actor=manager_level2, project=project_a)
    response = _client_for(manager_level2).delete(f"/api/v1/projects/{project_b.id}/phases/{phase['id']}/")
    assert response.status_code == 404
