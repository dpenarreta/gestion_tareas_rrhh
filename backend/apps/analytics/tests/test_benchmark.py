"""Cobertura de apps.analytics.benchmark — Fase 22 (ver
docs/AUDIT_LOG.md § 2026-08-20), réplica de
`computeSmartBenchmark`/`computePersonalEvolution` (`src/lib/analytics.ts`,
Sprint 7)."""

from datetime import datetime, timedelta
from datetime import timezone as dt_timezone

import pytest
from django.contrib.auth.models import Group

from apps.analytics.benchmark import (
    build_cargo_benchmark,
    build_cargo_benchmark_carga,
    build_cargo_limitado_benchmark,
    build_personal_capacidad_futura,
    build_personal_from_audit_history,
    build_personal_from_work_history,
    compute_personal_evolution,
    compute_smart_benchmark,
)
from apps.analytics.models import AnalyticsAuditLog
from apps.users.models import User

pytestmark = pytest.mark.django_db

NOW = datetime(2026, 8, 20, 10, 0, tzinfo=dt_timezone.utc)


def _user_with_group(username: str, group_name: str) -> User:
    user = User.objects.create_user(username=username, email=f"{username}@example.com", password="Sup3r-Secr3t!")
    user.groups.set([Group.objects.get(name=group_name)])
    return user


def _perf_log(user, *, created_at: datetime, score: float) -> AnalyticsAuditLog:
    entry = AnalyticsAuditLog.objects.create(user=user, kind="performance_score", period="2026-08", inputs={}, result={"score": score}, engine_version="1.5.0")
    AnalyticsAuditLog.objects.filter(pk=entry.pk).update(created_at=created_at)
    return entry


# --- build_cargo_benchmark / build_cargo_benchmark_carga / build_cargo_limitado_benchmark --


def test_build_cargo_benchmark_higher_is_better():
    result = build_cargo_benchmark(80, [60, 70, 90], True)
    assert result["mode"] == "cargo"
    assert result["peer_average"] == 73.3
    assert result["best"] == 90
    assert result["peer_count"] == 3
    # notBetter = peers <= value (60, 70) → 2/3 = 67%
    assert result["percentile"] == 67


def test_build_cargo_benchmark_lower_is_better():
    result = build_cargo_benchmark(20, [10, 30, 50], False)
    assert result["best"] == 10
    # notBetter = peers >= value (30, 50) → 2/3 = 67%
    assert result["percentile"] == 67


def test_build_cargo_benchmark_carga_optimum_is_100():
    result = build_cargo_benchmark_carga(100, [80, 90, 130])
    assert result["best"] == 100
    assert result["percentile"] == 100


def test_build_cargo_limitado_benchmark_has_no_percentile_or_best():
    result = build_cargo_limitado_benchmark(80, [60, 70])
    assert result["mode"] == "cargo-limitado"
    assert "percentile" not in result
    assert "best" not in result
    assert result["peer_average"] == 65.0
    assert result["diff_from_average"] == 15.0


# --- build_personal_capacidad_futura ------------------------------------------------------


def test_build_personal_capacidad_futura_never_has_history():
    result = build_personal_capacidad_futura(42)
    assert result["mode"] == "personal"
    assert result["value"] == 42
    assert result["best_ever"] is None
    assert result["note"] is not None


# --- build_personal_from_audit_history ----------------------------------------------------


def test_build_personal_from_audit_history_empty_without_history():
    user = _user_with_group("solo1", "COORDINADOR_NACIONAL")
    result = build_personal_from_audit_history(user=user, kind="performance_score", value=80, target=None, now=NOW, higher_is_better=True)
    assert result["best_ever"] is None
    assert result["note"] == "Sin historial personal suficiente todavía."


def test_build_personal_from_audit_history_with_history_and_target():
    user = _user_with_group("solo2", "COORDINADOR_NACIONAL")
    _perf_log(user, created_at=NOW - timedelta(days=7), score=70)
    _perf_log(user, created_at=NOW - timedelta(days=30), score=60)
    _perf_log(user, created_at=NOW - timedelta(days=200), score=50)

    result = build_personal_from_audit_history(user=user, kind="performance_score", value=90, target=85, now=NOW, higher_is_better=True)
    assert result["best_ever"] == 70
    assert result["best_ever_diff"] == 20.0
    assert result["semana_anterior"] == 70
    assert result["mes_anterior"] == 60
    assert result["target"] == 85
    assert result["target_gap"] == 5.0
    assert result["note"] is None


# --- build_personal_from_work_history -----------------------------------------------------


def test_build_personal_from_work_history_empty_without_tasks():
    user = _user_with_group("solo3", "COORDINADOR_NACIONAL")
    result = build_personal_from_work_history(user=user, metric="cumplimiento", value=80, target=None, now=NOW, pick_best=max)
    assert result["best_ever"] is None
    assert result["note"] == "Sin historial personal suficiente todavía."


# --- compute_smart_benchmark: selección de modo -------------------------------------------


def test_compute_smart_benchmark_personal_mode_without_peers():
    user = _user_with_group("lonely", "COORDINADOR_NACIONAL")
    result = compute_smart_benchmark(user=user, now=NOW)
    assert result["mode"] == "personal"
    assert result["explain"]["peer_count"] == 0
    assert result["performance"]["mode"] == "personal"
    assert result["capacidad_futura"]["mode"] == "personal"


def test_compute_smart_benchmark_cargo_limitado_mode_with_two_peers():
    user = _user_with_group("u1", "ANALISTA_CC")
    _user_with_group("u2", "ANALISTA_CC")
    _user_with_group("u3", "ANALISTA_CC")
    result = compute_smart_benchmark(user=user, now=NOW)
    assert result["mode"] == "cargo-limitado"
    assert result["explain"]["peer_count"] == 2
    assert result["performance"]["mode"] == "cargo-limitado"


def test_compute_smart_benchmark_cargo_mode_with_three_or_more_peers():
    user = _user_with_group("v1", "ANALISTA_SELECCION")
    for i in range(3):
        _user_with_group(f"v_peer{i}", "ANALISTA_SELECCION")
    result = compute_smart_benchmark(user=user, now=NOW)
    assert result["mode"] == "cargo"
    assert result["explain"]["peer_count"] == 3
    assert result["performance"]["mode"] == "cargo"
    assert "percentile" in result["performance"]


def test_compute_smart_benchmark_never_crosses_roles():
    """Coordinador ZS y Analista CC comparten `ROLE_LEVEL` pero son
    cargos distintos — nunca deben contarse como pares entre sí."""
    user = _user_with_group("cz1", "COORDINADOR_ZS")
    _user_with_group("ac1", "ANALISTA_CC")
    _user_with_group("ac2", "ANALISTA_CC")
    result = compute_smart_benchmark(user=user, now=NOW)
    assert result["mode"] == "personal"
    assert result["explain"]["peer_count"] == 0


def test_compute_smart_benchmark_audits_calculation():
    user = _user_with_group("audited", "COORDINADOR_NACIONAL")
    compute_smart_benchmark(user=user, now=NOW)
    assert AnalyticsAuditLog.objects.filter(user=user, kind="smart_benchmark", period="2026-08").exists()


# --- compute_personal_evolution -------------------------------------------------------------


def test_compute_personal_evolution_unavailable_without_history():
    user = _user_with_group("evo1", "COORDINADOR_NACIONAL")
    result = compute_personal_evolution(user=user, current_score=80, now=NOW)
    assert result == {"available": False, "reason": "Sin historial personal todavía — vuelva a revisar en unos días.", "current": 80}


def test_compute_personal_evolution_trend_unavailable_with_short_span():
    user = _user_with_group("evo2", "COORDINADOR_NACIONAL")
    _perf_log(user, created_at=NOW - timedelta(days=10), score=70)
    result = compute_personal_evolution(user=user, current_score=80, now=NOW)
    assert result["available"] is True
    assert result["trend"] == {"available": False}


def test_compute_personal_evolution_trend_improved_vs_last_week():
    user = _user_with_group("evo3", "COORDINADOR_NACIONAL")
    _perf_log(user, created_at=NOW - timedelta(days=60), score=50)
    _perf_log(user, created_at=NOW - timedelta(days=7), score=70)
    result = compute_personal_evolution(user=user, current_score=90, now=NOW)
    assert result["available"] is True
    assert result["best_ever"] == 70
    assert result["worst_ever"] == 50
    assert result["trend"]["available"] is True
    assert result["trend"]["direction"] == "mejora"
    assert result["trend"]["basis"] == "semana anterior"
    assert result["observations"] == 2
