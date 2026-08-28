"""Cobertura HTTP de `apps.dashboard` — Fase 25 (ver docs/AUDIT_LOG.md §
2026-08-20), réplica de `src/app/api/dashboard/route.ts` y
`src/app/api/dashboard/card-order/route.ts`. `nova-message` queda
explícitamente fuera de alcance de esta fase (Nova/Groq, LLM-RAG nunca
portado)."""

from datetime import timedelta

import pytest
from django.contrib.auth.models import Group
from django.utils import timezone
from rest_framework.test import APIClient

from apps.announcements.models import Announcement
from apps.configuration.services import (
    CONFIG_KEY_WELCOME_MESSAGE,
    CONFIG_KEY_WELCOME_MESSAGE_ACTIVE,
    set_config_value,
)
from apps.meetings.models import Meeting, MeetingInvitee
from apps.tasks.models import Task, TaskActivity
from apps.users.models import User

pytestmark = pytest.mark.django_db


def _client_for(user: User) -> APIClient:
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.fixture
def coordinador_nacional():
    user = User.objects.create_user(username="coord_nac", email="coord_nac@example.com", password="Sup3r-Secr3t!")
    user.groups.set([Group.objects.get(name="COORDINADOR_NACIONAL")])
    return user


@pytest.fixture
def analista():
    user = User.objects.create_user(username="analista", email="analista@example.com", password="Sup3r-Secr3t!")
    user.groups.set([Group.objects.get(name="ANALISTA_CC")])
    return user


def _create_task(*, assigned_to: User, created_by: User, **overrides) -> Task:
    now = timezone.now()
    payload = dict(
        title="Tarea", priority=Task.Priority.MEDIA, frequency=Task.Frequency.PUNTUAL, type=Task.Type.FIJA,
        start_date=now, end_date=now + timedelta(days=3), estimated_hours=5,
        assigned_to=assigned_to, created_by=created_by, status=Task.Status.PENDIENTE,
    )
    payload.update(overrides)
    return Task.objects.create(**payload)


# --- GET /dashboard/ ---------------------------------------------------------------------


def test_requires_authentication():
    response = APIClient().get("/api/v1/dashboard/")
    assert response.status_code == 401


def test_returns_expected_top_level_shape(analista):
    response = _client_for(analista).get("/api/v1/dashboard/")
    assert response.status_code == 200
    for key in (
        "workloadPct", "completedPct", "overdue", "priorityTasks", "stats", "areaActivity", "teamAlerts",
        "welcomeMessage", "welcomeMessageActive", "announcements", "lastLoginAt", "badges", "upcomingMeetings",
        "myProjects",
    ):
        assert key in response.data


def test_priority_tasks_rank_overdue_above_due_this_week(analista):
    now = timezone.now()
    overdue_task = _create_task(assigned_to=analista, created_by=analista, title="Vencida", end_date=now - timedelta(days=1))
    _create_task(assigned_to=analista, created_by=analista, title="Esta semana", end_date=now + timedelta(days=2))
    _create_task(assigned_to=analista, created_by=analista, title="Completada", status=Task.Status.COMPLETADA, end_date=now - timedelta(days=1))

    response = _client_for(analista).get("/api/v1/dashboard/")
    titles = [t["title"] for t in response.data["priorityTasks"]]
    assert titles[0] == "Vencida"
    assert "Completada" not in titles
    assert response.data["priorityTasks"][0]["id"] == overdue_task.id
    assert response.data["priorityTasks"][0]["urgency"] == 4


def test_stats_month_counts_tasks_by_status(analista):
    now = timezone.now()
    _create_task(assigned_to=analista, created_by=analista, status=Task.Status.PENDIENTE, end_date=now)
    _create_task(assigned_to=analista, created_by=analista, status=Task.Status.PENDIENTE, end_date=now)
    _create_task(assigned_to=analista, created_by=analista, status=Task.Status.COMPLETADA, end_date=now)

    response = _client_for(analista).get("/api/v1/dashboard/")
    assert response.data["stats"]["month"] == {"pending": 2, "inProgress": 0, "completed": 1}


def test_badges_and_last_login_pass_through(analista):
    analista.badges = ["cumplidor", "mentor"]
    analista.last_login = timezone.now()
    analista.save(update_fields=["badges", "last_login"])

    response = _client_for(analista).get("/api/v1/dashboard/")
    assert response.data["badges"] == ["cumplidor", "mentor"]
    assert response.data["lastLoginAt"] is not None


def test_badges_defaults_to_empty_list_and_last_login_to_none(analista):
    response = _client_for(analista).get("/api/v1/dashboard/")
    assert response.data["badges"] == []
    assert response.data["lastLoginAt"] is None


def test_includes_only_unexpired_announcements(analista, coordinador_nacional):
    active = Announcement.objects.create(
        title="Vigente", content="C", author=coordinador_nacional, expires_at=timezone.now() + timedelta(days=1)
    )
    Announcement.objects.create(
        title="Vencido", content="C", author=coordinador_nacional, expires_at=timezone.now() - timedelta(days=1)
    )

    response = _client_for(analista).get("/api/v1/dashboard/")
    ids = [a["id"] for a in response.data["announcements"]]
    assert ids == [active.id]


def test_upcoming_meetings_include_hosted_and_invited(analista, coordinador_nacional):
    hosted = Meeting.objects.create(
        title="Reunión propia", host=analista, meeting_date=timezone.now() + timedelta(days=1), duration=30
    )
    invited = Meeting.objects.create(
        title="Invitado", host=coordinador_nacional, meeting_date=timezone.now() + timedelta(days=2), duration=45
    )
    MeetingInvitee.objects.create(meeting=invited, user=analista)
    Meeting.objects.create(
        title="Sin relación", host=coordinador_nacional, meeting_date=timezone.now() + timedelta(days=1), duration=30
    )

    response = _client_for(analista).get("/api/v1/dashboard/")
    ids = {m["id"] for m in response.data["upcomingMeetings"]}
    assert ids == {hosted.id, invited.id}


def test_welcome_message_reflects_configuration(analista, coordinador_nacional):
    set_config_value(CONFIG_KEY_WELCOME_MESSAGE, "Bienvenido al equipo", coordinador_nacional)
    set_config_value(CONFIG_KEY_WELCOME_MESSAGE_ACTIVE, "true", coordinador_nacional)

    response = _client_for(analista).get("/api/v1/dashboard/")
    assert response.data["welcomeMessage"] == "Bienvenido al equipo"
    assert response.data["welcomeMessageActive"] is True


def test_welcome_message_defaults_to_empty_and_inactive(analista):
    response = _client_for(analista).get("/api/v1/dashboard/")
    assert response.data["welcomeMessage"] == ""
    assert response.data["welcomeMessageActive"] is False


def test_team_alerts_counts_overloaded_executor_subordinates(coordinador_nacional, analista):
    task = _create_task(assigned_to=analista, created_by=coordinador_nacional)
    TaskActivity.objects.create(
        task=task, author=analista, reason="reunion", duration=100_000, created_at=timezone.now()
    )

    response = _client_for(coordinador_nacional).get("/api/v1/dashboard/")
    assert response.data["teamAlerts"] >= 1


def test_team_alerts_zero_below_role_level_2():
    asistente = User.objects.create_user(username="asist", email="asist@example.com", password="Sup3r-Secr3t!")
    asistente.groups.set([Group.objects.get(name="ASISTENTE_GH")])

    response = _client_for(asistente).get("/api/v1/dashboard/")
    assert response.data["teamAlerts"] == 0


# --- PATCH /dashboard/card-order/ ---------------------------------------------------------


def test_card_order_requires_authentication():
    response = APIClient().patch("/api/v1/dashboard/card-order/", {"order": ["a"]}, format="json")
    assert response.status_code == 401


def test_card_order_requires_non_empty_array(analista):
    response = _client_for(analista).patch("/api/v1/dashboard/card-order/", {"order": []}, format="json")
    assert response.status_code == 400

    response = _client_for(analista).patch("/api/v1/dashboard/card-order/", {"order": "not-a-list"}, format="json")
    assert response.status_code == 400


def test_card_order_replaces_previous_prefixed_entry(analista):
    analista.view_preferences = ["KANBAN", "DASHBOARD_CARDS:old,order"]
    analista.save(update_fields=["view_preferences"])

    response = _client_for(analista).patch(
        "/api/v1/dashboard/card-order/", {"order": ["stats", "tasks", "team"]}, format="json"
    )
    assert response.status_code == 200
    analista.refresh_from_db()
    assert analista.view_preferences == ["KANBAN", "DASHBOARD_CARDS:stats,tasks,team"]
