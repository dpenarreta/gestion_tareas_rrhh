"""Fase 15 de la migración de stack (ver docs/AUDIT_LOG.md §
2026-08-20): primera superficie HTTP de `apps.notifications` —
`Notification` existe desde la Fase 3f (`notify()`/`notify_many()`, ya
consumido internamente por Tareas/Proyectos/Escritorio Digital/
Reuniones/Ideas/LOPD) pero sin endpoints propios de lectura/gestión,
gap documentado explícitamente desde entonces. Réplica exacta de
`src/app/api/notifications/route.ts` y
`src/app/api/notifications/[id]/route.ts`."""

from rest_framework import generics
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.tasks.models import Task

from .models import Notification

LIST_LIMIT = 20


def _serialize(notification: Notification, task_owner_map: dict[int, int]) -> dict:
    return {
        "id": notification.id,
        "user_id": notification.user_id,
        "message": notification.message,
        "task_id": notification.task_id,
        "task_title": notification.task_title,
        "read": notification.read,
        "created_at": notification.created_at,
        "task_assigned_to_id": task_owner_map.get(notification.task_id) if notification.task_id is not None else None,
    }


class NotificationListView(generics.GenericAPIView):
    """`GET/PATCH /api/v1/notifications/` — réplica exacta de
    `route.ts`. `GET` lista las 20 notificaciones más recientes del
    usuario + `unread_count`; como `Notification.task_id` NO es una FK
    real (sobrevive al borrado de la tarea, ver `models.py`), se
    resuelve aparte el dueño ACTUAL de cada tarea referenciada
    (`task_assigned_to_id`) para que el cliente sepa a dónde navegar.
    `PATCH` marca TODAS las notificaciones no leídas del usuario como
    leídas (no una en particular — ver `NotificationDetailView` para
    eso)."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        notifications = list(
            Notification.objects.filter(user=request.user).order_by("-created_at")[:LIST_LIMIT]
        )
        unread_count = Notification.objects.filter(user=request.user, read=False).count()

        task_ids = {n.task_id for n in notifications if n.task_id is not None}
        task_owner_map = dict(Task.objects.filter(id__in=task_ids).values_list("id", "assigned_to_id")) if task_ids else {}

        return Response(
            {
                "notifications": [_serialize(n, task_owner_map) for n in notifications],
                "unread_count": unread_count,
            }
        )

    def patch(self, request):
        Notification.objects.filter(user=request.user, read=False).update(read=True)
        return Response({"ok": True})


class NotificationDetailView(generics.GenericAPIView):
    """`PATCH /api/v1/notifications/<id>/` — marca UNA notificación
    como leída. Réplica fiel de `route.ts`: usa un `update` scopeado a
    `id`+`user` (equivalente al `updateMany` del TS) — si el id no
    existe o pertenece a otro usuario, no hace nada y de todas formas
    responde `{ok: true}`, sin 404/403 (mismo comportamiento silencioso
    del original)."""

    permission_classes = [IsAuthenticated]

    def patch(self, request, pk=None):
        Notification.objects.filter(pk=pk, user=request.user).update(read=True)
        return Response({"ok": True})
