"""Enmascarado de datos sensibles antes de persistir un registro de
auditoría — centralizado en `record_audit_event`, no por convención de
cada llamador (ver `apps/core/audit.py`)."""

MASK_PLACEHOLDER = "***"

# Coincidencia por substring, case-insensitive: cualquier clave que
# contenga alguno de estos fragmentos se enmascara. Deliberadamente
# amplio (mejor de más que dejar pasar una contraseña por un nombre de
# campo no previsto).
SENSITIVE_FIELD_FRAGMENTS = [
    "password",
    "contrasena",
    "contraseña",
    "token",
    "secret",
    "refresh",
    "access",
    "key",
    "authorization",
    "credential",
]


def _is_sensitive_field(field_name: str) -> bool:
    lowered = field_name.lower()
    return any(fragment in lowered for fragment in SENSITIVE_FIELD_FRAGMENTS)


def mask_sensitive_fields(data: dict | None) -> dict:
    """Devuelve una copia de `data` con los valores de campos sensibles
    reemplazados por un marcador — nunca contraseñas, tokens, secretos ni
    claves en texto plano en el registro de auditoría."""
    if not data:
        return {}
    return {
        key: (MASK_PLACEHOLDER if _is_sensitive_field(str(key)) else value)
        for key, value in data.items()
    }
