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


class OvertimeMonthClose(models.Model):
    """Cierre MANUAL del mes calendario de Horas extras para UN supervisor
    (independiente del cierre 23 → 22 de Días laborados). Que exista la fila
    = el mes está cerrado para ese equipo: no hay cierre automático; vencido
    el plazo configurado solo se avisa. La restricción única hace idempotente
    el cierre aunque lleguen dos solicitudes a la vez."""

    supervisor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="novedades_overtime_month_closes",
    )
    year = models.PositiveSmallIntegerField()
    month = models.PositiveSmallIntegerField()
    closed_at = models.DateTimeField(auto_now_add=True)
    closed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="novedades_overtime_months_closed",
    )
    # Plazo vigente al cerrar (fecha límite y horas configuradas) y totales.
    summary = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ["-year", "-month"]
        constraints = [
            models.UniqueConstraint(
                fields=["supervisor", "year", "month"], name="novedades_overtime_month_close_uniq"
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


# ── Horas depuradas: copia independiente del consolidado de Horas extras ──────
#
# Tres bases (pedido del 2026-10-13):
#   1. Lo reportado por los supervisores y 2. el consolidado del Asistente de
#      Operaciones viven en `OvertimeRecord` (el consolidado es la vista
#      nacional de los mismos registros). Son el respaldo.
#   3. Horas depuradas: copia propia, por MES CALENDARIO, que el Jefe de
#      Operaciones ajusta. Nada de aquí escribe en `OvertimeRecord`.


class OvertimeDepuration(models.Model):
    """Una base depurable por mes calendario (ámbito nacional). La
    restricción única impide una segunda copia aunque lleguen dos solicitudes a
    la vez; abrirla de nuevo devuelve siempre la misma."""

    year = models.PositiveSmallIntegerField()
    month = models.PositiveSmallIntegerField()
    created_at = models.DateTimeField(auto_now_add=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="novedades_depurations"
    )
    # Fotografía del consolidado usado como punto de partida.
    source_count = models.PositiveIntegerField(default=0)
    source_overtime_hours = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    source_saturday_hours = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    supervisors_total = models.PositiveIntegerField(default=0)
    supervisors_closed = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["-year", "-month"]
        constraints = [
            models.UniqueConstraint(
                fields=["year", "month"], name="novedades_depuration_month_uniq"
            )
        ]


class DepuratedOvertime(models.Model):
    """Un registro de la copia. `orig_*` es la fotografía al crear la copia y
    NUNCA cambia; los campos sin prefijo son el valor depurado editable.
    `source_record` es solo una referencia (SET_NULL): si el origen se borrara,
    la copia y su historia se conservan."""

    depuration = models.ForeignKey(
        OvertimeDepuration, on_delete=models.PROTECT, related_name="rows"
    )
    source_record = models.ForeignKey(
        OvertimeRecord,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="depurated_copies",
    )
    source_id = models.PositiveIntegerField()
    collaborator = models.ForeignKey(
        Collaborator, on_delete=models.PROTECT, related_name="depurated_overtime"
    )
    supervisor = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+"
    )
    date = models.DateField()
    # Identidad tal como estaba al copiar (no cambia si luego cambia la base).
    cedula = models.CharField(max_length=20)
    full_name = models.CharField(max_length=200)
    regional = models.CharField(max_length=100, blank=True)
    area = models.CharField(max_length=100, blank=True)
    cargo = models.CharField(max_length=100, blank=True)
    supervisor_name = models.CharField(max_length=200, blank=True)
    # Fotografía original (inmutable).
    orig_overtime_hours = models.DecimalField(max_digits=5, decimal_places=2)
    orig_saturday_hours = models.DecimalField(max_digits=5, decimal_places=2)
    orig_is_saturday = models.BooleanField()
    orig_is_sunday = models.BooleanField()
    orig_is_holiday = models.BooleanField()
    orig_work_done = models.CharField(max_length=500, blank=True)
    orig_observations = models.CharField(max_length=1000, blank=True)
    # Valores depurados (editables por el Jefe de Operaciones).
    overtime_hours = models.DecimalField(max_digits=5, decimal_places=2)
    saturday_hours = models.DecimalField(max_digits=5, decimal_places=2)
    is_saturday = models.BooleanField()
    is_sunday = models.BooleanField()
    is_holiday = models.BooleanField()
    work_done = models.CharField(max_length=500, blank=True)
    observations = models.CharField(max_length=1000, blank=True)
    # Excluido de la base depurada (no borra el origen ni la fila).
    excluded = models.BooleanField(default=False)
    version = models.PositiveIntegerField(default=1)
    updated_at = models.DateTimeField(auto_now=True)
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="+",
    )

    class Meta:
        ordering = ["date", "full_name", "pk"]
        constraints = [
            models.UniqueConstraint(
                fields=["depuration", "source_id"], name="novedades_depurated_source_uniq"
            )
        ]


class DepurationChange(models.Model):
    """Historial propio de la depuración (solo lectura desde la API): valor de
    la fotografía original, valor depurado anterior y nuevo, responsable,
    fecha y motivo."""

    depuration = models.ForeignKey(
        OvertimeDepuration, on_delete=models.PROTECT, related_name="changes"
    )
    row = models.ForeignKey(DepuratedOvertime, on_delete=models.PROTECT, related_name="changes")
    field = models.CharField(max_length=40)
    original_value = models.CharField(max_length=1000, blank=True)
    old_value = models.CharField(max_length=1000, blank=True)
    new_value = models.CharField(max_length=1000, blank=True)
    reason = models.CharField(max_length=500, blank=True)
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at", "-id"]


# ── Notificaciones de colaboradores por correo (ingreso y salida) ────────────
#
# Salida (2026-10-13): cuando un colaborador pasa de Activo a Inactivo.
# Ingreso (2026-10-15): cuando un colaborador registrado como NUEVO INGRESO
# alcanza su segundo día válido en Días laborados. Ambos usan el SMTP de NEXO
# y cada tipo tiene su propia lista de destinatarios, que administra solo el
# Administrador desde Ajustes.


class CollaboratorNotificationRecipient(models.Model):
    """Destinatario de un tipo de correo (ingreso o salida). Nunca se borra: se
    desactiva, para que el historial de envíos siga apuntando a una dirección
    conocida. Una misma dirección puede estar en ambas listas."""

    class Kind(models.TextChoices):
        ENTRY = "ENTRY", "Ingreso"
        # Una sola lista para Inactivo y Suspendido (cambios de estado).
        EXIT = "EXIT", "Cambio de estado"

    class Area(models.TextChoices):
        OPERACIONES = "OPERACIONES", "Operaciones"
        JEFATURA = "JEFATURA_OPERACIONES", "Jefatura de Operaciones"
        TALENTO_HUMANO = "TALENTO_HUMANO", "Talento Humano"

    kind = models.CharField(max_length=10, choices=Kind.choices, default=Kind.EXIT)
    # Guardado en minúsculas y sin espacios: la restricción única (por lista)
    # impide duplicados que solo difieren en mayúsculas.
    email = models.EmailField(max_length=254)
    area = models.CharField(max_length=30, choices=Area.choices, blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+"
    )
    updated_at = models.DateTimeField(auto_now=True)
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+"
    )

    class Meta:
        ordering = ["kind", "email"]
        constraints = [
            models.UniqueConstraint(fields=["kind", "email"], name="novedades_notif_recipient_uniq")
        ]


class CollaboratorExitNotification(models.Model):
    """Evento de salida (Activo → Inactivo) y estado de su correo.

    Uno por transición: la relación 1 a 1 con el historial de estados es la
    garantía de idempotencia en la base (repetir la solicitud, recargar o
    reintentar nunca crea un segundo evento). `snapshot` guarda el detalle
    de asistencia tal como se notificó, aunque luego cambien los registros."""

    class Status(models.TextChoices):
        PENDING = "PENDING", "Pendiente"
        SENDING = "SENDING", "Enviando"
        SENT = "SENT", "Enviado"
        FAILED = "FAILED", "Fallido"

    status_change = models.OneToOneField(
        CollaboratorStatusChange, on_delete=models.PROTECT, related_name="exit_notification"
    )
    collaborator = models.ForeignKey(
        Collaborator, on_delete=models.PROTECT, related_name="exit_notifications"
    )
    supervisor = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, related_name="+"
    )
    changed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+"
    )
    changed_at = models.DateTimeField()
    previous_status = models.CharField(max_length=10, choices=Collaborator.Status.choices)
    new_status = models.CharField(max_length=10, choices=Collaborator.Status.choices)
    period = models.ForeignKey(OperationalPeriod, on_delete=models.PROTECT, related_name="+")
    snapshot = models.JSONField(null=True, blank=True)
    status = models.CharField(
        max_length=10, choices=Status.choices, default=Status.PENDING, db_index=True
    )
    recipients = models.JSONField(default=list)
    attempts = models.PositiveSmallIntegerField(default=0)
    last_attempt_at = models.DateTimeField(null=True, blank=True)
    last_error = models.CharField(max_length=500, blank=True)
    sent_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at", "-id"]


class CollaboratorEntryNotification(models.Model):
    """Evento de INGRESO de un colaborador y estado de su correo.

    Se crea solo al dar de alta a alguien marcado como "nuevo ingreso"
    (formulario o columna NUEVO INGRESO de la importación; nunca para
    colaboradores existentes): esa marca es la que
    distingue un ingreso real de la carga de un equipo que ya trabajaba. Queda
    "En espera" hasta el SEGUNDO día válido (horas > 0) en Días laborados.
    Uno por alta (1 a 1 con el colaborador): repetir guardados o importaciones
    nunca crea otro."""

    class Status(models.TextChoices):
        WAITING = "WAITING", "En espera del segundo día"
        PENDING = "PENDING", "Pendiente"
        SENDING = "SENDING", "Enviando"
        SENT = "SENT", "Enviado"
        FAILED = "FAILED", "Fallido"

    collaborator = models.OneToOneField(
        Collaborator, on_delete=models.PROTECT, related_name="entry_notification"
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    first_day = models.DateField(null=True, blank=True)
    second_day = models.DateField(null=True, blank=True)
    triggered_at = models.DateTimeField(null=True, blank=True)
    supervisor = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, related_name="+"
    )
    period = models.ForeignKey(
        OperationalPeriod, on_delete=models.PROTECT, null=True, related_name="+"
    )
    snapshot = models.JSONField(null=True, blank=True)
    status = models.CharField(
        max_length=10, choices=Status.choices, default=Status.WAITING, db_index=True
    )
    recipients = models.JSONField(default=list)
    attempts = models.PositiveSmallIntegerField(default=0)
    last_attempt_at = models.DateTimeField(null=True, blank=True)
    last_error = models.CharField(max_length=500, blank=True)
    sent_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at", "-id"]
