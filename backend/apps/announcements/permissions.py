"""Permisos de Comunicados — Fase 25 (ver docs/AUDIT_LOG.md §
2026-08-20). `can_post_or_delete_announcement` migrado al catálogo
dinámico de permisos (`comunicados.gestionar`) — ver docs/AUDIT_LOG.md §
2026-09-01 ("Catálogo dinámico de permisos extendido a todo el sistema").
`role_name` se preserva: `views.py` la usa para mostrar el rol del autor
de un comunicado, no solo para este gate."""

from apps.permissions.authorization import user_has_permission


def role_name(user) -> str:
    """`is_superuser` siempre resuelve a ADMINISTRADOR — mismo criterio
    que `apps.meetings.permissions.role_name`/`apps.desk.permissions.role_name`."""
    if user.is_superuser:
        return "ADMINISTRADOR"
    group = user.groups.first()
    return group.name if group else ""


def can_post_or_delete_announcement(user) -> bool:
    return user_has_permission(user, "comunicados.gestionar")
