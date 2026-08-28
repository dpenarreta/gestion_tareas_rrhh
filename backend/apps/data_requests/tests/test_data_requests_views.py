"""Cobertura HTTP de `/api/v1/data-requests/` — Fase 12 (ver
docs/AUDIT_LOG.md § 2026-08-19), réplica de los 3 `route.ts` de
`src/app/api/data-requests/**`."""

import json

import pytest
from django.contrib.auth.models import Group
from rest_framework.test import APIClient

from apps.data_requests.models import DataSubjectRequest
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
def titular():
    return _user_with_group("titular", "ASISTENTE_GH")


@pytest.fixture
def admin():
    return _user_with_group("admin", "ADMINISTRADOR")


# --- DataRequestListCreateView.get -------------------------------------------------


def test_list_requires_authentication():
    response = APIClient().get("/api/v1/data-requests/")
    assert response.status_code == 401


def test_list_scoped_to_own_requests_for_non_admin(titular, admin):
    DataSubjectRequest.objects.create(user=titular, type=DataSubjectRequest.Type.ACCESO)
    other = _user_with_group("other", "ASISTENTE_GH")
    DataSubjectRequest.objects.create(user=other, type=DataSubjectRequest.Type.ACCESO)

    response = _client_for(titular).get("/api/v1/data-requests/")
    assert response.status_code == 200
    assert len(response.data) == 1
    assert response.data[0]["user"]["id"] == titular.id


def test_list_admin_sees_everyone(titular, admin):
    DataSubjectRequest.objects.create(user=titular, type=DataSubjectRequest.Type.ACCESO)
    other = _user_with_group("other2", "ASISTENTE_GH")
    DataSubjectRequest.objects.create(user=other, type=DataSubjectRequest.Type.ACCESO)

    response = _client_for(admin).get("/api/v1/data-requests/")
    assert response.status_code == 200
    assert len(response.data) == 2


def test_list_includes_nested_user_and_resolver(titular, admin):
    request_obj = DataSubjectRequest.objects.create(
        user=titular, type=DataSubjectRequest.Type.RECTIFICACION, status=DataSubjectRequest.Status.RESUELTA,
        resolved_by=admin,
    )
    response = _client_for(admin).get("/api/v1/data-requests/")
    entry = next(r for r in response.data if r["id"] == request_obj.id)
    assert entry["resolver"]["id"] == admin.id
    assert entry["user_id"] == titular.id
    assert entry["resolved_by_id"] == admin.id


# --- DataRequestListCreateView.post ------------------------------------------------


def test_create_400_for_invalid_type(titular):
    response = _client_for(titular).post("/api/v1/data-requests/", {"type": "OTRO"}, format="json")
    assert response.status_code == 400


def test_create_201_returns_flat_shape_without_nested_objects(titular):
    response = _client_for(titular).post(
        "/api/v1/data-requests/", {"type": "ACCESO", "description": "  "}, format="json"
    )
    assert response.status_code == 201
    assert response.data["user_id"] == titular.id
    assert response.data["resolved_by_id"] is None
    assert "user" not in response.data
    assert "resolver" not in response.data
    # descripción vacía/solo-espacios -> None.
    assert response.data["description"] is None


def test_create_any_authenticated_user_no_special_role_required(titular):
    response = _client_for(titular).post("/api/v1/data-requests/", {"type": "ELIMINACION"}, format="json")
    assert response.status_code == 201
    assert response.data["status"] == DataSubjectRequest.Status.PENDIENTE


# --- DataRequestDetailView.patch ----------------------------------------------------


def test_patch_403_for_non_admin(titular):
    data_request = DataSubjectRequest.objects.create(user=titular, type=DataSubjectRequest.Type.RECTIFICACION)
    response = _client_for(titular).patch(f"/api/v1/data-requests/{data_request.id}/", {"status": "RESUELTA"}, format="json")
    assert response.status_code == 403


def test_patch_400_for_invalid_status(titular, admin):
    data_request = DataSubjectRequest.objects.create(user=titular, type=DataSubjectRequest.Type.RECTIFICACION)
    response = _client_for(admin).patch(f"/api/v1/data-requests/{data_request.id}/", {"status": "CERRADA"}, format="json")
    assert response.status_code == 400


def test_patch_404_for_missing_request(admin):
    response = _client_for(admin).patch("/api/v1/data-requests/999999/", {"status": "RESUELTA"}, format="json")
    assert response.status_code == 404


def test_patch_resolves_and_returns_nested_shape(titular, admin):
    data_request = DataSubjectRequest.objects.create(user=titular, type=DataSubjectRequest.Type.RECTIFICACION)
    response = _client_for(admin).patch(f"/api/v1/data-requests/{data_request.id}/", {"status": "RESUELTA"}, format="json")
    assert response.status_code == 200
    assert response.data["status"] == "RESUELTA"
    assert response.data["resolver"]["id"] == admin.id
    data_request.refresh_from_db()
    assert data_request.resolved_by == admin


# --- MyDataExportView ---------------------------------------------------------------


def test_export_requires_authentication():
    response = APIClient().get("/api/v1/data-requests/my-data/")
    assert response.status_code == 401


def test_export_returns_downloadable_json(titular):
    response = _client_for(titular).get("/api/v1/data-requests/my-data/")
    assert response.status_code == 200
    assert response["Content-Type"] == "application/json"
    assert response["Content-Disposition"] == f'attachment; filename="nexo-mis-datos-{titular.id}.json"'
    payload = json.loads(response.content)
    assert payload["usuario"]["id"] == titular.id
    assert "tareas" in payload


def test_export_creates_resolved_acceso_record(titular):
    _client_for(titular).get("/api/v1/data-requests/my-data/")
    record = DataSubjectRequest.objects.get(user=titular)
    assert record.type == DataSubjectRequest.Type.ACCESO
    assert record.status == DataSubjectRequest.Status.RESUELTA
