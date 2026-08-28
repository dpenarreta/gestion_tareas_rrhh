from django.shortcuts import get_object_or_404
from rest_framework import generics
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .models import Announcement
from .permissions import can_post_or_delete_announcement, role_name
from .services import create_announcement, list_active_announcements


def _serialize(a: Announcement) -> dict:
    """`author` (nombre/rol) — Fase 44 del cutover de stack (ver
    docs/AUDIT_LOG.md § 2026-08-21): réplica exacta del `include:
    { author: { select: { name: true, role: true } } }` de `route.ts`,
    que este serializer no tenía todavía (su único consumidor real
    hasta ahora era `GET /api/dashboard`, que arma `authorName` con su
    propia consulta Prisma aparte)."""
    return {
        "id": a.id,
        "title": a.title,
        "content": a.content,
        "authorId": a.author_id,
        "author": {"name": a.author.first_name or a.author.username, "role": role_name(a.author)},
        "pinned": a.pinned,
        "expiresAt": a.expires_at.isoformat(),
        "createdAt": a.created_at.isoformat(),
    }


class AnnouncementListView(generics.GenericAPIView):
    """`GET`/`POST /api/v1/announcements/` — réplica exacta de
    `src/app/api/announcements/route.ts`."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response([_serialize(a) for a in list_active_announcements()])

    def post(self, request):
        if not can_post_or_delete_announcement(request.user):
            return Response({"error": "Sin permisos"}, status=403)

        title = (request.data.get("title") or "").strip()
        content = (request.data.get("content") or "").strip()
        duration_days = request.data.get("durationDays")
        if not title or not content or not duration_days:
            return Response({"error": "Faltan campos requeridos"}, status=400)

        announcement = create_announcement(
            author=request.user,
            title=title,
            content=content,
            duration_days=duration_days,
            pinned=request.data.get("pinned", False),
        )
        return Response(_serialize(announcement), status=201)


class AnnouncementDetailView(generics.GenericAPIView):
    """`DELETE /api/v1/announcements/<id>/` — réplica exacta de
    `src/app/api/announcements/[id]/route.ts`."""

    permission_classes = [IsAuthenticated]

    def delete(self, request, pk: int):
        if not can_post_or_delete_announcement(request.user):
            return Response({"error": "Sin permisos"}, status=403)

        announcement = get_object_or_404(Announcement, pk=pk)
        announcement.delete()
        return Response({"ok": True})
