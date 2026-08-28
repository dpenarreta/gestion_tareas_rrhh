from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .catalog import PERMISSION_CATALOG
from .permissions import HasModulePermission


class PermisosPermission(HasModulePermission):
    view_permission = "permisos.ver"
    write_permission = None  # el catálogo es de solo lectura: fuente de verdad en código


class PermissionCatalogView(APIView):
    """Catálogo completo de permisos disponibles, agrupado por módulo.

    De solo lectura a propósito: los permisos no son un recurso editable en
    runtime (ver docstring de `apps.permissions.catalog`) — asignarlos a un
    rol o a un usuario sí lo es, y eso vive en `apps.roles`/`apps.users`.
    """

    permission_classes = [IsAuthenticated, PermisosPermission]

    def get(self, request):
        return Response(PERMISSION_CATALOG)
