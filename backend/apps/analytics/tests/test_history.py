"""Cobertura de apps.analytics.history — Fase 4d (ver
docs/AUDIT_LOG.md § 2026-08-11): compute_monthly_history/
compute_weekly_history/compute_trends/compute_effective_history_start."""

from datetime import datetime, timedelta
from datetime import timezone as dt_timezone

import pytest
from django.utils import timezone

from apps.analytics.history import (
    compute_effective_history_start,
    compute_monthly_history,
    compute_trends,
    compute_weekly_history,
)
from apps.tasks.models import Task, TaskActivity
from apps.users.models import User

pytestmark = pytest.mark.django_db

NOW = datetime(2026, 8, 12, 10, 0, tzinfo=dt_timezone.utc)  # miércoles


@pytest.fixture
def user():
    return User.objects.create_user(username="target", email="target@example.com", password="Sup3r-Secr3t!")


def _task(user, *, end_date, status=Task.Status.PENDIENTE, completed_at=None) -> Task:
    return Task.objects.create(
        title="T", priority="MEDIA", frequency="PUNTUAL", start_date=end_date, end_date=end_date,
        estimated_hours=1, assigned_to=user, created_by=user, status=status, completed_at=completed_at,
    )


# --- compute_monthly_history ---------------------------------------------------


def test_monthly_history_returns_months_back_entries_ending_at_current_month(user):
    result = compute_monthly_history(user=user, months_back=3, now=NOW)
    assert [m["month"] for m in result] == ["2026-06", "2026-07", "2026-08"]


def test_monthly_history_counts_tasks_per_month(user):
    _task(user, end_date=datetime(2026, 7, 15, tzinfo=dt_timezone.utc), status=Task.Status.COMPLETADA, completed_at=datetime(2026, 7, 15, tzinfo=dt_timezone.utc))
    _task(user, end_date=datetime(2026, 8, 5, tzinfo=dt_timezone.utc))
    _task(user, end_date=datetime(2026, 8, 10, tzinfo=dt_timezone.utc), status=Task.Status.COMPLETADA, completed_at=datetime(2026, 8, 10, tzinfo=dt_timezone.utc))

    result = compute_monthly_history(user=user, months_back=2, now=NOW)
    by_month = {m["month"]: m for m in result}
    assert by_month["2026-07"]["total_tasks"] == 1
    assert by_month["2026-07"]["completed_pct"] == 100
    assert by_month["2026-08"]["total_tasks"] == 2
    assert by_month["2026-08"]["completed_pct"] == 50


def test_monthly_history_counts_overdue_alta_priority(user):
    Task.objects.create(
        title="Vencida alta", priority="ALTA", frequency="PUNTUAL",
        start_date=datetime(2026, 8, 1, tzinfo=dt_timezone.utc), end_date=datetime(2026, 8, 1, tzinfo=dt_timezone.utc),
        estimated_hours=1, assigned_to=user, created_by=user, status=Task.Status.PENDIENTE,
    )
    result = compute_monthly_history(user=user, months_back=1, now=NOW)
    assert result[0]["overdue_count"] == 1
    assert result[0]["overdue_alta_count"] == 1


# --- compute_weekly_history ------------------------------------------------------


def test_weekly_history_business_days_excludes_weekend():
    result = compute_weekly_history(user=User.objects.create_user(username="empty", email="empty@example.com", password="Sup3r-Secr3t!"), weeks_back=1, now=NOW)
    assert result[0]["business_days"] == 5


def test_weekly_history_task_due_exactly_at_week_start_is_included(user):
    # Semana completa más reciente antes de la actual: lunes 2026-08-03.
    _task(user, end_date=datetime(2026, 8, 3, 0, 0, tzinfo=dt_timezone.utc))
    result = compute_weekly_history(user=user, weeks_back=1, now=NOW)
    assert result[0]["total_tasks"] == 1


def test_weekly_history_task_due_friday_after_midnight_is_excluded(user):
    # Cuantificación legacy: el límite superior de la semana es el viernes
    # 00:00 UTC exacto (no fin de día) — una tarea vencida el viernes a
    # cualquier hora después de medianoche queda fuera. Comportamiento
    # legacy replicado tal cual, no un bug a corregir.
    _task(user, end_date=datetime(2026, 8, 7, 10, 0, tzinfo=dt_timezone.utc))
    result = compute_weekly_history(user=user, weeks_back=1, now=NOW)
    assert result[0]["total_tasks"] == 0


def test_weekly_history_task_due_friday_at_midnight_is_included(user):
    _task(user, end_date=datetime(2026, 8, 7, 0, 0, tzinfo=dt_timezone.utc))
    result = compute_weekly_history(user=user, weeks_back=1, now=NOW)
    assert result[0]["total_tasks"] == 1


# --- compute_trends --------------------------------------------------------------


def test_trends_month_over_month_improvement(user):
    # Julio: 2 tareas, 1 completada (50%). Agosto (en curso): 2 tareas, ambas completadas (100%).
    _task(user, end_date=datetime(2026, 7, 10, tzinfo=dt_timezone.utc), status=Task.Status.COMPLETADA, completed_at=datetime(2026, 7, 10, tzinfo=dt_timezone.utc))
    _task(user, end_date=datetime(2026, 7, 20, tzinfo=dt_timezone.utc))
    _task(user, end_date=datetime(2026, 8, 5, tzinfo=dt_timezone.utc), status=Task.Status.COMPLETADA, completed_at=datetime(2026, 8, 5, tzinfo=dt_timezone.utc))
    _task(user, end_date=datetime(2026, 8, 10, tzinfo=dt_timezone.utc), status=Task.Status.COMPLETADA, completed_at=datetime(2026, 8, 10, tzinfo=dt_timezone.utc))

    trends = compute_trends(user=user, now=NOW)
    mes_anterior = trends["cumplimiento"]["mes_anterior"]
    assert mes_anterior["available"] is True
    assert mes_anterior["direction"] == "mejora"
    assert mes_anterior["current"] == 100
    assert mes_anterior["compared"] == 50


def test_trends_no_history_when_no_tasks(user):
    trends = compute_trends(user=user, now=NOW)
    assert trends["cumplimiento"]["mes_anterior"]["available"] is False
    # La carga SÍ se evalúa aunque no haya tareas/actividad: la base
    # horaria del mes (días hábiles × horas efectivas) es > 0 con
    # independencia de la actividad real -> compara 0% vs 0% ("estable").
    assert trends["carga"]["mes_anterior"] == {
        "available": True, "direction": "estable", "absolute_diff": 0, "pct_diff": 0, "current": 0, "compared": 0,
    }


# --- compute_effective_history_start --------------------------------------------


def test_effective_history_start_returns_user_created_at_with_no_other_signals():
    user = User.objects.create_user(username="fresh", email="fresh@example.com", password="Sup3r-Secr3t!")
    now = timezone.now()
    result = compute_effective_history_start(user=user, now=now)
    assert abs((result - user.created_at).total_seconds()) < 2


def test_effective_history_start_kpi_start_date_wins_when_more_recent():
    user = User.objects.create_user(username="kpi", email="kpi@example.com", password="Sup3r-Secr3t!")
    now = timezone.now()
    future_start = now + timedelta(days=1)
    user.kpi_start_date = future_start
    user.save()
    result = compute_effective_history_start(user=user, now=now)
    assert result == future_start


def test_effective_history_start_older_activity_never_wins_over_created_at():
    user = User.objects.create_user(username="old_act", email="old_act@example.com", password="Sup3r-Secr3t!")
    now = timezone.now()
    task = Task.objects.create(
        title="T", priority="MEDIA", frequency="PUNTUAL", start_date=now, end_date=now,
        estimated_hours=1, assigned_to=user, created_by=user,
    )
    activity = TaskActivity.objects.create(task=task, author=user, reason="R", duration=30)
    TaskActivity.objects.filter(pk=activity.pk).update(created_at=now - timedelta(days=365))

    result = compute_effective_history_start(user=user, now=now)
    assert abs((result - user.created_at).total_seconds()) < 2


def test_effective_history_start_most_recent_completed_task_wins():
    user = User.objects.create_user(username="recent_task", email="recent_task@example.com", password="Sup3r-Secr3t!")
    now = timezone.now()
    future_completed = now + timedelta(days=2)
    Task.objects.create(
        title="T", priority="MEDIA", frequency="PUNTUAL", start_date=now, end_date=now, estimated_hours=1,
        assigned_to=user, created_by=user, status=Task.Status.COMPLETADA, completed_at=future_completed,
    )
    result = compute_effective_history_start(user=user, now=now)
    assert result == future_completed
