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
    """Migrado al catálogo dinámico de permisos (`tareas.regularizar`) —
    ver docs/AUDIT_LOG.md § 2026-09-01 ("Catálogo dinámico de permisos
    extendido a todo el sistema"). Sembrado 1:1 al mismo set que tenía
    `CAN_REGULARIZE` legacy (ADMINISTRADOR vía `is_superuser` +
    JEFE_NACIONAL) — MÁS ESTRECHO que `usuarios.editar` (que además
    incluye COORDINADOR_NACIONAL). Usado por las operaciones en bloque de
    Tiempo Objetivo/Fecha Fin y el listado de pendientes. No es un
    permiso de objeto: es una capacidad general, sin tarea específica
    detrás."""

    def has_permission(self, request, view) -> bool:
        if not super().has_permission(request, view):
            return False
        from apps.permissions.authorization import user_has_permission

        return user_has_permission(request.user, "tareas.regularizar")


class CanCloseMonth(IsAuthenticated):
    """Migrado al catálogo dinámico de permisos (`tareas.cerrar_mes`) —
    ver docs/AUDIT_LOG.md § 2026-09-01. Antes reutilizaba
    `usuarios.editar` (ADMINISTRADOR/JEFE_NACIONAL/COORDINADOR_NACIONAL,
    `CAN_MANAGE_USERS` en `src/lib/roles.ts`) — reutilización
    semánticamente incorrecta ya señalada en versiones previas de este
    docstring; ahora tiene su propio codename, sembrado al mismo set
    exacto para preservar el comportamiento."""

    def has_permission(self, request, view) -> bool:
        if not super().has_permission(request, view):
            return False
        from apps.permissions.authorization import user_has_permission

        return user_has_permission(request.user, "tareas.cerrar_mes")
