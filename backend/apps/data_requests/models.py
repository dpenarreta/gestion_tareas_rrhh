"""Solicitudes LOPD — Fase 12 de la migración de stack (ver
docs/AUDIT_LOG.md § 2026-08-19). Réplica exacta de `DataSubjectRequest`
(`prisma/schema.prisma`).

Alcance de esta fase, decisión explícita del usuario: SOLO
`DataSubjectRequest` (crear/listar/resolver + exportar "mis datos").
El gate de consentimiento (`User.dataConsentAccepted`/
`dataConsentAcceptedAt`, `PATCH /api/auth/consent`, reset individual/
masivo) es un mecanismo distinto — bloquea el render de toda la app en
vez de ser una cola de tickets — y queda deferido a una sub-fase
futura, sin campos agregados al modelo `User` en esta fase.

Investigado antes de escribir código (ver docs/AUDIT_LOG.md para el
detalle): NO hay borrado/anonimización real de datos de un titular en
este módulo — `type=ELIMINACION` solo crea un registro `PENDIENTE`
que un Administrador gestiona 100% manualmente fuera del sistema
(confirmado contra `docs/RAT.md`); no hay ninguna operación
irreversible que portar con cuidado especial más allá de la fidelidad
de contenido/textos legales."""

from django.conf import settings
from django.db import models

from apps.core.models import BaseModel


class DataSubjectRequest(BaseModel):
    class Type(models.TextChoices):
        ACCESO = "ACCESO"
        RECTIFICACION = "RECTIFICACION"
        ELIMINACION = "ELIMINACION"

    class Status(models.TextChoices):
        PENDIENTE = "PENDIENTE"
        EN_PROCESO = "EN_PROCESO"
        RESUELTA = "RESUELTA"

    # CASCADE en el Prisma original ("DataSubjectRequestUser") — a
    # diferencia del resto del backend (que usa PROTECT para User), acá
    # se replica CASCADE tal cual: si se borra la cuenta del titular,
    # sus propias solicitudes de datos ya no tienen sentido que persistan.
    user = models.ForeignKey(settings.AUTH_USER_MODEL, related_name="data_subject_requests", on_delete=models.CASCADE)
    type = models.CharField(max_length=20, choices=Type.choices)
    description = models.TextField(null=True, blank=True)
    status = models.CharField(max_length=15, choices=Status.choices, default=Status.PENDIENTE)
    resolved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, related_name="resolved_data_subject_requests", null=True, blank=True, on_delete=models.SET_NULL
    )
    resolved_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        indexes = [models.Index(fields=["status", "created_at"])]

    def __str__(self) -> str:
        return f"{self.type} ({self.user_id})"
