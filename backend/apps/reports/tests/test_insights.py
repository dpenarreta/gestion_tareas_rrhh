"""Cobertura de apps.reports.insights — Fase 67 de la migración de stack
(ver docs/AUDIT_LOG.md § 2026-08-26). Port de `src/lib/reportInsights.ts`
(motor de INTERPRETACIÓN de Reportes Ejecutivos, distinto de
`apps.reports.member_kpis` que calcula los KPIs base) — sin ningún
endpoint HTTP todavía (ver docstring del módulo)."""

from datetime import datetime
from datetime import timezone as dt_timezone

import pytest

from apps.reports.insights import (
    RISK_QUADRANT_LABEL,
    compute_findings,
    compute_recommendations,
    compute_risk_quadrant,
    compute_team_insights,
    compute_team_monthly_snapshots,
    compute_trend_comparisons,
    explain_carga_indicator,
    explain_consultas_indicator,
    explain_cumplimiento_indicator,
    explain_motivo_distribution,
    get_activity_reason_label_map,
    previous_equivalent_period,
    resolve_custom_range_period_status,
    resolve_monthly_period_status,
    resolve_range_period_status,
)
from apps.tasks.models import ActivityReason, MonthClosure, Task, TaskActivity
from apps.users.models import User

pytestmark = pytest.mark.django_db

YEAR, MONTH = 2026, 3


@pytest.fixture
def user():
    return User.objects.create_user(username="target", email="target@example.com", password="Sup3r-Secr3t!")


def _task(user, *, status, end_date, completed_at=None, estimated_hours=5, real_hours=0.0, progress=0, type_="FIJA"):
    return Task.objects.create(
        title="T", priority="MEDIA", frequency="PUNTUAL", type=type_,
        start_date=datetime(YEAR, MONTH, 1, tzinfo=dt_timezone.utc), end_date=end_date,
        estimated_hours=estimated_hours, real_hours=real_hours, progress=progress,
        assigned_to=user, created_by=user, status=status, completed_at=completed_at,
    )


# --- explain_cumplimiento_indicator ------------------------------------------


def test_explain_cumplimiento_indicator_high_pct_is_positive():
    result = explain_cumplimiento_indicator(85, 4)
    assert "85%" in result["why"]
    assert "Mantener" in result["action"]


def test_explain_cumplimiento_indicator_low_pct_is_risk():
    result = explain_cumplimiento_indicator(45, 4)
    assert "por debajo del objetivo mínimo" in result["why"]
    assert "Priorizar" in result["action"]


# --- explain_carga_indicator --------------------------------------------------


def test_explain_carga_indicator_over_100_flags_overload():
    result = explain_carga_indicator(120)
    assert "por encima del rango óptimo" in result["why"]
    assert "Redistribuir" in result["action"]


def test_explain_carga_indicator_at_or_under_100_is_ok():
    result = explain_carga_indicator(90)
    assert "Sin acción requerida" in result["action"]


# --- explain_consultas_indicator ---------------------------------------------


def test_explain_consultas_indicator_no_prev_total():
    result = explain_consultas_indicator(10, None)
    assert result["why"] == "El equipo atendió 10 consultas en el período."


def test_explain_consultas_indicator_increase_below_30_no_action():
    result = explain_consultas_indicator(11, 10)
    assert "un 10% más" in result["why"]
    assert "Sin acción requerida" in result["action"]


def test_explain_consultas_indicator_increase_30_or_more_triggers_action():
    result = explain_consultas_indicator(14, 10)
    assert "un 40% más" in result["why"]
    assert "Evaluar si el aumento" in result["action"]


def test_explain_consultas_indicator_decrease_uses_absolute_value():
    result = explain_consultas_indicator(6, 10)
    assert "un 40% menos" in result["why"]


# --- compute_risk_quadrant ----------------------------------------------------


def test_compute_risk_quadrant_all_four_quadrants():
    members = [
        {"name": "a", "completed_pct": 50, "carga_pct": 110},
        {"name": "b", "completed_pct": 90, "carga_pct": 110},
        {"name": "c", "completed_pct": 50, "carga_pct": 80},
        {"name": "d", "completed_pct": 90, "carga_pct": 80},
    ]
    result = compute_risk_quadrant(members)
    quadrants = {m["name"]: m["quadrant"] for m in result}
    assert quadrants == {"a": "criticos", "b": "atencion-carga", "c": "atencion-cumplimiento", "d": "saludables"}
    assert set(RISK_QUADRANT_LABEL) == {"criticos", "atencion-carga", "atencion-cumplimiento", "saludables"}


def test_compute_risk_quadrant_preserves_original_fields():
    result = compute_risk_quadrant([{"name": "a", "completed_pct": 90, "carga_pct": 50, "extra": 1}])
    assert result[0]["extra"] == 1
    assert result[0]["name"] == "a"


# --- explain_motivo_distribution ----------------------------------------------


def test_explain_motivo_distribution_with_known_hint_and_high_pct():
    text = explain_motivo_distribution("NOVEDADES_PAGO", "Novedades de pago", 35, None)
    assert "convirtiéndose en el principal motivo" in text
    assert "ajustes de nómina" in text


def test_explain_motivo_distribution_unknown_reason_no_hint():
    text = explain_motivo_distribution("MOTIVO_CUSTOM", "Motivo custom", 10, None)
    assert text == "Motivo custom representa el 10% de las consultas del período."


def test_explain_motivo_distribution_trend_up_and_down():
    up = explain_motivo_distribution("FACTURAS", "Facturas", 15, 25)
    down = explain_motivo_distribution("FACTURAS", "Facturas", 15, -25)
    assert "Aumentó 25%" in up
    assert "Disminuyó 25%" in down


def test_explain_motivo_distribution_trend_below_threshold_omitted():
    text = explain_motivo_distribution("FACTURAS", "Facturas", 15, 10)
    assert "Aumentó" not in text and "Disminuyó" not in text


# --- get_activity_reason_label_map --------------------------------------------


def test_get_activity_reason_label_map_returns_key_to_label():
    ActivityReason.objects.create(key="REUNION", label="Reunión")
    ActivityReason.objects.create(key="CAPACITACION", label="Capacitación", is_active=False)
    result = get_activity_reason_label_map()
    assert result == {"REUNION": "Reunión", "CAPACITACION": "Capacitación"}


def test_get_activity_reason_label_map_empty_when_no_reasons():
    assert get_activity_reason_label_map() == {}


# --- compute_findings ----------------------------------------------------------


def _member(name, carga_label, completed_pct, overdue_count=0):
    return {"name": name, "carga_label": carga_label, "completed_pct": completed_pct, "overdue_count": overdue_count}


def test_compute_findings_delta_positive_and_negative():
    up = compute_findings(avg_cumplimiento=80, avg_cumplimiento_delta=5, members=[], total_overdue=0, top_reason=None)
    down = compute_findings(avg_cumplimiento=80, avg_cumplimiento_delta=-5, members=[], total_overdue=0, top_reason=None)
    assert any(f["tone"] == "positive" and "aumentó 5" in f["text"] for f in up)
    assert any(f["tone"] == "risk" and "disminuyó 5" in f["text"] for f in down)


def test_compute_findings_delta_within_noise_band_omitted():
    result = compute_findings(avg_cumplimiento=80, avg_cumplimiento_delta=1, members=[], total_overdue=0, top_reason=None)
    assert not any("puntos porcentuales" in f["text"] for f in result)


def test_compute_findings_no_sobrecargados_is_positive_finding():
    result = compute_findings(avg_cumplimiento=80, avg_cumplimiento_delta=None, members=[_member("Ana", "Óptimo", 90)], total_overdue=0, top_reason=None)
    assert any("nadie está en sobrecarga" in f["text"] for f in result)


def test_compute_findings_flags_subutilizados_and_sobrecargados():
    members = [_member("Ana", "Subutilización", 90), _member("Beto", "Sobrecarga", 90)]
    result = compute_findings(avg_cumplimiento=80, avg_cumplimiento_delta=None, members=members, total_overdue=0, top_reason=None)
    assert any("subutilizados: Ana" in f["text"] for f in result)
    assert any("sobrecarga: Beto" in f["text"] for f in result)


def test_compute_findings_overdue_zero_vs_nonzero():
    zero = compute_findings(avg_cumplimiento=80, avg_cumplimiento_delta=None, members=[], total_overdue=0, top_reason=None)
    nonzero = compute_findings(avg_cumplimiento=80, avg_cumplimiento_delta=None, members=[], total_overdue=3, top_reason=None)
    assert any("No existen tareas vencidas" in f["text"] for f in zero)
    assert any("Existen 3 tarea(s) vencida(s)" in f["text"] for f in nonzero)


def test_compute_findings_top_reason_above_threshold():
    result = compute_findings(avg_cumplimiento=80, avg_cumplimiento_delta=None, members=[], total_overdue=0, top_reason={"label": "Facturas", "pct": 40})
    assert any('"Facturas" concentra el 40%' in f["text"] for f in result)


def test_compute_findings_top_reason_below_threshold_omitted():
    result = compute_findings(avg_cumplimiento=80, avg_cumplimiento_delta=None, members=[], total_overdue=0, top_reason={"label": "Facturas", "pct": 10})
    assert not any("concentra el" in f["text"] for f in result)


# --- compute_recommendations ----------------------------------------------------


def test_compute_recommendations_mixed_over_and_under_utilized():
    members = [_member("Ana", "Sobrecarga", 90), _member("Beto", "Subutilización", 90)]
    result = compute_recommendations(avg_cumplimiento=80, members=members, top_reason=None)
    ids = [r["id"] for r in result]
    assert "redistribuir-carga-mixta" in ids
    assert "redistribuir-carga-sobrecarga" not in ids


def test_compute_recommendations_only_sobrecargados():
    members = [_member("Ana", "Sobrecarga", 90)]
    result = compute_recommendations(avg_cumplimiento=80, members=members, top_reason=None)
    assert result[0]["id"] == "redistribuir-carga-sobrecarga"
    assert result[0]["priority"] == "alta"


def test_compute_recommendations_bajo_cumplimiento():
    members = [_member("Ana", "Óptimo", 40)]
    result = compute_recommendations(avg_cumplimiento=80, members=members, top_reason=None)
    assert any(r["id"] == "revisar-bajo-cumplimiento" for r in result)


def test_compute_recommendations_top_reason_media_priority():
    result = compute_recommendations(avg_cumplimiento=80, members=[], top_reason={"label": "Facturas", "pct": 35})
    rec = next(r for r in result if r["id"] == "reforzar-motivo-concentrado")
    assert rec["priority"] == "media"


def test_compute_recommendations_healthy_team_recommends_maintain():
    result = compute_recommendations(avg_cumplimiento=85, members=[_member("Ana", "Óptimo", 90)], top_reason=None)
    assert any(r["id"] == "mantener-planificacion" for r in result)


def test_compute_recommendations_unhealthy_team_no_maintain():
    result = compute_recommendations(avg_cumplimiento=85, members=[_member("Ana", "Sobrecarga", 90)], top_reason=None)
    assert not any(r["id"] == "mantener-planificacion" for r in result)


# --- compute_team_insights --------------------------------------------------


def test_compute_team_insights_top_member_above_threshold():
    members = [{"name": "Ana", "carga_real_hours": 50}, {"name": "Beto", "carga_real_hours": 10}]
    result = compute_team_insights(members=members, total_carga_real_hours=60)
    assert any("Ana concentró el 83%" in i for i in result)


def test_compute_team_insights_top_member_below_threshold_omitted():
    members = [{"name": "Ana", "carga_real_hours": 15}, {"name": "Beto", "carga_real_hours": 10}, {"name": "Cara", "carga_real_hours": 75}]
    # Cara concentra el 75%, sí aparece; verificamos que Beto (bajo el resto) no genera insight propio.
    result = compute_team_insights(members=members, total_carga_real_hours=100)
    assert any("Cara concentró el 75%" in i for i in result)
    assert not any("Beto concentró" in i for i in result)


def test_compute_team_insights_health_by_member_picks_best():
    result = compute_team_insights(
        members=[], total_carga_real_hours=0,
        health_by_member=[{"name": "Ana", "score": 70}, {"name": "Beto", "score": 95}],
    )
    assert any("Beto mantiene el mayor Equilibrio Operativo del equipo (95/100)" in i for i in result)


def test_compute_team_insights_variable_consistency_capped_at_two():
    result = compute_team_insights(members=[], total_carga_real_hours=0, variable_consistency_members=["Ana", "Beto", "Cara"])
    assert len(result) == 2
    assert "Cara presenta variaciones importantes entre semanas." not in result


# --- previous_equivalent_period ------------------------------------------------


def test_previous_equivalent_period_same_duration_immediately_before():
    period_start = datetime(2026, 3, 1, tzinfo=dt_timezone.utc)
    period_end = datetime(2026, 3, 31, 23, 59, 59, tzinfo=dt_timezone.utc)
    result = previous_equivalent_period(period_start, period_end)
    assert result["end"] < period_start
    assert (result["end"] - result["start"]) == (period_end - period_start)


# --- resolve_monthly_period_status / resolve_range_period_status --------------


def test_resolve_monthly_period_status_current_month_is_en_curso():
    now = datetime(2026, 3, 15, tzinfo=dt_timezone.utc)
    assert resolve_monthly_period_status(3, 2026, now=now) == "EN_CURSO"


def test_resolve_monthly_period_status_past_month_without_closure_is_historico():
    now = datetime(2026, 4, 15, tzinfo=dt_timezone.utc)
    assert resolve_monthly_period_status(3, 2026, now=now) == "HISTORICO"


def test_resolve_monthly_period_status_past_month_with_closure_is_cerrado(user):
    MonthClosure.objects.create(
        month=3, year=2026, closed_by=user, cutoff_date=datetime(2026, 3, 31, tzinfo=dt_timezone.utc), closure_type="NORMAL",
        calendar_days_total=31, calendar_days_considered=31, working_days_considered=20,
        working_hours_considered=160.0, total_tasks=0, completed_tasks=0, summary={},
    )
    now = datetime(2026, 4, 15, tzinfo=dt_timezone.utc)
    assert resolve_monthly_period_status(3, 2026, now=now) == "CERRADO"


def test_resolve_range_period_status_delegates_to_monthly():
    now = datetime(2026, 4, 15, tzinfo=dt_timezone.utc)
    assert resolve_range_period_status(3, 2026, now=now) == resolve_monthly_period_status(3, 2026, now=now)


# --- resolve_custom_range_period_status ----------------------------------------


def test_resolve_custom_range_period_status_future_end_is_en_curso():
    now = datetime(2026, 3, 15, tzinfo=dt_timezone.utc)
    period_end = datetime(2026, 3, 31, tzinfo=dt_timezone.utc)
    assert resolve_custom_range_period_status(period_end, now=now) == "EN_CURSO"


def test_resolve_custom_range_period_status_past_end_is_historico():
    now = datetime(2026, 4, 15, tzinfo=dt_timezone.utc)
    period_end = datetime(2026, 3, 31, tzinfo=dt_timezone.utc)
    assert resolve_custom_range_period_status(period_end, now=now) == "HISTORICO"


# --- compute_team_monthly_snapshots / compute_trend_comparisons ---------------


def test_compute_team_monthly_snapshots_empty_user_ids_returns_empty():
    assert compute_team_monthly_snapshots([], 2026, 3, 2) == []


def test_compute_team_monthly_snapshots_basic_two_months(user):
    User.objects.filter(id=user.id).update(created_at=datetime(2020, 1, 1, tzinfo=dt_timezone.utc))
    user.refresh_from_db()
    _task(user, status="COMPLETADA", end_date=datetime(2026, 2, 10, tzinfo=dt_timezone.utc), completed_at=datetime(2026, 2, 10, tzinfo=dt_timezone.utc), real_hours=5, estimated_hours=5)
    _task(user, status="PENDIENTE", end_date=datetime(2026, 3, 15, tzinfo=dt_timezone.utc), estimated_hours=3)

    result = compute_team_monthly_snapshots([user.id], 2026, 3, 1)

    assert [p["month"] for p in result] == ["2026-02", "2026-03"]
    feb, mar = result
    assert feb["avg_cumplimiento"] == 100
    assert feb["total_tasks"] == 1
    assert mar["avg_cumplimiento"] == 0
    assert mar["total_tasks"] == 1


def test_compute_team_monthly_snapshots_counts_seguimiento_activities_as_consultas(user):
    User.objects.filter(id=user.id).update(created_at=datetime(2020, 1, 1, tzinfo=dt_timezone.utc))
    user.refresh_from_db()
    task = _task(user, status="EN_PROGRESO", end_date=datetime(2026, 3, 20, tzinfo=dt_timezone.utc), type_="SEGUIMIENTO")
    a1 = TaskActivity.objects.create(task=task, author=user, reason="REUNION", duration=60, description="")
    a2 = TaskActivity.objects.create(task=task, author=user, reason="REUNION", duration=30, description="")
    TaskActivity.objects.filter(id__in=[a1.id, a2.id]).update(created_at=datetime(2026, 3, 12, tzinfo=dt_timezone.utc))

    result = compute_team_monthly_snapshots([user.id], 2026, 3, 0)

    assert result[0]["total_consultas"] == 2


def test_compute_team_monthly_snapshots_avg_carga_pct_uses_all_members_not_only_active(user):
    # Segundo colaborador sin tareas en el mes — a diferencia de avg_cumplimiento
    # (solo activos), avg_carga_pct promedia TODO el roster (asimetría real del
    # TS original, no un error de este port — ver docstring del módulo).
    other = User.objects.create_user(username="other", email="other@example.com", password="Sup3r-Secr3t!")
    User.objects.filter(id__in=[user.id, other.id]).update(created_at=datetime(2020, 1, 1, tzinfo=dt_timezone.utc))
    user.refresh_from_db()
    _task(user, status="COMPLETADA", end_date=datetime(2026, 3, 10, tzinfo=dt_timezone.utc), completed_at=datetime(2026, 3, 10, tzinfo=dt_timezone.utc), real_hours=5, estimated_hours=5)

    result = compute_team_monthly_snapshots([user.id, other.id], 2026, 3, 0)

    # avg_cumplimiento solo considera a `user` (único activo); avg_carga_pct
    # promedia ambos (incluye `other` con carga 0), por lo que ambos existen
    # y no son necesariamente iguales entre sí.
    assert result[0]["total_tasks"] == 1
    assert result[0]["avg_cumplimiento"] == 100


def test_compute_trend_comparisons_uses_prior_months_only():
    points = [
        {"month": "2026-01", "label": "ene 26", "avg_cumplimiento": 60, "avg_carga_pct": 80, "total_consultas": 1, "total_tasks": 2},
        {"month": "2026-02", "label": "feb 26", "avg_cumplimiento": 70, "avg_carga_pct": 80, "total_consultas": 1, "total_tasks": 2},
        {"month": "2026-03", "label": "mar 26", "avg_cumplimiento": 90, "avg_carga_pct": 80, "total_consultas": 1, "total_tasks": 2},
    ]
    result = compute_trend_comparisons(points)
    assert result["mes_anterior"]["compare_value"] == 70
    assert result["mes_anterior"]["delta"] == 20
    assert result["mes_anterior"]["direction"] == "mejora"
    assert result["trimestre"]["compare_value"] == 65  # promedio de ene/feb


def test_compute_trend_comparisons_no_prior_data_is_sin_datos():
    points = [{"month": "2026-03", "label": "mar 26", "avg_cumplimiento": 90, "avg_carga_pct": 80, "total_consultas": 1, "total_tasks": 0}]
    result = compute_trend_comparisons(points)
    assert result["mes_anterior"]["direction"] == "sin-datos"
    assert result["mes_anterior"]["compare_value"] is None


def test_compute_trend_comparisons_skips_months_without_tasks():
    points = [
        {"month": "2026-01", "label": "ene 26", "avg_cumplimiento": 60, "avg_carga_pct": 80, "total_consultas": 0, "total_tasks": 0},
        {"month": "2026-02", "label": "feb 26", "avg_cumplimiento": 70, "avg_carga_pct": 80, "total_consultas": 1, "total_tasks": 2},
        {"month": "2026-03", "label": "mar 26", "avg_cumplimiento": 90, "avg_carga_pct": 80, "total_consultas": 1, "total_tasks": 2},
    ]
    result = compute_trend_comparisons(points)
    assert result["mes_anterior"]["compare_value"] == 70
