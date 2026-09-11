"""System checks de configuración de correo.

Motivo: el envío de correo de Nexo es deliberadamente "best effort".
`apps.authentication.emails._send_transactional_email` captura cualquier
excepción y solo la registra en el log, porque los endpoints públicos de
recuperación de contraseña deben responder exactamente lo mismo exista o no
la cuenta (si el error se propagara, la diferencia entre una respuesta 200 y
un 500 revelaría qué correos están registrados).

La consecuencia es que una configuración de correo incorrecta **no produce
ningún síntoma visible**: el usuario ve "te enviamos un correo", el token se
crea en la base, y nadie recibe nada. Estos checks son el contrapeso: se
ejecutan con cualquier `manage.py` (incluidos el `collectstatic` y el
`migrate` de `scripts/serve_production_windows.py`, es decir en cada arranque
del servicio en producción) y dejan el problema escrito en la salida.

Son `Warning` y no `Error` a propósito: un `Error` haría fallar el `migrate`
del arranque y dejaría todo el sistema sin servicio por una función
secundaria. Para verificar el envío de forma activa está `manage.py
testemail`.
"""

from django.conf import settings
from django.core.checks import Warning as CheckWarning
from django.core.checks import register

# Backends que no entregan el correo a ningún servidor real. `console` es el
# default de desarrollo (imprime el mensaje en la salida estándar).
_NON_DELIVERING_BACKENDS = (
    "django.core.mail.backends.console.EmailBackend",
    "django.core.mail.backends.locmem.EmailBackend",
    "django.core.mail.backends.dummy.EmailBackend",
    "django.core.mail.backends.filebased.EmailBackend",
)

_SMTP_BACKEND = "django.core.mail.backends.smtp.EmailBackend"


def _is_smtp() -> bool:
    return settings.EMAIL_BACKEND == _SMTP_BACKEND


@register()
def check_email_settings(app_configs, **kwargs):
    errors = []

    if _is_smtp() and not settings.EMAIL_HOST.strip():
        errors.append(
            CheckWarning(
                "EMAIL_BACKEND es el backend SMTP pero EMAIL_HOST está vacío.",
                hint=(
                    "La recuperación de contraseña crea el token y responde igual, "
                    "pero no envía ningún correo y el usuario no recibe nada. "
                    "Definí EMAIL_HOST en el .env (ver docs/DEPLOYMENT_IIS.md § 5c) "
                    "y verificá con: manage.py diagnose_email <destinatario>"
                ),
                id="nexo.email.W001",
            )
        )

    if settings.EMAIL_USE_TLS and settings.EMAIL_USE_SSL:
        errors.append(
            CheckWarning(
                "EMAIL_USE_TLS y EMAIL_USE_SSL están ambos activados, y son "
                "mutuamente excluyentes.",
                hint=(
                    "El backend SMTP de Django lanza ValueError al instanciarse, pero "
                    "eso ocurre dentro del try que silencia el envío: ningún correo "
                    "sale y no hay error visible. Usá EMAIL_USE_TLS=true con el puerto "
                    "587 (STARTTLS) o EMAIL_USE_SSL=true con el 465 (TLS implícito), "
                    "nunca los dos."
                ),
                id="nexo.email.W002",
            )
        )

    if not settings.DEBUG and settings.EMAIL_BACKEND in _NON_DELIVERING_BACKENDS:
        errors.append(
            CheckWarning(
                f"EMAIL_BACKEND es {settings.EMAIL_BACKEND!r}, que no entrega el "
                "correo a ningún servidor real.",
                hint=(
                    "Con DEBUG=False esto normalmente no es lo buscado: la "
                    "recuperación de contraseña no le llega a nadie. Configurá el "
                    "backend SMTP en el .env de producción."
                ),
                id="nexo.email.W003",
            )
        )

    if _is_smtp() and bool(settings.EMAIL_HOST_USER) != bool(settings.EMAIL_HOST_PASSWORD):
        faltante = "EMAIL_HOST_PASSWORD" if settings.EMAIL_HOST_USER else "EMAIL_HOST_USER"
        errors.append(
            CheckWarning(
                f"La configuración SMTP tiene solo una mitad de las credenciales: "
                f"falta {faltante}.",
                hint=(
                    "Un servidor que exige AUTH va a rechazar el envío. Si el relay "
                    "acepta por IP sin autenticar, dejá las dos variables vacías."
                ),
                id="nexo.email.W004",
            )
        )

    if _is_smtp() and settings.DEFAULT_FROM_EMAIL.endswith(".local"):
        errors.append(
            CheckWarning(
                f"DEFAULT_FROM_EMAIL es {settings.DEFAULT_FROM_EMAIL!r}, un dominio "
                "de ejemplo sin existencia real.",
                hint=(
                    "Es el valor por defecto de desarrollo. Cualquier servidor de "
                    "correo rechaza un remitente así, con lo cual el envío falla en "
                    "silencio. Poné una dirección real del dominio de la empresa."
                ),
                id="nexo.email.W005",
            )
        )

    if _is_smtp() and not settings.EMAIL_TIMEOUT:
        errors.append(
            CheckWarning(
                "EMAIL_TIMEOUT no está definido y el backend es SMTP.",
                hint=(
                    "Sin timeout, un servidor que acepta la conexión TCP pero no "
                    "responde deja colgado el request de recuperación de contraseña "
                    "sin límite. Es una ruta pública y sin autenticar."
                ),
                id="nexo.email.W006",
            )
        )

    if _is_smtp() and "localhost" in settings.FRONTEND_URL:
        errors.append(
            CheckWarning(
                f"FRONTEND_URL es {settings.FRONTEND_URL!r} mientras el correo se "
                "envía por SMTP real.",
                hint=(
                    "El enlace de recuperación se construye con FRONTEND_URL "
                    "(apps.authentication.emails.send_password_reset_email), así que "
                    "el correo saldría con un enlace a localhost, inservible para "
                    "quien lo reciba. Incluí el puerto si el sitio no está en el 80."
                ),
                id="nexo.email.W007",
            )
        )

    return errors
