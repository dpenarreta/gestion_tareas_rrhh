"""Cobertura de apps.analytics.scoring — Fase 4b (ver
docs/AUDIT_LOG.md § 2026-08-11)."""

import pytest

from apps.analytics.models import AnalyticsAuditLog
from apps.analytics.scoring import (
    audit_calculation,
    compute_completed_pct_any,
    compute_estimated_vs_real_ratio,
    compute_simple_score,
    validate_cumplimiento_consistency,
    weighted_points,
)
from apps.tasks.models import Task
from apps.users.models import User

pytestmark = pytest.mark.django_db


@pytest.fixture
def user():
    return User.objects.create_user(username="target", email="target@example.com", password="Sup3r-Secr3t!")


# --- compute_simple_score -----------------------------------------------------


def test_compute_simple_score_all_zero_inputs_is_20():
    assert compute_simple_score(0, 0, 0) == 20


def test_compute_simple_score_perfect_inputs_is_100():
    assert compute_simple_score(100, 100, 100, total_comments=10) == 100


def test_compute_simple_score_overload_penalizes_score_l():
    # carga_ratio=150 -> scoreL = 20 - max(0,50)*0.5 = -5 -> floor a 0.
    score_full_load = compute_simple_score(100, 100, 100, total_comments=10)
    score_overloaded = compute_simple_score(100, 150, 100, total_comments=10)
    assert score_overloaded < score_full_load


# --- compute_completed_pct_any (Definición A de cumplimiento) ----------------


def _task_with_status(status) -> Task:
    return Task(status=status, priority="MEDIA", estimated_hours=1)


def test_completed_pct_any_empty_defaults_to_zero():
    assert compute_completed_pct_any([]) == 0


def test_completed_pct_any_empty_respects_custom_empty_value():
    assert compute_completed_pct_any([], empty_value=100) == 100


def test_completed_pct_any_counts_completada_regardless_of_on_time():
    tasks = [
        _task_with_status(Task.Status.COMPLETADA),
        _task_with_status(Task.Status.COMPLETADA),
        _task_with_status(Task.Status.PENDIENTE),
        _task_with_status(Task.Status.EN_PROGRESO),
    ]
    assert compute_completed_pct_any(tasks) == 50


# --- compute_estimated_vs_real_ratio -----------------------------------------


def test_estimated_vs_real_ratio_normal_division():
    assert compute_estimated_vs_real_ratio(total_real=5, total_estimated=10) == 50


def test_estimated_vs_real_ratio_sentinel_when_no_estimate_but_real_hours():
    assert compute_estimated_vs_real_ratio(total_real=3, total_estimated=0) == 200


def test_estimated_vs_real_ratio_zero_when_nothing_logged():
    assert compute_estimated_vs_real_ratio(total_real=0, total_estimated=0) == 0


# --- validate_cumplimiento_consistency ---------------------------------------


def _priority_compliance(alta_total, alta_pct, alta_completed=None):
    completed = alta_completed if alta_completed is not None else round(alta_total * alta_pct / 100)
    return [
        {"priority": "ALTA", "total": alta_total, "completed_on_time": completed, "pct": alta_pct},
        {"priority": "MEDIA", "total": 0, "completed_on_time": 0, "pct": 0},
        {"priority": "BAJA", "total": 0, "completed_on_time": 0, "pct": 0},
    ]


def test_validate_consistency_no_failures_when_coherent(user):
    priority_compliance = _priority_compliance(5, 100)
    failures = validate_cumplimiento_consistency(
        user=user, cumplimiento_general={"total": 5, "pct": 100}, priority_compliance=priority_compliance
    )
    assert failures == []
    assert AnalyticsAuditLog.objects.count() == 0


def test_validate_consistency_flags_sum_mismatch(user):
    priority_compliance = _priority_compliance(5, 100)
    failures = validate_cumplimiento_consistency(
        user=user, cumplimiento_general={"total": 6, "pct": 100}, priority_compliance=priority_compliance
    )
    assert any(f["rule"] == "suma_prioridad_total" for f in failures)
    assert AnalyticsAuditLog.objects.filter(kind="validation_failure", user=user).exists()


def test_validate_consistency_flags_weighted_mismatch_beyond_tolerance(user):
    priority_compliance = _priority_compliance(10, 50)
    failures = validate_cumplimiento_consistency(
        user=user, cumplimiento_general={"total": 10, "pct": 90}, priority_compliance=priority_compliance
    )
    assert any(f["rule"] == "cumplimiento_incoherente" for f in failures)


def test_validate_consistency_flags_general_over_100(user):
    priority_compliance = _priority_compliance(10, 100)
    failures = validate_cumplimiento_consistency(
        user=user, cumplimiento_general={"total": 10, "pct": 110}, priority_compliance=priority_compliance
    )
    rules = {f["rule"] for f in failures}
    assert "cumplimiento_excede_100" in rules
    assert "cumplimiento_prioridad_excede_100" not in rules


def test_validate_consistency_flags_priority_over_100(user):
    priority_compliance = _priority_compliance(10, 110, alta_completed=11)
    failures = validate_cumplimiento_consistency(
        user=user, cumplimiento_general={"total": 10, "pct": 100}, priority_compliance=priority_compliance
    )
    rules = {f["rule"] for f in failures}
    assert "cumplimiento_prioridad_excede_100" in rules
    assert "cumplimiento_excede_100" not in rules


# --- weighted_points (Fase 4e) -------------------------------------------------


def test_weighted_points_full_weight():
    assert weighted_points(80, 100) == 80.0


def test_weighted_points_partial_weight():
    assert weighted_points(50, 35) == 17.5


def test_weighted_points_zero_raw_score_is_zero():
    assert weighted_points(0, 35) == 0.0


# --- audit_calculation (Fase 4e) -----------------------------------------------


def test_audit_calculation_writes_log_with_known_formula_versions(user):
    audit_calculation(
        user=user, kind="performance_score", period="2026-08",
        inputs={"a": 1}, result={"score": 80},
    )
    log = AnalyticsAuditLog.objects.get(user=user, kind="performance_score")
    assert log.result["score"] == 80
    assert log.result["formula_versions"] == {
        "performance_score": "4.0", "cumplimiento": "2.0", "consistencia": "2.1", "trazabilidad": "4.0",
    }
    assert log.inputs == {"a": 1}


def test_audit_calculation_unknown_kind_has_empty_formula_versions(user):
    audit_calculation(user=user, kind="some_unmapped_kind", period="2026-08", inputs={}, result={})
    log = AnalyticsAuditLog.objects.get(user=user, kind="some_unmapped_kind")
    assert log.result["formula_versions"] == {}


def test_audit_calculation_never_raises_on_db_error(user, monkeypatch):
    def _boom(*args, **kwargs):
        raise RuntimeError("boom")

    monkeypatch.setattr(AnalyticsAuditLog.objects, "create", _boom)
    audit_calculation(user=user, kind="performance_score", period="2026-08", inputs={}, result={})  # no debe lanzar
