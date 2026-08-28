"""Cobertura HTTP de `/api/v1/projects/` — Fase 5a (ver
docs/AUDIT_LOG.md § 2026-08-13): CRUD core del módulo Proyectos.
Extendida en Fase 5f (ver docs/AUDIT_LOG.md § 2026-08-14) con `roles`
en `ProjectUserRefSerializer` y los conteos `phase_count`/
`comment_count`/`document_count`/`activity_count` — gaps cerrados
antes del cutover de `route.ts`."""

from unittest.mock import ANY

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
def leadership():
    """Nivel 3 — puede gestionar/ver cualquier proyecto, pero NO
    eliminar (eso es exclusivo del creador)."""
    user = User.objects.create_user(username="coord_nac", email="coord_nac@example.com", password="Sup3r-Secr3t!")
    user.groups.set([Group.objects.get(name="COORDINADOR_NACIONAL")])
    return user


@pytest.fixture
def manager_level2():
    """Nivel 2 — puede crear proyectos (`canCreateProject` = nivel >= 2)."""
    user = User.objects.create_user(username="analista", email="analista@example.com", password="Sup3r-Secr3t!")
    user.groups.set([Group.objects.get(name="ANALISTA_CC")])
    return user


@pytest.fixture
def assistant_level1():
    """Nivel 1 — NO puede crear proyectos."""
    user = User.objects.create_user(username="asistente", email="asistente@example.com", password="Sup3r-Secr3t!")
    user.groups.set([Group.objects.get(name="ASISTENTE_GH")])
    return user


@pytest.fixture
def stranger():
    user = User.objects.create_user(username="stranger", email="stranger@example.com", password="Sup3r-Secr3t!")
    user.groups.set([Group.objects.get(name="ASISTENTE_SELECCION")])
    return user


def _project_payload(responsible: User, **overrides) -> dict:
    payload = {
        "name": "Rediseño de onboarding",
        "priority": "ALTA",
        "responsible": responsible.id,
        "start_date": "2026-08-01T00:00:00Z",
        "target_date": "2026-09-01T00:00:00Z",
        "target_time_hours": 40,
    }
    payload.update(overrides)
    return payload


def _create_project(*, creator: User, responsible: User, **overrides) -> Project:
    client = _client_for(creator)
    response = client.post("/api/v1/projects/", _project_payload(responsible, **overrides), format="json")
    assert response.status_code == 201, response.data
    return Project.objects.get(id=response.data["id"])


# --- Creación ----------------------------------------------------------------------


def test_level2_user_creates_project(manager_level2):
    response = _client_for(manager_level2).post("/api/v1/projects/", _project_payload(manager_level2), format="json")
    assert response.status_code == 201
    project = Project.objects.get(name="Rediseño de onboarding")
    assert project.created_by_id == manager_level2.id
    assert project.status == Project.Status.PENDIENTE


def test_level1_user_cannot_create_project(assistant_level1):
    response = _client_for(assistant_level1).post("/api/v1/projects/", _project_payload(assistant_level1), format="json")
    assert response.status_code == 403


def test_create_missing_required_fields_returns_400(manager_level2):
    response = _client_for(manager_level2).post("/api/v1/projects/", {"name": "Sin responsable"}, format="json")
    assert response.status_code == 400


def test_create_logs_creado_history(manager_level2):
    project = _create_project(creator=manager_level2, responsible=manager_level2)
    entry = ProjectHistory.objects.get(project=project)
    assert entry.event == ProjectHistoryEvent.CREADO
    assert entry.actor_id == manager_level2.id


def test_create_does_not_auto_add_responsible_or_creator_as_participant(manager_level2):
    project = _create_project(creator=manager_level2, responsible=manager_level2)
    assert ProjectParticipant.objects.filter(project=project).count() == 0


def test_create_adds_explicit_participants(manager_level2, assistant_level1):
    project = _create_project(creator=manager_level2, responsible=manager_level2, participant_ids=[assistant_level1.id])
    assert ProjectParticipant.objects.filter(project=project, user=assistant_level1).exists()


# --- Listado (visibilidad) ----------------------------------------------------------


def test_leadership_sees_all_projects(leadership, manager_level2, assistant_level1):
    _create_project(creator=manager_level2, responsible=assistant_level1)
    response = _client_for(leadership).get("/api/v1/projects/")
    assert response.status_code == 200
    assert len(response.data) == 1


def test_non_leadership_only_sees_own_projects(manager_level2, assistant_level1, stranger):
    _create_project(creator=manager_level2, responsible=assistant_level1)
    response = _client_for(stranger).get("/api/v1/projects/")
    assert response.status_code == 200
    assert response.data == []


def test_non_leadership_sees_project_as_participant(manager_level2, assistant_level1, stranger):
    project = _create_project(creator=manager_level2, responsible=assistant_level1, participant_ids=[stranger.id])
    response = _client_for(stranger).get("/api/v1/projects/")
    assert [p["id"] for p in response.data] == [project.id]


def test_deleted_project_excluded_from_list(manager_level2):
    project = _create_project(creator=manager_level2, responsible=manager_level2)
    _client_for(manager_level2).delete(f"/api/v1/projects/{project.id}/")
    response = _client_for(manager_level2).get("/api/v1/projects/")
    assert response.data == []


# --- Detalle -------------------------------------------------------------------------


def test_retrieve_403_for_non_participant_non_manager(manager_level2, assistant_level1, stranger):
    project = _create_project(creator=manager_level2, responsible=assistant_level1)
    response = _client_for(stranger).get(f"/api/v1/projects/{project.id}/")
    assert response.status_code == 403


def test_retrieve_200_for_responsible(manager_level2, assistant_level1):
    project = _create_project(creator=manager_level2, responsible=assistant_level1)
    response = _client_for(assistant_level1).get(f"/api/v1/projects/{project.id}/")
    assert response.status_code == 200
    assert response.data["id"] == project.id


def test_retrieve_404_for_missing_project(manager_level2):
    response = _client_for(manager_level2).get("/api/v1/projects/999999/")
    assert response.status_code == 404


def test_retrieve_404_for_deleted_project(manager_level2):
    project = _create_project(creator=manager_level2, responsible=manager_level2)
    _client_for(manager_level2).delete(f"/api/v1/projects/{project.id}/")
    response = _client_for(manager_level2).get(f"/api/v1/projects/{project.id}/")
    assert response.status_code == 404


def test_user_ref_includes_roles(manager_level2):
    project = _create_project(creator=manager_level2, responsible=manager_level2)
    response = _client_for(manager_level2).get(f"/api/v1/projects/{project.id}/")
    assert response.data["responsible"]["roles"] == [{"id": ANY, "name": "ANALISTA_CC"}]


def test_list_includes_phase_comment_document_counts(manager_level2):
    client = _client_for(manager_level2)
    project = _create_project(creator=manager_level2, responsible=manager_level2)
    client.post(f"/api/v1/projects/{project.id}/phases/", {"name": "Descubrimiento"}, format="json")
    client.post(f"/api/v1/projects/{project.id}/comments/", {"text": "Avance inicial"}, format="json")
    client.post(
        f"/api/v1/projects/{project.id}/documents/",
        {"file_name": "acta.pdf", "file_data": "ZmFrZS1iYXNlNjQ="},
        format="json",
    )
    response = client.get("/api/v1/projects/")
    item = response.data[0]
    assert item["phase_count"] == 1
    assert item["comment_count"] == 1
    assert item["document_count"] == 1


def test_detail_includes_activity_count(manager_level2):
    client = _client_for(manager_level2)
    project = _create_project(creator=manager_level2, responsible=manager_level2)
    client.post(
        f"/api/v1/projects/{project.id}/activities/",
        {"description": "Reunión de seguimiento con el equipo", "start_time": "09:00", "end_time": "10:00"},
        format="json",
    )
    response = client.get(f"/api/v1/projects/{project.id}/")
    assert response.data["activity_count"] == 1


# --- Edición (PATCH) ------------------------------------------------------------------


def test_partial_update_requires_manager_permission(manager_level2, assistant_level1, stranger):
    project = _create_project(creator=manager_level2, responsible=assistant_level1)
    response = _client_for(stranger).patch(f"/api/v1/projects/{project.id}/", {"name": "Nuevo nombre"}, format="json")
    assert response.status_code == 403


def test_partial_update_name_does_not_log_history(manager_level2):
    project = _create_project(creator=manager_level2, responsible=manager_level2)
    response = _client_for(manager_level2).patch(f"/api/v1/projects/{project.id}/", {"name": "Nuevo nombre"}, format="json")
    assert response.status_code == 200
    assert response.data["name"] == "Nuevo nombre"
    assert not ProjectHistory.objects.filter(project=project, event=ProjectHistoryEvent.ACTUALIZADO).exists()


def test_partial_update_status_change_logs_history_and_completed_at(manager_level2):
    project = _create_project(creator=manager_level2, responsible=manager_level2)
    response = _client_for(manager_level2).patch(
        f"/api/v1/projects/{project.id}/", {"status": "COMPLETADO"}, format="json"
    )
    assert response.status_code == 200
    project.refresh_from_db()
    assert project.status == Project.Status.COMPLETADO
    assert project.completed_at is not None
    assert ProjectHistory.objects.filter(project=project, event=ProjectHistoryEvent.ESTADO_CAMBIADO).exists()


def test_partial_update_responsible_change_logs_history_and_upserts_participant(manager_level2, assistant_level1):
    project = _create_project(creator=manager_level2, responsible=manager_level2)
    response = _client_for(manager_level2).patch(
        f"/api/v1/projects/{project.id}/", {"responsible": assistant_level1.id}, format="json"
    )
    assert response.status_code == 200
    project.refresh_from_db()
    assert project.responsible_id == assistant_level1.id
    assert ProjectParticipant.objects.filter(project=project, user=assistant_level1).exists()
    assert ProjectHistory.objects.filter(project=project, event=ProjectHistoryEvent.RESPONSABLE_CAMBIADO).exists()


def test_partial_update_invalid_responsible_returns_400(manager_level2):
    project = _create_project(creator=manager_level2, responsible=manager_level2)
    response = _client_for(manager_level2).patch(f"/api/v1/projects/{project.id}/", {"responsible": 999999}, format="json")
    assert response.status_code == 400


# --- Eliminación (soft-delete) ---------------------------------------------------------


def test_destroy_requires_creator_even_for_leadership(leadership, manager_level2):
    project = _create_project(creator=manager_level2, responsible=manager_level2)
    response = _client_for(leadership).delete(f"/api/v1/projects/{project.id}/")
    assert response.status_code == 403


def test_destroy_requires_creator_even_for_responsible(manager_level2, assistant_level1):
    project = _create_project(creator=manager_level2, responsible=assistant_level1)
    response = _client_for(assistant_level1).delete(f"/api/v1/projects/{project.id}/")
    assert response.status_code == 403


def test_creator_can_destroy_own_project(manager_level2):
    project = _create_project(creator=manager_level2, responsible=manager_level2)
    response = _client_for(manager_level2).delete(f"/api/v1/projects/{project.id}/")
    assert response.status_code == 200
    project.refresh_from_db()
    assert project.deleted_at is not None
    assert ProjectHistory.objects.filter(project=project, event=ProjectHistoryEvent.ELIMINADO).exists()
