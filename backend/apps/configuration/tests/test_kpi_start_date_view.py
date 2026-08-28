"""Cobertura HTTP de `/api/v1/settings/kpi-start-date/` — Fase 31 (ver
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
    user = User.objects.create_user(
        username=username, email=f"{username}@example.com", password="Sup3r-Secr3t!", first_name="Ana"
    )
    user.groups.set([Group.objects.get(name=group_name)])
    return user


def test_get_requires_authentication():
    response = APIClient().get("/api/v1/settings/kpi-start-date/")
    assert response.status_code == 401


def test_get_requires_administrador():
    user = _user_with_group("jefe", "JEFE_NACIONAL")
    response = _client_for(user).get("/api/v1/settings/kpi-start-date/")
    assert response.status_code == 403


def test_get_lists_users_with_kpi_start_date():
    admin = _user_with_group("admin", "ADMINISTRADOR")
    target = _user_with_group("analista", "ANALISTA_CC")
    response = _client_for(admin).get("/api/v1/settings/kpi-start-date/")
    assert response.status_code == 200
    entry = next(u for u in response.data if u["id"] == target.id)
    assert entry["name"] == "Ana"
    assert entry["role"] == "ANALISTA_CC"
    assert entry["kpi_start_date"] is None


def test_patch_requires_administrador():
    user = _user_with_group("jefe2", "JEFE_NACIONAL")
    target = _user_with_group("analista2", "ANALISTA_CC")
    response = _client_for(user).patch(
        "/api/v1/settings/kpi-start-date/", {"user_id": target.id, "kpi_start_date": "2026-01-01"}, format="json"
    )
    assert response.status_code == 403


def test_patch_400_for_missing_user_id():
    admin = _user_with_group("admin2", "ADMINISTRADOR")
    response = _client_for(admin).patch(
        "/api/v1/settings/kpi-start-date/", {"kpi_start_date": "2026-01-01"}, format="json"
    )
    assert response.status_code == 400


def test_patch_404_for_unknown_user():
    admin = _user_with_group("admin3", "ADMINISTRADOR")
    response = _client_for(admin).patch(
        "/api/v1/settings/kpi-start-date/", {"user_id": 999999, "kpi_start_date": "2026-01-01"}, format="json"
    )
    assert response.status_code == 404


def test_patch_sets_kpi_start_date():
    admin = _user_with_group("admin4", "ADMINISTRADOR")
    target = _user_with_group("analista3", "ANALISTA_CC")
    response = _client_for(admin).patch(
        "/api/v1/settings/kpi-start-date/", {"user_id": target.id, "kpi_start_date": "2026-03-15"}, format="json"
    )
    assert response.status_code == 200
    assert response.data["kpi_start_date"] == "2026-03-15"
    target.refresh_from_db()
    assert target.kpi_start_date is not None


def test_patch_clears_kpi_start_date_with_null():
    admin = _user_with_group("admin5", "ADMINISTRADOR")
    target = _user_with_group("analista4", "ANALISTA_CC")
    _client_for(admin).patch(
        "/api/v1/settings/kpi-start-date/", {"user_id": target.id, "kpi_start_date": "2026-03-15"}, format="json"
    )
    response = _client_for(admin).patch(
        "/api/v1/settings/kpi-start-date/", {"user_id": target.id, "kpi_start_date": None}, format="json"
    )
    assert response.status_code == 200
    assert response.data["kpi_start_date"] is None
    target.refresh_from_db()
    assert target.kpi_start_date is None
