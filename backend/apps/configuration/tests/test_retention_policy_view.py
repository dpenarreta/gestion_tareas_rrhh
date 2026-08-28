"""Cobertura HTTP de `/api/v1/settings/retention-policy/` — Fase 31
(ver docs/AUDIT_LOG.md § 2026-08-21), réplica de `route.ts` (solo la
política de retención, sin la ejecución de la purga)."""

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
    response = APIClient().get("/api/v1/settings/retention-policy/")
    assert response.status_code == 401


def test_get_returns_defaults():
    user = _user_with_group("analista", "ANALISTA_CC")
    response = _client_for(user).get("/api/v1/settings/retention-policy/")
    assert response.status_code == 200
    assert response.data == {
        "monthly_reports_months": "24", "archived_tasks_months": "24", "knowledge_docs_months": "indefinite",
    }


def test_put_requires_administrador():
    user = _user_with_group("jefe", "JEFE_NACIONAL")
    response = _client_for(user).put(
        "/api/v1/settings/retention-policy/", {"monthly_reports_months": "12"}, format="json"
    )
    assert response.status_code == 403


def test_put_400_for_invalid_option():
    admin = _user_with_group("admin", "ADMINISTRADOR")
    response = _client_for(admin).put(
        "/api/v1/settings/retention-policy/", {"monthly_reports_months": "999"}, format="json"
    )
    assert response.status_code == 400


def test_put_updates_partial_field():
    admin = _user_with_group("admin2", "ADMINISTRADOR")
    response = _client_for(admin).put(
        "/api/v1/settings/retention-policy/", {"knowledge_docs_months": "36"}, format="json"
    )
    assert response.status_code == 200
    assert response.data["knowledge_docs_months"] == "36"
    assert response.data["monthly_reports_months"] == "24"
