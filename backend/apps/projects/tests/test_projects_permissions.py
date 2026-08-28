"""Cobertura de apps.projects.permissions — Fase 5a (ver
docs/AUDIT_LOG.md § 2026-08-13). Réplica exacta de
`src/lib/projectAccess.ts`; funciones puras, testeadas directo sin
pasar por HTTP (ver `test_project_views.py` para la cobertura de
integración)."""

import pytest
from django.contrib.auth.models import Group

from apps.projects.models import Project
from apps.projects.permissions import (
    can_create_project,
    can_view_project,
    is_leadership,
    is_project_creator,
    is_project_manager,
    is_project_participant,
    role_level,
)
from apps.users.models import User

pytestmark = pytest.mark.django_db


@pytest.fixture
def admin():
    admin = User.objects.create_user(username="admin", email="admin@example.com", password="Sup3r-Secr3t!")
    admin.is_superuser = True
    admin.save()
    return admin


def _user_with_group(username: str, group_name: str) -> User:
    user = User.objects.create_user(username=username, email=f"{username}@example.com", password="Sup3r-Secr3t!")
    user.groups.set([Group.objects.get(name=group_name)])
    return user


def _project(responsible: User, created_by: User) -> Project:
    return Project(
        name="Proyecto", priority="ALTA", start_date="2026-08-01T00:00:00Z", target_date="2026-09-01T00:00:00Z",
        target_time_hours=10, responsible=responsible, created_by=created_by,
    )


# --- role_level / is_leadership / can_create_project --------------------------------


def test_role_level_superuser_is_5(admin):
    assert role_level(admin) == 5


def test_role_level_by_group():
    assert role_level(_user_with_group("jefe", "JEFE_NACIONAL")) == 4
    assert role_level(_user_with_group("coord", "COORDINADOR_NACIONAL")) == 3
    assert role_level(_user_with_group("analista", "ANALISTA_CC")) == 2
    assert role_level(_user_with_group("asistente", "ASISTENTE_GH")) == 1


def test_role_level_no_group_is_0():
    user = User.objects.create_user(username="nogroup", email="nogroup@example.com", password="Sup3r-Secr3t!")
    assert role_level(user) == 0


def test_is_leadership_threshold():
    assert is_leadership(_user_with_group("coord", "COORDINADOR_NACIONAL")) is True
    assert is_leadership(_user_with_group("analista", "ANALISTA_CC")) is False


def test_can_create_project_threshold():
    assert can_create_project(_user_with_group("analista", "ANALISTA_CC")) is True
    assert can_create_project(_user_with_group("asistente", "ASISTENTE_GH")) is False


# --- is_project_manager / can_change_project_status ----------------------------------


def test_is_project_manager_true_for_leadership_even_if_unrelated():
    leader = _user_with_group("coord", "COORDINADOR_NACIONAL")
    responsible = _user_with_group("resp", "ASISTENTE_GH")
    creator = _user_with_group("creator", "ASISTENTE_GH")
    assert is_project_manager(leader, _project(responsible, creator)) is True


def test_is_project_manager_true_for_responsible_or_creator():
    responsible = _user_with_group("resp", "ASISTENTE_GH")
    creator = _user_with_group("creator", "ASISTENTE_GH")
    project = _project(responsible, creator)
    assert is_project_manager(responsible, project) is True
    assert is_project_manager(creator, project) is True


def test_is_project_manager_false_for_unrelated_non_leadership():
    responsible = _user_with_group("resp", "ASISTENTE_GH")
    creator = _user_with_group("creator", "ASISTENTE_GH")
    stranger = _user_with_group("stranger", "ASISTENTE_SELECCION")
    assert is_project_manager(stranger, _project(responsible, creator)) is False


# --- is_project_creator (más estricto que is_project_manager) ------------------------


def test_is_project_creator_false_for_responsible_and_leadership():
    leader = _user_with_group("coord", "COORDINADOR_NACIONAL")
    responsible = _user_with_group("resp", "ASISTENTE_GH")
    creator = _user_with_group("creator", "ASISTENTE_GH")
    project = _project(responsible, creator)
    assert is_project_creator(responsible, project) is False
    assert is_project_creator(leader, project) is False
    assert is_project_creator(creator, project) is True


# --- can_view_project / is_project_participant ----------------------------------------


def test_can_view_project_true_for_participant():
    responsible = _user_with_group("resp", "ASISTENTE_GH")
    creator = _user_with_group("creator", "ASISTENTE_GH")
    participant = _user_with_group("part", "ASISTENTE_SELECCION")
    project = _project(responsible, creator)
    assert can_view_project(participant, project, [participant.id]) is True


def test_can_view_project_false_for_non_participant_non_manager():
    responsible = _user_with_group("resp", "ASISTENTE_GH")
    creator = _user_with_group("creator", "ASISTENTE_GH")
    stranger = _user_with_group("stranger", "ASISTENTE_SELECCION")
    project = _project(responsible, creator)
    assert can_view_project(stranger, project, []) is False


def test_is_project_participant_true_for_manager_without_participant_row():
    responsible = _user_with_group("resp", "ASISTENTE_GH")
    creator = _user_with_group("creator", "ASISTENTE_GH")
    project = _project(responsible, creator)
    assert is_project_participant(responsible, project, []) is True
