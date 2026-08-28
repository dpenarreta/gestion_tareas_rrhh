"""Cobertura de apps.meetings.permissions — Fase 10 (ver
docs/AUDIT_LOG.md § 2026-08-19), réplica de `canCreateMeetings`
(`src/lib/roles.ts`)."""

import pytest
from django.contrib.auth.models import Group

from apps.meetings.permissions import can_create_meetings
from apps.users.models import User

pytestmark = pytest.mark.django_db


def _user_with_group(username: str, group_name: str) -> User:
    user = User.objects.create_user(username=username, email=f"{username}@example.com", password="Sup3r-Secr3t!")
    user.groups.set([Group.objects.get(name=group_name)])
    return user


def test_superuser_can_always_create_meetings():
    admin = User.objects.create_user(username="admin", email="admin@example.com", password="Sup3r-Secr3t!")
    admin.is_superuser = True
    admin.save()
    assert can_create_meetings(admin) is True


@pytest.mark.parametrize("group_name", ["JEFE_NACIONAL", "COORDINADOR_NACIONAL", "COORDINADOR_ZS"])
def test_allowed_roles_can_create_meetings(group_name):
    assert can_create_meetings(_user_with_group("u", group_name)) is True


@pytest.mark.parametrize("group_name", ["ANALISTA_CC", "ANALISTA_SELECCION", "ASISTENTE_GH", "ASISTENTE_SELECCION"])
def test_disallowed_roles_cannot_create_meetings(group_name):
    # ANALISTA_CC/ANALISTA_SELECCION comparten nivel 2 con COORDINADOR_ZS
    # en ROLE_LEVEL pero NO están en el whitelist de creación de reuniones
    # — confirma que esto es un whitelist puntual, no un umbral de nivel.
    assert can_create_meetings(_user_with_group("u2", group_name)) is False


def test_user_without_group_cannot_create_meetings():
    user = User.objects.create_user(username="nogroup", email="nogroup@example.com", password="Sup3r-Secr3t!")
    assert can_create_meetings(user) is False
