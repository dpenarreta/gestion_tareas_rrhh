"""
Configuración base de Django, común a todos los entornos.

Todo valor configurable (claves, URLs, puertos, CORS, correo, expiración de
tokens, algoritmos, nombre del sistema, conexión a SQL Server) se lee
exclusivamente desde variables de entorno. Nada de esto debe modificarse
tocando código fuente.
"""

from datetime import timedelta
from pathlib import Path

import environ
from django.core.exceptions import ImproperlyConfigured

BASE_DIR = Path(__file__).resolve().parent.parent.parent

env = environ.Env()
environ.Env.read_env(BASE_DIR / ".env")

REQUIRED_ENV_VARS = [
    "SECRET_KEY",
    "JWT_SECRET_KEY",
    "DB_NAME",
    "DB_USER",
    "DB_PASSWORD",
]


def _fail_fast_on_missing_env() -> None:
    """Detiene el arranque si falta una variable de entorno obligatoria.

    Nunca se imprimen valores, solo los nombres de las variables ausentes,
    para no filtrar información sensible en logs de arranque.
    """
    missing = [name for name in REQUIRED_ENV_VARS if env.str(name, default=None) is None]
    if missing:
        raise ImproperlyConfigured(
            "No se puede iniciar la aplicación: faltan variables de entorno "
            f"obligatorias: {', '.join(missing)}. Defina estos valores en su "
            "archivo .env (ver .env.example) antes de continuar."
        )


_fail_fast_on_missing_env()

# --- Núcleo ---
SECRET_KEY = env.str("SECRET_KEY")
DEBUG = env.bool("DEBUG", default=False)
ALLOWED_HOSTS = env.list("ALLOWED_HOSTS", default=["localhost", "127.0.0.1"])

SYSTEM_NAME = env.str("SYSTEM_NAME", default="Nexo")
FRONTEND_URL = env.str("FRONTEND_URL", default="http://localhost:5173")
BACKEND_PORT = env.int("BACKEND_PORT", default=8000)
# URL pública por la que se accede a esta API (no necesariamente FRONTEND_URL
# ni BACKEND_PORT: en producción suele ser un dominio detrás de un proxy).
PUBLIC_API_URL = env.str("PUBLIC_API_URL", default=f"http://localhost:{BACKEND_PORT}")

# Nombre de ambiente legible, explícito (no se deriva de DEBUG ni de
# DJANGO_SETTINGS_MODULE). production.py lo fuerza a "production".
ENVIRONMENT_NAME = env.str("ENVIRONMENT_NAME", default="development")

# Versión de la aplicación: el archivo VERSION en la raíz del repo es la
# fuente de verdad; APP_VERSION queda como override operativo puntual.
try:
    _VERSION_FILE_CONTENTS = (BASE_DIR.parent / "VERSION").read_text().strip()
except OSError:
    _VERSION_FILE_CONTENTS = ""
APP_VERSION = env.str("APP_VERSION", default=None) or _VERSION_FILE_CONTENTS or "0.0.0-dev"

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "rest_framework",
    "rest_framework_simplejwt",
    "drf_spectacular",
    "corsheaders",
    "apps.core",
    "apps.permissions",
    "apps.authentication",
    "apps.users",
    "apps.roles",
    "apps.hierarchy",
    "apps.configuration",
    "apps.notifications",
    "apps.tasks",
    "apps.analytics",
    "apps.projects",
    "apps.desk",
    "apps.reports",
    "apps.meetings",
    "apps.ideas",
    "apps.data_requests",
    "apps.recovery",
    "apps.team",
    "apps.announcements",
    "apps.dashboard",
    "apps.assistant",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
    "apps.core.middleware.RequestIDMiddleware",
    "apps.core.middleware.AccessLogMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        # Solo para lo que Django realmente renderiza server-side: admin y
        # emails transaccionales. La UI de usuario vive en el frontend React.
        "DIRS": [BASE_DIR / "templates"],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"
ASGI_APPLICATION = "config.asgi.application"

# --- Base de datos: SQL Server, exclusivamente por variables de entorno ---
DATABASES = {
    "default": {
        "ENGINE": "mssql",
        "NAME": env.str("DB_NAME"),
        "USER": env.str("DB_USER"),
        "PASSWORD": env.str("DB_PASSWORD"),
        "HOST": env.str("DB_HOST", default="localhost"),
        "PORT": env.str("DB_PORT", default="1433"),
        "OPTIONS": {
            "driver": env.str("DB_DRIVER", default="ODBC Driver 18 for SQL Server"),
            "extra_params": (
                "TrustServerCertificate=yes;"
                if env.bool("DB_TRUST_SERVER_CERTIFICATE", default=True)
                else ""
            ),
        },
        "CONN_MAX_AGE": 600,
    }
}

AUTH_USER_MODEL = "users.User"

# --- Hashing de contraseñas: Argon2 como algoritmo primario ---
# BCryptPasswordHasher es un fallback TEMPORAL de la migracion de usuarios
# legacy (ver apps/users/management/commands/migrate_users_from_postgres.py):
# los hashes bcryptjs importados de Postgres se verifican con este hasher
# hasta el primer login exitoso, donde Django los re-encripta a Argon2 de
# forma automatica (check_password con setter). Retirar esta linea cuando
# ya no existan filas User.password que empiecen con "bcrypt$" (tarea de
# limpieza de la fase de decommission, no de esta fase).
PASSWORD_HASHERS = [
    "django.contrib.auth.hashers.Argon2PasswordHasher",
    "django.contrib.auth.hashers.PBKDF2PasswordHasher",
    "django.contrib.auth.hashers.PBKDF2SHA1PasswordHasher",
    "django.contrib.auth.hashers.BCryptPasswordHasher",
]

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {
        "NAME": "django.contrib.auth.password_validation.MinimumLengthValidator",
        "OPTIONS": {"min_length": 10},
    },
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

# --- Internacionalización ---
LANGUAGE_CODE = env.str("LANGUAGE_CODE", default="es")
TIME_ZONE = env.str("TIME_ZONE", default="UTC")
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# --- Sesión de cookie del Django admin ---
# Distinto del concepto de "sesión" de la API (JWT + apps.authentication.models.Session):
# esto solo afecta la cookie de sesión del panel de administración de Django.
SESSION_COOKIE_AGE = env.int("SESSION_COOKIE_AGE", default=1209600)

# --- Encabezados de seguridad (aplican en todos los ambientes) ---
SECURE_CONTENT_TYPE_NOSNIFF = True
X_FRAME_OPTIONS = env.str("X_FRAME_OPTIONS", default="DENY")
SECURE_REFERRER_POLICY = env.str("SECURE_REFERRER_POLICY", default="same-origin")

# --- CSRF ---
# La API (todo bajo /api/) usa JWT Bearer sin cookies de sesión, así que CSRF
# no aplica a esos endpoints. El Django admin sí usa cookies de sesión y
# sigue protegido por CsrfViewMiddleware (ya en MIDDLEWARE).
CSRF_TRUSTED_ORIGINS = env.list("CSRF_TRUSTED_ORIGINS", default=[])

# --- Django REST Framework ---
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": ("apps.authentication.authentication.SessionAuthentication",),
    "DEFAULT_PERMISSION_CLASSES": ("rest_framework.permissions.IsAuthenticated",),
    "EXCEPTION_HANDLER": "apps.core.exceptions.api_exception_handler",
    "DEFAULT_RENDERER_CLASSES": ("rest_framework.renderers.JSONRenderer",),
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
    # Deliberadamente sin `DEFAULT_PAGINATION_CLASS` global: cada listado
    # decide si pagina (ver `apps.users.pagination.UserAdminPagination` y
    # `pagination_class` explícito en `AuditLogViewSet`) — `RoleViewSet`
    # devuelve una lista plana a propósito (son pocos roles, y el frontend
    # espera un array, no `{results, count, ...}`).
    "DEFAULT_THROTTLE_CLASSES": (
        "rest_framework.throttling.AnonRateThrottle",
        "rest_framework.throttling.UserRateThrottle",
    ),
    "DEFAULT_THROTTLE_RATES": {
        "anon": env.str("DEFAULT_THROTTLE_RATE_ANON", default="100/hour"),
        "user": env.str("DEFAULT_THROTTLE_RATE_USER", default="1000/hour"),
        "login": env.str("LOGIN_THROTTLE_RATE", default="10/min"),
        "password_reset": env.str("PASSWORD_RESET_THROTTLE_RATE", default="5/hour"),
    },
}

# --- Documentación OpenAPI (drf-spectacular) ---
SPECTACULAR_SETTINGS = {
    "TITLE": f"{SYSTEM_NAME} API",
    "DESCRIPTION": "API del backend, versionada bajo /api/v1/.",
    "VERSION": APP_VERSION,
    "SERVE_PUBLIC": True,
    "SERVERS": [{"url": PUBLIC_API_URL}],
    "SCHEMA_PATH_PREFIX": "/api/v1/",
}

# --- JWT: clave, algoritmo y expiración configurables por entorno ---
# La rotación y revocación de refresh tokens las gestiona
# apps.authentication.models.Session (permite registrar dispositivo/IP y
# detectar reutilización), por eso se desactiva aquí el mecanismo genérico
# de rotación/blacklist de simplejwt.
SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(
        minutes=env.int("JWT_ACCESS_TOKEN_LIFETIME_MINUTES", default=15)
    ),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=env.int("JWT_REFRESH_TOKEN_LIFETIME_DAYS", default=7)),
    "ROTATE_REFRESH_TOKENS": False,
    "BLACKLIST_AFTER_ROTATION": False,
    "ALGORITHM": env.str("JWT_ALGORITHM", default="HS256"),
    "SIGNING_KEY": env.str("JWT_SECRET_KEY"),
    "AUTH_HEADER_TYPES": ("Bearer",),
    "USER_ID_FIELD": "id",
    "USER_ID_CLAIM": "user_id",
}

# --- Protección contra fuerza bruta en el login ---
LOGIN_MAX_FAILED_ATTEMPTS = env.int("LOGIN_MAX_FAILED_ATTEMPTS", default=5)
LOGIN_LOCKOUT_MINUTES = env.int("LOGIN_LOCKOUT_MINUTES", default=15)

# --- Recuperación de contraseña ---
PASSWORD_RESET_TOKEN_EXPIRATION_MINUTES = env.int(
    "PASSWORD_RESET_TOKEN_EXPIRATION_MINUTES", default=60
)

# --- Módulo administrativo de usuarios ---
ADMIN_USERS_PAGE_SIZE = env.int("ADMIN_USERS_PAGE_SIZE", default=20)

# --- Migración de usuarios legacy (Postgres/Next.js, ver hoja de ruta) ---
# Solo lo usa `migrate_users_from_postgres`; nunca se abre en request-path.
LEGACY_POSTGRES_URL = env.str("LEGACY_POSTGRES_URL", default=None)

# --- Paginación genérica (roles, auditoría, y futuros listados) ---
DEFAULT_PAGE_SIZE = env.int("DEFAULT_PAGE_SIZE", default=20)

# --- CORS ---
CORS_ALLOWED_ORIGINS = env.list("CORS_ALLOWED_ORIGINS", default=[FRONTEND_URL])

# --- Correo ---
EMAIL_BACKEND = env.str("EMAIL_BACKEND", default="django.core.mail.backends.console.EmailBackend")
EMAIL_HOST = env.str("EMAIL_HOST", default="localhost")
EMAIL_PORT = env.int("EMAIL_PORT", default=25)
EMAIL_HOST_USER = env.str("EMAIL_HOST_USER", default="")
EMAIL_HOST_PASSWORD = env.str("EMAIL_HOST_PASSWORD", default="")
EMAIL_USE_TLS = env.bool("EMAIL_USE_TLS", default=False)
DEFAULT_FROM_EMAIL = env.str(
    "DEFAULT_FROM_EMAIL", default=f"no-reply@{SYSTEM_NAME.lower().replace(' ', '-')}.local"
)

# --- Zoom (OAuth Server-to-Server, apps.meetings) --- opcionales: si faltan,
# apps.meetings.zoom lanza ZoomError y el caller cae al fallback simulado
# (mismo comportamiento que el TS legacy sin credenciales configuradas).
ZOOM_ACCOUNT_ID = env.str("ZOOM_ACCOUNT_ID", default="")
ZOOM_CLIENT_ID = env.str("ZOOM_CLIENT_ID", default="")
ZOOM_CLIENT_SECRET = env.str("ZOOM_CLIENT_SECRET", default="")

# --- Logging estructurado ---
from .logging import build_logging_config  # noqa: E402

LOGGING = build_logging_config(debug=DEBUG)
