"""Permisos de Comunicados — Fase 25 (ver docs/AUDIT_LOG.md §
2026-08-20). `CAN_POST_OR_DELETE` es réplica exacta de `CAN_POST`/
`CAN_DELETE` (`src/app/api/announcements/route.ts`/`[id]/route.ts`) —
ambas constantes TS tienen el mismo whitelist, por eso se colapsan en
una sola acá, mismo criterio que `CAN_CREATE_MEETINGS`
(`apps.meetings.permissions`)."""

CAN_POST_OR_DELETE = {"ADMINISTRADOR", "JEFE_NACIONAL", "COORDINADOR_NACIONAL"}


def role_name(user) -> str:
    """`is_superuser` siempre resuelve a ADMINISTRADOR — mismo criterio
    que `apps.meetings.permissions.role_name`/`apps.desk.permissions.role_name`."""
    if user.is_superuser:
        return "ADMINISTRADOR"
    group = user.groups.first()
    return group.name if group else ""


def can_post_or_delete_announcement(user) -> bool:
    return role_name(user) in CAN_POST_OR_DELETE
