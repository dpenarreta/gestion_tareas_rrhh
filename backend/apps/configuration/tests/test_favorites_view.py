"""Cobertura HTTP de `/api/v1/settings/favorites/` — Fase 28 (ver
docs/AUDIT_LOG.md § 2026-08-20), réplica de `route.ts`/`configFavorites.ts`."""

import pytest
from django.contrib.auth.models import Group
from rest_framework.test import APIClient

from apps.users.models import User

pytestmark = pytest.mark.django_db


def _client_for(user: User) -> APIClient:
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.fixture
def analista():
    user = User.objects.create_user(username="analista", email="analista@example.com", password="Sup3r-Secr3t!")
    user.groups.set([Group.objects.get(name="ANALISTA_CC")])
    return user


def test_get_requires_authentication():
    response = APIClient().get("/api/v1/settings/favorites/")
    assert response.status_code == 401


def test_get_empty_by_default(analista):
    response = _client_for(analista).get("/api/v1/settings/favorites/")
    assert response.status_code == 200
    assert response.data["favorites"] == []


def test_patch_requires_setting_id_and_pinned(analista):
    response = _client_for(analista).patch("/api/v1/settings/favorites/", {"settingId": "welcome-message"}, format="json")
    assert response.status_code == 400


def test_patch_pins_a_favorite(analista):
    response = _client_for(analista).patch(
        "/api/v1/settings/favorites/", {"setting_id": "welcome-message", "pinned": True}, format="json"
    )
    assert response.status_code == 200
    get_response = _client_for(analista).get("/api/v1/settings/favorites/")
    assert get_response.data["favorites"] == ["welcome-message"]


def test_patch_unpins_a_favorite(analista):
    _client_for(analista).patch(
        "/api/v1/settings/favorites/", {"setting_id": "welcome-message", "pinned": True}, format="json"
    )
    _client_for(analista).patch(
        "/api/v1/settings/favorites/", {"setting_id": "welcome-message", "pinned": False}, format="json"
    )
    get_response = _client_for(analista).get("/api/v1/settings/favorites/")
    assert get_response.data["favorites"] == []


def test_favorites_do_not_disturb_other_view_preferences(analista):
    analista.view_preferences = ["KANBAN"]
    analista.save(update_fields=["view_preferences"])

    _client_for(analista).patch(
        "/api/v1/settings/favorites/", {"setting_id": "role-targets", "pinned": True}, format="json"
    )
    analista.refresh_from_db()
    assert analista.view_preferences == ["KANBAN", "CONFIG_FAVORITE:role-targets"]
