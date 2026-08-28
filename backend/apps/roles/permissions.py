from apps.permissions.permissions import HasModulePermission


class RolesPermission(HasModulePermission):
    view_permission = "roles.ver"
    write_permission = "roles.editar"
