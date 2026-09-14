"""Emisión de tokens JWT con el claim mínimo necesario.

El token nunca lleva password, permisos ni datos sensibles: solo
identificador de usuario, identificador de sesión (`sid`), tipo de token,
fecha de emisión y de expiración (estos tres últimos ya los añade
simplejwt por defecto: `token_type`, `iat`, `exp`).
"""

from rest_framework_simplejwt.tokens import RefreshToken

from .models import Session


def issue_access_token(user, session: Session) -> dict:
    """Solo el access token, sin rotar el refresh.

    Lo usa el reintento concurrente dentro de la ventana de gracia (ver
    `AuthenticationService.refresh_tokens`): devolver también un refresh
    nuevo dejaría dos refresh válidos en circulación y el siguiente uso del
    perdedor revocaría la sesión — exactamente lo que se quiere evitar. El
    cliente conserva el que ya tiene (`djangoSession.ts` y `proxy.ts` solo
    reescriben la cookie de refresh si la respuesta trae una)."""
    refresh = RefreshToken.for_user(user)
    refresh["sid"] = str(session.id)
    access = refresh.access_token
    access["sid"] = str(session.id)
    return {"access": str(access)}


def issue_token_pair(user, session: Session) -> dict:
    refresh = RefreshToken.for_user(user)
    refresh["sid"] = str(session.id)
    access = refresh.access_token
    access["sid"] = str(session.id)
    return {"access": str(access), "refresh": str(refresh), "refresh_jti": refresh["jti"]}
