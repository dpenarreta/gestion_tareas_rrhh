"""Modelos del módulo Control Operativo de Novedades.

Reemplaza los Excel dispersos de días laborados y horas extras de la
operación por una única fuente de datos en SQL Server. Reglas de diseño:

- Un colaborador operativo existe UNA sola vez (cédula única) y tiene un
  supervisor responsable vigente (`current_supervisor`); el historial de
  asignaciones vive en `CollaboratorAssignment`.
- Cada novedad (`WorkedDay`, `OvertimeRecord`) guarda el supervisor
  responsable EN EL MOMENTO de registrarla: la historia no se reconstruye
  desde la asignación actual del colaborador.
- Nada operativo se borra físicamente: las horas extras usan borrado
  lógico (`deleted_at`) y una celda de Días laborados vaciada queda con
  `hours=None` (vacío ≠ 0).
- `version` en las novedades editables implementa bloqueo optimista: un
  guardado con una versión vieja no sobrescribe en silencio el cambio de
  otro usuario.
"""

from django.conf import settings
from django.db import models

from apps.core.models import BaseModel

from .periods import PeriodKey


class Collaborator(BaseModel):
    class Status(models.TextChoices):
        ACTIVE = "ACTIVE", "Activo"
        INACTIVE = "INACTIVE", "Inactivo"
        SUSPENDED = "SUSPENDED", "Suspendido"

    cedula = models.CharField(max_length=20, unique=True)
    full_name = models.CharField(max_length=200)
    regional = models.CharField(max_length=100, blank=True)
    area = models.CharField(max_length=100, blank=True)
    cargo = models.CharField(max_length=100, blank=True)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.ACTIVE)
    current_supervisor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="novedades_collaborators",
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="novedades_collaborators_created",
    )

    class Meta:
        ordering = ["full_name"]
        indexes = [models.Index(fields=["current_supervisor", "status"])]

    def __str__(self) -> str:
        return f"{self.cedula} — {self.full_name}"


class CollaboratorAssignment(models.Model):
    """Historial de asignaciones colaborador → supervisor. La vigente tiene
    `ended_at` nulo y coincide con `Collaborator.current_supervisor`."""

    collaborator = models.ForeignKey(
        Collaborator, on_delete=models.PROTECT, related_name="assignments"
    )
    supervisor = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="novedades_assignments"
    )
    started_at = models.DateTimeField(auto_now_add=True)
    ended_at = models.DateTimeField(null=True, blank=True)
    assigned_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="novedades_assignments_made",
    )
    reason = models.CharField(max_length=500, blank=True)

    class Meta:
        ordering = ["-started_at"]


class CollaboratorStatusChange(models.Model):
    """Historial de estados operativos (Activo/Inactivo/Suspendido)."""

    collaborator = models.ForeignKey(
        Collaborator, on_delete=models.PROTECT, related_name="status_changes"
    )
    previous_status = models.CharField(max_length=10, choices=Collaborator.Status.choices)
    new_status = models.CharField(max_length=10, choices=Collaborator.Status.choices)
    changed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="novedades_status_changes"
    )
    reason = models.CharField(max_length=500, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]


class OperationalPeriod(models.Model):
    """Período nacional (23 → 22). Las fechas se guardan explícitas aunque
    se deriven de `periods.PeriodKey`, para consultas y auditoría."""

    year = models.PositiveSmallIntegerField()
    month = models.PositiveSmallIntegerField()
    start_date = models.DateField()
    end_date = models.DateField()

    class Meta:
        ordering = ["-year", "-month"]
        constraints = [
            models.UniqueConstraint(
                fields=["year", "month"], name="novedades_period_year_month_uniq"
            )
        ]

    @property
    def key(self) -> PeriodKey:
        return PeriodKey(self.year, self.month)

    @property
    def code(self) -> str:
        return self.key.code

    def __str__(self) -> str:
        return self.key.label


class SupervisorPeriod(models.Model):
    """Estado del período para UN supervisor — el cierre es individual: un
    supervisor puede cerrar octubre mientras los demás siguen trabajando."""

    class Status(models.TextChoices):
        OPEN = "OPEN", "Abierto"
        CLOSED = "CLOSED", "Cerrado"

    period = models.ForeignKey(
        OperationalPeriod, on_delete=models.PROTECT, related_name="supervisor_periods"
    )
    supervisor = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="novedades_periods"
    )
    status = models.CharField(max_length=6, choices=Status.choices, default=Status.OPEN)
    opened_at = models.DateTimeField(auto_now_add=True)
    closed_at = models.DateTimeField(null=True, blank=True)
    closed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="novedades_periods_closed",
    )
    summary = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ["-period__year", "-period__month"]
        constraints = [
            models.UniqueConstraint(
                fields=["period", "supervisor"], name="novedades_supervisor_period_uniq"
            )
        ]


class WorkedDay(BaseModel):
    """Una celda de la matriz Días laborados. `hours=None` = vacío (no
    reportado); `0` = cero reportado explícitamente."""

    collaborator = models.ForeignKey(
        Collaborator, on_delete=models.PROTECT, related_name="worked_days"
    )
    period = models.ForeignKey(
        OperationalPeriod, on_delete=models.PROTECT, related_name="worked_days"
    )
    supervisor = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="novedades_worked_days"
    )
    date = models.DateField()
    hours = models.DecimalField(max_digits=4, decimal_places=2, null=True, blank=True)
    version = models.PositiveIntegerField(default=1)
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="novedades_worked_days_updated",
    )

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["collaborator", "date"], name="novedades_worked_day_uniq"
            )
        ]
        indexes = [models.Index(fields=["period", "supervisor"])]


class OvertimeRecord(BaseModel):
    """Novedad de horas extras. Registrarla NO significa que esté aprobada
    para pago."""

    collaborator = models.ForeignKey(
        Collaborator, on_delete=models.PROTECT, related_name="overtime_records"
    )
    period = models.ForeignKey(
        OperationalPeriod, on_delete=models.PROTECT, related_name="overtime_records"
    )
    supervisor = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="novedades_overtime"
    )
    date = models.DateField()
    overtime_hours = models.DecimalField(max_digits=5, decimal_places=2, default=0)
    saturday_hours = models.DecimalField(max_digits=5, decimal_places=2, default=0)
    is_saturday = models.BooleanField(default=False)
    is_sunday = models.BooleanField(default=False)
    is_holiday = models.BooleanField(default=False)
    work_done = models.CharField(max_length=500, blank=True)
    observations = models.CharField(max_length=1000, blank=True)
    version = models.PositiveIntegerField(default=1)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="novedades_overtime_created",
    )
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="novedades_overtime_updated",
    )
    deleted_at = models.DateTimeField(null=True, blank=True)
    deleted_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="novedades_overtime_deleted",
    )

    class Meta:
        ordering = ["date", "collaborator__full_name"]
        # Regla vigente: una sola novedad ACTIVA por colaborador y fecha (el
        # registro eliminado lógicamente no cuenta). La valida el servicio y
        # además la base, para que dos guardados simultáneos no la burlen.
        constraints = [
            models.UniqueConstraint(
                fields=["collaborator", "date"],
                condition=models.Q(deleted_at__isnull=True),
                name="novedades_overtime_active_uniq",
            )
        ]
        indexes = [
            models.Index(fields=["period", "supervisor"]),
            models.Index(fields=["collaborator", "date"]),
        ]


class ClosedPeriodCorrection(models.Model):
    """Corrección excepcional sobre un período ya cerrado: conserva el valor
    original, el nuevo, el motivo y el responsable."""

    class Target(models.TextChoices):
        WORKED_DAY = "WORKED_DAY", "Días laborados"
        OVERTIME = "OVERTIME", "Horas extras"

    target = models.CharField(max_length=10, choices=Target.choices)
    target_id = models.PositiveBigIntegerField()
    period = models.ForeignKey(
        OperationalPeriod, on_delete=models.PROTECT, related_name="corrections"
    )
    supervisor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="novedades_corrections_owned",
    )
    original_values = models.JSONField(default=dict)
    new_values = models.JSONField(default=dict)
    reason = models.CharField(max_length=500)
    corrected_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="novedades_corrections_made",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]


class ImportBatch(BaseModel):
    """Importación de Excel en dos pasos: vista previa (PREVIEW, con las
    filas ya validadas en `rows`) y confirmación (CONFIRMED). La de la base de
    colaboradores no pertenece a un período (`period` nulo)."""

    class Kind(models.TextChoices):
        WORKED_DAYS = "WORKED_DAYS", "Días laborados"
        OVERTIME = "OVERTIME", "Horas extras"
        COLLABORATORS = "COLLABORATORS", "Base de colaboradores"

    class Status(models.TextChoices):
        PREVIEW = "PREVIEW", "Vista previa"
        CONFIRMED = "CONFIRMED", "Confirmada"
        CANCELLED = "CANCELLED", "Cancelada"

    kind = models.CharField(max_length=20, choices=Kind.choices)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.PREVIEW)
    period = models.ForeignKey(
        OperationalPeriod, on_delete=models.PROTECT, related_name="imports", null=True, blank=True
    )
    uploaded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="novedades_imports"
    )
    file_name = models.CharField(max_length=255)
    file_hash = models.CharField(max_length=64, db_index=True)
    rows = models.JSONField(default=list, blank=True)
    errors = models.JSONField(default=list, blank=True)
    summary = models.JSONField(default=dict, blank=True)
    strategy = models.CharField(max_length=10, blank=True)

    class Meta:
        ordering = ["-created_at"]


class PermissionOverride(models.Model):
    """Excepción individual sobre un permiso CONFIGURABLE del módulo
    (concede o restringe). Nunca amplía el ámbito de datos: el ámbito lo
    decide el rol operativo (ver `access.py`), no un permiso."""

    class Effect(models.TextChoices):
        GRANT = "GRANT", "Conceder"
        DENY = "DENY", "Restringir"

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="novedades_permission_overrides",
    )
    codename = models.CharField(max_length=60)
    effect = models.CharField(max_length=5, choices=Effect.choices)
    reason = models.CharField(max_length=500)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="novedades_overrides_created",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    revoked_at = models.DateTimeField(null=True, blank=True)
    revoked_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="novedades_overrides_revoked",
    )
    revoke_reason = models.CharField(max_length=500, blank=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["user", "revoked_at"])]


class NovedadEvent(models.Model):
    """Historial propio del módulo (pestaña "Historial de registros").

    Complementa —no reemplaza— `apps.core.AuditLog`, donde también queda
    cada evento: este modelo existe porque el historial del módulo se
    filtra por supervisor/período (ámbito de datos) y necesita campo,
    valor anterior/nuevo y archivo de origen como columnas consultables.
    Append-only: no hay endpoint que lo edite ni lo borre."""

    action = models.CharField(max_length=60, db_index=True)
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        related_name="novedades_events",
    )
    actor_role = models.CharField(max_length=50, blank=True)
    supervisor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="novedades_events_as_supervisor",
    )
    period = models.ForeignKey(
        OperationalPeriod, on_delete=models.SET_NULL, null=True, blank=True, related_name="events"
    )
    target_type = models.CharField(max_length=40, blank=True)
    target_id = models.CharField(max_length=64, blank=True)
    target_label = models.CharField(max_length=255, blank=True)
    field = models.CharField(max_length=60, blank=True)
    old_value = models.CharField(max_length=1000, blank=True)
    new_value = models.CharField(max_length=1000, blank=True)
    reason = models.CharField(max_length=500, blank=True)
    source_file = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        indexes = [models.Index(fields=["supervisor", "created_at"])]


class PendingNotification(models.Model):
    """Notificación que no se pudo entregar en el momento: el comando
    `novedades_retry_notifications` la reintenta sin repetir la operación
    original."""

    message = models.TextField()
    category = models.CharField(max_length=30, blank=True, default="")
    dedup_key = models.CharField(max_length=100, blank=True, default="")
    recipient_ids = models.JSONField(default=list)
    attempts = models.PositiveSmallIntegerField(default=0)
    last_error = models.CharField(max_length=500, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    delivered_at = models.DateTimeField(null=True, blank=True)
