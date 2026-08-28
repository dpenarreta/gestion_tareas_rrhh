"""Cobertura de apps.ideas.permissions — Fase 11 (ver
docs/AUDIT_LOG.md § 2026-08-19), réplica de `canReviewIdeas`
(`src/lib/roles.ts`)."""

import pytest
from django.contrib.auth.models import Group

from apps.ideas.permissions import can_review_ideas
from apps.users.models import User

pytestmark = pytest.mark.django_db


def _user_with_group(username: str, group_name: str) -> User:
    user = User.objects.create_user(username=username, email=f"{username}@example.com", password="Sup3r-Secr3t!")
    user.groups.set([Group.objects.get(name=group_name)])
    return user


def test_superuser_can_always_review_ideas():
    admin = User.objects.create_user(username="admin", email="admin@example.com", password="Sup3r-Secr3t!")
    admin.is_superuser = True
    admin.save()
    assert can_review_ideas(admin) is True


@pytest.mark.parametrize("group_name", ["JEFE_NACIONAL", "COORDINADOR_NACIONAL"])
def test_allowed_roles_can_review_ideas(group_name):
    assert can_review_ideas(_user_with_group("u", group_name)) is True


@pytest.mark.parametrize("group_name", ["COORDINADOR_ZS", "ANALISTA_CC", "ASISTENTE_GH"])
def test_disallowed_roles_cannot_review_ideas(group_name):
    assert can_review_ideas(_user_with_group("u2", group_name)) is False
