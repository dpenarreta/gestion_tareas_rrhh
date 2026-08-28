"""Cobertura HTTP de `/api/v1/settings/retroactive-window/` — Fase 28
(ver docs/AUDIT_LOG.md § 2026-08-20), réplica de `route.ts`."""

import pytest
from django.contrib.auth.models import Group
from rest_framework.test import APIClient

from apps.configuration.services import CONFIG_KEY_RETROACTIVE_WINDOW_DAYS, set_config_value
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


def test_requires_authentication():
    response = APIClient().get("/api/v1/settings/retroactive-window/")
    assert response.status_code == 401


def test_default_value_for_any_authenticated_role():
    user = _user_with_group("asist", "ASISTENTE_GH")
    response = _client_for(user).get("/api/v1/settings/retroactive-window/")
    assert response.status_code == 200
    assert response.data["days"] == 2


def test_reflects_configured_value():
    user = _user_with_group("analista", "ANALISTA_CC")
    set_config_value(CONFIG_KEY_RETROACTIVE_WINDOW_DAYS, "5", user)
    response = _client_for(user).get("/api/v1/settings/retroactive-window/")
    assert response.data["days"] == 5
