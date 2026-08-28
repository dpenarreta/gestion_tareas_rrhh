"""Cobertura HTTP de `/api/v1/settings/trabajo-avanzado/` — Fase 32
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
    response = APIClient().get("/api/v1/settings/trabajo-avanzado/")
    assert response.status_code == 401


def test_get_returns_defaults():
    user = _user_with_group("analista", "ANALISTA_CC")
    response = _client_for(user).get("/api/v1/settings/trabajo-avanzado/")
    assert response.status_code == 200
    assert response.data == {"retroactive_window_days": 2, "workday_end_hour": 17}


def test_put_requires_administrador():
    user = _user_with_group("jefe", "JEFE_NACIONAL")
    response = _client_for(user).put(
        "/api/v1/settings/trabajo-avanzado/", {"workday_end_hour": 18}, format="json"
    )
    assert response.status_code == 403


def test_put_with_empty_body_is_a_noop_200():
    admin = _user_with_group("admin", "ADMINISTRADOR")
    response = _client_for(admin).put("/api/v1/settings/trabajo-avanzado/", {}, format="json")
    assert response.status_code == 200
    assert response.data["workday_end_hour"] == 17


def test_put_400_for_out_of_range_workday_end_hour():
    admin = _user_with_group("admin2", "ADMINISTRADOR")
    response = _client_for(admin).put(
        "/api/v1/settings/trabajo-avanzado/", {"workday_end_hour": 24}, format="json"
    )
    assert response.status_code == 400


def test_put_updates_both_fields():
    admin = _user_with_group("admin3", "ADMINISTRADOR")
    response = _client_for(admin).put(
        "/api/v1/settings/trabajo-avanzado/",
        {"retroactive_window_days": 5, "workday_end_hour": 19},
        format="json",
    )
    assert response.status_code == 200
    assert response.data == {"retroactive_window_days": 5, "workday_end_hour": 19}

    get_response = _client_for(admin).get("/api/v1/settings/trabajo-avanzado/")
    assert get_response.data == {"retroactive_window_days": 5, "workday_end_hour": 19}
