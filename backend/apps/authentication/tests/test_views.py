from unittest.mock import ANY

import pytest
from django.contrib.auth.models import Permission
from django.contrib.contenttypes.models import ContentType
from rest_framework.test import APIClient

from apps.permissions.models import ModulePermission
from apps.users.models import User

pytestmark = pytest.mark.django_db


def _grant(user: User, *codenames: str) -> None:
    content_type = ContentType.objects.get_for_model(ModulePermission)
    user.user_permissions.add(
        *Permission.objects.filter(content_type=content_type, codename__in=codenames)
    )


@pytest.fixture
def api_client():
    return APIClient()


def test_register_endpoint_creates_user_and_returns_tokens(api_client):
    response = api_client.post(
        "/api/v1/auth/register/",
        {"username": "ada", "email": "ada@example.com", "password": "Sup3r-Secr3t!"},
        format="json",
    )
    assert response.status_code == 201
    assert "tokens" in response.data
    assert response.data["user"]["username"] == "ada"


def test_login_endpoint_returns_tokens(api_client):
    api_client.post(
        "/api/v1/auth/register/",
        {"username": "ada", "email": "ada@example.com", "password": "Sup3r-Secr3t!"},
        format="json",
    )
    response = api_client.post(
        "/api/v1/auth/login/", {"identifier": "ada", "password": "Sup3r-Secr3t!"}, format="json"
    )
    assert response.status_code == 200
    assert "access" in response.data


def test_login_endpoint_with_invalid_credentials_returns_error_contract(api_client):
    response = api_client.post(
        "/api/v1/auth/login/", {"identifier": "nobody", "password": "wrong"}, format="json"
    )
    assert response.status_code == 401
    assert "error" in response.data
    assert response.data["error"]["code"]


def test_me_endpoint_requires_authentication(api_client):
    response = api_client.get("/api/v1/auth/me/")
    assert response.status_code == 401


def test_me_endpoint_returns_current_user(api_client):
    api_client.post(
        "/api/v1/auth/register/",
        {"username": "ada", "email": "ada@example.com", "password": "Sup3r-Secr3t!"},
        format="json",
    )
    login = api_client.post(
        "/api/v1/auth/login/", {"identifier": "ada", "password": "Sup3r-Secr3t!"}, format="json"
    )
    access_token = login.data["access"]
    api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {access_token}")
    response = api_client.get("/api/v1/auth/me/")
    assert response.status_code == 200
    assert response.data["username"] == "ada"


def test_me_endpoint_only_lists_permissions_the_user_actually_has(api_client):
    user = User.objects.create_user(
        username="plain", email="plain@example.com", password="Sup3r-Secr3t!"
    )
    _grant(user, "auditoria.ver")
    api_client.force_authenticate(user=user)

    response = api_client.get("/api/v1/auth/me/")

    assert response.status_code == 200
    assert response.data["permissions"] == ["auditoria.ver"]
    assert "usuarios.ver" not in response.data["permissions"]
    assert "roles.ver" not in response.data["permissions"]


def test_me_endpoint_lists_permissions_granted_via_catalog(api_client):
    user = User.objects.create_user(
        username="admin", email="admin@example.com", password="Sup3r-Secr3t!"
    )
    _grant(user, "usuarios.ver")
    api_client.force_authenticate(user=user)

    response = api_client.get("/api/v1/auth/me/")

    assert response.status_code == 200
    assert "usuarios.ver" in response.data["permissions"]


def test_patch_me_updates_first_name_and_email(api_client):
    """Fase 6b (ver docs/AUDIT_LOG.md § 2026-08-17): auto-servicio de
    perfil — sin permiso administrativo."""
    user = User.objects.create_user(
        username="ana", email="ana@example.com", password="Sup3r-Secr3t!"
    )
    api_client.force_authenticate(user=user)

    response = api_client.patch(
        "/api/v1/auth/me/", {"first_name": "Ana Editada", "email": "ana-nueva@example.com"}, format="json"
    )

    assert response.status_code == 200
    assert response.data["first_name"] == "Ana Editada"
    assert response.data["email"] == "ana-nueva@example.com"
    user.refresh_from_db()
    assert user.first_name == "Ana Editada"
    assert user.email == "ana-nueva@example.com"


def test_patch_me_requires_authentication(api_client):
    response = api_client.patch("/api/v1/auth/me/", {"first_name": "X"}, format="json")
    assert response.status_code == 401


def test_patch_me_rejects_email_already_used_by_another_user(api_client):
    User.objects.create_user(username="otro", email="otro@example.com", password="Sup3r-Secr3t!")
    user = User.objects.create_user(username="ana", email="ana@example.com", password="Sup3r-Secr3t!")
    api_client.force_authenticate(user=user)

    response = api_client.patch("/api/v1/auth/me/", {"email": "otro@example.com"}, format="json")

    assert response.status_code == 400
    user.refresh_from_db()
    assert user.email == "ana@example.com"


def test_patch_me_allows_keeping_own_email_unchanged(api_client):
    user = User.objects.create_user(username="ana", email="ana@example.com", password="Sup3r-Secr3t!")
    api_client.force_authenticate(user=user)

    response = api_client.patch(
        "/api/v1/auth/me/", {"first_name": "Ana", "email": "ana@example.com"}, format="json"
    )

    assert response.status_code == 200


def test_me_endpoint_includes_roles_and_legacy_postgres_id(api_client):
    """Fase 6a (ver docs/AUDIT_LOG.md § 2026-08-14): el puente de login de
    Next.js necesita `roles`/`legacy_postgres_id` para construir
    `session.role`/`session.userId` sin depender de Prisma."""
    from django.contrib.auth.models import Group

    user = User.objects.create_user(
        username="imported", email="imported@example.com", password="Sup3r-Secr3t!",
        legacy_postgres_id="clx0000000000000000000000",
    )
    user.groups.add(Group.objects.get_or_create(name="ANALISTA_CC")[0])
    api_client.force_authenticate(user=user)

    response = api_client.get("/api/v1/auth/me/")

    assert response.status_code == 200
    assert response.data["legacy_postgres_id"] == "clx0000000000000000000000"
    assert response.data["roles"] == [{"id": ANY, "name": "ANALISTA_CC"}]


def test_me_endpoint_includes_theme(api_client):
    """Fase 38 (ver docs/AUDIT_LOG.md § 2026-08-21): `src/app/layout.tsx` y
    `PATCH /api/users/[id]/theme` (Next.js) necesitan `id`/`theme` de acá —
    la sesión de Next.js solo conoce el `cuid` de Postgres del usuario, no
    su `id` numérico de Django."""
    user = User.objects.create_user(
        username="darkmode", email="darkmode@example.com", password="Sup3r-Secr3t!"
    )
    user.theme = User.Theme.DARK
    user.save(update_fields=["theme"])
    api_client.force_authenticate(user=user)

    response = api_client.get("/api/v1/auth/me/")

    assert response.status_code == 200
    assert response.data["id"] == user.id
    assert response.data["theme"] == "DARK"


def test_me_endpoint_includes_data_consent_accepted(api_client):
    """Fase 86 (ver docs/AUDIT_LOG.md § 2026-08-28): `src/app/(protected)/layout.tsx`
    necesita `data_consent_accepted` de acá para el `ConsentGate` (antes leía
    `prisma.user.dataConsentAccepted` directo)."""
    user = User.objects.create_user(
        username="consentida", email="consentida@example.com", password="Sup3r-Secr3t!"
    )
    user.data_consent_accepted = True
    user.save(update_fields=["data_consent_accepted"])
    api_client.force_authenticate(user=user)

    response = api_client.get("/api/v1/auth/me/")

    assert response.status_code == 200
    assert response.data["data_consent_accepted"] is True
