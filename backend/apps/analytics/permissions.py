"""Permisos puntuales de Analytics — Fase 16 (ver docs/AUDIT_LOG.md §
2026-08-20). `can_view_operational_risk` es réplica exacta de
`canViewOperationalRisk`/`CAN_VIEW_OPERATIONAL_RISK` (`src/lib/roles.ts`)
— un whitelist de roles puntual (gerencia, nunca nivel 1), NO un umbral
de `role_level` — mismo criterio ya usado para `can_create_meetings`
(`apps.meetings.permissions`)."""

CAN_VIEW_OPERATIONAL_RISK = {"ADMINISTRADOR", "JEFE_NACIONAL", "COORDINADOR_NACIONAL", "COORDINADOR_ZS"}


def role_name(user) -> str:
    """`is_superuser` siempre resuelve a ADMINISTRADOR — mismo criterio
    que `apps.desk.permissions.role_name`/`apps.meetings.permissions.role_name`."""
    if user.is_superuser:
        return "ADMINISTRADOR"
    group = user.groups.first()
    return group.name if group else ""


def can_view_operational_risk(user) -> bool:
    return role_name(user) in CAN_VIEW_OPERATIONAL_RISK
