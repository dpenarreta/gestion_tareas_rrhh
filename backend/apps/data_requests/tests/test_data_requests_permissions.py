"""Cobertura de apps.data_requests.permissions — Fase 12 (ver
docs/AUDIT_LOG.md § 2026-08-19)."""

import pytest
from django.contrib.auth.models import Group

from apps.data_requests.permissions import is_administrator
from apps.users.models import User

pytestmark = pytest.mark.django_db


def test_superuser_is_administrator():
    admin = User.objects.create_user(username="admin", email="admin@example.com", password="Sup3r-Secr3t!")
    admin.is_superuser = True
    admin.save()
    assert is_administrator(admin) is True


def test_administrador_group_is_administrator():
    user = User.objects.create_user(username="u", email="u@example.com", password="Sup3r-Secr3t!")
    user.groups.set([Group.objects.get(name="ADMINISTRADOR")])
    assert is_administrator(user) is True


def test_other_roles_are_not_administrator():
    user = User.objects.create_user(username="u2", email="u2@example.com", password="Sup3r-Secr3t!")
    user.groups.set([Group.objects.get(name="JEFE_NACIONAL")])
    assert is_administrator(user) is False
