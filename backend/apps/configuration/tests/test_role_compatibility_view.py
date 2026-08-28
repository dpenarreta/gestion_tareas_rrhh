"""Cobertura HTTP de `/api/v1/settings/role-compatibility/` — Fase 28
(ver docs/AUDIT_LOG.md § 2026-08-20), réplica de `route.ts`."""

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
    response = APIClient().get("/api/v1/settings/role-compatibility/")
    assert response.status_code == 401


def test_get_lists_all_roles_empty_by_default():
    user = _user_with_group("analista", "ANALISTA_CC")
    response = _client_for(user).get("/api/v1/settings/role-compatibility/")
    assert response.status_code == 200
    assert set(response.data["roles"]) == set(ALL_ROLES)
    assert response.data["matrix"]["ANALISTA_CC"] == []
    assert response.data["role_levels"]["ANALISTA_CC"] == 2


def test_patch_403_for_non_manager():
    user = _user_with_group("analista2", "ANALISTA_CC")
    response = _client_for(user).patch(
        "/api/v1/settings/role-compatibility/",
        {"role": "ANALISTA_CC", "compatible_roles": ["COORDINADOR_ZS"]},
        format="json",
    )
    assert response.status_code == 403


def test_patch_400_for_unknown_role_in_list():
    coord = _user_with_group("coord", "COORDINADOR_NACIONAL")
    response = _client_for(coord).patch(
        "/api/v1/settings/role-compatibility/",
        {"role": "ANALISTA_CC", "compatible_roles": ["NO_EXISTE"]},
        format="json",
    )
    assert response.status_code == 400


def test_patch_rejects_different_hierarchy_level():
    coord = _user_with_group("coord2", "COORDINADOR_NACIONAL")
    response = _client_for(coord).patch(
        "/api/v1/settings/role-compatibility/",
        {"role": "ANALISTA_CC", "compatible_roles": ["JEFE_NACIONAL"]},
        format="json",
    )
    assert response.status_code == 400
    assert "nivel jerárquico" in response.data["error"]


def test_patch_updates_matrix_for_same_level_roles():
    coord = _user_with_group("coord3", "COORDINADOR_NACIONAL")
    response = _client_for(coord).patch(
        "/api/v1/settings/role-compatibility/",
        {"role": "ANALISTA_CC", "compatible_roles": ["COORDINADOR_ZS"]},
        format="json",
    )
    assert response.status_code == 200
    assert response.data["matrix"]["ANALISTA_CC"] == ["COORDINADOR_ZS"]

    get_response = _client_for(coord).get("/api/v1/settings/role-compatibility/")
    assert get_response.data["matrix"]["ANALISTA_CC"] == ["COORDINADOR_ZS"]


def test_patch_strips_own_role_from_compatible_list():
    admin = _user_with_group("admin", "ADMINISTRADOR")
    response = _client_for(admin).patch(
        "/api/v1/settings/role-compatibility/",
        {"role": "ANALISTA_CC", "compatible_roles": ["ANALISTA_CC", "COORDINADOR_ZS"]},
        format="json",
    )
    assert response.status_code == 200
    assert response.data["matrix"]["ANALISTA_CC"] == ["COORDINADOR_ZS"]
