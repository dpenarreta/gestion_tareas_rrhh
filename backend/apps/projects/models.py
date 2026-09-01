from django.conf import settings
from django.db import models

from apps.core.models import BaseModel
from apps.tasks.models import Task


class Project(BaseModel):
    """Migración de stack — Fases 5a-5e (ver docs/AUDIT_LOG.md §
    2026-08-13/2026-08-14): CRUD core + Participantes/Comentarios/
    Historial + Fases + Documentos + Actividades — sin Papelera
    todavía, y sin cutover de `route.ts` (Next.js sigue sirviendo
    `/api/projects` desde Postgres/Prisma). Réplica de `Project`
    (`prisma/schema.prisma`) — iniciativa transversal independiente de
    `Task` (no cuenta para carga laboral/Analytics todavía, no se
    cierra por cambio de mes)."""

    class Status(models.TextChoices):
        PENDIENTE = "PENDIENTE"
        PLANIFICACION = "PLANIFICACION"
        EN_EJECUCION = "EN_EJECUCION"
        EN_REVISION = "EN_REVISION"
        SUSPENDIDO = "SUSPENDIDO"
        COMPLETADO = "COMPLETADO"
        CANCELADO = "CANCELADO"

    name = models.CharField(max_length=255)
    description = models.TextField(blank=True, default="")
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDIENTE)
    # Reutiliza Task.Priority — mismo enum que el TS (`Project.priority: TaskPriority`).
    priority = models.CharField(max_length=10, choices=Task.Priority.choices)
    area = models.CharField(max_length=255, blank=True, default="")
    tags = models.JSONField(default=list, blank=True)
    observations = models.TextField(blank=True, default="")
    start_date = models.DateTimeField()
    target_date = models.DateTimeField()
    # Tiempo objetivo global, en horas — nunca "horas estimadas".
    target_time_hours = models.FloatField()
    # Recalculado desde ProjectActivity.duration en sub-fases futuras (sin
    # ProjectActivity todavía) — queda en 0 en esta sub-fase.
    real_hours = models.FloatField(default=0)
    completed_at = models.DateTimeField(null=True, blank=True)
    responsible = models.ForeignKey(
        settings.AUTH_USER_MODEL, related_name="responsible_projects", on_delete=models.PROTECT
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, related_name="created_projects", on_delete=models.PROTECT
    )
    # Soft-delete DIRECTO — a diferencia del TS (`recoveryCenter.moveToTrash`,
    # que además crea un `RecoveryItem` con retención/auditoría propia), esta
    # sub-fase no porta el Centro de Recuperación (pieza transversal
    # compartida con otros módulos, candidata a su propia sub-fase). Un
    # proyecto con `deleted_at` no nulo queda invisible para list/retrieve,
    # sin papelera/restauración todavía.
    deleted_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        indexes = [models.Index(fields=["status"]), models.Index(fields=["deleted_at"])]

    def __str__(self) -> str:
        return self.name


class ProjectParticipant(BaseModel):
    """Réplica de `ProjectParticipant`. Desde la Fase 5b tiene
    endpoints propios de alta/baja (`ParticipantService`,
    `apps/projects/services.py`) — antes (5a) solo se creaba inline al
    crear el proyecto o cambiar el responsable, eso sigue vigente."""

    project = models.ForeignKey(Project, related_name="participants", on_delete=models.CASCADE)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, related_name="project_participations", on_delete=models.PROTECT)
    added_by = models.ForeignKey(settings.AUTH_USER_MODEL, related_name="+", on_delete=models.PROTECT)
    added_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["project", "user"], name="unique_project_participant")]


class ProjectHistoryEvent(models.TextChoices):
    """Réplica completa del enum TS (`ProjectHistoryEvent`, 14
    valores) — definido de una vez desde la Fase 5a. En uso desde 5a
    (CREADO/ESTADO_CAMBIADO/RESPONSABLE_CAMBIADO/ELIMINADO), 5b
    (PARTICIPANTE_AGREGADO/PARTICIPANTE_ELIMINADO), 5c
    (FASE_AGREGADA/FASE_ACTUALIZADA/FASE_ELIMINADA) y 5d
    (DOCUMENTO_AGREGADO); ACTIVIDAD_REGISTRADA queda SIN USAR a
    propósito (Sprint 2.1 §1 del TS: registrar una actividad ya NO
    genera evento de historial, mismo criterio que Comentarios) — el
    resto queda listo para cuando se porte Papelera."""

    CREADO = "CREADO"
    ACTUALIZADO = "ACTUALIZADO"
    PARTICIPANTE_AGREGADO = "PARTICIPANTE_AGREGADO"
    PARTICIPANTE_ELIMINADO = "PARTICIPANTE_ELIMINADO"
    RESPONSABLE_CAMBIADO = "RESPONSABLE_CAMBIADO"
    ESTADO_CAMBIADO = "ESTADO_CAMBIADO"
    FASE_AGREGADA = "FASE_AGREGADA"
    FASE_ACTUALIZADA = "FASE_ACTUALIZADA"
    FASE_ELIMINADA = "FASE_ELIMINADA"
    COMENTARIO_AGREGADO = "COMENTARIO_AGREGADO"
    ACTIVIDAD_REGISTRADA = "ACTIVIDAD_REGISTRADA"
    DOCUMENTO_AGREGADO = "DOCUMENTO_AGREGADO"
    ELIMINADO = "ELIMINADO"
    RESTAURADO = "RESTAURADO"


class ProjectHistory(models.Model):
    """Bitácora de auditoría del módulo — réplica de `ProjectHistory`.
    Append-only — nunca se edita ni se borra. Lectura vía
    `GET /projects/<id>/history/` desde la Fase 5b (ver
    docs/AUDIT_LOG.md § 2026-08-13)."""

    project = models.ForeignKey(Project, related_name="history", on_delete=models.CASCADE)
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, related_name="+", on_delete=models.PROTECT)
    event = models.CharField(max_length=30, choices=ProjectHistoryEvent.choices)
    description = models.CharField(max_length=500)
    previous_value = models.JSONField(null=True, blank=True)
    new_value = models.JSONField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["project", "created_at"])]

    def __str__(self) -> str:
        return f"{self.project_id}:{self.event}"


class ProjectComment(BaseModel):
    """Réplica de `ProjectComment` — Fase 5b (ver docs/AUDIT_LOG.md §
    2026-08-13). Sprint 2.1 §1 del TS: NO genera evento de
    `ProjectHistory` (tiene su propia pestaña cronológica, duplicarlo
    en Historial sería ruido) — mismo patrón que `Comment` en
    `apps/tasks/models.py`."""

    project = models.ForeignKey(Project, related_name="comments", on_delete=models.CASCADE)
    author = models.ForeignKey(settings.AUTH_USER_MODEL, related_name="+", on_delete=models.PROTECT)
    text = models.TextField()

    class Meta:
        ordering = ["created_at"]


class ProjectPhase(BaseModel):
    """Réplica de `ProjectPhase` — Fase 5c (ver docs/AUDIT_LOG.md §
    2026-08-13). `registered_minutes`/`participants` (derivados de
    `ProjectActivity` vía `getPhaseStats`) se calculan de verdad desde
    la Fase 5e (`ProjectActivitySerializer`/`ProjectPhaseSerializer`,
    ver docs/AUDIT_LOG.md § 2026-08-14) — antes fijos en `0`/`[]`."""

    project = models.ForeignKey(Project, related_name="phases", on_delete=models.CASCADE)
    name = models.CharField(max_length=255)
    # Reutiliza Task.Status — mismo enum que el TS (`ProjectPhase.status: TaskStatus`).
    status = models.CharField(max_length=20, choices=Task.Status.choices, default=Task.Status.PENDIENTE)
    responsible = models.ForeignKey(
        settings.AUTH_USER_MODEL, related_name="+", null=True, blank=True, on_delete=models.PROTECT
    )
    start_date = models.DateTimeField(null=True, blank=True)
    target_date = models.DateTimeField(null=True, blank=True)
    progress = models.IntegerField(default=0)
    notes = models.TextField(blank=True, default="")
    target_time_hours = models.FloatField(null=True, blank=True)
    order = models.IntegerField(default=0)

    class Meta:
        ordering = ["order"]
        indexes = [models.Index(fields=["project", "order"])]

    def __str__(self) -> str:
        return self.name


class ProjectActivity(BaseModel):
    """Réplica de `ProjectActivity` — Fase 5e (ver docs/AUDIT_LOG.md §
    2026-08-14). Mismos tipos que `TaskActivity`
    (`apps/tasks/models.py`) — el registro retroactivo reutiliza
    `apps.tasks.business_time` (ya portado en Fase 3b/3f, sin
    duplicar). A diferencia de `TaskActivity`, el TS de Proyectos NO
    valida solapamiento de horarios entre actividades."""

    project = models.ForeignKey(Project, related_name="activities", on_delete=models.CASCADE)
    phase = models.ForeignKey(ProjectPhase, related_name="activities", null=True, blank=True, on_delete=models.SET_NULL)
    author = models.ForeignKey(settings.AUTH_USER_MODEL, related_name="+", on_delete=models.PROTECT)
    description = models.TextField()
    comments = models.TextField(null=True, blank=True)
    start_time = models.CharField(max_length=5, null=True, blank=True)
    end_time = models.CharField(max_length=5, null=True, blank=True)
    duration = models.PositiveIntegerField()
    is_retroactive = models.BooleanField(default=False)
    activity_date = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["created_at"]
        indexes = [models.Index(fields=["project", "created_at"])]

    def __str__(self) -> str:
        return f"{self.project_id}:{self.author_id}:{self.duration}min"


class ProjectDocument(BaseModel):
    """Réplica de `ProjectDocument` — Fases 5d/5e (ver docs/AUDIT_LOG.md
    § 2026-08-13/2026-08-14). `previous_version_id` es una referencia
    SUELTA (sin `ForeignKey`), igual que en el schema Prisma original —
    permite historial de versiones sin encadenar borrados. `activity`
    (vínculo opcional a `ProjectActivity`) llegó en la Fase 5e — 5d la
    dejó explícitamente diferida porque ese modelo no existía
    todavía."""

    class Category(models.TextChoices):
        PDF = "PDF"
        EXCEL = "EXCEL"
        WORD = "WORD"
        IMAGEN = "IMAGEN"
        CORREO = "CORREO"
        ACTA = "ACTA"
        OTRO = "OTRO"

    project = models.ForeignKey(Project, related_name="documents", on_delete=models.CASCADE)
    activity = models.ForeignKey(
        ProjectActivity, related_name="documents", null=True, blank=True, on_delete=models.SET_NULL
    )
    category = models.CharField(max_length=10, choices=Category.choices, default=Category.OTRO)
    file_name = models.CharField(max_length=255)
    mime_type = models.CharField(max_length=255, blank=True, default="")
    file_data = models.TextField(null=True, blank=True)
    version = models.IntegerField(default=1)
    previous_version_id = models.IntegerField(null=True, blank=True)
    uploaded_by = models.ForeignKey(settings.AUTH_USER_MODEL, related_name="+", on_delete=models.PROTECT)

    class Meta:
        indexes = [models.Index(fields=["project"])]

    def __str__(self) -> str:
        return self.file_name
