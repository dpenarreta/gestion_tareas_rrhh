"""Cobertura de registro de horas (Fase 3b de la migración de stack — ver
docs/AUDIT_LOG.md § 2026-08-07): validación de motivo, límite de tareas
Fija, detección de solapamiento horario, recálculo de `real_hours`."""

import pytest
from django.contrib.auth.models import Group
from django.utils import timezone
from rest_framework.test import APIClient

from apps.tasks.models import ActivityReason, Task, TaskActivity
from apps.users.models import User

pytestmark = pytest.mark.django_db


@pytest.fixture
def collaborator():
    # Sin grupo, `ActivityService.create_activity` siempre rechazaría el
    # motivo (intersección con `assigned_roles` vacía) — se usa un grupo ya
    # sembrado por la Fase 1 (`apps.hierarchy`), no uno creado ad-hoc.
    user = User.objects.create_user(username="collab", email="collab@example.com", password="Sup3r-Secr3t!")
    user.groups.set([Group.objects.get(name="ANALISTA_CC")])
    return user


@pytest.fixture
def collaborator_client(collaborator):
    client = APIClient()
    client.force_authenticate(user=collaborator)
    return client


@pytest.fixture
def stranger():
    return User.objects.create_user(username="stranger", email="stranger@example.com", password="Sup3r-Secr3t!")


@pytest.fixture
def stranger_client(stranger):
    client = APIClient()
    client.force_authenticate(user=stranger)
    return client


def _make_reason_for(user: User, key: str = "trabajo_general") -> ActivityReason:
    role_names = list(user.groups.values_list("name", flat=True))
    return ActivityReason.objects.create(key=key, label="Trabajo general", assigned_roles=role_names)


def _task(assigned_to: User, created_by: User, task_type: str = "SEGUIMIENTO") -> Task:
    return Task.objects.create(
        title="Tarea", priority="MEDIA", frequency="PUNTUAL", type=task_type,
        start_date=timezone.now(), end_date=timezone.now(), estimated_hours=1,
        assigned_to=assigned_to, created_by=created_by,
    )


# --- Creación válida y recálculo de real_hours --------------------------


def test_creates_activity_and_recalculates_real_hours(collaborator_client, collaborator):
    _make_reason_for(collaborator)
    task = _task(collaborator, collaborator)

    response = collaborator_client.post(
        f"/api/v1/tasks/{task.id}/activities/",
        {"reason": "trabajo_general", "hours": 1, "minutes": 30},
        format="json",
    )

    assert response.status_code == 201
    task.refresh_from_db()
    assert task.real_hours == 1.5


def test_list_activities_returns_created_ones(collaborator_client, collaborator):
    _make_reason_for(collaborator)
    task = _task(collaborator, collaborator)
    collaborator_client.post(
        f"/api/v1/tasks/{task.id}/activities/", {"reason": "trabajo_general", "hours": 1, "minutes": 0}, format="json"
    )

    response = collaborator_client.get(f"/api/v1/tasks/{task.id}/activities/")

    assert response.status_code == 200
    assert len(response.data) == 1
    assert response.data[0]["duration"] == 60


# --- Validación de motivo --------------------------------------------------


def test_rejects_nonexistent_reason(collaborator_client, collaborator):
    task = _task(collaborator, collaborator)

    response = collaborator_client.post(
        f"/api/v1/tasks/{task.id}/activities/",
        {"reason": "no_existe", "hours": 1, "minutes": 0},
        format="json",
    )

    assert response.status_code == 400


def test_rejects_inactive_reason(collaborator_client, collaborator):
    reason = _make_reason_for(collaborator)
    reason.is_active = False
    reason.save()
    task = _task(collaborator, collaborator)

    response = collaborator_client.post(
        f"/api/v1/tasks/{task.id}/activities/",
        {"reason": "trabajo_general", "hours": 1, "minutes": 0},
        format="json",
    )

    assert response.status_code == 400


def test_rejects_reason_not_assigned_to_actor_role(collaborator_client, collaborator):
    # Motivo existe pero no está asignado al rol del actor (ningún grupo).
    ActivityReason.objects.create(key="solo_admin", label="Solo admin", assigned_roles=["ADMINISTRADOR"])
    task = _task(collaborator, collaborator)

    response = collaborator_client.post(
        f"/api/v1/tasks/{task.id}/activities/",
        {"reason": "solo_admin", "hours": 1, "minutes": 0},
        format="json",
    )

    assert response.status_code == 400


def test_rejects_zero_duration(collaborator_client, collaborator):
    _make_reason_for(collaborator)
    task = _task(collaborator, collaborator)

    response = collaborator_client.post(
        f"/api/v1/tasks/{task.id}/activities/",
        {"reason": "trabajo_general", "hours": 0, "minutes": 0},
        format="json",
    )

    assert response.status_code == 400


# --- Límite de tareas Fija ---------------------------------------------------


def test_fija_task_rejects_third_activity(collaborator_client, collaborator):
    _make_reason_for(collaborator)
    task = _task(collaborator, collaborator, task_type="FIJA")

    first = collaborator_client.post(
        f"/api/v1/tasks/{task.id}/activities/", {"reason": "trabajo_general", "hours": 1, "minutes": 0}, format="json"
    )
    second = collaborator_client.post(
        f"/api/v1/tasks/{task.id}/activities/", {"reason": "trabajo_general", "hours": 1, "minutes": 0}, format="json"
    )
    third = collaborator_client.post(
        f"/api/v1/tasks/{task.id}/activities/", {"reason": "trabajo_general", "hours": 1, "minutes": 0}, format="json"
    )

    assert first.status_code == 201
    assert second.status_code == 201
    assert third.status_code == 400
    assert TaskActivity.objects.filter(task=task).count() == 2


# --- Solapamiento horario -----------------------------------------------------


def test_overlapping_schedule_on_seguimiento_task_is_rejected(collaborator_client, collaborator):
    _make_reason_for(collaborator)
    task_a = _task(collaborator, collaborator, task_type="SEGUIMIENTO")
    task_b = _task(collaborator, collaborator, task_type="SEGUIMIENTO")

    first = collaborator_client.post(
        f"/api/v1/tasks/{task_a.id}/activities/",
        {"reason": "trabajo_general", "hours": 1, "minutes": 0, "start_time": "09:00", "end_time": "10:00"},
        format="json",
    )
    second = collaborator_client.post(
        f"/api/v1/tasks/{task_b.id}/activities/",
        {"reason": "trabajo_general", "hours": 1, "minutes": 0, "start_time": "09:30", "end_time": "10:30"},
        format="json",
    )

    assert first.status_code == 201
    assert second.status_code == 400


def test_overlapping_schedule_ignored_when_other_task_is_fija(collaborator_client, collaborator):
    _make_reason_for(collaborator)
    fija_task = _task(collaborator, collaborator, task_type="FIJA")
    seguimiento_task = _task(collaborator, collaborator, task_type="SEGUIMIENTO")

    first = collaborator_client.post(
        f"/api/v1/tasks/{fija_task.id}/activities/",
        {"reason": "trabajo_general", "hours": 1, "minutes": 0, "start_time": "09:00", "end_time": "10:00"},
        format="json",
    )
    second = collaborator_client.post(
        f"/api/v1/tasks/{seguimiento_task.id}/activities/",
        {"reason": "trabajo_general", "hours": 1, "minutes": 0, "start_time": "09:30", "end_time": "10:30"},
        format="json",
    )

    assert first.status_code == 201
    assert second.status_code == 201


def test_end_time_before_start_time_is_rejected(collaborator_client, collaborator):
    _make_reason_for(collaborator)
    task = _task(collaborator, collaborator, task_type="SEGUIMIENTO")

    response = collaborator_client.post(
        f"/api/v1/tasks/{task.id}/activities/",
        {"reason": "trabajo_general", "hours": 1, "minutes": 0, "start_time": "10:00", "end_time": "09:00"},
        format="json",
    )

    assert response.status_code == 400


# --- Control de acceso ---------------------------------------------------


def test_stranger_cannot_list_or_create_activities(stranger_client, collaborator):
    task = _task(collaborator, collaborator)

    list_response = stranger_client.get(f"/api/v1/tasks/{task.id}/activities/")
    create_response = stranger_client.post(
        f"/api/v1/tasks/{task.id}/activities/",
        {"reason": "trabajo_general", "hours": 1, "minutes": 0},
        format="json",
    )

    assert list_response.status_code == 403
    assert create_response.status_code == 403


# --- Catálogo de motivos ---------------------------------------------------


def test_activity_reasons_endpoint_lists_active_and_inactive(collaborator_client, collaborator):
    _make_reason_for(collaborator, key="activo")
    inactive = _make_reason_for(collaborator, key="inactivo")
    inactive.is_active = False
    inactive.save()

    response = collaborator_client.get("/api/v1/activity-reasons/")

    assert response.status_code == 200
    keys = {row["key"] for row in response.data}
    assert keys == {"activo", "inactivo"}
