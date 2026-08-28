"""Integración Zoom (OAuth Server-to-Server) — Fase 10 (ver
docs/AUDIT_LOG.md § 2026-08-19). Réplica exacta de `src/lib/zoom.ts`.
Primera llamada HTTP saliente del backend Django — no había ningún
patrón previo que copiar (confirmado: NOVA/Groq no se portaron), así
que se usa `requests` (agregado a `requirements/base.txt`), consistente
con el resto del stack síncrono DRF."""

import base64

import requests
from django.conf import settings

_TOKEN_URL = "https://zoom.us/oauth/token"
_MEETINGS_URL = "https://api.zoom.us/v2/users/me/meetings"
_TIMEOUT_SECONDS = 10


class ZoomError(Exception):
    """Cualquier falla al obtener el token o crear la reunión —
    réplica de los `throw new Error(...)` del TS. El caller
    (`services.create_meeting`) la atrapa para generar el fallback
    simulado, nunca se propaga hasta la vista."""


def _get_zoom_access_token() -> str:
    if not (settings.ZOOM_ACCOUNT_ID and settings.ZOOM_CLIENT_ID and settings.ZOOM_CLIENT_SECRET):
        raise ZoomError("Credenciales de Zoom no configuradas")

    basic_auth = base64.b64encode(f"{settings.ZOOM_CLIENT_ID}:{settings.ZOOM_CLIENT_SECRET}".encode()).decode()
    response = requests.post(
        _TOKEN_URL,
        params={"grant_type": "account_credentials", "account_id": settings.ZOOM_ACCOUNT_ID},
        headers={"Authorization": f"Basic {basic_auth}"},
        timeout=_TIMEOUT_SECONDS,
    )
    if not response.ok:
        raise ZoomError(f"Zoom OAuth falló (HTTP {response.status_code})")
    return response.json()["access_token"]


def create_zoom_meeting(*, topic: str, start_time, duration: int) -> dict:
    """Réplica exacta de `createZoomMeeting`. Devuelve
    `{zoom_meeting_id, zoom_join_url, zoom_password}`."""
    access_token = _get_zoom_access_token()
    response = requests.post(
        _MEETINGS_URL,
        json={
            "topic": topic,
            "start_time": start_time.isoformat(),
            "duration": duration,
            "type": 2,
            "settings": {"join_before_host": True},
        },
        headers={"Authorization": f"Bearer {access_token}", "Content-Type": "application/json"},
        timeout=_TIMEOUT_SECONDS,
    )
    if not response.ok:
        raise ZoomError(f"Zoom API falló al crear la reunión (HTTP {response.status_code})")

    data = response.json()
    return {
        "zoom_meeting_id": str(data["id"]),
        "zoom_join_url": data["join_url"],
        "zoom_password": data.get("password") or "",
    }
