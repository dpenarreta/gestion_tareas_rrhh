"""El refresco de tokens no puede caer en el throttle anónimo.

Todas las llamadas a Django llegan desde el servidor de Next.js, así que
cualquier límite "por IP" es en realidad un límite para toda la organización
junta. Con el `anon` heredado (100/hora) el techo se superaba todas las horas
del día —medido en producción: 120/hora de madrugada, 227 en horario laboral—
y la gente quedaba fuera a los ~15 minutos, cuando vencía su access token, sin
importar la ventana de inactividad configurada.
"""

import pytest
from django.conf import settings
from rest_framework.test import APIClient

from apps.authentication.views import RefreshView
from apps.users.models import User

pytestmark = pytest.mark.django_db


def _rate_por_hora(rate: str) -> float:
    cantidad, periodo = rate.split("/")
    factor = {"s": 3600, "min": 60, "hour": 1, "day": 1 / 24}[periodo]
    return int(cantidad) * factor


def test_el_refresco_tiene_scope_propio():
    # Sin esto hereda `AnonRateThrottle`, que es el bug.
    assert RefreshView.throttle_scope == "token_refresh"
    assert "token_refresh" in settings.REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"]


def test_el_limite_soporta_a_toda_la_organizacion():
    """Cada sesión gasta 4 refrescos/hora solo por el vencimiento del access
    (15 min), y el contador es compartido. Un techo que no aguante decenas de
    personas simultáneas vuelve a expulsar a todo el mundo."""
    rates = settings.REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"]
    refresh_por_hora = _rate_por_hora(rates["token_refresh"])
    anon_por_hora = _rate_por_hora(rates["anon"])

    assert refresh_por_hora > anon_por_hora, "volvería a ser más estricto que el anónimo"
    # 4 refrescos/hora por persona × 100 personas, el orden de magnitud que el
    # sistema tiene que tolerar sin echar a nadie.
    assert refresh_por_hora >= 400


def test_un_refresco_invalido_no_consume_la_cuota_de_todos(settings):
    """Un token inválido debe responder 401, no 429: si el rechazo gastara
    cuota, un cliente en bucle dejaría sin sesión al resto."""
    User.objects.create_user(username="ada", email="ada@example.com", password="Sup3r-Secr3t!")
    client = APIClient()

    respuestas = [
        client.post(
            "/api/v1/auth/token/refresh/", {"refresh": "no-es-un-token"}, format="json"
        ).status_code
        for _ in range(12)
    ]

    assert all(c == 401 for c in respuestas), f"apareció un 429 en {respuestas}"
