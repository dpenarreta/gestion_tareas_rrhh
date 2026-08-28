"""Cobertura de `apps.notifications.services` — porción mínima portada
para las acciones de Tareas ya migradas (Fase 3f, ver
docs/AUDIT_LOG.md § 2026-08-07). Cobertura HTTP de `views.py` (Fase 15)
en `test_notification_views.py`."""

import pytest

from apps.notifications.models import Notification
from apps.notifications.services import notify, notify_many
from apps.users.models import User

pytestmark = pytest.mark.django_db


@pytest.fixture
def user():
    return User.objects.create_user(username="user1", email="user1@example.com", password="Sup3r-Secr3t!")


@pytest.fixture
def other_user():
    return User.objects.create_user(username="user2", email="user2@example.com", password="Sup3r-Secr3t!")


def test_notify_creates_notification_with_task_reference(user):
    notification = notify(user=user, message="Hola", task_id=42, task_title="Tarea de prueba")

    assert notification.user_id == user.id
    assert notification.message == "Hola"
    assert notification.task_id == 42
    assert notification.task_title == "Tarea de prueba"
    assert notification.read is False


def test_notify_without_task_reference(user):
    notification = notify(user=user, message="Sin tarea")

    assert notification.task_id is None
    assert notification.task_title is None


def test_notify_many_creates_one_per_user(user, other_user):
    notify_many(users=[user, other_user], message="Para varios")

    assert Notification.objects.filter(message="Para varios").count() == 2


def test_notify_many_with_empty_users_is_noop():
    notify_many(users=[], message="Nadie lo recibe")

    assert not Notification.objects.filter(message="Nadie lo recibe").exists()


def test_notification_survives_task_deletion():
    """`task_id` es un `IntegerField` suelto, sin FK — mismo criterio que
    `TargetTimeAuditLog`/`EndDateAuditLog` (ver models.py)."""
    user = User.objects.create_user(username="u3", email="u3@example.com", password="Sup3r-Secr3t!")
    notification = notify(user=user, message="Tarea borrada", task_id=999, task_title="Ya no existe")

    # No hay FK real a Task -> nada que borrar en cascada, la notificación persiste.
    notification.refresh_from_db()
    assert notification.task_id == 999
