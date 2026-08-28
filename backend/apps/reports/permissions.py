"""Permisos de Reportes Ejecutivos — Fase 8 de la migración de stack (ver
docs/AUDIT_LOG.md § 2026-08-18). Réplica exacta de `canAccessReports`
(`src/lib/roles.ts`)."""

from rest_framework.permissions import IsAuthenticated

CAN_ACCESS_REPORTS = {"ADMINISTRADOR", "JEFE_NACIONAL", "COORDINADOR_NACIONAL"}


def role_name(user) -> str:
    """`is_superuser` siempre resuelve a ADMINISTRADOR — mismo criterio
    que el resto del backend (ver `apps.desk.permissions.role_name`)."""
    if user.is_superuser:
        return "ADMINISTRADOR"
    group = user.groups.first()
    return group.name if group else ""


def can_access_reports(user) -> bool:
    return role_name(user) in CAN_ACCESS_REPORTS


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
