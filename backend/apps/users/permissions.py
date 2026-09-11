from rest_framework.permissions import BasePermission

from apps.permissions.permissions import HasModulePermission


class IsSelf(BasePermission):
    """Permite la acción solo si el objeto pertenece al usuario autenticado."""

    def has_object_permission(self, request, view, obj):
        return obj == request.user


class UsuariosPermission(HasModulePermission):
    """Lectura: `usuarios.ver`. Escritura genérica: `usuarios.editar`
    (para las acciones que sí comparten ese permiso: editar datos, asignar
    roles/permisos, revocar sesiones)."""

    view_permission = "usuarios.ver"
    write_permission = "usuarios.editar"


class UsuariosCreatePermission(HasModulePermission):
    """Usada solo en la acción `create` del viewset de usuarios."""

    view_permission = "usuarios.ver"
    write_permission = "usuarios.crear"


class UsuariosDeshabilitarPermission(HasModulePermission):
    """Usada en `enable`/`disable`/`block`/`unblock`."""

    view_permission = "usuarios.ver"
    write_permission = "usuarios.deshabilitar"


class UsuariosEliminarPermission(HasModulePermission):
    """Usada solo en `destroy`: borrado definitivo de una cuenta.

    Permiso propio y separado de `usuarios.deshabilitar` a propósito. Dar de
    baja es reversible; esto no lo es, y además arrastra en cascada los datos
    personales de la persona (licencias, estados especiales, notificaciones,
    solicitudes LOPDP). No se asigna a ningún grupo en el seed: solo lo tiene
    quien sea superusuario (ADMINISTRADOR) o a quien se le asigne
    explícitamente.
    """

    view_permission = "usuarios.ver"
    write_permission = "usuarios.eliminar"


class UsuariosRestablecerPasswordPermission(HasModulePermission):
    """Usada en la acción `reset_password` del viewset de usuarios."""

    view_permission = "usuarios.ver"
    write_permission = "usuarios.restablecer_password"


class IsAdministrator(BasePermission):
    """Solo ADMINISTRADOR (superusuario o grupo "ADMINISTRADOR") — Fase
    13 (ver docs/AUDIT_LOG.md § 2026-08-19), réplica exacta del chequeo
    estricto de `PATCH /api/users/reset-consent-all`
    (`session.role !== "ADMINISTRADOR"`, sin pasar por el catálogo de
    permisos): ninguna asignación de permiso individual alcanza acá,
    solo el rol."""

    def has_permission(self, request, view) -> bool:
        if not (request.user and request.user.is_authenticated):
            return False
        if request.user.is_superuser:
            return True
        group = request.user.groups.first()
        return group is not None and group.name == "ADMINISTRADOR"
