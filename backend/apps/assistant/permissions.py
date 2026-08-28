"""Permisos de la base de conocimiento — Fase 58 (ver docs/AUDIT_LOG.md §
2026-08-25). Réplica exacta de `canViewKnowledgeBase`/
`canManageKnowledgeBase` (`src/lib/roles.ts`)."""

from rest_framework.permissions import IsAuthenticated

CAN_VIEW_KNOWLEDGE_BASE = {"ADMINISTRADOR", "JEFE_NACIONAL", "COORDINADOR_NACIONAL"}
CAN_MANAGE_KNOWLEDGE_BASE = {"ADMINISTRADOR"}


def role_name(user) -> str:
    """`is_superuser` siempre resuelve a ADMINISTRADOR — mismo criterio
    que el resto del backend (ver `apps.reports.permissions.role_name`)."""
    if user.is_superuser:
        return "ADMINISTRADOR"
    group = user.groups.first()
    return group.name if group else ""


def can_view_knowledge_base(user) -> bool:
    return role_name(user) in CAN_VIEW_KNOWLEDGE_BASE


def can_manage_knowledge_base(user) -> bool:
    return role_name(user) in CAN_MANAGE_KNOWLEDGE_BASE


class CanViewKnowledgeBase(IsAuthenticated):
    def has_permission(self, request, view) -> bool:
        if not super().has_permission(request, view):
            return False
        return can_view_knowledge_base(request.user)


class CanManageKnowledgeBase(IsAuthenticated):
    def has_permission(self, request, view) -> bool:
        if not super().has_permission(request, view):
            return False
        return can_manage_knowledge_base(request.user)
