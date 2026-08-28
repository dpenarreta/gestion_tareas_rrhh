"""Construye la configuración de logging estructurado (JSON) de Django."""


def build_logging_config(debug: bool) -> dict:
    return {
        "version": 1,
        "disable_existing_loggers": False,
        "formatters": {
            "json": {
                "()": "pythonjsonlogger.jsonlogger.JsonFormatter",
                "format": "%(asctime)s %(levelname)s %(name)s %(request_id)s %(message)s",
            },
        },
        "filters": {
            "request_id": {
                "()": "apps.core.middleware.RequestIDLogFilter",
            },
        },
        "handlers": {
            "console": {
                "class": "logging.StreamHandler",
                "formatter": "json",
                "filters": ["request_id"],
            },
        },
        "root": {
            "handlers": ["console"],
            "level": "DEBUG" if debug else "INFO",
        },
        "loggers": {
            "django": {
                "handlers": ["console"],
                "level": "INFO",
                "propagate": False,
            },
            "apps": {
                "handlers": ["console"],
                "level": "DEBUG" if debug else "INFO",
                "propagate": False,
            },
        },
    }
