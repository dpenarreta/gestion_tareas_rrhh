"""Cobertura HTTP de `apps.team` — Fase 18 (ver docs/AUDIT_LOG.md §
2026-08-20), réplica de `src/app/api/team/route.ts` y
`src/app/api/team/[userId]/tasks/route.ts`."""

import pytest
from django.contrib.auth.models import Group
from rest_framework.test import APIClient

from apps.core.mask_email import mask_email
from apps.tasks.models import Comment, Task
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
def jefe_nacional():
    user = User.objects.create_user(username="jefe", email="jefe@example.com", password="Sup3r-Secr3t!")
    user.groups.set([Group.objects.get(name="JEFE_NACIONAL")])
    return user


@pytest.fixture
def analista():
    user = User.objects.create_user(username="analista", email="analista@example.com", password="Sup3r-Secr3t!", first_name="Ana")
    user.groups.set([Group.objects.get(name="ANALISTA_CC")])
    return user


@pytest.fixture
def asistente_seleccion():
    user = User.objects.create_user(username="asist_sel", email="asist_sel@example.com", password="Sup3r-Secr3t!")
    user.groups.set([Group.objects.get(name="ASISTENTE_SELECCION")])
    return user


def _create_task(*, assigned_to: User, created_by: User, **overrides) -> Task:
    payload = dict(
        title="Tarea", priority=Task.Priority.MEDIA, frequency=Task.Frequency.PUNTUAL, type=Task.Type.FIJA,
        start_date="2026-08-01T00:00:00Z", end_date="2026-08-10T00:00:00Z", estimated_hours=5,
        assigned_to=assigned_to, created_by=created_by, status=Task.Status.PENDIENTE,
    )
    payload.update(overrides)
    return Task.objects.create(**payload)


# --- GET /team/ ------------------------------------------------------------------------


def test_team_list_requires_authentication():
    response = APIClient().get("/api/v1/team/")
    assert response.status_code == 401


def test_team_list_requires_can_view_team(asistente_seleccion):
    response = _client_for(asistente_seleccion).get("/api/v1/team/")
    assert response.status_code == 403


def test_team_list_includes_visible_subordinate_with_masked_email(coordinador_nacional, analista):
    response = _client_for(coordinador_nacional).get("/api/v1/team/")
    assert response.status_code == 200
    entry = next(m for m in response.data if m["id"] == analista.id)
    assert entry["name"] == "Ana"
    assert entry["email"] == mask_email("analista@example.com")
    assert entry["email"] != "analista@example.com"
    assert entry["role"] == "ANALISTA_CC"
    assert entry["tasks"] == {"total": 0, "completed": 0, "in_progress": 0, "pending": 0}


def test_team_list_task_counts_by_status(coordinador_nacional, analista):
    _create_task(assigned_to=analista, created_by=coordinador_nacional, status=Task.Status.COMPLETADA)
    _create_task(assigned_to=analista, created_by=coordinador_nacional, status=Task.Status.EN_PROGRESO)
    _create_task(assigned_to=analista, created_by=coordinador_nacional, status=Task.Status.PENDIENTE)
    _create_task(assigned_to=analista, created_by=coordinador_nacional, status=Task.Status.PENDIENTE)

    response = _client_for(coordinador_nacional).get("/api/v1/team/")
    entry = next(m for m in response.data if m["id"] == analista.id)
    assert entry["tasks"] == {"total": 4, "completed": 1, "in_progress": 1, "pending": 2}


def test_team_list_excludes_non_subordinate(coordinador_nacional, jefe_nacional):
    response = _client_for(coordinador_nacional).get("/api/v1/team/")
    assert jefe_nacional.id not in [m["id"] for m in response.data]


# --- GET /team/<id>/tasks/ --------------------------------------------------------------


def test_team_member_tasks_requires_authentication():
    response = APIClient().get("/api/v1/team/1/tasks/")
    assert response.status_code == 401


def test_team_member_tasks_requires_can_view_team(asistente_seleccion, analista):
    response = _client_for(asistente_seleccion).get(f"/api/v1/team/{analista.id}/tasks/")
    assert response.status_code == 403


def test_team_member_tasks_404_for_missing_user(coordinador_nacional):
    response = _client_for(coordinador_nacional).get("/api/v1/team/999999/tasks/")
    assert response.status_code == 404


def test_team_member_tasks_403_for_non_subordinate(coordinador_nacional, jefe_nacional):
    response = _client_for(coordinador_nacional).get(f"/api/v1/team/{jefe_nacional.id}/tasks/")
    assert response.status_code == 403


def test_team_member_tasks_excludes_archived_and_includes_full_projection(coordinador_nacional, analista):
    task = _create_task(assigned_to=analista, created_by=coordinador_nacional, title="Activa")
    Comment.objects.create(task=task, author=coordinador_nacional, text="Un comentario")
    _create_task(assigned_to=analista, created_by=coordinador_nacional, title="Archivada", archived_month="2026-07")

    response = _client_for(coordinador_nacional).get(f"/api/v1/team/{analista.id}/tasks/")
    assert response.status_code == 200
    assert len(response.data) == 1
    entry = response.data[0]
    assert entry["title"] == "Activa"
    assert entry["comment_count"] == 1
    # Réplica fiel del `taskSelect` original: el email del asignado va SIN
    # enmascarar en esta ruta (a diferencia de `GET /team/`).
    assert entry["assigned_to"]["email"] == "analista@example.com"
    assert entry["assigned_to"]["role"] == "ANALISTA_CC"
    assert entry["created_by"]["id"] == coordinador_nacional.id
