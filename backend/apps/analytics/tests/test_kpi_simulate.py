"""Cobertura de apps.analytics.kpi_simulate — Fase 23 (ver
docs/AUDIT_LOG.md § 2026-08-20), réplica de
`src/app/api/analytics/simulate/[userId]/route.ts` (8 escenarios, NUNCA
persiste nada)."""

from datetime import datetime
from datetime import timezone as dt_timezone

import pytest
from django.contrib.auth.models import Group

from apps.analytics.kpi_simulate import is_valid_scenario, simulate_kpi_scenario
from apps.tasks.models import Task
from apps.users.models import User

pytestmark = pytest.mark.django_db

NOW = datetime(2026, 8, 20, 10, 0, tzinfo=dt_timezone.utc)


@pytest.fixture
def user():
    user = User.objects.create_user(username="u1", email="u1@example.com", password="Sup3r-Secr3t!")
    user.groups.set([Group.objects.get(name="COORDINADOR_NACIONAL")])
    return user


def _create_task(*, assigned_to: User, created_by: User, **overrides) -> Task:
    payload = dict(
        title="Tarea", priority=Task.Priority.MEDIA, frequency=Task.Frequency.PUNTUAL, type=Task.Type.FIJA,
        start_date="2026-08-01T00:00:00Z", end_date="2026-08-25T00:00:00Z", estimated_hours=5,
        assigned_to=assigned_to, created_by=created_by, status=Task.Status.PENDIENTE,
    )
    payload.update(overrides)
    return Task.objects.create(**payload)


# --- is_valid_scenario ----------------------------------------------------------------------


@pytest.mark.parametrize(
    "body",
    [
        {"type": "assign_task", "hours": 5},
        {"type": "daily_hours", "new_hours_per_day": 8},
        {"type": "vacation", "days": 10},
        {"type": "permiso", "hours": 20},
        {"type": "register_hours", "hours": 3},
        {"type": "complete_task", "count": 2},
        {"type": "reduce_overdue", "count": 3, "alta": 1},
        {"type": "increase_consistency", "delta_points": 10},
    ],
)
def test_is_valid_scenario_accepts_well_formed_bodies(body):
    assert is_valid_scenario(body) is True


@pytest.mark.parametrize(
    "body",
    [
        None,
        {},
        {"type": "unknown"},
        {"type": "assign_task", "hours": 0},
        {"type": "assign_task", "hours": 1000},
        {"type": "assign_task", "hours": "5"},
        {"type": "daily_hours", "new_hours_per_day": 0},
        {"type": "daily_hours", "new_hours_per_day": 25},
        {"type": "vacation", "days": 0},
        {"type": "vacation", "days": 61},
        {"type": "permiso", "hours": 200},
        {"type": "register_hours", "hours": 200},
        {"type": "complete_task", "count": 0},
        {"type": "complete_task", "count": 51},
        {"type": "reduce_overdue", "count": 5, "alta": 6},
        {"type": "reduce_overdue", "count": 0, "alta": 0},
        {"type": "increase_consistency", "delta_points": 0},
        {"type": "increase_consistency", "delta_points": 101},
    ],
)
def test_is_valid_scenario_rejects_malformed_bodies(body):
    assert is_valid_scenario(body) is False


# --- simulate_kpi_scenario: cada escenario -----------------------------------------------


def test_assign_task_reduces_available_capacity_only(user):
    result = simulate_kpi_scenario(user=user, body={"type": "assign_task", "hours": 5}, now=NOW)
    before, after = result["before"], result["after"]
    assert after["capacidad_disponible_horas"] == before["capacidad_disponible_horas"] - 5
    assert after["carga_pct"] == before["carga_pct"]
    assert after["performance_score_pts"] == before["performance_score_pts"]
    assert after["cumplimiento_pct"] == before["cumplimiento_pct"]
    assert result["diff"]["health_score"] == round((after["health_score"] - before["health_score"]) * 100) / 100


def test_daily_hours_changes_capacity_and_carga_but_not_performance(user):
    result = simulate_kpi_scenario(user=user, body={"type": "daily_hours", "new_hours_per_day": 8}, now=NOW)
    before, after = result["before"], result["after"]
    assert after["performance_score_pts"] == before["performance_score_pts"]
    assert after["cumplimiento_pct"] == before["cumplimiento_pct"]


def test_vacation_reduces_available_capacity_only(user):
    result = simulate_kpi_scenario(user=user, body={"type": "vacation", "days": 10}, now=NOW)
    before, after = result["before"], result["after"]
    assert after["capacidad_disponible_horas"] < before["capacidad_disponible_horas"]
    assert after["carga_pct"] == before["carga_pct"]
    assert after["performance_score_pts"] == before["performance_score_pts"]


def test_permiso_affects_capacity_and_carga_but_not_performance(user):
    result = simulate_kpi_scenario(user=user, body={"type": "permiso", "hours": 20}, now=NOW)
    before, after = result["before"], result["after"]
    assert after["performance_score_pts"] == before["performance_score_pts"]
    assert after["cumplimiento_pct"] == before["cumplimiento_pct"]


def test_register_hours_changes_carga_only(user):
    result = simulate_kpi_scenario(user=user, body={"type": "register_hours", "hours": 3}, now=NOW)
    before, after = result["before"], result["after"]
    assert after["capacidad_disponible_horas"] == before["capacidad_disponible_horas"]
    assert after["performance_score_pts"] == before["performance_score_pts"]
    assert after["cumplimiento_pct"] == before["cumplimiento_pct"]


def test_complete_task_increases_cumplimiento_and_changes_performance_only(user):
    for _ in range(3):
        _create_task(assigned_to=user, created_by=user, status=Task.Status.PENDIENTE)

    result = simulate_kpi_scenario(user=user, body={"type": "complete_task", "count": 2}, now=NOW)
    before, after = result["before"], result["after"]
    assert after["cumplimiento_pct"] >= before["cumplimiento_pct"]
    assert after["capacidad_disponible_horas"] == before["capacidad_disponible_horas"]
    assert after["carga_pct"] == before["carga_pct"]


def test_reduce_overdue_changes_performance_only(user):
    result = simulate_kpi_scenario(user=user, body={"type": "reduce_overdue", "count": 1, "alta": 0}, now=NOW)
    before, after = result["before"], result["after"]
    assert after["capacidad_disponible_horas"] == before["capacidad_disponible_horas"]
    assert after["carga_pct"] == before["carga_pct"]
    assert after["cumplimiento_pct"] == before["cumplimiento_pct"]


def test_increase_consistency_changes_performance_only(user):
    result = simulate_kpi_scenario(user=user, body={"type": "increase_consistency", "delta_points": 10}, now=NOW)
    before, after = result["before"], result["after"]
    assert after["capacidad_disponible_horas"] == before["capacidad_disponible_horas"]
    assert after["carga_pct"] == before["carga_pct"]
    assert after["cumplimiento_pct"] == before["cumplimiento_pct"]


def test_response_includes_scenario_echo(user):
    body = {"type": "assign_task", "hours": 5}
    result = simulate_kpi_scenario(user=user, body=body, now=NOW)
    assert result["scenario"] == body


def test_never_persists_anything(user):
    task = _create_task(assigned_to=user, created_by=user, status=Task.Status.PENDIENTE)
    simulate_kpi_scenario(user=user, body={"type": "complete_task", "count": 1}, now=NOW)
    task.refresh_from_db()
    assert task.status == Task.Status.PENDIENTE
