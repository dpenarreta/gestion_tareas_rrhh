"""Autenticación JWT consciente de sesiones.

Además de lo que ya valida `JWTAuthentication` (firma, expiración,
`user.is_active`), exige que el token tenga un claim `sid` y que la
`Session` referenciada siga activa (no revocada, no expirada). Esto
garantiza que deshabilitar un usuario o cerrar su sesión invalida el
access token en la siguiente petición, sin esperar a que expire por sí
solo.
"""

from django.core.exceptions import ValidationError
from rest_framework.exceptions import AuthenticationFailed, PermissionDenied
from rest_framework_simplejwt.authentication import JWTAuthentication

from .models import Session

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

        validated_token.session = session
        return user

    def authenticate(self, request):
        result = super().authenticate(request)
        if result is None:
            return None

        user, _validated_token = result
        if (
            user.must_change_password
            and request.path not in _ALLOWED_PATHS_WHEN_PASSWORD_CHANGE_REQUIRED
        ):
            raise PasswordChangeRequired()
        return result
