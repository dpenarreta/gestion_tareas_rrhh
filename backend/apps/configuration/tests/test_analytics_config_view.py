"""Cobertura HTTP de `/api/v1/settings/analytics-config/` — Fase 31
(ver docs/AUDIT_LOG.md § 2026-08-21), réplica de `route.ts`."""

import pytest
from django.contrib.auth.models import Group
from rest_framework.test import APIClient

from apps.configuration.services import ANALYTICS_CONFIG_DEFAULTS
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
    response = APIClient().get("/api/v1/settings/analytics-config/")
    assert response.status_code == 401


def test_get_returns_defaults_and_prediction_max_days():
    user = _user_with_group("analista", "ANALISTA_CC")
    response = _client_for(user).get("/api/v1/settings/analytics-config/")
    assert response.status_code == 200
    assert response.data["config"] == ANALYTICS_CONFIG_DEFAULTS
    assert response.data["defaults"] == ANALYTICS_CONFIG_DEFAULTS
    assert response.data["prediction_max_days"] == 30


def test_patch_requires_can_manage_users():
    user = _user_with_group("analista2", "ANALISTA_CC")
    response = _client_for(user).patch(
        "/api/v1/settings/analytics-config/", {"cache_ttl_minutes": 20}, format="json"
    )
    assert response.status_code == 403


def test_patch_rejects_coordinador_zs():
    # Coordinador ZS NO está en el whitelist de canManageUsers (solo
    # ADMINISTRADOR/JEFE_NACIONAL/COORDINADOR_NACIONAL).
    user = _user_with_group("coordzs", "COORDINADOR_ZS")
    response = _client_for(user).patch(
        "/api/v1/settings/analytics-config/", {"cache_ttl_minutes": 20}, format="json"
    )
    assert response.status_code == 403


def test_patch_400_for_empty_body():
    admin = _user_with_group("admin", "ADMINISTRADOR")
    response = _client_for(admin).patch("/api/v1/settings/analytics-config/", {}, format="json")
    assert response.status_code == 400


def test_patch_400_for_unknown_key():
    admin = _user_with_group("admin2", "ADMINISTRADOR")
    response = _client_for(admin).patch(
        "/api/v1/settings/analytics-config/", {"no_existe": 5}, format="json"
    )
    assert response.status_code == 400


def test_patch_400_for_out_of_range_value():
    admin = _user_with_group("admin3", "ADMINISTRADOR")
    response = _client_for(admin).patch(
        "/api/v1/settings/analytics-config/", {"cache_ttl_minutes": 5000}, format="json"
    )
    assert response.status_code == 400


def test_patch_updates_single_non_weight_key():
    admin = _user_with_group("admin4", "ADMINISTRADOR")
    response = _client_for(admin).patch(
        "/api/v1/settings/analytics-config/", {"cache_ttl_minutes": 30}, format="json"
    )
    assert response.status_code == 200
    assert response.data["config"]["cache_ttl_minutes"] == 30


def test_patch_400_when_health_weights_do_not_sum_100():
    admin = _user_with_group("admin5", "ADMINISTRADOR")
    response = _client_for(admin).patch(
        "/api/v1/settings/analytics-config/", {"health_weight_cumplimiento": 50}, format="json"
    )
    assert response.status_code == 400
    assert "Equilibrio Operativo" in response.data["error"]


def test_patch_allows_full_health_weight_set_summing_100():
    admin = _user_with_group("admin6", "ADMINISTRADOR")
    body = {
        "health_weight_cumplimiento": 30, "health_weight_carga": 20, "health_weight_vencidas": 20,
        "health_weight_consistencia": 15, "health_weight_capacidad": 15,
    }
    response = _client_for(admin).patch("/api/v1/settings/analytics-config/", body, format="json")
    assert response.status_code == 200
    assert response.data["config"]["health_weight_cumplimiento"] == 30


def test_patch_400_for_invalid_threshold_ordering():
    admin = _user_with_group("admin7", "ADMINISTRADOR")
    response = _client_for(admin).patch(
        "/api/v1/settings/analytics-config/", {"risk_threshold_medio": 90}, format="json"
    )
    assert response.status_code == 400
    assert "Medio < Alto < Crítico" in response.data["error"]


def test_patch_persists_and_reflected_on_get():
    admin = _user_with_group("admin8", "ADMINISTRADOR")
    _client_for(admin).patch("/api/v1/settings/analytics-config/", {"alert_overdue_task_threshold": 10}, format="json")
    response = _client_for(admin).get("/api/v1/settings/analytics-config/")
    assert response.data["config"]["alert_overdue_task_threshold"] == 10
