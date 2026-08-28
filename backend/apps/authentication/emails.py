"""Envío de correos transaccionales del flujo de autenticación
(restablecimiento de contraseña). Una falla de envío nunca debe propagar
una excepción: rompería la respuesta genérica de los endpoints públicos de
recuperación (ver `apps.authentication.services.PasswordResetService`), que
debe ser idéntica exista o no la cuenta."""

import logging

from django.conf import settings
from django.core.mail import send_mail
from django.template.loader import render_to_string

logger = logging.getLogger("apps.authentication")


def _send_transactional_email(
    *, subject: str, template_name: str, context: dict, to: str, plain_message: str
) -> None:
    context = {**context, "system_name": settings.SYSTEM_NAME}
    try:
        html_message = render_to_string(template_name, context)
        send_mail(
            subject=subject,
            message=plain_message,
            from_email=settings.DEFAULT_FROM_EMAIL,
            recipient_list=[to],
            html_message=html_message,
        )
    except Exception:  # noqa: BLE001
        logger.exception("No se pudo enviar el correo %r a %s", template_name, to)


def send_password_reset_email(*, user, raw_token: str) -> None:
    reset_url = f"{settings.FRONTEND_URL.rstrip('/')}/reset-password?token={raw_token}"
    _send_transactional_email(
        subject=f"Recuperación de contraseña — {settings.SYSTEM_NAME}",
        template_name="emails/password_reset.html",
        context={
            "user": user,
            "reset_url": reset_url,
            "expiration_minutes": settings.PASSWORD_RESET_TOKEN_EXPIRATION_MINUTES,
        },
        to=user.email,
        plain_message=(
            f"Para restablecer tu contraseña en {settings.SYSTEM_NAME}, visita: {reset_url} "
            f"(válido por {settings.PASSWORD_RESET_TOKEN_EXPIRATION_MINUTES} minutos)."
        ),
    )


def send_password_changed_notification(*, user) -> None:
    _send_transactional_email(
        subject=f"Tu contraseña fue actualizada — {settings.SYSTEM_NAME}",
        template_name="emails/password_changed.html",
        context={"user": user},
        to=user.email,
        plain_message=(
            f"Tu contraseña en {settings.SYSTEM_NAME} fue actualizada. Si no fuiste tú, "
            "contacta a un administrador de inmediato."
        ),
    )
