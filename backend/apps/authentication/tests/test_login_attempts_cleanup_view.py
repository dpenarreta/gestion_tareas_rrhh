"""Cobertura HTTP de `/api/v1/settings/login-attempts/cleanup/` — Fase
33 (ver docs/AUDIT_LOG.md § 2026-08-21), réplica ADAPTADA de
`route.ts` (el `LoginAttempt` de Django es un log por evento, no un
contador agregado por IP como en el TS — ver docstring de
`count_expired_login_attempts`/`cleanup_expired_login_attempts`)."""

from datetime import timedelta

import pytest
from django.contrib.auth.models import Group
from django.utils import timezone
from rest_framework.test import APIClient

from apps.authentication.models import LoginAttempt
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


def _attempt_aged(days_old: int) -> LoginAttempt:
    attempt = LoginAttempt.objects.create(identifier="alguien@example.com", successful=False)
    LoginAttempt.objects.filter(pk=attempt.pk).update(created_at=timezone.now() - timedelta(days=days_old))
    return attempt


def test_get_requires_authentication():
    response = APIClient().get("/api/v1/settings/login-attempts/cleanup/")
    assert response.status_code == 401


def test_get_requires_administrador():
    user = _user_with_group("jefe", "JEFE_NACIONAL")
    response = _client_for(user).get("/api/v1/settings/login-attempts/cleanup/")
    assert response.status_code == 403


def test_get_counts_only_attempts_older_than_retention():
    admin = _user_with_group("admin", "ADMINISTRADOR")
    _attempt_aged(40)
    _attempt_aged(10)

    response = _client_for(admin).get("/api/v1/settings/login-attempts/cleanup/")
    assert response.status_code == 200
    assert response.data["expired_count"] == 1


def test_post_requires_administrador():
    user = _user_with_group("jefe2", "JEFE_NACIONAL")
    response = _client_for(user).post("/api/v1/settings/login-attempts/cleanup/")
    assert response.status_code == 403


def test_post_deletes_only_expired_attempts():
    admin = _user_with_group("admin2", "ADMINISTRADOR")
    old = _attempt_aged(40)
    recent = _attempt_aged(10)

    response = _client_for(admin).post("/api/v1/settings/login-attempts/cleanup/")
    assert response.status_code == 200
    assert response.data["deleted"] == 1
    assert not LoginAttempt.objects.filter(pk=old.pk).exists()
    assert LoginAttempt.objects.filter(pk=recent.pk).exists()


def test_get_preview_never_deletes():
    admin = _user_with_group("admin3", "ADMINISTRADOR")
    old = _attempt_aged(40)

    _client_for(admin).get("/api/v1/settings/login-attempts/cleanup/")
    assert LoginAttempt.objects.filter(pk=old.pk).exists()
