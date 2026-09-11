"""Cobertura de `apps.core.checks` y de `manage.py diagnose_email`.

Los dos existen por el mismo motivo: el envío de correo de Nexo silencia
sus errores a propósito (ver `apps.authentication.emails`), así que una
configuración mal puesta no se manifiesta como una falla sino como un
correo que nunca llega. Lo que se verifica acá es que esa configuración mal
puesta sí produzca una advertencia al arrancar, y que el comando de
diagnóstico distinga los modos de falla en vez de mostrar una traza.
"""

import smtplib
from io import StringIO
from unittest import mock

import pytest
from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import override_settings

from apps.core.checks import check_email_settings

SMTP_BACKEND = "django.core.mail.backends.smtp.EmailBackend"
CONSOLE_BACKEND = "django.core.mail.backends.console.EmailBackend"

# Configuración SMTP completa y correcta: cada test la copia y rompe solo lo
# que quiere probar, para que la advertencia esperada sea la única que salga.
CONFIGURACION_VALIDA = {
    "EMAIL_BACKEND": SMTP_BACKEND,
    "EMAIL_HOST": "mail.empresa.test",
    "EMAIL_PORT": 587,
    "EMAIL_HOST_USER": "nexo@empresa.test",
    "EMAIL_HOST_PASSWORD": "clave-de-prueba",
    "EMAIL_USE_TLS": True,
    "EMAIL_USE_SSL": False,
    "EMAIL_TIMEOUT": 10,
    "DEFAULT_FROM_EMAIL": "nexo@empresa.test",
    "FRONTEND_URL": "http://10.0.2.33:4080",
    "DEBUG": False,
}


def _ids(configuracion):
    with override_settings(**configuracion):
        return {advertencia.id for advertencia in check_email_settings(app_configs=None)}


def test_configuracion_smtp_completa_no_advierte_nada():
    assert _ids(CONFIGURACION_VALIDA) == set()


def test_host_vacio_con_backend_smtp_advierte():
    assert "nexo.email.W001" in _ids({**CONFIGURACION_VALIDA, "EMAIL_HOST": ""})


def test_host_solo_con_espacios_tambien_advierte():
    # Un `EMAIL_HOST= ` en el .env es indistinguible de vacío para smtplib.
    assert "nexo.email.W001" in _ids({**CONFIGURACION_VALIDA, "EMAIL_HOST": "   "})


def test_host_vacio_sin_backend_smtp_no_advierte():
    # El backend de consola no se conecta a ningún servidor: que EMAIL_HOST
    # esté vacío es irrelevante y es el caso normal en desarrollo.
    configuracion = {**CONFIGURACION_VALIDA, "EMAIL_BACKEND": CONSOLE_BACKEND, "EMAIL_HOST": ""}
    assert "nexo.email.W001" not in _ids({**configuracion, "DEBUG": True})


def test_tls_y_ssl_simultaneos_advierten():
    configuracion = {**CONFIGURACION_VALIDA, "EMAIL_USE_TLS": True, "EMAIL_USE_SSL": True}
    assert "nexo.email.W002" in _ids(configuracion)


def test_backend_de_consola_en_produccion_advierte():
    configuracion = {**CONFIGURACION_VALIDA, "EMAIL_BACKEND": CONSOLE_BACKEND, "DEBUG": False}
    assert "nexo.email.W003" in _ids(configuracion)


def test_backend_de_consola_en_desarrollo_no_advierte():
    configuracion = {**CONFIGURACION_VALIDA, "EMAIL_BACKEND": CONSOLE_BACKEND, "DEBUG": True}
    assert "nexo.email.W003" not in _ids(configuracion)


@pytest.mark.parametrize(
    "credenciales",
    [
        {"EMAIL_HOST_USER": "nexo@empresa.test", "EMAIL_HOST_PASSWORD": ""},
        {"EMAIL_HOST_USER": "", "EMAIL_HOST_PASSWORD": "clave-de-prueba"},
    ],
)
def test_credenciales_a_medias_advierten(credenciales):
    assert "nexo.email.W004" in _ids({**CONFIGURACION_VALIDA, **credenciales})


def test_credenciales_ambas_vacias_no_advierten():
    # Es la forma válida de configurar un relay que autoriza por IP.
    configuracion = {**CONFIGURACION_VALIDA, "EMAIL_HOST_USER": "", "EMAIL_HOST_PASSWORD": ""}
    assert "nexo.email.W004" not in _ids(configuracion)


def test_remitente_de_dominio_ficticio_advierte():
    configuracion = {**CONFIGURACION_VALIDA, "DEFAULT_FROM_EMAIL": "no-reply@nexo.local"}
    assert "nexo.email.W005" in _ids(configuracion)


def test_sin_timeout_advierte():
    assert "nexo.email.W006" in _ids({**CONFIGURACION_VALIDA, "EMAIL_TIMEOUT": None})


def test_frontend_url_en_localhost_con_smtp_real_advierte():
    # El enlace del correo se construye con FRONTEND_URL: si apunta a
    # localhost, el correo sale pero no sirve para nada.
    configuracion = {**CONFIGURACION_VALIDA, "FRONTEND_URL": "http://localhost:5197"}
    assert "nexo.email.W007" in _ids(configuracion)


def test_el_check_esta_registrado_en_django():
    from django.core.checks import registry

    assert check_email_settings in registry.registry.get_checks()


# --- manage.py diagnose_email ---


def _correr(*args, **configuracion):
    salida, errores = StringIO(), StringIO()
    with override_settings(**{**CONFIGURACION_VALIDA, **configuracion}):
        call_command("diagnose_email", *args, stdout=salida, stderr=errores)
    return salida.getvalue(), errores.getvalue()


def test_diagnostico_muestra_la_configuracion_sin_revelar_la_contrasena():
    with mock.patch("apps.core.management.commands.diagnose_email.get_connection"):
        salida, _ = _correr("--connection-only")

    assert "mail.empresa.test" in salida
    assert "clave-de-prueba" not in salida
    assert "(definida, 15 caracteres)" in salida


def test_diagnostico_muestra_el_enlace_que_llevaria_el_correo():
    with mock.patch("apps.core.management.commands.diagnose_email.get_connection"):
        salida, _ = _correr("--connection-only")

    assert "http://10.0.2.33:4080/reset-password?token=TOKEN_DE_EJEMPLO" in salida


def test_diagnostico_abre_la_conexion_y_reporta_exito():
    with mock.patch(
        "apps.core.management.commands.diagnose_email.get_connection"
    ) as get_connection:
        salida, _ = _correr("--connection-only")

    get_connection.return_value.open.assert_called_once()
    assert "OK" in salida


def test_diagnostico_traduce_un_error_de_autenticacion():
    fallo = smtplib.SMTPAuthenticationError(535, b"authentication failed")
    with mock.patch(
        "apps.core.management.commands.diagnose_email.get_connection"
    ) as get_connection:
        get_connection.return_value.open.side_effect = fallo
        with pytest.raises(CommandError):
            _correr("--connection-only")


def test_diagnostico_explica_que_significa_el_error_y_que_hacer():
    fallo = ConnectionRefusedError("conexión rechazada")
    salida_de_error = StringIO()
    with mock.patch(
        "apps.core.management.commands.diagnose_email.get_connection"
    ) as get_connection:
        get_connection.return_value.open.side_effect = fallo
        with override_settings(**CONFIGURACION_VALIDA):
            with pytest.raises(CommandError):
                call_command(
                    "diagnose_email",
                    "--connection-only",
                    stdout=StringIO(),
                    stderr=salida_de_error,
                )

    reporte = salida_de_error.getvalue()
    assert "ConnectionRefusedError" in reporte
    assert "Qué significa" in reporte
    assert "Qué hacer" in reporte
    assert "EMAIL_PORT" in reporte


def test_diagnostico_no_intenta_conectarse_si_el_backend_no_es_smtp():
    with mock.patch(
        "apps.core.management.commands.diagnose_email.get_connection"
    ) as get_connection:
        salida, _ = _correr(EMAIL_BACKEND=CONSOLE_BACKEND)

    get_connection.assert_not_called()
    assert "no es el backend SMTP" in salida


def test_diagnostico_envia_usando_la_plantilla_real_sin_tocar_la_base():
    # Deliberadamente SIN `django_db`: pytest-django bloquea cualquier acceso
    # a la base en un test sin esa marca, así que el test pasa solo si el
    # comando no guarda el usuario de prueba ni crea un token de
    # recuperación. Es la garantía de que el diagnóstico no deja rastro.
    with mock.patch("apps.core.management.commands.diagnose_email.get_connection"):
        with (
            mock.patch("apps.authentication.emails.send_mail") as send_mail,
            override_settings(**CONFIGURACION_VALIDA),
        ):
            call_command(
                "diagnose_email",
                "destino@empresa.test",
                stdout=StringIO(),
                stderr=StringIO(),
            )

    send_mail.assert_called_once()
    argumentos = send_mail.call_args.kwargs
    assert argumentos["recipient_list"] == ["destino@empresa.test"]
    # El enlace del HTML es el que se generaría de verdad, con FRONTEND_URL.
    assert "http://10.0.2.33:4080/reset-password?token=" in argumentos["html_message"]
    # La plantilla real se renderizó (no un mensaje inventado por el comando).
    assert "Restablecer mi contraseña" in argumentos["html_message"]


def test_diagnostico_propaga_el_error_de_envio_en_vez_de_silenciarlo():
    # El punto del comando: `emails.py` silencia el fallo en producción, acá
    # tiene que verse.
    with mock.patch("apps.core.management.commands.diagnose_email.get_connection"):
        with mock.patch(
            "apps.authentication.emails.send_mail",
            side_effect=smtplib.SMTPSenderRefused(553, b"sender rejected", "x@y.test"),
        ):
            with pytest.raises(CommandError):
                _correr("destino@empresa.test")


def test_el_envio_de_produccion_sigue_silenciando_el_error():
    """`fail_silently` se agregó para el diagnóstico, y su default no cambió.

    Es una propiedad de seguridad, no una comodidad: si un fallo de envío se
    propagara, los endpoints públicos de recuperación responderían 500 con
    una cuenta existente y 200 con una inexistente, revelando qué
    direcciones están registradas. Los dos llamadores de
    `apps.authentication.services` usan el default, así que este test es lo
    que impide que un cambio futuro lo invierta sin darse cuenta.
    """
    from apps.authentication.emails import send_password_reset_email
    from apps.users.models import User

    with mock.patch(
        "apps.authentication.emails.send_mail",
        side_effect=smtplib.SMTPException("el servidor no responde"),
    ):
        with override_settings(**CONFIGURACION_VALIDA):
            # Sin `fail_silently`: no debe levantar nada.
            send_password_reset_email(
                user=User(username="x", email="x@empresa.test"), raw_token="t"
            )

            with pytest.raises(smtplib.SMTPException):
                send_password_reset_email(
                    user=User(username="x", email="x@empresa.test"),
                    raw_token="t",
                    fail_silently=False,
                )
