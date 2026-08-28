"""Orquestación de Comunicados — Fase 25 (ver docs/AUDIT_LOG.md §
2026-08-20). Réplica exacta de los handlers `GET`/`POST
/api/announcements` y `DELETE /api/announcements/[id]`."""

from django.utils import timezone

from apps.hierarchy.services import get_visible_groups
from apps.notifications.services import notify_many
from apps.users.models import User

from .models import Announcement


def list_active_announcements():
    """Réplica exacta de `GET /api/announcements`: vigentes (`expiresAt`
    en el futuro), fijados primero, más recientes primero.
    `prefetch_related("author__groups")` — Fase 44 del cutover de
    stack: `_serialize` ahora resuelve `role_name(a.author)` por cada
    fila, evita un N+1 sobre `Group`."""
    return (
        Announcement.objects.filter(expires_at__gt=timezone.now())
        .select_related("author")
        .prefetch_related("author__groups")
        .order_by("-pinned", "-created_at")
    )


def create_announcement(*, author, title: str, content: str, duration_days, pinned: bool) -> Announcement:
    """Réplica exacta de `POST /api/announcements`: `durationDays` se
    acota a `[1, 30]`, y se notifica a todos los usuarios visibles para
    el autor (excluyéndolo) — mismo criterio de visibilidad que
    `getVisibleRoles`, vía `get_visible_groups`."""
    days = max(1, min(30, int(duration_days)))
    expires_at = timezone.now() + timezone.timedelta(days=days)

    announcement = Announcement.objects.create(
        title=title.strip(), content=content.strip(), author=author, expires_at=expires_at, pinned=bool(pinned)
    )

    visible_groups = get_visible_groups(author)
    targets = User.objects.filter(groups__in=visible_groups).exclude(pk=author.id).distinct()
    notify_many(users=targets, message=f'Nuevo comunicado: "{announcement.title}"')

    return announcement
