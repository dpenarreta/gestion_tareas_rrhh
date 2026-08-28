from django.conf import settings
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response


@api_view(["GET"])
@permission_classes([AllowAny])
def version_info(request):
    """Información de versión sin datos sensibles: nunca expone claves,
    URLs de conexión ni ninguna variable de entorno cruda."""
    return Response(
        {
            "version": settings.APP_VERSION,
            "system_name": settings.SYSTEM_NAME,
            "environment": settings.ENVIRONMENT_NAME,
        }
    )
