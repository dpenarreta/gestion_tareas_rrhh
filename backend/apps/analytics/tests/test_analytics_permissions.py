"""Cobertura de apps.analytics.permissions — Fase 16 (ver
docs/AUDIT_LOG.md § 2026-08-20), réplica de `canViewOperationalRisk`
(`src/lib/roles.ts`)."""

import pytest
from django.contrib.auth.models import Group

from apps.analytics.permissions import can_view_operational_risk
from apps.users.models import User

pytestmark = pytest.mark.django_db


def _user_with_group(username: str, group_name: str) -> User:
    user = User.objects.create_user(username=username, email=f"{username}@example.com", password="Sup3r-Secr3t!")
    user.groups.set([Group.objects.get(name=group_name)])
    return user


def test_superuser_can_always_view_operational_risk():
    admin = User.objects.create_user(username="admin", email="admin@example.com", password="Sup3r-Secr3t!")
    admin.is_superuser = True
    admin.save()
    assert can_view_operational_risk(admin) is True


@pytest.mark.parametrize("group_name", ["JEFE_NACIONAL", "COORDINADOR_NACIONAL", "COORDINADOR_ZS"])
def test_allowed_roles_can_view_operational_risk(group_name):
    assert can_view_operational_risk(_user_with_group("u", group_name)) is True


@pytest.mark.parametrize(
    "group_name",
    ["ANALISTA_CC", "ANALISTA_SELECCION", "ASISTENTE_GH", "ASISTENTE_SELECCION", "ASISTENTE_GH_ZS", "TRABAJO_SOCIAL"],
)
def test_disallowed_roles_cannot_view_operational_risk(group_name):
    # ANALISTA_CC/ANALISTA_SELECCION comparten nivel 2 con COORDINADOR_ZS
    # en ROLE_LEVEL pero NO están en el whitelist de Riesgo Operativo —
    # confirma que esto es un whitelist puntual, no un umbral de nivel
    # (mismo criterio ya establecido para `can_create_meetings`).
    assert can_view_operational_risk(_user_with_group("u2", group_name)) is False


def test_user_without_group_cannot_view_operational_risk():
    user = User.objects.create_user(username="nogroup", email="nogroup@example.com", password="Sup3r-Secr3t!")
    assert can_view_operational_risk(user) is False
