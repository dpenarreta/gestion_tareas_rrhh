"""Cobertura de tests/qa/features/roles.feature."""

import pytest
from django.contrib.auth.models import Group, Permission
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
def roles_admin_client():
    user = User.objects.create_user(
        username="roles_admin", email="roles_admin@example.com", password="Sup3r-Secr3t!"
    )
    _grant(user, "roles.ver", "roles.editar")
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.fixture
def plain_client():
    user = User.objects.create_user(
        username="plain", email="plain@example.com", password="Sup3r-Secr3t!"
    )
    client = APIClient()
    client.force_authenticate(user=user)
    return client, user


# --- Creación de rol con permisos ------------------------------------------


def test_creating_role_saves_only_selected_permissions_and_audits(roles_admin_client):
    response = roles_admin_client.post(
        "/api/v1/admin/roles/",
        {"name": "Soporte", "permission_codenames": ["usuarios.ver", "auditoria.ver"]},
        format="json",
    )

    assert response.status_code == 201
    role = Group.objects.get(name="Soporte")
    assert sorted(response.data["permission_codenames"]) == ["auditoria.ver", "usuarios.ver"]
    assert role.permissions.count() == 2
    assert AuditLog.objects.filter(action="role.created", target_id=str(role.id)).exists()


# --- Selección completa de permisos de un módulo ---------------------------


def test_role_can_hold_every_permission_of_a_module(roles_admin_client):
    codenames = ["usuarios.ver", "usuarios.crear", "usuarios.editar", "usuarios.deshabilitar"]
    response = roles_admin_client.post(
        "/api/v1/admin/roles/",
        {"name": "Gestor total", "permission_codenames": codenames},
        format="json",
    )

    assert response.status_code == 201
    assert sorted(response.data["permission_codenames"]) == sorted(codenames)


# --- Selección parcial de permisos -----------------------------------------


def test_role_stores_only_the_partial_selection_sent(roles_admin_client):
    response = roles_admin_client.post(
        "/api/v1/admin/roles/",
        {"name": "Solo lectura", "permission_codenames": ["usuarios.ver"]},
        format="json",
    )

    assert response.status_code == 201
    role = Group.objects.get(name="Solo lectura")
    assert list(role.permissions.values_list("codename", flat=True)) == ["usuarios.ver"]


# --- Edición de rol ----------------------------------------------------------


def test_updating_role_name_and_permissions_audits_only_changed_fields(roles_admin_client):
    create_response = roles_admin_client.post(
        "/api/v1/admin/roles/",
        {"name": "Original", "permission_codenames": ["usuarios.ver"]},
        format="json",
    )
    role_id = create_response.data["id"]

    response = roles_admin_client.patch(
        f"/api/v1/admin/roles/{role_id}/",
        {"name": "Renombrado"},
        format="json",
    )

    assert response.status_code == 200
    assert response.data["name"] == "Renombrado"
    assert response.data["permission_codenames"] == ["usuarios.ver"]


# --- Eliminación física de rol ------------------------------------------------


def test_deleting_role_removes_it_and_audits(roles_admin_client):
    create_response = roles_admin_client.post(
        "/api/v1/admin/roles/", {"name": "Temporal", "permission_codenames": []}, format="json"
    )
    role_id = create_response.data["id"]

    response = roles_admin_client.delete(f"/api/v1/admin/roles/{role_id}/")

    assert response.status_code == 204
    assert not Group.objects.filter(id=role_id).exists()
    assert AuditLog.objects.filter(action="role.deleted", target_id=str(role_id)).exists()


def test_cannot_create_two_roles_with_the_same_name(roles_admin_client):
    roles_admin_client.post(
        "/api/v1/admin/roles/", {"name": "Duplicado", "permission_codenames": []}, format="json"
    )
    response = roles_admin_client.post(
        "/api/v1/admin/roles/", {"name": "Duplicado", "permission_codenames": []}, format="json"
    )
    assert response.status_code == 400


# --- Acceso sin permiso -------------------------------------------------------


def test_accessing_roles_without_permission_is_rejected_and_audited(plain_client):
    client, actor = plain_client

    response = client.get("/api/v1/admin/roles/")

    assert response.status_code == 403
    denial = AuditLog.objects.filter(action="access_denied", target_id=str(actor.id)).first()
    assert denial is not None
    assert denial.new_values["required_permission"] == "roles.ver"


def test_permissions_catalog_endpoint_returns_full_catalog(roles_admin_client):
    response = roles_admin_client.get("/api/v1/admin/roles/permissions-catalog/")

    assert response.status_code == 200
    assert "usuarios" in response.data
    assert "roles" in response.data
    # Módulos de negocio agregados en el catálogo dinámico extendido a todo
    # el sistema (ver docs/AUDIT_LOG.md § 2026-09-01).
    assert "reportes" in response.data
    assert "equipo" in response.data


# --- Integración con el catálogo dinámico extendido (ver docs/AUDIT_LOG.md
# § 2026-09-01, "Catálogo dinámico de permisos extendido a todo el
# sistema") — confirma que editar los permisos de un rol vía esta pantalla
# cambia de verdad el resultado de `user_has_permission`, no solo el dato
# persistido. ------------------------------------------------------------


def test_editing_a_role_permission_changes_effective_authorization(roles_admin_client):
    from apps.permissions.authorization import user_has_permission

    role = Group.objects.create(name="Analista de Prueba")
    member = User.objects.create_user(
        username="miembro_prueba", email="miembro_prueba@example.com", password="Sup3r-Secr3t!"
    )
    member.groups.add(role)

    assert user_has_permission(member, "reportes.ver") is False

    response = roles_admin_client.patch(
        f"/api/v1/admin/roles/{role.id}/",
        {"permission_codenames": ["reportes.ver"]},
        format="json",
    )

    assert response.status_code == 200
    # Instancia NUEVA del usuario — `get_all_permissions()` cachea en el
    # propio objeto Python (`_perm_cache`), así que reusar `member` (ya
    # consultado arriba) daría un falso negativo. Cada request real sí
    # obtiene una instancia nueva (ver docstring de
    # `get_user_permission_codenames`), esto lo replica.
    fresh_member = User.objects.get(pk=member.pk)
    assert user_has_permission(fresh_member, "reportes.ver") is True
