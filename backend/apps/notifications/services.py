"""Escritura de notificaciones — porción mínima portada para las acciones
de Tareas ya migradas (Fase 3f, ver docs/AUDIT_LOG.md § 2026-08-07). La
lectura/gestión (marcar leída, listar) vive en `views.py` desde la Fase
15 (ver docs/AUDIT_LOG.md § 2026-08-20)."""

from .models import Notification


def notify(
    *,
    user,
    message: str,
    task_id: int | None = None,
    task_title: str | None = None,
    category: str = "",
) -> Notification:
    return Notification.objects.create(
        user=user, message=message, task_id=task_id, task_title=task_title, category=category
    )


def notify_many(
    *,
    users,
    message: str,
    task_id: int | None = None,
    task_title: str | None = None,
    category: str = "",
    dedup_key: str | None = None,
) -> None:
    """Con `dedup_key`, un mismo aviso no se repite a quien ya lo recibió
    (reintentos, doble envío)."""
    users = list(users)
    if dedup_key:
        already = set(
            Notification.objects.filter(dedup_key=dedup_key, user__in=users).values_list(
                "user_id", flat=True
            )
        )
        users = [u for u in users if u.pk not in already]
    if not users:
        return
    Notification.objects.bulk_create(
        [
            Notification(
                user=user,
                message=message,
                task_id=task_id,
                task_title=task_title,
                category=category,
                dedup_key=dedup_key,
            )
            for user in users
        ]
    )
