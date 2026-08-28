"""Cobertura de tests/qa/features/permissions.feature."""

import pytest
from django.contrib.auth.models import Permission
from django.contrib.contenttypes.models import ContentType
from rest_framework.test import APIClient

from apps.authentication.services import AuthenticationService
from apps.permissions.authorization import get_user_permission_codenames, user_has_permission
from apps.permissions.models import ModulePermission
from apps.users.models import User

pytestmark = pytest.mark.django_db


def _grant(user: User, *codenames: str) -> None:
    content_type = ContentType.objects.get_for_model(ModulePermission)
    user.user_permissions.add(
        *Permission.objects.filter(content_type=content_type, codename__in=codenames)
    )


def test_catalog_endpoint_requires_authentication():
    client = APIClient()
    response = client.get("/api/v1/admin/permissions/")
    assert response.status_code == 401


def test_catalog_endpoint_requires_permisos_ver():
    user = User.objects.create_user(
        username="plain", email="plain@example.com", password="Sup3r-Secr3t!"
    )
    client = APIClient()
    client.force_authenticate(user=user)

    response = client.get("/api/v1/admin/permissions/")
    assert response.status_code == 403


def test_catalog_endpoint_returns_full_catalog_grouped_by_module():
    user = User.objects.create_user(
        username="viewer", email="viewer@example.com", password="Sup3r-Secr3t!"
    )
    _grant(user, "permisos.ver")
    client = APIClient()
    client.force_authenticate(user=user)

    response = client.get("/api/v1/admin/permissions/")

    assert response.status_code == 200
    assert "usuarios" in response.data
    assert "roles" in response.data
    assert "usuarios.ver" in response.data["usuarios"]["permissions"]


def test_superuser_bypasses_catalog_for_authorization_checks():
    superuser = User.objects.create_superuser(
        username="root", email="root@example.com", password="Sup3r-Secr3t!"
    )
    assert user_has_permission(superuser, "usuarios.editar") is True


def test_me_endpoint_permission_list_includes_catalog_permissions_for_superuser():
    """`get_user_permission_codenames` (usada por /auth/me/) no hace ningún
    bypass propio para superusuarios — pero Django's `ModelBackend` sí lo
    hace de forma transparente en `get_all_permissions()` (devuelve
    `Permission.objects.all()` para cualquier `is_superuser=True`), así que
    un superusuario ve el catálogo completo igualmente, sin que este código
    tenga que duplicar esa lógica."""
    superuser = User.objects.create_superuser(
        username="root2", email="root2@example.com", password="Sup3r-Secr3t!"
    )
    assert "usuarios.editar" in get_user_permission_codenames(superuser)


def test_revoking_permission_takes_effect_on_next_request_without_relogin():
    """La revocación debe reflejarse en la *siguiente petición HTTP*, no
    necesariamente en la misma instancia de `User` en memoria — Django cachea
    los permisos resueltos en el propio objeto (`_perm_cache`) durante su
    tiempo de vida. Se usa un access token real (en vez de
    `force_authenticate`, que reutiliza la misma instancia de `User` entre
    llamadas del test client) para que cada request pase por
    `SessionAuthentication.get_user`, que sí obtiene una instancia nueva de
    la base — igual que en producción, sin caché entre requests reales."""
    user = User.objects.create_user(username="u1", email="u1@example.com", password="Sup3r-Secr3t!")
    _grant(user, "usuarios.ver")
    tokens = AuthenticationService.authenticate_and_issue_tokens(
        identifier="u1", password="Sup3r-Secr3t!"
    )
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {tokens['access']}")

    allowed_response = client.get("/api/v1/admin/users/")
    assert allowed_response.status_code == 200

    content_type = ContentType.objects.get_for_model(ModulePermission)
    perm = Permission.objects.get(content_type=content_type, codename="usuarios.ver")
    user.user_permissions.remove(perm)

    denied_response = client.get("/api/v1/admin/users/")
    assert denied_response.status_code == 403
