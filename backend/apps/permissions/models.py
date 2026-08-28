from django.db import models

from .catalog import as_django_permission_tuples


class ModulePermission(models.Model):
    """Modelo "ancla", sin tabla real: existe únicamente para colgar el
    catálogo de permisos por módulo (`apps.permissions.catalog`) bajo un
    `ContentType` propio, desacoplado de cualquier modelo de dominio
    (patrón estándar de Django para permisos globales/transversales)."""

    class Meta:
        managed = False
        default_permissions = ()
        permissions = as_django_permission_tuples()
