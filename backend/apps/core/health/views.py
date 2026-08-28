from django.conf import settings
from django.db import connection
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response


@api_view(["GET"])
@permission_classes([AllowAny])
def health_check(request):
    """Liveness: confirma que el proceso responde. No depende de servicios
    externos (DB, correo) a propósito — un chequeo de vida no debe fallar
    solo porque una dependencia esté lenta; para eso está /health/ready/."""
    return Response({"status": "ok", "system_name": settings.SYSTEM_NAME})


@api_view(["GET"])
@permission_classes([AllowAny])
def readiness_check(request):
    """Readiness: confirma que las dependencias reales estén listas para
    servir tráfico (hoy, la base de datos). Nunca expone secretos ni
    credenciales — solo un estado ok/unavailable por componente."""
    db_status = "ok"
    try:
        connection.ensure_connection()
    except Exception:  # noqa: BLE001
        db_status = "unavailable"

    overall_status = "ok" if db_status == "ok" else "unavailable"
    return Response(
        {"status": overall_status, "components": {"database": db_status}},
        status=200 if overall_status == "ok" else 503,
    )
