"""Manejo centralizado de errores para toda la API (DRF)."""

import logging

from rest_framework.views import exception_handler

from .audit import record_audit_event
from .models import AuditLog
from .request_meta import get_request_context
from .responses import error_response

logger = logging.getLogger("apps.core")

_MUTATING_METHODS = {"POST", "PUT", "PATCH", "DELETE"}


def _audit_validation_failure(request, view, status_code) -> None:
    """Registra automáticamente cualquier fallo de validación (400) de un
    método mutante — un único punto transversal, en vez de repetir un
    try/except en cada `services.py`. Los 403 no se duplican aquí:
    `HasModulePermission` ya los audita con más detalle (el permiso
    específico exigido que faltó)."""
    if status_code != 400 or request is None or request.method not in _MUTATING_METHODS:
        return

    user = getattr(request, "user", None)
    if user is None or not user.is_authenticated:
        return

    try:
        view_name = view.__class__.__name__.lower() if view is not None else "unknown"
        target_id = ""
        resolver_match = getattr(request, "resolver_match", None)
        if resolver_match is not None:
            target_id = str(resolver_match.kwargs.get("pk", ""))

        record_audit_event(
            actor=user,
            action=f"{view_name}.validation_failed",
            target_type=view_name,
            target_id=target_id,
            new_values=dict(request.data) if hasattr(request, "data") else {},
            result=AuditLog.Result.FAILURE,
            context=get_request_context(request),
        )
    except Exception:  # noqa: BLE001
        # La auditoría nunca debe impedir que el error real llegue al
        # cliente — si falla el registro, solo se deja constancia en logs.
        logger.exception("No se pudo auditar un fallo de validación")


def api_exception_handler(exc, context):
    """Envuelve cualquier excepción de DRF en el contrato de error uniforme.

    Si DRF no reconoce la excepción (error no controlado), se registra con
    el logger estructurado y se devuelve un 500 genérico sin detalles
    internos, para no filtrar información sensible al cliente.
    """
    response = exception_handler(exc, context)

    if response is None:
        logger.exception("Error no controlado", exc_info=exc)
        return error_response(
            code="internal_error",
            message="Ocurrió un error interno. Intente nuevamente más tarde.",
            status_code=500,
        )

    _audit_validation_failure(context.get("request"), context.get("view"), response.status_code)

    code = getattr(exc, "default_code", exc.__class__.__name__.lower())
    message = response.data.get("detail") if isinstance(response.data, dict) else str(response.data)

    return error_response(
        code=str(code),
        message=str(message) if message else "Error en la solicitud.",
        status_code=response.status_code,
        details=(
            response.data
            if isinstance(response.data, dict) and "detail" not in response.data
            else None
        ),
    )
