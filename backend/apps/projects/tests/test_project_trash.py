"""Cobertura HTTP de la Papelera de Proyectos — Fase 14 (ver
docs/AUDIT_LOG.md § 2026-08-20): `GET /api/v1/projects/trash/`,
`POST /api/v1/projects/<id>/restore/`,
`DELETE /api/v1/projects/<id>/permanent/`, réplica de
`src/app/api/projects/trash/route.ts`,
`src/app/api/projects/[id]/restore/route.ts` y
`src/app/api/projects/[id]/permanent/route.ts`."""

import pytest
from django.contrib.auth.models import Group
from rest_framework.test import APIClient

from apps.projects.models import Project, ProjectHistory, ProjectHistoryEvent
from apps.recovery.models import RecoveryItem
from apps.users.models import User

pytestmark = pytest.mark.django_db


def _client_for(user: User) -> APIClient:
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.fixture
def leadership():
    user = User.objects.create_user(username="coord_nac", email="coord_nac@example.com", password="Sup3r-Secr3t!")
    user.groups.set([Group.objects.get(name="COORDINADOR_NACIONAL")])
    return user


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


def _project_payload(responsible: User, **overrides) -> dict:
    payload = {
        "name": "Rediseño de onboarding", "priority": "ALTA", "responsible": responsible.id,
        "start_date": "2026-08-01T00:00:00Z", "target_date": "2026-09-01T00:00:00Z", "target_time_hours": 40,
    }
    payload.update(overrides)
    return payload


def _create_project(*, creator: User, responsible: User, **overrides) -> Project:
    response = _client_for(creator).post("/api/v1/projects/", _project_payload(responsible, **overrides), format="json")
    assert response.status_code == 201, response.data
    return Project.objects.get(id=response.data["id"])


def _trash_project(project: Project, creator: User) -> None:
    response = _client_for(creator).delete(f"/api/v1/projects/{project.id}/")
    assert response.status_code == 200, response.data


# --- GET /projects/trash/ -----------------------------------------------------------


def test_trash_requires_can_create_project(assistant_level1):
    response = _client_for(assistant_level1).get("/api/v1/projects/trash/")
    assert response.status_code == 403


def test_trash_lists_only_own_projects_for_non_leadership(manager_level2):
    other_creator = User.objects.create_user(username="other_mgr", email="other_mgr@example.com", password="Sup3r-Secr3t!")
    other_creator.groups.set([Group.objects.get(name="ANALISTA_CC")])

    own = _create_project(creator=manager_level2, responsible=manager_level2)
    _trash_project(own, manager_level2)
    other = _create_project(creator=other_creator, responsible=other_creator)
    _trash_project(other, other_creator)

    response = _client_for(manager_level2).get("/api/v1/projects/trash/")
    assert response.status_code == 200
    assert [p["id"] for p in response.data] == [own.id]


def test_trash_leadership_sees_everyone_but_can_delete_only_own(leadership, manager_level2):
    project = _create_project(creator=manager_level2, responsible=manager_level2)
    _trash_project(project, manager_level2)

    response = _client_for(leadership).get("/api/v1/projects/trash/")
    assert response.status_code == 200
    assert len(response.data) == 1
    assert response.data[0]["can_delete"] is False

    response_owner = _client_for(manager_level2).get("/api/v1/projects/trash/")
    assert response_owner.data[0]["can_delete"] is True


def test_trash_includes_retention_fields(manager_level2):
    project = _create_project(creator=manager_level2, responsible=manager_level2)
    _trash_project(project, manager_level2)

    response = _client_for(manager_level2).get("/api/v1/projects/trash/")
    entry = response.data[0]
    assert entry["expires_at"] is not None
    assert entry["ms_remaining"] > 0
    assert entry["responsible"]["id"] == manager_level2.id
    assert entry["created_by"]["id"] == manager_level2.id


def test_trash_purges_expired_items_lazily(manager_level2):
    project = _create_project(creator=manager_level2, responsible=manager_level2)
    _trash_project(project, manager_level2)
    item = RecoveryItem.objects.get(entity_type="PROJECT", entity_id=str(project.id))
    item.expires_at = item.deleted_at
    item.save(update_fields=["expires_at"])

    response = _client_for(manager_level2).get("/api/v1/projects/trash/")
    assert response.status_code == 200
    assert response.data == []
    assert not Project.objects.filter(pk=project.id).exists()


# --- POST /projects/<id>/restore/ -----------------------------------------------------


def test_restore_404_for_missing_project(manager_level2):
    response = _client_for(manager_level2).post("/api/v1/projects/999999/restore/")
    assert response.status_code == 404


def test_restore_409_when_not_in_trash(manager_level2):
    project = _create_project(creator=manager_level2, responsible=manager_level2)
    response = _client_for(manager_level2).post(f"/api/v1/projects/{project.id}/restore/")
    assert response.status_code == 409


def test_restore_403_for_non_creator(manager_level2, leadership):
    project = _create_project(creator=manager_level2, responsible=manager_level2)
    _trash_project(project, manager_level2)
    response = _client_for(leadership).post(f"/api/v1/projects/{project.id}/restore/")
    assert response.status_code == 403


def test_restore_succeeds_for_creator(manager_level2):
    project = _create_project(creator=manager_level2, responsible=manager_level2)
    _trash_project(project, manager_level2)

    response = _client_for(manager_level2).post(f"/api/v1/projects/{project.id}/restore/")
    assert response.status_code == 200
    project.refresh_from_db()
    assert project.deleted_at is None
    assert ProjectHistory.objects.filter(project=project, event=ProjectHistoryEvent.RESTAURADO).exists()


# --- DELETE /projects/<id>/permanent/ --------------------------------------------------


def test_permanent_404_for_missing_project(manager_level2):
    response = _client_for(manager_level2).delete("/api/v1/projects/999999/permanent/")
    assert response.status_code == 404


def test_permanent_409_when_not_in_trash(manager_level2):
    project = _create_project(creator=manager_level2, responsible=manager_level2)
    response = _client_for(manager_level2).delete(f"/api/v1/projects/{project.id}/permanent/")
    assert response.status_code == 409


def test_permanent_403_for_non_creator(manager_level2, leadership):
    project = _create_project(creator=manager_level2, responsible=manager_level2)
    _trash_project(project, manager_level2)
    response = _client_for(leadership).delete(f"/api/v1/projects/{project.id}/permanent/")
    assert response.status_code == 403


def test_permanent_hard_deletes_for_creator(manager_level2):
    project = _create_project(creator=manager_level2, responsible=manager_level2)
    project_id = project.id
    _trash_project(project, manager_level2)

    response = _client_for(manager_level2).delete(f"/api/v1/projects/{project_id}/permanent/")
    assert response.status_code == 200
    assert not Project.objects.filter(pk=project_id).exists()
