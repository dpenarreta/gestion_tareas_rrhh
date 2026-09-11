from .base import *  # noqa: F401,F403

# Cada valor crítico se fuerza aquí explícitamente, sin depender de que el
# .env compartido tenga el valor "correcto" — así los valores de desarrollo
# nunca se propagan a producción por descuido.
DEBUG = False
ENVIRONMENT_NAME = "production"

# Exigencia de HTTPS. Seguro por defecto: solo un `REQUIRE_HTTPS=false`
# explicito la relaja, y ese es el caso del despliegue interno de este
# sistema (por IP, sin TLS — decision explicita del usuario, 2026-09-08).
#
# Sin esto no habia forma de servir por http: con `SESSION_COOKIE_SECURE`
# fijo en True el navegador no manda la cookie y el login queda en un bucle
# de redireccion, sin ningun error que lo explique. El equivalente del lado
# Next.js es `src/lib/httpsPolicy.ts`, y las dos variables tienen que valer
# lo mismo en los dos `.env` del servidor.
#
# El costo de desactivarla: las credenciales y la cookie de sesion viajan en
# claro por la red. Aceptable solo en una red interna controlada.
REQUIRE_HTTPS = env.bool("REQUIRE_HTTPS", default=True)  # noqa: F405

SECURE_SSL_REDIRECT = env.bool("SECURE_SSL_REDIRECT", default=REQUIRE_HTTPS)  # noqa: F405
SESSION_COOKIE_SECURE = REQUIRE_HTTPS
CSRF_COOKIE_SECURE = REQUIRE_HTTPS
# HSTS solo con TLS: por http el navegador lo ignora, y dejarlo puesto
# clavaria el host a https durante una semana si alguna vez se sirviera por
# https por error.
SECURE_HSTS_SECONDS = 60 * 60 * 24 * 7 if REQUIRE_HTTPS else 0
SECURE_HSTS_INCLUDE_SUBDOMAINS = REQUIRE_HTTPS

# --- Estáticos servidos por el propio contenedor (sin nginx delante de
# Django): solo sirven el admin y, potencialmente, el schema de Redoc/
# Swagger. La UI de negocio vive en el frontend React, servido aparte. ---
MIDDLEWARE = (  # noqa: F405
    MIDDLEWARE[:1] + ["whitenoise.middleware.WhiteNoiseMiddleware"] + MIDDLEWARE[1:]  # noqa: F405
)
STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {"BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage"},
}
