"""Autenticación JWT consciente de sesiones.

Además de lo que ya valida `JWTAuthentication` (firma, expiración,
`user.is_active`), exige que el token tenga un claim `sid` y que la
`Session` referenciada siga activa (no revocada, no expirada). Esto
garantiza que deshabilitar un usuario o cerrar su sesión invalida el
access token en la siguiente petición, sin esperar a que expire por sí
solo.
"""

import logging

from django.core.exceptions import ValidationError
from rest_framework.exceptions import AuthenticationFailed, PermissionDenied
from rest_framework_simplejwt.authentication import JWTAuthentication

from .models import Session

logger = logging.getLogger("apps.authentication")

# Únicos endpoints alcanzables mientras `must_change_password` esté activo:
# el propio cambio de contraseña y las vías para terminar la sesión sin
# cambiarla. El JWT nunca lleva este flag (ver tokens.py), así que este es
# el único punto que corre en *toda* request autenticada sin excepción.
_ALLOWED_PATHS_WHEN_PASSWORD_CHANGE_REQUIRED = {
    "/api/v1/auth/password/change/",
    "/api/v1/auth/logout/",
    "/api/v1/auth/logout-all/",
    "/api/v1/auth/me/",
}


# Cabecera con la que el frontend marca sus peticiones automáticas (sondeo
# de notificaciones y del Escritorio Digital). No es un permiso ni cambia
# qué devuelve la API: solo dice "esto no lo pidió una persona", para que no
# cuente como actividad. Que alguien la falsifique no gana nada — a lo sumo
# adelanta el cierre de su propia sesión.
BACKGROUND_REQUEST_HEADER = "X-Nexo-Background"


def es_peticion_de_fondo(request) -> bool:
    return request.headers.get(BACKGROUND_REQUEST_HEADER) == "1"


class SessionIdleTimeout(AuthenticationFailed):
    """Misma trampa que `PasswordChangeRequired`: `api_exception_handler` lee
    `default_code` de la clase, así que pasar `code=` al constructor deja el
    `authentication_failed` genérico y el frontend no puede distinguir una
    sesión cerrada por inactividad de cualquier otro fallo de autenticación."""

    default_code = "session_idle_timeout"
    default_detail = "La sesión se cerró por inactividad."


class PasswordChangeRequired(PermissionDenied):
    """Subclase concreta: pasar `code=` al constructor de `PermissionDenied`
    no sobreescribe `default_code` (que es lo que lee
    `apps.core.exceptions.api_exception_handler` para exponer `error.code`
    al frontend), así que hace falta una subclase con su propio atributo."""

    default_code = "password_change_required"
    default_detail = "Debe cambiar su contraseña antes de continuar."


class SessionAuthentication(JWTAuthentication):
    def get_user(self, validated_token):
        user = super().get_user(validated_token)

        session_id = validated_token.get("sid")
        if not session_id:
            raise AuthenticationFailed("Token inválido.", code="token_not_valid")

        try:
            session = Session.objects.select_related("user").get(id=session_id, user=user)
        except (Session.DoesNotExist, ValueError, ValidationError):
            raise AuthenticationFailed("Token inválido.", code="token_not_valid") from None

        if not session.is_active:
            raise AuthenticationFailed("La sesión ya no es válida.", code="session_revoked")

        # Se revoca en el acto, no solo se rechaza la petición: una sesión
        # abandonada tiene que dejar de existir también para el refresh
        # token, que sigue siendo válido durante días.
        if session.is_idle():
            session.revoke()
            # Este cierre no dejaba rastro: el único log de inactividad estaba
            # en el refresco, así que las sesiones cerradas acá desaparecían
            # sin explicación y falseaban cualquier conteo por motivo.
            logger.info(
                "Sesión cerrada por inactividad en una petición (sesión=%s, última actividad=%s)",
                session.id,
                session.last_used_at.isoformat(),
            )
            raise SessionIdleTimeout()

        validated_token.session = session
        return user

    def authenticate(self, request):
        result = super().authenticate(request)
        if result is None:
            return None

        user, validated_token = result
        if (
            user.must_change_password
            and request.path not in _ALLOWED_PATHS_WHEN_PASSWORD_CHANGE_REQUIRED
        ):
            raise PasswordChangeRequired()

        # El reloj de inactividad solo lo mueve la persona. El sondeo
        # automático del frontend se identifica con `X-Nexo-Background` y se
        # ignora acá: si contara, bastaría una pestaña abierta y olvidada
        # para que la sesión no caducara nunca.
        session = getattr(validated_token, "session", None)
        if session is not None and not es_peticion_de_fondo(request):
            session.touch()
        return result
