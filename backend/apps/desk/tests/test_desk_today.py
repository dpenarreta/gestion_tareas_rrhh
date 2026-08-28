"""Cobertura HTTP de `GET /api/v1/desk/today/` — Fase 7f (ver
docs/AUDIT_LOG.md § 2026-08-17): réplica de `src/app/api/desk/today/route.ts`
("Bandeja Hoy"), solo lectura contra Trabajo/Proyectos."""

from datetime import timedelta

import pytest
from django.contrib.auth.models import Group
from django.utils import timezone
from rest_framework.test import APIClient

from apps.desk.models import PersonalReminder
from apps.notifications.models import Notification
from apps.projects.models import Project, ProjectComment
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
def other():
    user = User.objects.create_user(username="bruno", email="bruno@example.com", password="Sup3r-Secr3t!")
    user.groups.set([Group.objects.get(name="ASISTENTE_GH")])
    return user


@pytest.fixture
def admin():
    user = User.objects.create_user(username="admin", email="admin@example.com", password="Sup3r-Secr3t!")
    user.groups.set([Group.objects.get(name="ADMINISTRADOR")])
    return user


def _project(*, responsible: User, **overrides) -> Project:
    payload = {
        "name": "Rediseño de onboarding",
        "priority": "ALTA",
        "responsible": responsible,
        "created_by": responsible,
        "start_date": timezone.now(),
        "target_date": timezone.now() + timedelta(days=30),
        "target_time_hours": 40,
    }
    payload.update(overrides)
    return Project.objects.create(**payload)


def test_requires_authentication():
    response = APIClient().get("/api/v1/desk/today/")
    assert response.status_code == 401


def test_admin_gets_403(admin):
    response = _client_for(admin).get("/api/v1/desk/today/")
    assert response.status_code == 403


def test_empty_state_returns_empty_blocks(owner):
    response = _client_for(owner).get("/api/v1/desk/today/")
    assert response.status_code == 200
    assert response.data == {
        "pending_notes": [],
        "today_reminders": [],
        "upcoming_tasks": [],
        "recent_projects": [],
    }


# --- Notas pendientes --------------------------------------------------------------------


def test_includes_unread_unarchived_notes_addressed_to_user(owner, other):
    _client_for(other).post("/api/v1/desk-notes/", {"recipient": owner.id, "message": "Revisá esto"}, format="json")
    response = _client_for(owner).get("/api/v1/desk/today/")
    assert len(response.data["pending_notes"]) == 1
    assert response.data["pending_notes"][0]["message"] == "Revisá esto"
    assert response.data["pending_notes"][0]["sender_name"]


def test_excludes_read_notes(owner, other):
    created = _client_for(other).post(
        "/api/v1/desk-notes/", {"recipient": owner.id, "message": "Ya la leo"}, format="json"
    )
    note_id = created.data["id"]
    _client_for(owner).patch(f"/api/v1/desk-notes/{note_id}/", {"action": "read"}, format="json")

    response = _client_for(owner).get("/api/v1/desk/today/")
    assert response.data["pending_notes"] == []


def test_excludes_notes_sent_by_user(owner, other):
    _client_for(owner).post("/api/v1/desk-notes/", {"recipient": other.id, "message": "Yo la mandé"}, format="json")
    response = _client_for(owner).get("/api/v1/desk/today/")
    assert response.data["pending_notes"] == []


# --- Recordatorios de hoy -----------------------------------------------------------------


def test_includes_pending_reminders_due_today_or_overdue(owner):
    overdue = PersonalReminder.objects.create(
        user=owner, title="Vencido", due_at=timezone.now() - timedelta(hours=2), status="PENDIENTE"
    )
    response = _client_for(owner).get("/api/v1/desk/today/")
    assert len(response.data["today_reminders"]) == 1
    assert response.data["today_reminders"][0]["id"] == overdue.id
    assert response.data["today_reminders"][0]["overdue"] is True


def test_excludes_reminders_due_later_than_today(owner):
    PersonalReminder.objects.create(
        user=owner, title="Futuro", due_at=timezone.now() + timedelta(days=5), status="PENDIENTE"
    )
    response = _client_for(owner).get("/api/v1/desk/today/")
    assert response.data["today_reminders"] == []


def test_excludes_completed_reminders(owner):
    PersonalReminder.objects.create(
        user=owner, title="Completo", due_at=timezone.now() - timedelta(hours=1), status="COMPLETADO"
    )
    response = _client_for(owner).get("/api/v1/desk/today/")
    assert response.data["today_reminders"] == []


def test_notifies_due_reminders_as_side_effect(owner):
    PersonalReminder.objects.create(
        user=owner, title="Vencido", due_at=timezone.now() - timedelta(hours=1), status="PENDIENTE", notified=False
    )
    _client_for(owner).get("/api/v1/desk/today/")
    assert Notification.objects.filter(user=owner).exists()


# --- Tareas próximas -----------------------------------------------------------------------


def test_includes_upcoming_non_completed_tasks_assigned_to_user(owner):
    task = Task.objects.create(
        title="Entregar reporte", priority="MEDIA", frequency="PUNTUAL",
        start_date=timezone.now(), end_date=timezone.now() + timedelta(days=3),
        estimated_hours=2, assigned_to=owner, created_by=owner,
    )
    response = _client_for(owner).get("/api/v1/desk/today/")
    assert len(response.data["upcoming_tasks"]) == 1
    assert response.data["upcoming_tasks"][0]["id"] == task.id


def test_excludes_tasks_due_beyond_the_window(owner):
    Task.objects.create(
        title="Lejana", priority="MEDIA", frequency="PUNTUAL",
        start_date=timezone.now(), end_date=timezone.now() + timedelta(days=30),
        estimated_hours=2, assigned_to=owner, created_by=owner,
    )
    response = _client_for(owner).get("/api/v1/desk/today/")
    assert response.data["upcoming_tasks"] == []


def test_excludes_completed_tasks(owner):
    Task.objects.create(
        title="Ya lista", priority="MEDIA", frequency="PUNTUAL", status="COMPLETADA",
        start_date=timezone.now(), end_date=timezone.now() + timedelta(days=1),
        estimated_hours=2, assigned_to=owner, created_by=owner,
    )
    response = _client_for(owner).get("/api/v1/desk/today/")
    assert response.data["upcoming_tasks"] == []


def test_excludes_archived_tasks(owner):
    Task.objects.create(
        title="Archivada", priority="MEDIA", frequency="PUNTUAL", archived_month="2026-07",
        start_date=timezone.now(), end_date=timezone.now() + timedelta(days=1),
        estimated_hours=2, assigned_to=owner, created_by=owner,
    )
    response = _client_for(owner).get("/api/v1/desk/today/")
    assert response.data["upcoming_tasks"] == []


def test_excludes_tasks_assigned_to_someone_else(owner, other):
    Task.objects.create(
        title="De otro", priority="MEDIA", frequency="PUNTUAL",
        start_date=timezone.now(), end_date=timezone.now() + timedelta(days=1),
        estimated_hours=2, assigned_to=other, created_by=other,
    )
    response = _client_for(owner).get("/api/v1/desk/today/")
    assert response.data["upcoming_tasks"] == []


# --- Proyectos con actividad reciente ------------------------------------------------------


def test_includes_project_with_recent_activity_where_user_is_responsible(owner):
    project = _project(responsible=owner)
    ProjectComment.objects.create(project=project, author=owner, text="Avance")
    response = _client_for(owner).get("/api/v1/desk/today/")
    assert len(response.data["recent_projects"]) == 1
    assert response.data["recent_projects"][0]["id"] == project.id


def test_excludes_project_without_recent_activity(owner):
    project = _project(responsible=owner)
    old_comment = ProjectComment.objects.create(project=project, author=owner, text="Viejo")
    ProjectComment.objects.filter(id=old_comment.id).update(created_at=timezone.now() - timedelta(days=30))

    response = _client_for(owner).get("/api/v1/desk/today/")
    assert response.data["recent_projects"] == []


def test_excludes_project_where_user_is_not_involved(owner, other):
    project = _project(responsible=other)
    ProjectComment.objects.create(project=project, author=other, text="Avance")
    response = _client_for(owner).get("/api/v1/desk/today/")
    assert response.data["recent_projects"] == []


def test_excludes_deleted_project(owner):
    project = _project(responsible=owner)
    ProjectComment.objects.create(project=project, author=owner, text="Avance")
    Project.objects.filter(id=project.id).update(deleted_at=timezone.now())

    response = _client_for(owner).get("/api/v1/desk/today/")
    assert response.data["recent_projects"] == []


def test_project_with_recent_activity_does_not_duplicate_in_results(owner):
    project = _project(responsible=owner)
    ProjectComment.objects.create(project=project, author=owner, text="Uno")
    ProjectComment.objects.create(project=project, author=owner, text="Dos")

    response = _client_for(owner).get("/api/v1/desk/today/")
    assert len(response.data["recent_projects"]) == 1
