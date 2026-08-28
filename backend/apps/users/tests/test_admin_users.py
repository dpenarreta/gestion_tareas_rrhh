"""Cobertura de tests/qa/features/users.feature."""

from datetime import datetime
from datetime import timezone as dt_timezone

import pytest
from django.contrib.auth.models import Permission
from django.contrib.contenttypes.models import ContentType
from rest_framework.test import APIClient

from apps.authentication.models import Session
from apps.authentication.services import AuthenticationService
from apps.core.models import AuditLog
from apps.permissions.models import ModulePermission
from apps.users.models import User
from apps.users.services import LAST_ACTIVE_ADMIN_ERROR

pytestmark = pytest.mark.django_db


def _grant_all_catalog_permissions(user: User) -> None:
    content_type = ContentType.objects.get_for_model(ModulePermission)
    user.user_permissions.add(*Permission.objects.filter(content_type=content_type))


@pytest.fixture
def admin_user():
    admin = User.objects.create_user(
        username="admin", email="admin@example.com", password="Sup3r-Secr3t!"
    )
    _grant_all_catalog_permissions(admin)
    return admin


@pytest.fixture
def admin_client(admin_user):
    client = APIClient()
    client.force_authenticate(user=admin_user)
    return client


@pytest.fixture
def plain_user():
    return User.objects.create_user(
        username="plain", email="plain@example.com", password="Sup3r-Secr3t!"
    )


@pytest.fixture
def plain_client(plain_user):
    client = APIClient()
    client.force_authenticate(user=plain_user)
    return client


# --- Creación exitosa de usuario ------------------------------------------


def test_admin_creates_user_successfully(admin_client, admin_user):
    response = admin_client.post(
        "/api/v1/admin/users/",
        {
            "username": "nuevo",
            "email": "nuevo@example.com",
            "password": "Sup3r-Secr3t!",
            "first_name": "Nueva",
            "last_name": "Persona",
        },
        format="json",
    )

    assert response.status_code == 201
    created = User.objects.get(username="nuevo")
    assert created.check_password("Sup3r-Secr3t!")
    assert created.password != "Sup3r-Secr3t!"
    assert created.created_by_id == admin_user.id
    assert AuditLog.objects.filter(action="user.created", target_id=str(created.id)).exists()


# --- Creación con correo duplicado -----------------------------------------


def test_admin_cannot_create_user_with_duplicate_email(admin_client, plain_user):
    response = admin_client.post(
        "/api/v1/admin/users/",
        {"username": "otro", "email": plain_user.email, "password": "Sup3r-Secr3t!"},
        format="json",
    )

    assert response.status_code == 400
    assert User.objects.filter(email=plain_user.email).count() == 1


# --- Edición de usuario ------------------------------------------------------


def test_admin_edits_user_and_records_audit(admin_client, admin_user, plain_user):
    response = admin_client.patch(
        f"/api/v1/admin/users/{plain_user.id}/", {"first_name": "Editado"}, format="json"
    )

    assert response.status_code == 200
    plain_user.refresh_from_db()
    assert plain_user.first_name == "Editado"
    assert plain_user.updated_by_id == admin_user.id
    audit_entry = AuditLog.objects.filter(
        action="user.updated", target_id=str(plain_user.id)
    ).first()
    assert audit_entry is not None
    assert audit_entry.previous_values == {"first_name": ""}
    assert audit_entry.new_values == {"first_name": "Editado"}


# --- Deshabilitación de usuario -----------------------------------------------


def test_disabling_user_revokes_sessions_and_blocks_future_login(admin_client, plain_user):
    AuthenticationService.authenticate_and_issue_tokens(
        identifier="plain", password="Sup3r-Secr3t!"
    )
    assert Session.objects.filter(user=plain_user, revoked_at__isnull=True).count() == 1

    response = admin_client.post(f"/api/v1/admin/users/{plain_user.id}/disable/")

    assert response.status_code == 200
    plain_user.refresh_from_db()
    assert plain_user.status == User.Status.DISABLED
    assert not plain_user.is_active
    assert Session.objects.filter(user=plain_user, revoked_at__isnull=True).count() == 0
    assert AuditLog.objects.filter(action="user.disabled", target_id=str(plain_user.id)).exists()

    login_response = APIClient().post(
        "/api/v1/auth/login/", {"identifier": "plain", "password": "Sup3r-Secr3t!"}, format="json"
    )
    assert login_response.status_code == 401


# --- Acceso sin permiso -------------------------------------------------------


def test_user_without_permission_gets_403(plain_client):
    response = plain_client.get("/api/v1/admin/users/")
    assert response.status_code == 403


def test_editing_user_without_permission_is_rejected_and_persists_no_changes(plain_client):
    target = User.objects.create_user(
        username="target", email="target@example.com", password="Sup3r-Secr3t!"
    )

    response = plain_client.patch(
        f"/api/v1/admin/users/{target.id}/", {"first_name": "Hackeado"}, format="json"
    )

    assert response.status_code == 403
    target.refresh_from_db()
    assert target.first_name == ""


# --- Búsqueda y paginación -----------------------------------------------------


def test_list_is_paginated_and_search_filters_results(admin_client, settings):
    settings.ADMIN_USERS_PAGE_SIZE = 2
    for i in range(5):
        User.objects.create_user(
            username=f"buscar{i}", email=f"buscar{i}@example.com", password="Sup3r-Secr3t!"
        )

    first_page = admin_client.get("/api/v1/admin/users/")
    assert first_page.status_code == 200
    assert len(first_page.data["results"]) == 2
    assert first_page.data["count"] >= 5
    assert first_page.data["next"] is not None

    filtered = admin_client.get("/api/v1/admin/users/", {"q": "buscar2"})
    assert filtered.status_code == 200
    assert filtered.data["count"] == 1
    assert filtered.data["results"][0]["username"] == "buscar2"


# --- AC-038: protección del último administrador activo -----------------------


def test_cannot_disable_the_last_active_superuser(admin_client, admin_user):
    admin_user.is_superuser = True
    admin_user.save(update_fields=["is_superuser"])

    response = admin_client.post(f"/api/v1/admin/users/{admin_user.id}/disable/")

    assert response.status_code == 400
    assert LAST_ACTIVE_ADMIN_ERROR in str(response.data)
    admin_user.refresh_from_db()
    assert admin_user.status == User.Status.ACTIVE


def test_cannot_block_the_last_active_superuser(admin_client, admin_user):
    admin_user.is_superuser = True
    admin_user.save(update_fields=["is_superuser"])

    response = admin_client.post(f"/api/v1/admin/users/{admin_user.id}/block/")

    assert response.status_code == 400
    admin_user.refresh_from_db()
    assert admin_user.status == User.Status.ACTIVE


def test_can_disable_a_superuser_when_another_active_superuser_remains(admin_client, admin_user):
    admin_user.is_superuser = True
    admin_user.save(update_fields=["is_superuser"])
    other_admin = User.objects.create_user(
        username="admin2", email="admin2@example.com", password="Sup3r-Secr3t!", is_superuser=True
    )

    response = admin_client.post(f"/api/v1/admin/users/{other_admin.id}/disable/")

    assert response.status_code == 200
    other_admin.refresh_from_db()
    assert other_admin.status == User.Status.DISABLED


def test_can_disable_a_non_admin_user_freely(admin_client, plain_user):
    response = admin_client.post(f"/api/v1/admin/users/{plain_user.id}/disable/")
    assert response.status_code == 200


# --- reset-consent / reset-consent-all (Fase 13, ver docs/AUDIT_LOG.md § 2026-08-19) ---


def test_reset_consent_requires_usuarios_editar_permission(plain_client, plain_user):
    response = plain_client.post(f"/api/v1/admin/users/{plain_user.id}/reset-consent/")
    assert response.status_code == 403


def test_reset_consent_clears_previously_accepted_consent(admin_client, plain_user):
    plain_user.data_consent_accepted = True
    plain_user.data_consent_accepted_at = datetime(2026, 1, 1, tzinfo=dt_timezone.utc)
    plain_user.save(update_fields=["data_consent_accepted", "data_consent_accepted_at"])

    response = admin_client.post(f"/api/v1/admin/users/{plain_user.id}/reset-consent/")

    assert response.status_code == 200
    plain_user.refresh_from_db()
    assert plain_user.data_consent_accepted is False
    assert plain_user.data_consent_accepted_at is None
    assert AuditLog.objects.filter(action="user.consent_reset", target_id=str(plain_user.id)).exists()


def test_reset_consent_all_rejects_catalog_permissions_alone(admin_client):
    # `admin_client` tiene TODOS los permisos del catálogo pero no es
    # superusuario ni pertenece al grupo ADMINISTRADOR — reset-consent-all
    # exige ese chequeo estricto, no el catálogo.
    response = admin_client.post("/api/v1/admin/users/reset-consent-all/")
    assert response.status_code == 403


def test_reset_consent_all_allows_superuser(admin_client, admin_user, plain_user):
    admin_user.is_superuser = True
    admin_user.save(update_fields=["is_superuser"])
    plain_user.data_consent_accepted = True
    plain_user.save(update_fields=["data_consent_accepted"])

    response = admin_client.post("/api/v1/admin/users/reset-consent-all/")

    assert response.status_code == 200
    assert response.data["ok"] is True
    assert response.data["count"] == User.objects.count()
    plain_user.refresh_from_db()
    assert plain_user.data_consent_accepted is False
    assert AuditLog.objects.filter(action="user.consent_reset_all").exists()
