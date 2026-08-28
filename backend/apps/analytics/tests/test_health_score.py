"""Cobertura de apps.analytics.health_score — Fase 4g (ver
docs/AUDIT_LOG.md § 2026-08-11)."""

from datetime import datetime
from datetime import timezone as dt_timezone

import pytest

from apps.analytics.health_score import (
    capacity_to_score,
    carga_health_score,
    classify_estado_operativo,
    compute_health_score,
)
from apps.analytics.models import AnalyticsAuditLog
from apps.tasks.models import Task
from apps.users.models import User

pytestmark = pytest.mark.django_db

NOW = datetime(2026, 8, 12, 10, 0, tzinfo=dt_timezone.utc)


@pytest.fixture
def user():
    return User.objects.create_user(username="target", email="target@example.com", password="Sup3r-Secr3t!")


def _task(user, *, end_date, status=Task.Status.PENDIENTE, priority="MEDIA") -> Task:
    return Task.objects.create(
        title="T", priority=priority, frequency="PUNTUAL", start_date=end_date, end_date=end_date,
        estimated_hours=1, assigned_to=user, created_by=user, status=status,
    )


# --- carga_health_score ---------------------------------------------------------


def test_carga_health_score_zero_base_hours_is_100():
    assert carga_health_score(5, 0, 10, 15) == 100


def test_carga_health_score_optimal_range_is_100():
    assert carga_health_score(35, 32, 36, 42) == 100


def test_carga_health_score_underutilization_is_linear():
    assert carga_health_score(16, 32, 36, 42) == 50


def test_carga_health_score_overload_decreases_symmetrically():
    # overBy = 42 - 36 = 6; span = max((42-36)*2, 1) = 12; 100 - (6/12)*100 = 50.
    assert carga_health_score(42, 32, 36, 42) == 50


def test_carga_health_score_far_overload_floors_at_0():
    assert carga_health_score(1000, 32, 36, 42) == 0


# --- capacity_to_score -----------------------------------------------------------


def test_capacity_to_score_alta_is_100():
    assert capacity_to_score("alta", 30) == 100


def test_capacity_to_score_limitada_is_70():
    assert capacity_to_score("limitada", 12) == 70


def test_capacity_to_score_sin_planificacion_is_70():
    assert capacity_to_score("sin-planificacion", 0) == 70


def test_capacity_to_score_no_asignar_is_40():
    assert capacity_to_score("no-asignar", 5) == 40


def test_capacity_to_score_sobrecarga_decreases_progressively():
    assert capacity_to_score("sobrecarga", 0) == 100
    assert capacity_to_score("sobrecarga", -5) == 90
    assert capacity_to_score("sobrecarga", -20) == 60
    assert capacity_to_score("sobrecarga", -50) == 0


def test_capacity_to_score_sobrecarga_never_goes_negative():
    assert capacity_to_score("sobrecarga", -90) == 0


# --- classify_estado_operativo ---------------------------------------------------


def test_classify_estado_operativo_tiers():
    assert classify_estado_operativo(95)["estado"] == "Equilibrio Óptimo"
    assert classify_estado_operativo(80)["estado"] == "Equilibrio Estable"
    assert classify_estado_operativo(65)["estado"] == "Requiere Atención"
    assert classify_estado_operativo(45)["estado"] == "Riesgo Operativo"
    assert classify_estado_operativo(10)["estado"] == "Desequilibrio Crítico"


def test_classify_estado_operativo_boundaries():
    assert classify_estado_operativo(90)["estado"] == "Equilibrio Óptimo"
    assert classify_estado_operativo(89.9)["estado"] == "Equilibrio Estable"
    assert classify_estado_operativo(0)["estado"] == "Desequilibrio Crítico"


def test_classify_estado_operativo_never_exposes_min_key():
    assert "min" not in classify_estado_operativo(50)


# --- compute_health_score ---------------------------------------------------------


def test_health_score_no_tasks_uses_100_pct_completion(user):
    result = compute_health_score(user=user, now=NOW)
    cumplimiento = next(f for f in result["factors"] if f["name"] == "Cumplimiento")
    assert cumplimiento["raw_label"] == "100%"


def test_health_score_never_includes_traceability_factor(user):
    result = compute_health_score(user=user, now=NOW)
    names = {f["name"] for f in result["factors"]}
    assert names == {"Cumplimiento", "Carga laboral", "Tareas vencidas", "Consistencia", "Capacidad futura"}


def test_health_score_no_consistency_history_uses_neutral_70(user):
    result = compute_health_score(user=user, now=NOW)
    consistencia = next(f for f in result["factors"] if f["name"] == "Consistencia")
    assert consistencia["raw_label"] == "Sin historial suficiente"


def test_health_score_overdue_alta_priority_penalizes_more_than_normal(user):
    _task(user, end_date=datetime(2026, 8, 1, tzinfo=dt_timezone.utc), priority="ALTA")
    result_alta = compute_health_score(user=user, now=NOW)

    other = User.objects.create_user(username="other", email="other@example.com", password="Sup3r-Secr3t!")
    _task(other, end_date=datetime(2026, 8, 1, tzinfo=dt_timezone.utc), priority="MEDIA")
    result_normal = compute_health_score(user=other, now=NOW)

    vencidas_alta = next(f for f in result_alta["factors"] if f["name"] == "Tareas vencidas")
    vencidas_normal = next(f for f in result_normal["factors"] if f["name"] == "Tareas vencidas")
    assert vencidas_alta["points"] < vencidas_normal["points"]


def test_health_score_no_tasks_has_no_overdue_penalty(user):
    result = compute_health_score(user=user, now=NOW)
    vencidas = next(f for f in result["factors"] if f["name"] == "Tareas vencidas")
    assert vencidas["raw_label"] == "0"
    assert vencidas["points"] == vencidas["weight"]  # score 100 * weight% / 100 = weight


def test_health_score_uses_precomputed_consistency_without_extra_query(user, monkeypatch):
    from apps.analytics import health_score as module

    def _boom(*args, **kwargs):
        raise AssertionError("no debería recalcular consistencia si se pasa precomputada")

    monkeypatch.setattr(module, "compute_consistency", _boom)
    precomputed = {"available": True, "consistency_pct": 40, "label": "Muy variable", "level": "muy-variable"}
    result = compute_health_score(user=user, now=NOW, precomputed_consistency=precomputed)
    consistencia = next(f for f in result["factors"] if f["name"] == "Consistencia")
    assert consistencia["raw_label"] == "Muy variable"


def test_health_score_writes_audit_log_with_correct_formula_versions(user):
    result = compute_health_score(user=user, now=NOW)
    log = AnalyticsAuditLog.objects.get(user=user, kind="health_score")
    assert log.period == "2026-08"
    assert log.result["score"] == result["score"]
    assert log.result["formula_versions"] == {
        "equilibrio_operativo": "1.1", "carga_laboral": "1.0", "cumplimiento": "2.0",
        "consistencia": "2.1", "capacidad_disponible": "1.1",
    }


def test_health_score_final_score_is_sum_of_factor_points(user):
    result = compute_health_score(user=user, now=NOW)
    assert result["score"] == round(sum(f["points"] for f in result["factors"]), 2)


def test_health_score_no_formula_set_version_field(user):
    # A diferencia de Performance Score (Fase 4e), HealthScoreResult NO
    # incluye formulaSetVersion en el legacy — no se agrega aquí tampoco.
    result = compute_health_score(user=user, now=NOW)
    assert "formula_set_version" not in result
    assert result["engine_version"] == "1.5.0"
