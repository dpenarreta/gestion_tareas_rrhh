"""Cobertura de `apps.analytics.services.notify_if_high_risk` — Fase 20
(ver docs/AUDIT_LOG.md § 2026-08-20), réplica de `notifyIfHighRisk`
(`src/app/api/analytics/operational-risk/team/route.ts`)."""

from datetime import datetime
from datetime import timezone as dt_timezone

import pytest
from django.contrib.auth.models import Group

from apps.analytics.services import notify_if_high_risk
from apps.notifications.models import Notification
from apps.users.models import User

pytestmark = pytest.mark.django_db

NOW = datetime(2026, 8, 20, 10, 0, tzinfo=dt_timezone.utc)


@pytest.fixture
def analista():
    # ANALISTA_CC notifica a COORDINADOR_NACIONAL (RoleNotificationTarget seed).
    user = User.objects.create_user(username="analista", email="analista@example.com", password="Sup3r-Secr3t!", first_name="Ana")
    user.groups.set([Group.objects.get(name="ANALISTA_CC")])
    return user


@pytest.fixture
def coordinador_nacional():
    user = User.objects.create_user(username="coord_nac", email="coord_nac@example.com", password="Sup3r-Secr3t!")
    user.groups.set([Group.objects.get(name="COORDINADOR_NACIONAL")])
    return user


@pytest.mark.parametrize("classification", ["Bajo", "Medio"])
def test_no_notification_below_alto(analista, coordinador_nacional, classification):
    notify_if_high_risk(user=analista, risk={"classification": classification, "score": 50}, now=NOW)
    assert not Notification.objects.exists()


@pytest.mark.parametrize("classification", ["Alto", "Crítico"])
def test_notifies_targets_when_alto_or_critico(analista, coordinador_nacional, classification):
    notify_if_high_risk(user=analista, risk={"classification": classification, "score": 85}, now=NOW)
    notification = Notification.objects.get()
    assert notification.user_id == coordinador_nacional.id
    assert "Ana" in notification.message
    assert classification.lower() in notification.message
    assert notification.dedup_key == f"analytics-risk:{analista.id}:2026-08"


def test_deduplicates_within_same_month(analista, coordinador_nacional):
    notify_if_high_risk(user=analista, risk={"classification": "Alto", "score": 85}, now=NOW)
    notify_if_high_risk(user=analista, risk={"classification": "Crítico", "score": 95}, now=NOW)
    assert Notification.objects.count() == 1


def test_notifies_again_in_a_different_month(analista, coordinador_nacional):
    notify_if_high_risk(user=analista, risk={"classification": "Alto", "score": 85}, now=NOW)
    next_month = datetime(2026, 9, 1, tzinfo=dt_timezone.utc)
    notify_if_high_risk(user=analista, risk={"classification": "Alto", "score": 85}, now=next_month)
    assert Notification.objects.count() == 2


def test_no_notification_when_role_has_no_targets():
    admin = User.objects.create_user(username="admin_role", email="admin_role@example.com", password="Sup3r-Secr3t!")
    admin.groups.set([Group.objects.get(name="ADMINISTRADOR")])
    notify_if_high_risk(user=admin, risk={"classification": "Crítico", "score": 99}, now=NOW)
    assert not Notification.objects.exists()


def test_no_notification_without_group():
    user = User.objects.create_user(username="nogroup", email="nogroup@example.com", password="Sup3r-Secr3t!")
    notify_if_high_risk(user=user, risk={"classification": "Alto", "score": 85}, now=NOW)
    assert not Notification.objects.exists()
