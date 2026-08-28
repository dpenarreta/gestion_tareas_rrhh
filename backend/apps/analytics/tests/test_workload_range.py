"""Cobertura de monthly_business_base_for_users — Fase 4c (ver
docs/AUDIT_LOG.md § 2026-08-11)."""

from datetime import date

import pytest

from apps.analytics.workload import monthly_business_base, monthly_business_base_for_users
from apps.configuration.models import SpecialStatus
from apps.users.models import User

pytestmark = pytest.mark.django_db


@pytest.fixture
def admin():
    return User.objects.create_user(username="admin", email="admin@example.com", password="Sup3r-Secr3t!")


@pytest.fixture
def user_a():
    return User.objects.create_user(username="user_a", email="user_a@example.com", password="Sup3r-Secr3t!")


@pytest.fixture
def user_b():
    return User.objects.create_user(username="user_b", email="user_b@example.com", password="Sup3r-Secr3t!")


def test_no_special_status_returns_empty_per_user(user_a, user_b):
    result = monthly_business_base_for_users([user_a, user_b], 2026, 1)
    assert result["per_user"] == {}
    assert result["shared"]["start"] == date(2026, 1, 1)
    assert result["shared"]["end"] == date(2026, 1, 31)


def test_shared_matches_single_month_business_base(user_a):
    shared = monthly_business_base_for_users([user_a], 2026, 1)["shared"]
    single = monthly_business_base(2026, 1)
    assert shared["base_hours"] == single["base_hours"]
    assert shared["business_days"] == single["business_days"]


def test_special_status_overrides_only_that_user(user_a, user_b, admin):
    SpecialStatus.objects.create(
        user=user_a, type=SpecialStatus.Type.MATERNIDAD, start_date=date(2026, 1, 1), end_date=date(2026, 1, 31),
        daily_hours=4, limit_low=2, limit_base=4, limit_high=5, limit_overload=6, created_by=admin,
    )
    result = monthly_business_base_for_users([user_a, user_b], 2026, 1)
    assert user_a.id in result["per_user"]
    assert user_b.id not in result["per_user"]
    assert result["per_user"][user_a.id]["base_hours"] < result["shared"]["base_hours"]


def test_partial_month_special_status_only_affects_covered_days(user_a, admin):
    # Enero 2026 tiene 21 días hábiles; el estado especial solo cubre la
    # primera semana (5, 6, 7, 8, 9 de enero) -> la base ajustada debe
    # quedar entre la de un mes completo con daily_hours=4 (mínimo) y la
    # base global sin ajuste (máximo), nunca igual a ninguno de los 2 extremos.
    SpecialStatus.objects.create(
        user=user_a, type=SpecialStatus.Type.LACTANCIA, start_date=date(2026, 1, 5), end_date=date(2026, 1, 9),
        daily_hours=4, limit_low=2, limit_base=4, limit_high=5, limit_overload=6, created_by=admin,
    )
    result = monthly_business_base_for_users([user_a], 2026, 1)
    adjusted = result["per_user"][user_a.id]["base_hours"]
    assert 0 < adjusted < result["shared"]["base_hours"]
