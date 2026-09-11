"""Cobertura de tests/qa/features/password-security.feature."""

import re
from datetime import timedelta

import pytest
from django.contrib.auth.models import Permission
from django.contrib.contenttypes.models import ContentType
from django.core import mail
from django.utils import timezone
from rest_framework.test import APIClient

from apps.authentication.models import PasswordResetToken, Session
from apps.authentication.services import AuthenticationService
from apps.core.models import AuditLog
from apps.permissions.models import ModulePermission
from apps.users.models import User

pytestmark = pytest.mark.django_db


def _grant_all_catalog_permissions(user: User) -> None:
    content_type = ContentType.objects.get_for_model(ModulePermission)
    user.user_permissions.add(*Permission.objects.filter(content_type=content_type))


def _extract_raw_token_from_email(email_message) -> str:
    match = re.search(r"token=(\S+)", email_message.body)
    assert match, "El correo no contiene un enlace con token"
    return match.group(1)


@pytest.fixture
def api_client():
    return APIClient()


@pytest.fixture
def user():
    return User.objects.create_user(
        username="ada", email="ada@example.com", password="Sup3r-Secr3t!"
    )


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
def plain_client(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


# --- Solicitud de recuperación para usuario existente ----------------------


def test_requesting_reset_for_existing_user_sends_generic_response_and_token(api_client, user):
    response = api_client.post(
        "/api/v1/auth/password-reset/request/", {"identifier": "ada"}, format="json"
    )

    assert response.status_code == 200
    assert PasswordResetToken.objects.filter(user=user, used_at__isnull=True).count() == 1
    assert len(mail.outbox) == 1
    assert AuditLog.objects.filter(
        action="user.password_reset_requested", target_id=str(user.id)
    ).exists()


# --- Solicitud con usuario inexistente --------------------------------------


def test_requesting_reset_for_nonexistent_user_gets_identical_generic_response(api_client, user):
    real_response = api_client.post(
        "/api/v1/auth/password-reset/request/", {"identifier": "ada"}, format="json"
    )
    fake_response = api_client.post(
        "/api/v1/auth/password-reset/request/", {"identifier": "nobody-here"}, format="json"
    )

    assert real_response.status_code == fake_response.status_code == 200
    assert real_response.data["detail"] == fake_response.data["detail"]
    # Solo la solicitud real generó un token; la falsa no dejó rastro.
    assert PasswordResetToken.objects.count() == 1
    assert len(mail.outbox) == 1


def test_requesting_reset_for_disabled_user_does_not_generate_token(api_client, user):
    user.status = User.Status.DISABLED
    user.save()

    response = api_client.post(
        "/api/v1/auth/password-reset/request/", {"identifier": "ada"}, format="json"
    )

    assert response.status_code == 200
    assert PasswordResetToken.objects.count() == 0
    assert len(mail.outbox) == 0


# --- Uso exitoso del enlace --------------------------------------------------


def test_confirming_reset_with_valid_token_updates_password_and_revokes_sessions(api_client, user):
    AuthenticationService.authenticate_and_issue_tokens(identifier="ada", password="Sup3r-Secr3t!")
    assert Session.objects.filter(user=user, revoked_at__isnull=True).count() == 1

    api_client.post("/api/v1/auth/password-reset/request/", {"identifier": "ada"}, format="json")
    raw_token = _extract_raw_token_from_email(mail.outbox[-1])

    response = api_client.post(
        "/api/v1/auth/password-reset/confirm/",
        {
            "token": raw_token,
            "new_password": "N3w-Secr3t!!",
            "new_password_confirm": "N3w-Secr3t!!",
        },
        format="json",
    )

    assert response.status_code == 204
    user.refresh_from_db()
    assert user.check_password("N3w-Secr3t!!")
    assert Session.objects.filter(user=user, revoked_at__isnull=True).count() == 0
    assert PasswordResetToken.objects.get(user=user).used_at is not None
    assert AuditLog.objects.filter(
        action="user.password_reset_completed", target_id=str(user.id)
    ).exists()
    # Correo de solicitud + correo de confirmación de cambio.
    assert len(mail.outbox) == 2


# --- Reutilización del enlace -------------------------------------------------


def test_reusing_an_already_used_token_is_rejected_and_password_unchanged(api_client, user):
    api_client.post("/api/v1/auth/password-reset/request/", {"identifier": "ada"}, format="json")
    raw_token = _extract_raw_token_from_email(mail.outbox[-1])
    api_client.post(
        "/api/v1/auth/password-reset/confirm/",
        {
            "token": raw_token,
            "new_password": "N3w-Secr3t!!",
            "new_password_confirm": "N3w-Secr3t!!",
        },
        format="json",
    )

    second_response = api_client.post(
        "/api/v1/auth/password-reset/confirm/",
        {
            "token": raw_token,
            "new_password": "Another-Secr3t!!",
            "new_password_confirm": "Another-Secr3t!!",
        },
        format="json",
    )

    assert second_response.status_code == 400
    user.refresh_from_db()
    assert user.check_password("N3w-Secr3t!!")
    assert not user.check_password("Another-Secr3t!!")


# --- Enlace expirado -----------------------------------------------------------


def test_expired_token_is_rejected_and_allows_starting_a_new_request(api_client, user):
    api_client.post("/api/v1/auth/password-reset/request/", {"identifier": "ada"}, format="json")
    token = PasswordResetToken.objects.get(user=user)
    token.expires_at = timezone.now() - timedelta(minutes=1)
    token.save(update_fields=["expires_at"])
    raw_token = _extract_raw_token_from_email(mail.outbox[-1])

    expired_response = api_client.post(
        "/api/v1/auth/password-reset/confirm/",
        {
            "token": raw_token,
            "new_password": "N3w-Secr3t!!",
            "new_password_confirm": "N3w-Secr3t!!",
        },
        format="json",
    )
    assert expired_response.status_code == 400
    user.refresh_from_db()
    assert user.check_password("Sup3r-Secr3t!")

    new_request_response = api_client.post(
        "/api/v1/auth/password-reset/request/", {"identifier": "ada"}, format="json"
    )
    assert new_request_response.status_code == 200


# --- Contraseña que no cumple la política --------------------------------------


def test_weak_password_is_rejected_but_token_remains_valid(api_client, user):
    api_client.post("/api/v1/auth/password-reset/request/", {"identifier": "ada"}, format="json")
    raw_token = _extract_raw_token_from_email(mail.outbox[-1])

    weak_response = api_client.post(
        "/api/v1/auth/password-reset/confirm/",
        {"token": raw_token, "new_password": "123", "new_password_confirm": "123"},
        format="json",
    )
    assert weak_response.status_code == 400
    assert "new_password" in str(weak_response.data["error"]["details"]).lower()

    valid_response = api_client.post(
        "/api/v1/auth/password-reset/confirm/",
        {
            "token": raw_token,
            "new_password": "N3w-Secr3t!!",
            "new_password_confirm": "N3w-Secr3t!!",
        },
        format="json",
    )
    assert valid_response.status_code == 204


# --- Restablecimiento administrativo --------------------------------------------


def test_admin_reset_sends_link_and_records_admin_as_responsible_actor(
    admin_client, admin_user, user
):
    response = admin_client.post(
        f"/api/v1/admin/users/{user.id}/password-reset/", {"send_link": True}, format="json"
    )

    assert response.status_code == 204
    assert len(mail.outbox) == 1
    audit_entry = AuditLog.objects.get(action="user.password_reset_admin_initiated")
    assert audit_entry.actor_id == admin_user.id
    assert audit_entry.target_id == str(user.id)
    assert "password" not in str(audit_entry.new_values).lower()


def test_admin_can_force_change_and_revoke_sessions_independently(admin_client, user):
    AuthenticationService.authenticate_and_issue_tokens(identifier="ada", password="Sup3r-Secr3t!")
    assert Session.objects.filter(user=user, revoked_at__isnull=True).count() == 1

    response = admin_client.post(
        f"/api/v1/admin/users/{user.id}/password-reset/",
        {"force_change_on_next_login": True, "revoke_sessions": True},
        format="json",
    )

    assert response.status_code == 204
    user.refresh_from_db()
    assert user.must_change_password is True
    assert Session.objects.filter(user=user, revoked_at__isnull=True).count() == 0
    assert len(mail.outbox) == 0  # no se pidió enviar enlace


def test_admin_reset_requires_at_least_one_action(admin_client, user):
    response = admin_client.post(
        f"/api/v1/admin/users/{user.id}/password-reset/", {}, format="json"
    )
    assert response.status_code == 400


# --- Administrador sin permiso ---------------------------------------------------


def test_admin_without_permission_gets_403_and_no_token_generated(plain_client, admin_user):
    response = plain_client.post(
        f"/api/v1/admin/users/{admin_user.id}/password-reset/", {"send_link": True}, format="json"
    )

    assert response.status_code == 403
    assert PasswordResetToken.objects.count() == 0
    assert len(mail.outbox) == 0


# --- Cambio de contraseña forzado (respaldo real en backend) --------------------


def test_forced_password_change_blocks_other_endpoints_until_completed(
    api_client, admin_client, user
):
    tokens = AuthenticationService.authenticate_and_issue_tokens(
        identifier="ada", password="Sup3r-Secr3t!"
    )
    admin_client.post(
        f"/api/v1/admin/users/{user.id}/password-reset/",
        {"force_change_on_next_login": True},
        format="json",
    )

    api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {tokens['access']}")

    blocked_response = api_client.get("/api/v1/auth/sessions/")
    assert blocked_response.status_code == 403
    assert blocked_response.data["error"]["code"] == "password_change_required"

    me_response = api_client.get("/api/v1/auth/me/")
    assert me_response.status_code == 200
    assert me_response.data["must_change_password"] is True

    change_response = api_client.post(
        "/api/v1/auth/password/change/",
        {
            "current_password": "Sup3r-Secr3t!",
            "new_password": "N3w-Secr3t!!",
            "new_password_confirm": "N3w-Secr3t!!",
        },
        format="json",
    )
    assert change_response.status_code == 204

    unblocked_response = api_client.get("/api/v1/auth/sessions/")
    assert unblocked_response.status_code == 200

    user.refresh_from_db()
    assert user.must_change_password is False
    assert user.check_password("N3w-Secr3t!!")


# --- Enlace de recuperación entregado en mano (`return_link`) --------------
# Existe desde 2026-09-11: sin esto, alguien que olvidaba su contraseña no
# tenía forma de volver a entrar. `force_change_on_next_login` obliga a
# cambiarla DESPUÉS de iniciar sesión — justo lo que esa persona no puede
# hacer — y `send_link` depende de que el correo esté configurado.


def test_admin_can_obtain_the_reset_link_without_sending_any_email(admin_client, user):
    response = admin_client.post(
        f"/api/v1/admin/users/{user.id}/password-reset/",
        {"return_link": True},
        format="json",
    )

    assert response.status_code == 200
    assert "reset_url" in response.data
    assert "/reset-password?token=" in response.data["reset_url"]
    # El punto del modo: no depende del correo.
    assert len(mail.outbox) == 0


def test_the_returned_link_actually_works_to_set_a_new_password(admin_client, api_client, user):
    response = admin_client.post(
        f"/api/v1/admin/users/{user.id}/password-reset/",
        {"return_link": True},
        format="json",
    )
    raw_token = response.data["reset_url"].split("token=")[1]

    confirmacion = api_client.post(
        "/api/v1/auth/password-reset/confirm/",
        {
            "token": raw_token,
            "new_password": "Nueva-Clave-2026!",
            "new_password_confirm": "Nueva-Clave-2026!",
        },
        format="json",
    )

    # El endpoint de confirmación responde 204 (sin cuerpo), no 200.
    assert confirmacion.status_code == 204
    user.refresh_from_db()
    assert user.check_password("Nueva-Clave-2026!")


def test_the_returned_link_is_single_use(admin_client, api_client, user):
    response = admin_client.post(
        f"/api/v1/admin/users/{user.id}/password-reset/",
        {"return_link": True},
        format="json",
    )
    raw_token = response.data["reset_url"].split("token=")[1]
    cuerpo = {
        "token": raw_token,
        "new_password": "Nueva-Clave-2026!",
        "new_password_confirm": "Nueva-Clave-2026!",
    }
    primer_uso = api_client.post("/api/v1/auth/password-reset/confirm/", cuerpo, format="json")
    assert primer_uso.status_code == 204

    segundo_intento = api_client.post("/api/v1/auth/password-reset/confirm/", cuerpo, format="json")

    assert segundo_intento.status_code == 400


def test_the_audit_trail_records_the_link_was_issued_but_never_the_token(admin_client, user):
    response = admin_client.post(
        f"/api/v1/admin/users/{user.id}/password-reset/",
        {"return_link": True, "revoke_sessions": True},
        format="json",
    )
    raw_token = response.data["reset_url"].split("token=")[1]

    entrada = AuditLog.objects.get(action="user.password_reset_admin_initiated")
    assert entrada.new_values["return_link"] is True
    # El registro de auditoría lo pueden leer más personas que las que
    # pueden restablecer contraseñas: el token no puede estar ahí.
    assert raw_token not in str(entrada.new_values)
    assert "token" not in str(entrada.new_values).lower()


def test_sending_and_returning_the_link_share_the_same_token(admin_client, user):
    # Emitir un token invalida el anterior: si cada opción generase el suyo,
    # el correo llegaría con un enlace ya muerto.
    response = admin_client.post(
        f"/api/v1/admin/users/{user.id}/password-reset/",
        {"send_link": True, "return_link": True},
        format="json",
    )

    assert response.status_code == 200
    assert len(mail.outbox) == 1
    token_devuelto = response.data["reset_url"].split("token=")[1]
    assert token_devuelto in mail.outbox[0].body
    assert PasswordResetToken.objects.filter(user=user, used_at__isnull=True).count() == 1


def test_obtaining_the_link_requires_the_reset_permission(api_client, user):
    otro = User.objects.create_user(
        username="sin-permisos", email="sin@example.com", password="Sup3r-Secr3t!"
    )
    api_client.force_authenticate(user=otro)

    response = api_client.post(
        f"/api/v1/admin/users/{user.id}/password-reset/",
        {"return_link": True},
        format="json",
    )

    assert response.status_code == 403
