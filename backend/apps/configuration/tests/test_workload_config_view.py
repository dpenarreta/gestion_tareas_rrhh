"""Cobertura HTTP de `/api/v1/settings/workload-config/` — Fase 31 (ver
docs/AUDIT_LOG.md § 2026-08-21), réplica de `route.ts`."""

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
    response = APIClient().get("/api/v1/settings/workload-config/")
    assert response.status_code == 401


def test_get_returns_defaults():
    user = _user_with_group("analista", "ANALISTA_CC")
    response = _client_for(user).get("/api/v1/settings/workload-config/")
    assert response.status_code == 200
    assert response.data == {
        "hours_per_day": 6.5, "workload_limit_low": 5.5, "workload_limit_high": 7.5, "workload_limit_overload": 8.5,
    }


def test_put_requires_administrador():
    user = _user_with_group("jefe", "JEFE_NACIONAL")
    response = _client_for(user).put("/api/v1/settings/workload-config/", {"hours_per_day": 7}, format="json")
    assert response.status_code == 403


def test_put_400_for_empty_body():
    admin = _user_with_group("admin", "ADMINISTRADOR")
    response = _client_for(admin).put("/api/v1/settings/workload-config/", {}, format="json")
    assert response.status_code == 400


def test_put_400_for_out_of_range_hours():
    admin = _user_with_group("admin2", "ADMINISTRADOR")
    response = _client_for(admin).put("/api/v1/settings/workload-config/", {"hours_per_day": 10}, format="json")
    assert response.status_code == 400


def test_put_400_for_invalid_ordering():
    admin = _user_with_group("admin3", "ADMINISTRADOR")
    response = _client_for(admin).put(
        "/api/v1/settings/workload-config/", {"workload_limit_low": 8}, format="json"
    )
    assert response.status_code == 400


def test_put_updates_partial_field_and_keeps_others():
    admin = _user_with_group("admin4", "ADMINISTRADOR")
    response = _client_for(admin).put("/api/v1/settings/workload-config/", {"hours_per_day": 7}, format="json")
    assert response.status_code == 200
    assert response.data["hours_per_day"] == 7
    assert response.data["workload_limit_low"] == 5.5

    get_response = _client_for(admin).get("/api/v1/settings/workload-config/")
    assert get_response.data["hours_per_day"] == 7
