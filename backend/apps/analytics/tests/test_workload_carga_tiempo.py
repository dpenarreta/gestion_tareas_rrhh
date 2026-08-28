"""Cobertura de compute_carga_tiempo/compute_carga_history/
redact_sensitive_workload_detail — Fase 4b (ver docs/AUDIT_LOG.md §
2026-08-11)."""

from datetime import date, datetime
from datetime import timezone as dt_timezone

import pytest

from apps.analytics.workload import (
    compute_carga_history,
    compute_carga_tiempo,
    redact_sensitive_workload_detail,
)
from apps.configuration.models import Holiday, LeaveRecord, SpecialStatus
from apps.configuration.services import count_business_days
from apps.tasks.models import TaskActivity
from apps.users.models import User

pytestmark = pytest.mark.django_db

WEDNESDAY = datetime(2026, 1, 14, 10, 0, tzinfo=dt_timezone.utc)  # miércoles, día hábil sin permisos


@pytest.fixture
def admin():
    return User.objects.create_user(username="admin", email="admin@example.com", password="Sup3r-Secr3t!")


@pytest.fixture
def user():
    return User.objects.create_user(username="target", email="target@example.com", password="Sup3r-Secr3t!")


def _activity_at(user: User, created_at: datetime, duration: int = 60) -> TaskActivity:
    from apps.tasks.models import Task

    task = Task.objects.create(
        title="T", priority="MEDIA", frequency="PUNTUAL", start_date=created_at, end_date=created_at,
        estimated_hours=1, assigned_to=user, created_by=user,
    )
    activity = TaskActivity.objects.create(task=task, author=user, reason="R", duration=duration)
    TaskActivity.objects.filter(pk=activity.pk).update(created_at=created_at)
    return activity


# --- kpi_start_date ------------------------------------------------------------


def test_kpi_start_date_shrinks_monthly_window(user):
    user.kpi_start_date = datetime(2026, 1, 10, tzinfo=dt_timezone.utc)  # sábado, dentro de enero
    user.save()
    result = compute_carga_tiempo(user=user, now=WEDNESDAY)
    expected_business_days = count_business_days(date(2026, 1, 10), date(2026, 1, 31), set())
    assert result["kpi_start_date"] is not None
    assert result["mensual"]["business_days"] == expected_business_days


def test_no_kpi_start_date_uses_full_month(user):
    result = compute_carga_tiempo(user=user, now=WEDNESDAY)
    expected_business_days = count_business_days(date(2026, 1, 1), date(2026, 1, 31), set())
    assert result["kpi_start_date"] is None
    assert result["mensual"]["business_days"] == expected_business_days


# --- permisos vigentes hoy ------------------------------------------------------


def test_full_day_leave_today_zeroes_daily_base_hours(user, admin):
    LeaveRecord.objects.create(user=user, type=LeaveRecord.Type.MEDICO, date=date(2026, 1, 14), is_full_day=True, created_by=admin)
    result = compute_carga_tiempo(user=user, now=WEDNESDAY)
    assert result["diaria"]["base_hours"] == 0
    assert result["diaria"]["medico_leave_full_day"] is True


def test_partial_leave_today_reduces_daily_base_hours(user, admin):
    LeaveRecord.objects.create(
        user=user, type=LeaveRecord.Type.PERSONAL, date=date(2026, 1, 14), is_full_day=False,
        duration_minutes=120, created_by=admin,
    )
    result = compute_carga_tiempo(user=user, now=WEDNESDAY)
    without_leave = compute_carga_tiempo(user=User.objects.create_user(username="clean", email="clean@example.com"), now=WEDNESDAY)
    assert result["diaria"]["base_hours"] < without_leave["diaria"]["base_hours"]


# --- estado especial vigente hoy ------------------------------------------------


def test_special_status_today_overrides_daily_hours(user, admin):
    SpecialStatus.objects.create(
        user=user, type=SpecialStatus.Type.MATERNIDAD, start_date=date(2026, 1, 14), end_date=date(2026, 1, 14),
        daily_hours=4, limit_low=2, limit_base=4, limit_high=5, limit_overload=6, created_by=admin,
    )
    result = compute_carga_tiempo(user=user, now=WEDNESDAY)
    assert result["effective_hours_per_dia"] == 4
    assert result["diaria"]["base_hours"] == 4
    assert result["diaria"]["special_status_type"] == "MATERNIDAD"


# --- fin de semana/feriado: sin semáforo ---------------------------------------


def test_weekend_today_has_no_semaphore_even_with_logged_hours(user):
    saturday = datetime(2026, 1, 17, 10, 0, tzinfo=dt_timezone.utc)
    _activity_at(user, datetime(2026, 1, 17, 10, 0, tzinfo=dt_timezone.utc), duration=60)
    result = compute_carga_tiempo(user=user, now=saturday)
    assert result["diaria"]["is_weekend"] is True
    assert result["diaria"]["base_hours"] == 0
    assert result["diaria"]["color"] == "green"
    assert result["diaria"]["real_hours"] == 1.0


def test_holiday_today_has_no_semaphore(user, admin):
    Holiday.objects.create(date=date(2026, 1, 14), name="Feriado de prueba", year=2026)
    result = compute_carga_tiempo(user=user, now=WEDNESDAY)
    assert result["diaria"]["is_holiday"] is True
    assert result["diaria"]["base_hours"] == 0
    assert result["diaria"]["color"] == "green"


# --- compute_carga_history: clasificación por día -------------------------------


def test_carga_history_skips_empty_weekends_but_keeps_empty_business_days(user):
    monday = datetime(2026, 1, 5, 10, 0, tzinfo=dt_timezone.utc)
    result = compute_carga_history(user=user, now=monday)
    # Enero 1 (jue), 2 (vie), 5 (lun) son hábiles sin actividad -> "empty".
    # 3 (sáb) y 4 (dom) sin actividad quedan fuera de la serie.
    assert {p["date"] for p in result["daily"]} == {"2026-01-01", "2026-01-02", "2026-01-05"}
    assert all(p["kind"] == "empty" for p in result["daily"])


def test_carga_history_weekend_with_activity_is_weekend_extra(user):
    monday = datetime(2026, 1, 5, 10, 0, tzinfo=dt_timezone.utc)
    _activity_at(user, datetime(2026, 1, 3, 10, 0, tzinfo=dt_timezone.utc), duration=60)  # sábado
    result = compute_carga_history(user=user, now=monday)
    saturday_entry = next(p for p in result["daily"] if p["date"] == "2026-01-03")
    assert saturday_entry["kind"] == "weekend-extra"
    assert saturday_entry["real_hours"] == 1.0


def test_carga_history_holiday_kind(user):
    Holiday.objects.create(date=date(2026, 1, 2), name="Feriado de prueba", year=2026)
    monday = datetime(2026, 1, 5, 10, 0, tzinfo=dt_timezone.utc)
    result = compute_carga_history(user=user, now=monday)
    holiday_entry = next(p for p in result["daily"] if p["date"] == "2026-01-02")
    assert holiday_entry["kind"] == "holiday"


def test_carga_history_full_day_leave_kind(user, admin):
    LeaveRecord.objects.create(user=user, type=LeaveRecord.Type.MEDICO, date=date(2026, 1, 2), is_full_day=True, created_by=admin)
    monday = datetime(2026, 1, 5, 10, 0, tzinfo=dt_timezone.utc)
    result = compute_carga_history(user=user, now=monday)
    leave_entry = next(p for p in result["daily"] if p["date"] == "2026-01-02")
    assert leave_entry["kind"] == "leave-medico"


# --- redact_sensitive_workload_detail --------------------------------------------


def test_redact_collapses_medical_detail_into_generic_personal(user, admin):
    LeaveRecord.objects.create(user=user, type=LeaveRecord.Type.MEDICO, date=date(2026, 1, 14), is_full_day=False, duration_minutes=90, created_by=admin)
    carga_tiempo = compute_carga_tiempo(user=user, now=WEDNESDAY)
    carga_tiempo["daily_history"] = []
    carga_tiempo["weekly_history"] = []
    redacted = redact_sensitive_workload_detail(carga_tiempo)
    assert redacted["diaria"]["medico_leave_minutes"] == 0
    assert redacted["diaria"]["personal_leave_minutes"] == 90
    assert redacted["sensitive_detail_visible"] is False


def test_redact_hides_special_status_type(user, admin):
    SpecialStatus.objects.create(
        user=user, type=SpecialStatus.Type.LACTANCIA, start_date=date(2026, 1, 14), end_date=date(2026, 1, 14),
        daily_hours=4, limit_low=2, limit_base=4, limit_high=5, limit_overload=6, created_by=admin,
    )
    carga_tiempo = compute_carga_tiempo(user=user, now=WEDNESDAY)
    carga_tiempo["daily_history"] = []
    carga_tiempo["weekly_history"] = []
    redacted = redact_sensitive_workload_detail(carga_tiempo)
    assert redacted["diaria"]["special_status_type"] is None
    assert redacted["semanal"]["special_status_type"] is None
    assert redacted["mensual"]["special_status_type"] is None
