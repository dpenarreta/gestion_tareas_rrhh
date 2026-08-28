import logging
import threading
import time
import uuid

_request_context = threading.local()

logger = logging.getLogger("apps.core")

REQUEST_ID_HEADER = "X-Request-ID"


class RequestIDLogFilter(logging.Filter):
    """Inyecta el request_id activo (por hilo) en cada registro de log estructurado."""

    def filter(self, record):
        record.request_id = getattr(_request_context, "request_id", "-")
        return True


class RequestIDMiddleware:
    """Propaga un identificador de correlación entre frontend y backend."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        request_id = request.headers.get(REQUEST_ID_HEADER, str(uuid.uuid4()))
        request.request_id = request_id
        _request_context.request_id = request_id
        try:
            response = self.get_response(request)
        finally:
            _request_context.request_id = "-"
        response[REQUEST_ID_HEADER] = request_id
        return response


class AccessLogMiddleware:
    """Registra cada petición en formato estructurado (método, ruta, estado, duración)."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        start = time.monotonic()
        response = self.get_response(request)
        duration_ms = round((time.monotonic() - start) * 1000, 2)
        logger.info(
            "%s %s -> %s (%sms)",
            request.method,
            request.path,
            response.status_code,
            duration_ms,
        )
        return response
