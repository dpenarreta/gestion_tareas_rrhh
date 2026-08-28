"""Cobertura HTTP y de orquestador de `GET /api/v1/kpis/me/range/` —
Fase 4c (ver docs/AUDIT_LOG.md § 2026-08-11)."""

from datetime import datetime
from datetime import timezone as dt_timezone

import pytest
from rest_framework.test import APIClient

from apps.analytics.services import build_kpi_range_payload
from apps.tasks.models import Task
from apps.users.models import User

pytestmark = pytest.mark.django_db


@pytest.fixture
def user():
    return User.objects.create_user(username="target", email="target@example.com", password="Sup3r-Secr3t!")


def _client_for(user: User) -> APIClient:
    client = APIClient()
    client.force_authenticate(user=user)
    return client


# --- validación HTTP ----------------------------------------------------------


def test_requires_authentication():
    response = APIClient().get("/api/v1/kpis/me/range/?from=2026-01&to=2026-02")
    assert response.status_code == 401


def test_requires_from_and_to(user):
    response = _client_for(user).get("/api/v1/kpis/me/range/")
    assert response.status_code == 400


def test_rejects_from_after_or_equal_to(user):
    response = _client_for(user).get("/api/v1/kpis/me/range/?from=2026-03&to=2026-01")
    assert response.status_code == 400


def test_rejects_range_shorter_than_2_months(user):
    response = _client_for(user).get("/api/v1/kpis/me/range/?from=2026-01&to=2026-01")
    assert response.status_code == 400


def test_rejects_range_longer_than_24_months(user):
    response = _client_for(user).get("/api/v1/kpis/me/range/?from=2020-01&to=2026-01")
    assert response.status_code == 400


def test_rejects_malformed_month(user):
    response = _client_for(user).get("/api/v1/kpis/me/range/?from=not-a-month&to=2026-02")
    assert response.status_code == 400


def test_happy_path_returns_expected_month_count(user):
    response = _client_for(user).get("/api/v1/kpis/me/range/?from=2026-01&to=2026-03")
    assert response.status_code == 200
    assert [m["month"] for m in response.data["report"]["months"]] == ["2026-01", "2026-02", "2026-03"]
    assert response.data["report"]["from"] == "2026-01"
    assert response.data["report"]["to"] == "2026-03"


# --- build_kpi_range_payload (orquestador) ------------------------------------


def test_range_payload_counts_tasks_per_month_using_definition_a(user):
    # Definición A (compute_completed_pct_any): cuenta COMPLETADA sin
    # importar si fue a tiempo — a diferencia de /kpis/me (Definición B).
    Task.objects.create(
        title="Enero completada tarde", priority="MEDIA", frequency="PUNTUAL",
        start_date=datetime(2026, 1, 1, tzinfo=dt_timezone.utc), end_date=datetime(2026, 1, 5, tzinfo=dt_timezone.utc),
        estimated_hours=2, real_hours=2, assigned_to=user, created_by=user,
        status=Task.Status.COMPLETADA, completed_at=datetime(2026, 1, 20, tzinfo=dt_timezone.utc),
    )
    Task.objects.create(
        title="Febrero pendiente", priority="MEDIA", frequency="PUNTUAL",
        start_date=datetime(2026, 2, 1, tzinfo=dt_timezone.utc), end_date=datetime(2026, 2, 10, tzinfo=dt_timezone.utc),
        estimated_hours=3, real_hours=0, assigned_to=user, created_by=user, status=Task.Status.PENDIENTE,
    )
    payload = build_kpi_range_payload(user=user, from_str="2026-01", to_str="2026-02", months=[(2026, 1), (2026, 2)])
    months = {m["month"]: m for m in payload["report"]["months"]}
    assert months["2026-01"]["total_tasks"] == 1
    assert months["2026-01"]["completed_tasks"] == 1
    assert months["2026-01"]["completed_pct"] == 100  # Definición A: completada, aunque tarde
    assert months["2026-02"]["total_tasks"] == 1
    assert months["2026-02"]["completed_pct"] == 0
    assert payload["report"]["aggregated"]["total_tasks"] == 2
    assert payload["report"]["aggregated"]["total_completed_tasks"] == 1


def test_range_payload_excludes_months_without_tasks_from_averages(user):
    Task.objects.create(
        title="Solo enero", priority="MEDIA", frequency="PUNTUAL",
        start_date=datetime(2026, 1, 1, tzinfo=dt_timezone.utc), end_date=datetime(2026, 1, 5, tzinfo=dt_timezone.utc),
        estimated_hours=1, real_hours=1, assigned_to=user, created_by=user,
        status=Task.Status.COMPLETADA, completed_at=datetime(2026, 1, 5, tzinfo=dt_timezone.utc),
    )
    payload = build_kpi_range_payload(user=user, from_str="2026-01", to_str="2026-02", months=[(2026, 1), (2026, 2)])
    # Febrero no tiene tareas -> queda fuera del promedio (no un 0% que lo arrastre).
    assert payload["report"]["aggregated"]["avg_cumplimiento"] == 100


def test_range_payload_trend_labels(user):
    payload = build_kpi_range_payload(user=user, from_str="2026-01", to_str="2026-02", months=[(2026, 1), (2026, 2)])
    assert payload["report"]["trends"]["cumplimiento_trend"] == "estancamiento"
    assert payload["report"]["trends"]["cumplimiento_change"] == 0
