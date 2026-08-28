"""Cobertura de apps.hierarchy.services — Fase 9b (ver
docs/AUDIT_LOG.md § 2026-08-18) para `role_level`/`is_leadership`/
`can_view_team`/`get_subordinate_groups`, centralizados aquí desde
`apps.projects.permissions` al convertirse Inteligencia Preventiva en
un segundo consumidor real del nivel numérico de rol.
`is_executor_group`/`get_subordinate_executor_groups` se agregan en la
Fase 19 (ver docs/AUDIT_LOG.md § 2026-08-20) — concepto DISTINTO de
`is_leadership` (umbral 4, no 3), consumido por las rutas de Analytics
de equipo."""

import pytest
from django.contrib.auth.models import Group

from apps.hierarchy.services import (
    ALL_ROLES,
    ROLE_LABEL,
    ROLE_LEVEL,
    can_view_team,
    get_subordinate_executor_groups,
    get_subordinate_groups,
    is_executor_group,
    is_leadership,
    role_level,
)
from apps.users.models import User

pytestmark = pytest.mark.django_db


def _user_with_group(username: str, group_name: str) -> User:
    user = User.objects.create_user(username=username, email=f"{username}@example.com", password="Sup3r-Secr3t!")
    user.groups.set([Group.objects.get(name=group_name)])
    return user


# --- ROLE_LABEL / ALL_ROLES (Fase 28) -------------------------------------------


def test_all_roles_matches_role_label_keys_in_order():
    assert ALL_ROLES == list(ROLE_LABEL.keys())


def test_role_label_has_an_entry_for_every_role_level_key():
    assert set(ROLE_LABEL.keys()) == set(ROLE_LEVEL.keys())


def test_role_label_values_are_human_readable():
    assert ROLE_LABEL["ANALISTA_CC"] == "Analista Clima y Cultura"
    assert ROLE_LABEL["ASISTENTE_NOMINA"] == "Asistente de Nómina"


# --- role_level / is_leadership / can_view_team --------------------------------


def test_role_level_superuser_is_5():
    admin = User.objects.create_user(username="admin", email="admin@example.com", password="Sup3r-Secr3t!")
    admin.is_superuser = True
    admin.save()
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
    assert is_leadership(_user_with_group("coord_zs", "COORDINADOR_ZS")) is False


def test_can_view_team_threshold():
    assert can_view_team(_user_with_group("coord_zs", "COORDINADOR_ZS")) is True
    assert can_view_team(_user_with_group("asistente", "ASISTENTE_GH")) is False


# --- get_subordinate_groups -----------------------------------------------------


def test_get_subordinate_groups_excludes_own_group():
    coord_nac = _user_with_group("coord_nac", "COORDINADOR_NACIONAL")
    names = {g.name for g in get_subordinate_groups(coord_nac)}
    assert "COORDINADOR_NACIONAL" not in names
    assert "ANALISTA_CC" in names


def test_get_subordinate_groups_empty_for_leaf_role():
    asistente = _user_with_group("asistente", "ASISTENTE_GH")
    assert get_subordinate_groups(asistente) == []


def test_get_subordinate_groups_empty_without_group():
    user = User.objects.create_user(username="nogroup", email="nogroup2@example.com", password="Sup3r-Secr3t!")
    assert get_subordinate_groups(user) == []


# --- is_executor_group / get_subordinate_executor_groups (Fase 19) --------------


def test_is_executor_group_true_below_level_4():
    assert is_executor_group(Group.objects.get(name="COORDINADOR_NACIONAL")) is True
    assert is_executor_group(Group.objects.get(name="ASISTENTE_GH")) is True


def test_is_executor_group_false_at_or_above_level_4():
    assert is_executor_group(Group.objects.get(name="JEFE_NACIONAL")) is False


def test_is_executor_group_none_is_false():
    assert is_executor_group(None) is False


def test_get_subordinate_executor_groups_excludes_leadership():
    """El Administrador (grupo `ADMINISTRADOR`, ve a todos vía
    `RoleVisibility`) ve a JEFE_NACIONAL como subordinado
    (`get_subordinate_groups`), pero JEFE_NACIONAL queda excluido acá
    por ser rol de liderazgo (`ROLE_LEVEL>=4`) — a diferencia de
    `get_subordinate_groups`, que no aplica ese filtro. Nota: el bypass
    `is_superuser` NO aplica en `get_visible_groups`/
    `get_subordinate_groups` (a diferencia de `role_level`) — se usa
    un usuario con el grupo `ADMINISTRADOR` real, no un superusuario
    sin grupo."""
    admin = _user_with_group("admin", "ADMINISTRADOR")

    all_subordinates = {g.name for g in get_subordinate_groups(admin)}
    executor_subordinates = {g.name for g in get_subordinate_executor_groups(admin)}
    assert "JEFE_NACIONAL" in all_subordinates
    assert "JEFE_NACIONAL" not in executor_subordinates
    assert "COORDINADOR_NACIONAL" in executor_subordinates


def test_get_subordinate_executor_groups_empty_without_group():
    user = User.objects.create_user(username="nogroup3", email="nogroup3@example.com", password="Sup3r-Secr3t!")
    assert get_subordinate_executor_groups(user) == []
