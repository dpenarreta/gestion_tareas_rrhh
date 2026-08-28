"""Cobertura de `get_effective_snooze_presets_minutes`/`SnoozePresetsView`
— Fase 28 (ver docs/AUDIT_LOG.md § 2026-08-20), réplica de
`getEffectiveSnoozePresetsMinutes`/`route.ts`."""

from datetime import datetime
from datetime import timezone as dt_timezone

import pytest
from django.contrib.auth.models import Group
from rest_framework.test import APIClient

from apps.configuration.services import (
    CONFIG_KEY_SNOOZE_PRESETS_MINUTES,
    get_effective_snooze_presets_minutes,
    set_config_value,
)
from apps.users.models import User

pytestmark = pytest.mark.django_db


def _now() -> datetime:
    return datetime.now(dt_timezone.utc)


def _client_for(user: User) -> APIClient:
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def _user_with_group(username: str, group_name: str) -> User:
    user = User.objects.create_user(username=username, email=f"{username}@example.com", password="Sup3r-Secr3t!")
    user.groups.set([Group.objects.get(name=group_name)])
    return user


# --- get_effective_snooze_presets_minutes ---------------------------------------------------


def test_defaults_when_never_configured():
    assert get_effective_snooze_presets_minutes(_now()) == [15, 30, 60, 1440]


def test_returns_configured_list():
    actor = _user_with_group("admin", "ADMINISTRADOR")
    set_config_value(CONFIG_KEY_SNOOZE_PRESETS_MINUTES, "[10, 20]", actor)
    assert get_effective_snooze_presets_minutes(_now()) == [10, 20]


def test_falls_back_for_malformed_json():
    actor = _user_with_group("admin2", "ADMINISTRADOR")
    set_config_value(CONFIG_KEY_SNOOZE_PRESETS_MINUTES, "{not valid", actor)
    assert get_effective_snooze_presets_minutes(_now()) == [15, 30, 60, 1440]


def test_falls_back_when_not_all_numbers():
    actor = _user_with_group("admin3", "ADMINISTRADOR")
    set_config_value(CONFIG_KEY_SNOOZE_PRESETS_MINUTES, '[10, "no-es-numero"]', actor)
    assert get_effective_snooze_presets_minutes(_now()) == [15, 30, 60, 1440]


# --- GET /settings/snooze-presets/ ------------------------------------------------------------


def test_requires_authentication():
    response = APIClient().get("/api/v1/settings/snooze-presets/")
    assert response.status_code == 401


def test_view_returns_effective_minutes():
    user = _user_with_group("asist", "ASISTENTE_GH")
    response = _client_for(user).get("/api/v1/settings/snooze-presets/")
    assert response.status_code == 200
    assert response.data["minutes"] == [15, 30, 60, 1440]
