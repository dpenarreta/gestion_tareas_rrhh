"""Cobertura HTTP de `/api/v1/reports/executive/closure-status/` —
Fase 34 (ver docs/AUDIT_LOG.md § 2026-08-21), réplica de `route.ts`."""

from datetime import datetime
from datetime import timezone as dt_timezone

import pytest
from django.contrib.auth.models import Group
from rest_framework.test import APIClient

from apps.tasks.models import MonthClosure
from apps.users.models import User

pytestmark = pytest.mark.django_db

YEAR, MONTH = 2026, 3


def _client_for(user: User) -> APIClient:
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def _user_with_group(username: str, group_name: str) -> User:
    user = User.objects.create_user(username=username, email=f"{username}@example.com", password="Sup3r-Secr3t!")
    user.groups.set([Group.objects.get(name=group_name)])
    return user


def _make_closure(*, closed_by: User, closure_type: str = "NORMAL") -> MonthClosure:
    return MonthClosure.objects.create(
        month=MONTH, year=YEAR, closed_by=closed_by,
        cutoff_date=datetime(YEAR, 3, 20, tzinfo=dt_timezone.utc), closure_type=closure_type,
        calendar_days_total=31, calendar_days_considered=20, working_days_considered=14,
        working_hours_considered=91.0, total_tasks=1, completed_tasks=1, summary={},
    )


def test_requires_authentication():
    response = APIClient().get(f"/api/v1/reports/executive/closure-status/?year={YEAR}&month={MONTH}")
    assert response.status_code == 401


def test_requires_can_access_reports():
    user = _user_with_group("coordzs", "COORDINADOR_ZS")
    response = _client_for(user).get(f"/api/v1/reports/executive/closure-status/?year={YEAR}&month={MONTH}")
    assert response.status_code == 403


def test_400_for_invalid_month():
    jefe = _user_with_group("jefe", "JEFE_NACIONAL")
    response = _client_for(jefe).get(f"/api/v1/reports/executive/closure-status/?year={YEAR}&month=13")
    assert response.status_code == 400


def test_400_for_missing_params():
    jefe = _user_with_group("jefe2", "JEFE_NACIONAL")
    response = _client_for(jefe).get("/api/v1/reports/executive/closure-status/")
    assert response.status_code == 400


def test_returns_not_closed_when_no_closure_exists():
    jefe = _user_with_group("jefe3", "JEFE_NACIONAL")
    response = _client_for(jefe).get(f"/api/v1/reports/executive/closure-status/?year={YEAR}&month={MONTH}")
    assert response.status_code == 200
    assert response.data == {
        "closed": False, "cutoff_date": None, "closure_type": None, "closed_at": None,
        "calendar_days_total": None, "calendar_days_considered": None,
        "working_days_considered": None, "working_hours_considered": None,
    }


def test_returns_closure_details_when_closed_early():
    jefe = _user_with_group("jefe4", "JEFE_NACIONAL")
    closure = _make_closure(closed_by=jefe, closure_type="EARLY")

    response = _client_for(jefe).get(f"/api/v1/reports/executive/closure-status/?year={YEAR}&month={MONTH}")
    assert response.status_code == 200
    assert response.data == {
        "closed": True, "cutoff_date": "2026-03-20", "closure_type": "EARLY",
        "closed_at": closure.closed_at.isoformat(),
        "calendar_days_total": 31, "calendar_days_considered": 20,
        "working_days_considered": 14, "working_hours_considered": 91.0,
    }


def test_coordinador_nacional_can_access():
    coord = _user_with_group("coord", "COORDINADOR_NACIONAL")
    response = _client_for(coord).get(f"/api/v1/reports/executive/closure-status/?year={YEAR}&month={MONTH}")
    assert response.status_code == 200
