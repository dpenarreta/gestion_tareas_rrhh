"""Permisos de Reportes Ejecutivos — Fase 8 de la migración de stack (ver
docs/AUDIT_LOG.md § 2026-08-18). `can_access_reports` migrado al catálogo
dinámico de permisos (`reportes.ver`) — ver docs/AUDIT_LOG.md §
2026-09-01 ("Catálogo dinámico de permisos extendido a todo el sistema").
`role_name` se preserva: la sigue usando `scope_for_role` (no es un gate
de autorización, decide la forma de la respuesta — JEFE vs. COORDINADOR),
así que NO es código muerto tras esta migración."""

from rest_framework.permissions import IsAuthenticated

from apps.permissions.authorization import user_has_permission


def role_name(user) -> str:
    """`is_superuser` siempre resuelve a ADMINISTRADOR — mismo criterio
    que el resto del backend (ver `apps.desk.permissions.role_name`)."""
    if user.is_superuser:
        return "ADMINISTRADOR"
    group = user.groups.first()
    return group.name if group else ""


def can_access_reports(user) -> bool:
    return user_has_permission(user, "reportes.ver")


def scope_for_role(user) -> str:
    """Réplica de `scopeForRole` — JEFE_NACIONAL/ADMINISTRADOR ven scope
    JEFE; COORDINADOR_NACIONAL (el único otro rol con `can_access_reports`)
    ve scope COORDINADOR."""
    role = role_name(user)
    return "JEFE" if role in ("JEFE_NACIONAL", "ADMINISTRADOR") else "COORDINADOR"


class CanAccessReports(IsAuthenticated):
    def has_permission(self, request, view) -> bool:
        if not super().has_permission(request, view):
            return False
        return can_access_reports(request.user)
