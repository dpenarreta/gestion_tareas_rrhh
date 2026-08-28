import pytest
from rest_framework.exceptions import AuthenticationFailed

from apps.authentication.services import AuthenticationService

pytestmark = pytest.mark.django_db


def test_register_user_creates_user_with_hashed_password():
    user = AuthenticationService.register_user(
        username="ada", email="ada@example.com", password="Sup3r-Secr3t!"
    )
    assert user.pk is not None
    assert user.check_password("Sup3r-Secr3t!")


def test_authenticate_and_issue_tokens_returns_access_and_refresh():
    AuthenticationService.register_user(
        username="ada", email="ada@example.com", password="Sup3r-Secr3t!"
    )
    tokens = AuthenticationService.authenticate_and_issue_tokens(
        identifier="ada", password="Sup3r-Secr3t!"
    )
    assert "access" in tokens
    assert "refresh" in tokens


def test_authenticate_with_wrong_password_raises():
    AuthenticationService.register_user(
        username="ada", email="ada@example.com", password="Sup3r-Secr3t!"
    )
    with pytest.raises(AuthenticationFailed):
        AuthenticationService.authenticate_and_issue_tokens(
            identifier="ada", password="wrong-password"
        )


def test_authenticate_by_email_works():
    AuthenticationService.register_user(
        username="ada", email="ada@example.com", password="Sup3r-Secr3t!"
    )
    tokens = AuthenticationService.authenticate_and_issue_tokens(
        identifier="ada@example.com", password="Sup3r-Secr3t!"
    )
    assert "access" in tokens
