"""Cobertura de apps.analytics.capacity_forecast — Fase 4f (ver
docs/AUDIT_LOG.md § 2026-08-11)."""

from datetime import date, datetime
from datetime import timezone as dt_timezone

import pytest

from apps.analytics.capacity_forecast import (
    classify_capacity,
    compute_capacity_forecast,
    compute_team_capacity_forecast,
)
from apps.configuration.models import Holiday, SystemConfigHistory
from apps.configuration.services import (
    count_business_days,
    get_effective_workday_end_hour,
    get_holiday_set,
)
from apps.tasks.models import Task
from apps.users.models import User

pytestmark = pytest.mark.django_db

# Miércoles — antes de las 17:00 huso de negocio (10:00 UTC - 5h = 05:00 local).
NOW_MORNING = datetime(2026, 8, 12, 10, 0, tzinfo=dt_timezone.utc)
# Mismo día, después de las 17:00 huso de negocio (23:00 UTC - 5h = 18:00 local).
NOW_AFTER_WORKDAY = datetime(2026, 8, 12, 23, 0, tzinfo=dt_timezone.utc)


@pytest.fixture
def user():
    return User.objects.create_user(username="target", email="target@example.com", password="Sup3r-Secr3t!")


def _task(user, *, status, start_date, end_date, estimated_hours=5, target_time_validated=None, real_hours=0.0) -> Task:
    return Task.objects.create(
        title="T", priority="MEDIA", frequency="PUNTUAL", start_date=start_date, end_date=end_date,
        estimated_hours=estimated_hours, target_time_validated=target_time_validated, real_hours=real_hours,
        assigned_to=user, created_by=user, status=status,
    )


# --- get_effective_workday_end_hour ----------------------------------------------


def test_get_effective_workday_end_hour_default_is_17():
    assert get_effective_workday_end_hour(NOW_MORNING) == 17


def test_get_effective_workday_end_hour_respects_override(user):
    SystemConfigHistory.objects.create(
        key="capacity_workday_end_hour_local", value="19", valid_from=datetime(2020, 1, 1, tzinfo=dt_timezone.utc), updated_by=user
    )
    assert get_effective_workday_end_hour(NOW_MORNING) == 19


# --- classify_capacity ----------------------------------------------------------


def test_classify_capacity_no_planning_when_base_is_zero_or_negative():
    assert classify_capacity(0, 0, 0)["estado"] == "sin-planificacion"
    assert classify_capacity(5, -1, 500)["estado"] == "sin-planificacion"


def test_classify_capacity_overload_when_disponible_negative():
    result = classify_capacity(-5, 40, -12)
    assert result == {"estado": "sobrecarga", "estado_color": "red", "estado_label": "Sobrecarga proyectada: -5h"}


def test_classify_capacity_high_above_20_pct():
    assert classify_capacity(10, 40, 25)["estado"] == "alta"


def test_classify_capacity_limited_between_10_and_20_pct():
    assert classify_capacity(4, 40, 10)["estado"] == "limitada"
    assert classify_capacity(8, 40, 20)["estado"] == "limitada"


def test_classify_capacity_do_not_assign_below_10_pct():
    assert classify_capacity(2, 40, 5)["estado"] == "no-asignar"


# --- compute_team_capacity_forecast ----------------------------------------------


def test_empty_user_ids_returns_empty_dict():
    assert compute_team_capacity_forecast(user_ids=[], now=NOW_MORNING) == {}


def test_no_tasks_and_no_holidays_configured_has_full_capacity_and_penalized_confidence(user):
    result = compute_team_capacity_forecast(user_ids=[user.id], now=NOW_MORNING)[user.id]
    assert result["comprometido_futuro"] == 0
    assert result["disponible"] == result["base_futura_total"]
    assert result["estado"] == "alta"
    assert result["confiabilidad"]["holidays_configured"] is False
    assert result["confiabilidad"]["pct"] == 97  # 100 - 0*5 - 3 (feriados no configurados)


def test_holidays_configured_removes_that_confidence_penalty(user):
    Holiday.objects.create(date=date(2026, 1, 1), name="Año Nuevo", year=2026)
    result = compute_team_capacity_forecast(user_ids=[user.id], now=NOW_MORNING)[user.id]
    assert result["confiabilidad"]["holidays_configured"] is True
    assert result["confiabilidad"]["pct"] == 100


def test_workday_ended_zeroes_horas_restantes_hoy(user):
    morning = compute_team_capacity_forecast(user_ids=[user.id], now=NOW_MORNING)[user.id]
    evening = compute_team_capacity_forecast(user_ids=[user.id], now=NOW_AFTER_WORKDAY)[user.id]
    assert morning["horas_restantes_hoy"] > 0
    assert evening["horas_restantes_hoy"] == 0


def test_dias_laborables_restantes_matches_count_business_days(user):
    result = compute_team_capacity_forecast(user_ids=[user.id], now=NOW_MORNING)[user.id]
    holidays = get_holiday_set()
    expected = count_business_days(date(2026, 8, 13), date(2026, 8, 31), holidays)
    assert result["dias_laborables_restantes"] == expected


def test_en_progreso_task_commits_official_target_minus_real_hours(user):
    _task(
        user, status=Task.Status.EN_PROGRESO, start_date=datetime(2026, 8, 1, tzinfo=dt_timezone.utc),
        end_date=datetime(2026, 8, 20, tzinfo=dt_timezone.utc), estimated_hours=10, real_hours=3,
    )
    result = compute_team_capacity_forecast(user_ids=[user.id], now=NOW_MORNING)[user.id]
    assert result["comprometido_en_progreso"] == 7.0
    assert result["comprometido_futuro"] == 7.0
    assert result["tasks_sin_estimar"] == 0


def test_en_progreso_uses_validated_target_time_over_initial(user):
    _task(
        user, status=Task.Status.EN_PROGRESO, start_date=datetime(2026, 8, 1, tzinfo=dt_timezone.utc),
        end_date=datetime(2026, 8, 20, tzinfo=dt_timezone.utc), estimated_hours=10, target_time_validated=6, real_hours=2,
    )
    result = compute_team_capacity_forecast(user_ids=[user.id], now=NOW_MORNING)[user.id]
    assert result["comprometido_en_progreso"] == 4.0


def test_task_without_target_time_counts_as_sin_estimar_and_not_committed(user):
    _task(
        user, status=Task.Status.EN_PROGRESO, start_date=datetime(2026, 8, 1, tzinfo=dt_timezone.utc),
        end_date=datetime(2026, 8, 20, tzinfo=dt_timezone.utc), estimated_hours=0,
    )
    result = compute_team_capacity_forecast(user_ids=[user.id], now=NOW_MORNING)[user.id]
    assert result["comprometido_en_progreso"] == 0
    assert result["tasks_sin_estimar"] == 1
    assert result["confiabilidad"]["pct"] == 92  # 100 - 1*5 - 3 (feriados no configurados)


def test_pendiente_task_within_window_is_committed(user):
    _task(
        user, status=Task.Status.PENDIENTE, start_date=datetime(2026, 8, 1, tzinfo=dt_timezone.utc),
        end_date=datetime(2026, 8, 20, tzinfo=dt_timezone.utc), estimated_hours=8,
    )
    result = compute_team_capacity_forecast(user_ids=[user.id], now=NOW_MORNING)[user.id]
    assert result["comprometido_pendiente"] == 8.0


def test_pendiente_task_already_overdue_before_today_is_excluded(user):
    # end_date < hoy (2026-08-12) -> ya vencida, no es "compromiso futuro".
    _task(
        user, status=Task.Status.PENDIENTE, start_date=datetime(2026, 8, 1, tzinfo=dt_timezone.utc),
        end_date=datetime(2026, 8, 5, tzinfo=dt_timezone.utc), estimated_hours=8,
    )
    result = compute_team_capacity_forecast(user_ids=[user.id], now=NOW_MORNING)[user.id]
    assert result["comprometido_pendiente"] == 0


def test_pendiente_task_starting_next_month_is_excluded(user):
    _task(
        user, status=Task.Status.PENDIENTE, start_date=datetime(2026, 9, 1, tzinfo=dt_timezone.utc),
        end_date=datetime(2026, 9, 10, tzinfo=dt_timezone.utc), estimated_hours=8,
    )
    result = compute_team_capacity_forecast(user_ids=[user.id], now=NOW_MORNING)[user.id]
    assert result["comprometido_pendiente"] == 0


def test_disponible_pct_capped_calculation_and_overload(user):
    # 1 tarea EN_PROGRESO enorme para forzar sobrecarga (comprometido > base futura).
    _task(
        user, status=Task.Status.EN_PROGRESO, start_date=datetime(2026, 8, 1, tzinfo=dt_timezone.utc),
        end_date=datetime(2026, 8, 20, tzinfo=dt_timezone.utc), estimated_hours=1000, real_hours=0,
    )
    result = compute_team_capacity_forecast(user_ids=[user.id], now=NOW_MORNING)[user.id]
    assert result["disponible"] < 0
    assert result["estado"] == "sobrecarga"


def test_multiple_users_processed_independently(user):
    other = User.objects.create_user(username="other", email="other@example.com", password="Sup3r-Secr3t!")
    _task(
        user, status=Task.Status.EN_PROGRESO, start_date=datetime(2026, 8, 1, tzinfo=dt_timezone.utc),
        end_date=datetime(2026, 8, 20, tzinfo=dt_timezone.utc), estimated_hours=10, real_hours=0,
    )
    results = compute_team_capacity_forecast(user_ids=[user.id, other.id], now=NOW_MORNING)
    assert results[user.id]["comprometido_futuro"] == 10.0
    assert results[other.id]["comprometido_futuro"] == 0.0


# --- compute_capacity_forecast (wrapper de 1 usuario) ----------------------------


def test_compute_capacity_forecast_matches_team_forecast_for_that_user(user):
    _task(
        user, status=Task.Status.PENDIENTE, start_date=datetime(2026, 8, 1, tzinfo=dt_timezone.utc),
        end_date=datetime(2026, 8, 20, tzinfo=dt_timezone.utc), estimated_hours=8,
    )
    single = compute_capacity_forecast(user=user, now=NOW_MORNING)
    team = compute_team_capacity_forecast(user_ids=[user.id], now=NOW_MORNING)[user.id]
    assert single == team
