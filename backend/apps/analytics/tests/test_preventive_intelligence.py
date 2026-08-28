"""Cobertura de apps.analytics.preventive_intelligence — Fase 9b (ver
docs/AUDIT_LOG.md § 2026-08-18), réplica de
src/lib/preventiveIntelligence.ts."""

from datetime import datetime
from datetime import timezone as dt_timezone

import pytest

from apps.analytics.preventive_intelligence import (
    _consecutive_decline_weeks,
    _sort_by_severity,
    compute_preventive_alerts,
    compute_team_preventive_alerts,
)
from apps.projects.models import Project, ProjectParticipant
from apps.tasks.models import Task
from apps.users.models import User

pytestmark = pytest.mark.django_db

NOW = datetime(2026, 8, 12, 10, 0, tzinfo=dt_timezone.utc)


@pytest.fixture
def user():
    return User.objects.create_user(
        username="target", email="target@example.com", password="Sup3r-Secr3t!", first_name="Ana"
    )


def _task(user, *, status, start_date, end_date, estimated_hours=5, real_hours=0.0) -> Task:
    return Task.objects.create(
        title="T", priority="MEDIA", frequency="PUNTUAL", start_date=start_date, end_date=end_date,
        estimated_hours=estimated_hours, real_hours=real_hours, assigned_to=user, created_by=user, status=status,
    )


# --- _consecutive_decline_weeks -------------------------------------------------


def test_consecutive_decline_weeks_no_decline_is_zero():
    assert _consecutive_decline_weeks([{"value": 10}, {"value": 20}, {"value": 30}]) == 0


def test_consecutive_decline_weeks_counts_streak_from_the_end():
    # 50 -> 40 -> 30 -> 35 (sube): la racha son las últimas 2 caídas + el punto de partida.
    points = [{"value": 50}, {"value": 40}, {"value": 30}, {"value": 20}]
    assert _consecutive_decline_weeks(points) == 4  # 3 caídas consecutivas + 1


def test_consecutive_decline_weeks_single_point_is_zero():
    assert _consecutive_decline_weeks([{"value": 10}]) == 0


# --- _sort_by_severity -----------------------------------------------------------


def test_sort_by_severity_orders_descending_and_is_stable():
    alerts = [
        {"severity": "amarilla", "id": 1},
        {"severity": "roja", "id": 2},
        {"severity": "verde", "id": 3},
        {"severity": "naranja", "id": 4},
        {"severity": "roja", "id": 5},
    ]
    result = _sort_by_severity(alerts)
    assert [a["severity"] for a in result] == ["roja", "roja", "naranja", "amarilla", "verde"]
    assert [a["id"] for a in result if a["severity"] == "roja"] == [2, 5]  # orden estable


# --- compute_preventive_alerts ---------------------------------------------------


def test_preventive_alerts_fresh_user_flags_high_subutilization(user):
    # Sin tareas, la capacidad disponible es ~100% -> subutilización "Alto".
    alerts = compute_preventive_alerts(user=user, now=NOW)
    assert any(a["related_indicator"] == "subutilizacion" and a["severity"] == "amarilla" for a in alerts)


def test_preventive_alerts_overload_flags_roja_sobrecarga(user):
    _task(
        user, status=Task.Status.EN_PROGRESO, start_date=datetime(2026, 8, 1, tzinfo=dt_timezone.utc),
        end_date=datetime(2026, 8, 20, tzinfo=dt_timezone.utc), estimated_hours=1000,
    )
    alerts = compute_preventive_alerts(user=user, now=NOW)
    sobrecarga_alerts = [a for a in alerts if a["related_indicator"] == "sobrecarga"]
    assert len(sobrecarga_alerts) == 1
    assert sobrecarga_alerts[0]["severity"] == "roja"
    assert sobrecarga_alerts[0]["source"] == "Predicción de Sobrecarga"
    # Con capacidad en sobrecarga, la subutilización deja de estar en "Alto".
    assert not any(a["related_indicator"] == "subutilizacion" for a in alerts)


# --- compute_team_preventive_alerts -----------------------------------------------


def test_team_preventive_alerts_empty_team_and_projects_is_green():
    alerts = compute_team_preventive_alerts(user_ids=[], project_ids=[], now=NOW)
    assert alerts == [
        {
            "severity": "verde",
            "message": "Sin riesgos preventivos detectados en el equipo.",
            "source": "Inteligencia Preventiva",
            "related_indicator": "estabilidad",
        }
    ]


def test_team_preventive_alerts_names_the_subutilized_member(user):
    alerts = compute_team_preventive_alerts(user_ids=[user.id], project_ids=[], now=NOW)
    subutilizacion_alerts = [a for a in alerts if a["related_indicator"] == "subutilizacion"]
    assert len(subutilizacion_alerts) == 1
    assert "Ana" in subutilizacion_alerts[0]["message"]


def test_team_preventive_alerts_flags_delayed_project(user):
    project = Project.objects.create(
        name="Proyecto en riesgo", priority="MEDIA", start_date=datetime(2026, 8, 1, tzinfo=dt_timezone.utc),
        target_date=datetime(2026, 8, 31, tzinfo=dt_timezone.utc), target_time_hours=100,
        responsible=user, created_by=user,
    )
    ProjectParticipant.objects.create(project=project, user=user, added_by=user)
    # Sobrecarga del participante (+40) + ritmo por debajo del avance transcurrido (+20) = 60 -> nivel Alto.
    _task(
        user, status=Task.Status.EN_PROGRESO, start_date=datetime(2026, 8, 1, tzinfo=dt_timezone.utc),
        end_date=datetime(2026, 8, 20, tzinfo=dt_timezone.utc), estimated_hours=1000,
    )
    alerts = compute_team_preventive_alerts(user_ids=[], project_ids=[project.id], now=NOW)
    retraso_alerts = [a for a in alerts if a["related_indicator"] == "retraso"]
    assert len(retraso_alerts) == 1
    assert retraso_alerts[0]["severity"] == "roja"
    assert "Proyecto en riesgo" in retraso_alerts[0]["message"]
