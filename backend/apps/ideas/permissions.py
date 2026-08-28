"""Permisos de Mejora Continua — Fase 11 (ver docs/AUDIT_LOG.md §
2026-08-19). Réplica exacta de `canReviewIdeas`/`CAN_REVIEW_IDEAS`
(`src/lib/roles.ts`)."""

CAN_REVIEW_IDEAS = {"ADMINISTRADOR", "JEFE_NACIONAL", "COORDINADOR_NACIONAL"}


def role_name(user) -> str:
    """`is_superuser` siempre resuelve a ADMINISTRADOR — mismo criterio
    que `apps.desk.permissions.role_name`/`apps.reports.permissions.role_name`/
    `apps.meetings.permissions.role_name`."""
    if user.is_superuser:
        return "ADMINISTRADOR"
    group = user.groups.first()
    return group.name if group else ""


def can_review_ideas(user) -> bool:
    return role_name(user) in CAN_REVIEW_IDEAS
