"""Permisos del módulo Proyectos — Fase 5a (ver docs/AUDIT_LOG.md §
2026-08-13). Réplica exacta de `src/lib/projectAccess.ts`.

`ROLE_LEVEL`/`role_level`/`is_leadership` viven en
`apps.hierarchy.services` desde la Fase 9b (ver docs/AUDIT_LOG.md §
2026-08-18) — Proyectos fue el primer consumidor del nivel numérico
crudo y lo mantuvo como copia local hasta que Inteligencia Preventiva
se convirtió en un segundo consumidor real (`team-alerts`/
`team-subutilization`), momento en el que correspondía centralizarlo
en vez de triplicarlo. Se re-exportan aquí (`role_level`/
`is_leadership`) para no romper imports existentes
(`apps.projects.tests.test_projects_permissions`)."""

from rest_framework.permissions import IsAuthenticated

from apps.hierarchy.services import is_leadership, role_level

from .models import Project


def can_create_project(user) -> bool:
    """`canCreateProject` = `canViewTeam` legacy: nivel >= 2."""
    return role_level(user) >= 2


def is_project_manager(user, project: Project) -> bool:
    """Liderazgo (nivel >= 3) o el responsable/creador del proyecto —
    igual criterio que valida cambios de estado, fases y participantes."""
    if is_leadership(user):
        return True
    return user.id == project.responsible_id or user.id == project.created_by_id


def can_change_project_status(user, project: Project) -> bool:
    return is_project_manager(user, project)


def is_project_creator(user, project: Project) -> bool:
    """Eliminar/restaurar/eliminar definitivamente — a propósito MÁS
    ESTRECHO que `is_project_manager` (que también habilita a liderazgo
    y al responsable): solo quien creó el proyecto."""
    return user.id == project.created_by_id


def can_view_project(user, project: Project, participant_user_ids: list) -> bool:
    """Liderazgo ve todos los proyectos; el resto solo los propios
    (responsable/creador/participante)."""
    if is_leadership(user):
        return True
    if user.id == project.responsible_id or user.id == project.created_by_id:
        return True
    return user.id in participant_user_ids


def is_project_participant(user, project: Project, participant_user_ids: list) -> bool:
    """Puede comentar/registrar actividad/subir documentos (sub-fases
    futuras): participante o manager del proyecto."""
    if is_project_manager(user, project):
        return True
    return user.id in participant_user_ids


class CanAccessProject(IsAuthenticated):
    """Ver el detalle de un proyecto — ver `can_view_project`."""

    def has_object_permission(self, request, view, obj: Project) -> bool:
        participant_ids = list(obj.participants.values_list("user_id", flat=True))
        return can_view_project(request.user, obj, participant_ids)


class CanManageProject(IsAuthenticated):
    """Editar un proyecto (incl. cambio de estado/responsable) — ver
    `is_project_manager`."""

    def has_object_permission(self, request, view, obj: Project) -> bool:
        return is_project_manager(request.user, obj)


class CanDeleteProject(IsAuthenticated):
    """Enviar un proyecto a la papelera — ver `is_project_creator`."""

    def has_object_permission(self, request, view, obj: Project) -> bool:
        return is_project_creator(request.user, obj)


class CanCreateProject(IsAuthenticated):
    """Crear un proyecto — sin objeto detrás (`has_permission`, no
    `has_object_permission`), ver `can_create_project`."""

    def has_permission(self, request, view) -> bool:
        if not super().has_permission(request, view):
            return False
        return can_create_project(request.user)
