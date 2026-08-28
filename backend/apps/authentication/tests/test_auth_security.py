"""Cobertura de tests/qa/features/jwt-security.feature y authentication.feature."""

from datetime import timedelta

import pytest
from django.conf import settings
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import AccessToken

from apps.authentication.models import LoginAttempt, Session
from apps.authentication.services import GENERIC_AUTH_ERROR, LOCKOUT_ERROR, AuthenticationService
from apps.users.models import User

pytestmark = pytest.mark.django_db


@pytest.fixture
def api_client():
    return APIClient()


@pytest.fixture
def user():
    return User.objects.create_user(
        username="ada", email="ada@example.com", password="Sup3r-Secr3t!"
    )


# --- Inicio de sesión exitoso ---------------------------------------------


def test_successful_login_issues_tokens_and_registers_session(api_client, user):
    response = api_client.post(
        "/api/v1/auth/login/", {"identifier": "ada", "password": "Sup3r-Secr3t!"}, format="json"
    )

    assert response.status_code == 200
    assert "access" in response.data
    assert "refresh" in response.data
    assert Session.objects.filter(user=user, revoked_at__isnull=True).count() == 1
    assert LoginAttempt.objects.filter(identifier="ada", successful=True).exists()


def test_successful_login_includes_session_policy_for_nexo_session_cookie(api_client, user):
    """Fase 6a (ver docs/AUDIT_LOG.md § 2026-08-14): el puente de login de
    Next.js necesita `session_policy` para fijar la duración de
    `nexo-session` sin leer Postgres."""
    response = api_client.post(
        "/api/v1/auth/login/", {"identifier": "ada", "password": "Sup3r-Secr3t!"}, format="json"
    )

    assert response.status_code == 200
    assert response.data["session_policy"] == {"default_hours": 168, "remember_hours": 720}


# --- Contraseña incorrecta --------------------------------------------------


def test_wrong_password_returns_generic_error_and_logs_attempt(api_client, user):
    response = api_client.post(
        "/api/v1/auth/login/", {"identifier": "ada", "password": "wrong-password"}, format="json"
    )

    assert response.status_code == 401
    assert response.data["error"]["message"] == GENERIC_AUTH_ERROR
    assert LoginAttempt.objects.filter(identifier="ada", successful=False).exists()


def test_nonexistent_user_gets_identical_response_to_wrong_password(api_client, user):
    wrong_password_response = api_client.post(
        "/api/v1/auth/login/", {"identifier": "ada", "password": "wrong-password"}, format="json"
    )
    nonexistent_user_response = api_client.post(
        "/api/v1/auth/login/",
        {"identifier": "nobody-here", "password": "wrong-password"},
        format="json",
    )

    assert wrong_password_response.status_code == nonexistent_user_response.status_code == 401
    assert (
        wrong_password_response.data["error"]["message"]
        == nonexistent_user_response.data["error"]["message"]
        == GENERIC_AUTH_ERROR
    )


# --- Usuario deshabilitado ---------------------------------------------------


def test_disabled_user_is_rejected_without_tokens_and_attempt_is_logged(api_client, user):
    user.status = User.Status.DISABLED
    user.save()

    response = api_client.post(
        "/api/v1/auth/login/", {"identifier": "ada", "password": "Sup3r-Secr3t!"}, format="json"
    )

    assert response.status_code == 401
    assert response.data["error"]["message"] == GENERIC_AUTH_ERROR
    assert "access" not in response.data
    assert LoginAttempt.objects.filter(identifier="ada", successful=False).exists()


def test_disabling_user_revokes_all_active_sessions():
    user = User.objects.create_user(
        username="grace", email="grace@example.com", password="Sup3r-Secr3t!"
    )
    AuthenticationService.authenticate_and_issue_tokens(
        identifier="grace", password="Sup3r-Secr3t!"
    )
    assert Session.objects.filter(user=user, revoked_at__isnull=True).count() == 1

    user.status = User.Status.DISABLED
    user.save()

    assert Session.objects.filter(user=user, revoked_at__isnull=True).count() == 0


# --- Token expirado -----------------------------------------------------------


def test_expired_access_token_is_rejected_with_401(api_client, user):
    tokens = AuthenticationService.authenticate_and_issue_tokens(
        identifier="ada", password="Sup3r-Secr3t!"
    )
    session = Session.objects.get(user=user)

    expired_access = AccessToken.for_user(user)
    expired_access["sid"] = str(session.id)
    expired_access.set_exp(lifetime=timedelta(seconds=-10))

    api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {expired_access}")
    response = api_client.get("/api/v1/auth/me/")

    assert response.status_code == 401
    assert "password" not in str(response.data).lower()
    del tokens  # solo para dejar explícito que no se usa el access original


# --- Renovación de token -------------------------------------------------------


def test_refresh_with_valid_token_issues_new_access_and_keeps_session(user):
    tokens = AuthenticationService.authenticate_and_issue_tokens(
        identifier="ada", password="Sup3r-Secr3t!"
    )
    session = Session.objects.get(user=user)

    new_tokens = AuthenticationService.refresh_tokens(refresh_token_str=tokens["refresh"])

    session.refresh_from_db()
    assert new_tokens["access"] != tokens["access"]
    assert session.is_active
    assert AccessToken(new_tokens["access"])["sid"] == str(session.id)


# --- Refresh token revocado / reutilizado --------------------------------------


def test_reusing_a_rotated_refresh_token_revokes_the_session_and_is_rejected():
    user = User.objects.create_user(
        username="lin", email="lin@example.com", password="Sup3r-Secr3t!"
    )
    tokens = AuthenticationService.authenticate_and_issue_tokens(
        identifier="lin", password="Sup3r-Secr3t!"
    )
    session = Session.objects.get(user=user)

    # Rotación legítima: el refresh original queda obsoleto.
    AuthenticationService.refresh_tokens(refresh_token_str=tokens["refresh"])

    # Reutilización del refresh original ya rotado.
    with pytest.raises(Exception) as exc_info:
        AuthenticationService.refresh_tokens(refresh_token_str=tokens["refresh"])
    assert exc_info.value.status_code == 401

    session.refresh_from_db()
    assert not session.is_active


# --- Protección contra fuerza bruta --------------------------------------------


def test_exceeding_failed_attempts_locks_out_even_correct_credentials(api_client, user):
    for _ in range(settings.LOGIN_MAX_FAILED_ATTEMPTS):
        api_client.post(
            "/api/v1/auth/login/",
            {"identifier": "ada", "password": "wrong-password"},
            format="json",
        )

    locked_response = api_client.post(
        "/api/v1/auth/login/", {"identifier": "ada", "password": "Sup3r-Secr3t!"}, format="json"
    )

    assert locked_response.status_code == 401
    assert locked_response.data["error"]["message"] == LOCKOUT_ERROR


# --- Almacenamiento seguro de contraseñas --------------------------------------


def test_password_is_never_stored_in_plain_text(user):
    user.refresh_from_db()
    assert user.password != "Sup3r-Secr3t!"
    assert user.password.startswith("argon2$")
    assert "$" in user.password  # separador de salt/parámetros propio del hash
