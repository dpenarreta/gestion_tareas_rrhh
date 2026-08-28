"""Prueba del flujo bcrypt-import → login → re-hash a Argon2 del comando
`migrate_users_from_postgres` (ver plan de Fase 1 de la migración de stack).
Nunca se conecta a un Postgres real: se simula la fila que el comando leería
de la tabla `User` legacy, mockeando `psycopg2.connect`."""

from unittest import mock

import bcrypt
import pytest
from django.contrib.auth import authenticate
from django.core.management import call_command
from django.utils import timezone

from apps.users.models import User

LEGACY_ID = "cklegacyuser0001"
LEGACY_EMAIL = "legacy.user@nexo.local"
LEGACY_PLAIN_PASSWORD = "Legacy1234!"


def _legacy_row() -> dict:
    hashed = bcrypt.hashpw(LEGACY_PLAIN_PASSWORD.encode(), bcrypt.gensalt(rounds=10)).decode()
    return {
        "id": LEGACY_ID,
        "email": LEGACY_EMAIL,
        "name": "Usuario Legacy",
        "password": hashed,
        "role": "ANALISTA_CC",
        "createdAt": timezone.now().replace(tzinfo=None),
    }


def _mock_postgres_connection(rows: list[dict]):
    fake_cursor = mock.MagicMock()
    fake_cursor.__enter__.return_value = fake_cursor
    fake_cursor.__exit__.return_value = False
    fake_cursor.fetchall.return_value = rows
    fake_connection = mock.MagicMock()
    fake_connection.cursor.return_value = fake_cursor
    return fake_connection


@pytest.mark.django_db
def test_import_creates_user_verifiable_with_original_password_then_rehashes_to_argon2(settings):
    settings.LEGACY_POSTGRES_URL = "postgresql://fake-host/fake-db"
    row = _legacy_row()

    with mock.patch("psycopg2.connect", return_value=_mock_postgres_connection([row])):
        call_command("migrate_users_from_postgres")

    user = User.objects.get(legacy_postgres_id=LEGACY_ID)
    assert user.email == LEGACY_EMAIL
    assert user.password.startswith("bcrypt$")
    assert list(user.groups.values_list("name", flat=True)) == ["ANALISTA_CC"]
    assert user.is_superuser is False

    authenticated = authenticate(username=LEGACY_EMAIL, password=LEGACY_PLAIN_PASSWORD)
    assert authenticated is not None

    user.refresh_from_db()
    assert user.password.startswith("argon2")


@pytest.mark.django_db
def test_import_is_idempotent_and_never_overwrites_an_already_rehashed_password(settings):
    settings.LEGACY_POSTGRES_URL = "postgresql://fake-host/fake-db"
    row = _legacy_row()

    with mock.patch("psycopg2.connect", return_value=_mock_postgres_connection([row])):
        call_command("migrate_users_from_postgres")

    authenticate(username=LEGACY_EMAIL, password=LEGACY_PLAIN_PASSWORD)
    rehashed_password = User.objects.get(legacy_postgres_id=LEGACY_ID).password
    assert rehashed_password.startswith("argon2")

    with mock.patch("psycopg2.connect", return_value=_mock_postgres_connection([row])):
        call_command("migrate_users_from_postgres")

    assert User.objects.filter(legacy_postgres_id=LEGACY_ID).count() == 1
    assert User.objects.get(legacy_postgres_id=LEGACY_ID).password == rehashed_password


@pytest.mark.django_db
def test_import_fails_loudly_when_role_has_no_seeded_group(settings):
    settings.LEGACY_POSTGRES_URL = "postgresql://fake-host/fake-db"
    row = _legacy_row()
    row["id"] = "cklegacyuser0002"
    row["email"] = "otro.legacy@nexo.local"
    row["role"] = "ROL_INEXISTENTE"

    with mock.patch("psycopg2.connect", return_value=_mock_postgres_connection([row])):
        call_command("migrate_users_from_postgres")

    assert not User.objects.filter(legacy_postgres_id="cklegacyuser0002").exists()
