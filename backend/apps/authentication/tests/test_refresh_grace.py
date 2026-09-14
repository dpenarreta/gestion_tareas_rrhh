"""Ventana de gracia en la rotación del refresh token.

Existe por un fallo real y repetido en producción (ver docs/AUDIT_LOG.md §
2026-09-14): al caducar el access token, el navegador dispara varias
peticiones a la vez y todas presentan la misma cookie de refresh. La primera
rotaba y las siguientes se tomaban por reutilización, revocando la sesión de
gente que no había hecho nada — 18 veces en un solo día, 22 sesiones caídas.

Lo que NO puede romperse es la detección de robo: un refresh ya rotado y
usado más tarde tiene que seguir revocando la sesión entera.
"""

from datetime import timedelta
from unittest import mock

import pytest
from django.utils import timezone

from apps.authentication.services import AuthenticationService


class _SesionFalsa:
    """Doble mínimo: la ventana de gracia se decide solo con estos tres
    datos, así que no hace falta tocar la base para probarla."""

    def __init__(self, previous_jti="", rotated_hace_segundos=None):
        self.id = "sesion-de-prueba"
        self.previous_refresh_token_jti = previous_jti
        self.rotated_at = (
            None
            if rotated_hace_segundos is None
            else timezone.now() - timedelta(seconds=rotated_hace_segundos)
        )


def _es_reintento(sesion, jti):
    return AuthenticationService._es_reintento_concurrente(sesion, jti)


@pytest.mark.parametrize("segundos", [0, 1, 30, 59])
def test_el_jti_anterior_dentro_de_la_ventana_es_un_reintento(segundos):
    assert _es_reintento(_SesionFalsa("jti-viejo", segundos), "jti-viejo") is True


def test_el_jti_anterior_pasada_la_ventana_ya_no_lo_es():
    # Un token rotado hace horas que reaparece es el caso que la detección de
    # robo tiene que seguir cubriendo.
    assert _es_reintento(_SesionFalsa("jti-viejo", 3600), "jti-viejo") is False


def test_justo_despues_del_limite_deja_de_aceptarse():
    assert _es_reintento(_SesionFalsa("jti-viejo", 61), "jti-viejo") is False


def test_un_jti_desconocido_nunca_es_un_reintento():
    assert _es_reintento(_SesionFalsa("jti-viejo", 5), "jti-de-otro-lado") is False


def test_una_sesion_que_nunca_roto_no_acepta_nada():
    assert _es_reintento(_SesionFalsa("", None), "cualquiera") is False


def test_sin_jti_no_hay_reintento():
    assert _es_reintento(_SesionFalsa("jti-viejo", 5), None) is False


def test_la_ventana_se_lee_de_settings(settings):
    settings.REFRESH_ROTATION_GRACE_SECONDS = 5
    assert _es_reintento(_SesionFalsa("jti-viejo", 3), "jti-viejo") is True
    assert _es_reintento(_SesionFalsa("jti-viejo", 8), "jti-viejo") is False


def test_el_reintento_devuelve_solo_access_y_no_rota():
    # Devolver también un refresh nuevo dejaría dos válidos en circulación, y
    # el siguiente uso del perdedor revocaría igual: el arreglo no serviría.
    from apps.authentication.tokens import issue_access_token

    with mock.patch("apps.authentication.tokens.RefreshToken") as RT:
        RT.for_user.return_value = mock.MagicMock()
        emitido = issue_access_token(mock.MagicMock(), mock.MagicMock(id="s1"))

    assert set(emitido) == {"access"}


def test_la_revocacion_por_reutilizacion_sigue_existiendo():
    # Guardia contra que alguien "simplifique" el bloque y se lleve puesta la
    # detección de robo al hacerlo.
    import inspect

    fuente = inspect.getsource(AuthenticationService.refresh_tokens)
    assert "refresh_reused" in fuente
    assert "session.revoke()" in fuente


def test_el_refresco_bloquea_la_fila_de_la_sesion():
    # Sin `select_for_update`, varias peticiones simultáneas leen la sesión
    # antes de que ninguna escriba y todas rotan: en producción, de 6
    # refrescos en paralelo rotaron 3, dejando refresh huérfanos que
    # revocarían más tarde. El bloqueo es parte del arreglo, no un detalle.
    import inspect

    fuente = inspect.getsource(AuthenticationService.refresh_tokens)
    assert "select_for_update" in fuente


def test_el_refresco_corre_dentro_de_una_transaccion():
    # `select_for_update` fuera de una transacción lanza
    # TransactionManagementError en cuanto se use de verdad: el bloqueo y el
    # atomic van juntos, y quitar uno rompe el otro en producción, no acá.
    import inspect

    fuente = inspect.getsource(AuthenticationService.__dict__["refresh_tokens"].__func__)
    assert "@transaction.atomic" in fuente
