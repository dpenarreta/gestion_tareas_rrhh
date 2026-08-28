"""Cobertura HTTP de `/api/v1/settings/normalization-curves/` — Fase 32
(ver docs/AUDIT_LOG.md § 2026-08-21), réplica de `route.ts`."""

import pytest
from django.contrib.auth.models import Group
from rest_framework.test import APIClient

from apps.analytics.normalization import DEFAULT_CURVES
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
    response = APIClient().get("/api/v1/settings/normalization-curves/")
    assert response.status_code == 401


def test_get_returns_defaults():
    user = _user_with_group("analista", "ANALISTA_CC")
    response = _client_for(user).get("/api/v1/settings/normalization-curves/")
    assert response.status_code == 200
    assert response.data["curves"] == DEFAULT_CURVES
    assert response.data["defaults"] == DEFAULT_CURVES


def test_patch_requires_can_manage_users():
    user = _user_with_group("analista2", "ANALISTA_CC")
    response = _client_for(user).patch(
        "/api/v1/settings/normalization-curves/",
        {"name": "carga", "points": [{"x": 0, "y": 0}, {"x": 100, "y": 100}]},
        format="json",
    )
    assert response.status_code == 403


def test_patch_400_for_unknown_curve_name():
    admin = _user_with_group("admin", "ADMINISTRADOR")
    response = _client_for(admin).patch(
        "/api/v1/settings/normalization-curves/",
        {"name": "no_existe", "points": [{"x": 0, "y": 0}, {"x": 100, "y": 100}]},
        format="json",
    )
    assert response.status_code == 400


def test_patch_400_for_invalid_points():
    admin = _user_with_group("admin2", "ADMINISTRADOR")
    response = _client_for(admin).patch(
        "/api/v1/settings/normalization-curves/", {"name": "carga", "points": [{"x": 0, "y": 0}]}, format="json"
    )
    assert response.status_code == 400


def test_patch_updates_curve_and_persists():
    admin = _user_with_group("admin3", "ADMINISTRADOR")
    new_points = [{"x": 0, "y": 10}, {"x": 100, "y": 90}]
    response = _client_for(admin).patch(
        "/api/v1/settings/normalization-curves/", {"name": "cumplimiento", "points": new_points}, format="json"
    )
    assert response.status_code == 200
    assert response.data["curves"]["cumplimiento"] == new_points
    assert response.data["curves"]["carga"] == DEFAULT_CURVES["carga"]

    get_response = _client_for(admin).get("/api/v1/settings/normalization-curves/")
    assert get_response.data["curves"]["cumplimiento"] == new_points
