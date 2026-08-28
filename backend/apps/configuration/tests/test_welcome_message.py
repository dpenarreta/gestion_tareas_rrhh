"""Cobertura de `get_effective_welcome_message`/`_active` — Fase 25 (ver
docs/AUDIT_LOG.md § 2026-08-20), réplica de `getEffectiveWelcomeMessage`/
`getEffectiveWelcomeMessageActive` (`src/lib/systemConfig.ts`)."""

from datetime import datetime
from datetime import timezone as dt_timezone

import pytest

from apps.configuration.services import (
    CONFIG_KEY_WELCOME_MESSAGE,
    CONFIG_KEY_WELCOME_MESSAGE_ACTIVE,
    get_effective_welcome_message,
    get_effective_welcome_message_active,
    set_config_value,
)
from apps.users.models import User

pytestmark = pytest.mark.django_db


def _now() -> datetime:
    return datetime.now(dt_timezone.utc)


@pytest.fixture
def actor():
    return User.objects.create_user(username="admin", email="admin@example.com", password="Sup3r-Secr3t!")


def test_defaults_to_empty_string_and_inactive():
    assert get_effective_welcome_message(_now()) == ""
    assert get_effective_welcome_message_active(_now()) is False


def test_returns_configured_message(actor):
    set_config_value(CONFIG_KEY_WELCOME_MESSAGE, "Bienvenido", actor)
    assert get_effective_welcome_message(_now()) == "Bienvenido"


def test_active_only_true_for_exact_string_true(actor):
    set_config_value(CONFIG_KEY_WELCOME_MESSAGE_ACTIVE, "true", actor)
    assert get_effective_welcome_message_active(_now()) is True

    set_config_value(CONFIG_KEY_WELCOME_MESSAGE_ACTIVE, "yes", actor)
    assert get_effective_welcome_message_active(_now()) is False
