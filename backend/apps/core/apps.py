from django.apps import AppConfig


class CoreConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.core"
    verbose_name = "Núcleo compartido"

    def ready(self):
        # Importar el módulo registra los system checks de configuración de
        # correo (el decorador @register se evalúa al importarse).
        from . import checks  # noqa: F401
