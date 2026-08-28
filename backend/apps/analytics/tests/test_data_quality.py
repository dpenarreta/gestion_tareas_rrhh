"""Cobertura de compute_data_quality/compute_target_time_precision —
Fase 4d (ver docs/AUDIT_LOG.md § 2026-08-11)."""

from datetime import datetime, timedelta
from datetime import timezone as dt_timezone

import pytest

from apps.analytics.scoring import compute_data_quality, compute_target_time_precision
from apps.configuration.models import SystemConfigHistory
from apps.configuration.services import CONFIG_KEY_HORAS_EFECTIVAS
from apps.tasks.models import Task, TaskActivity
from apps.users.models import User

pytestmark = pytest.mark.django_db

NOW = datetime(2026, 8, 12, 10, 0, tzinfo=dt_timezone.utc)


@pytest.fixture
def user():
    return User.objects.create_user(username="target", email="target@example.com", password="Sup3r-Secr3t!")


@pytest.fixture
def admin():
    return User.objects.create_user(username="admin", email="admin@example.com", password="Sup3r-Secr3t!")


def _seed_horas_efectivas(admin):
    SystemConfigHistory.objects.create(
        key=CONFIG_KEY_HORAS_EFECTIVAS, value="8.0", valid_from=datetime(2020, 1, 1, tzinfo=dt_timezone.utc), updated_by=admin
    )


# --- compute_data_quality ---------------------------------------------------------


def test_data_quality_empty_user_list_is_perfect():
    assert compute_data_quality(user_ids=[]) == {"pct": 100, "issues": []}


def test_data_quality_no_issues_when_everything_is_clean(user, admin):
    _seed_horas_efectivas(admin)
    Task.objects.create(
        title="T", priority="MEDIA", frequency="PUNTUAL", start_date=NOW, end_date=NOW + timedelta(days=1),
        estimated_hours=5, assigned_to=user, created_by=user, status=Task.Status.PENDIENTE,
    )
    result = compute_data_quality(user_ids=[user.id])
    assert result["issues"] == []
    assert result["pct"] == 100


def test_data_quality_flags_task_without_estimate(user, admin):
    _seed_horas_efectivas(admin)
    Task.objects.create(
        title="T", priority="MEDIA", frequency="PUNTUAL", start_date=NOW, end_date=NOW,
        estimated_hours=0, assigned_to=user, created_by=user, status=Task.Status.PENDIENTE,
    )
    result = compute_data_quality(user_ids=[user.id])
    keys = {i["key"] for i in result["issues"]}
    assert "sin_estimar" in keys
    assert result["pct"] == 97


def test_data_quality_flags_inconsistent_dates(user, admin):
    _seed_horas_efectivas(admin)
    Task.objects.create(
        title="T", priority="MEDIA", frequency="PUNTUAL", start_date=NOW, end_date=NOW - timedelta(days=1),
        estimated_hours=1, assigned_to=user, created_by=user, status=Task.Status.PENDIENTE,
    )
    result = compute_data_quality(user_ids=[user.id])
    keys = {i["key"] for i in result["issues"]}
    assert "fechas_inconsistentes" in keys


def test_data_quality_flags_seguimiento_without_activity(user, admin):
    _seed_horas_efectivas(admin)
    Task.objects.create(
        title="Seguimiento", priority="MEDIA", frequency="PUNTUAL", type=Task.Type.SEGUIMIENTO,
        start_date=NOW, end_date=NOW, estimated_hours=1, assigned_to=user, created_by=user,
    )
    result = compute_data_quality(user_ids=[user.id])
    keys = {i["key"] for i in result["issues"]}
    assert "seguimiento_sin_actividad" in keys


def test_data_quality_seguimiento_with_activity_is_not_flagged(user, admin):
    _seed_horas_efectivas(admin)
    task = Task.objects.create(
        title="Seguimiento", priority="MEDIA", frequency="PUNTUAL", type=Task.Type.SEGUIMIENTO,
        start_date=NOW, end_date=NOW, estimated_hours=1, assigned_to=user, created_by=user,
    )
    TaskActivity.objects.create(task=task, author=user, reason="R", duration=30)
    result = compute_data_quality(user_ids=[user.id])
    keys = {i["key"] for i in result["issues"]}
    assert "seguimiento_sin_actividad" not in keys


def test_data_quality_flags_missing_horas_config(user):
    result = compute_data_quality(user_ids=[user.id])
    keys = {i["key"] for i in result["issues"]}
    assert "sin_horas_config" in keys


# --- compute_target_time_precision -----------------------------------------------


def test_target_time_precision_unavailable_without_completed_tasks(user):
    result = compute_target_time_precision(user=user, now=NOW)
    assert result["available"] is False


def test_target_time_precision_unavailable_when_no_target_time(user):
    Task.objects.create(
        title="T", priority="MEDIA", frequency="PUNTUAL", start_date=NOW, end_date=NOW,
        estimated_hours=0, real_hours=3, assigned_to=user, created_by=user,
        status=Task.Status.COMPLETADA, completed_at=NOW,
    )
    result = compute_target_time_precision(user=user, now=NOW)
    assert result["available"] is False


def test_target_time_precision_perfect_match(user):
    Task.objects.create(
        title="T", priority="MEDIA", frequency="PUNTUAL", start_date=NOW, end_date=NOW,
        estimated_hours=5, real_hours=5, assigned_to=user, created_by=user,
        status=Task.Status.COMPLETADA, completed_at=NOW,
    )
    result = compute_target_time_precision(user=user, now=NOW)
    assert result["available"] is True
    assert result["avg_precision_pct"] == 100.0
    assert result["classification"] == "Excelente"
    assert result["sample_size"] == 1
    assert result["validated_pct"] == 0


def test_target_time_precision_uses_validated_over_initial(user):
    Task.objects.create(
        title="T", priority="MEDIA", frequency="PUNTUAL", start_date=NOW, end_date=NOW,
        estimated_hours=10, target_time_validated=5, real_hours=5, assigned_to=user, created_by=user,
        status=Task.Status.COMPLETADA, completed_at=NOW,
    )
    result = compute_target_time_precision(user=user, now=NOW)
    assert result["avg_precision_pct"] == 100.0
    assert result["validated_pct"] == 100
