"""Cobertura HTTP de `GET /api/v1/kpis/team-capacity/` y
`GET /api/v1/kpis/team/` — Fase 19 (ver docs/AUDIT_LOG.md §
2026-08-20), réplica de `src/app/api/kpis/team-capacity/route.ts` y
`src/app/api/kpis/team/route.ts`. Ambas excluyen roles de liderazgo
(`get_subordinate_executor_groups`, `ROLE_LEVEL>=4`) — a diferencia de
`apps.team` (Fase 18), que no aplica ese filtro."""

import pytest
from django.contrib.auth.models import Group
from rest_framework.test import APIClient

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
def admin():
    user = User.objects.create_user(username="admin_role", email="admin_role@example.com", password="Sup3r-Secr3t!")
    user.groups.set([Group.objects.get(name="ADMINISTRADOR")])
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


# --- GET /kpis/team-capacity/ -----------------------------------------------------------


def test_team_capacity_requires_authentication():
    response = APIClient().get("/api/v1/kpis/team-capacity/")
    assert response.status_code == 401


def test_team_capacity_requires_can_view_team(asistente_seleccion):
    response = _client_for(asistente_seleccion).get("/api/v1/kpis/team-capacity/")
    assert response.status_code == 403


def test_team_capacity_200_includes_subordinate_forecast(coordinador_nacional, analista):
    response = _client_for(coordinador_nacional).get("/api/v1/kpis/team-capacity/")
    assert response.status_code == 200
    entry = next(m for m in response.data["members"] if m["id"] == analista.id)
    assert entry["name"] == "Ana"
    assert entry["role"] == "ANALISTA_CC"
    assert "estado" in entry
    assert "estado_color" in entry
    assert response.data["summary"]["total"] == len(response.data["members"])


def test_team_capacity_excludes_leadership_roles(admin, jefe_nacional):
    response = _client_for(admin).get("/api/v1/kpis/team-capacity/")
    assert response.status_code == 200
    assert jefe_nacional.id not in [m["id"] for m in response.data["members"]]


# --- GET /kpis/team/ ---------------------------------------------------------------------


def test_team_kpi_requires_authentication():
    response = APIClient().get("/api/v1/kpis/team/")
    assert response.status_code == 401


def test_team_kpi_requires_can_view_team(asistente_seleccion):
    response = _client_for(asistente_seleccion).get("/api/v1/kpis/team/")
    assert response.status_code == 403


def test_team_kpi_200_includes_subordinate_snapshot(coordinador_nacional, analista):
    response = _client_for(coordinador_nacional).get("/api/v1/kpis/team/")
    assert response.status_code == 200
    entry = next(u for u in response.data["users"] if u["id"] == analista.id)
    assert entry["name"] == "Ana"
    assert entry["role"] == "ANALISTA_CC"
    assert entry["total_tasks"] == 0
    assert entry["completed_pct"] == 0
    for key in ("score", "carga_ratio", "overdue_count", "color", "carga_pct", "carga_color", "carga_label", "carga_real_hours", "carga_base_hours", "capacidad_disponible_pct", "horas_disponibles"):
        assert key in entry


def test_team_kpi_counts_tasks_and_comments_for_requested_month(coordinador_nacional, analista):
    task = _create_task(
        assigned_to=analista, created_by=coordinador_nacional, status=Task.Status.COMPLETADA,
        start_date="2026-08-01T00:00:00Z", end_date="2026-08-05T00:00:00Z",
    )
    Comment.objects.create(task=task, author=analista, text="Hola")
    # Tarea de otro mes — no debe contarse al pedir agosto.
    _create_task(
        assigned_to=analista, created_by=coordinador_nacional, status=Task.Status.PENDIENTE,
        start_date="2026-06-01T00:00:00Z", end_date="2026-06-05T00:00:00Z",
    )

    response = _client_for(coordinador_nacional).get("/api/v1/kpis/team/?month=2026-08")
    entry = next(u for u in response.data["users"] if u["id"] == analista.id)
    assert entry["total_tasks"] == 1
    assert entry["completed_pct"] == 100


def test_team_kpi_excludes_leadership_roles(admin, jefe_nacional):
    response = _client_for(admin).get("/api/v1/kpis/team/")
    assert response.status_code == 200
    assert jefe_nacional.id not in [u["id"] for u in response.data["users"]]
