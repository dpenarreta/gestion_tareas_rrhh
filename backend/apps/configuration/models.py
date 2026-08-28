from django.conf import settings
from django.db import models
from django.utils import timezone

from apps.core.models import BaseModel


class Holiday(BaseModel):
    """Catálogo de feriados — portado para la Fase 3d (Motor de Cierre
    Inteligente, ver docs/AUDIT_LOG.md § 2026-08-07). `GET/POST
    /api/v1/settings/holidays/` + `DELETE /api/v1/settings/holidays/<id>/`
    agregados en la Fase 29 (ver docs/AUDIT_LOG.md § 2026-08-20) — no
    sincroniza con el catálogo real de Postgres, que sigue sirviendo la
    pantalla de Ajustes real (sin cutover de `route.ts`)."""

    legacy_postgres_id = models.CharField(max_length=30, unique=True, null=True, blank=True)
    date = models.DateField(unique=True)
    name = models.CharField(max_length=255)
    year = models.PositiveSmallIntegerField(db_index=True)

    class Meta:
        ordering = ["date"]

    def __str__(self) -> str:
        return f"{self.date} — {self.name}"


class SystemConfigHistory(models.Model):
    """Historial de valores de configuración con vigencia por fecha — porción
    mínima portada de `SystemConfigHistory` (Prisma) para que
    `MonthClosureService` calcule días/horas hábiles reales. `value` es
    texto libre (igual que el legacy); `valid_until=None` significa
    "todavía vigente". Sin `updated_at` genérico a propósito: cerrar un
    registro (`valid_until`) vía `.update()` no dispara `auto_now`, y este
    modelo no tiene otra noción de "editado" — solo `created_at` explícito,
    igual que el Prisma original. Sin endpoint HTTP — ver `Holiday` arriba."""

    legacy_postgres_id = models.CharField(max_length=30, unique=True, null=True, blank=True)
    key = models.CharField(max_length=100, db_index=True)
    value = models.CharField(max_length=255)
    valid_from = models.DateTimeField(default=timezone.now)
    valid_until = models.DateTimeField(null=True, blank=True)
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, related_name="config_changes", on_delete=models.PROTECT
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [models.Index(fields=["key", "valid_from"])]
        ordering = ["-valid_from"]

    def __str__(self) -> str:
        return f"{self.key}={self.value}"


class LeaveRecord(BaseModel):
    """Permisos/ausencias de un colaborador — portado para la Fase 4a
    (base horaria del motor de KPIs/Analytics, ver docs/AUDIT_LOG.md §
    2026-08-11). `GET/POST /api/v1/settings/leave-records/` + `DELETE
    /api/v1/settings/leave-records/<id>/` agregados en la Fase 29 (ver
    docs/AUDIT_LOG.md § 2026-08-20) — no sincroniza con
    `/api/settings/leave-records` real (Postgres), sin cutover de
    `route.ts`."""

    class Type(models.TextChoices):
        MEDICO = "MEDICO"
        PERSONAL = "PERSONAL"
        VACACIONES = "VACACIONES"

    legacy_postgres_id = models.CharField(max_length=30, unique=True, null=True, blank=True)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, related_name="leave_records", on_delete=models.CASCADE)
    type = models.CharField(max_length=15, choices=Type.choices)
    date = models.DateField()
    is_full_day = models.BooleanField()
    duration_minutes = models.PositiveIntegerField(null=True, blank=True)
    observation = models.TextField(null=True, blank=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, related_name="+", on_delete=models.PROTECT)

    class Meta:
        indexes = [models.Index(fields=["user", "date"])]
        ordering = ["-date"]

    def __str__(self) -> str:
        return f"{self.user_id}: {self.type} {self.date}"


class SpecialStatus(BaseModel):
    """Estado especial de personal (maternidad/lactancia) — mientras esté
    vigente, la base/límites de KPI de ese usuario ese día son los
    configurados aquí, no los globales. Fase 4a (ver docs/AUDIT_LOG.md §
    2026-08-11). `GET/POST /api/v1/settings/special-status/` +
    `PATCH/DELETE /api/v1/settings/special-status/<id>/` agregados en
    la Fase 29 (ver docs/AUDIT_LOG.md § 2026-08-20)."""

    class Type(models.TextChoices):
        MATERNIDAD = "MATERNIDAD"
        LACTANCIA = "LACTANCIA"

    legacy_postgres_id = models.CharField(max_length=30, unique=True, null=True, blank=True)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, related_name="special_statuses", on_delete=models.CASCADE)
    type = models.CharField(max_length=15, choices=Type.choices)
    start_date = models.DateField()
    end_date = models.DateField(null=True, blank=True)
    is_active = models.BooleanField(default=True)
    # Base de horas diarias — horas objetivo/base (agregación semanal/
    # mensual y denominador del %), separada del límite Moderado/Óptimo.
    daily_hours = models.FloatField(default=6)
    limit_low = models.FloatField(default=5)
    # Umbral real de clasificación Moderado/Óptimo, independiente de
    # daily_hours (por defecto iguales, pero no tienen que serlo).
    limit_base = models.FloatField(default=6)
    limit_high = models.FloatField(default=7)
    limit_overload = models.FloatField(default=8)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, related_name="+", on_delete=models.PROTECT)

    class Meta:
        indexes = [models.Index(fields=["user", "start_date"])]
        ordering = ["-start_date"]

    def __str__(self) -> str:
        return f"{self.user_id}: {self.type} desde {self.start_date}"


class DataPurgeLog(models.Model):
    """Auditoría de una corrida de depuración de retención LOPDP —
    réplica de `DataPurgeLog` (Prisma), Fase 83 (ver docs/AUDIT_LOG.md §
    2026-08-27). Sin `BaseModel` (igual que `SystemConfigHistory` arriba):
    Prisma no tiene `updatedAt`, solo `createdAt` — append-only, nunca se
    edita. Sin `legacy_postgres_id`: decisión explícita del usuario (Fase
    82) de no migrar datos históricos reales."""

    executed_by = models.ForeignKey(settings.AUTH_USER_MODEL, related_name="+", on_delete=models.PROTECT)
    reports_deleted = models.PositiveIntegerField()
    tasks_deleted = models.PositiveIntegerField()
    docs_deleted = models.PositiveIntegerField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"purge {self.created_at}: {self.reports_deleted}r/{self.tasks_deleted}t/{self.docs_deleted}d"
