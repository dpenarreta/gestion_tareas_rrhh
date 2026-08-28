"""Cobertura HTTP de `apps.notifications.views` — Fase 15 (ver
docs/AUDIT_LOG.md § 2026-08-20), réplica de
`src/app/api/notifications/route.ts` y
`src/app/api/notifications/[id]/route.ts`."""

import pytest
from rest_framework.test import APIClient

from apps.notifications.models import Notification
from apps.notifications.services import notify
from apps.tasks.models import Task
from apps.users.models import User

pytestmark = pytest.mark.django_db


def _client_for(user: User) -> APIClient:
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.fixture
def user():
    return User.objects.create_user(username="u1", email="u1@example.com", password="Sup3r-Secr3t!")


@pytest.fixture
def other_user():
    return User.objects.create_user(username="u2", email="u2@example.com", password="Sup3r-Secr3t!")


def _create_task(*, assigned_to: User, created_by: User) -> Task:
    return Task.objects.create(
        title="Tarea", priority=Task.Priority.MEDIA, frequency=Task.Frequency.PUNTUAL, type=Task.Type.FIJA,
        start_date="2026-08-01T00:00:00Z", end_date="2026-08-10T00:00:00Z", estimated_hours=5,
        assigned_to=assigned_to, created_by=created_by,
    )


# --- GET /notifications/ ---------------------------------------------------------------


def test_list_requires_authentication():
    response = APIClient().get("/api/v1/notifications/")
    assert response.status_code == 401


def test_list_returns_only_own_notifications_newest_first(user, other_user):
    notify(user=user, message="Primera")
    notify(user=user, message="Segunda")
    notify(user=other_user, message="Ajena")

    response = _client_for(user).get("/api/v1/notifications/")
    assert response.status_code == 200
    assert [n["message"] for n in response.data["notifications"]] == ["Segunda", "Primera"]


def test_list_respects_20_item_limit(user):
    for i in range(25):
        notify(user=user, message=f"N{i}")

    response = _client_for(user).get("/api/v1/notifications/")
    assert len(response.data["notifications"]) == 20


def test_list_unread_count(user):
    n1 = notify(user=user, message="Leída")
    notify(user=user, message="No leída 1")
    notify(user=user, message="No leída 2")
    n1.read = True
    n1.save(update_fields=["read"])

    response = _client_for(user).get("/api/v1/notifications/")
    assert response.data["unread_count"] == 2


def test_list_resolves_current_task_owner(user, other_user):
    task = _create_task(assigned_to=other_user, created_by=user)
    notify(user=user, message="Con tarea", task_id=task.id, task_title=task.title)

    response = _client_for(user).get("/api/v1/notifications/")
    entry = response.data["notifications"][0]
    assert entry["task_id"] == task.id
    assert entry["task_assigned_to_id"] == other_user.id


def test_list_task_assigned_to_id_none_when_task_deleted(user, other_user):
    task = _create_task(assigned_to=other_user, created_by=user)
    notify(user=user, message="Tarea borrada", task_id=task.id, task_title=task.title)
    task.delete()

    response = _client_for(user).get("/api/v1/notifications/")
    entry = response.data["notifications"][0]
    assert entry["task_id"] is not None
    assert entry["task_assigned_to_id"] is None


def test_list_task_assigned_to_id_none_without_task_reference(user):
    notify(user=user, message="Sin tarea")

    response = _client_for(user).get("/api/v1/notifications/")
    entry = response.data["notifications"][0]
    assert entry["task_id"] is None
    assert entry["task_assigned_to_id"] is None


# --- PATCH /notifications/ (marcar todas como leídas) -----------------------------------


def test_mark_all_read_requires_authentication():
    response = APIClient().patch("/api/v1/notifications/")
    assert response.status_code == 401


def test_mark_all_read_only_affects_own_unread_notifications(user, other_user):
    own_unread = notify(user=user, message="Propia no leída")
    own_read = notify(user=user, message="Propia ya leída")
    own_read.read = True
    own_read.save(update_fields=["read"])
    other_unread = notify(user=other_user, message="Ajena no leída")

    response = _client_for(user).patch("/api/v1/notifications/", format="json")
    assert response.status_code == 200
    assert response.data == {"ok": True}

    own_unread.refresh_from_db()
    other_unread.refresh_from_db()
    assert own_unread.read is True
    assert other_unread.read is False


# --- PATCH /notifications/<id>/ (marcar una como leída) ---------------------------------


def test_mark_one_read_requires_authentication():
    response = APIClient().patch("/api/v1/notifications/1/")
    assert response.status_code == 401


def test_mark_one_read_marks_own_notification(user):
    notification = notify(user=user, message="Una notificación")

    response = _client_for(user).patch(f"/api/v1/notifications/{notification.id}/", format="json")
    assert response.status_code == 200
    assert response.data == {"ok": True}

    notification.refresh_from_db()
    assert notification.read is True


def test_mark_one_read_is_a_silent_noop_for_another_users_notification(user, other_user):
    notification = notify(user=other_user, message="No es mía")

    response = _client_for(user).patch(f"/api/v1/notifications/{notification.id}/", format="json")
    assert response.status_code == 200
    assert response.data == {"ok": True}

    notification.refresh_from_db()
    assert notification.read is False


def test_mark_one_read_is_a_silent_noop_for_missing_id(user):
    response = _client_for(user).patch("/api/v1/notifications/999999/", format="json")
    assert response.status_code == 200
    assert response.data == {"ok": True}
    assert not Notification.objects.filter(pk=999999).exists()
