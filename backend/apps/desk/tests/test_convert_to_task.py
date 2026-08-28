"""Cobertura HTTP de `POST /api/v1/desk-reminders/[id]/convert-to-task/`
— Fase 7c (ver docs/AUDIT_LOG.md § 2026-08-17): réplica de
`src/app/api/desk-reminders/[id]/convert-to-task/route.ts`."""

from datetime import timedelta

import pytest
from django.contrib.auth.models import Group
from django.utils import timezone
from rest_framework.test import APIClient

from apps.desk.models import DeskAuditLog, PersonalReminder
from apps.tasks.models import Task
from apps.users.models import User

pytestmark = pytest.mark.django_db


def _client_for(user: User) -> APIClient:
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.fixture
def owner():
    user = User.objects.create_user(username="ana", email="ana@example.com", password="Sup3r-Secr3t!")
    user.groups.set([Group.objects.get(name="ANALISTA_CC")])
    return user


@pytest.fixture
def stranger():
    user = User.objects.create_user(username="bruno", email="bruno@example.com", password="Sup3r-Secr3t!")
    user.groups.set([Group.objects.get(name="ASISTENTE_GH")])
    return user


@pytest.fixture
def reminder(owner):
    due_at = (timezone.now() + timedelta(days=1)).isoformat()
    response = _client_for(owner).post(
        "/api/v1/desk-reminders/",
        {"title": "Llamar a Finanzas", "description": "No olvides revisar el contrato", "due_at": due_at, "priority": "URGENTE"},
        format="json",
    )
    assert response.status_code == 201, response.data
    return PersonalReminder.objects.get(id=response.data["id"])


def _convert(client, reminder, **overrides):
    body = {
        "start_date": "2026-08-01T00:00:00Z",
        "end_date": "2026-08-08T00:00:00Z",
        "estimated_hours": 1,
    }
    body.update(overrides)
    return client.post(f"/api/v1/desk-reminders/{reminder.id}/convert-to-task/", body, format="json")


def test_requires_authentication(reminder):
    client = APIClient()
    response = _convert(client, reminder)
    assert response.status_code == 401


def test_returns_404_when_reminder_does_not_exist(owner):
    fake = PersonalReminder(id=999999)
    response = _convert(_client_for(owner), fake)
    assert response.status_code == 404


def test_returns_403_when_not_the_owner(stranger, reminder):
    response = _convert(_client_for(stranger), reminder)
    assert response.status_code == 403


def test_returns_409_when_already_converted(owner, reminder):
    first = _convert(_client_for(owner), reminder)
    assert first.status_code == 201

    second = _convert(_client_for(owner), reminder)
    assert second.status_code == 409


def test_returns_400_when_missing_required_fields(owner, reminder):
    response = _client_for(owner).post(f"/api/v1/desk-reminders/{reminder.id}/convert-to-task/", {}, format="json")
    assert response.status_code == 400


def test_urgente_maps_to_alta_and_marks_reminder_without_deleting_it(owner, reminder):
    response = _convert(_client_for(owner), reminder)
    assert response.status_code == 201

    task = Task.objects.get(id=response.data["task_id"])
    assert task.title == "Llamar a Finanzas"
    assert task.priority == Task.Priority.ALTA
    assert task.assigned_to_id == owner.id
    assert task.created_by_id == owner.id
    assert task.description == "No olvides revisar el contrato"

    reminder.refresh_from_db()
    assert reminder.converted_to_task_id == task.id
    assert reminder.converted_to_task_at is not None
    assert PersonalReminder.objects.filter(id=reminder.id).exists()

    assert DeskAuditLog.objects.filter(
        entity_type="REMINDER", entity_id=reminder.id, action="CONVERTED_TO_TASK", metadata__taskId=task.id
    ).exists()


def test_blank_title_falls_back_to_reminder_title(owner, reminder):
    response = _convert(_client_for(owner), reminder, title="   ")
    assert response.status_code == 201
    assert response.data["task_title"] == "Llamar a Finanzas"


def test_custom_title_overrides_reminder_title(owner, reminder):
    response = _convert(_client_for(owner), reminder, title="Contactar a Finanzas ya")
    assert response.status_code == 201
    assert response.data["task_title"] == "Contactar a Finanzas ya"


def test_media_priority_maps_to_media(owner):
    due_at = (timezone.now() + timedelta(days=1)).isoformat()
    created = _client_for(owner).post(
        "/api/v1/desk-reminders/", {"title": "Revisar planilla", "due_at": due_at, "priority": "MEDIA"}, format="json"
    )
    reminder = PersonalReminder.objects.get(id=created.data["id"])

    response = _convert(_client_for(owner), reminder)
    task = Task.objects.get(id=response.data["task_id"])
    assert task.priority == Task.Priority.MEDIA
