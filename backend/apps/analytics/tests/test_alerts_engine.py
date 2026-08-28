"""Cobertura de apps.analytics.alerts_engine — Fase 4i (ver
docs/AUDIT_LOG.md § 2026-08-11)."""

from datetime import datetime, timedelta
from datetime import timezone as dt_timezone

import pytest
from django.utils import timezone

from apps.analytics import alerts_engine as module
from apps.analytics.alerts_engine import (
    _consecutive_days_with_label,
    compute_alerts,
    get_resolved_alerts_history,
)
from apps.analytics.models import AnalyticsAuditLog
from apps.tasks.models import Task
from apps.users.models import User

pytestmark = pytest.mark.django_db

NOW = datetime(2026, 8, 12, 10, 0, tzinfo=dt_timezone.utc)


@pytest.fixture
def user():
    return User.objects.create_user(username="target", email="target@example.com", password="Sup3r-Secr3t!")


def _task(user, *, end_date, status=Task.Status.PENDIENTE, priority="MEDIA") -> Task:
    return Task.objects.create(
        title="T", priority=priority, frequency="PUNTUAL", start_date=end_date, end_date=end_date,
        estimated_hours=1, assigned_to=user, created_by=user, status=status,
    )


_DEFAULT_CAPACITY = {"estado": "alta", "disponible": 10, "disponible_pct": 50}
_DEFAULT_CARGA_HISTORY = {"daily": []}
_DEFAULT_TRENDS = {"cumplimiento": {"mes_anterior": {"available": False}}}
_DEFAULT_MONTHLY = [{"weekend_hours": 0, "seguimiento_count": 0}]
_DEFAULT_WEEKLY = [{"business_days": 5, "days_with_registration": 5}]


def _mock_dependencies(monkeypatch, *, capacity=None, carga_history=None, trends=None, monthly=None, weekly=None):
    """`compute_alerts` combina 5 dependencias ya probadas en sus
    propios archivos (Fases 4b/4d/4f). Mockearlas aísla las 8 reglas
    nuevas de esta sub-fase — mismo criterio que la Fase 4h."""
    monkeypatch.setattr(module, "compute_capacity_forecast", lambda *, user, now: {**_DEFAULT_CAPACITY, **(capacity or {})})
    monkeypatch.setattr(module, "compute_carga_history", lambda *, user, now: carga_history or _DEFAULT_CARGA_HISTORY)
    monkeypatch.setattr(module, "compute_trends", lambda *, user, now: trends or _DEFAULT_TRENDS)
    monkeypatch.setattr(module, "compute_monthly_history", lambda *, user, months_back, now: monthly or _DEFAULT_MONTHLY)
    monkeypatch.setattr(module, "compute_weekly_history", lambda *, user, weeks_back, now: weekly or _DEFAULT_WEEKLY)


# --- _consecutive_days_with_label (pura) -----------------------------------------


def test_consecutive_days_empty_list():
    assert _consecutive_days_with_label([], lambda d: True) == 0


def test_consecutive_days_all_match():
    daily = [{"x": 1}] * 5
    assert _consecutive_days_with_label(daily, lambda d: d["x"] == 1) == 5


def test_consecutive_days_none_match():
    daily = [{"x": 2}] * 5
    assert _consecutive_days_with_label(daily, lambda d: d["x"] == 1) == 0


def test_consecutive_days_stops_at_first_non_match_from_the_end():
    daily = [{"x": 1}, {"x": 2}, {"x": 1}, {"x": 1}]
    assert _consecutive_days_with_label(daily, lambda d: d["x"] == 1) == 2


# --- Regla 1: sobrecarga/capacidad crítica ---------------------------------------


def test_no_capacity_alert_when_estado_alta(user, monkeypatch):
    _mock_dependencies(monkeypatch)
    alerts = compute_alerts(user=user, now=NOW)
    assert not [a for a in alerts if a["rule"] in ("sobrecarga_proyectada", "capacidad_critica")]


def test_sobrecarga_alert_is_red(user, monkeypatch):
    _mock_dependencies(monkeypatch, capacity={"estado": "sobrecarga", "disponible": -5, "disponible_pct": -15})
    alerts = compute_alerts(user=user, now=NOW)
    alert = next(a for a in alerts if a["rule"] == "sobrecarga_proyectada")
    assert alert["severity"] == "red"


def test_capacidad_critica_alert_is_orange(user, monkeypatch):
    _mock_dependencies(monkeypatch, capacity={"estado": "no-asignar", "disponible": 2, "disponible_pct": 5})
    alerts = compute_alerts(user=user, now=NOW)
    alert = next(a for a in alerts if a["rule"] == "capacidad_critica")
    assert alert["severity"] == "orange"


# --- Regla 2: subutilización prolongada -------------------------------------------


def test_subutilizacion_prolongada_alert_at_threshold(user, monkeypatch):
    daily = [{"kind": "normal", "label": "Subutilización"} for _ in range(3)]
    _mock_dependencies(monkeypatch, carga_history={"daily": daily})
    alerts = compute_alerts(user=user, now=NOW)
    alert = next(a for a in alerts if a["rule"] == "subutilizacion_prolongada")
    assert alert["severity"] == "yellow"
    assert "3 días" in alert["message"]


def test_no_subutilizacion_alert_below_threshold(user, monkeypatch):
    daily = [{"kind": "normal", "label": "Subutilización"} for _ in range(2)]
    _mock_dependencies(monkeypatch, carga_history={"daily": daily})
    alerts = compute_alerts(user=user, now=NOW)
    assert not [a for a in alerts if a["rule"] == "subutilizacion_prolongada"]


# --- Regla 3: tareas vencidas -----------------------------------------------------


def test_tareas_vencidas_orange_at_threshold(user, monkeypatch):
    _mock_dependencies(monkeypatch)
    for _ in range(3):
        _task(user, end_date=datetime(2026, 8, 1, tzinfo=dt_timezone.utc))
    alerts = compute_alerts(user=user, now=NOW)
    alert = next(a for a in alerts if a["rule"] == "tareas_vencidas")
    assert alert["severity"] == "orange"


def test_tareas_vencidas_red_at_double_threshold(user, monkeypatch):
    _mock_dependencies(monkeypatch)
    for _ in range(6):
        _task(user, end_date=datetime(2026, 8, 1, tzinfo=dt_timezone.utc))
    alerts = compute_alerts(user=user, now=NOW)
    alert = next(a for a in alerts if a["rule"] == "tareas_vencidas")
    assert alert["severity"] == "red"


def test_tareas_vencidas_mentions_alta_priority_count(user, monkeypatch):
    _mock_dependencies(monkeypatch)
    _task(user, end_date=datetime(2026, 8, 1, tzinfo=dt_timezone.utc), priority="ALTA")
    for _ in range(5):
        _task(user, end_date=datetime(2026, 8, 1, tzinfo=dt_timezone.utc))
    alerts = compute_alerts(user=user, now=NOW)
    alert = next(a for a in alerts if a["rule"] == "tareas_vencidas")
    assert "1 de prioridad Alta" in alert["message"]


def test_no_tareas_vencidas_alert_below_threshold(user, monkeypatch):
    _mock_dependencies(monkeypatch)
    for _ in range(2):
        _task(user, end_date=datetime(2026, 8, 1, tzinfo=dt_timezone.utc))
    alerts = compute_alerts(user=user, now=NOW)
    assert not [a for a in alerts if a["rule"] == "tareas_vencidas"]


# --- Regla 4: cumplimiento a la baja -----------------------------------------------


def test_cumplimiento_bajo_red_for_large_drop(user, monkeypatch):
    _mock_dependencies(monkeypatch, trends={"cumplimiento": {"mes_anterior": {"available": True, "direction": "empeoro", "absolute_diff": -25, "compared": 80, "current": 55}}})
    alerts = compute_alerts(user=user, now=NOW)
    alert = next(a for a in alerts if a["rule"] == "cumplimiento_bajo")
    assert alert["severity"] == "red"


def test_cumplimiento_bajo_yellow_for_small_drop(user, monkeypatch):
    _mock_dependencies(monkeypatch, trends={"cumplimiento": {"mes_anterior": {"available": True, "direction": "empeoro", "absolute_diff": -5, "compared": 80, "current": 75}}})
    alerts = compute_alerts(user=user, now=NOW)
    alert = next(a for a in alerts if a["rule"] == "cumplimiento_bajo")
    assert alert["severity"] == "yellow"


def test_no_cumplimiento_alert_when_improved(user, monkeypatch):
    _mock_dependencies(monkeypatch, trends={"cumplimiento": {"mes_anterior": {"available": True, "direction": "mejora", "absolute_diff": 10, "compared": 70, "current": 80}}})
    alerts = compute_alerts(user=user, now=NOW)
    assert not [a for a in alerts if a["rule"] == "cumplimiento_bajo"]


# --- Regla 5: horas extra de fin de semana inusuales -------------------------------


def test_horas_extra_inusuales_alert(user, monkeypatch):
    monthly = [
        {"weekend_hours": 2, "seguimiento_count": 0},
        {"weekend_hours": 2, "seguimiento_count": 0},
        {"weekend_hours": 10, "seguimiento_count": 0},
    ]
    _mock_dependencies(monkeypatch, monthly=monthly)
    alerts = compute_alerts(user=user, now=NOW)
    alert = next(a for a in alerts if a["rule"] == "horas_extra_inusuales")
    assert alert["severity"] == "yellow"


def test_no_horas_extra_alert_within_normal_range(user, monkeypatch):
    monthly = [{"weekend_hours": 2, "seguimiento_count": 0}, {"weekend_hours": 3, "seguimiento_count": 0}]
    _mock_dependencies(monkeypatch, monthly=monthly)
    alerts = compute_alerts(user=user, now=NOW)
    assert not [a for a in alerts if a["rule"] == "horas_extra_inusuales"]


# --- Regla 6: días consecutivos sobre el rango óptimo ------------------------------


def test_dias_consecutivos_sobrecarga_orange(user, monkeypatch):
    daily = [{"kind": "normal", "label": "Carga elevada"} for _ in range(3)]
    _mock_dependencies(monkeypatch, carga_history={"daily": daily})
    alerts = compute_alerts(user=user, now=NOW)
    alert = next(a for a in alerts if a["rule"] == "dias_consecutivos_sobrecarga")
    assert alert["severity"] == "orange"


def test_dias_consecutivos_sobrecarga_red_at_double_threshold(user, monkeypatch):
    daily = [{"kind": "normal", "label": "Sobrecarga"} for _ in range(6)]
    _mock_dependencies(monkeypatch, carga_history={"daily": daily})
    alerts = compute_alerts(user=user, now=NOW)
    alert = next(a for a in alerts if a["rule"] == "dias_consecutivos_sobrecarga")
    assert alert["severity"] == "red"


# --- Regla 7: caída de registros diarios ------------------------------------------


def test_caida_registros_alert(user, monkeypatch):
    weekly = [
        {"business_days": 5, "days_with_registration": 5},
        {"business_days": 5, "days_with_registration": 4},
        {"business_days": 5, "days_with_registration": 1},
    ]
    _mock_dependencies(monkeypatch, weekly=weekly)
    alerts = compute_alerts(user=user, now=NOW)
    alert = next(a for a in alerts if a["rule"] == "caida_registros")
    assert alert["severity"] == "yellow"


def test_no_caida_registros_alert_when_stable(user, monkeypatch):
    weekly = [{"business_days": 5, "days_with_registration": 4}, {"business_days": 5, "days_with_registration": 4}]
    _mock_dependencies(monkeypatch, weekly=weekly)
    alerts = compute_alerts(user=user, now=NOW)
    assert not [a for a in alerts if a["rule"] == "caida_registros"]


# --- Regla 8: crecimiento de actividades de seguimiento ----------------------------


def test_crecimiento_seguimiento_alert(user, monkeypatch):
    monthly = [
        {"weekend_hours": 0, "seguimiento_count": 2},
        {"weekend_hours": 0, "seguimiento_count": 2},
        {"weekend_hours": 0, "seguimiento_count": 10},
    ]
    _mock_dependencies(monkeypatch, monthly=monthly)
    alerts = compute_alerts(user=user, now=NOW)
    alert = next(a for a in alerts if a["rule"] == "crecimiento_seguimiento")
    assert alert["severity"] == "yellow"


def test_no_crecimiento_seguimiento_when_stable(user, monkeypatch):
    monthly = [{"weekend_hours": 0, "seguimiento_count": 5}, {"weekend_hours": 0, "seguimiento_count": 5}]
    _mock_dependencies(monkeypatch, monthly=monthly)
    alerts = compute_alerts(user=user, now=NOW)
    assert not [a for a in alerts if a["rule"] == "crecimiento_seguimiento"]


# --- Orden y auditoría --------------------------------------------------------------


def test_alerts_sorted_by_severity_descending(user, monkeypatch):
    daily = [{"kind": "normal", "label": "Subutilización"} for _ in range(3)]
    _mock_dependencies(monkeypatch, capacity={"estado": "sobrecarga", "disponible": -5, "disponible_pct": -15}, carga_history={"daily": daily})
    alerts = compute_alerts(user=user, now=NOW)
    ranks = [module.SEVERITY_RANK[a["severity"]] for a in alerts]
    assert ranks == sorted(ranks, reverse=True)


def test_compute_alerts_writes_minimal_audit_log(user, monkeypatch):
    _mock_dependencies(monkeypatch, capacity={"estado": "sobrecarga", "disponible": -5, "disponible_pct": -15})
    alerts = compute_alerts(user=user, now=NOW)
    log = AnalyticsAuditLog.objects.get(user=user, kind="alerts")
    assert log.result["alerts"] == [a["rule"] for a in alerts]
    assert log.result["formula_versions"] == {}


def test_no_alerts_when_everything_neutral(user, monkeypatch):
    _mock_dependencies(monkeypatch)
    assert compute_alerts(user=user, now=NOW) == []


# --- get_resolved_alerts_history ---------------------------------------------------


def test_resolved_alerts_empty_without_history(user):
    assert get_resolved_alerts_history(user=user, current_alerts=[], now=NOW) == []


def test_resolved_alerts_finds_rule_no_longer_active(user):
    real_now = timezone.now()
    log = AnalyticsAuditLog.objects.create(
        user=user, kind="alerts", period="2026-07", result={"alerts": ["tareas_vencidas", "cumplimiento_bajo"]}, engine_version="1.5.0"
    )
    AnalyticsAuditLog.objects.filter(pk=log.pk).update(created_at=real_now - timedelta(days=5))

    current = [{"rule": "cumplimiento_bajo", "severity": "yellow", "message": "", "suggested_action": "", "detected_at": ""}]
    resolved = get_resolved_alerts_history(user=user, current_alerts=current, now=real_now)

    assert len(resolved) == 1
    assert resolved[0]["rule"] == "tareas_vencidas"
    assert resolved[0]["message"] == "Tareas vencidas"
    assert resolved[0]["days_ago"] == 5


def test_resolved_alerts_excludes_still_active_rules(user):
    real_now = timezone.now()
    AnalyticsAuditLog.objects.create(user=user, kind="alerts", period="2026-07", result={"alerts": ["tareas_vencidas"]}, engine_version="1.5.0")
    current = [{"rule": "tareas_vencidas", "severity": "orange", "message": "", "suggested_action": "", "detected_at": ""}]
    resolved = get_resolved_alerts_history(user=user, current_alerts=current, now=real_now)
    assert resolved == []


def test_resolved_alerts_caps_at_3(user):
    AnalyticsAuditLog.objects.create(
        user=user, kind="alerts", period="2026-07",
        result={"alerts": ["sobrecarga_proyectada", "capacidad_critica", "subutilizacion_prolongada", "tareas_vencidas"]},
        engine_version="1.5.0",
    )
    resolved = get_resolved_alerts_history(user=user, current_alerts=[], now=timezone.now())
    assert len(resolved) == 3


def test_resolved_alerts_unknown_rule_falls_back_to_rule_name(user):
    AnalyticsAuditLog.objects.create(user=user, kind="alerts", period="2026-07", result={"alerts": ["un_rule_desconocida"]}, engine_version="1.5.0")
    resolved = get_resolved_alerts_history(user=user, current_alerts=[], now=timezone.now())
    assert resolved[0]["message"] == "un_rule_desconocida"
