from django.contrib.auth.models import Group
from django.db import models

from apps.core.models import BaseModel


class RoleVisibility(BaseModel):
    """Quién ve las tareas/usuarios de quién.

    Nexo no modela la jerarquía de roles como un nivel numérico (skelleton_base
    tampoco lo hace: roles/permisos son planos por diseño) — la visibilidad
    real de hoy no es consistente con un solo nivel (ej. un rol de nivel 2
    puede ver a otro rol de nivel 2 distinto sin que ambos se vean entre sí
    "porque comparten nivel"). En cambio se modela como datos explícitos: cada
    fila dice "el rol `viewer_group` puede ver al rol `visible_group`". Un
    grupo siempre se ve a sí mismo (fila reflexiva), igual que el
    `VISIBLE_ROLES` original en TypeScript.
    """

    viewer_group = models.ForeignKey(Group, related_name="+", on_delete=models.CASCADE)
    visible_group = models.ForeignKey(Group, related_name="+", on_delete=models.CASCADE)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["viewer_group", "visible_group"], name="unique_role_visibility_pair"
            )
        ]

    def __str__(self) -> str:
        return f"{self.viewer_group.name} ve a {self.visible_group.name}"


class RoleNotificationTarget(BaseModel):
    """A quién se notifica cuando ocurre un evento (hoy: comentario de tarea)
    en el rol `source_group` — siempre hacia arriba en la jerarquía, nunca
    hacia abajo. Ver `NOTIFICATION_TARGETS` en el `roles.ts` legacy."""

    source_group = models.ForeignKey(Group, related_name="+", on_delete=models.CASCADE)
    target_group = models.ForeignKey(Group, related_name="+", on_delete=models.CASCADE)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["source_group", "target_group"], name="unique_notification_target_pair"
            )
        ]

    def __str__(self) -> str:
        return f"{self.source_group.name} notifica a {self.target_group.name}"
