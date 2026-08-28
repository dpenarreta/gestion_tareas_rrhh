"""Cobertura de apps.analytics.risk_alerts — Fase 4b (ver
docs/AUDIT_LOG.md § 2026-08-11)."""

from datetime import datetime
from datetime import timezone as dt_timezone

import pytest

from apps.analytics.risk_alerts import compute_risk_alerts
from apps.tasks.models import Task, TaskActivity
from apps.users.models import User

pytestmark = pytest.mark.django_db

NOW = datetime(2026, 1, 14, 10, 0, tzinfo=dt_timezone.utc)  # miércoles


@pytest.fixture
def user():
    return User.objects.create_user(username="target", email="target@example.com", password="Sup3r-Secr3t!")


def _task(user, *, end_date, status=Task.Status.PENDIENTE, priority="MEDIA") -> Task:
    return Task.objects.create(
        title="T", priority=priority, frequency="PUNTUAL", start_date=NOW, end_date=end_date,
        estimated_hours=1, assigned_to=user, created_by=user, status=status,
    )


def _activity_at(task: Task, user: User, created_at: datetime) -> TaskActivity:
    # `created_at` usa `auto_now_add=True` (ignora cualquier valor pasado a
    # `.create()`) — se retrasa con `.update()` después, mismo workaround
    # ya usado en Fase 3f para el registro retroactivo.
    activity = TaskActivity.objects.create(task=task, author=user, reason="R", duration=30)
    TaskActivity.objects.filter(pk=activity.pk).update(created_at=created_at)
    return activity


def test_no_alerts_for_user_without_tasks_or_activity(user):
    assert compute_risk_alerts(user=user, now=NOW, carga_label="Óptimo", carga_pct=80) == []


# --- Alerta 1: tareas vencidas -----------------------------------------------


def test_overdue_alert_triggers_at_threshold(user):
    for _ in range(3):
        _task(user, end_date=datetime(2026, 1, 10, tzinfo=dt_timezone.utc))
    alerts = compute_risk_alerts(user=user, now=NOW, carga_label="Óptimo", carga_pct=80)
    overdue_alerts = [a for a in alerts if "vencida" in a["message"]]
    assert len(overdue_alerts) == 1
    assert overdue_alerts[0]["severity"] == "yellow"


def test_overdue_alert_escalates_to_red_at_double_threshold(user):
    for _ in range(6):
        _task(user, end_date=datetime(2026, 1, 10, tzinfo=dt_timezone.utc))
    alerts = compute_risk_alerts(user=user, now=NOW, carga_label="Óptimo", carga_pct=80)
    overdue_alerts = [a for a in alerts if "vencida" in a["message"]]
    assert overdue_alerts[0]["severity"] == "red"


def test_overdue_alert_mentions_critical_alta_priority_tasks(user):
    for _ in range(2):
        _task(user, end_date=datetime(2026, 1, 10, tzinfo=dt_timezone.utc))
    _task(user, end_date=datetime(2026, 1, 10, tzinfo=dt_timezone.utc), priority="ALTA")
    alerts = compute_risk_alerts(user=user, now=NOW, carga_label="Óptimo", carga_pct=80)
    overdue_alerts = [a for a in alerts if "vencida" in a["message"]]
    assert "crítica" in overdue_alerts[0]["message"]


def test_below_threshold_no_overdue_alert(user):
    for _ in range(2):
        _task(user, end_date=datetime(2026, 1, 10, tzinfo=dt_timezone.utc))
    alerts = compute_risk_alerts(user=user, now=NOW, carga_label="Óptimo", carga_pct=80)
    assert not [a for a in alerts if "vencida" in a["message"]]


def test_completed_tasks_never_count_as_overdue(user):
    for _ in range(3):
        _task(user, end_date=datetime(2026, 1, 10, tzinfo=dt_timezone.utc), status=Task.Status.COMPLETADA)
    alerts = compute_risk_alerts(user=user, now=NOW, carga_label="Óptimo", carga_pct=80)
    assert not [a for a in alerts if "vencida" in a["message"]]


# --- Alerta 2: carga laboral --------------------------------------------------


@pytest.mark.parametrize("label,expected_severity", [("Sobrecarga", "red"), ("Carga elevada", "yellow")])
def test_carga_alert_for_overload_labels(user, label, expected_severity):
    alerts = compute_risk_alerts(user=user, now=NOW, carga_label=label, carga_pct=120)
    carga_alerts = [a for a in alerts if "carga laboral" in a["message"]]
    assert len(carga_alerts) == 1
    assert carga_alerts[0]["severity"] == expected_severity


@pytest.mark.parametrize("label", ["Óptimo", "Moderado", "Subutilización"])
def test_no_carga_alert_for_non_overload_labels(user, label):
    alerts = compute_risk_alerts(user=user, now=NOW, carga_label=label, carga_pct=50)
    assert not [a for a in alerts if "carga laboral" in a["message"]]


# --- Alerta 3: por vencer en 3 días -------------------------------------------


def test_due_soon_alert_for_tasks_within_3_days(user):
    _task(user, end_date=datetime(2026, 1, 16, tzinfo=dt_timezone.utc))  # +2 días
    alerts = compute_risk_alerts(user=user, now=NOW, carga_label="Óptimo", carga_pct=80)
    due_soon_alerts = [a for a in alerts if "próxima" in a["message"] or "próximas" in a["message"]]
    assert len(due_soon_alerts) == 1


def test_no_due_soon_alert_beyond_3_days(user):
    _task(user, end_date=datetime(2026, 1, 20, tzinfo=dt_timezone.utc))
    alerts = compute_risk_alerts(user=user, now=NOW, carga_label="Óptimo", carga_pct=80)
    assert not [a for a in alerts if "próxima" in a["message"]]


# --- Alerta 4: inactividad ----------------------------------------------------


def test_inactivity_alert_after_2_business_days_without_activity(user):
    task = _task(user, end_date=datetime(2026, 1, 20, tzinfo=dt_timezone.utc))
    _activity_at(task, user, datetime(2026, 1, 12, 9, 0, tzinfo=dt_timezone.utc))  # lunes
    alerts = compute_risk_alerts(user=user, now=NOW, carga_label="Óptimo", carga_pct=80)
    inactivity_alerts = [a for a in alerts if "Sin registro" in a["message"]]
    assert len(inactivity_alerts) == 1
    assert inactivity_alerts[0]["severity"] == "red"


def test_no_inactivity_alert_with_recent_activity(user):
    task = _task(user, end_date=datetime(2026, 1, 20, tzinfo=dt_timezone.utc))
    _activity_at(task, user, datetime(2026, 1, 13, 9, 0, tzinfo=dt_timezone.utc))  # martes (ayer)
    alerts = compute_risk_alerts(user=user, now=NOW, carga_label="Óptimo", carga_pct=80)
    assert not [a for a in alerts if "Sin registro" in a["message"]]


def test_no_inactivity_alert_if_never_logged_any_activity(user):
    _task(user, end_date=datetime(2026, 1, 20, tzinfo=dt_timezone.utc))
    alerts = compute_risk_alerts(user=user, now=NOW, carga_label="Óptimo", carga_pct=80)
    assert not [a for a in alerts if "Sin registro" in a["message"]]
