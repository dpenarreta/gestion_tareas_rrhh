"""Cobertura HTTP de `apps.users.self_service_views` — Fase 26 (ver
docs/AUDIT_LOG.md § 2026-08-20), réplica de `src/app/api/users/
assignable/route.ts` y `src/app/api/users/[id]/theme/route.ts`."""

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
def coordinador_nacional():
    user = User.objects.create_user(username="coord_nac", email="coord_nac@example.com", password="Sup3r-Secr3t!")
    user.groups.set([Group.objects.get(name="COORDINADOR_NACIONAL")])
    return user


@pytest.fixture
def analista():
    user = User.objects.create_user(username="analista", email="analista@example.com", password="Sup3r-Secr3t!", first_name="Ana")
    user.groups.set([Group.objects.get(name="ANALISTA_CC")])
    return user


@pytest.fixture
def jefe_nacional():
    user = User.objects.create_user(username="jefe", email="jefe@example.com", password="Sup3r-Secr3t!")
    user.groups.set([Group.objects.get(name="JEFE_NACIONAL")])
    return user


# --- GET /users/assignable/ ---------------------------------------------------------------


def test_assignable_requires_authentication():
    response = APIClient().get("/api/v1/users/assignable/")
    assert response.status_code == 401


def test_assignable_includes_self_and_visible_subordinate(coordinador_nacional, analista):
    response = _client_for(coordinador_nacional).get("/api/v1/users/assignable/")
    assert response.status_code == 200
    ids = {u["id"] for u in response.data}
    assert coordinador_nacional.id in ids
    assert analista.id in ids
    entry = next(u for u in response.data if u["id"] == analista.id)
    assert entry["name"] == "Ana"
    assert entry["email"] == "analista@example.com"
    assert entry["role"] == "ANALISTA_CC"


def test_assignable_excludes_non_visible(coordinador_nacional, jefe_nacional):
    response = _client_for(coordinador_nacional).get("/api/v1/users/assignable/")
    assert jefe_nacional.id not in [u["id"] for u in response.data]


# --- PATCH /users/<id>/theme/ -------------------------------------------------------------


def test_theme_requires_authentication():
    response = APIClient().patch("/api/v1/users/1/theme/", {"theme": "DARK"}, format="json")
    assert response.status_code == 401


def test_theme_requires_self(analista, coordinador_nacional):
    response = _client_for(analista).patch(
        f"/api/v1/users/{coordinador_nacional.id}/theme/", {"theme": "DARK"}, format="json"
    )
    assert response.status_code == 403


def test_theme_rejects_invalid_value(analista):
    response = _client_for(analista).patch(f"/api/v1/users/{analista.id}/theme/", {"theme": "PURPLE"}, format="json")
    assert response.status_code == 400


def test_theme_updates_own_preference(analista):
    response = _client_for(analista).patch(f"/api/v1/users/{analista.id}/theme/", {"theme": "DARK"}, format="json")
    assert response.status_code == 200
    assert response.data["theme"] == "DARK"
    analista.refresh_from_db()
    assert analista.theme == "DARK"


def test_theme_defaults_to_light():
    user = User.objects.create_user(username="defaults", email="defaults@example.com", password="Sup3r-Secr3t!")
    assert user.theme == "LIGHT"


# --- GET/PATCH /users/<id>/view-preferences/ ------------------------------------------------


def test_view_preferences_get_requires_authentication():
    response = APIClient().get("/api/v1/users/1/view-preferences/")
    assert response.status_code == 401


def test_view_preferences_get_requires_self(analista, coordinador_nacional):
    response = _client_for(analista).get(f"/api/v1/users/{coordinador_nacional.id}/view-preferences/")
    assert response.status_code == 403


def test_view_preferences_get_returns_own_array(analista):
    analista.view_preferences = ["KANBAN", "ACTIVITY_FORMAT:timerange"]
    analista.save(update_fields=["view_preferences"])
    response = _client_for(analista).get(f"/api/v1/users/{analista.id}/view-preferences/")
    assert response.status_code == 200
    assert response.data["view_preferences"] == ["KANBAN", "ACTIVITY_FORMAT:timerange"]


def test_view_preferences_requires_authentication():
    response = APIClient().patch("/api/v1/users/1/view-preferences/", {"viewPreferences": ["KANBAN"]}, format="json")
    assert response.status_code == 401


def test_view_preferences_requires_self(analista, coordinador_nacional):
    response = _client_for(analista).patch(
        f"/api/v1/users/{coordinador_nacional.id}/view-preferences/", {"viewPreferences": ["KANBAN"]}, format="json"
    )
    assert response.status_code == 403


def test_view_preferences_rejects_empty_array(analista):
    response = _client_for(analista).patch(
        f"/api/v1/users/{analista.id}/view-preferences/", {"viewPreferences": []}, format="json"
    )
    assert response.status_code == 400


def test_view_preferences_replaces_the_whole_array(analista):
    """Réplica fiel de un bug preexistente del TS legacy (ver
    docs/AUDIT_LOG.md § 2026-08-25, Fase 55): NO fusiona con otras
    claves de prefijo que convivan en el mismo array."""
    analista.view_preferences = ["KANBAN", "ACTIVITY_FORMAT:timerange", "DASHBOARD_CARDS:stats,tasks"]
    analista.save(update_fields=["view_preferences"])

    response = _client_for(analista).patch(
        f"/api/v1/users/{analista.id}/view-preferences/", {"viewPreferences": ["KANBAN", "TABLA"]}, format="json"
    )
    assert response.status_code == 200
    assert response.data["view_preferences"] == ["KANBAN", "TABLA"]
    analista.refresh_from_db()
    assert analista.view_preferences == ["KANBAN", "TABLA"]


# --- GET/PATCH /users/activity-format/ ------------------------------------------------------


def test_activity_format_requires_authentication():
    response = APIClient().get("/api/v1/users/activity-format/")
    assert response.status_code == 401


def test_activity_format_defaults_to_duration(analista):
    response = _client_for(analista).get("/api/v1/users/activity-format/")
    assert response.status_code == 200
    assert response.data["activity_format"] == "duration"


def test_activity_format_reads_existing_preference(analista):
    analista.view_preferences = ["KANBAN", "ACTIVITY_FORMAT:timerange"]
    analista.save(update_fields=["view_preferences"])
    response = _client_for(analista).get("/api/v1/users/activity-format/")
    assert response.data["activity_format"] == "timerange"


def test_activity_format_rejects_invalid_value(analista):
    response = _client_for(analista).patch(
        "/api/v1/users/activity-format/", {"activity_format": "invalid"}, format="json"
    )
    assert response.status_code == 400


def test_activity_format_updates_preserving_other_prefixed_keys(analista):
    analista.view_preferences = ["KANBAN", "ACTIVITY_FORMAT:duration", "DASHBOARD_CARDS:stats,tasks"]
    analista.save(update_fields=["view_preferences"])

    response = _client_for(analista).patch(
        "/api/v1/users/activity-format/", {"activity_format": "timerange"}, format="json"
    )
    assert response.status_code == 200
    assert response.data["activity_format"] == "timerange"
    analista.refresh_from_db()
    assert set(analista.view_preferences) == {"KANBAN", "ACTIVITY_FORMAT:timerange", "DASHBOARD_CARDS:stats,tasks"}
