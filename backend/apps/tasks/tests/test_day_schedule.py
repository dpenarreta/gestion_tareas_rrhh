"""Cobertura HTTP de `DayScheduleView` — Fase 26 (ver docs/AUDIT_LOG.md
§ 2026-08-20), réplica de `src/app/api/activities/day-schedule/route.ts`."""

from datetime import timedelta

import pytest
from django.contrib.auth.models import Group
from django.utils import timezone
from rest_framework.test import APIClient

from apps.tasks.business_time import business_calendar_day, business_day_real_range
from apps.tasks.models import Task, TaskActivity
from apps.users.models import User

pytestmark = pytest.mark.django_db


def _client_for(user: User) -> APIClient:
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.fixture
def analista():
    user = User.objects.create_user(username="analista", email="analista@example.com", password="Sup3r-Secr3t!")
    user.groups.set([Group.objects.get(name="ANALISTA_CC")])
    return user


def _create_task(*, assigned_to: User, created_by: User, **overrides) -> Task:
    now = timezone.now()
    payload = dict(
        title="Tarea", priority=Task.Priority.MEDIA, frequency=Task.Frequency.PUNTUAL, type=Task.Type.SEGUIMIENTO,
        start_date=now, end_date=now + timedelta(days=3), estimated_hours=5,
        assigned_to=assigned_to, created_by=created_by, status=Task.Status.PENDIENTE,
    )
    payload.update(overrides)
    return Task.objects.create(**payload)


def test_requires_authentication():
    response = APIClient().get("/api/v1/activities/day-schedule/")
    assert response.status_code == 401


def test_rejects_invalid_date_param(analista):
    response = _client_for(analista).get("/api/v1/activities/day-schedule/?date=not-a-date")
    assert response.status_code == 400


def test_returns_todays_seguimiento_activities_with_schedule(analista):
    task = _create_task(assigned_to=analista, created_by=analista, title="Reunión")
    activity = TaskActivity.objects.create(
        task=task, author=analista, reason="reunion", duration=60, start_time="09:00", end_time="10:00"
    )

    response = _client_for(analista).get("/api/v1/activities/day-schedule/")
    assert response.status_code == 200
    assert len(response.data) == 1
    entry = response.data[0]
    assert entry["id"] == activity.id
    assert entry["startTime"] == "09:00"
    assert entry["endTime"] == "10:00"
    assert entry["taskId"] == task.id
    assert entry["taskTitle"] == "Reunión"


def test_excludes_fija_task_activities(analista):
    task = _create_task(assigned_to=analista, created_by=analista, type=Task.Type.FIJA)
    TaskActivity.objects.create(
        task=task, author=analista, reason="trabajo", duration=60, start_time="09:00", end_time="10:00"
    )

    response = _client_for(analista).get("/api/v1/activities/day-schedule/")
    assert response.data == []


def test_excludes_activities_without_full_schedule(analista):
    task = _create_task(assigned_to=analista, created_by=analista)
    TaskActivity.objects.create(task=task, author=analista, reason="reunion", duration=60)

    response = _client_for(analista).get("/api/v1/activities/day-schedule/")
    assert response.data == []


def test_excludes_other_users_activities(analista):
    other = User.objects.create_user(username="otro", email="otro@example.com", password="Sup3r-Secr3t!")
    other.groups.set([Group.objects.get(name="ANALISTA_CC")])
    task = _create_task(assigned_to=other, created_by=other)
    TaskActivity.objects.create(
        task=task, author=other, reason="reunion", duration=60, start_time="09:00", end_time="10:00"
    )

    response = _client_for(analista).get("/api/v1/activities/day-schedule/")
    assert response.data == []


def test_date_param_scopes_to_that_business_day(analista):
    task = _create_task(assigned_to=analista, created_by=analista)
    activity = TaskActivity.objects.create(
        task=task, author=analista, reason="reunion", duration=60, start_time="09:00", end_time="10:00"
    )
    other_day = business_calendar_day(timezone.now()) - timedelta(days=10)
    other_start, _ = business_day_real_range(other_day)
    TaskActivity.objects.filter(pk=activity.pk).update(created_at=other_start)

    response_today = _client_for(analista).get("/api/v1/activities/day-schedule/")
    assert response_today.data == []

    response_other_day = _client_for(analista).get(f"/api/v1/activities/day-schedule/?date={other_day.isoformat()}")
    assert len(response_other_day.data) == 1
    assert response_other_day.data[0]["id"] == activity.id
