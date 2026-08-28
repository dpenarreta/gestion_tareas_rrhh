"""Permisos de Solicitudes LOPD — Fase 12 (ver docs/AUDIT_LOG.md §
2026-08-19). Réplica exacta de `session.role === "ADMINISTRADOR"`
(inline en los `route.ts` originales — sin `canXxx` propio en
`src/lib/roles.ts` para este módulo)."""


def role_name(user) -> str:
    """`is_superuser` siempre resuelve a ADMINISTRADOR — mismo criterio
    que `apps.desk.permissions.role_name`/`apps.reports.permissions.role_name`/
    `apps.meetings.permissions.role_name`/`apps.ideas.permissions.role_name`."""
    if user.is_superuser:
        return "ADMINISTRADOR"
    group = user.groups.first()
    return group.name if group else ""


def is_administrator(user) -> bool:
    return role_name(user) == "ADMINISTRADOR"
