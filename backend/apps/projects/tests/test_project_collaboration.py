"""Cobertura HTTP de Participantes/Comentarios/Historial — Fase 5b (ver
docs/AUDIT_LOG.md § 2026-08-13). Extiende el CRUD core de la Fase 5a
(`test_project_views.py`) — sin Fases/Actividades/Documentos/Papelera
todavía, y SIN cutover de `route.ts`."""

import pytest
from django.contrib.auth.models import Group
from rest_framework.test import APIClient

from apps.projects.models import Project, ProjectHistory, ProjectHistoryEvent, ProjectParticipant
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


# --- Comentarios -----------------------------------------------------------------------


def test_participant_can_post_comment(manager_level2, assistant_level1):
    project = _create_project(creator=manager_level2, responsible=manager_level2, participant_ids=[assistant_level1.id])
    response = _client_for(assistant_level1).post(
        f"/api/v1/projects/{project.id}/comments/", {"text": "Avanzando bien"}, format="json"
    )
    assert response.status_code == 201
    assert response.data["text"] == "Avanzando bien"
    assert response.data["author"]["id"] == assistant_level1.id


def test_non_participant_cannot_post_comment(manager_level2, assistant_level1, stranger):
    project = _create_project(creator=manager_level2, responsible=assistant_level1)
    response = _client_for(stranger).post(f"/api/v1/projects/{project.id}/comments/", {"text": "Hola"}, format="json")
    assert response.status_code == 403


def test_empty_comment_returns_400(manager_level2):
    project = _create_project(creator=manager_level2, responsible=manager_level2)
    response = _client_for(manager_level2).post(f"/api/v1/projects/{project.id}/comments/", {"text": "   "}, format="json")
    assert response.status_code == 400


def test_comment_does_not_log_history(manager_level2):
    project = _create_project(creator=manager_level2, responsible=manager_level2)
    _client_for(manager_level2).post(f"/api/v1/projects/{project.id}/comments/", {"text": "Nota"}, format="json")
    assert not ProjectHistory.objects.filter(project=project, event=ProjectHistoryEvent.COMENTARIO_AGREGADO).exists()


def test_list_comments_ordered_chronologically(manager_level2):
    project = _create_project(creator=manager_level2, responsible=manager_level2)
    client = _client_for(manager_level2)
    client.post(f"/api/v1/projects/{project.id}/comments/", {"text": "Primero"}, format="json")
    client.post(f"/api/v1/projects/{project.id}/comments/", {"text": "Segundo"}, format="json")
    response = client.get(f"/api/v1/projects/{project.id}/comments/")
    assert [c["text"] for c in response.data] == ["Primero", "Segundo"]


# --- Participantes: alta ----------------------------------------------------------------


def test_manager_adds_participant(manager_level2, assistant_level1):
    project = _create_project(creator=manager_level2, responsible=manager_level2)
    response = _client_for(manager_level2).post(
        f"/api/v1/projects/{project.id}/participants/", {"user": assistant_level1.id}, format="json"
    )
    assert response.status_code == 201
    assert ProjectParticipant.objects.filter(project=project, user=assistant_level1).exists()
    assert ProjectHistory.objects.filter(project=project, event=ProjectHistoryEvent.PARTICIPANTE_AGREGADO).exists()


def test_non_manager_cannot_add_participant(manager_level2, assistant_level1, stranger):
    project = _create_project(creator=manager_level2, responsible=assistant_level1)
    response = _client_for(stranger).post(
        f"/api/v1/projects/{project.id}/participants/", {"user": assistant_level1.id}, format="json"
    )
    assert response.status_code == 403


def test_adding_existing_participant_returns_409(manager_level2, assistant_level1):
    project = _create_project(creator=manager_level2, responsible=manager_level2, participant_ids=[assistant_level1.id])
    response = _client_for(manager_level2).post(
        f"/api/v1/projects/{project.id}/participants/", {"user": assistant_level1.id}, format="json"
    )
    assert response.status_code == 409


def test_adding_participant_with_invalid_user_returns_400(manager_level2):
    project = _create_project(creator=manager_level2, responsible=manager_level2)
    response = _client_for(manager_level2).post(f"/api/v1/projects/{project.id}/participants/", {"user": 999999}, format="json")
    assert response.status_code == 400


# --- Participantes: baja -----------------------------------------------------------------


def test_manager_removes_participant(manager_level2, assistant_level1):
    project = _create_project(creator=manager_level2, responsible=manager_level2, participant_ids=[assistant_level1.id])
    participant = ProjectParticipant.objects.get(project=project, user=assistant_level1)
    response = _client_for(manager_level2).delete(f"/api/v1/projects/{project.id}/participants/{participant.id}/")
    assert response.status_code == 200
    assert not ProjectParticipant.objects.filter(id=participant.id).exists()
    assert ProjectHistory.objects.filter(project=project, event=ProjectHistoryEvent.PARTICIPANTE_ELIMINADO).exists()


def test_non_manager_cannot_remove_participant(manager_level2, assistant_level1, stranger):
    project = _create_project(creator=manager_level2, responsible=manager_level2, participant_ids=[assistant_level1.id])
    participant = ProjectParticipant.objects.get(project=project, user=assistant_level1)
    response = _client_for(stranger).delete(f"/api/v1/projects/{project.id}/participants/{participant.id}/")
    assert response.status_code == 403


def test_cannot_remove_responsible_as_participant(manager_level2, assistant_level1):
    project = _create_project(creator=manager_level2, responsible=manager_level2)
    _client_for(manager_level2).patch(
        f"/api/v1/projects/{project.id}/", {"responsible": assistant_level1.id}, format="json"
    )
    participant = ProjectParticipant.objects.get(project=project, user=assistant_level1)
    response = _client_for(manager_level2).delete(f"/api/v1/projects/{project.id}/participants/{participant.id}/")
    assert response.status_code == 409


def test_remove_participant_404_for_wrong_project(manager_level2, assistant_level1):
    project_a = _create_project(creator=manager_level2, responsible=manager_level2, participant_ids=[assistant_level1.id])
    project_b = _create_project(creator=manager_level2, responsible=manager_level2, name="Otro proyecto")
    participant = ProjectParticipant.objects.get(project=project_a, user=assistant_level1)
    response = _client_for(manager_level2).delete(f"/api/v1/projects/{project_b.id}/participants/{participant.id}/")
    assert response.status_code == 404


# --- Historial -----------------------------------------------------------------------------


def test_history_visible_to_manager(manager_level2):
    project = _create_project(creator=manager_level2, responsible=manager_level2)
    response = _client_for(manager_level2).get(f"/api/v1/projects/{project.id}/history/")
    assert response.status_code == 200
    assert response.data[0]["event"] == ProjectHistoryEvent.CREADO


def test_history_forbidden_for_non_viewer(manager_level2, assistant_level1, stranger):
    project = _create_project(creator=manager_level2, responsible=assistant_level1)
    response = _client_for(stranger).get(f"/api/v1/projects/{project.id}/history/")
    assert response.status_code == 403


def test_history_ordered_most_recent_first(manager_level2):
    project = _create_project(creator=manager_level2, responsible=manager_level2)
    _client_for(manager_level2).patch(f"/api/v1/projects/{project.id}/", {"status": "EN_EJECUCION"}, format="json")
    response = _client_for(manager_level2).get(f"/api/v1/projects/{project.id}/history/")
    assert response.data[0]["event"] == ProjectHistoryEvent.ESTADO_CAMBIADO
    assert response.data[-1]["event"] == ProjectHistoryEvent.CREADO
