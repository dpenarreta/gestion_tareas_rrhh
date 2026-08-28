"""Extracción de metadatos de red/dispositivo del request, reutilizable
entre apps (autenticación, auditoría, etc.)."""


def get_client_ip(request) -> str | None:
    """Prioriza X-Forwarded-For (seteado por un proxy/gateway) sobre REMOTE_ADDR."""
    forwarded_for = request.META.get("HTTP_X_FORWARDED_FOR")
    if forwarded_for:
        return forwarded_for.split(",")[0].strip()
    return request.META.get("REMOTE_ADDR")


def get_user_agent(request) -> str:
    return request.META.get("HTTP_USER_AGENT", "")


_BROWSER_MARKERS = [
    ("Edg/", "Edge"),
    ("OPR/", "Opera"),
    ("Chrome/", "Chrome"),
    ("Firefox/", "Firefox"),
    ("Safari/", "Safari"),
]

_OS_MARKERS = [
    ("Windows", "Windows"),
    ("Mac OS", "macOS"),
    ("Android", "Android"),
    ("iPhone", "iOS"),
    ("iPad", "iOS"),
    ("Linux", "Linux"),
]


def parse_user_agent(user_agent: str) -> dict:
    """Heurística simple de "mejor esfuerzo" por substrings — no reemplaza
    una librería dedicada de parsing de user-agent. Suficiente para mostrar
    contexto legible en auditoría, no para decisiones de seguridad."""
    ua = user_agent or ""

    browser = next((label for marker, label in _BROWSER_MARKERS if marker in ua), "Desconocido")
    operating_system = next((label for marker, label in _OS_MARKERS if marker in ua), "Desconocido")

    ua_lower = ua.lower()
    if "mobile" in ua_lower:
        device = "Móvil"
    elif "tablet" in ua_lower or "ipad" in ua_lower:
        device = "Tablet"
    else:
        device = "Escritorio"

    return {"browser": browser, "operating_system": operating_system, "device": device}


def get_request_context(request) -> dict:
    """Contexto completo de un request, para pasar a `record_audit_event`:
    IP, user-agent crudo, navegador/SO/dispositivo (mejor esfuerzo) y el
    correlation id ya propagado por `apps.core.middleware.RequestIDMiddleware`."""
    user_agent = get_user_agent(request)
    parsed = parse_user_agent(user_agent)
    return {
        "ip_address": get_client_ip(request),
        "user_agent": user_agent,
        "browser": parsed["browser"],
        "operating_system": parsed["operating_system"],
        "device": parsed["device"],
        "correlation_id": getattr(request, "request_id", ""),
    }
