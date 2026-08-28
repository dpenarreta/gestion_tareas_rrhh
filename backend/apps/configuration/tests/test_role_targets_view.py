"""Cobertura HTTP de `/api/v1/settings/role-targets/` — Fase 28 (ver
docs/AUDIT_LOG.md § 2026-08-20), réplica de `route.ts`."""

import pytest
from django.contrib.auth.models import Group
from rest_framework.test import APIClient

from apps.hierarchy.services import ALL_ROLES
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
    response = APIClient().get("/api/v1/settings/role-targets/")
    assert response.status_code == 401


def test_get_lists_all_roles_with_no_targets_by_default():
    user = _user_with_group("analista", "ANALISTA_CC")
    response = _client_for(user).get("/api/v1/settings/role-targets/")
    assert response.status_code == 200
    assert set(response.data["roles"]) == set(ALL_ROLES)
    assert response.data["targets"]["ANALISTA_CC"] is None
    assert response.data["role_labels"]["ANALISTA_CC"] == "Analista Clima y Cultura"


def test_patch_403_for_non_manager():
    user = _user_with_group("analista2", "ANALISTA_CC")
    body = {"role": "ANALISTA_CC", "target": {"performance": 85, "riesgo_max": 40, "cumplimiento": 90}}
    response = _client_for(user).patch("/api/v1/settings/role-targets/", body, format="json")
    assert response.status_code == 403


def test_patch_400_for_out_of_range_value():
    coord = _user_with_group("coord", "COORDINADOR_NACIONAL")
    body = {"role": "ANALISTA_CC", "target": {"performance": 150, "riesgo_max": None, "cumplimiento": None}}
    response = _client_for(coord).patch("/api/v1/settings/role-targets/", body, format="json")
    assert response.status_code == 400


def test_patch_updates_target_for_coordinador_nacional():
    coord = _user_with_group("coord2", "COORDINADOR_NACIONAL")
    body = {"role": "ANALISTA_CC", "target": {"performance": 85, "riesgo_max": 40, "cumplimiento": 90}}
    response = _client_for(coord).patch("/api/v1/settings/role-targets/", body, format="json")
    assert response.status_code == 200
    assert response.data["targets"]["ANALISTA_CC"] == {"performance": 85, "riesgo_max": 40, "cumplimiento": 90}

    get_response = _client_for(coord).get("/api/v1/settings/role-targets/")
    assert get_response.data["targets"]["ANALISTA_CC"] == {"performance": 85, "riesgo_max": 40, "cumplimiento": 90}


def test_patch_allows_null_fields():
    admin = _user_with_group("admin", "ADMINISTRADOR")
    body = {"role": "JEFE_NACIONAL", "target": {"performance": None, "riesgo_max": None, "cumplimiento": None}}
    response = _client_for(admin).patch("/api/v1/settings/role-targets/", body, format="json")
    assert response.status_code == 200
    assert response.data["targets"]["JEFE_NACIONAL"] == {"performance": None, "riesgo_max": None, "cumplimiento": None}
