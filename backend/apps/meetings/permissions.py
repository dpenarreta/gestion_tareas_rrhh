"""Permisos de Reuniones — Fase 10 (ver docs/AUDIT_LOG.md §
2026-08-19). `can_create_meetings` es réplica exacta de
`canCreateMeetings`/`CAN_CREATE_MEETINGS` (`src/lib/roles.ts`) — un
whitelist de roles puntual, NO un umbral de `role_level` (Coordinador
ZS y Analista CC/Selección comparten nivel 2 en
`apps.hierarchy.services.ROLE_LEVEL`, pero solo Coordinador ZS crea
reuniones). El resto de los permisos (ver/editar/eliminar una reunión
puntual) depende del objeto ya cargado (host/invitado) y vive inline
en `views.py`, igual que en las rutas legacy — no hay función de
"visibilidad jerárquica" involucrada en este módulo."""

CAN_CREATE_MEETINGS = {"ADMINISTRADOR", "JEFE_NACIONAL", "COORDINADOR_NACIONAL", "COORDINADOR_ZS"}


def role_name(user) -> str:
    """`is_superuser` siempre resuelve a ADMINISTRADOR — mismo criterio
    que `apps.desk.permissions.role_name`/`apps.reports.permissions.role_name`."""
    if user.is_superuser:
        return "ADMINISTRADOR"
    group = user.groups.first()
    return group.name if group else ""


def can_create_meetings(user) -> bool:
    return role_name(user) in CAN_CREATE_MEETINGS
