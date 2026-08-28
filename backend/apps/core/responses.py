"""Helpers para respuestas de error uniformes en toda la API.

Contrato: { "error": { "code": str, "message": str, "details": dict | None } }
"""

from rest_framework.response import Response


def error_response(
    code: str, message: str, status_code: int, details: dict | None = None
) -> Response:
    return Response(
        {"error": {"code": code, "message": message, "details": details}},
        status=status_code,
    )
