"""Cobertura de apps.analytics.operational_risk — Fase 4h (ver
docs/AUDIT_LOG.md § 2026-08-11)."""

from datetime import datetime
from datetime import timezone as dt_timezone

import pytest

from apps.analytics import operational_risk as module
from apps.analytics.models import AnalyticsAuditLog
from apps.analytics.operational_risk import (
    _compute_seguimiento_concentration,
    _get_risk_trend_vs_prev_month,
    classify_operational_risk,
    compute_operational_risk,
)
from apps.tasks.models import Task, TaskActivity
from apps.users.models import User

pytestmark = pytest.mark.django_db

NOW = datetime(2026, 8, 12, 10, 0, tzinfo=dt_timezone.utc)


@pytest.fixture
def user():
    return User.objects.create_user(username="target", email="target@example.com", password="Sup3r-Secr3t!")


def _seguimiento_activity(user, reason: str, duration: int, when: datetime = NOW) -> TaskActivity:
    task = Task.objects.create(
        title="T", priority="MEDIA", frequency="PUNTUAL", type=Task.Type.SEGUIMIENTO,
        start_date=when, end_date=when, estimated_hours=1, assigned_to=user, created_by=user,
    )
    activity = TaskActivity.objects.create(task=task, author=user, reason=reason, duration=duration)
    TaskActivity.objects.filter(pk=activity.pk).update(created_at=when)
    return activity


_DEFAULT_CAPACITY = {"disponible": 10, "disponible_pct": 50, "tasks_sin_estimar": 0}
_DEFAULT_TRENDS = {"cumplimiento": {"mes_anterior": {"available": False}}}
_DEFAULT_CONSISTENCY = {"available": False}
_DEFAULT_CARGA_TIEMPO = {"mensual": {"weekend_hours": 0}}


def _mock_dependencies(monkeypatch, *, capacity=None, trends=None, consistency=None, carga_tiempo=None):
    """`compute_operational_risk` combina 4 dependencias ya probadas
    en sus propios archivos de tests (Fases 4b/4d/4f) + consultas
    directas a `Task`/`TaskActivity`. Mockear las 4 aísla la
    ORQUESTACIÓN nueva de esta sub-fase, que es lo que se quiere
    probar aquí — no re-testear esas dependencias."""
    monkeypatch.setattr(module, "compute_capacity_forecast", lambda *, user, now: {**_DEFAULT_CAPACITY, **(capacity or {})})
    monkeypatch.setattr(module, "compute_trends", lambda *, user, now: trends or _DEFAULT_TRENDS)
    monkeypatch.setattr(module, "compute_consistency", lambda *, user, now: consistency or _DEFAULT_CONSISTENCY)
    monkeypatch.setattr(module, "compute_carga_tiempo", lambda *, user, now: carga_tiempo or _DEFAULT_CARGA_TIEMPO)


# --- classify_operational_risk ---------------------------------------------------


def test_classify_operational_risk_bands():
    assert classify_operational_risk(10, 31, 61, 81) == {"classification": "Bajo", "classification_color": "green"}
    assert classify_operational_risk(40, 31, 61, 81) == {"classification": "Medio", "classification_color": "yellow"}
    assert classify_operational_risk(70, 31, 61, 81) == {"classification": "Alto", "classification_color": "orange"}
    assert classify_operational_risk(90, 31, 61, 81) == {"classification": "Crítico", "classification_color": "red"}


def test_classify_operational_risk_boundaries():
    assert classify_operational_risk(31, 31, 61, 81)["classification"] == "Medio"
    assert classify_operational_risk(30.9, 31, 61, 81)["classification"] == "Bajo"


# --- _compute_seguimiento_concentration ------------------------------------------


def test_concentration_no_activities_is_zero(user):
    result = _compute_seguimiento_concentration(user=user, year=2026, month=8)
    assert result == {"pct": 0, "detail": "Sin actividades de seguimiento este mes"}


def test_concentration_at_or_below_threshold_is_zero(user):
    _seguimiento_activity(user, "A", 70)
    _seguimiento_activity(user, "B", 30)
    result = _compute_seguimiento_concentration(user=user, year=2026, month=8)
    assert result == {"pct": 0, "detail": "Concentración máxima entre motivos: 70%"}


def test_concentration_above_threshold_scales_by_3x(user):
    _seguimiento_activity(user, "A", 80)
    _seguimiento_activity(user, "B", 20)
    result = _compute_seguimiento_concentration(user=user, year=2026, month=8)
    assert result == {"pct": 30, "detail": "80% del tiempo de seguimiento concentrado en un solo motivo"}


def test_concentration_single_reason_reaches_practical_maximum_of_90(user):
    # topPct no puede superar 100% (es una fracción del total) -> el
    # "Math.min(100, ...)" del legacy es defensivo, nunca alcanzable en la
    # práctica: (100-70)*3 = 90 es el máximo real de esta fórmula.
    _seguimiento_activity(user, "A", 100)
    result = _compute_seguimiento_concentration(user=user, year=2026, month=8)
    assert result["pct"] == 90


# --- _get_risk_trend_vs_prev_month -------------------------------------------------


def test_risk_trend_unavailable_without_prior_audit(user):
    result = _get_risk_trend_vs_prev_month(user=user, year=2026, month=8, current_score=20)
    assert result == {"available": False, "reason": "Sin historial suficiente"}


def test_risk_trend_computes_diff_against_prev_month(user):
    AnalyticsAuditLog.objects.create(user=user, kind="operational_risk", period="2026-07", result={"score": 10}, engine_version="1.5.0")
    result = _get_risk_trend_vs_prev_month(user=user, year=2026, month=8, current_score=25)
    assert result == {"available": True, "diff": 15.0}


def test_risk_trend_handles_january_wraparound(user):
    AnalyticsAuditLog.objects.create(user=user, kind="operational_risk", period="2025-12", result={"score": 5}, engine_version="1.5.0")
    result = _get_risk_trend_vs_prev_month(user=user, year=2026, month=1, current_score=10)
    assert result == {"available": True, "diff": 5.0}


def test_risk_trend_unavailable_when_prev_result_malformed(user):
    AnalyticsAuditLog.objects.create(user=user, kind="operational_risk", period="2026-07", result={"not_score": 1}, engine_version="1.5.0")
    result = _get_risk_trend_vs_prev_month(user=user, year=2026, month=8, current_score=25)
    assert result["available"] is False


# --- compute_operational_risk: los 8 factores -------------------------------------


def test_sobrecarga_factor_activates_when_disponible_negative(user, monkeypatch):
    _mock_dependencies(monkeypatch, capacity={"disponible": -8, "disponible_pct": -20, "tasks_sin_estimar": 0})
    result = compute_operational_risk(user=user, now=NOW)
    factor = next(f for f in result["factors"] if f["name"] == "Sobrecarga proyectada")
    assert factor["points"] > 0
    assert "Sobrecarga proyectada de 8h" in factor["detail"]


def test_sobrecarga_factor_zero_when_disponible_positive(user, monkeypatch):
    _mock_dependencies(monkeypatch)
    result = compute_operational_risk(user=user, now=NOW)
    factor = next(f for f in result["factors"] if f["name"] == "Sobrecarga proyectada")
    assert factor["points"] == 0
    assert factor["detail"] == "Sin sobrecarga proyectada"


def test_criticas_vencidas_factor_counts_only_overdue_alta_open_tasks(user, monkeypatch):
    _mock_dependencies(monkeypatch)
    Task.objects.create(
        title="Vencida alta", priority="ALTA", frequency="PUNTUAL", start_date=NOW,
        end_date=datetime(2026, 8, 1, tzinfo=dt_timezone.utc), estimated_hours=1,
        assigned_to=user, created_by=user, status=Task.Status.PENDIENTE,
    )
    # No cuenta: ya archivada.
    Task.objects.create(
        title="Archivada", priority="ALTA", frequency="PUNTUAL", start_date=NOW,
        end_date=datetime(2026, 8, 1, tzinfo=dt_timezone.utc), estimated_hours=1,
        assigned_to=user, created_by=user, status=Task.Status.PENDIENTE, archived_month="2026-07",
    )
    # No cuenta: ya completada.
    Task.objects.create(
        title="Completada", priority="ALTA", frequency="PUNTUAL", start_date=NOW,
        end_date=datetime(2026, 8, 1, tzinfo=dt_timezone.utc), estimated_hours=1,
        assigned_to=user, created_by=user, status=Task.Status.COMPLETADA, completed_at=NOW,
    )
    result = compute_operational_risk(user=user, now=NOW)
    factor = next(f for f in result["factors"] if f["name"] == "Tareas críticas vencidas")
    assert "1 tarea vencida" in factor["detail"]
    assert factor["points"] > 0


def test_tendencia_negativa_factor_only_when_direction_is_empeoro(user, monkeypatch):
    _mock_dependencies(monkeypatch, trends={"cumplimiento": {"mes_anterior": {"available": True, "direction": "empeoro", "absolute_diff": -20}}})
    result = compute_operational_risk(user=user, now=NOW)
    factor = next(f for f in result["factors"] if f["name"] == "Tendencia negativa de cumplimiento")
    assert factor["points"] > 0
    assert "cayó" in factor["detail"]


def test_tendencia_negativa_factor_zero_when_improved(user, monkeypatch):
    _mock_dependencies(monkeypatch, trends={"cumplimiento": {"mes_anterior": {"available": True, "direction": "mejora", "absolute_diff": 10}}})
    result = compute_operational_risk(user=user, now=NOW)
    factor = next(f for f in result["factors"] if f["name"] == "Tendencia negativa de cumplimiento")
    assert factor["points"] == 0
    assert "mejoró" in factor["detail"]


def test_horas_extra_factor_activates_with_weekend_hours(user, monkeypatch):
    _mock_dependencies(monkeypatch, carga_tiempo={"mensual": {"weekend_hours": 5}})
    result = compute_operational_risk(user=user, now=NOW)
    factor = next(f for f in result["factors"] if f["name"] == "Horas extras recurrentes")
    assert factor["points"] > 0
    assert "5h trabajadas en fin de semana" in factor["detail"]


def test_baja_capacidad_factor_full_severity_when_overloaded(user, monkeypatch):
    _mock_dependencies(monkeypatch, capacity={"disponible": -5, "disponible_pct": -10, "tasks_sin_estimar": 0})
    result = compute_operational_risk(user=user, now=NOW)
    factor = next(f for f in result["factors"] if f["name"] == "Baja capacidad futura (<10%)")
    assert factor["points"] == pytest.approx(factor["weight"])  # severidad 100% -> points == weight


def test_baja_capacidad_factor_zero_above_10_pct(user, monkeypatch):
    _mock_dependencies(monkeypatch, capacity={"disponible": 50, "disponible_pct": 50, "tasks_sin_estimar": 0})
    result = compute_operational_risk(user=user, now=NOW)
    factor = next(f for f in result["factors"] if f["name"] == "Baja capacidad futura (<10%)")
    assert factor["points"] == 0


def test_variabilidad_factor_scales_with_consistency_level(user, monkeypatch):
    _mock_dependencies(monkeypatch, consistency={"available": True, "level": "muy-variable", "label": "Muy variable", "coefficient_of_variation": 50})
    result = compute_operational_risk(user=user, now=NOW)
    factor = next(f for f in result["factors"] if f["name"] == "Variabilidad excesiva entre semanas")
    assert factor["points"] == pytest.approx(factor["weight"])  # muy-variable -> severidad 100%


def test_concentracion_factor_uses_real_activity_data(user, monkeypatch):
    _mock_dependencies(monkeypatch)
    _seguimiento_activity(user, "A", 90)
    _seguimiento_activity(user, "B", 10)
    result = compute_operational_risk(user=user, now=NOW)
    factor = next(f for f in result["factors"] if f["name"] == "Alta concentración en un solo tipo de actividad")
    assert factor["points"] > 0


def test_sin_planificacion_factor_uses_capacity_tasks_sin_estimar(user, monkeypatch):
    _mock_dependencies(monkeypatch, capacity={"disponible": 10, "disponible_pct": 50, "tasks_sin_estimar": 2})
    result = compute_operational_risk(user=user, now=NOW)
    factor = next(f for f in result["factors"] if f["name"] == "Muchas tareas sin planificación")
    assert factor["points"] > 0
    assert "2 tareas sin tiempo objetivo definido" in factor["detail"]


# --- suggested_actions -------------------------------------------------------------


def test_default_suggested_action_when_nothing_triggers(user, monkeypatch):
    _mock_dependencies(monkeypatch)
    result = compute_operational_risk(user=user, now=NOW)
    assert result["suggested_actions"] == ["Sin acciones urgentes — mantener el seguimiento habitual."]


def test_suggests_actions_for_each_triggered_factor(user, monkeypatch):
    _mock_dependencies(
        monkeypatch,
        capacity={"disponible": -8, "disponible_pct": -20, "tasks_sin_estimar": 0},
        consistency={"available": True, "level": "muy-variable", "label": "Muy variable", "coefficient_of_variation": 50},
    )
    Task.objects.create(
        title="Vencida alta", priority="ALTA", frequency="PUNTUAL", start_date=NOW,
        end_date=datetime(2026, 8, 1, tzinfo=dt_timezone.utc), estimated_hours=1,
        assigned_to=user, created_by=user, status=Task.Status.PENDIENTE,
    )
    result = compute_operational_risk(user=user, now=NOW)
    assert "Redistribuir tareas pendientes/en progreso para evitar la sobrecarga proyectada." in result["suggested_actions"]
    assert "Priorizar de inmediato las tareas críticas (prioridad Alta) vencidas." in result["suggested_actions"]
    assert "No asignar nuevas tareas hasta liberar capacidad." in result["suggested_actions"]
    assert "Revisar la carga semana a semana — el ritmo de trabajo es muy irregular." in result["suggested_actions"]


# --- auditoría y score total --------------------------------------------------------


def test_writes_audit_log_with_correct_formula_versions(user, monkeypatch):
    _mock_dependencies(monkeypatch)
    result = compute_operational_risk(user=user, now=NOW)
    log = AnalyticsAuditLog.objects.get(user=user, kind="operational_risk")
    assert log.period == "2026-08"
    assert log.result["score"] == result["score"]
    assert log.result["formula_versions"] == {"riesgo_operativo": "1.0"}


def test_final_score_is_sum_of_factor_points(user, monkeypatch):
    _mock_dependencies(monkeypatch)
    result = compute_operational_risk(user=user, now=NOW)
    assert result["score"] == round(sum(f["points"] for f in result["factors"]), 2)


def test_uses_configured_thresholds_from_effective_analytics_config(user, monkeypatch):
    _mock_dependencies(monkeypatch)
    result = compute_operational_risk(user=user, now=NOW)
    # Con todo neutro (sin factores activados), el score es 0 -> banda "Bajo".
    assert result["classification"] == "Bajo"
