"""Cobertura de `UserAdminService._sync_superuser_with_administrador_group`
— hallazgo H-6 de la re-auditoría de datos personales (ver
docs/AUDIT_LOG.md § 2026-09-02): antes de este cambio, ningún flujo del
producto asignaba `is_superuser`, dejando a cualquier Administrador
creado por el camino normal (grupo ADMINISTRADOR, sin `is_superuser`)
bloqueado de gestionar `LeaveRecord`/`SpecialStatus` (Art. 26 LOPDP, gate
`_is_true_superuser` desde H-5)."""

import pytest
from django.contrib.auth.models import Group
from rest_framework.exceptions import ValidationError

from apps.core.models import AuditLog
from apps.users.models import User
from apps.users.services import LAST_ACTIVE_ADMIN_ROLE_ERROR, UserAdminService

pytestmark = pytest.mark.django_db


def _bare_user(username: str) -> User:
    return User.objects.create_user(
        username=username, email=f"{username}@example.com", password="Sup3r-Secr3t!"
    )


def _actor() -> User:
    """Solo necesita existir como `actor` de las llamadas al service —
    no participa en ninguna aserción de permisos en este archivo."""
    return _bare_user("actor")


def _group(name: str) -> Group:
    return Group.objects.get(name=name)


# --- create_user ----------------------------------------------------------


def test_create_user_with_administrador_role_becomes_superuser():
    actor = _actor()
    user = UserAdminService.create_user(
        actor=actor,
        username="nuevo_admin",
        email="nuevo_admin@example.com",
        password="Sup3r-Secr3t!",
        role_ids=[_group("ADMINISTRADOR").id],
    )
    assert user.is_superuser is True


def test_create_user_with_non_administrador_role_stays_not_superuser():
    actor = _actor()
    user = UserAdminService.create_user(
        actor=actor,
        username="nuevo_analista",
        email="nuevo_analista@example.com",
        password="Sup3r-Secr3t!",
        role_ids=[_group("ANALISTA_CC").id],
    )
    assert user.is_superuser is False


# --- assign_roles: promoción/democión --------------------------------------


def test_assign_roles_promotes_to_superuser_when_adding_administrador():
    actor = _actor()
    user = _bare_user("promovido")
    user.groups.set([_group("ANALISTA_CC")])
    assert user.is_superuser is False

    UserAdminService.assign_roles(actor=actor, user=user, role_ids=[_group("ADMINISTRADOR").id])

    user.refresh_from_db()
    assert user.is_superuser is True


def test_assign_roles_demotes_from_superuser_when_not_last_admin():
    actor = _actor()
    # Dos administradores reales -> demover a uno no deja el sistema sin admin.
    admin1 = _bare_user("admin1")
    admin1.groups.set([_group("ADMINISTRADOR")])
    UserAdminService._sync_superuser_with_administrador_group(admin1, [_group("ADMINISTRADOR")])
    admin2 = _bare_user("admin2")
    admin2.groups.set([_group("ADMINISTRADOR")])
    UserAdminService._sync_superuser_with_administrador_group(admin2, [_group("ADMINISTRADOR")])
    assert admin1.is_superuser is True and admin2.is_superuser is True

    UserAdminService.assign_roles(actor=actor, user=admin1, role_ids=[_group("JEFE_NACIONAL").id])

    admin1.refresh_from_db()
    assert admin1.is_superuser is False
    assert list(admin1.groups.values_list("name", flat=True)) == ["JEFE_NACIONAL"]


def test_assign_roles_writes_is_superuser_in_audit_log():
    actor = _actor()
    user = _bare_user("auditado")
    user.groups.set([_group("ANALISTA_CC")])

    UserAdminService.assign_roles(actor=actor, user=user, role_ids=[_group("ADMINISTRADOR").id])

    entry = AuditLog.objects.get(action="user.roles_assigned", target_id=str(user.id))
    assert entry.previous_values["is_superuser"] is False
    assert entry.new_values["is_superuser"] is True


# --- Guard: último administrador activo ------------------------------------


def test_assign_roles_blocks_removing_administrador_from_last_active_admin():
    actor = _actor()
    user = _bare_user("unico_admin")
    user.groups.set([_group("ADMINISTRADOR")])
    UserAdminService._sync_superuser_with_administrador_group(user, [_group("ADMINISTRADOR")])
    assert user.is_superuser is True

    with pytest.raises(ValidationError) as exc_info:
        UserAdminService.assign_roles(actor=actor, user=user, role_ids=[_group("JEFE_NACIONAL").id])
    assert LAST_ACTIVE_ADMIN_ROLE_ERROR in str(exc_info.value)

    # Nada quedó a medias: ni el grupo ni el flag cambiaron.
    user.refresh_from_db()
    assert user.is_superuser is True
    assert list(user.groups.values_list("name", flat=True)) == ["ADMINISTRADOR"]


def test_assign_roles_blocks_when_the_only_other_admin_is_inactive():
    """Mismo criterio que `_set_status` (AC-038, ver
    `UserAdminService._is_last_active_admin`): un admin ya
    deshabilitado/bloqueado NO cuenta como administrador activo, así
    que el target sigue siendo — en la práctica — el único
    administrador activo real, y la reasignación se bloquea igual."""
    actor = _actor()
    inactive_admin = _bare_user("admin_inactivo")
    inactive_admin.groups.set([_group("ADMINISTRADOR")])
    UserAdminService._sync_superuser_with_administrador_group(
        inactive_admin, [_group("ADMINISTRADOR")]
    )
    inactive_admin.status = User.Status.DISABLED
    inactive_admin.save(update_fields=["status", "is_active"])

    target = _bare_user("otro_admin")
    target.groups.set([_group("ADMINISTRADOR")])
    UserAdminService._sync_superuser_with_administrador_group(target, [_group("ADMINISTRADOR")])

    with pytest.raises(ValidationError):
        UserAdminService.assign_roles(
            actor=actor, user=target, role_ids=[_group("JEFE_NACIONAL").id]
        )

    target.refresh_from_db()
    assert target.is_superuser is True
