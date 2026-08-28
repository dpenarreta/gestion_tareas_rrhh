"""Cobertura de apps.analytics.prediction_engine — Fase 9 (ver
docs/AUDIT_LOG.md § 2026-08-18), réplica de
src/lib/predictionEngine.ts."""

from datetime import datetime
from datetime import timezone as dt_timezone

import pytest

from apps.analytics.prediction_engine import (
    CAPACITY_BASE_PROBABILITY,
    _compute_delay_score,
    compute_cumplimiento_projection,
    compute_historical_reliability,
    compute_operational_stability,
    compute_prediction_confidence,
    compute_project_delay_prediction,
    compute_sobrecarga_probability,
    compute_subutilizacion_predictions,
    compute_task_delay_prediction,
    nearest_horizon,
)
from apps.projects.models import Project, ProjectParticipant
from apps.tasks.models import Task
from apps.users.models import User

pytestmark = pytest.mark.django_db

# Miércoles, mismo instante usado en test_capacity_forecast.py para consistencia.
NOW = datetime(2026, 8, 12, 10, 0, tzinfo=dt_timezone.utc)


@pytest.fixture
def user():
    return User.objects.create_user(username="target", email="target@example.com", password="Sup3r-Secr3t!")


def _task(user, *, status, start_date, end_date, estimated_hours=5, real_hours=0.0) -> Task:
    return Task.objects.create(
        title="T", priority="MEDIA", frequency="PUNTUAL", start_date=start_date, end_date=end_date,
        estimated_hours=estimated_hours, real_hours=real_hours, assigned_to=user, created_by=user, status=status,
    )


# --- nearest_horizon ----------------------------------------------------------


def test_nearest_horizon_picks_closest():
    assert nearest_horizon(0) == 7
    assert nearest_horizon(10) == 7
    assert nearest_horizon(100) == 90


def test_nearest_horizon_tie_keeps_earlier_option():
    assert nearest_horizon(11) == 7  # |11-7|=4 == |11-15|=4, se queda con el primero.
    assert nearest_horizon(22.5) == 15  # |22.5-15|=7.5 == |22.5-30|=7.5.


# --- compute_historical_reliability --------------------------------------------


def test_historical_reliability_high_with_full_weeks_and_quality():
    assert compute_historical_reliability(6, 100) == "alta"


def test_historical_reliability_low_with_no_data():
    assert compute_historical_reliability(0, 0) == "baja"


def test_historical_reliability_medium_boundary():
    assert compute_historical_reliability(3, 50) == "media"


# --- compute_prediction_confidence ---------------------------------------------


def test_prediction_confidence_best_case_near_horizon():
    assert compute_prediction_confidence(data_score=1, consistency_score=1, horizon=7) == 91


def test_prediction_confidence_worst_case_far_horizon():
    assert compute_prediction_confidence(data_score=0, consistency_score=0, horizon=90) == 11


def test_prediction_confidence_never_reaches_100():
    assert compute_prediction_confidence(data_score=1, consistency_score=1, horizon=90) <= 92


# --- _compute_delay_score -------------------------------------------------------


def test_delay_score_no_signals_is_zero():
    result = _compute_delay_score(capacity_estado="alta", consistency_level="muy-consistente", overdue_count=0)
    assert result == {"probabilidad_pct": 0, "motivos": []}


def test_delay_score_combines_capacity_consistency_and_overdue():
    result = _compute_delay_score(capacity_estado="sobrecarga", consistency_level="muy-variable", overdue_count=2)
    assert result["probabilidad_pct"] == 90  # 40 (sobrecarga) + 30 (muy-variable) + min(30, 2*10)=20
    assert set(result["motivos"]) == {"Sobrecarga", "Baja consistencia", "Retrasos recientes"}


def test_delay_score_pace_behind_does_not_duplicate_motivo(user):
    result = _compute_delay_score(capacity_estado="alta", consistency_level=None, overdue_count=1, pace_behind=True)
    # overdue_count>0 ya agrega "Retrasos recientes"; pace_behind no debe duplicarlo ni sumar de más.
    assert result["motivos"].count("Retrasos recientes") == 1
    assert result["probabilidad_pct"] == 10  # min(30, 1*10)


# --- compute_cumplimiento_projection --------------------------------------------


def test_cumplimiento_projection_zero_pct_without_any_task(user):
    # "Sin historial suficiente" solo dispara si NINGUNA semana de la ventana
    # tiene días hábiles (business_days es de calendario, no de actividad
    # del usuario) — con un usuario sin tareas, la proyección sigue
    # "available" pero en 0%, réplica exacta de `computeCumplimientoProjection`.
    result = compute_cumplimiento_projection(user=user, now=NOW)
    assert result["available"] is True
    assert result["cumplimiento_esperado_cierre_pct"] == 0
    assert result["variacion_esperada_pct"] == 0


# --- compute_sobrecarga_probability ---------------------------------------------


def test_sobrecarga_probability_matches_base_probability_for_capacity_estado(user):
    result = compute_sobrecarga_probability(user=user, now=NOW)
    assert result["available"] is True
    # Sin tareas, la capacidad es "alta" (compute_team_capacity_forecast) -> base 10%.
    assert result["probabilidad_pct"] == CAPACITY_BASE_PROBABILITY["alta"]
    assert result["nivel"] == "Bajo"


def test_sobrecarga_probability_is_high_when_overloaded(user):
    _task(
        user, status=Task.Status.EN_PROGRESO, start_date=datetime(2026, 8, 1, tzinfo=dt_timezone.utc),
        end_date=datetime(2026, 8, 20, tzinfo=dt_timezone.utc), estimated_hours=1000,
    )
    result = compute_sobrecarga_probability(user=user, now=NOW)
    assert result["probabilidad_pct"] >= CAPACITY_BASE_PROBABILITY["sobrecarga"]
    assert result["nivel"] == "Alto"


# --- compute_task_delay_prediction ----------------------------------------------


def test_task_delay_prediction_not_found():
    result = compute_task_delay_prediction(task_id=999999, now=NOW)
    assert result == {"available": False, "reason": "Tarea no encontrada"}


def test_task_delay_prediction_unavailable_when_completed(user):
    task = _task(
        user, status=Task.Status.COMPLETADA, start_date=datetime(2026, 8, 1, tzinfo=dt_timezone.utc),
        end_date=datetime(2026, 8, 10, tzinfo=dt_timezone.utc),
    )
    result = compute_task_delay_prediction(task_id=task.id, now=NOW)
    assert result == {"available": False, "reason": "La tarea ya está completada"}


def test_task_delay_prediction_flags_overdue_tasks(user):
    _task(
        user, status=Task.Status.PENDIENTE, start_date=datetime(2026, 8, 1, tzinfo=dt_timezone.utc),
        end_date=datetime(2026, 8, 5, tzinfo=dt_timezone.utc),  # vencida respecto a NOW (12 ago)
    )
    open_task = _task(
        user, status=Task.Status.PENDIENTE, start_date=datetime(2026, 8, 1, tzinfo=dt_timezone.utc),
        end_date=datetime(2026, 8, 25, tzinfo=dt_timezone.utc),
    )
    result = compute_task_delay_prediction(task_id=open_task.id, now=NOW)
    assert result["available"] is True
    assert "Retrasos recientes" in result["motivos"]
    assert result["probabilidad_pct"] > 0


# --- compute_project_delay_prediction -------------------------------------------


def test_project_delay_prediction_not_found():
    result = compute_project_delay_prediction(project_id=999999, now=NOW)
    assert result == {"available": False, "reason": "Proyecto no encontrado"}


@pytest.fixture
def project(user):
    # Arranca 1 día antes de NOW con un rango largo (60 días) para que el
    # avance transcurrido (~2%) quede muy por debajo del umbral de
    # "pace_behind" (>=15 puntos vs. 0% ejecutado) — así estos tests
    # verifican el estado de capacidad/consistencia sin ese ruido.
    return Project.objects.create(
        name="P", priority="MEDIA", start_date=datetime(2026, 8, 11, tzinfo=dt_timezone.utc),
        target_date=datetime(2026, 10, 10, tzinfo=dt_timezone.utc), target_time_hours=100,
        responsible=user, created_by=user,
    )


def test_project_delay_prediction_unavailable_when_closed(user, project):
    project.status = Project.Status.COMPLETADO
    project.save()
    result = compute_project_delay_prediction(project_id=project.id, now=NOW)
    assert result == {"available": False, "reason": "El proyecto ya está cerrado"}


def test_project_delay_prediction_without_participants_has_no_planning_state(project):
    result = compute_project_delay_prediction(project_id=project.id, now=NOW)
    assert result["available"] is True
    assert result["probabilidad_pct"] == 0
    assert result["motivos"] == []


def test_project_delay_prediction_flags_pace_behind_with_participants(user):
    # 11 de 30 días transcurridos (~37%) pero 0% ejecutado -> pace_behind (>=15pts de diferencia).
    behind_project = Project.objects.create(
        name="P2", priority="MEDIA", start_date=datetime(2026, 8, 1, tzinfo=dt_timezone.utc),
        target_date=datetime(2026, 8, 31, tzinfo=dt_timezone.utc), target_time_hours=100,
        responsible=user, created_by=user,
    )
    ProjectParticipant.objects.create(project=behind_project, user=user, added_by=user)
    result = compute_project_delay_prediction(project_id=behind_project.id, now=NOW)
    assert result["available"] is True
    assert "Retrasos recientes" in result["motivos"]


# --- compute_operational_stability ----------------------------------------------


def test_operational_stability_uses_zero_variability_of_flat_indicators(user):
    # "proyectos"/"actividades" siempre tienen window_weeks puntos (aunque
    # sean todos cero) -> el bloque "sin ningún indicador disponible"
    # (defensivo, réplica de `computeOperationalStability`) no es alcanzable
    # en la práctica, igual que en el TS original.
    result = compute_operational_stability(user=user, now=NOW)
    assert result["average_coefficient_of_variation"] == 0
    assert result["classification"] == "Muy Alta"
    assert result["based_on"] == []


# --- compute_subutilizacion_predictions -----------------------------------------


def test_subutilizacion_predictions_empty_for_no_users():
    assert compute_subutilizacion_predictions(user_ids=[], now=NOW) == {}


def test_subutilizacion_predictions_high_level_when_fully_available(user):
    result = compute_subutilizacion_predictions(user_ids=[user.id], now=NOW)
    assert result[user.id]["nivel"] == "Alto"
    assert result[user.id]["horizon"] in (7, 15, 30, 90)
