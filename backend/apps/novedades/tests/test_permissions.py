"""Permisos base por rol, configuración dinámica desde Ajustes, excepciones
individuales y restricciones obligatorias."""

import pytest
from django.contrib.auth.models import Group, Permission

from apps.novedades import access as perms
from apps.novedades.models import NovedadEvent, PermissionOverride
from apps.novedades.services import NovedadesError, PermissionAdminService

from .conftest import access

pytestmark = pytest.mark.django_db


def test_base_matrix(admin, supervisor, assistant, other_user):
    sup, asis = access(supervisor), access(assistant)
    assert sup.can(perms.ACCEDER) and sup.can(perms.REGISTRAR) and sup.can(perms.COLABORADORES)
    assert not sup.can(perms.IMPORTAR) and not sup.can(perms.EXPORTAR)  # se habilitan expresamente
    assert not sup.national_read and sup.readable_supervisor_ids() == [supervisor.pk]
    assert (
        asis.can(perms.CONSOLIDADO) and asis.can(perms.EXPORTAR) and not asis.can(perms.REGISTRAR)
    )
    assert asis.national_read and not asis.national_write
    assert access(admin).national_write and access(admin).can(perms.PERMISOS)
    assert not access(other_user).can(perms.ACCEDER)


def test_operational_roles_never_get_admin_permissions_even_if_assigned(supervisor):
    group = Group.objects.get(name=perms.SUPERVISOR_ROLE)
    group.permissions.add(Permission.objects.get(codename=perms.ADMINISTRAR))
    supervisor.user_permissions.add(Permission.objects.get(codename=perms.PERMISOS))
    acc = access(supervisor)
    assert not acc.national_write and not acc.can(perms.PERMISOS)


def test_role_toggle_from_settings_applies_on_next_check_and_is_audited(admin, supervisor):
    before = access(supervisor)
    assert not before.can(perms.EXPORTAR)
    PermissionAdminService.set_role_permission(
        access(admin),
        role=perms.SUPERVISOR_ROLE,
        codename=perms.EXPORTAR,
        enabled=True,
        reason="Piloto",
    )
    assert access(supervisor).can(perms.EXPORTAR)  # sin cerrar sesión
    PermissionAdminService.set_role_permission(
        access(admin),
        role=perms.SUPERVISOR_ROLE,
        codename=perms.EXPORTAR,
        enabled=False,
        reason="Fin",
    )
    assert not access(supervisor).can(perms.EXPORTAR)
    assert NovedadEvent.objects.filter(action="permission.role_changed").count() == 2


def test_mandatory_and_unavailable_permissions_are_not_configurable(admin):
    with pytest.raises(NovedadesError):
        PermissionAdminService.set_role_permission(
            access(admin),
            role=perms.ASSISTANT_ROLE,
            codename=perms.REGISTRAR,
            enabled=True,
            reason="",
        )
    with pytest.raises(NovedadesError):
        PermissionAdminService.set_role_permission(
            access(admin),
            role=perms.SUPERVISOR_ROLE,
            codename=perms.COLABORADORES,
            enabled=False,
            reason="",
        )


def test_individual_override_grant_deny_and_revoke(admin, supervisor, supervisor2):
    adm = access(admin)
    grant = PermissionAdminService.create_override(
        adm,
        user_id=supervisor.pk,
        codename=perms.IMPORTAR,
        effect="GRANT",
        reason="Carga histórica",
    )
    assert access(supervisor).can(perms.IMPORTAR)
    assert not access(supervisor2).can(perms.IMPORTAR)
    # La excepción no amplía el ámbito de datos.
    assert access(supervisor).readable_supervisor_ids() == [supervisor.pk]
    PermissionAdminService.revoke_override(adm, grant.pk, "Terminó la carga")
    assert not access(supervisor).can(perms.IMPORTAR)

    PermissionAdminService.create_override(
        adm,
        user_id=supervisor.pk,
        codename=perms.REGISTRAR,
        effect="DENY",
        reason="Bloqueo temporal",
    )
    assert not access(supervisor).can(perms.REGISTRAR)
    assert NovedadEvent.objects.filter(action__startswith="permission.override").count() == 3


def test_overrides_cannot_target_self_or_non_configurable(admin, supervisor, assistant):
    adm = access(admin)
    with pytest.raises(NovedadesError):
        PermissionAdminService.create_override(
            adm, user_id=admin.pk, codename=perms.IMPORTAR, effect="GRANT", reason="yo"
        )
    with pytest.raises(NovedadesError):
        PermissionAdminService.create_override(
            adm, user_id=assistant.pk, codename=perms.REGISTRAR, effect="GRANT", reason="no"
        )
    with pytest.raises(NovedadesError):
        PermissionAdminService.create_override(
            adm, user_id=supervisor.pk, codename=perms.ADMINISTRAR, effect="GRANT", reason="no"
        )
    assert not PermissionOverride.objects.exists()


def test_operational_users_cannot_manage_permissions(supervisor, assistant):
    for user in (supervisor, assistant):
        with pytest.raises(NovedadesError):
            PermissionAdminService.set_role_permission(
                access(user),
                role=perms.SUPERVISOR_ROLE,
                codename=perms.IMPORTAR,
                enabled=True,
                reason="",
            )
        with pytest.raises(NovedadesError):
            PermissionAdminService.create_override(
                access(user), user_id=user.pk, codename=perms.IMPORTAR, effect="GRANT", reason="x"
            )


def test_admin_keeps_permissions_in_other_modules(admin):
    from apps.permissions.authorization import user_has_permission

    for codename in ("usuarios.ver", "roles.editar", "tareas.cerrar_mes", "reportes.ver"):
        assert user_has_permission(admin, codename)
