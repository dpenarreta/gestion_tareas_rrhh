"""Cobertura HTTP de Documentos — Fase 5d (ver docs/AUDIT_LOG.md §
2026-08-13), extendida en 5e con el campo `activity` (ver
docs/AUDIT_LOG.md § 2026-08-14). Solo Papelera queda fuera de alcance,
y SIN cutover de `route.ts`."""

import pytest
from django.contrib.auth.models import Group
from rest_framework.test import APIClient

from apps.projects.models import Project, ProjectDocument, ProjectHistory, ProjectHistoryEvent
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


def _upload_document(*, actor: User, project: Project, **overrides) -> dict:
    payload = {"file_name": "acta.pdf", "file_data": "ZmFrZS1iYXNlNjQ=", "category": "PDF"}
    payload.update(overrides)
    response = _client_for(actor).post(f"/api/v1/projects/{project.id}/documents/", payload, format="json")
    assert response.status_code == 201, response.data
    return response.data


# --- Subida --------------------------------------------------------------------------


def test_participant_uploads_document(manager_level2, assistant_level1):
    project = _create_project(creator=manager_level2, responsible=manager_level2, participant_ids=[assistant_level1.id])
    document = _upload_document(actor=assistant_level1, project=project)
    assert document["file_name"] == "acta.pdf"
    assert document["version"] == 1
    assert document["file_data"] == "ZmFrZS1iYXNlNjQ="
    assert ProjectHistory.objects.filter(project=project, event=ProjectHistoryEvent.DOCUMENTO_AGREGADO).exists()


def test_non_participant_cannot_upload_document(manager_level2, assistant_level1, stranger):
    project = _create_project(creator=manager_level2, responsible=assistant_level1)
    response = _client_for(stranger).post(
        f"/api/v1/projects/{project.id}/documents/", {"file_name": "a.pdf", "file_data": "abc"}, format="json"
    )
    assert response.status_code == 403


def test_missing_required_fields_returns_400(manager_level2):
    project = _create_project(creator=manager_level2, responsible=manager_level2)
    response = _client_for(manager_level2).post(f"/api/v1/projects/{project.id}/documents/", {"file_name": "a.pdf"}, format="json")
    assert response.status_code == 400


def test_oversized_file_returns_413(manager_level2, monkeypatch):
    # `monkeypatch` sobre el límite en vez de un payload real de ~6MB —
    # mismo chequeo (`len(file_data) > MAX_BASE64_LENGTH`), sin pagar el
    # costo de serializar/transmitir un string gigante en cada corrida.
    from apps.projects import views as views_module

    monkeypatch.setattr(views_module, "MAX_BASE64_LENGTH", 10)
    project = _create_project(creator=manager_level2, responsible=manager_level2)
    response = _client_for(manager_level2).post(
        f"/api/v1/projects/{project.id}/documents/", {"file_name": "grande.pdf", "file_data": "a" * 11}, format="json"
    )
    assert response.status_code == 413
    assert not ProjectDocument.objects.filter(project=project).exists()


def test_versioning_with_valid_previous_version(manager_level2):
    project = _create_project(creator=manager_level2, responsible=manager_level2)
    first = _upload_document(actor=manager_level2, project=project, file_name="v1.pdf")
    second = _upload_document(actor=manager_level2, project=project, file_name="v2.pdf", previous_version_id=first["id"])
    assert second["version"] == 2
    assert second["previous_version_id"] == first["id"]


def test_versioning_with_invalid_previous_version_returns_400(manager_level2):
    project = _create_project(creator=manager_level2, responsible=manager_level2)
    response = _client_for(manager_level2).post(
        f"/api/v1/projects/{project.id}/documents/",
        {"file_name": "v2.pdf", "file_data": "abc", "previous_version_id": 999999},
        format="json",
    )
    assert response.status_code == 400


def test_history_description_includes_version_suffix(manager_level2):
    project = _create_project(creator=manager_level2, responsible=manager_level2)
    first = _upload_document(actor=manager_level2, project=project, file_name="v1.pdf")
    _upload_document(actor=manager_level2, project=project, file_name="v2.pdf", previous_version_id=first["id"])
    entries = ProjectHistory.objects.filter(project=project, event=ProjectHistoryEvent.DOCUMENTO_AGREGADO).order_by("created_at")
    assert "(v2)" in entries[1].description
    assert "(v" not in entries[0].description


# --- Listado -------------------------------------------------------------------------


def test_list_documents_excludes_file_data(manager_level2):
    project = _create_project(creator=manager_level2, responsible=manager_level2)
    _upload_document(actor=manager_level2, project=project)
    response = _client_for(manager_level2).get(f"/api/v1/projects/{project.id}/documents/")
    assert response.status_code == 200
    assert "file_data" not in response.data[0]


def test_list_documents_forbidden_for_non_viewer(manager_level2, assistant_level1, stranger):
    project = _create_project(creator=manager_level2, responsible=assistant_level1)
    response = _client_for(stranger).get(f"/api/v1/projects/{project.id}/documents/")
    assert response.status_code == 403


# --- Detalle -------------------------------------------------------------------------


def test_document_detail_includes_file_data(manager_level2):
    project = _create_project(creator=manager_level2, responsible=manager_level2)
    document = _upload_document(actor=manager_level2, project=project)
    response = _client_for(manager_level2).get(f"/api/v1/projects/{project.id}/documents/{document['id']}/")
    assert response.status_code == 200
    assert response.data["file_data"] == "ZmFrZS1iYXNlNjQ="


def test_document_detail_404_for_wrong_project(manager_level2):
    project_a = _create_project(creator=manager_level2, responsible=manager_level2)
    project_b = _create_project(creator=manager_level2, responsible=manager_level2, name="Otro proyecto")
    document = _upload_document(actor=manager_level2, project=project_a)
    response = _client_for(manager_level2).get(f"/api/v1/projects/{project_b.id}/documents/{document['id']}/")
    assert response.status_code == 404


def test_document_detail_forbidden_for_non_viewer(manager_level2, assistant_level1, stranger):
    project = _create_project(creator=manager_level2, responsible=assistant_level1)
    document = _upload_document(actor=manager_level2, project=project)
    response = _client_for(stranger).get(f"/api/v1/projects/{project.id}/documents/{document['id']}/")
    assert response.status_code == 403


# --- Vínculo con actividad (Fase 5e) -----------------------------------------------------


def test_document_links_to_valid_activity(manager_level2):
    project = _create_project(creator=manager_level2, responsible=manager_level2)
    activity_response = _client_for(manager_level2).post(
        f"/api/v1/projects/{project.id}/activities/",
        {"description": "Reunión de seguimiento con el equipo", "start_time": "09:00", "end_time": "10:00"},
        format="json",
    )
    assert activity_response.status_code == 201
    document = _upload_document(actor=manager_level2, project=project, activity=activity_response.data["id"])
    assert document["activity_id"] == activity_response.data["id"]


def test_document_with_activity_from_another_project_returns_400(manager_level2):
    project_a = _create_project(creator=manager_level2, responsible=manager_level2)
    project_b = _create_project(creator=manager_level2, responsible=manager_level2, name="Otro proyecto")
    activity_response = _client_for(manager_level2).post(
        f"/api/v1/projects/{project_b.id}/activities/",
        {"description": "Reunión de seguimiento con el equipo", "start_time": "09:00", "end_time": "10:00"},
        format="json",
    )
    assert activity_response.status_code == 201
    response = _client_for(manager_level2).post(
        f"/api/v1/projects/{project_a.id}/documents/",
        {"file_name": "acta.pdf", "file_data": "ZmFrZS1iYXNlNjQ=", "activity": activity_response.data["id"]},
        format="json",
    )
    assert response.status_code == 400
