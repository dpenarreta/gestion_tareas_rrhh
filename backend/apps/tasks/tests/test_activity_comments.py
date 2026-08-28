"""Cobertura de comentarios sobre un registro de horas — sub-fase 3f (ver
docs/AUDIT_LOG.md § 2026-08-07)."""

import pytest
from django.contrib.auth.models import Group
from django.utils import timezone
from rest_framework.test import APIClient

from apps.notifications.models import Notification
from apps.tasks.models import ActivityComment, Task, TaskActivity
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
def manager():
    user = User.objects.create_user(username="manager", email="manager@example.com", password="Sup3r-Secr3t!")
    user.groups.set([Group.objects.get(name="COORDINADOR_NACIONAL")])
    return user


@pytest.fixture
def manager_client(manager):
    client = APIClient()
    client.force_authenticate(user=manager)
    return client


@pytest.fixture
def stranger():
    return User.objects.create_user(username="stranger", email="stranger@example.com", password="Sup3r-Secr3t!")


@pytest.fixture
def stranger_client(stranger):
    client = APIClient()
    client.force_authenticate(user=stranger)
    return client


def _task(assigned_to: User, created_by: User) -> Task:
    return Task.objects.create(
        title="Tarea", priority="MEDIA", frequency="PUNTUAL", type="SEGUIMIENTO",
        start_date=timezone.now(), end_date=timezone.now(), estimated_hours=1,
        assigned_to=assigned_to, created_by=created_by,
    )


def _activity(task: Task, author: User) -> TaskActivity:
    return TaskActivity.objects.create(task=task, author=author, reason="trabajo_general", duration=60)


def test_post_and_list_comments(collaborator_client, collaborator):
    task = _task(collaborator, collaborator)
    activity = _activity(task, collaborator)

    post_response = collaborator_client.post(
        f"/api/v1/tasks/{task.id}/activities/{activity.id}/comments/", {"text": "Hola"}, format="json"
    )
    list_response = collaborator_client.get(f"/api/v1/tasks/{task.id}/activities/{activity.id}/comments/")

    assert post_response.status_code == 201
    assert list_response.status_code == 200
    assert len(list_response.data) == 1
    assert ActivityComment.objects.filter(activity=activity).count() == 1


def test_comment_requires_non_empty_text(collaborator_client, collaborator):
    task = _task(collaborator, collaborator)
    activity = _activity(task, collaborator)

    response = collaborator_client.post(
        f"/api/v1/tasks/{task.id}/activities/{activity.id}/comments/", {"text": ""}, format="json"
    )

    assert response.status_code == 400


def test_stranger_cannot_access_activity_comments(stranger_client, collaborator):
    task = _task(collaborator, collaborator)
    activity = _activity(task, collaborator)

    response = stranger_client.get(f"/api/v1/tasks/{task.id}/activities/{activity.id}/comments/")

    assert response.status_code == 404


def test_comment_notifies_prior_participants_excluding_actor(collaborator_client, collaborator, manager, manager_client):
    task = _task(collaborator, collaborator)
    activity = _activity(task, collaborator)

    # manager comenta primero -> notifica al autor de la actividad (collaborator).
    manager_client.post(f"/api/v1/tasks/{task.id}/activities/{activity.id}/comments/", {"text": "primero"}, format="json")
    assert Notification.objects.filter(user=collaborator).count() == 1
    assert Notification.objects.filter(user=manager).count() == 0  # nunca se notifica a sí mismo

    # collaborator (autor de la actividad) responde -> notifica a manager (comentarista previo), no a sí mismo.
    collaborator_client.post(f"/api/v1/tasks/{task.id}/activities/{activity.id}/comments/", {"text": "respuesta"}, format="json")

    assert Notification.objects.filter(user=manager).count() == 1
    assert Notification.objects.filter(user=collaborator).count() == 1  # sigue en 1, no recibió una segunda


def test_first_commenter_is_notified_when_someone_else_replies(collaborator_client, collaborator, manager, manager_client):
    task = _task(collaborator, collaborator)
    activity = _activity(task, collaborator)

    collaborator_client.post(f"/api/v1/tasks/{task.id}/activities/{activity.id}/comments/", {"text": "hola"}, format="json")
    manager_client.post(f"/api/v1/tasks/{task.id}/activities/{activity.id}/comments/", {"text": "respondo"}, format="json")

    assert Notification.objects.filter(user=collaborator, message__icontains="Coordinador Nacional").exists()
