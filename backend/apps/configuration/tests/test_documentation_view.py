"""Cobertura HTTP de `/api/v1/settings/documentation/` — Fase 33 (ver
docs/AUDIT_LOG.md § 2026-08-21), réplica de `route.ts`."""

from pathlib import Path

import pytest
from django.conf import settings as django_settings
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


def test_requires_authentication():
    response = APIClient().get("/api/v1/settings/documentation/?doc=version")
    assert response.status_code == 401


def test_requires_administrador():
    user = _user_with_group("jefe", "JEFE_NACIONAL")
    response = _client_for(user).get("/api/v1/settings/documentation/?doc=version")
    assert response.status_code == 403


def test_400_for_unknown_doc_key():
    admin = _user_with_group("admin", "ADMINISTRADOR")
    response = _client_for(admin).get("/api/v1/settings/documentation/?doc=no_existe")
    assert response.status_code == 400


def test_400_for_missing_doc_param():
    admin = _user_with_group("admin2", "ADMINISTRADOR")
    response = _client_for(admin).get("/api/v1/settings/documentation/")
    assert response.status_code == 400


def test_returns_actual_file_content_for_known_doc():
    admin = _user_with_group("admin3", "ADMINISTRADOR")
    response = _client_for(admin).get("/api/v1/settings/documentation/?doc=version")
    assert response.status_code == 200

    expected_path = Path(django_settings.BASE_DIR).parent / "docs" / "VERSION.md"
    assert response.data["content"] == expected_path.read_text(encoding="utf-8")
    assert "updated_at" in response.data
