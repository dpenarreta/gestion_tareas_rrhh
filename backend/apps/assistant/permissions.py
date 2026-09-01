"""Permisos de la base de conocimiento — Fase 58 (ver docs/AUDIT_LOG.md §
2026-08-25). `can_view_knowledge_base`/`can_manage_knowledge_base`
migrados al catálogo dinámico de permisos (`base_conocimiento.ver`/
`base_conocimiento.gestionar`) — ver docs/AUDIT_LOG.md § 2026-09-01
("Catálogo dinámico de permisos extendido a todo el sistema")."""

from rest_framework.permissions import IsAuthenticated

from apps.permissions.authorization import user_has_permission


def can_view_knowledge_base(user) -> bool:
    return user_has_permission(user, "base_conocimiento.ver")


def can_manage_knowledge_base(user) -> bool:
    return user_has_permission(user, "base_conocimiento.gestionar")


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
