"""Cierre de sesión por inactividad real de la persona.

Lo que hace a esta ventana distinta de `expires_at` es qué la reinicia: solo
la actividad que origina una persona. El sondeo automático del frontend viaja
marcado con `X-Nexo-Background` y se ignora a propósito — contarlo dejaría viva
para siempre cualquier pestaña olvidada abierta, que es justo el caso que esto
cierra.
"""

from datetime import timedelta

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.authentication.models import Session
from apps.authentication.services import AuthenticationService
from apps.configuration.services import (
    CONFIG_KEY_SESSION_IDLE_TIMEOUT_HOURS,
    DEFAULT_SESSION_IDLE_TIMEOUT_HOURS,
    get_effective_session_idle_timeout_hours,
    set_config_value,
)
from apps.users.models import User

# La ventana se configura desde Ajustes -> Seguridad; los tests usan el valor
# efectivo, no una constante, para no romperse si cambia el default.
VENTANA = DEFAULT_SESSION_IDLE_TIMEOUT_HOURS

pytestmark = pytest.mark.django_db


@pytest.fixture
def api_client():
    return APIClient()


@pytest.fixture
def user():
    return User.objects.create_user(
        username="ada", email="ada@example.com", password="Sup3r-Secr3t!"
    )


def _sesion_de(user):
    return Session.objects.filter(user=user, revoked_at__isnull=True).latest("created_at")


def _envejecer(session, *, horas):
    """`last_used_at` es `auto_now`: solo un UPDATE directo lo puede retrasar."""
    Session.objects.filter(pk=session.pk).update(
        last_used_at=timezone.now() - timedelta(hours=horas)
    )
    session.refresh_from_db()
    return session


def _autenticar(api_client, user):
    tokens = AuthenticationService.issue_tokens_for(user)
    api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {tokens['access']}")
    return tokens


# --- La ventana ------------------------------------------------------------


def test_una_sesion_sin_actividad_se_cierra_y_queda_revocada(api_client, user):
    _autenticar(api_client, user)
    session = _envejecer(_sesion_de(user), horas=VENTANA + 1)

    response = api_client.get("/api/v1/auth/me/")

    assert response.status_code == 401
    assert response.data["error"]["code"] == "session_idle_timeout"
    session.refresh_from_db()
    # Revocada, no solo rechazada: el refresh token sigue siendo válido
    # durante días y también tiene que morir.
    assert session.revoked_at is not None


def test_una_sesion_usada_hace_un_rato_sigue_viva(api_client, user):
    _autenticar(api_client, user)
    _envejecer(_sesion_de(user), horas=VENTANA - 1)

    assert api_client.get("/api/v1/auth/me/").status_code == 200


def test_el_limite_exacto_cierra(api_client, user):
    _autenticar(api_client, user)
    session = _sesion_de(user)
    session.last_used_at = timezone.now() - timedelta(hours=VENTANA)

    assert session.is_idle() is True


# --- Qué cuenta como actividad --------------------------------------------


def test_una_peticion_normal_reinicia_el_contador(api_client, user):
    _autenticar(api_client, user)
    session = _envejecer(_sesion_de(user), horas=VENTANA - 1)
    antes = session.last_used_at

    api_client.get("/api/v1/auth/me/")

    session.refresh_from_db()
    assert session.last_used_at > antes


def test_el_sondeo_automatico_no_reinicia_el_contador(api_client, user):
    """El caso que da sentido a toda la función: la campana de notificaciones
    late cada 30s sola. Si contara, una pestaña abierta y olvidada mantendría
    la sesión viva para siempre y nada se cerraría jamás."""
    _autenticar(api_client, user)
    session = _envejecer(_sesion_de(user), horas=VENTANA - 1)
    antes = session.last_used_at

    response = api_client.get("/api/v1/auth/me/", HTTP_X_NEXO_BACKGROUND="1")

    assert response.status_code == 200
    session.refresh_from_db()
    assert session.last_used_at == antes


def test_el_sondeo_sobre_una_sesion_ya_vencida_igual_la_cierra(api_client, user):
    """No refrescar el contador no es lo mismo que no mirarlo: una petición de
    fondo sobre una sesión ya inactiva tiene que cerrarla igual."""
    _autenticar(api_client, user)
    session = _envejecer(_sesion_de(user), horas=VENTANA + 1)

    response = api_client.get("/api/v1/auth/me/", HTTP_X_NEXO_BACKGROUND="1")

    assert response.status_code == 401
    session.refresh_from_db()
    assert session.revoked_at is not None


def test_no_escribe_en_cada_peticion(api_client, user):
    """Con el sondeo y la navegación normal serían cientos de UPDATE por
    persona y hora contra SQL Server, para una ventana medida en horas."""
    _autenticar(api_client, user)
    session = _sesion_de(user)
    api_client.get("/api/v1/auth/me/")
    session.refresh_from_db()
    primera = session.last_used_at

    api_client.get("/api/v1/auth/me/")

    session.refresh_from_db()
    assert session.last_used_at == primera


# --- El refresh ------------------------------------------------------------


def test_refrescar_una_sesion_inactiva_la_revoca(user):
    tokens = AuthenticationService.issue_tokens_for(user)
    session = _envejecer(_sesion_de(user), horas=VENTANA + 1)

    with pytest.raises(Exception) as exc_info:
        AuthenticationService.refresh_tokens(refresh_token_str=tokens["refresh"])

    assert getattr(exc_info.value, "detail", None) is not None
    assert exc_info.value.detail.code == "session_idle_timeout"
    session.refresh_from_db()
    # La revocación tiene que sobrevivir al `raise`: dentro del `atomic` del
    # bloqueo de fila se revertiría sola (ver docs/AUDIT_LOG.md § 2026-09-14).
    assert session.revoked_at is not None


# --- La ventana es configurable desde Ajustes -------------------------------


def test_la_ventana_se_lee_de_la_configuracion(api_client, user):
    """El valor lo fija quien administra, desde Ajustes → Seguridad, no una
    variable de entorno: es una decisión de negocio y quien la toma no
    despliega."""
    _autenticar(api_client, user)
    set_config_value(CONFIG_KEY_SESSION_IDLE_TIMEOUT_HOURS, "2", user)
    _envejecer(_sesion_de(user), horas=3)

    response = api_client.get("/api/v1/auth/me/")

    assert response.status_code == 401
    assert response.data["error"]["code"] == "session_idle_timeout"


def test_subir_la_ventana_mantiene_viva_una_sesion_que_antes_caducaba(api_client, user):
    _autenticar(api_client, user)
    set_config_value(CONFIG_KEY_SESSION_IDLE_TIMEOUT_HOURS, "48", user)
    _envejecer(_sesion_de(user), horas=VENTANA + 1)

    # Con el default habría caducado; con la ventana ampliada, no.
    assert api_client.get("/api/v1/auth/me/").status_code == 200


def test_sin_configurar_usa_el_default(user):
    assert (
        get_effective_session_idle_timeout_hours(timezone.now())
        == DEFAULT_SESSION_IDLE_TIMEOUT_HOURS
    )


def test_el_cambio_se_aplica_sin_reiniciar(api_client, user):
    """Se lee en cada comprobación, no al arrancar: cambiar el valor en Ajustes
    tiene efecto en la siguiente petición."""
    _autenticar(api_client, user)
    session = _envejecer(_sesion_de(user), horas=5)

    set_config_value(CONFIG_KEY_SESSION_IDLE_TIMEOUT_HOURS, "10", user)
    assert session.is_idle() is False

    set_config_value(CONFIG_KEY_SESSION_IDLE_TIMEOUT_HOURS, "4", user)
    assert session.is_idle() is True
