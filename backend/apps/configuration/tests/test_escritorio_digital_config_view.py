"""Cobertura HTTP de `/api/v1/settings/escritorio-digital-config/` —
Fase 31 (ver docs/AUDIT_LOG.md § 2026-08-21), réplica de `route.ts`."""

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
    response = APIClient().get("/api/v1/settings/escritorio-digital-config/")
    assert response.status_code == 401


def test_get_returns_defaults():
    user = _user_with_group("analista", "ANALISTA_CC")
    response = _client_for(user).get("/api/v1/settings/escritorio-digital-config/")
    assert response.status_code == 200
    assert response.data == {
        "archive_retention_days": 15, "max_replies": 2, "snooze_presets_minutes": [15, 30, 60, 1440],
    }


def test_put_requires_administrador():
    user = _user_with_group("jefe", "JEFE_NACIONAL")
    response = _client_for(user).put(
        "/api/v1/settings/escritorio-digital-config/", {"max_replies": 5}, format="json"
    )
    assert response.status_code == 403


def test_put_400_for_empty_body():
    admin = _user_with_group("admin", "ADMINISTRADOR")
    response = _client_for(admin).put("/api/v1/settings/escritorio-digital-config/", {}, format="json")
    assert response.status_code == 400


def test_put_400_for_out_of_range_max_replies():
    admin = _user_with_group("admin2", "ADMINISTRADOR")
    response = _client_for(admin).put(
        "/api/v1/settings/escritorio-digital-config/", {"max_replies": 30}, format="json"
    )
    assert response.status_code == 400


def test_put_400_for_empty_snooze_presets():
    admin = _user_with_group("admin3", "ADMINISTRADOR")
    response = _client_for(admin).put(
        "/api/v1/settings/escritorio-digital-config/", {"snooze_presets_minutes": []}, format="json"
    )
    assert response.status_code == 400


def test_put_updates_all_three_fields():
    admin = _user_with_group("admin4", "ADMINISTRADOR")
    response = _client_for(admin).put(
        "/api/v1/settings/escritorio-digital-config/",
        {"archive_retention_days": 30, "max_replies": 5, "snooze_presets_minutes": [10, 20]},
        format="json",
    )
    assert response.status_code == 200
    assert response.data == {"archive_retention_days": 30, "max_replies": 5, "snooze_presets_minutes": [10, 20]}

    get_response = _client_for(admin).get("/api/v1/settings/escritorio-digital-config/")
    assert get_response.data["snooze_presets_minutes"] == [10, 20]
