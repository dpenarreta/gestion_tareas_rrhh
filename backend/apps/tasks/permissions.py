from rest_framework.permissions import IsAuthenticated

from .models import Task
from .services import TaskService


class CanAccessTask(IsAuthenticated):
    """Ver/editar una tarea o sus comentarios — ver criterio exacto en
    `TaskService.can_access`."""

    def has_object_permission(self, request, view, obj: Task) -> bool:
        return TaskService.can_access(actor=request.user, task=obj)


class CanDeleteTask(IsAuthenticated):
    """Eliminar una tarea — más estrecho que `CanAccessTask` (ver
    `TaskService.can_delete`): el responsable asignado no puede borrarla,
    solo quien la creó o tiene `usuarios.editar`."""

    def has_object_permission(self, request, view, obj: Task) -> bool:
        return TaskService.can_delete(actor=request.user, task=obj)


class CanRegularize(IsAuthenticated):
    """`CAN_REGULARIZE` legacy (ADMINISTRADOR + JEFE_NACIONAL) — MÁS
    ESTRECHO que `usuarios.editar` (que además incluye
    COORDINADOR_NACIONAL). Usado por las operaciones en bloque de Tiempo
    Objetivo/Fecha Fin y el listado de pendientes — ver plan de sub-fase
    3c-bulk. No es un permiso de objeto: es una capacidad general, sin
    tarea específica detrás."""

    def has_permission(self, request, view) -> bool:
        if not super().has_permission(request, view):
            return False
        return request.user.is_superuser or request.user.groups.filter(name="JEFE_NACIONAL").exists()


class CanCloseMonth(IsAuthenticated):
    """`canManageUsers` legacy (ADMINISTRADOR/JEFE_NACIONAL/
    COORDINADOR_NACIONAL, ver `CAN_MANAGE_USERS` en `src/lib/roles.ts`) —
    verificado que es exactamente el mismo conjunto que ya tiene
    `usuarios.editar` en el catálogo sembrado, igual criterio que
    `TaskService.can_access` — ver plan de sub-fase 3d."""

    def has_permission(self, request, view) -> bool:
        if not super().has_permission(request, view):
            return False
        from apps.permissions.authorization import user_has_permission

        return user_has_permission(request.user, "usuarios.editar")
