"""Registro de eventos de auditoría, reutilizable por cualquier módulo.

Único punto de entrada al modelo `AuditLog` — ningún llamador escribe ahí
directamente, así que el enmascarado de datos sensibles
(`apps.core.sensitive_data.mask_sensitive_fields`) se aplica siempre, sin
depender de que cada `services.py` se acuerde de hacerlo.
"""

from .models import AuditLog
from .sensitive_data import mask_sensitive_fields


def record_audit_event(
    *,
    actor,
    action: str,
    target=None,
    target_type: str | None = None,
    target_id: str | int | None = None,
    module: str = "",
    previous_values: dict | None = None,
    new_values: dict | None = None,
    result: str = AuditLog.Result.SUCCESS,
    context: dict | None = None,
) -> AuditLog:
    """Registra un evento. `target` infiere `target_type`/`target_id` del
    objeto (`__class__.__name__`, `pk`); pásalos explícitos en su lugar
    cuando el objeto ya no exista (ej. tras eliminarlo). `context` es el
    dict de `apps.core.request_meta.get_request_context(request)` — IP,
    user-agent, navegador/SO/dispositivo y correlation id."""
    if target is not None:
        target_type = target.__class__.__name__.lower()
        target_id = target.pk

    context = context or {}

    return AuditLog.objects.create(
        actor=actor,
        action=action,
        module=module,
        target_type=target_type or "",
        target_id=str(target_id) if target_id is not None else "",
        previous_values=mask_sensitive_fields(previous_values),
        new_values=mask_sensitive_fields(new_values),
        result=result,
        ip_address=context.get("ip_address"),
        user_agent=context.get("user_agent", ""),
        browser=context.get("browser", ""),
        operating_system=context.get("operating_system", ""),
        device=context.get("device", ""),
        correlation_id=context.get("correlation_id", ""),
    )
