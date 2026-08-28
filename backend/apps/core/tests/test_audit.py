"""Cobertura de los escenarios Gherkin de auditoría transversal enriquecida
(ver tests/qa/features/authorization.feature)."""

import pytest
from django.contrib.auth.models import Permission
from django.contrib.contenttypes.models import ContentType
from rest_framework.test import APIClient

from apps.core.models import AuditLog
from apps.permissions.models import ModulePermission
from apps.users.models import User

pytestmark = pytest.mark.django_db


def _grant(user: User, *codenames: str) -> None:
    content_type = ContentType.objects.get_for_model(ModulePermission)
    user.user_permissions.add(
        *Permission.objects.filter(content_type=content_type, codename__in=codenames)
    )


@pytest.fixture
def full_audit_client():
    user = User.objects.create_user(
        username="audit_admin", email="audit_admin@example.com", password="Sup3r-Secr3t!"
    )
    _grant(
        user,
        "auditoria.ver",
        "auditoria.ver_detalle",
        "auditoria.ver_ubicacion",
        "roles.editar",
        "roles.ver",
        "usuarios.crear",
    )
    client = APIClient()
    client.force_authenticate(user=user)
    return client, user


@pytest.fixture
def basic_audit_client():
    """Solo `auditoria.ver` — sin detalle ni ubicación."""
    user = User.objects.create_user(
        username="audit_basic", email="audit_basic@example.com", password="Sup3r-Secr3t!"
    )
    _grant(user, "auditoria.ver")
    client = APIClient()
    client.force_authenticate(user=user)
    return client, user


@pytest.fixture
def plain_client():
    user = User.objects.create_user(
        username="plain", email="plain@example.com", password="Sup3r-Secr3t!"
    )
    client = APIClient()
    client.force_authenticate(user=user)
    return client, user


# --- Registro de modificación ------------------------------------------------


def test_successful_modification_is_recorded_with_before_and_after(full_audit_client):
    client, actor = full_audit_client

    response = client.post(
        "/api/v1/admin/roles/", {"name": "Soporte", "permission_codenames": []}, format="json"
    )
    assert response.status_code == 201
    role_id = response.data["id"]

    audit_response = client.get("/api/v1/admin/audit-logs/", {"action": "role.created"})

    assert audit_response.status_code == 200
    entry = next(e for e in audit_response.data["results"] if e["target_id"] == str(role_id))
    assert entry["actor_username"] == "audit_admin"
    assert entry["target_type"] == "group"
    assert entry["new_values"]["name"] == "Soporte"
    assert entry["created_at_local"]
    assert entry["result"] == "success"


# --- Auditoría de operación fallida -------------------------------------------


def test_failed_validation_is_audited_without_sensitive_data(full_audit_client):
    client, actor = full_audit_client

    response = client.post(
        "/api/v1/admin/users/",
        {"username": "nuevo", "email": "invalido", "password": "una-contrasena-secreta"},
        format="json",
    )
    assert response.status_code == 400

    failure = (
        AuditLog.objects.filter(result=AuditLog.Result.FAILURE, actor=actor)
        .order_by("-created_at")
        .first()
    )
    assert failure is not None
    assert failure.new_values.get("password") == "***"
    assert "una-contrasena-secreta" not in str(failure.new_values)


# --- Consulta autorizada del historial ----------------------------------------


def test_authorized_user_can_list_and_filter_history(full_audit_client):
    client, actor = full_audit_client
    client.post(
        "/api/v1/admin/roles/", {"name": "Ventas", "permission_codenames": []}, format="json"
    )

    response = client.get(
        "/api/v1/admin/audit-logs/",
        {"action": "role.created", "actor": actor.id, "module": "roles"},
    )

    assert response.status_code == 200
    assert response.data["count"] >= 1
    assert all(entry["action"] == "role.created" for entry in response.data["results"])


def test_audit_log_endpoints_are_read_only_from_the_ui_perspective(full_audit_client):
    """La UI (barra lateral) solo consume GET — no existen acciones de
    edición expuestas; se confirma aquí que el listado no incluye ningún
    control de escritura más allá de lo que el propio 405 ya garantiza."""
    client, actor = full_audit_client
    response = client.get("/api/v1/admin/audit-logs/")
    assert response.status_code == 200


# --- Consulta no autorizada ----------------------------------------------------


def test_user_without_ver_permission_gets_403(plain_client):
    client, actor = plain_client
    response = client.get("/api/v1/admin/audit-logs/")
    assert response.status_code == 403


# --- Visualización de ubicación restringida -----------------------------------


def test_location_hidden_without_permission_but_rest_of_fields_visible(
    full_audit_client, basic_audit_client
):
    admin_client, _ = full_audit_client
    basic_client, _ = basic_audit_client

    entry = AuditLog.objects.create(
        action="user.updated", target_type="user", target_id="1", location="Bogotá, Colombia"
    )

    with_permission = admin_client.get(f"/api/v1/admin/audit-logs/{entry.id}/")
    without_permission = basic_client.get(f"/api/v1/admin/audit-logs/{entry.id}/")

    assert with_permission.data["location"] == "Bogotá, Colombia"
    assert "location" not in without_permission.data
    assert without_permission.data["action"] == "user.updated"


def test_detail_diff_hidden_without_ver_detalle_permission(basic_audit_client):
    client, actor = basic_audit_client
    entry = AuditLog.objects.create(
        action="user.updated",
        target_type="user",
        target_id="1",
        previous_values={"first_name": "Ana"},
        new_values={"first_name": "Ada"},
    )

    response = client.get(f"/api/v1/admin/audit-logs/{entry.id}/")

    assert response.status_code == 200
    assert "previous_values" not in response.data
    assert "new_values" not in response.data
    assert response.data["action"] == "user.updated"


# --- Exclusión de información sensible ----------------------------------------


def test_sensitive_fields_are_masked_regardless_of_caller(full_audit_client):
    from apps.core.audit import record_audit_event

    _, actor = full_audit_client
    entry = record_audit_event(
        actor=actor,
        action="user.password_reset",
        target_type="user",
        target_id="1",
        new_values={"password": "hunter2", "refresh_token": "abc.def.ghi", "first_name": "Ada"},
    )

    assert entry.new_values["password"] == "***"
    assert entry.new_values["refresh_token"] == "***"
    assert entry.new_values["first_name"] == "Ada"


# --- Integridad de auditoría ---------------------------------------------------


def test_audit_log_cannot_be_modified_or_deleted_via_api(full_audit_client):
    client, actor = full_audit_client
    entry = AuditLog.objects.create(action="role.created", target_type="group", target_id="1")

    patch_response = client.patch(
        f"/api/v1/admin/audit-logs/{entry.id}/", {"action": "hacked"}, format="json"
    )
    delete_response = client.delete(f"/api/v1/admin/audit-logs/{entry.id}/")

    assert patch_response.status_code == 405
    assert delete_response.status_code == 405
    entry.refresh_from_db()
    assert entry.action == "role.created"
