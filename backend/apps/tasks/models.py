from django.conf import settings
from django.db import models

from apps.core.models import BaseModel


class Task(BaseModel):
    """Fase 3a-3c de la migración de stack (ver docs/AUDIT_LOG.md §
    2026-08-07). `end_date_approval_status`/`end_date_approved_at`/
    `end_date_approved_by` llegaron en la Fase 3c (3a los dejó
    explícitamente pendientes)."""

    class Status(models.TextChoices):
        PENDIENTE = "PENDIENTE"
        EN_PROGRESO = "EN_PROGRESO"
        COMPLETADA = "COMPLETADA"

    class Priority(models.TextChoices):
        ALTA = "ALTA"
        MEDIA = "MEDIA"
        BAJA = "BAJA"

    class Frequency(models.TextChoices):
        MENSUAL = "MENSUAL"
        SEMANAL = "SEMANAL"
        DIARIA = "DIARIA"
        QUINCENAL = "QUINCENAL"
        PUNTUAL = "PUNTUAL"

    class Type(models.TextChoices):
        FIJA = "FIJA"
        SEGUIMIENTO = "SEGUIMIENTO"

    class EndDateApprovalStatus(models.TextChoices):
        PENDIENTE = "PENDIENTE"
        APROBADA = "APROBADA"
        MODIFICADA = "MODIFICADA"
        RECHAZADA = "RECHAZADA"

    # `cuid` original de Postgres/Prisma — mismo criterio que
    # `User.legacy_postgres_id` (Fase 80, ver docs/AUDIT_LOG.md § 2026-08-27).
    legacy_postgres_id = models.CharField(max_length=30, unique=True, null=True, blank=True)
    title = models.CharField(max_length=255)
    description = models.TextField(blank=True, default="")
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDIENTE)
    priority = models.CharField(max_length=10, choices=Priority.choices)
    frequency = models.CharField(max_length=10, choices=Frequency.choices)
    type = models.CharField(max_length=15, choices=Type.choices, default=Type.FIJA)
    start_date = models.DateTimeField()
    end_date = models.DateTimeField()
    estimated_hours = models.FloatField()
    real_hours = models.FloatField(default=0)
    # Sin escritura todavía en esta sub-fase (llega con la validación de
    # Tiempo Objetivo) — solo lectura, para que la UI ya lo muestre.
    target_time_validated = models.FloatField(null=True, blank=True)
    target_time_validated_at = models.DateTimeField(null=True, blank=True)
    target_time_validated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, related_name="+", null=True, blank=True, on_delete=models.SET_NULL
    )
    end_date_approval_status = models.CharField(
        max_length=15, choices=EndDateApprovalStatus.choices, default=EndDateApprovalStatus.PENDIENTE
    )
    end_date_approved_at = models.DateTimeField(null=True, blank=True)
    end_date_approved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, related_name="+", null=True, blank=True, on_delete=models.SET_NULL
    )
    progress = models.PositiveSmallIntegerField(default=0)
    completed_at = models.DateTimeField(null=True, blank=True)
    color = models.CharField(max_length=20, blank=True, default="")
    archived_month = models.CharField(max_length=7, null=True, blank=True)
    archived_at = models.DateTimeField(null=True, blank=True)
    corrected = models.BooleanField(default=False)
    assigned_to = models.ForeignKey(
        settings.AUTH_USER_MODEL, related_name="assigned_tasks", on_delete=models.PROTECT
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, related_name="created_tasks", on_delete=models.PROTECT
    )

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return self.title


class Comment(BaseModel):
    legacy_postgres_id = models.CharField(max_length=30, unique=True, null=True, blank=True)
    task = models.ForeignKey(Task, related_name="comments", on_delete=models.CASCADE)
    author = models.ForeignKey(settings.AUTH_USER_MODEL, related_name="+", on_delete=models.PROTECT)
    text = models.TextField()

    class Meta:
        ordering = ["created_at"]


class ActivityReason(BaseModel):
    """Catálogo de motivos de registro de horas — Fase 3b (ver
    docs/AUDIT_LOG.md § 2026-08-07). `assigned_roles` es una lista JSON de
    nombres de `Group` (SQL Server no tiene array nativo tipo Postgres);
    `TaskActivity.reason` referencia `key` por convención, nunca por FK —
    mismo criterio que el `ActivityReason`/`TaskActivity.reason` de
    Prisma."""

    legacy_postgres_id = models.CharField(max_length=30, unique=True, null=True, blank=True)
    key = models.CharField(max_length=100, unique=True)
    label = models.CharField(max_length=255)
    description = models.TextField(blank=True, default="")
    is_active = models.BooleanField(default=True)
    is_archived = models.BooleanField(default=False)
    archived_at = models.DateTimeField(null=True, blank=True)
    assigned_roles = models.JSONField(default=list, blank=True)

    def __str__(self) -> str:
        return self.key


class TaskActivity(BaseModel):
    """Registro de horas — Fase 3b. `admin_comment`/`modified_by_admin`/
    `modified_at` (edición por Admin) llegaron en la Fase 3f, ver
    docs/AUDIT_LOG.md § 2026-08-07."""

    legacy_postgres_id = models.CharField(max_length=30, unique=True, null=True, blank=True)
    task = models.ForeignKey(Task, related_name="activities", on_delete=models.CASCADE)
    author = models.ForeignKey(settings.AUTH_USER_MODEL, related_name="+", on_delete=models.PROTECT)
    reason = models.CharField(max_length=100)
    start_time = models.CharField(max_length=5, null=True, blank=True)
    end_time = models.CharField(max_length=5, null=True, blank=True)
    duration = models.PositiveIntegerField()
    description = models.TextField(blank=True, default="")
    is_retroactive = models.BooleanField(default=False)
    activity_date = models.DateTimeField(null=True, blank=True)
    admin_comment = models.TextField(null=True, blank=True)
    modified_by_admin = models.BooleanField(default=False)
    modified_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["created_at"]


class ActivityComment(BaseModel):
    """Comentarios sobre un registro de horas — Fase 3f (ver
    docs/AUDIT_LOG.md § 2026-08-07). A diferencia de `ActivityAuditLog`,
    el Prisma original SÍ usa FK real aquí (`onDelete: Cascade`)."""

    legacy_postgres_id = models.CharField(max_length=30, unique=True, null=True, blank=True)
    activity = models.ForeignKey(TaskActivity, related_name="comments", on_delete=models.CASCADE)
    author = models.ForeignKey(settings.AUTH_USER_MODEL, related_name="+", on_delete=models.PROTECT)
    text = models.TextField()

    class Meta:
        ordering = ["created_at"]


class ActivityAuditLog(models.Model):
    """Auditoría append-only de ediciones de horas por un Administrador —
    Fase 3f. `activity_id` es intencionalmente un `IntegerField` SUELTO,
    sin FK — mismo criterio ya usado en `TargetTimeAuditLog`/
    `EndDateAuditLog`: sobrevive al borrado de la actividad/tarea. No
    hereda `BaseModel`: el Prisma original solo tiene `modifiedAt` (un
    log de auditoría nunca se "actualiza") — mismo criterio ya aplicado a
    `MonthClosure.closed_at` en la Fase 3d."""

    legacy_postgres_id = models.CharField(max_length=30, unique=True, null=True, blank=True)
    activity_id = models.PositiveBigIntegerField(db_index=True)
    admin = models.ForeignKey(settings.AUTH_USER_MODEL, related_name="+", on_delete=models.PROTECT)
    old_duration = models.PositiveIntegerField()
    new_duration = models.PositiveIntegerField()
    comment = models.TextField()
    # Sin `auto_now_add`: el servicio pasa el mismo instante ya usado
    # para `TaskActivity.modified_at`, para que ambos coincidan exactamente.
    modified_at = models.DateTimeField()

    class Meta:
        ordering = ["-modified_at"]


class TargetTimeAuditLog(BaseModel):
    """Auditoría append-only de validaciones de Tiempo Objetivo — Fase 3c
    (ver docs/AUDIT_LOG.md § 2026-08-07). `task` es intencionalmente un
    `IntegerField` SUELTO, sin FK — mismo criterio deliberado que
    `ActivityAuditLog`/`TargetTimeAuditLog` de Prisma: el log debe
    sobrevivir aunque la tarea se elimine más adelante. `user` sí tiene FK
    real; `user_role` es un snapshot de texto (el rol del actor en el
    momento del evento, no el actual)."""

    class Reason(models.TextChoices):
        PROCEDIMIENTO_ESTANDAR = "PROCEDIMIENTO_ESTANDAR"
        COMPLEJIDAD_DETECTADA = "COMPLEJIDAD_DETECTADA"
        CAMBIO_ALCANCE = "CAMBIO_ALCANCE"
        REVISION_LIDER = "REVISION_LIDER"
        OTRO = "OTRO"

    legacy_postgres_id = models.CharField(max_length=30, unique=True, null=True, blank=True)
    task_id = models.PositiveBigIntegerField(db_index=True)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, related_name="+", on_delete=models.PROTECT)
    user_role = models.CharField(max_length=50, blank=True, default="")
    previous_value = models.FloatField(null=True, blank=True)
    new_value = models.FloatField()
    reason = models.CharField(max_length=30, choices=Reason.choices)
    reason_detail = models.TextField(null=True, blank=True)
    ip_address = models.GenericIPAddressField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]


class EndDateAuditLog(BaseModel):
    """Auditoría append-only de decisiones de Fecha Fin — Fase 3c. Mismo
    patrón que `TargetTimeAuditLog`: `task_id` suelto, sin FK. `action`
    distingue el evento "PROPUESTA" (el colaborador editó `end_date`) de
    las 3 decisiones del líder."""

    class Action(models.TextChoices):
        PROPUESTA = "PROPUESTA"
        APROBADA = "APROBADA"
        MODIFICADA = "MODIFICADA"
        RECHAZADA = "RECHAZADA"

    legacy_postgres_id = models.CharField(max_length=30, unique=True, null=True, blank=True)
    task_id = models.PositiveBigIntegerField(db_index=True)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, related_name="+", on_delete=models.PROTECT)
    user_role = models.CharField(max_length=50, blank=True, default="")
    action = models.CharField(max_length=15, choices=Action.choices)
    previous_value = models.DateTimeField(null=True, blank=True)
    new_value = models.DateTimeField(null=True, blank=True)
    observaciones = models.TextField(null=True, blank=True)
    ip_address = models.GenericIPAddressField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]


class MonthClosure(models.Model):
    """Motor de Cierre Inteligente — Fase 3d (ver docs/AUDIT_LOG.md §
    2026-08-07). `closed_at` explícito (no `BaseModel.created_at`): el
    schema Prisma original ya distinguía deliberadamente "cuándo se
    ejecutó el cierre" (`closed_at`) de "hasta cuándo cuenta la data"
    (`cutoff_date`) — mantener esa semántica de nombres. `calendar_days_
    considered`/`working_days_considered`/`working_hours_considered`
    quedan congelados en el momento del cierre y nunca se recalculan."""

    class ClosureType(models.TextChoices):
        NORMAL = "NORMAL"
        EARLY = "EARLY"
        MANUAL = "MANUAL"

    legacy_postgres_id = models.CharField(max_length=30, unique=True, null=True, blank=True)
    month = models.PositiveSmallIntegerField()
    year = models.PositiveSmallIntegerField()
    closed_by = models.ForeignKey(settings.AUTH_USER_MODEL, related_name="closed_months", on_delete=models.PROTECT)
    closed_at = models.DateTimeField(auto_now_add=True)
    cutoff_date = models.DateTimeField()
    closure_type = models.CharField(max_length=10, choices=ClosureType.choices, default=ClosureType.NORMAL)
    calendar_days_total = models.PositiveSmallIntegerField()
    calendar_days_considered = models.PositiveSmallIntegerField()
    working_days_considered = models.PositiveSmallIntegerField()
    working_hours_considered = models.FloatField()
    total_tasks = models.PositiveIntegerField()
    completed_tasks = models.PositiveIntegerField()
    summary = models.JSONField()
    corrections = models.JSONField(null=True, blank=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["month", "year"], name="unique_month_year_closure")]
        ordering = ["-year", "-month"]

    def __str__(self) -> str:
        return f"{self.year}-{self.month:02d}"


class TaskCommentView(BaseModel):
    """Marca de última vez que un usuario vio los comentarios de una tarea
    (para `has_unread_comments`) — mismo criterio que
    `src/lib/commentViews.ts` del Next.js legacy. `updated_at` (de
    `BaseModel`) hace de `viewedAt`: se actualiza en cada `save()`, incluido
    el `update_or_create` que dispara el endpoint de listado de comentarios."""

    legacy_postgres_id = models.CharField(max_length=30, unique=True, null=True, blank=True)
    task = models.ForeignKey(Task, related_name="comment_views", on_delete=models.CASCADE)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, related_name="+", on_delete=models.CASCADE)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["task", "user"], name="unique_task_comment_view")
        ]
