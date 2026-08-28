"""Lógica de negocio del CRUD de roles (`auth.Group`). A diferencia de los
usuarios, los roles sí se eliminan físicamente: son configuración
reutilizable, no cuentas con historial que preservar."""

from django.contrib.auth.models import Group, Permission
from django.contrib.contenttypes.models import ContentType

from apps.core.audit import record_audit_event
from apps.permissions.models import ModulePermission
from apps.users.models import User


class RoleService:
    @staticmethod
    def _permissions_for(codenames: list[str]) -> list[Permission]:
        content_type = ContentType.objects.get_for_model(ModulePermission)
        return list(Permission.objects.filter(content_type=content_type, codename__in=codenames))

    @staticmethod
    def create_role(
        *, actor: User, name: str, permission_codenames: list[str], context: dict | None = None
    ) -> Group:
        role = Group.objects.create(name=name)
        role.permissions.set(RoleService._permissions_for(permission_codenames))
        record_audit_event(
            actor=actor,
            action="role.created",
            target=role,
            module="roles",
            new_values={"name": name, "permission_codenames": permission_codenames},
            context=context,
        )
        return role

    @staticmethod
    def update_role(
        *,
        actor: User,
        role: Group,
        name: str | None = None,
        permission_codenames: list[str] | None = None,
        context: dict | None = None,
    ) -> Group:
        previous_values = {}
        new_values = {}
        if name is not None and name != role.name:
            previous_values["name"] = role.name
            new_values["name"] = name
            role.name = name
            role.save(update_fields=["name"])
        if permission_codenames is not None:
            previous_codenames = sorted(role.permissions.values_list("codename", flat=True))
            if previous_codenames != sorted(permission_codenames):
                previous_values["permission_codenames"] = previous_codenames
                new_values["permission_codenames"] = permission_codenames
            role.permissions.set(RoleService._permissions_for(permission_codenames))
        if new_values:
            record_audit_event(
                actor=actor,
                action="role.updated",
                target=role,
                module="roles",
                previous_values=previous_values,
                new_values=new_values,
                context=context,
            )
        return role

    @staticmethod
    def delete_role(*, actor: User, role: Group, context: dict | None = None) -> None:
        role_id, role_name = role.id, role.name
        role.delete()
        record_audit_event(
            actor=actor,
            action="role.deleted",
            target_type="group",
            target_id=role_id,
            module="roles",
            previous_values={"name": role_name},
            context=context,
        )
