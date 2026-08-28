"""Centro de Recuperación — Fase 14 de la migración de stack (ver
docs/AUDIT_LOG.md § 2026-08-20). Réplica exacta de
`RecoveryItem`/`RecoveryAuditLog` (`prisma/schema.prisma`). Único
mecanismo oficial de eliminación temporal/restauración de Nexo — ver
`apps/recovery/services.py` para el registro de adaptadores
(`ENTITY_REGISTRY`, diseño abierto/cerrado: agregar un módulo nuevo es
agregar una entrada de datos ahí, nunca tocar este archivo)."""

from django.conf import settings
from django.db import models


class RecoveryStatus(models.TextChoices):
    ACTIVE = "ACTIVE"
    RESTORED = "RESTORED"
    PURGED = "PURGED"


class RecoveryOperation(models.TextChoices):
    MOVE_TO_TRASH = "MOVE_TO_TRASH"
    RESTORE = "RESTORE"
    DELETE_PERMANENTLY = "DELETE_PERMANENTLY"
    PURGE_EXPIRED = "PURGE_EXPIRED"


class RecoveryOrigin(models.TextChoices):
    MANUAL = "MANUAL"
    AUTOMATIC = "AUTOMATIC"


class RecoveryItem(models.Model):
    """La papelera misma. `entity_type`/`entity_id` son una referencia
    SUELTA (sin FK real) — vive en la tabla propia de cada módulo
    (`Project`/`DeskNote`), réplica exacta del diseño Prisma. Un mismo
    `(entity_type, entity_id)` puede tener varias filas a lo largo del
    tiempo (papelera → restaurado → papelera de nuevo) — el registro
    ACTIVE vigente es el más reciente con ese status."""

    legacy_postgres_id = models.CharField(max_length=30, unique=True, null=True, blank=True)
    entity_type = models.CharField(max_length=50)
    entity_id = models.CharField(max_length=64)
    entity_label = models.CharField(max_length=255, null=True, blank=True)
    module_label = models.CharField(max_length=100)
    status = models.CharField(max_length=15, choices=RecoveryStatus.choices, default=RecoveryStatus.ACTIVE)
    deleted_by = models.ForeignKey(settings.AUTH_USER_MODEL, related_name="+", on_delete=models.PROTECT)
    # Sin `auto_now_add`: se setea explícitamente en `services.move_to_trash`
    # con el MISMO instante usado para calcular `expires_at` — evita el
    # desfase de milisegundos entre dos llamadas independientes a "ahora".
    deleted_at = models.DateTimeField()
    retention_hours = models.PositiveIntegerField()
    expires_at = models.DateTimeField()
    restored_by = models.ForeignKey(settings.AUTH_USER_MODEL, related_name="+", null=True, blank=True, on_delete=models.SET_NULL)
    restored_at = models.DateTimeField(null=True, blank=True)
    purged_by = models.ForeignKey(settings.AUTH_USER_MODEL, related_name="+", null=True, blank=True, on_delete=models.SET_NULL)
    purged_at = models.DateTimeField(null=True, blank=True)
    purge_origin = models.CharField(max_length=15, choices=RecoveryOrigin.choices, null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [
            models.Index(fields=["entity_type", "entity_id"]),
            models.Index(fields=["status", "expires_at"]),
        ]

    def __str__(self) -> str:
        return f"{self.entity_type}:{self.entity_id} ({self.status})"


class RecoveryAuditLog(models.Model):
    """Auditoría central del Centro de Recuperación — una fila por
    operación, para cualquier módulo (nunca una tabla de auditoría por
    módulo). `entity_id` es referencia suelta: sobrevive a la purga
    definitiva de la entidad original. `user` es `null` cuando
    `origin=AUTOMATIC` (purga por expiración, sin actor humano)."""

    legacy_postgres_id = models.CharField(max_length=30, unique=True, null=True, blank=True)
    entity_type = models.CharField(max_length=50)
    entity_id = models.CharField(max_length=64)
    module_label = models.CharField(max_length=100)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, related_name="+", null=True, blank=True, on_delete=models.SET_NULL)
    operation = models.CharField(max_length=20, choices=RecoveryOperation.choices)
    origin = models.CharField(max_length=15, choices=RecoveryOrigin.choices)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [
            models.Index(fields=["entity_type", "entity_id"]),
            models.Index(fields=["created_at"]),
        ]

    def __str__(self) -> str:
        return f"{self.entity_type}:{self.entity_id} {self.operation}"
