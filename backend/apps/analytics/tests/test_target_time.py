"""Cobertura del subset de apps.analytics.target_time — Fase 4d (ver
docs/AUDIT_LOG.md § 2026-08-11)."""

from apps.analytics.target_time import (
    compute_precision_pct,
    get_official_target_time,
    is_target_time_validated,
    precision_classification,
)


def test_is_target_time_validated_false_when_none():
    assert is_target_time_validated(None) is False


def test_is_target_time_validated_true_when_set():
    assert is_target_time_validated(5.0) is True


def test_get_official_target_time_prefers_validated():
    assert get_official_target_time(3.0, 5.0) == 5.0


def test_get_official_target_time_falls_back_to_estimated():
    assert get_official_target_time(3.0, None) == 3.0


def test_compute_precision_pct_none_when_target_zero_or_negative():
    assert compute_precision_pct(5, 0) is None
    assert compute_precision_pct(5, -1) is None


def test_compute_precision_pct_perfect_match_is_100():
    assert compute_precision_pct(5, 5) == 100.0


def test_compute_precision_pct_never_negative_beyond_total_deviation():
    # Desviación total o mayor -> 0, nunca negativo.
    assert compute_precision_pct(20, 5) == 0.0


def test_precision_classification_thresholds():
    assert precision_classification(95) == "Excelente"
    assert precision_classification(80) == "Buena"
    assert precision_classification(65) == "Aceptable"
    assert precision_classification(45) == "Baja"
    assert precision_classification(10) == "Muy baja"
