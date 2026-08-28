from django.utils import timezone
from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from apps.core.request_meta import get_client_ip, get_request_context, get_user_agent
from apps.permissions.authorization import get_user_permission_codenames
from apps.users.serializers import UserPublicSerializer

from .models import Session
from .serializers import (
    ChangeOwnPasswordSerializer,
    LoginSerializer,
    MeUpdateSerializer,
    PasswordResetConfirmSerializer,
    PasswordResetRequestSerializer,
    RefreshSerializer,
    RegisterSerializer,
    SessionSerializer,
)
from .services import (
    PASSWORD_RESET_GENERIC_MESSAGE,
    AuthenticationService,
    PasswordResetService,
    SessionService,
    cleanup_expired_login_attempts,
    count_expired_login_attempts,
)


def _role_name(user) -> str:
    """`is_superuser` siempre resuelve a ADMINISTRADOR — mismo criterio
    que `apps.configuration.views.role_name` y equivalentes en
    reports/meetings/ideas/data_requests/desk."""
    if user.is_superuser:
        return "ADMINISTRADOR"
    group = user.groups.first()
    return group.name if group else ""


class RegisterView(APIView):
    """Controlador: valida entrada (serializer) y delega a services."""

    permission_classes = [AllowAny]

    def post(self, request):
        serializer = RegisterSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = AuthenticationService.register_user(**serializer.validated_data)
        tokens = AuthenticationService.issue_tokens_for(
            user, ip_address=get_client_ip(request), user_agent=get_user_agent(request)
        )
        return Response(
            {"user": UserPublicSerializer(user).data, "tokens": tokens},
            status=status.HTTP_201_CREATED,
        )


class LoginView(APIView):
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "login"

    def post(self, request):
        serializer = LoginSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        tokens = AuthenticationService.authenticate_and_issue_tokens(
            **serializer.validated_data,
            ip_address=get_client_ip(request),
            user_agent=get_user_agent(request),
        )
        return Response(tokens, status=status.HTTP_200_OK)


class RefreshView(APIView):
    """Renueva el access token validando que la sesión siga activa y que el
    refresh token presentado sea el vigente (no uno ya rotado)."""

    permission_classes = [AllowAny]

    def post(self, request):
        serializer = RefreshSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        tokens = AuthenticationService.refresh_tokens(
            refresh_token_str=serializer.validated_data["refresh"],
            ip_address=get_client_ip(request),
        )
        return Response(tokens, status=status.HTTP_200_OK)


class PasswordResetRequestView(APIView):
    """Solicitud pública de recuperación. Responde siempre el mismo mensaje
    genérico, exista o no la cuenta (ver `PasswordResetService.request_reset`)."""

    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "password_reset"

    def post(self, request):
        serializer = PasswordResetRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        PasswordResetService.request_reset(
            identifier=serializer.validated_data["identifier"],
            context=get_request_context(request),
        )
        return Response({"detail": PASSWORD_RESET_GENERIC_MESSAGE}, status=status.HTTP_200_OK)


class PasswordResetConfirmView(APIView):
    """Confirmación del enlace de recuperación con la nueva contraseña."""

    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "password_reset"

    def post(self, request):
        serializer = PasswordResetConfirmSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        PasswordResetService.confirm_reset(
            raw_token=serializer.validated_data["token"],
            new_password=serializer.validated_data["new_password"],
            context=get_request_context(request),
        )
        return Response(status=status.HTTP_204_NO_CONTENT)


class ChangeOwnPasswordView(APIView):
    """Cambio de contraseña autenticado — vía de salida del flujo forzado
    por un administrador (`must_change_password`)."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        serializer = ChangeOwnPasswordSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        current_session = getattr(request.auth, "session", None)
        PasswordResetService.change_own_password(
            user=request.user,
            new_password=serializer.validated_data["new_password"],
            keep_session_id=current_session.id if current_session else None,
            context=get_request_context(request),
        )
        return Response(status=status.HTTP_204_NO_CONTENT)


class AcceptConsentView(APIView):
    """`PATCH /api/v1/auth/consent/` — auto-servicio: el usuario acepta
    el aviso de privacidad LOPD. Réplica exacta de `PATCH
    /api/auth/consent` — Fase 13 (ver docs/AUDIT_LOG.md §
    2026-08-19)."""

    permission_classes = [IsAuthenticated]

    def patch(self, request):
        request.user.data_consent_accepted = True
        request.user.data_consent_accepted_at = timezone.now()
        request.user.save(update_fields=["data_consent_accepted", "data_consent_accepted_at", "updated_at"])
        return Response(
            {
                "data_consent_accepted": request.user.data_consent_accepted,
                "data_consent_accepted_at": request.user.data_consent_accepted_at,
            }
        )


class LogoutView(APIView):
    """Cierra la sesión actual (la asociada al access token presentado)."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        session = getattr(request.auth, "session", None)
        if session is not None:
            SessionService.logout(session)
        return Response(status=status.HTTP_204_NO_CONTENT)


class LogoutAllView(APIView):
    """Cierra todas las sesiones activas del usuario autenticado."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        SessionService.logout_all(request.user)
        return Response(status=status.HTTP_204_NO_CONTENT)


class SessionListView(APIView):
    """Lista las sesiones activas del usuario autenticado (dispositivo, IP, fechas)."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        current_session = getattr(request.auth, "session", None)
        sessions = Session.objects.filter(user=request.user, revoked_at__isnull=True).order_by(
            "-last_used_at"
        )
        serializer = SessionSerializer(
            sessions,
            many=True,
            context={"current_session_id": current_session.id if current_session else None},
        )
        return Response(serializer.data)


class MeView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        data = UserPublicSerializer(request.user).data
        # El JWT nunca lleva permisos; el frontend los obtiene aquí —ya en la
        # convención "modulo.accion" del catálogo— para decidir qué mostrar
        # en el menú sin otra llamada.
        data["permissions"] = sorted(get_user_permission_codenames(request.user))
        return Response(data)

    def patch(self, request):
        """Auto-servicio de perfil — Fase 6b (ver docs/AUDIT_LOG.md §
        2026-08-17). Sin permiso administrativo: el usuario solo puede
        editar su propio `first_name`/`email`."""
        serializer = MeUpdateSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        update_fields = list(serializer.validated_data.keys())
        for field, value in serializer.validated_data.items():
            setattr(request.user, field, value)
        if update_fields:
            request.user.save(update_fields=update_fields)

        data = UserPublicSerializer(request.user).data
        data["permissions"] = sorted(get_user_permission_codenames(request.user))
        return Response(data)


class LoginAttemptsCleanupView(APIView):
    """`GET/POST /api/v1/settings/login-attempts/cleanup/` — Fase 33
    (ver docs/AUDIT_LOG.md § 2026-08-21), réplica ADAPTADA de
    `route.ts`: `GET` es una vista previa (cuenta sin borrar), `POST`
    elimina. Ambos solo ADMINISTRADOR. Ver docstring de
    `count_expired_login_attempts`/`cleanup_expired_login_attempts`
    (`services.py`) para la adaptación del criterio de expiración al
    modelo `LoginAttempt` real de Django (log por evento, no contador
    agregado por IP como en el TS)."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        if _role_name(request.user) != "ADMINISTRADOR":
            return Response({"error": "Sin permisos"}, status=403)
        return Response({"expired_count": count_expired_login_attempts(timezone.now())})

    def post(self, request):
        if _role_name(request.user) != "ADMINISTRADOR":
            return Response({"error": "Sin permisos"}, status=403)
        return Response({"deleted": cleanup_expired_login_attempts(timezone.now())})
