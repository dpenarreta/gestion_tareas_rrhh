"""Permiso DRF de entrada al módulo. El detalle fino (ámbito de datos,
permiso por acción, período abierto) lo revalida cada servicio contra el
registro concreto."""

from rest_framework.permissions import BasePermission

from apps.core.audit import record_audit_event
from apps.core.models import AuditLog
from apps.core.request_meta import get_request_context

from .access import ACCEDER


class CanAccessNovedades(BasePermission):
    """Exige `novedades.acceder` EFECTIVO (rol + excepciones individuales,
    ver `access.effective_codenames`) — no basta el permiso del grupo, porque
    una restricción individual debe poder cortar el acceso. Audita el
    intento denegado igual que `apps.permissions.HasActionPermission`."""

    message = "No tiene acceso al módulo Control Operativo de Novedades."

    def has_permission(self, request, view) -> bool:
        if not (request.user and request.user.is_authenticated):
            return False
        if view.access.can(ACCEDER):
            return True
        record_audit_event(
            actor=request.user,
            action="access_denied",
            target=request.user,
            module="novedades",
            new_values={
                "required_permission": ACCEDER,
                "method": request.method,
                "path": request.path,
            },
            result=AuditLog.Result.FAILURE,
            context=get_request_context(request),
        )
        return False
