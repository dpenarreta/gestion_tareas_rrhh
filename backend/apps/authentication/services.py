"""Lógica de negocio del dominio de autenticación (login, sesiones, JWT,
recuperación de contraseña). Las vistas delegan aquí — nunca acceden al ORM
ni aplican reglas de negocio directamente."""

import hashlib
import logging
import secrets
import uuid
from datetime import timedelta

from django.conf import settings
from django.contrib.auth.hashers import check_password, make_password
from django.db.models import Q
from django.utils import timezone
from rest_framework import serializers
from rest_framework.exceptions import AuthenticationFailed
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.tokens import RefreshToken

from apps.configuration.services import (
    get_effective_retention_login_attempts,
    get_effective_session_duration_default_hours,
    get_effective_session_duration_remember_hours,
)
from apps.core.audit import record_audit_event
from apps.core.models import AuditLog
from apps.core.request_meta import parse_user_agent
from apps.users.models import User

from .emails import (
    build_password_reset_url,
    send_password_changed_notification,
    send_password_reset_email,
)
from .models import LoginAttempt, PasswordResetToken, Session
from .tokens import issue_token_pair

logger = logging.getLogger("apps.authentication")

# Un único mensaje para credenciales inválidas, sin importar si el motivo
# fue "no existe", "password incorrecta" o "usuario deshabilitado" — evita
# que la respuesta permita enumerar usuarios existentes.
GENERIC_AUTH_ERROR = "No fue posible iniciar sesión con esas credenciales."
LOCKOUT_ERROR = "Demasiados intentos fallidos. Intente nuevamente en unos minutos."

# Hash "señuelo" calculado una sola vez al importar el módulo. Cuando el
# identificador no resuelve a ningún usuario, igual se ejecuta un chequeo
# de password contra este hash para que el costo (tiempo) de la respuesta
# sea equivalente al de un usuario real, mitigando ataques de temporización
# que de otro modo revelarían si la cuenta existe.
_DUMMY_PASSWORD_HASH = make_password(uuid.uuid4().hex)


class BruteForceProtectionService:
    """Bloqueo temporal por identificador tras demasiados intentos fallidos.

    El conteo se hace sobre `identifier` (el texto tecleado), no sobre el
    usuario resuelto: así un nombre de usuario inexistente se "bloquea"
    exactamente igual que uno real tras el mismo número de intentos, sin
    filtrar si la cuenta existe.
    """

    @staticmethod
    def is_locked_out(identifier: str) -> bool:
        window_start = timezone.now() - timedelta(minutes=settings.LOGIN_LOCKOUT_MINUTES)
        failed_count = LoginAttempt.objects.filter(
            identifier__iexact=identifier,
            successful=False,
            created_at__gte=window_start,
        ).count()
        return failed_count >= settings.LOGIN_MAX_FAILED_ATTEMPTS

    @staticmethod
    def record_attempt(
        *, identifier: str, ip_address: str | None, user: User | None, successful: bool
    ) -> None:
        LoginAttempt.objects.create(
            identifier=identifier, ip_address=ip_address, user=user, successful=successful
        )
        if not successful:
            logger.warning(
                "Intento de inicio de sesión fallido para identificador=%r desde ip=%s",
                identifier,
                ip_address,
            )


# --- Depuración de `LoginAttempt` (Fase 33, ver docs/AUDIT_LOG.md §
# 2026-08-21) — réplica ADAPTADA de `countExpiredLoginAttempts`/
# `cleanupExpiredLoginAttempts` (`src/lib/rate-limit.ts`): el TS opera
# sobre un modelo de CONTADOR agregado por IP (`attempts`/
# `blockedUntil`) y purga filas "ya no bloqueantes Y más antiguas que
# la retención". El `LoginAttempt` de Django (Fase 6a) es un LOG por
# evento (una fila por intento, sin estado de bloqueo propio — el
# bloqueo se deriva en `BruteForceProtectionService.is_locked_out`
# contando filas dentro de una ventana de `settings.LOGIN_LOCKOUT_MINUTES`,
# casi siempre minutos). Para este modelo, "más antigua que la
# retención" (días) ya implica "no bloqueante" — la ventana de bloqueo
# es órdenes de magnitud más corta que cualquier retención configurada
# — así que el criterio de purga se simplifica a un solo filtro por
# antigüedad, sin necesitar el estado de bloqueo que este modelo no
# almacena.
def _login_attempts_max_age(as_of) -> timedelta:
    days = int(get_effective_retention_login_attempts(as_of))
    return timedelta(days=days)


def count_expired_login_attempts(as_of) -> int:
    max_age = _login_attempts_max_age(as_of)
    return LoginAttempt.objects.filter(created_at__lt=as_of - max_age).count()


def cleanup_expired_login_attempts(as_of) -> int:
    max_age = _login_attempts_max_age(as_of)
    deleted, _ = LoginAttempt.objects.filter(created_at__lt=as_of - max_age).delete()
    return deleted


class SessionService:
    @staticmethod
    def create_session(*, user: User, ip_address: str | None, user_agent: str) -> Session:
        refresh_lifetime = settings.SIMPLE_JWT["REFRESH_TOKEN_LIFETIME"]
        return Session.objects.create(
            user=user,
            # Placeholder único y temporal: se reemplaza por el jti real del
            # refresh token justo después de emitirlo (ver AuthenticationService).
            refresh_token_jti=f"pending:{uuid.uuid4()}",
            device=parse_user_agent(user_agent)["device"],
            user_agent=(user_agent or "")[:255],
            ip_address=ip_address,
            expires_at=timezone.now() + refresh_lifetime,
        )

    @staticmethod
    def logout(session: Session) -> None:
        session.revoke()

    @staticmethod
    def logout_all(user: User, *, exclude_session_id=None) -> int:
        now = timezone.now()
        queryset = Session.objects.filter(user=user, revoked_at__isnull=True)
        if exclude_session_id is not None:
            queryset = queryset.exclude(id=exclude_session_id)
        return queryset.update(revoked_at=now)


class AuthenticationService:
    @staticmethod
    def register_user(
        *, username: str, email: str, password: str, first_name: str = "", last_name: str = ""
    ) -> User:
        user = User.objects.create_user(
            username=username,
            email=email,
            password=password,
            first_name=first_name,
            last_name=last_name,
        )
        return user

    @staticmethod
    def _resolve_user(identifier: str) -> User | None:
        return User.objects.filter(
            Q(username__iexact=identifier) | Q(email__iexact=identifier)
        ).first()

    @staticmethod
    def _issue_tokens_for_new_session(
        *, user: User, ip_address: str | None, user_agent: str
    ) -> dict:
        session = SessionService.create_session(
            user=user, ip_address=ip_address, user_agent=user_agent
        )
        tokens = issue_token_pair(user, session)
        session.refresh_token_jti = tokens.pop("refresh_jti")
        session.save(update_fields=["refresh_token_jti"])
        return tokens

    @staticmethod
    def issue_tokens_for(
        user: User, *, ip_address: str | None = None, user_agent: str = ""
    ) -> dict:
        return AuthenticationService._issue_tokens_for_new_session(
            user=user, ip_address=ip_address, user_agent=user_agent
        )

    @staticmethod
    def authenticate_and_issue_tokens(
        *, identifier: str, password: str, ip_address: str | None = None, user_agent: str = ""
    ) -> dict:
        if BruteForceProtectionService.is_locked_out(identifier):
            BruteForceProtectionService.record_attempt(
                identifier=identifier, ip_address=ip_address, user=None, successful=False
            )
            logger.warning(
                "Bloqueo por fuerza bruta activo para identificador=%r desde ip=%s",
                identifier,
                ip_address,
            )
            raise AuthenticationFailed(LOCKOUT_ERROR, code="account_locked")

        user = AuthenticationService._resolve_user(identifier)

        if user is None:
            # Chequeo de costo equivalente contra un hash señuelo (timing-safe).
            check_password(password, _DUMMY_PASSWORD_HASH)
            BruteForceProtectionService.record_attempt(
                identifier=identifier, ip_address=ip_address, user=None, successful=False
            )
            raise AuthenticationFailed(GENERIC_AUTH_ERROR, code="invalid_credentials")

        if not user.check_password(password) or not user.is_active:
            BruteForceProtectionService.record_attempt(
                identifier=identifier, ip_address=ip_address, user=user, successful=False
            )
            raise AuthenticationFailed(GENERIC_AUTH_ERROR, code="invalid_credentials")

        tokens = AuthenticationService._issue_tokens_for_new_session(
            user=user, ip_address=ip_address, user_agent=user_agent
        )
        BruteForceProtectionService.record_attempt(
            identifier=identifier, ip_address=ip_address, user=user, successful=True
        )
        # Fase 6a (ver docs/AUDIT_LOG.md § 2026-08-14): duración configurable
        # de `nexo-session` (la cookie de sesión de Next.js, independiente de
        # los JWT de Django) — el puente de login de Next.js la necesita para
        # no depender de Postgres para leerla.
        now = timezone.now()
        tokens["session_policy"] = {
            "default_hours": get_effective_session_duration_default_hours(now),
            "remember_hours": get_effective_session_duration_remember_hours(now),
        }
        return tokens

    @staticmethod
    def refresh_tokens(*, refresh_token_str: str, ip_address: str | None = None) -> dict:
        try:
            refresh = RefreshToken(refresh_token_str)
        except TokenError:
            raise AuthenticationFailed(
                "El token de actualización es inválido o expiró.", code="invalid_refresh"
            ) from None

        session = Session.objects.filter(id=refresh.get("sid")).select_related("user").first()

        if session is None:
            raise AuthenticationFailed(
                "El token de actualización es inválido.", code="invalid_refresh"
            )

        if not session.is_active:
            raise AuthenticationFailed("La sesión ya no es válida.", code="session_revoked")

        if session.refresh_token_jti != refresh.get("jti"):
            # El jti presentado no coincide con el vigente: es un refresh
            # token ya rotado que se está reutilizando. Se revoca la sesión
            # completa como medida de contención ante un posible robo.
            session.revoke()
            logger.error("Reutilización de refresh token detectada para sesión=%s", session.id)
            raise AuthenticationFailed(
                "El token de actualización ya no es válido.", code="refresh_reused"
            )

        if not session.user.is_active:
            session.revoke()
            raise AuthenticationFailed("La sesión ya no es válida.", code="session_revoked")

        tokens = issue_token_pair(session.user, session)
        session.refresh_token_jti = tokens.pop("refresh_jti")
        if ip_address:
            session.ip_address = ip_address
        session.save(update_fields=["refresh_token_jti", "ip_address", "last_used_at"])
        return tokens


PASSWORD_RESET_GENERIC_MESSAGE = (
    "Si el dato ingresado corresponde a una cuenta, se enviará un enlace de "
    "recuperación al correo asociado."
)
PASSWORD_RESET_INVALID_TOKEN_ERROR = "El enlace de recuperación no es válido o expiró."


def _generate_raw_reset_token() -> str:
    return secrets.token_urlsafe(32)


def _hash_reset_token(raw_token: str) -> str:
    return hashlib.sha256(raw_token.encode()).hexdigest()


class PasswordResetService:
    """Recuperación autónoma (token de un solo uso enviado por correo) y
    restablecimiento administrativo de contraseña.

    `request_reset` nunca revela si un identificador corresponde a una
    cuenta real: la vista responde siempre el mismo mensaje genérico sin
    importar qué rama de este servicio se ejecutó.
    """

    @staticmethod
    def _issue_reset_token(user: User) -> str:
        # Invalida cualquier enlace anterior no usado: solo el más reciente
        # sirve para restablecer la contraseña.
        PasswordResetToken.objects.filter(user=user, used_at__isnull=True).update(
            used_at=timezone.now()
        )
        raw_token = _generate_raw_reset_token()
        expires_at = timezone.now() + timedelta(
            minutes=settings.PASSWORD_RESET_TOKEN_EXPIRATION_MINUTES
        )
        PasswordResetToken.objects.create(
            user=user, token_hash=_hash_reset_token(raw_token), expires_at=expires_at
        )
        return raw_token

    @staticmethod
    def request_reset(*, identifier: str, context: dict | None = None) -> None:
        user = AuthenticationService._resolve_user(identifier)
        if user is None or user.status != User.Status.ACTIVE:
            # Ninguna escritura, ningún correo: la cuenta no existe, o existe
            # pero no está activa. La respuesta de la vista es idéntica.
            return

        raw_token = PasswordResetService._issue_reset_token(user)
        send_password_reset_email(user=user, raw_token=raw_token)
        record_audit_event(
            actor=user,
            action="user.password_reset_requested",
            target=user,
            module="usuarios",
            context=context,
        )

    @staticmethod
    def confirm_reset(*, raw_token: str, new_password: str, context: dict | None = None) -> None:
        token = (
            PasswordResetToken.objects.select_related("user")
            .filter(token_hash=_hash_reset_token(raw_token))
            .first()
        )

        if token is None:
            record_audit_event(
                actor=None,
                action="user.password_reset_rejected",
                module="usuarios",
                result=AuditLog.Result.FAILURE,
                new_values={"reason": "token_not_found"},
                context=context,
            )
            raise serializers.ValidationError({"token": [PASSWORD_RESET_INVALID_TOKEN_ERROR]})

        if not token.is_valid:
            record_audit_event(
                actor=token.user,
                action="user.password_reset_rejected",
                target=token.user,
                module="usuarios",
                result=AuditLog.Result.FAILURE,
                new_values={"reason": "used" if token.used_at else "expired"},
                context=context,
            )
            raise serializers.ValidationError({"token": [PASSWORD_RESET_INVALID_TOKEN_ERROR]})

        user = token.user
        user.set_password(new_password)
        user.must_change_password = False
        user.save(update_fields=["password", "must_change_password", "updated_at"])

        token.used_at = timezone.now()
        token.save(update_fields=["used_at"])

        revoked_count = SessionService.logout_all(user)

        record_audit_event(
            actor=user,
            action="user.password_reset_completed",
            target=user,
            module="usuarios",
            new_values={"revoked_sessions": revoked_count},
            context=context,
        )
        send_password_changed_notification(user=user)

    @staticmethod
    def admin_initiate_reset(
        *,
        actor: User,
        user: User,
        send_link: bool,
        force_change_on_next_login: bool,
        revoke_sessions: bool,
        return_link: bool = False,
        context: dict | None = None,
    ) -> dict:
        """El administrador nunca ve ni define la nueva contraseña: solo
        dispara el envío del enlace, lo obtiene para entregarlo por otro
        medio, activa el flag de cambio obligatorio y/o revoca sesiones. Al
        menos una opción debe venir en `True` (validado en el serializer, no
        aquí).

        `return_link` devuelve la URL en vez de enviarla por correo. Es un
        enlace de un solo uso y con vencimiento
        (`PASSWORD_RESET_TOKEN_EXPIRATION_MINUTES`), pero mientras esté
        vigente equivale a poder entrar a esa cuenta: por eso exige el
        permiso `usuarios.restablecer_password`, queda auditado, y el token
        NO se registra en el log (solo el hecho de haberlo generado).

        Cuando se piden las dos, `send_link` y `return_link` comparten el
        mismo token: emitir uno nuevo invalidaría el anterior y el correo
        llegaría con un enlace ya muerto.
        """
        revoked_count = 0
        reset_url = None

        if send_link or return_link:
            raw_token = PasswordResetService._issue_reset_token(user)
            if send_link:
                send_password_reset_email(user=user, raw_token=raw_token)
            if return_link:
                reset_url = build_password_reset_url(raw_token)

        if force_change_on_next_login:
            user.must_change_password = True
            user.save(update_fields=["must_change_password", "updated_at"])

        if revoke_sessions:
            revoked_count = SessionService.logout_all(user)

        record_audit_event(
            actor=actor,
            action="user.password_reset_admin_initiated",
            target=user,
            module="usuarios",
            new_values={
                "send_link": send_link,
                # Se registra que se generó un enlace para entrega manual,
                # nunca el enlace ni el token: el registro de auditoría lo
                # pueden leer más personas que las que pueden restablecer.
                "return_link": return_link,
                "force_change_on_next_login": force_change_on_next_login,
                "revoke_sessions": revoke_sessions,
                "revoked_sessions_count": revoked_count,
            },
            context=context,
        )

        return {"reset_url": reset_url}

    @staticmethod
    def change_own_password(
        *,
        user: User,
        new_password: str,
        keep_session_id=None,
        context: dict | None = None,
    ) -> None:
        """Usado por el flujo de cambio obligatorio (`must_change_password`).
        Revoca las demás sesiones activas pero preserva `keep_session_id`
        (la sesión recién usada para autenticarse), para no desloguear al
        usuario justo después de cumplir el requisito."""
        user.set_password(new_password)
        user.must_change_password = False
        user.save(update_fields=["password", "must_change_password", "updated_at"])

        revoked_count = SessionService.logout_all(user, exclude_session_id=keep_session_id)

        record_audit_event(
            actor=user,
            action="user.password_changed_self",
            target=user,
            module="usuarios",
            new_values={"revoked_other_sessions": revoked_count},
            context=context,
        )
        send_password_changed_notification(user=user)
