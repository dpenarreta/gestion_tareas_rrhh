"""Cobertura HTTP de `/api/v1/settings/system-info/` — Fase 32 (ver
docs/AUDIT_LOG.md § 2026-08-21), réplica de `route.ts`."""

import pytest
from django.contrib.auth.models import Group
from rest_framework.test import APIClient

from apps.tasks.models import Task
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


def test_requires_authentication():
    response = APIClient().get("/api/v1/settings/system-info/")
    assert response.status_code == 401


def test_requires_administrador():
    user = _user_with_group("jefe", "JEFE_NACIONAL")
    response = _client_for(user).get("/api/v1/settings/system-info/")
    assert response.status_code == 403


def test_returns_version_and_counts():
    admin = _user_with_group("admin", "ADMINISTRADOR")
    Task.objects.create(
        title="T", priority=Task.Priority.MEDIA, frequency=Task.Frequency.PUNTUAL, type=Task.Type.FIJA,
        start_date="2026-01-01T00:00:00Z", end_date="2026-01-05T00:00:00Z", estimated_hours=5,
        assigned_to=admin, created_by=admin, status=Task.Status.PENDIENTE,
    )

    response = _client_for(admin).get("/api/v1/settings/system-info/")
    assert response.status_code == 200
    assert "version" in response.data
    assert response.data["total_users"] == 1
    assert response.data["total_tasks"] == 1
    assert response.data["total_meetings"] == 0
    assert response.data["total_ideas"] == 0
    assert "server_started_at" in response.data
