"""Diagnóstico de la configuración de correo saliente.

Existe porque el envío de Nexo es "best effort" por diseño (ver
`apps.authentication.emails`): una configuración incorrecta no produce
ningún error visible, solo un correo que nunca llega. `manage.py check` ya
avisa de los errores de configuración estáticos (`apps.core.checks`); esto
es la verificación activa contra el servidor SMTP real.

No reemplaza al `sendtestemail` de Django, que envía un correo trivial y
deja escapar la excepción cruda. Acá el valor está en el diagnóstico: la
configuración efectiva, en qué paso exacto falla, qué significa ese fallo,
y un envío de prueba que usa la plantilla y el código de producción de
verdad — incluido el enlace construido con FRONTEND_URL, que es la parte
que más veces queda mal.
"""

import smtplib
import socket
import ssl

from django.conf import settings
from django.core.mail import get_connection
from django.core.mail.backends.smtp import EmailBackend as SmtpEmailBackend
from django.core.management.base import BaseCommand, CommandError
from django.utils.module_loading import import_string

from apps.authentication.emails import build_password_reset_url, send_password_reset_email


def _es_backend_smtp() -> bool:
    """Cualquier subclase del backend SMTP, no solo la clase exacta de Django:
    el proyecto usa `apps.core.email_backend.CertifiSMTPEmailBackend`."""
    try:
        return issubclass(import_string(settings.EMAIL_BACKEND), SmtpEmailBackend)
    except (ImportError, TypeError):
        return False


# Cada modo de falla real que puede dar un SMTP, con lo que hay que hacer al
# respecto. Sin esto, el operador ve una traza de smtplib y no sabe si el
# problema es el firewall, la contraseña o el remitente.
_EXPLICACIONES = [
    (
        smtplib.SMTPAuthenticationError,
        "El servidor rechazó las credenciales.",
        "Revisá EMAIL_HOST_USER y EMAIL_HOST_PASSWORD. El usuario suele ser la "
        "dirección completa del buzón. Si la cuenta tiene doble factor, hace falta "
        "una contraseña de aplicación.",
    ),
    (
        smtplib.SMTPNotSupportedError,
        "El servidor no ofrece el mecanismo de autenticación pedido.",
        "Es lo que pasa cuando se intenta autenticar sin cifrar: muchos servidores "
        "(Zimbra/Postfix entre ellos) solo anuncian AUTH después de STARTTLS. "
        "Poné EMAIL_USE_TLS=true con el puerto 587, o EMAIL_USE_SSL=true con el 465.",
    ),
    (
        smtplib.SMTPSenderRefused,
        "El servidor rechazó la dirección del remitente.",
        "DEFAULT_FROM_EMAIL tiene que ser un buzón que el servidor acepte como "
        "origen — normalmente el mismo de EMAIL_HOST_USER, o una dirección "
        "autorizada a enviar en su nombre.",
    ),
    (
        smtplib.SMTPRecipientsRefused,
        "El servidor rechazó al destinatario.",
        "Si el destinatario es de otro dominio, el servidor probablemente no acepte "
        "hacer relay hacia afuera con esta cuenta. Probá primero con una dirección "
        "del dominio propio.",
    ),
    (
        ssl.SSLCertVerificationError,
        "No se pudo validar el certificado TLS del servidor.",
        "Django valida el certificado (cadena y nombre). Usá en EMAIL_HOST el mismo "
        "nombre que figura en el certificado, no la IP, y verificá que la autoridad "
        "que lo emitió sea de confianza en este equipo.",
    ),
    (
        socket.gaierror,
        "No se pudo resolver el nombre del servidor por DNS.",
        "Revisá EMAIL_HOST: el nombre no resuelve desde este equipo.",
    ),
    (
        ConnectionRefusedError,
        "El servidor rechazó la conexión en ese puerto.",
        "El puerto está cerrado o no hay nada escuchando. Confirmá EMAIL_PORT "
        "(587 para STARTTLS, 465 para TLS implícito, 25 para relay interno).",
    ),
    (
        TimeoutError,
        "La conexión expiró sin respuesta.",
        "Suele ser un firewall que descarta los paquetes en silencio. Verificá que "
        "este equipo tenga permitida la salida hacia ese host y puerto.",
    ),
]


def _explicar(exc: Exception) -> tuple[str, str] | None:
    for tipo, que_paso, que_hacer in _EXPLICACIONES:
        if isinstance(exc, tipo):
            return que_paso, que_hacer
    return None


class Command(BaseCommand):
    help = (
        "Diagnostica la configuración de correo saliente y, opcionalmente, envía un "
        "correo de recuperación de prueba con la plantilla real."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "recipient",
            nargs="?",
            help=(
                "Destinatario del correo de prueba. Si se omite, solo se verifica la "
                "conexión y la autenticación, sin enviar nada."
            ),
        )
        parser.add_argument(
            "--connection-only",
            action="store_true",
            help="Verificar conexión y autenticación pero no enviar, incluso con destinatario.",
        )

    def handle(self, *args, **options):
        recipient = options["recipient"]
        connection_only = options["connection_only"]

        self._mostrar_configuracion()

        if not _es_backend_smtp():
            self.stdout.write(
                self.style.WARNING(
                    f"\nEMAIL_BACKEND no es el backend SMTP ({settings.EMAIL_BACKEND}).\n"
                    "No hay ningún servidor real al que conectarse, así que no se "
                    "verifica la conexión. Con el backend de consola el correo se "
                    "imprime en la salida estándar; es lo correcto en desarrollo, pero "
                    "en producción significa que nadie lo recibe."
                )
            )
            if recipient and not connection_only:
                self._enviar(recipient)
            return

        self._verificar_conexion()

        if not recipient:
            self.stdout.write(
                "\nNo se indicó destinatario: no se envió ningún correo. Para probar el "
                "envío completo:\n  manage.py diagnose_email alguien@dominio.com"
            )
            return

        if connection_only:
            self.stdout.write("\n--connection-only: no se envió ningún correo.")
            return

        self._enviar(recipient)

    def _mostrar_configuracion(self):
        if settings.EMAIL_HOST_PASSWORD:
            password = f"(definida, {len(settings.EMAIL_HOST_PASSWORD)} caracteres)"
        else:
            password = "(vacía)"

        self.stdout.write(self.style.MIGRATE_HEADING("Configuración efectiva"))
        for etiqueta, valor in [
            ("EMAIL_BACKEND", settings.EMAIL_BACKEND),
            ("EMAIL_HOST", settings.EMAIL_HOST or "(vacío)"),
            ("EMAIL_PORT", settings.EMAIL_PORT),
            ("EMAIL_USE_TLS", settings.EMAIL_USE_TLS),
            ("EMAIL_USE_SSL", settings.EMAIL_USE_SSL),
            ("EMAIL_TIMEOUT", settings.EMAIL_TIMEOUT),
            ("EMAIL_HOST_USER", settings.EMAIL_HOST_USER or "(vacío)"),
            ("EMAIL_HOST_PASSWORD", password),
            ("DEFAULT_FROM_EMAIL", settings.DEFAULT_FROM_EMAIL),
            ("FRONTEND_URL", settings.FRONTEND_URL),
        ]:
            self.stdout.write(f"  {etiqueta:<21}{valor}")

        # El enlace es la parte del correo que más veces queda mal, porque
        # depende de FRONTEND_URL y no del servidor de correo: se muestra
        # resuelto para que se vea si lleva al sitio de verdad.
        self.stdout.write(
            "\n  El correo de recuperación llevaría este enlace:\n"
            f"    {build_password_reset_url('TOKEN_DE_EJEMPLO')}"
        )

    def _verificar_conexion(self):
        self.stdout.write(
            self.style.MIGRATE_HEADING(
                f"\nConectando a {settings.EMAIL_HOST}:{settings.EMAIL_PORT}"
            )
        )
        # Se usa el backend de Django, no un socket propio: así lo que se
        # verifica es exactamente el camino que hace el envío en producción
        # (STARTTLS/SSL, validación de certificado y AUTH incluidos).
        #
        # `get_connection` va dentro del try porque el constructor del backend
        # ya puede fallar solo (con EMAIL_USE_TLS y EMAIL_USE_SSL ambos en
        # True lanza ValueError), y ese error también hay que explicarlo en
        # vez de dejarlo salir como traza.
        try:
            connection = get_connection(fail_silently=False)
            connection.open()
        except Exception as exc:
            self._reportar_falla(exc)
            raise CommandError(
                "La conexión con el servidor de correo falló: la recuperación de "
                "contraseña no puede funcionar con esta configuración."
            ) from exc

        detalle = "conexión establecida"
        if settings.EMAIL_HOST_USER:
            detalle += " y autenticación aceptada"
        self.stdout.write(self.style.SUCCESS(f"  OK: {detalle}."))
        connection.close()

    def _enviar(self, recipient: str):
        from apps.users.models import User

        self.stdout.write(self.style.MIGRATE_HEADING(f"\nEnviando correo de prueba a {recipient}"))

        # Usuario en memoria, nunca guardado: el diagnóstico no debe dejar
        # rastro en la base ni un token de recuperación válido.
        user = User(username="diagnostico", first_name="Prueba", email=recipient)
        try:
            send_password_reset_email(
                user=user,
                raw_token="TOKEN_DE_PRUEBA_NO_VALIDO",
                fail_silently=False,
            )
        except Exception as exc:
            self._reportar_falla(exc)
            raise CommandError("El envío falló.") from exc

        self.stdout.write(
            self.style.SUCCESS(
                f"  OK: el servidor aceptó el mensaje para {recipient}.\n"
                "  El token del enlace es de prueba y no sirve para restablecer nada; "
                "revisá que el correo llegue y que el enlace apunte al sitio correcto."
            )
        )

    def _reportar_falla(self, exc: Exception):
        self.stderr.write(self.style.ERROR(f"  FALLÓ: {type(exc).__name__}: {exc}"))
        explicacion = _explicar(exc)
        if explicacion:
            que_paso, que_hacer = explicacion
            self.stderr.write(self.style.WARNING(f"  Qué significa: {que_paso}"))
            self.stderr.write(f"  Qué hacer: {que_hacer}")
