"""Cobertura HTTP de `/api/v1/settings/seguridad-config/` — Fase 32
(ver docs/AUDIT_LOG.md § 2026-08-21), réplica de `route.ts`."""

import pytest
from django.contrib.auth.models import Group
from rest_framework.test import APIClient

from apps.users.models import User

pytestmark = pytest.mark.django_db


def _client_for(user: User) -> APIClient:
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def _user_with_group(username: str, group_name: str) -> User:
    user = User.objects.create_user(username=username, email=f"{username}@example.com", password="Sup3r-Secr3t!")
    user.groups.set([Group.objects.get(name=group_name)])
    return user


def test_get_requires_authentication():
    response = APIClient().get("/api/v1/settings/seguridad-config/")
    assert response.status_code == 401


def test_get_returns_defaults():
    user = _user_with_group("analista", "ANALISTA_CC")
    response = _client_for(user).get("/api/v1/settings/seguridad-config/")
    assert response.status_code == 200
    assert response.data == {
        "password_min_length": 10,
        "session_duration_default_hours": 168,
        "session_duration_remember_hours": 720,
        "retention_login_attempts_days": "30",
    }


def test_put_requires_administrador():
    user = _user_with_group("jefe", "JEFE_NACIONAL")
    response = _client_for(user).put(
        "/api/v1/settings/seguridad-config/", {"password_min_length": 10}, format="json"
    )
    assert response.status_code == 403


def test_put_with_empty_body_is_a_noop_200():
    admin = _user_with_group("admin", "ADMINISTRADOR")
    response = _client_for(admin).put("/api/v1/settings/seguridad-config/", {}, format="json")
    assert response.status_code == 200
    assert response.data["password_min_length"] == 10


def test_put_400_for_out_of_range_password_min_length():
    admin = _user_with_group("admin2", "ADMINISTRADOR")
    response = _client_for(admin).put(
        "/api/v1/settings/seguridad-config/", {"password_min_length": 200}, format="json"
    )
    assert response.status_code == 400


def test_put_400_for_password_min_length_below_the_django_floor():
    """El piso configurable es 10 (Fase 75, ver docs/AUDIT_LOG.md §
    2026-08-26) — el mismo que `MinimumLengthValidator` ya impone
    siempre en `apps.authentication`, para que Ajustes no prometa un
    mínimo más permisivo del que realmente se aplica."""
    admin = _user_with_group("admin5", "ADMINISTRADOR")
    response = _client_for(admin).put(
        "/api/v1/settings/seguridad-config/", {"password_min_length": 9}, format="json"
    )
    assert response.status_code == 400


def test_put_400_for_invalid_retention_option():
    admin = _user_with_group("admin3", "ADMINISTRADOR")
    response = _client_for(admin).put(
        "/api/v1/settings/seguridad-config/", {"retention_login_attempts_days": "999"}, format="json"
    )
    assert response.status_code == 400


def test_put_updates_partial_field():
    admin = _user_with_group("admin4", "ADMINISTRADOR")
    response = _client_for(admin).put(
        "/api/v1/settings/seguridad-config/", {"password_min_length": 10}, format="json"
    )
    assert response.status_code == 200
    assert response.data["password_min_length"] == 10
    assert response.data["session_duration_default_hours"] == 168

    get_response = _client_for(admin).get("/api/v1/settings/seguridad-config/")
    assert get_response.data["password_min_length"] == 10
