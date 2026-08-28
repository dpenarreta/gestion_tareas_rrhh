"""Cobertura HTTP de Actividades — Fase 5e (ver docs/AUDIT_LOG.md §
2026-08-14). Extiende 5a-5d — solo Papelera queda fuera de alcance, y
SIN cutover de `route.ts`."""

from datetime import timedelta

import pytest
from django.contrib.auth.models import Group
from django.utils import timezone
from rest_framework.test import APIClient

from apps.projects.models import (
    Project,
    ProjectActivity,
    ProjectHistory,
    ProjectHistoryEvent,
    ProjectParticipant,
)
from apps.tasks.business_time import business_calendar_day, retroactive_valid_dates
from apps.users.models import User

pytestmark = pytest.mark.django_db


def _client_for(user: User) -> APIClient:
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.fixture
def manager_level2():
    user = User.objects.create_user(username="analista", email="analista@example.com", password="Sup3r-Secr3t!")
    user.groups.set([Group.objects.get(name="ANALISTA_CC")])
    return user


@pytest.fixture
def assistant_level1():
    user = User.objects.create_user(username="asistente", email="asistente@example.com", password="Sup3r-Secr3t!")
    user.groups.set([Group.objects.get(name="ASISTENTE_GH")])
    return user


@pytest.fixture
def stranger():
    user = User.objects.create_user(username="stranger", email="stranger@example.com", password="Sup3r-Secr3t!")
    user.groups.set([Group.objects.get(name="ASISTENTE_SELECCION")])
    return user


def _create_project(*, creator: User, responsible: User, **overrides) -> Project:
    payload = {
        "name": "Rediseño de onboarding",
        "priority": "ALTA",
        "responsible": responsible.id,
        "start_date": "2026-08-01T00:00:00Z",
        "target_date": "2026-09-01T00:00:00Z",
        "target_time_hours": 40,
    }
    payload.update(overrides)
    response = _client_for(creator).post("/api/v1/projects/", payload, format="json")
    assert response.status_code == 201, response.data
    return Project.objects.get(id=response.data["id"])


def _register_activity(*, actor: User, project: Project, **overrides) -> dict:
    payload = {"description": "Reunión de seguimiento con el equipo", "start_time": "09:00", "end_time": "10:30"}
    payload.update(overrides)
    response = _client_for(actor).post(f"/api/v1/projects/{project.id}/activities/", payload, format="json")
    assert response.status_code == 201, response.data
    return response.data


# --- Registro normal ------------------------------------------------------------------


def test_participant_registers_activity(manager_level2, assistant_level1):
    project = _create_project(creator=manager_level2, responsible=manager_level2, participant_ids=[assistant_level1.id])
    activity = _register_activity(actor=assistant_level1, project=project)
    assert activity["duration"] == 90
    assert activity["is_retroactive"] is False
    assert activity["author"]["id"] == assistant_level1.id


def test_registering_activity_recalcs_project_real_hours(manager_level2):
    project = _create_project(creator=manager_level2, responsible=manager_level2)
    _register_activity(actor=manager_level2, project=project, start_time="09:00", end_time="10:30")
    project.refresh_from_db()
    assert project.real_hours == 1.5


def test_non_participant_cannot_register_activity(manager_level2, assistant_level1, stranger):
    project = _create_project(creator=manager_level2, responsible=assistant_level1)
    response = _client_for(stranger).post(
        f"/api/v1/projects/{project.id}/activities/",
        {"description": "Trabajo en el proyecto ajeno", "start_time": "09:00", "end_time": "10:00"},
        format="json",
    )
    assert response.status_code == 403


def test_activity_does_not_log_history(manager_level2):
    project = _create_project(creator=manager_level2, responsible=manager_level2)
    _register_activity(actor=manager_level2, project=project)
    assert not ProjectHistory.objects.filter(project=project, event=ProjectHistoryEvent.ACTIVIDAD_REGISTRADA).exists()


def test_registering_activity_auto_adds_participant_with_history(manager_level2, assistant_level1):
    project = _create_project(creator=manager_level2, responsible=manager_level2, participant_ids=[assistant_level1.id])
    other_manager = manager_level2  # ya es manager por ser creador, no participante formal todavía
    assert not ProjectParticipant.objects.filter(project=project, user=other_manager).exists()
    _register_activity(actor=other_manager, project=project)
    assert ProjectParticipant.objects.filter(project=project, user=other_manager).exists()
    entry = ProjectHistory.objects.get(project=project, event=ProjectHistoryEvent.PARTICIPANTE_AGREGADO, new_value__auto=True)
    assert entry.new_value["user_id"] == other_manager.id


def test_registering_activity_does_not_duplicate_existing_participant(manager_level2, assistant_level1):
    project = _create_project(creator=manager_level2, responsible=manager_level2, participant_ids=[assistant_level1.id])
    _register_activity(actor=assistant_level1, project=project)
    assert ProjectParticipant.objects.filter(project=project, user=assistant_level1).count() == 1


# --- Validaciones ------------------------------------------------------------------------


def test_short_description_returns_400(manager_level2):
    project = _create_project(creator=manager_level2, responsible=manager_level2)
    response = _client_for(manager_level2).post(
        f"/api/v1/projects/{project.id}/activities/",
        {"description": "corta", "start_time": "09:00", "end_time": "10:00"},
        format="json",
    )
    assert response.status_code == 400


def test_end_before_start_returns_400(manager_level2):
    project = _create_project(creator=manager_level2, responsible=manager_level2)
    response = _client_for(manager_level2).post(
        f"/api/v1/projects/{project.id}/activities/",
        {"description": "Reunión de seguimiento con el equipo", "start_time": "10:00", "end_time": "09:00"},
        format="json",
    )
    assert response.status_code == 400


def test_invalid_time_format_returns_400(manager_level2):
    project = _create_project(creator=manager_level2, responsible=manager_level2)
    response = _client_for(manager_level2).post(
        f"/api/v1/projects/{project.id}/activities/",
        {"description": "Reunión de seguimiento con el equipo", "start_time": "25:99", "end_time": "10:00"},
        format="json",
    )
    assert response.status_code == 400


def test_phase_from_another_project_returns_400(manager_level2):
    project_a = _create_project(creator=manager_level2, responsible=manager_level2)
    project_b = _create_project(creator=manager_level2, responsible=manager_level2, name="Otro proyecto")
    phase_response = _client_for(manager_level2).post(f"/api/v1/projects/{project_b.id}/phases/", {"name": "Fase B"}, format="json")
    response = _register_activity_expect_400(actor=manager_level2, project=project_a, phase=phase_response.data["id"])
    assert response.status_code == 400


def _register_activity_expect_400(*, actor, project, **overrides):
    payload = {"description": "Reunión de seguimiento con el equipo", "start_time": "09:00", "end_time": "10:00"}
    payload.update(overrides)
    return _client_for(actor).post(f"/api/v1/projects/{project.id}/activities/", payload, format="json")


def test_activity_linked_to_phase_in_same_project(manager_level2):
    project = _create_project(creator=manager_level2, responsible=manager_level2)
    phase_response = _client_for(manager_level2).post(f"/api/v1/projects/{project.id}/phases/", {"name": "Descubrimiento"}, format="json")
    activity = _register_activity(actor=manager_level2, project=project, phase=phase_response.data["id"])
    assert activity["phase_id"] == phase_response.data["id"]

    phase_detail = _client_for(manager_level2).get(f"/api/v1/projects/{project.id}/")
    phase_data = next(p for p in phase_detail.data["phases"] if p["id"] == phase_response.data["id"])
    assert phase_data["registered_minutes"] == 90  # 09:00-10:30, mismo default de _register_activity
    assert phase_data["participants"] == [{"id": manager_level2.id, "name": manager_level2.first_name or manager_level2.username}]


# --- Registro retroactivo ------------------------------------------------------------------


def test_retroactive_registration_with_valid_date(manager_level2):
    project = _create_project(creator=manager_level2, responsible=manager_level2)
    now = timezone.now()
    today = business_calendar_day(now)
    valid_dates = retroactive_valid_dates(today, 2)
    assert valid_dates, "se necesita al menos una fecha retroactiva válida para este test"
    target_date = valid_dates[0]

    activity = _register_activity(
        actor=manager_level2, project=project, activity_date=target_date.isoformat()
    )
    assert activity["is_retroactive"] is True
    stored = ProjectActivity.objects.get(id=activity["id"])
    assert stored.created_at.date() == target_date


def test_retroactive_registration_with_invalid_date_returns_400(manager_level2):
    project = _create_project(creator=manager_level2, responsible=manager_level2)
    now = timezone.now()
    today = business_calendar_day(now)
    far_past = today - timedelta(days=60)
    response = _register_activity_expect_400(actor=manager_level2, project=project, activity_date=far_past.isoformat())
    assert response.status_code == 400


def test_activity_date_matching_today_is_not_retroactive(manager_level2):
    project = _create_project(creator=manager_level2, responsible=manager_level2)
    today = business_calendar_day(timezone.now())
    activity = _register_activity(actor=manager_level2, project=project, activity_date=today.isoformat())
    assert activity["is_retroactive"] is False


def test_invalid_activity_date_format_returns_400(manager_level2):
    project = _create_project(creator=manager_level2, responsible=manager_level2)
    response = _register_activity_expect_400(actor=manager_level2, project=project, activity_date="not-a-date")
    assert response.status_code == 400


# --- Listado -------------------------------------------------------------------------


def test_list_activities_visible_to_viewer(manager_level2, assistant_level1):
    project = _create_project(creator=manager_level2, responsible=assistant_level1, participant_ids=[assistant_level1.id])
    _register_activity(actor=assistant_level1, project=project)
    response = _client_for(assistant_level1).get(f"/api/v1/projects/{project.id}/activities/")
    assert response.status_code == 200
    assert len(response.data) == 1


def test_list_activities_forbidden_for_non_viewer(manager_level2, assistant_level1, stranger):
    project = _create_project(creator=manager_level2, responsible=assistant_level1)
    response = _client_for(stranger).get(f"/api/v1/projects/{project.id}/activities/")
    assert response.status_code == 403
