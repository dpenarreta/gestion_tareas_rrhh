"""Cobertura HTTP de `/api/v1/settings/config-history/` y
`/restore-default/` — Fase 33 (ver docs/AUDIT_LOG.md § 2026-08-21),
réplica de `route.ts`/`restore-default/route.ts`."""

import pytest
from django.contrib.auth.models import Group
from rest_framework.test import APIClient

from apps.configuration.models import SystemConfigHistory
from apps.configuration.services import set_config_value
from apps.users.models import User

pytestmark = pytest.mark.django_db


def _client_for(user: User) -> APIClient:
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def _user_with_group(username: str, group_name: str) -> User:
    user = User.objects.create_user(
        username=username, email=f"{username}@example.com", password="Sup3r-Secr3t!", first_name="Ana"
    )
    user.groups.set([Group.objects.get(name=group_name)])
    return user


# --- GET /settings/config-history/ --------------------------------------------------------


def test_get_requires_authentication():
    response = APIClient().get("/api/v1/settings/config-history/?keys=workload_limit_low")
    assert response.status_code == 401


def test_get_requires_administrador():
    user = _user_with_group("jefe", "JEFE_NACIONAL")
    response = _client_for(user).get("/api/v1/settings/config-history/?keys=workload_limit_low")
    assert response.status_code == 403


def test_get_400_without_keys():
    admin = _user_with_group("admin", "ADMINISTRADOR")
    response = _client_for(admin).get("/api/v1/settings/config-history/")
    assert response.status_code == 400


def test_get_returns_history_for_requested_keys():
    admin = _user_with_group("admin2", "ADMINISTRADOR")
    set_config_value("workload_limit_low", "5", admin)
    set_config_value("workload_limit_low", "6", admin)
    set_config_value("workload_limit_high", "8", admin)

    response = _client_for(admin).get("/api/v1/settings/config-history/?keys=workload_limit_low")
    assert response.status_code == 200
    assert len(response.data) == 2
    assert all(r["key"] == "workload_limit_low" for r in response.data)
    assert response.data[0]["updated_by_name"] == "Ana"
    # Más reciente primero.
    assert response.data[0]["value"] == "6"
    assert response.data[0]["valid_until"] is None
    assert response.data[1]["valid_until"] is not None


# --- POST /settings/config-history/restore-default/ ---------------------------------------


def test_restore_requires_administrador():
    user = _user_with_group("jefe2", "JEFE_NACIONAL")
    response = _client_for(user).post(
        "/api/v1/settings/config-history/restore-default/", {"defaults": {"workload_limit_low": "5.5"}}, format="json"
    )
    assert response.status_code == 403


def test_restore_400_without_defaults():
    admin = _user_with_group("admin3", "ADMINISTRADOR")
    response = _client_for(admin).post(
        "/api/v1/settings/config-history/restore-default/", {"defaults": {}}, format="json"
    )
    assert response.status_code == 400


def test_restore_writes_each_key():
    admin = _user_with_group("admin4", "ADMINISTRADOR")
    set_config_value("workload_limit_low", "6", admin)

    response = _client_for(admin).post(
        "/api/v1/settings/config-history/restore-default/",
        {"defaults": {"workload_limit_low": "5.5", "workload_limit_high": "7.5"}},
        format="json",
    )
    assert response.status_code == 200
    assert SystemConfigHistory.objects.filter(
        key="workload_limit_low", value="5.5", valid_until__isnull=True
    ).exists()
    assert SystemConfigHistory.objects.filter(
        key="workload_limit_high", value="7.5", valid_until__isnull=True
    ).exists()
