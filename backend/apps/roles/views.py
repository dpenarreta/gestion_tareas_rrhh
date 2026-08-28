from django.contrib.auth.models import Group
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.core.request_meta import get_request_context
from apps.permissions.catalog import PERMISSION_CATALOG

from .permissions import RolesPermission
from .serializers import RoleSerializer, RoleWriteSerializer
from .services import RoleService


class RoleViewSet(viewsets.ModelViewSet):
    """CRUD de roles (`auth.Group`). A diferencia de usuarios, sí admite
    eliminación física: un rol es configuración reutilizable, no una cuenta
    con historial que preservar."""

    permission_classes = [IsAuthenticated, RolesPermission]
    queryset = Group.objects.all().order_by("name")

    def get_serializer_class(self):
        if self.action in {"create", "update", "partial_update"}:
            return RoleWriteSerializer
        return RoleSerializer

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        role = RoleService.create_role(
            actor=request.user, context=get_request_context(request), **serializer.validated_data
        )
        return Response(RoleSerializer(role).data, status=status.HTTP_201_CREATED)

    def update(self, request, *args, **kwargs):
        instance = self.get_object()
        partial = kwargs.pop("partial", False)
        serializer = self.get_serializer(instance, data=request.data, partial=partial)
        serializer.is_valid(raise_exception=True)
        role = RoleService.update_role(
            actor=request.user,
            role=instance,
            context=get_request_context(request),
            **serializer.validated_data,
        )
        return Response(RoleSerializer(role).data)

    def partial_update(self, request, *args, **kwargs):
        kwargs["partial"] = True
        return self.update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        RoleService.delete_role(
            actor=request.user, role=self.get_object(), context=get_request_context(request)
        )
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=False, methods=["get"], url_path="permissions-catalog")
    def permissions_catalog(self, request):
        return Response(PERMISSION_CATALOG)
