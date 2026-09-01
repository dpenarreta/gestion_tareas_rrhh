"""Reuniones — Fase 10 de la migración de stack (ver docs/AUDIT_LOG.md
§ 2026-08-19). Réplica exacta de los modelos `Meeting`/`MeetingInvitee`
(`prisma/schema.prisma`). Integración real con Zoom (OAuth
Server-to-Server, `zoom.py`) para crear la reunión; Otter.ai NO tiene
ninguna integración de API — `otter_invited`/`otter_summary`/
`otter_transcript_url` son campos editados a mano por el anfitrión
(confirmado contra el TS: sin llamadas HTTP a otter.ai en ningún
lado)."""

from django.conf import settings
from django.db import models

from apps.core.models import BaseModel


class Meeting(BaseModel):
    class Status(models.TextChoices):
        PROGRAMADA = "PROGRAMADA"
        EN_CURSO = "EN_CURSO"
        FINALIZADA = "FINALIZADA"

    title = models.CharField(max_length=255)
    description = models.TextField(null=True, blank=True)
    # RESTRICT en el Prisma original -> PROTECT, mismo criterio que
    # Task.assigned_to/Project.responsible en el resto del backend.
    host = models.ForeignKey(settings.AUTH_USER_MODEL, related_name="hosted_meetings", on_delete=models.PROTECT)
    meeting_date = models.DateTimeField()
    duration = models.PositiveIntegerField()
    zoom_meeting_id = models.CharField(max_length=50, null=True, blank=True)
    zoom_join_url = models.TextField(null=True, blank=True)
    zoom_password = models.CharField(max_length=50, null=True, blank=True)
    status = models.CharField(max_length=15, choices=Status.choices, default=Status.PROGRAMADA)
    otter_invited = models.BooleanField(default=False)
    otter_summary = models.TextField(null=True, blank=True)
    otter_transcript_url = models.TextField(null=True, blank=True)

    class Meta:
        indexes = [models.Index(fields=["host"])]

    def __str__(self) -> str:
        return self.title


class MeetingInvitee(BaseModel):
    """Réplica de `MeetingInvitee`. El Prisma original no tiene
    `createdAt`/`updatedAt` propios (solo `id`/`meetingId`/`userId`/
    `attended`) — se hereda `BaseModel` igual que el resto de los
    modelos intermedios de este backend (p. ej. `ProjectParticipant`),
    ganando esos 2 campos de auditoría como plus, sin consumidor que
    dependa de su ausencia. `attended` no tiene ningún endpoint/UI que
    lo lea o escriba en el TS actual (campo "muerto" heredado del
    modelo, confirmado en la investigación de esta fase) — se porta
    fiel al esquema, sin agregar funcionalidad nueva no solicitada."""

    meeting = models.ForeignKey(Meeting, related_name="invitees", on_delete=models.CASCADE)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, related_name="meeting_invitations", on_delete=models.PROTECT)
    attended = models.BooleanField(default=False)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["meeting", "user"], name="unique_meeting_invitee")]

    def __str__(self) -> str:
        return f"{self.meeting_id}:{self.user_id}"
