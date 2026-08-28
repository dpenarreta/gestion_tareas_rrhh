"""Cobertura HTTP de `/api/v1/settings/welcome-message/` — Fase 28 (ver
docs/AUDIT_LOG.md § 2026-08-20), réplica de `route.ts`."""

import pytest
from django.contrib.auth.models import Group
from rest_framework.test import APIClient

from apps.configuration.models import SystemConfigHistory
from apps.configuration.services import CONFIG_KEY_WELCOME_MESSAGE
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
    response = APIClient().get("/api/v1/settings/welcome-message/")
    assert response.status_code == 401


def test_get_defaults_to_empty_and_inactive():
    user = _user_with_group("analista", "ANALISTA_CC")
    response = _client_for(user).get("/api/v1/settings/welcome-message/")
    assert response.status_code == 200
    assert response.data == {"message": "", "active": False}


def test_put_403_for_non_administrator():
    user = _user_with_group("jefe", "JEFE_NACIONAL")
    response = _client_for(user).put(
        "/api/v1/settings/welcome-message/", {"message": "Hola", "active": True}, format="json"
    )
    assert response.status_code == 403


def test_put_400_for_invalid_body():
    admin = _user_with_group("admin", "ADMINISTRADOR")
    response = _client_for(admin).put("/api/v1/settings/welcome-message/", {"message": "Hola"}, format="json")
    assert response.status_code == 400


def test_put_updates_message_and_active_for_administrator():
    admin = _user_with_group("admin2", "ADMINISTRADOR")
    response = _client_for(admin).put(
        "/api/v1/settings/welcome-message/", {"message": "  Bienvenido al equipo  ", "active": True}, format="json"
    )
    assert response.status_code == 200
    assert response.data == {"message": "Bienvenido al equipo", "active": True}
    assert SystemConfigHistory.objects.filter(key=CONFIG_KEY_WELCOME_MESSAGE, value="Bienvenido al equipo").exists()

    get_response = _client_for(admin).get("/api/v1/settings/welcome-message/")
    assert get_response.data == {"message": "Bienvenido al equipo", "active": True}
