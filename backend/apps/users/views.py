from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.authentication.models import Session
from apps.authentication.serializers import AdminPasswordResetSerializer, SessionSerializer
from apps.authentication.services import PasswordResetService
from apps.core.request_meta import get_request_context

from .filters import filter_users
from .models import User
from .pagination import UserAdminPagination
from .permissions import (
    IsAdministrator,
    UsuariosCreatePermission,
    UsuariosDeshabilitarPermission,
    UsuariosEliminarPermission,
    UsuariosPermission,
    UsuariosRestablecerPasswordPermission,
)
from .serializers import (
    PermissionAssignmentSerializer,
    RoleAssignmentSerializer,
    UserAdminCreateSerializer,
    UserAdminDetailSerializer,
    UserAdminListSerializer,
    UserAdminUpdateSerializer,
)
from .services import UserAdminService


class UserAdminViewSet(viewsets.ModelViewSet):
    """Módulo administrativo de usuarios.

    La baja lógica (`disable`/`block`) es el camino normal y preferido:
    conserva el historial y se revierte. `destroy` existe desde 2026-09-11
    por pedido explícito del usuario, para cuentas que no deberían haber
    existido (creadas por error, con el correo mal escrito, duplicadas). No
    reemplaza a la baja lógica: exige que la cuenta ya esté deshabilitada,
    de modo que borrar sea siempre una decisión en dos pasos. Ver
    `UserAdminService.delete_permanently` y docs/AUDIT_LOG.md § 2026-09-11.

    Cada acción exige un permiso distinto del catálogo (`usuarios.ver` /
    `usuarios.crear` / `usuarios.editar` / `usuarios.deshabilitar` /
    `usuarios.eliminar` / `usuarios.restablecer_password`).
    """

    http_method_names = ["get", "post", "patch", "delete", "head", "options"]
    pagination_class = UserAdminPagination
    queryset = User.objects.all().order_by("-created_at")

    ACTION_PERMISSION_CLASSES = {
        "create": [IsAuthenticated, UsuariosCreatePermission],
        "destroy": [IsAuthenticated, UsuariosEliminarPermission],
        "enable": [IsAuthenticated, UsuariosDeshabilitarPermission],
        "disable": [IsAuthenticated, UsuariosDeshabilitarPermission],
        "block": [IsAuthenticated, UsuariosDeshabilitarPermission],
        "unblock": [IsAuthenticated, UsuariosDeshabilitarPermission],
        "reset_password": [IsAuthenticated, UsuariosRestablecerPasswordPermission],
        "reset_consent_all": [IsAuthenticated, IsAdministrator],
    }
    DEFAULT_PERMISSION_CLASSES = [IsAuthenticated, UsuariosPermission]

    def get_permissions(self):
        permission_classes = self.ACTION_PERMISSION_CLASSES.get(
            self.action, self.DEFAULT_PERMISSION_CLASSES
        )
        return [permission() for permission in permission_classes]

    def get_queryset(self):
        return filter_users(super().get_queryset(), self.request.query_params)

    def get_serializer_class(self):
        if self.action == "list":
            return UserAdminListSerializer
        if self.action == "create":
            return UserAdminCreateSerializer
        if self.action == "partial_update":
            return UserAdminUpdateSerializer
        return UserAdminDetailSerializer

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = UserAdminService.create_user(
            actor=request.user, context=get_request_context(request), **serializer.validated_data
        )
        return Response(UserAdminDetailSerializer(user).data, status=status.HTTP_201_CREATED)

    def partial_update(self, request, *args, **kwargs):
        instance = self.get_object()
        serializer = self.get_serializer(instance, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        user = UserAdminService.update_user(
            actor=request.user,
            user=instance,
            context=get_request_context(request),
            **serializer.validated_data,
        )
        return Response(UserAdminDetailSerializer(user).data)

    def destroy(self, request, *args, **kwargs):
        UserAdminService.delete_permanently(
            actor=request.user,
            user=self.get_object(),
            context=get_request_context(request),
        )
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=["post"])
    def enable(self, request, pk=None):
        user = UserAdminService.enable(
            actor=request.user, user=self.get_object(), context=get_request_context(request)
        )
        return Response(UserAdminDetailSerializer(user).data)

    @action(detail=True, methods=["post"])
    def disable(self, request, pk=None):
        user = UserAdminService.disable(
            actor=request.user, user=self.get_object(), context=get_request_context(request)
        )
        return Response(UserAdminDetailSerializer(user).data)

    @action(detail=True, methods=["post"])
    def block(self, request, pk=None):
        user = UserAdminService.block(
            actor=request.user, user=self.get_object(), context=get_request_context(request)
        )
        return Response(UserAdminDetailSerializer(user).data)

    @action(detail=True, methods=["post"])
    def unblock(self, request, pk=None):
        user = UserAdminService.unblock(
            actor=request.user, user=self.get_object(), context=get_request_context(request)
        )
        return Response(UserAdminDetailSerializer(user).data)

    @action(detail=True, methods=["get"], url_path="sessions")
    def list_sessions(self, request, pk=None):
        sessions = Session.objects.filter(user=self.get_object(), revoked_at__isnull=True).order_by(
            "-last_used_at"
        )
        return Response(SessionSerializer(sessions, many=True).data)

    @action(detail=True, methods=["post"], url_path="sessions/revoke")
    def revoke_sessions(self, request, pk=None):
        revoked_count = UserAdminService.revoke_sessions(
            actor=request.user, user=self.get_object(), context=get_request_context(request)
        )
        return Response({"revoked_count": revoked_count})

    @action(detail=True, methods=["post"], url_path="password-reset")
    def reset_password(self, request, pk=None):
        serializer = AdminPasswordResetSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        PasswordResetService.admin_initiate_reset(
            actor=request.user,
            user=self.get_object(),
            context=get_request_context(request),
            **serializer.validated_data,
        )
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=["post"], url_path="reset-consent")
    def reset_consent(self, request, pk=None):
        """Réplica de `PATCH /api/users/[id]/reset-consent` — Fase 13
        (ver docs/AUDIT_LOG.md § 2026-08-19). Gateada por
        `UsuariosPermission` (permiso por defecto del viewset,
        `usuarios.editar` en escritura) — el TS usa
        `canManageUsers`+`canManageTargetUser`, ya superado en este
        backend por el catálogo de permisos (mismo criterio que
        `roles`/`permissions`, que tampoco replican esa jerarquía)."""
        user = UserAdminService.reset_consent(
            actor=request.user, user=self.get_object(), context=get_request_context(request)
        )
        return Response(UserAdminDetailSerializer(user).data)

    @action(detail=False, methods=["post"], url_path="reset-consent-all")
    def reset_consent_all(self, request):
        """Réplica de `PATCH /api/users/reset-consent-all` — Fase 13
        (ver docs/AUDIT_LOG.md § 2026-08-19). A diferencia de
        `reset_consent`, acá SÍ se replica el chequeo estricto del TS
        (`IsAdministrator`, solo ADMINISTRADOR) en vez del catálogo de
        permisos — es una acción masiva irreversible sobre todos los
        usuarios del sistema."""
        count = UserAdminService.reset_consent_all(
            actor=request.user, context=get_request_context(request)
        )
        return Response({"ok": True, "count": count})

    @action(detail=True, methods=["post"])
    def roles(self, request, pk=None):
        serializer = RoleAssignmentSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = UserAdminService.assign_roles(
            actor=request.user,
            user=self.get_object(),
            role_ids=serializer.validated_data["role_ids"],
            context=get_request_context(request),
        )
        return Response(UserAdminDetailSerializer(user).data)

    @action(detail=True, methods=["post"])
    def permissions(self, request, pk=None):
        serializer = PermissionAssignmentSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = UserAdminService.assign_permissions(
            actor=request.user,
            user=self.get_object(),
            permissions=serializer.validated_data["permission_codenames"],
            context=get_request_context(request),
        )
        return Response(UserAdminDetailSerializer(user).data)
