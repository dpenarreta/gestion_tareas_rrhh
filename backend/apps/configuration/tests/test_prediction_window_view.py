"""Cobertura HTTP de `/api/v1/settings/prediction-window/` — Fase 13
(ver docs/AUDIT_LOG.md § 2026-08-19), réplica de `route.ts`
(`src/app/api/settings/prediction-window/route.ts`)."""

import pytest
from django.contrib.auth.models import Group
from rest_framework.test import APIClient

from apps.configuration.models import SystemConfigHistory
from apps.configuration.services import CONFIG_KEY_PREDICTION_WINDOW_WEEKS
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
    response = APIClient().get("/api/v1/settings/prediction-window/")
    assert response.status_code == 401


def test_get_returns_default_and_options_for_any_authenticated_user():
    user = _user_with_group("analista", "ANALISTA_CC")
    response = _client_for(user).get("/api/v1/settings/prediction-window/")
    assert response.status_code == 200
    assert response.data["window_weeks"] == "3"
    assert response.data["options"] == ["3", "4", "6", "8", "12"]


def test_put_403_for_non_administrator():
    user = _user_with_group("jefe", "JEFE_NACIONAL")
    response = _client_for(user).put("/api/v1/settings/prediction-window/", {"window_weeks": "6"}, format="json")
    assert response.status_code == 403


def test_put_400_for_invalid_window():
    admin = _user_with_group("admin", "ADMINISTRADOR")
    response = _client_for(admin).put("/api/v1/settings/prediction-window/", {"window_weeks": "5"}, format="json")
    assert response.status_code == 400


def test_put_updates_effective_window_for_administrator():
    admin = _user_with_group("admin2", "ADMINISTRADOR")
    response = _client_for(admin).put("/api/v1/settings/prediction-window/", {"window_weeks": "8"}, format="json")
    assert response.status_code == 200
    assert response.data["window_weeks"] == "8"
    assert SystemConfigHistory.objects.filter(key=CONFIG_KEY_PREDICTION_WINDOW_WEEKS, value="8").exists()

    # Un GET posterior refleja el nuevo valor efectivo.
    get_response = _client_for(admin).get("/api/v1/settings/prediction-window/")
    assert get_response.data["window_weeks"] == "8"


def test_put_allows_superuser_without_group():
    superuser = User.objects.create_user(username="root", email="root@example.com", password="Sup3r-Secr3t!")
    superuser.is_superuser = True
    superuser.save()
    response = _client_for(superuser).put("/api/v1/settings/prediction-window/", {"window_weeks": "4"}, format="json")
    assert response.status_code == 200
