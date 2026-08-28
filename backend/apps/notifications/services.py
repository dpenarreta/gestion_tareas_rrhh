"""Escritura de notificaciones — porción mínima portada para las acciones
de Tareas ya migradas (Fase 3f, ver docs/AUDIT_LOG.md § 2026-08-07). La
lectura/gestión (marcar leída, listar) vive en `views.py` desde la Fase
15 (ver docs/AUDIT_LOG.md § 2026-08-20)."""

from .models import Notification


def notify(*, user, message: str, task_id: int | None = None, task_title: str | None = None) -> Notification:
    return Notification.objects.create(user=user, message=message, task_id=task_id, task_title=task_title)


def notify_many(*, users, message: str, task_id: int | None = None, task_title: str | None = None) -> None:
    users = list(users)
    if not users:
        return
    Notification.objects.bulk_create(
        [Notification(user=user, message=message, task_id=task_id, task_title=task_title) for user in users]
    )
