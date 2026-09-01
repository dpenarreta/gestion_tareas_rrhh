"""Mejora Continua — Fase 11 de la migración de stack (ver
docs/AUDIT_LOG.md § 2026-08-19). Réplica exacta de los modelos
`ImprovementIdea`/`IdeaVote`/`IdeaStatusHistory` (`prisma/schema.prisma`).

Gap cerrado en la Fase 27 (ver docs/AUDIT_LOG.md § 2026-08-20): el
badge "innovador" (asignado al autor cuando una idea llega a
IMPLEMENTADA, `apps.ideas.services.change_idea_status`) dependía de
`User.badges`, que no existía en el modelo Django hasta la Fase 25
(Dashboard)."""

from django.conf import settings
from django.db import models

from apps.core.models import BaseModel


class ImprovementIdea(BaseModel):
    class Impact(models.TextChoices):
        ALTO = "ALTO"
        MEDIO = "MEDIO"
        BAJO = "BAJO"

    class Status(models.TextChoices):
        PROPUESTA = "PROPUESTA"
        EN_REVISION = "EN_REVISION"
        APROBADA = "APROBADA"
        EN_DESARROLLO = "EN_DESARROLLO"
        EN_PRUEBAS = "EN_PRUEBAS"
        IMPLEMENTADA = "IMPLEMENTADA"
        RECHAZADA = "RECHAZADA"

    title = models.CharField(max_length=255)
    description = models.TextField()
    impact = models.CharField(max_length=10, choices=Impact.choices)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PROPUESTA)
    progress = models.PositiveSmallIntegerField(default=0)
    author = models.ForeignKey(settings.AUTH_USER_MODEL, related_name="proposed_ideas", on_delete=models.PROTECT)
    # `attachmentUrl` en el Prisma original es en realidad el NOMBRE del
    # archivo (`saveAttachment` guarda `file.name`, no una URL) — se
    # renombra a `attachment_name` para no confundir, mismo criterio ya
    # usado en `apps.desk.DeskNote`. `attachment_mime` es un campo nuevo
    # sin equivalente en Prisma (el mime vive embebido en el data: URL
    # de `attachmentData`) — se separa igual que en `DeskNote`, mismo
    # motivo: exponerlo en el listado sin traer el payload completo.
    attachment_name = models.CharField(max_length=255, null=True, blank=True)
    attachment_mime = models.CharField(max_length=255, null=True, blank=True)
    attachment_data = models.TextField(null=True, blank=True)

    class Meta:
        indexes = [models.Index(fields=["author"])]

    def __str__(self) -> str:
        return self.title


class IdeaVote(BaseModel):
    """Voto binario tipo "like" — 1 por `(idea, user)`. El conteo NUNCA
    se desnormaliza en `ImprovementIdea` (réplica fiel: el TS lo cuenta
    on-the-fly con `prisma.ideaVote.count()`/`_count.votes`)."""

    idea = models.ForeignKey(ImprovementIdea, related_name="votes", on_delete=models.CASCADE)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, related_name="idea_votes", on_delete=models.PROTECT)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["idea", "user"], name="unique_idea_vote")]

    def __str__(self) -> str:
        return f"{self.idea_id}:{self.user_id}"


class IdeaStatusHistory(BaseModel):
    idea = models.ForeignKey(ImprovementIdea, related_name="history", on_delete=models.CASCADE)
    from_status = models.CharField(max_length=20, choices=ImprovementIdea.Status.choices)
    to_status = models.CharField(max_length=20, choices=ImprovementIdea.Status.choices)
    changed_by = models.ForeignKey(settings.AUTH_USER_MODEL, related_name="idea_status_changes", on_delete=models.PROTECT)
    comment = models.TextField(null=True, blank=True)

    def __str__(self) -> str:
        return f"{self.idea_id}: {self.from_status} -> {self.to_status}"
