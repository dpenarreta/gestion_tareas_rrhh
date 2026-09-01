from django.conf import settings
from django.db import models

from apps.core.models import BaseModel


class Announcement(BaseModel):
    """Comunicados internos — Fase 25 de la migración de stack (ver
    docs/AUDIT_LOG.md § 2026-08-20). Réplica de `Announcement`
    (`prisma/schema.prisma`) y de `src/app/api/announcements/route.ts`/
    `[id]/route.ts`. Único consumidor hasta ahora: el widget de
    comunicados de `GET /api/dashboard`."""

    title = models.CharField(max_length=255)
    content = models.TextField()
    author = models.ForeignKey(
        settings.AUTH_USER_MODEL, related_name="announcements", on_delete=models.PROTECT
    )
    expires_at = models.DateTimeField()
    pinned = models.BooleanField(default=False)

    class Meta:
        indexes = [models.Index(fields=["expires_at"])]

    def __str__(self) -> str:
        return self.title
