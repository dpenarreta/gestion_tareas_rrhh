"""Cobertura de `get_activity_reason_label_map` — Fase 25 (ver
docs/AUDIT_LOG.md § 2026-08-20), réplica de `getActivityReasonLabelMap`
(`src/lib/activityReasons.ts`)."""

import pytest

from apps.tasks.models import ActivityReason
from apps.tasks.services import get_activity_reason_label_map

pytestmark = pytest.mark.django_db


def test_returns_empty_map_when_no_reasons():
    assert get_activity_reason_label_map() == {}


def test_includes_active_and_inactive_reasons():
    ActivityReason.objects.create(key="reunion", label="Reunión", is_active=True)
    ActivityReason.objects.create(key="capacitacion", label="Capacitación", is_active=False)

    label_map = get_activity_reason_label_map()
    assert label_map == {"reunion": "Reunión", "capacitacion": "Capacitación"}
