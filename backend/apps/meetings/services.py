"""Orquestación de creación de reuniones — Fase 10 (ver
docs/AUDIT_LOG.md § 2026-08-19). Réplica exacta de `POST
/api/meetings` (`route.ts`): llamada a Zoom con fallback simulado si
falla, notificación a los invitados."""

import logging
import random
import string
from datetime import datetime

from apps.notifications.services import notify_many
from apps.users.models import User

from . import zoom
from .models import Meeting, MeetingInvitee

logger = logging.getLogger(__name__)

# Duración fija enviada a Zoom para TODAS las reuniones, independiente
# de `duration` (la duración real ingresada por el usuario) — réplica
# exacta de `createZoomMeeting(title.trim(), new Date(meetingDate), 40)`
# en `route.ts`. No es un descuido: el legacy siempre manda 40,
# aparentemente para no exceder el límite de 40 min del plan gratuito
# de Zoom sin importar la duración real planificada de la reunión.
_ZOOM_REQUEST_DURATION_MINUTES = 40


def _simulated_zoom_meeting() -> dict:
    """Réplica exacta del fallback inline de `route.ts` quand Zoom
    falla — IDs/contraseña simulados, nunca persistidos como reales."""
    zoom_meeting_id = str(random.randint(1_000_000_000, 9_999_999_999))  # noqa: S311 — fallback simulado, no criptográfico
    zoom_password = "".join(random.choices(string.ascii_uppercase + string.digits, k=6))  # noqa: S311
    return {
        "zoom_meeting_id": zoom_meeting_id,
        "zoom_join_url": f"https://zoom.us/j/{zoom_meeting_id}",
        "zoom_password": zoom_password,
    }


def create_meeting(
    *, host, title: str, description: str | None, meeting_date: datetime, duration: int, invitee_ids: list[int]
) -> tuple[Meeting, str | None]:
    """Réplica exacta del `POST` handler: crea la reunión (con Zoom
    real o fallback simulado) y notifica a los invitados (nunca al
    propio anfitrión, filtrado antes de crear). Devuelve
    `(meeting, zoom_warning)` — `zoom_warning` no-`None` solo si la
    llamada real a Zoom falló."""
    zoom_warning: str | None = None
    try:
        zoom_meeting = zoom.create_zoom_meeting(topic=title, start_time=meeting_date, duration=_ZOOM_REQUEST_DURATION_MINUTES)
    except Exception:
        logger.exception("[meetings] Zoom API falló, usando link simulado")
        zoom_meeting = _simulated_zoom_meeting()
        zoom_warning = "No se pudo conectar con Zoom. Se generó un enlace simulado."

    invitee_ids = [uid for uid in invitee_ids if uid != host.id]

    meeting = Meeting.objects.create(
        title=title, description=description or None, host=host, meeting_date=meeting_date, duration=duration, **zoom_meeting
    )

    if invitee_ids:
        MeetingInvitee.objects.bulk_create([MeetingInvitee(meeting=meeting, user_id=uid) for uid in invitee_ids])
        invitee_users = User.objects.filter(id__in=invitee_ids)
        # `task_id`/`task_title` son campos heredados de Tareas en
        # `Notification` (ver docstring del modelo) — el TS original
        # reutiliza literalmente `taskTitle` para guardar el título de
        # la reunión; se replica igual para no perder ese dato, no es
        # un error de tipeo.
        notify_many(users=invitee_users, message=f'Te invitaron a la reunión "{meeting.title}"', task_title=meeting.title)

    return meeting, zoom_warning
