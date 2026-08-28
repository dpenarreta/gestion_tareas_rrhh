"""Cobertura de compute_consistency y sus clasificadores puros — Fase 4d
(ver docs/AUDIT_LOG.md § 2026-08-11)."""

from datetime import datetime, timedelta
from datetime import timezone as dt_timezone

import pytest

from apps.analytics.history import (
    compute_consistency,
    consistency_level_from_cv,
    consistency_pct_from_cv,
    consistency_reliability_from_weeks,
)
from apps.configuration.models import LeaveRecord
from apps.tasks.models import Task, TaskActivity
from apps.users.models import User

pytestmark = pytest.mark.django_db

NOW = datetime(2026, 8, 12, 10, 0, tzinfo=dt_timezone.utc)  # miércoles


@pytest.fixture
def user():
    user = User.objects.create_user(username="target", email="target@example.com", password="Sup3r-Secr3t!")
    # `created_at` es `auto_now_add` -> queda en el reloj real de la
    # máquina, no en `NOW` (2026-08-12). Se retrasa para que
    # `compute_effective_history_start` no lo elija por sobre las
    # semanas sintéticas de estos tests (mismo workaround que
    # `_activity_at` usa para `TaskActivity.created_at`).
    User.objects.filter(pk=user.pk).update(created_at=datetime(2020, 1, 1, tzinfo=dt_timezone.utc))
    user.refresh_from_db()
    return user


@pytest.fixture
def admin():
    return User.objects.create_user(username="admin", email="admin@example.com", password="Sup3r-Secr3t!")


def _activity_at(user: User, created_at: datetime, duration: int = 60) -> TaskActivity:
    task = Task.objects.create(
        title="T", priority="MEDIA", frequency="PUNTUAL", start_date=created_at, end_date=created_at,
        estimated_hours=1, assigned_to=user, created_by=user,
    )
    activity = TaskActivity.objects.create(task=task, author=user, reason="R", duration=duration)
    TaskActivity.objects.filter(pk=activity.pk).update(created_at=created_at)
    return activity


# --- clasificadores puros ------------------------------------------------------


def test_consistency_level_from_cv_thresholds():
    assert consistency_level_from_cv(5)["level"] == "muy-consistente"
    assert consistency_level_from_cv(15)["level"] == "consistente"
    assert consistency_level_from_cv(30)["level"] == "variable"
    assert consistency_level_from_cv(50)["level"] == "muy-variable"


def test_consistency_pct_from_cv_zero_cv_is_100():
    assert consistency_pct_from_cv(0) == 100.0


def test_consistency_pct_from_cv_higher_cv_lowers_pct():
    assert consistency_pct_from_cv(100) == 50.0


def test_consistency_reliability_from_weeks_thresholds():
    assert consistency_reliability_from_weeks(4)["level"] == "baja"
    assert consistency_reliability_from_weeks(8)["level"] == "media"
    assert consistency_reliability_from_weeks(12)["level"] == "alta"
    assert consistency_reliability_from_weeks(13)["level"] == "muy-alta"


# --- compute_consistency --------------------------------------------------------


def test_consistency_unavailable_with_no_history(user):
    result = compute_consistency(user=user, now=NOW)
    assert result["available"] is False


def test_consistency_available_with_2_valid_weeks_of_real_activity(user):
    # 2 semanas hábiles recientes con actividad registrada todos los días
    # laborables (lunes a viernes) -> ambas cuentan como válidas.
    for week_monday in (datetime(2026, 7, 27, tzinfo=dt_timezone.utc), datetime(2026, 8, 3, tzinfo=dt_timezone.utc)):
        for offset in range(5):
            _activity_at(user, week_monday + timedelta(days=offset, hours=10), duration=60)

    result = compute_consistency(user=user, now=NOW)
    assert result["available"] is True
    assert result["weeks_analyzed"] == 2
    assert result["reliability"]["level"] == "baja"


def test_consistency_excludes_week_fully_on_medical_leave(user, admin):
    week_monday = datetime(2026, 8, 3, tzinfo=dt_timezone.utc)
    for offset in range(5):
        LeaveRecord.objects.create(
            user=user, type=LeaveRecord.Type.MEDICO, date=(week_monday + timedelta(days=offset)).date(),
            is_full_day=True, created_by=admin,
        )
    # Otra semana con actividad real para que no falte por historial insuficiente.
    other_week = datetime(2026, 7, 20, tzinfo=dt_timezone.utc)
    for offset in range(5):
        _activity_at(user, other_week + timedelta(days=offset, hours=10), duration=60)

    result = compute_consistency(user=user, now=NOW)
    # La semana en permiso médico completo nunca tuvo registros -> se
    # excluye por "sin registros" antes de llegar a evaluar el permiso
    # (misma condición legacy: `daysWithRegistration === 0` corta primero).
    excluded_reasons = {p["reason"] for p in result["explain"]["periods_excluded"]} if result["available"] else set()
    assert result["available"] is False or "Sin registros esa semana" in excluded_reasons


def test_consistency_days_analyzed_matches_registered_days(user):
    week_monday = datetime(2026, 7, 27, tzinfo=dt_timezone.utc)
    for offset in range(5):
        _activity_at(user, week_monday + timedelta(days=offset, hours=10), duration=30)
    other_week = datetime(2026, 8, 3, tzinfo=dt_timezone.utc)
    for offset in range(5):
        _activity_at(user, other_week + timedelta(days=offset, hours=10), duration=30)

    result = compute_consistency(user=user, now=NOW)
    assert result["available"] is True
    assert result["days_analyzed"] == 10
