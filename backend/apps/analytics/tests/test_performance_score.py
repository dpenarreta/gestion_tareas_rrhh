"""Cobertura de apps.analytics.performance_score — Fase 4e (ver
docs/AUDIT_LOG.md § 2026-08-11)."""

from datetime import datetime
from datetime import timezone as dt_timezone

import pytest

from apps.analytics.models import AnalyticsAuditLog
from apps.analytics.performance_score import classify_performance_score, compute_performance_score
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


# --- classify_performance_score ------------------------------------------------


def test_classify_performance_score_thresholds():
    assert classify_performance_score(95) == {"classification": "Excelente", "classification_color": "green"}
    assert classify_performance_score(80) == {"classification": "Bueno", "classification_color": "green"}
    assert classify_performance_score(65) == {"classification": "Riesgo", "classification_color": "yellow"}
    assert classify_performance_score(30) == {"classification": "Crítico", "classification_color": "red"}


def test_classify_performance_score_boundary_values():
    assert classify_performance_score(90)["classification"] == "Excelente"
    assert classify_performance_score(89.9)["classification"] == "Bueno"
    assert classify_performance_score(75)["classification_color"] == "green"
    assert classify_performance_score(74.9)["classification_color"] == "yellow"
    assert classify_performance_score(60)["classification_color"] == "yellow"
    assert classify_performance_score(59.9)["classification_color"] == "red"


# --- compute_performance_score --------------------------------------------------


def test_performance_score_no_tasks_uses_100_pct_completion(user):
    # compute_completed_pct_any(tasks, empty_value=100) -> sin tareas del
    # mes, el factor Cumplimiento parte de 100%, no de 0% (a diferencia
    # de /kpis/me, que usa empty_value=0).
    result = compute_performance_score(user=user, now=NOW)
    cumplimiento = next(f for f in result["factors"] if f["name"] == "Cumplimiento")
    assert cumplimiento["raw_value"] == 100


def test_performance_score_overdue_alta_priority_weighs_double(user):
    _task(user, end_date=datetime(2026, 8, 1, tzinfo=dt_timezone.utc), priority="ALTA")
    result = compute_performance_score(user=user, now=NOW)
    vencidas = next(f for f in result["factors"] if f["name"] == "Tareas vencidas")
    # 1 vencida de prioridad ALTA -> weightedOverdue = 0 normales + 1*2 = 2.
    assert vencidas["raw_value"] == 2


def test_performance_score_never_includes_carga_or_capacidad_factors(user):
    result = compute_performance_score(user=user, now=NOW)
    names = {f["name"] for f in result["factors"]}
    assert names == {"Cumplimiento", "Tareas vencidas", "Consistencia", "Índice de Trazabilidad"}


def test_performance_score_no_consistency_history_uses_neutral_70(user):
    result = compute_performance_score(user=user, now=NOW)
    consistencia = next(f for f in result["factors"] if f["name"] == "Consistencia")
    assert consistencia["raw_value"] == 70
    assert consistencia["raw_label"] == "Sin historial suficiente"


def test_performance_score_uses_precomputed_consistency_without_extra_query(user, monkeypatch):
    from apps.analytics import performance_score as module

    def _boom(*args, **kwargs):
        raise AssertionError("no debería recalcular consistencia si se pasa precomputada")

    monkeypatch.setattr(module, "compute_consistency", _boom)
    precomputed = {"available": True, "consistency_pct": 88.5}
    result = compute_performance_score(user=user, now=NOW, precomputed_consistency=precomputed)
    consistencia = next(f for f in result["factors"] if f["name"] == "Consistencia")
    assert consistencia["raw_value"] == 88.5


def test_performance_score_writes_audit_log(user):
    compute_performance_score(user=user, now=NOW)
    log = AnalyticsAuditLog.objects.get(user=user, kind="performance_score")
    assert log.period == "2026-08"
    assert log.result["score"] == pytest.approx(compute_performance_score(user=user, now=NOW)["score"])
    assert log.result["formula_versions"] == {
        "performance_score": "4.0", "cumplimiento": "2.0", "consistencia": "2.1", "trazabilidad": "4.0",
    }


def test_performance_score_final_score_is_sum_of_factor_points(user):
    result = compute_performance_score(user=user, now=NOW)
    assert result["score"] == round(sum(f["points"] for f in result["factors"]), 2)


def test_performance_score_engine_and_formula_set_version(user):
    result = compute_performance_score(user=user, now=NOW)
    assert result["engine_version"] == "1.5.0"
    assert result["formula_set_version"] == "4.4"
