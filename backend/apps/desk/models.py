"""Modelos de Escritorio Digital — Fases 7a-7e (ver docs/AUDIT_LOG.md §
2026-08-17). Réplica de `prisma/schema.prisma` (`DeskNote`/
`DeskNoteReply`/`PersonalReminder`/`DeskAuditLog`). `DeskNote.deleted_at`
(Centro de Recuperación) se agregó en la Fase 14 (ver docs/AUDIT_LOG.md
§ 2026-08-20) — sus adjuntos (Fase 7d) y
`converted_to_reminder`/`converted_at` (Fase 7e) ya se habían portado.
`PersonalReminder` gana adjuntos en la Fase 7e también, pero sin
endpoint de subida/descarga propio — mismo comportamiento que el TS,
donde el único camino para que un recordatorio tenga adjunto es que se
COPIE desde la nota de origen al convertir Nota→Recordatorio, y
`reminderSelect` nunca expone `attachmentData` (solo nombre/mime).
`converted_to_task`/`converted_to_task_at` se portaron en la Fase 7c."""

from django.conf import settings
from django.db import models

from apps.core.models import BaseModel


class DeskNote(BaseModel):
    class Priority(models.TextChoices):
        INFORMACION = "INFORMACION", "Información"
        RECORDATORIO = "RECORDATORIO", "Recordatorio"
        IMPORTANTE = "IMPORTANTE", "Importante"
        URGENTE = "URGENTE", "Urgente"

    class Color(models.TextChoices):
        AMARILLO = "AMARILLO", "Amarillo"
        ROSADO = "ROSADO", "Rosado"
        CELESTE = "CELESTE", "Celeste"
        VERDE = "VERDE", "Verde"
        NARANJA = "NARANJA", "Naranja"
        LILA = "LILA", "Lila"

    legacy_postgres_id = models.CharField(max_length=30, unique=True, null=True, blank=True)
    sender = models.ForeignKey(
        settings.AUTH_USER_MODEL, related_name="+", on_delete=models.PROTECT
    )
    recipient = models.ForeignKey(
        settings.AUTH_USER_MODEL, related_name="desk_notes", on_delete=models.CASCADE
    )
    message = models.CharField(max_length=500)
    priority = models.CharField(max_length=20, choices=Priority.choices, default=Priority.INFORMACION)
    color = models.CharField(max_length=20, choices=Color.choices, default=Color.AMARILLO)
    read = models.BooleanField(default=False)
    read_at = models.DateTimeField(null=True, blank=True)
    pinned = models.BooleanField(default=False)
    archived = models.BooleanField(default=False)
    archived_at = models.DateTimeField(null=True, blank=True)
    # Adjunto opcional — Fase 7d. Réplica de `saveAttachment`
    # (`src/lib/storage.ts`): `attachment_data` es un data URL base64
    # completo (`data:<mime>;base64,<payload>`) guardado directo en la
    # fila, sin almacenamiento externo.
    attachment_name = models.CharField(max_length=255, null=True, blank=True)
    attachment_mime = models.CharField(max_length=255, null=True, blank=True)
    attachment_data = models.TextField(null=True, blank=True)
    # Puente opcional hacia Recordatorios (Fase 7e) — la nota permanece
    # intacta y visible tras convertirse, nunca se elimina ni se modifica
    # su contenido. SET_NULL para que borrar el recordatorio nunca se
    # lleve la nota por delante (réplica de `onDelete: SetNull` en
    # `convertedToReminder` de Prisma).
    converted_to_reminder = models.ForeignKey(
        "PersonalReminder", related_name="+", null=True, blank=True, on_delete=models.SET_NULL
    )
    converted_at = models.DateTimeField(null=True, blank=True)
    # Centro de Recuperación (Fase 14, ver docs/AUDIT_LOG.md §
    # 2026-08-20) — bandera local de conveniencia mantenida por el
    # adaptador DESK_NOTE de `apps.recovery.services.ENTITY_REGISTRY`:
    # permite filtrar notas en la papelera con un WHERE simple en vez de
    # un join contra RecoveryItem en cada consulta. RecoveryItem sigue
    # siendo la fuente de verdad de retención/auditoría; esto es solo un
    # espejo de su estado (mismo patrón que `Project.deleted_at`). La
    # retención de 15 días del ARCHIVO es OTRO mecanismo, independiente
    # (ver `apps.desk.services.purge_expired_archived_notes`).
    deleted_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-pinned", "-created_at"]
        indexes = [
            models.Index(fields=["recipient", "archived", "created_at"]),
            models.Index(fields=["sender", "created_at"]),
            models.Index(fields=["deleted_at"]),
        ]

    def __str__(self) -> str:
        return f"{self.sender_id} -> {self.recipient_id}: {self.message[:30]}"


class DeskNoteReply(BaseModel):
    legacy_postgres_id = models.CharField(max_length=30, unique=True, null=True, blank=True)
    note = models.ForeignKey(DeskNote, related_name="replies", on_delete=models.CASCADE)
    author = models.ForeignKey(settings.AUTH_USER_MODEL, related_name="+", on_delete=models.PROTECT)
    message = models.CharField(max_length=500)

    class Meta:
        ordering = ["created_at"]
        indexes = [models.Index(fields=["note", "created_at"])]


class PersonalReminder(BaseModel):
    """Agenda personal independiente de Trabajo/Proyectos — Fase 7b.
    Sin remitente/destinatario (a diferencia de `DeskNote`): un solo
    dueño (`user`)."""

    class Priority(models.TextChoices):
        BAJA = "BAJA", "Baja"
        MEDIA = "MEDIA", "Media"
        ALTA = "ALTA", "Alta"
        URGENTE = "URGENTE", "Urgente"

    class Status(models.TextChoices):
        PENDIENTE = "PENDIENTE", "Pendiente"
        COMPLETADO = "COMPLETADO", "Completado"

    class Repeat(models.TextChoices):
        UNA_VEZ = "UNA_VEZ", "Una vez"
        DIARIO = "DIARIO", "Diario"
        SEMANAL = "SEMANAL", "Semanal"
        MENSUAL = "MENSUAL", "Mensual"

    legacy_postgres_id = models.CharField(max_length=30, unique=True, null=True, blank=True)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, related_name="personal_reminders", on_delete=models.CASCADE)
    title = models.CharField(max_length=150)
    description = models.TextField(null=True, blank=True)
    due_at = models.DateTimeField()
    priority = models.CharField(max_length=20, choices=Priority.choices, default=Priority.MEDIA)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDIENTE)
    repeat = models.CharField(max_length=20, choices=Repeat.choices, default=Repeat.UNA_VEZ)
    completed_at = models.DateTimeField(null=True, blank=True)
    archived = models.BooleanField(default=False)
    archived_at = models.DateTimeField(null=True, blank=True)
    # Evita re-notificar el mismo vencimiento — réplica de `notified`.
    notified = models.BooleanField(default=False)
    # Puente opcional hacia Trabajo (Fase 7c) — el recordatorio permanece
    # intacto tras convertirse, nunca se elimina. SET_NULL para que borrar
    # la tarea nunca se lleve el recordatorio por delante (réplica de
    # `onDelete: SetNull` en `convertedToTask` de Prisma).
    converted_to_task = models.ForeignKey(
        "tasks.Task", related_name="+", null=True, blank=True, on_delete=models.SET_NULL
    )
    converted_to_task_at = models.DateTimeField(null=True, blank=True)
    # Adjunto opcional — Fase 7e. A diferencia de `DeskNote`, sin
    # endpoint propio de subida/descarga: el único origen posible es la
    # copia desde la nota al convertir Nota→Recordatorio (réplica exacta
    # del TS — `reminderSelect` tampoco expone `attachmentData`).
    attachment_name = models.CharField(max_length=255, null=True, blank=True)
    attachment_mime = models.CharField(max_length=255, null=True, blank=True)
    attachment_data = models.TextField(null=True, blank=True)

    class Meta:
        ordering = ["due_at"]
        indexes = [
            models.Index(fields=["user", "status", "due_at"]),
            models.Index(fields=["user", "archived"]),
        ]

    def __str__(self) -> str:
        return f"{self.user_id}: {self.title[:30]}"


class DeskAuditAction(models.TextChoices):
    """Réplica completa del enum Prisma — Fase 7a disparó un
    subconjunto (CREATED/READ/PINNED/UNPINNED/ARCHIVED/UNARCHIVED/
    REPLIED); Fase 7b agrega COMPLETED/POSTPONED/REOPENED/EDITED/
    PRIORITY_CHANGED/DELETED; Fase 7c agrega CONVERTED_TO_TASK; Fase 7e
    agrega CONVERTED_TO_REMINDER. Enum completo, sin acciones
    pendientes de disparar."""

    CREATED = "CREATED"
    EDITED = "EDITED"
    READ = "READ"
    PINNED = "PINNED"
    UNPINNED = "UNPINNED"
    ARCHIVED = "ARCHIVED"
    UNARCHIVED = "UNARCHIVED"
    DELETED = "DELETED"
    CONVERTED_TO_TASK = "CONVERTED_TO_TASK"
    CONVERTED_TO_REMINDER = "CONVERTED_TO_REMINDER"
    PRIORITY_CHANGED = "PRIORITY_CHANGED"
    POSTPONED = "POSTPONED"
    COMPLETED = "COMPLETED"
    REOPENED = "REOPENED"
    REPLIED = "REPLIED"


class DeskAuditLog(models.Model):
    """Bitácora central de Escritorio Digital (notas Y recordatorios,
    una sola tabla) — réplica de `DeskAuditLog`. `entity_id` es un
    `IntegerField` SUELTO, sin FK (sobrevive al borrado de la entidad,
    mismo criterio que `TargetTimeAuditLog`/`ProjectHistory`)."""

    legacy_postgres_id = models.CharField(max_length=30, unique=True, null=True, blank=True)
    entity_type = models.CharField(max_length=20)
    entity_id = models.PositiveBigIntegerField()
    user = models.ForeignKey(settings.AUTH_USER_MODEL, related_name="+", on_delete=models.PROTECT)
    action = models.CharField(max_length=30, choices=DeskAuditAction.choices)
    metadata = models.JSONField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at"]
        indexes = [
            models.Index(fields=["entity_type", "entity_id"]),
            models.Index(fields=["user", "created_at"]),
        ]
