"""Cobertura de apps.reports.team_report — Fases 68/69 de la migración
de stack (ver docs/AUDIT_LOG.md § 2026-08-26). Endpoints HTTP del
bundle de CÁLCULO de Reportes Ejecutivos (los 3 builders) — ensambla
`member_kpis`/`insights` (ya cubiertos por sus propias suites) más las
piezas nuevas de estas fases: identidad de roster, agregados de
equipo, alertas, ranking y distribución de consultas por motivo.
Deliberadamente sin wiring desde `buildSnapshotData.ts` todavía (ver
docstring del módulo)."""

from datetime import datetime
from datetime import timezone as dt_timezone

import pytest
from django.contrib.auth.models import Group
from rest_framework.test import APIClient

from apps.reports.team_report import (
    assemble_custom_range_team_report,
    assemble_monthly_team_report,
    assemble_range_team_report,
    compute_consultas_by_reason,
    compute_monthly_ranking,
    compute_range_alerts,
    compute_range_ranking,
    compute_team_alerts,
)
from apps.tasks.models import Task, TaskActivity
from apps.users.models import User

pytestmark = pytest.mark.django_db

YEAR, MONTH = 2026, 3


def _client_for(user: User) -> APIClient:
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def _user_with_group(username: str, group_name: str, *, first_name: str = "") -> User:
    user = User.objects.create_user(username=username, email=f"{username}@example.com", password="Sup3r-Secr3t!", first_name=first_name)
    user.groups.set([Group.objects.get(name=group_name)])
    User.objects.filter(id=user.id).update(created_at=datetime(2020, 1, 1, tzinfo=dt_timezone.utc))
    user.refresh_from_db()
    return user


def _task(user, *, status, end_date, completed_at=None, estimated_hours=5, real_hours=0.0, progress=0, type_="FIJA"):
    return Task.objects.create(
        title="T", priority="MEDIA", frequency="PUNTUAL", type=type_,
        start_date=datetime(YEAR, MONTH, 1, tzinfo=dt_timezone.utc), end_date=end_date,
        estimated_hours=estimated_hours, real_hours=real_hours, progress=progress,
        assigned_to=user, created_by=user, status=status, completed_at=completed_at,
    )


# --- compute_team_alerts ------------------------------------------------------


def test_compute_team_alerts_low_cumplimiento_with_tasks():
    members = [{"id": 1, "name": "Ana", "completed_pct": 40, "total_tasks": 3, "carga_label": "Óptimo", "carga_pct": 50}]
    alerts = compute_team_alerts(members)
    assert alerts == [{"user_id": 1, "name": "Ana", "type": "cumplimiento", "value": 40}]


def test_compute_team_alerts_low_cumplimiento_without_tasks_is_ignored():
    members = [{"id": 1, "name": "Ana", "completed_pct": 0, "total_tasks": 0, "carga_label": "Óptimo", "carga_pct": 0}]
    assert compute_team_alerts(members) == []


def test_compute_team_alerts_sobrecarga():
    members = [{"id": 2, "name": "Beto", "completed_pct": 90, "total_tasks": 5, "carga_label": "Sobrecarga", "carga_pct": 130}]
    alerts = compute_team_alerts(members)
    assert alerts == [{"user_id": 2, "name": "Beto", "type": "sobrecarga", "value": 130}]


def test_compute_team_alerts_member_can_trigger_both():
    members = [{"id": 3, "name": "Cara", "completed_pct": 30, "total_tasks": 2, "carga_label": "Sobrecarga", "carga_pct": 140}]
    alerts = compute_team_alerts(members)
    assert len(alerts) == 2
    assert {a["type"] for a in alerts} == {"cumplimiento", "sobrecarga"}


# --- compute_monthly_ranking --------------------------------------------------


def test_compute_monthly_ranking_sorts_by_score_then_completed_pct():
    members = [
        {"id": 1, "name": "Ana", "role": "R", "score": 80, "completed_pct": 90},
        {"id": 2, "name": "Beto", "role": "R", "score": 90, "completed_pct": 50},
        {"id": 3, "name": "Cara", "role": "R", "score": 90, "completed_pct": 70},
    ]
    ranking = compute_monthly_ranking(members)
    assert [m["id"] for m in ranking] == [3, 2, 1]


def test_compute_monthly_ranking_strips_to_ranking_fields():
    members = [{"id": 1, "name": "Ana", "role": "ANALISTA_CC", "score": 80, "completed_pct": 90, "extra": "x"}]
    ranking = compute_monthly_ranking(members)
    assert ranking == [{"id": 1, "name": "Ana", "role": "ANALISTA_CC", "score": 80, "completed_pct": 90}]


# --- compute_consultas_by_reason ----------------------------------------------


def test_compute_consultas_by_reason_groups_and_computes_pct():
    user = _user_with_group("consultor", "ASISTENTE_GH")
    task = _task(user, status="EN_PROGRESO", end_date=datetime(YEAR, MONTH, 20, tzinfo=dt_timezone.utc), type_="SEGUIMIENTO")
    a1 = TaskActivity.objects.create(task=task, author=user, reason="REUNION", duration=30, description="")
    a2 = TaskActivity.objects.create(task=task, author=user, reason="REUNION", duration=30, description="")
    a3 = TaskActivity.objects.create(task=task, author=user, reason="CAPACITACION", duration=60, description="")
    TaskActivity.objects.filter(id__in=[a1.id, a2.id, a3.id]).update(created_at=datetime(YEAR, MONTH, 10, tzinfo=dt_timezone.utc))

    start = datetime(YEAR, MONTH, 1, tzinfo=dt_timezone.utc)
    end = datetime(YEAR, MONTH, 31, 23, 59, 59, tzinfo=dt_timezone.utc)
    prev_start = datetime(2026, 2, 1, tzinfo=dt_timezone.utc)
    prev_end = datetime(2026, 2, 28, 23, 59, 59, tzinfo=dt_timezone.utc)

    items = compute_consultas_by_reason([user.id], start, end, prev_start, prev_end)

    assert items[0]["reason"] == "REUNION"
    assert items[0]["count"] == 2
    assert items[0]["pct"] == 67
    assert items[0]["trend_pct"] is None
    assert items[1]["reason"] == "CAPACITACION"
    assert items[1]["count"] == 1


def test_compute_consultas_by_reason_computes_trend_vs_previous_period():
    user = _user_with_group("consultor2", "ASISTENTE_GH")
    task = _task(user, status="EN_PROGRESO", end_date=datetime(YEAR, MONTH, 20, tzinfo=dt_timezone.utc), type_="SEGUIMIENTO")
    current = [TaskActivity.objects.create(task=task, author=user, reason="FACTURAS", duration=30, description="") for _ in range(4)]
    TaskActivity.objects.filter(id__in=[a.id for a in current]).update(created_at=datetime(YEAR, MONTH, 10, tzinfo=dt_timezone.utc))
    prev = [TaskActivity.objects.create(task=task, author=user, reason="FACTURAS", duration=30, description="") for _ in range(2)]
    TaskActivity.objects.filter(id__in=[a.id for a in prev]).update(created_at=datetime(2026, 2, 10, tzinfo=dt_timezone.utc))

    start = datetime(YEAR, MONTH, 1, tzinfo=dt_timezone.utc)
    end = datetime(YEAR, MONTH, 31, 23, 59, 59, tzinfo=dt_timezone.utc)
    prev_start = datetime(2026, 2, 1, tzinfo=dt_timezone.utc)
    prev_end = datetime(2026, 2, 28, 23, 59, 59, tzinfo=dt_timezone.utc)

    items = compute_consultas_by_reason([user.id], start, end, prev_start, prev_end)
    assert items[0]["trend_pct"] == 100


def test_compute_consultas_by_reason_empty_returns_empty_list():
    start = datetime(YEAR, MONTH, 1, tzinfo=dt_timezone.utc)
    end = datetime(YEAR, MONTH, 31, tzinfo=dt_timezone.utc)
    assert compute_consultas_by_reason([], start, end, start, end) == []


# --- assemble_monthly_team_report ---------------------------------------------


def test_assemble_monthly_team_report_empty_roster_returns_zeroed_bundle():
    now = datetime(YEAR, MONTH, 31, tzinfo=dt_timezone.utc)
    report = assemble_monthly_team_report(user_ids=[], year=YEAR, month=MONTH, now=now)

    assert report["members"] == []
    assert report["ranking"] == []
    assert report["team_summary"]["avg_cumplimiento"] == 0
    assert report["team_summary"]["total_tasks"] == 0
    assert report["alerts"] == []
    assert report["data_quality"] == {"pct": 100, "issues": []}


def test_assemble_monthly_team_report_includes_identity_from_django_user():
    user = _user_with_group("kpiuser", "ANALISTA_CC", first_name="Ana Pérez")
    now = datetime(YEAR, MONTH, 31, tzinfo=dt_timezone.utc)

    report = assemble_monthly_team_report(user_ids=[user.id], year=YEAR, month=MONTH, now=now)

    assert len(report["members"]) == 1
    member = report["members"][0]
    assert member["id"] == user.id
    assert member["name"] == "Ana Pérez"
    assert member["role"] == "ANALISTA_CC"


def test_assemble_monthly_team_report_basic_team_aggregates():
    ana = _user_with_group("ana2", "ASISTENTE_GH", first_name="Ana")
    beto = _user_with_group("beto2", "ASISTENTE_GH", first_name="Beto")
    _task(ana, status="COMPLETADA", end_date=datetime(YEAR, MONTH, 10, tzinfo=dt_timezone.utc), completed_at=datetime(YEAR, MONTH, 10, tzinfo=dt_timezone.utc), real_hours=5, estimated_hours=5)
    _task(beto, status="PENDIENTE", end_date=datetime(YEAR, MONTH, 20, tzinfo=dt_timezone.utc), estimated_hours=3)
    now = datetime(YEAR, MONTH, 31, tzinfo=dt_timezone.utc)

    report = assemble_monthly_team_report(user_ids=[ana.id, beto.id], year=YEAR, month=MONTH, now=now)

    assert report["team_summary"]["total_tasks"] == 2
    assert report["team_summary"]["total_completed_tasks"] == 1
    names = {m["name"] for m in report["members"]}
    assert names == {"Ana", "Beto"}
    assert len(report["ranking"]) == 2


def test_assemble_monthly_team_report_respects_explicit_fecha_corte():
    ana = _user_with_group("ana3", "ASISTENTE_GH", first_name="Ana")
    _task(ana, status="COMPLETADA", end_date=datetime(YEAR, MONTH, 20, tzinfo=dt_timezone.utc), completed_at=datetime(YEAR, MONTH, 25, tzinfo=dt_timezone.utc), real_hours=5, estimated_hours=5)
    now = datetime(YEAR, MONTH, 31, tzinfo=dt_timezone.utc)
    fecha_corte = datetime(YEAR, MONTH, 15, tzinfo=dt_timezone.utc)

    report = assemble_monthly_team_report(user_ids=[ana.id], year=YEAR, month=MONTH, explicit_fecha_corte=fecha_corte, now=now)

    # completedAt (25) es posterior al corte (15) -> asOfFechaCorte revierte a PENDIENTE.
    assert report["members"][0]["completed_pct"] == 0
    assert report["team_summary"]["total_completed_tasks"] == 0


def test_assemble_monthly_team_report_findings_and_indicator_explanations_present():
    ana = _user_with_group("ana4", "ASISTENTE_GH", first_name="Ana")
    _task(ana, status="COMPLETADA", end_date=datetime(YEAR, MONTH, 10, tzinfo=dt_timezone.utc), completed_at=datetime(YEAR, MONTH, 10, tzinfo=dt_timezone.utc), real_hours=5, estimated_hours=5)
    now = datetime(YEAR, MONTH, 31, tzinfo=dt_timezone.utc)

    report = assemble_monthly_team_report(user_ids=[ana.id], year=YEAR, month=MONTH, now=now)

    assert isinstance(report["findings"], list) and len(report["findings"]) > 0
    assert set(report["indicator_explanations"]) == {"cumplimiento", "carga", "consultas"}
    assert report["period_status"] in {"EN_CURSO", "CERRADO", "HISTORICO"}


# --- HTTP: POST /api/v1/reports/executive/monthly-team-kpis/ -----------------


def test_view_requires_authentication():
    response = APIClient().post("/api/v1/reports/executive/monthly-team-kpis/", {"user_ids": [], "year": YEAR, "month": MONTH}, format="json")
    assert response.status_code == 401


def test_view_requires_can_access_reports():
    user = _user_with_group("coordzs2", "COORDINADOR_ZS")
    response = _client_for(user).post("/api/v1/reports/executive/monthly-team-kpis/", {"user_ids": [], "year": YEAR, "month": MONTH}, format="json")
    assert response.status_code == 403


def test_view_400_for_invalid_month():
    jefe = _user_with_group("jefe5", "JEFE_NACIONAL")
    response = _client_for(jefe).post("/api/v1/reports/executive/monthly-team-kpis/", {"user_ids": [], "year": YEAR, "month": 13}, format="json")
    assert response.status_code == 400


def test_view_400_for_missing_user_ids():
    jefe = _user_with_group("jefe6", "JEFE_NACIONAL")
    response = _client_for(jefe).post("/api/v1/reports/executive/monthly-team-kpis/", {"year": YEAR, "month": MONTH}, format="json")
    assert response.status_code == 400


def test_view_returns_bundle_for_empty_roster():
    jefe = _user_with_group("jefe7", "JEFE_NACIONAL")
    response = _client_for(jefe).post("/api/v1/reports/executive/monthly-team-kpis/", {"user_ids": [], "year": YEAR, "month": MONTH}, format="json")
    assert response.status_code == 200
    assert response.data["members"] == []
    assert set(response.data) == {
        "team_summary", "members", "ranking", "distribuciones", "trends", "findings",
        "insights", "indicator_explanations", "recommendations", "alerts", "data_quality", "period_status",
    }


def test_view_coordinador_nacional_can_access():
    coord = _user_with_group("coordnac", "COORDINADOR_NACIONAL")
    ana = _user_with_group("ana5", "ASISTENTE_GH", first_name="Ana")
    response = _client_for(coord).post(
        "/api/v1/reports/executive/monthly-team-kpis/", {"user_ids": [ana.id], "year": YEAR, "month": MONTH}, format="json"
    )
    assert response.status_code == 200
    assert response.data["members"][0]["name"] == "Ana"


def test_view_accepts_explicit_fecha_corte():
    jefe = _user_with_group("jefe8", "JEFE_NACIONAL")
    response = _client_for(jefe).post(
        "/api/v1/reports/executive/monthly-team-kpis/",
        {"user_ids": [], "year": YEAR, "month": MONTH, "fecha_corte": "2026-03-15T00:00:00Z"},
        format="json",
    )
    assert response.status_code == 200


# --- Fase 69 — compute_range_ranking / compute_range_alerts -------------------


def test_compute_range_ranking_sorts_by_completed_pct_then_score():
    # Prioridad INVERTIDA respecto a compute_monthly_ranking — completed_pct primero.
    members = [
        {"id": 1, "name": "Ana", "role": "R", "score": 90, "completed_pct": 60},
        {"id": 2, "name": "Beto", "role": "R", "score": 60, "completed_pct": 90},
    ]
    ranking = compute_range_ranking(members)
    assert [m["id"] for m in ranking] == [2, 1]


def _month_snap(*, month, member_snapshots):
    return {"month": month, "label": month, "team_avg_cumplimiento": 0, "total_tasks": 1, "member_snapshots": member_snapshots}


def test_compute_range_alerts_triggers_when_majority_of_active_months_affected():
    user = _user_with_group("rangealert1", "ASISTENTE_GH", first_name="Ana")
    snaps = [
        _month_snap(month="2026-01", member_snapshots={user.id: {"total_tasks": 3, "completed_pct": 40, "carga_pct": 50, "carga_label": "Óptimo"}}),
        _month_snap(month="2026-02", member_snapshots={user.id: {"total_tasks": 2, "completed_pct": 30, "carga_pct": 50, "carga_label": "Óptimo"}}),
        _month_snap(month="2026-03", member_snapshots={user.id: {"total_tasks": 4, "completed_pct": 90, "carga_pct": 50, "carga_label": "Óptimo"}}),
    ]
    alerts = compute_range_alerts(snaps, [user])
    assert alerts == [{"user_id": user.id, "name": "Ana", "type": "cumplimiento", "value": 35, "months_affected": 2}]


def test_compute_range_alerts_ignores_months_without_activity():
    user = _user_with_group("rangealert2", "ASISTENTE_GH", first_name="Beto")
    snaps = [
        _month_snap(month="2026-01", member_snapshots={user.id: {"total_tasks": 0, "completed_pct": 0, "carga_pct": 0, "carga_label": "Óptimo"}}),
        _month_snap(month="2026-02", member_snapshots={user.id: {"total_tasks": 2, "completed_pct": 90, "carga_pct": 50, "carga_label": "Óptimo"}}),
    ]
    assert compute_range_alerts(snaps, [user]) == []


def test_compute_range_alerts_sobrecarga():
    user = _user_with_group("rangealert3", "ASISTENTE_GH", first_name="Cara")
    snaps = [
        _month_snap(month="2026-01", member_snapshots={user.id: {"total_tasks": 3, "completed_pct": 90, "carga_pct": 120, "carga_label": "Sobrecarga"}}),
        _month_snap(month="2026-02", member_snapshots={user.id: {"total_tasks": 2, "completed_pct": 90, "carga_pct": 130, "carga_label": "Sobrecarga"}}),
    ]
    alerts = compute_range_alerts(snaps, [user])
    assert alerts == [{"user_id": user.id, "name": "Cara", "type": "sobrecarga", "value": 125, "months_affected": 2}]


# --- Fase 69 — assemble_custom_range_team_report -------------------------------


def test_assemble_custom_range_team_report_basic():
    ana = _user_with_group("crana1", "ASISTENTE_GH", first_name="Ana")
    _task(ana, status="COMPLETADA", end_date=datetime(2026, 3, 20, tzinfo=dt_timezone.utc), completed_at=datetime(2026, 3, 20, tzinfo=dt_timezone.utc), real_hours=5, estimated_hours=5)
    period_start = datetime(2026, 3, 15, tzinfo=dt_timezone.utc)
    period_end = datetime(2026, 4, 15, 23, 59, 59, tzinfo=dt_timezone.utc)
    now = datetime(2026, 4, 15, tzinfo=dt_timezone.utc)

    report = assemble_custom_range_team_report(user_ids=[ana.id], period_start=period_start, period_end=period_end, now=now)

    assert report["members"][0]["name"] == "Ana"
    assert report["members"][0]["completed_pct"] == 100
    assert report["team_summary"]["total_tasks"] == 1
    assert "monthly_evolution" not in report
    assert report["period_status"] in {"EN_CURSO", "HISTORICO"}


def test_assemble_custom_range_team_report_empty_roster():
    now = datetime(2026, 4, 15, tzinfo=dt_timezone.utc)
    report = assemble_custom_range_team_report(
        user_ids=[], period_start=datetime(2026, 3, 15, tzinfo=dt_timezone.utc), period_end=datetime(2026, 4, 15, tzinfo=dt_timezone.utc), now=now
    )
    assert report["members"] == []
    assert report["team_summary"]["avg_cumplimiento"] == 0
    assert report["data_quality"] == {"pct": 100, "issues": []}


# --- Fase 69 — assemble_range_team_report ---------------------------------------


def test_assemble_range_team_report_basic_two_months():
    ana = _user_with_group("rgana1", "ASISTENTE_GH", first_name="Ana")
    _task(ana, status="COMPLETADA", end_date=datetime(2026, 2, 10, tzinfo=dt_timezone.utc), completed_at=datetime(2026, 2, 10, tzinfo=dt_timezone.utc), real_hours=5, estimated_hours=5)
    _task(ana, status="PENDIENTE", end_date=datetime(2026, 3, 15, tzinfo=dt_timezone.utc), estimated_hours=3)
    now = datetime(2026, 3, 31, tzinfo=dt_timezone.utc)

    report = assemble_range_team_report(user_ids=[ana.id], from_year=2026, from_month=2, to_year=2026, to_month=3, now=now)

    assert [ms["month"] for ms in report["monthly_evolution"]] == ["2026-02", "2026-03"]
    assert report["members"][0]["name"] == "Ana"
    assert report["range_trend"]["cumplimiento_trend"] in {"mejora", "deterioro", "estancamiento"}
    assert report["problematic_months"] is not None


def test_assemble_range_team_report_empty_roster():
    now = datetime(2026, 3, 31, tzinfo=dt_timezone.utc)
    report = assemble_range_team_report(user_ids=[], from_year=2026, from_month=2, to_year=2026, to_month=3, now=now)
    assert report["members"] == []
    assert report["monthly_evolution"] == []
    assert report["team_summary"]["avg_cumplimiento"] == 0


# --- HTTP: custom-range-team-kpis / range-team-kpis -----------------------------


def test_custom_range_view_requires_authentication():
    response = APIClient().post(
        "/api/v1/reports/executive/custom-range-team-kpis/",
        {"user_ids": [], "period_start": "2026-03-01T00:00:00Z", "period_end": "2026-03-31T23:59:59Z"},
        format="json",
    )
    assert response.status_code == 401


def test_custom_range_view_returns_bundle():
    jefe = _user_with_group("jefe9", "JEFE_NACIONAL")
    response = _client_for(jefe).post(
        "/api/v1/reports/executive/custom-range-team-kpis/",
        {"user_ids": [], "period_start": "2026-03-01T00:00:00Z", "period_end": "2026-03-31T23:59:59Z"},
        format="json",
    )
    assert response.status_code == 200
    assert response.data["members"] == []


def test_custom_range_view_400_for_missing_period():
    jefe = _user_with_group("jefe10", "JEFE_NACIONAL")
    response = _client_for(jefe).post("/api/v1/reports/executive/custom-range-team-kpis/", {"user_ids": []}, format="json")
    assert response.status_code == 400


def test_range_view_requires_can_access_reports():
    user = _user_with_group("coordzs3", "COORDINADOR_ZS")
    response = _client_for(user).post(
        "/api/v1/reports/executive/range-team-kpis/",
        {"user_ids": [], "from_year": 2026, "from_month": 2, "to_year": 2026, "to_month": 3},
        format="json",
    )
    assert response.status_code == 403


def test_range_view_returns_bundle():
    jefe = _user_with_group("jefe11", "JEFE_NACIONAL")
    response = _client_for(jefe).post(
        "/api/v1/reports/executive/range-team-kpis/",
        {"user_ids": [], "from_year": 2026, "from_month": 2, "to_year": 2026, "to_month": 3},
        format="json",
    )
    assert response.status_code == 200
    assert response.data["monthly_evolution"] == []
    assert set(response.data) == {
        "team_summary", "members", "ranking", "distribuciones", "monthly_evolution", "range_trend",
        "problematic_months", "findings", "insights", "indicator_explanations", "recommendations",
        "alerts", "data_quality", "period_status",
    }


def test_range_view_400_for_invalid_month():
    jefe = _user_with_group("jefe12", "JEFE_NACIONAL")
    response = _client_for(jefe).post(
        "/api/v1/reports/executive/range-team-kpis/",
        {"user_ids": [], "from_year": 2026, "from_month": 2, "to_year": 2026, "to_month": 13},
        format="json",
    )
    assert response.status_code == 400
