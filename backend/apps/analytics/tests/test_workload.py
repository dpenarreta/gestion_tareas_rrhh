"""Cobertura de la base horaria del motor de KPIs/Analytics — Fase 4a
(ver docs/AUDIT_LOG.md § 2026-08-11)."""

from datetime import date, datetime
from datetime import timezone as dt_timezone

import pytest

from apps.analytics.workload import (
    compute_workload_pct,
    compute_workload_range,
    get_month_closure_period,
    monthly_business_base,
    sum_weighted_base_hours,
    sum_weighted_limit,
)
from apps.configuration.models import SystemConfigHistory
from apps.configuration.services import CONFIG_KEY_HORAS_EFECTIVAS
from apps.tasks.models import MonthClosure
from apps.users.models import User

pytestmark = pytest.mark.django_db


@pytest.fixture
def admin():
    return User.objects.create_user(username="admin", email="admin@example.com", password="Sup3r-Secr3t!")


def _seed_horas_efectivas(value: str, admin: User) -> None:
    SystemConfigHistory.objects.create(
        key=CONFIG_KEY_HORAS_EFECTIVAS, value=value,
        valid_from=datetime(2020, 1, 1, tzinfo=dt_timezone.utc), updated_by=admin,
    )


# --- sum_weighted_base_hours / sum_weighted_limit ---------------------------


def test_sum_weighted_base_hours_skips_weekends_and_holidays():
    # 2026-01-05 (lun) .. 2026-01-09 (vie): 5 días hábiles, sin feriados.
    total = sum_weighted_base_hours(date(2026, 1, 5), date(2026, 1, 9), 8.0, set(), {})
    assert total == 40.0


def test_sum_weighted_base_hours_excludes_holiday():
    holidays = {date(2026, 1, 8)}  # jueves feriado dentro de la semana
    total = sum_weighted_base_hours(date(2026, 1, 5), date(2026, 1, 9), 8.0, holidays, {})
    assert total == 32.0  # 4 días hábiles restantes


def test_sum_weighted_base_hours_deducts_full_day_leave():
    leave_map = {date(2026, 1, 5): {"medico_full_day": True, "medico_minutes": 0, "personal_minutes": 0, "personal_full_day": False, "vacaciones_full_day": False}}
    total = sum_weighted_base_hours(date(2026, 1, 5), date(2026, 1, 9), 8.0, set(), leave_map)
    assert total == 32.0  # lunes descontado completo


def test_sum_weighted_base_hours_uses_special_status_field():
    special_map = {date(2026, 1, 5): {"type": "MATERNIDAD", "daily_hours": 4, "limit_low": 2, "limit_base": 4, "limit_high": 5, "limit_overload": 6}}
    total = sum_weighted_base_hours(date(2026, 1, 5), date(2026, 1, 9), 8.0, set(), {}, special_map, field="daily_hours")
    assert total == 4 + 4 * 8.0  # lunes con 4h en vez de 8h


def test_sum_weighted_limit_uses_global_or_special_override():
    special_map = {date(2026, 1, 5): {"limit_low": 2, "limit_high": 5, "limit_overload": 6, "daily_hours": 4, "limit_base": 4}}
    total = sum_weighted_limit(date(2026, 1, 5), date(2026, 1, 9), set(), special_map, global_limit_per_day=5.5, field="limit_low")
    assert total == 2 + 4 * 5.5


# --- compute_workload_range --------------------------------------------------


def test_workload_range_zero_base_hours_no_activity_is_optimo():
    result = compute_workload_range(0, base_hours=0, limit_low=5, limit_high=7, limit_overload=8)
    assert result["color"] == "green" and result["label"] == "Óptimo"


def test_workload_range_zero_base_hours_with_activity_is_carga_elevada():
    result = compute_workload_range(3, base_hours=0, limit_low=5, limit_high=7, limit_overload=8)
    assert result["color"] == "orange" and result["label"] == "Carga elevada"


def test_workload_range_five_zones():
    args = dict(base_hours=32, limit_low=22, limit_high=36, limit_overload=42)
    assert compute_workload_range(20, **args)["label"] == "Subutilización"
    assert compute_workload_range(25, **args)["label"] == "Moderado"
    assert compute_workload_range(34, **args)["label"] == "Óptimo"
    assert compute_workload_range(40, **args)["label"] == "Carga elevada"
    assert compute_workload_range(50, **args)["label"] == "Sobrecarga"


# --- compute_workload_pct ----------------------------------------------------


def test_workload_pct_zero_base_hours():
    assert compute_workload_pct(5, base_hours=0, optimal_max=7) == 0


def test_workload_pct_linear_up_to_base():
    assert compute_workload_pct(16, base_hours=32, optimal_max=36) == 50


def test_workload_pct_capped_at_100_within_optimal_zone():
    assert compute_workload_pct(34, base_hours=32, optimal_max=36) == 100


def test_workload_pct_grows_again_past_optimal_max():
    # 7.667h con límite óptimo 7.5h ~ 102%, mismo ejemplo que el comentario legacy.
    pct = compute_workload_pct(7.667, base_hours=6.5, optimal_max=7.5)
    assert pct == 102


# --- monthly_business_base / get_month_closure_period ------------------------


def test_month_closure_period_without_closure_uses_natural_end():
    closure, natural_end, effective_end = get_month_closure_period(2026, 1)
    assert closure is None
    assert natural_end == date(2026, 1, 31)
    assert effective_end == natural_end


def test_monthly_business_base_full_month_without_closure(admin):
    _seed_horas_efectivas("8.0", admin)
    result = monthly_business_base(2026, 1)
    # Enero 2026: 31 días, feriados/fin de semana según calendario real (sin feriados sembrados).
    assert result["hours_per_day"] == 8.0
    assert result["business_days"] > 0


def test_monthly_business_base_truncated_by_early_closure(admin):
    _seed_horas_efectivas("8.0", admin)
    MonthClosure.objects.create(
        month=1, year=2026, closed_by=admin,
        cutoff_date=datetime(2026, 1, 9, tzinfo=dt_timezone.utc), closure_type="EARLY",
        calendar_days_total=31, calendar_days_considered=9, working_days_considered=6,
        working_hours_considered=48.0, total_tasks=0, completed_tasks=0, summary={},
    )

    closure, natural_end, effective_end = get_month_closure_period(2026, 1)
    result = monthly_business_base(2026, 1)

    assert closure is not None
    assert natural_end == date(2026, 1, 31)
    assert effective_end == date(2026, 1, 9)
    # 1..9 enero: hábiles = 2,5,6,7,8,9 = 6 (1 es feriado solo si está sembrado; sin
    # feriados sembrados en este test, el 1 de enero SÍ cuenta como hábil -> 7 días).
    assert result["business_days"] == 7
    assert result["base_hours"] == 56.0
