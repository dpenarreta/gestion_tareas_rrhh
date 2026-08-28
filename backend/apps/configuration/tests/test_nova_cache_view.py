"""Cobertura HTTP de `/api/v1/settings/nova-cache/` — Fase 34 (ver
docs/AUDIT_LOG.md § 2026-08-21), réplica de `route.ts`. Solo se porta
la configuración: Nova/Groq en sí sigue fuera de alcance."""

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
    response = APIClient().get("/api/v1/settings/nova-cache/")
    assert response.status_code == 401


def test_get_returns_default():
    user = _user_with_group("analista", "ANALISTA_CC")
    response = _client_for(user).get("/api/v1/settings/nova-cache/")
    assert response.status_code == 200
    assert response.data == {"cache_ttl_minutes": 240}


def test_put_requires_administrador():
    user = _user_with_group("jefe", "JEFE_NACIONAL")
    response = _client_for(user).put("/api/v1/settings/nova-cache/", {"cache_ttl_minutes": 60}, format="json")
    assert response.status_code == 403


def test_put_400_for_missing_field():
    admin = _user_with_group("admin", "ADMINISTRADOR")
    response = _client_for(admin).put("/api/v1/settings/nova-cache/", {}, format="json")
    assert response.status_code == 400


def test_put_400_for_out_of_range_value():
    admin = _user_with_group("admin2", "ADMINISTRADOR")
    response = _client_for(admin).put("/api/v1/settings/nova-cache/", {"cache_ttl_minutes": 20000}, format="json")
    assert response.status_code == 400


def test_put_updates_and_persists():
    admin = _user_with_group("admin3", "ADMINISTRADOR")
    response = _client_for(admin).put("/api/v1/settings/nova-cache/", {"cache_ttl_minutes": 60}, format="json")
    assert response.status_code == 200
    assert response.data == {"cache_ttl_minutes": 60}

    get_response = _client_for(admin).get("/api/v1/settings/nova-cache/")
    assert get_response.data == {"cache_ttl_minutes": 60}
