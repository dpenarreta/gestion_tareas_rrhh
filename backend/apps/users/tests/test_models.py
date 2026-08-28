import pytest

from apps.users.models import User

pytestmark = pytest.mark.django_db


def test_create_user_hashes_password():
    user = User.objects.create_user(
        username="ada", email="ada@example.com", password="Sup3r-Secr3t!"
    )
    assert user.password != "Sup3r-Secr3t!"
    assert user.check_password("Sup3r-Secr3t!")


def test_password_hash_uses_argon2():
    user = User.objects.create_user(
        username="grace", email="grace@example.com", password="Sup3r-Secr3t!"
    )
    assert user.password.startswith("argon2$")


def test_badges_and_view_preferences_defaults():
    user = User.objects.create_user(username="hedy", email="hedy@example.com", password="Sup3r-Secr3t!")
    assert user.badges == []
    assert user.view_preferences == ["KANBAN", "TABLA"]
    assert user.last_login is None
