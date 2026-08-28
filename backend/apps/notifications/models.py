from django.conf import settings
from django.db import models


class Notification(models.Model):
    """Notificación in-app — porción mínima portada para las acciones de
    Tareas ya migradas (Fase 3f, ver docs/AUDIT_LOG.md § 2026-08-07).
    Endpoints HTTP (`GET/PATCH /notifications/`, `PATCH
    /notifications/<id>/`) agregados en la Fase 15 (ver
    docs/AUDIT_LOG.md § 2026-08-20) — sin cutover de `route.ts`
    todavía: `/api/notifications` real sigue 100% en Postgres,
    alimentado también por módulos todavía no migrados a Django (ej.
    Nova/Dashboard). `task_id` es intencionalmente un `IntegerField`
    SUELTO, sin FK — mismo criterio ya usado en
    `TargetTimeAuditLog`/`EndDateAuditLog`: sobrevive al borrado de la
    tarea. Sin `updated_at`: el Prisma original no lo tiene.
    `dedup_key` se agrega en la Fase 20 (ver docs/AUDIT_LOG.md §
    2026-08-20): el TS de `operational-risk/team` reutiliza `taskId`
    (`String` en Prisma) como marcador de texto libre para deduplicar
    notificaciones automáticas ("una vez por persona/mes") — un abuso
    de tipo que no es posible replicar en `task_id`, un
    `PositiveBigIntegerField` real desde la Fase 3f. `dedup_key` es la
    forma correcta de portar ese mismo mecanismo sin sobrecargar
    `task_id`."""

    legacy_postgres_id = models.CharField(max_length=30, unique=True, null=True, blank=True)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, related_name="notifications", on_delete=models.CASCADE)
    message = models.TextField()
    task_id = models.PositiveBigIntegerField(null=True, blank=True, db_index=True)
    task_title = models.CharField(max_length=255, null=True, blank=True)
    dedup_key = models.CharField(max_length=100, null=True, blank=True, db_index=True)
    read = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"{self.user_id}: {self.message[:50]}"
