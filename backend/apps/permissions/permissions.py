"""Permiso DRF genérico basado en el catálogo por módulo."""

from rest_framework.permissions import SAFE_METHODS, BasePermission

from apps.core.audit import record_audit_event
from apps.core.models import AuditLog
from apps.core.request_meta import get_request_context

from .authorization import user_has_permission


class HasActionPermission(BasePermission):
    """Base genérica: exige el permiso del catálogo que devuelva
    `get_required_permission` para el request/vista actual. Si el usuario
    está autenticado pero no lo tiene, registra un intento no autorizado en
    auditoría antes de negar el acceso — subclases solo deciden *qué*
    permiso corresponde a cada acción, nunca reimplementan el chequeo ni el
    registro de auditoría."""

    def get_required_permission(self, request, view) -> str | None:
        raise NotImplementedError

    def has_permission(self, request, view) -> bool:
        codename = self.get_required_permission(request, view)
        if codename is None:
            return True

        if user_has_permission(request.user, codename):
            return True

        if request.user and request.user.is_authenticated:
            self.message = f"No tiene el permiso requerido: {codename}."
            record_audit_event(
                actor=request.user,
                action="access_denied",
                target=request.user,
                new_values={
                    "required_permission": codename,
                    "method": request.method,
                    "path": request.path,
                },
                result=AuditLog.Result.FAILURE,
                context=get_request_context(request),
            )
        return False


class HasModulePermission(HasActionPermission):
    """Exige un permiso del catálogo, distinto para lectura y escritura.

    Subclases definen `view_permission` (métodos seguros: GET/HEAD/OPTIONS)
    y `write_permission` (el resto).
    """

    view_permission: str | None = None
    write_permission: str | None = None

    def get_required_permission(self, request, view) -> str | None:
        return self.view_permission if request.method in SAFE_METHODS else self.write_permission
