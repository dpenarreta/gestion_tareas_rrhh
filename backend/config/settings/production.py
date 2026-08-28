from .base import *  # noqa: F401,F403

# Cada valor crítico se fuerza aquí explícitamente, sin depender de que el
# .env compartido tenga el valor "correcto" — así los valores de desarrollo
# nunca se propagan a producción por descuido.
DEBUG = False
ENVIRONMENT_NAME = "production"

SECURE_SSL_REDIRECT = env.bool("SECURE_SSL_REDIRECT", default=True)  # noqa: F405
SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True
SECURE_HSTS_SECONDS = 60 * 60 * 24 * 7
SECURE_HSTS_INCLUDE_SUBDOMAINS = True

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
