"""Cobertura de edición por Admin de horas + eliminación por el autor —
sub-fase 3f (ver docs/AUDIT_LOG.md § 2026-08-07)."""

import pytest
from django.contrib.auth.models import Group
from django.utils import timezone
from rest_framework.test import APIClient

from apps.notifications.models import Notification
from apps.tasks.models import ActivityAuditLog, Task, TaskActivity
from apps.users.models import User

pytestmark = pytest.mark.django_db


@pytest.fixture
def collaborator():
    user = User.objects.create_user(username="collab", email="collab@example.com", password="Sup3r-Secr3t!")
    user.groups.set([Group.objects.get(name="ANALISTA_CC")])
    return user


@pytest.fixture
def collaborator_client(collaborator):
    client = APIClient()
    client.force_authenticate(user=collaborator)
    return client


@pytest.fixture
def administrador():
    return User.objects.create_user(
        username="admin", email="admin@example.com", password="Sup3r-Secr3t!", is_superuser=True
    )


@pytest.fixture
def administrador_client(administrador):
    client = APIClient()
    client.force_authenticate(user=administrador)
    return client


@pytest.fixture
def manager():
    # usuarios.editar por grupo, pero NO is_superuser — no debe poder editar horas.
    user = User.objects.create_user(username="manager", email="manager@example.com", password="Sup3r-Secr3t!")
    user.groups.set([Group.objects.get(name="COORDINADOR_NACIONAL")])
    return user


@pytest.fixture
def manager_client(manager):
    client = APIClient()
    client.force_authenticate(user=manager)
    return client


def _task(assigned_to: User, created_by: User) -> Task:
    return Task.objects.create(
        title="Tarea", priority="MEDIA", frequency="PUNTUAL", type="SEGUIMIENTO",
        start_date=timezone.now(), end_date=timezone.now(), estimated_hours=1,
        assigned_to=assigned_to, created_by=created_by,
    )


def _activity(task: Task, author: User, duration: int = 60) -> TaskActivity:
    return TaskActivity.objects.create(task=task, author=author, reason="trabajo_general", duration=duration)


# --- edición por Admin --------------------------------------------------------


def test_admin_edits_duration_and_creates_audit_log(administrador_client, administrador, collaborator):
    task = _task(collaborator, collaborator)
    activity = _activity(task, collaborator, duration=60)

    response = administrador_client.patch(
        f"/api/v1/tasks/{task.id}/activities/{activity.id}/",
        {"hours": 2, "minutes": 0, "comment": "Corrección por horas mal registradas"},
        format="json",
    )

    assert response.status_code == 200
    activity.refresh_from_db()
    assert activity.duration == 120
    assert activity.modified_by_admin is True
    assert activity.admin_comment == "Corrección por horas mal registradas"
    assert activity.modified_at is not None

    log = ActivityAuditLog.objects.get(activity_id=activity.id)
    assert log.old_duration == 60
    assert log.new_duration == 120
    assert log.admin_id == administrador.id


def test_admin_edit_recalculates_task_real_hours(administrador_client, collaborator):
    task = _task(collaborator, collaborator)
    activity = _activity(task, collaborator, duration=60)
    task.real_hours = 1.0
    task.save(update_fields=["real_hours"])

    administrador_client.patch(
        f"/api/v1/tasks/{task.id}/activities/{activity.id}/",
        {"hours": 3, "minutes": 0, "comment": "ajuste"},
        format="json",
    )

    task.refresh_from_db()
    assert task.real_hours == 3.0


def test_admin_edit_notifies_assigned_to(administrador_client, collaborator):
    task = _task(collaborator, collaborator)
    activity = _activity(task, collaborator)

    administrador_client.patch(
        f"/api/v1/tasks/{task.id}/activities/{activity.id}/",
        {"hours": 2, "minutes": 0, "comment": "ajuste de horas"},
        format="json",
    )

    notification = Notification.objects.get(user=collaborator)
    assert "ajuste de horas" in notification.message


def test_admin_edit_requires_comment(administrador_client, collaborator):
    task = _task(collaborator, collaborator)
    activity = _activity(task, collaborator)

    response = administrador_client.patch(
        f"/api/v1/tasks/{task.id}/activities/{activity.id}/", {"hours": 2, "minutes": 0, "comment": ""}, format="json"
    )

    assert response.status_code == 400


def test_manager_with_usuarios_editar_but_not_superuser_cannot_edit(manager_client, collaborator):
    task = _task(collaborator, collaborator)
    activity = _activity(task, collaborator)

    response = manager_client.patch(
        f"/api/v1/tasks/{task.id}/activities/{activity.id}/",
        {"hours": 2, "minutes": 0, "comment": "intento"},
        format="json",
    )

    assert response.status_code == 403


# --- eliminación por el autor -------------------------------------------------


def test_author_can_delete_own_activity(collaborator_client, collaborator):
    task = _task(collaborator, collaborator)
    activity = _activity(task, collaborator, duration=60)
    task.real_hours = 1.0
    task.save(update_fields=["real_hours"])

    response = collaborator_client.delete(f"/api/v1/tasks/{task.id}/activities/{activity.id}/")

    assert response.status_code == 200
    assert not TaskActivity.objects.filter(id=activity.id).exists()
    task.refresh_from_db()
    assert task.real_hours == 0


def test_non_author_cannot_delete_activity(administrador_client, collaborator):
    task = _task(collaborator, collaborator)
    activity = _activity(task, collaborator)

    response = administrador_client.delete(f"/api/v1/tasks/{task.id}/activities/{activity.id}/")

    assert response.status_code == 403
    assert TaskActivity.objects.filter(id=activity.id).exists()
