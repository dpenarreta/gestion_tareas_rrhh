"""Cobertura de apps.analytics.priority_compliance — Fase 4b (ver
docs/AUDIT_LOG.md § 2026-08-11)."""

from datetime import datetime
from datetime import timezone as dt_timezone

from apps.analytics.priority_compliance import compute_priority_compliance, is_completed_on_time
from apps.tasks.models import Task


def _task(priority, status, end_date, completed_at=None) -> Task:
    return Task(priority=priority, status=status, end_date=end_date, completed_at=completed_at, estimated_hours=1)


def test_is_completed_on_time_false_if_not_completed():
    task = _task("ALTA", Task.Status.PENDIENTE, datetime(2026, 1, 10, tzinfo=dt_timezone.utc))
    assert is_completed_on_time(task) is False


def test_is_completed_on_time_false_without_completed_at():
    task = _task("ALTA", Task.Status.COMPLETADA, datetime(2026, 1, 10, tzinfo=dt_timezone.utc), completed_at=None)
    assert is_completed_on_time(task) is False


def test_is_completed_on_time_compares_calendar_day_not_instant():
    # completedAt es el mismo día calendario que endDate pero horas después
    # -> a tiempo (fix legacy del 2026-07-24, comparación por día, no instante).
    task = _task(
        "ALTA", Task.Status.COMPLETADA,
        end_date=datetime(2026, 1, 10, 8, 0, tzinfo=dt_timezone.utc),
        completed_at=datetime(2026, 1, 10, 23, 0, tzinfo=dt_timezone.utc),
    )
    assert is_completed_on_time(task) is True


def test_is_completed_on_time_false_if_completed_next_day():
    task = _task(
        "ALTA", Task.Status.COMPLETADA,
        end_date=datetime(2026, 1, 10, 8, 0, tzinfo=dt_timezone.utc),
        completed_at=datetime(2026, 1, 11, 6, 0, tzinfo=dt_timezone.utc),
    )
    assert is_completed_on_time(task) is False


def test_compute_priority_compliance_always_returns_three_priorities_in_order():
    result = compute_priority_compliance([])
    assert [r["priority"] for r in result] == ["ALTA", "MEDIA", "BAJA"]
    assert all(r["total"] == 0 and r["pct"] == 0 for r in result)


def test_compute_priority_compliance_pct_per_priority():
    end = datetime(2026, 1, 10, tzinfo=dt_timezone.utc)
    tasks = [
        _task("ALTA", Task.Status.COMPLETADA, end, completed_at=end),
        _task("ALTA", Task.Status.PENDIENTE, end),
        _task("MEDIA", Task.Status.COMPLETADA, end, completed_at=end),
    ]
    result = compute_priority_compliance(tasks)
    by_priority = {r["priority"]: r for r in result}
    assert by_priority["ALTA"]["total"] == 2
    assert by_priority["ALTA"]["completed_on_time"] == 1
    assert by_priority["ALTA"]["pct"] == 50
    assert by_priority["MEDIA"]["total"] == 1
    assert by_priority["MEDIA"]["pct"] == 100
    assert by_priority["BAJA"]["total"] == 0
