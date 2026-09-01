"""Permisos de Mejora Continua — Fase 11 (ver docs/AUDIT_LOG.md §
2026-08-19). `can_review_ideas` migrado al catálogo dinámico de permisos
(`mejora_continua.revisar`) — ver docs/AUDIT_LOG.md § 2026-09-01
("Catálogo dinámico de permisos extendido a todo el sistema"). `role_name`
se preserva: `services.py::get_visible_idea_author_ids` la sigue usando
para resolver visibilidad, no solo para este gate."""

from apps.permissions.authorization import user_has_permission


def role_name(user) -> str:
    """`is_superuser` siempre resuelve a ADMINISTRADOR — mismo criterio
    que el resto del backend (ver `apps.reports.permissions.role_name`)."""
    if user.is_superuser:
        return "ADMINISTRADOR"
    group = user.groups.first()
    return group.name if group else ""


def can_review_ideas(user) -> bool:
    return user_has_permission(user, "mejora_continua.revisar")
