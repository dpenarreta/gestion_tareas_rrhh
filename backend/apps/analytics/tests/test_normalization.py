"""Cobertura de apps.analytics.normalization — Fase 4d (ver
docs/AUDIT_LOG.md § 2026-08-11)."""

from apps.analytics.normalization import (
    DEFAULT_CURVES,
    interpolate_curve,
    is_valid_curve,
    normalize,
)


def test_interpolate_curve_empty_points_returns_zero():
    assert interpolate_curve(50, []) == 0


def test_interpolate_curve_clamps_below_first_point():
    assert interpolate_curve(-10, [{"x": 0, "y": 15}, {"x": 100, "y": 100}]) == 15


def test_interpolate_curve_clamps_above_last_point():
    assert interpolate_curve(200, [{"x": 0, "y": 15}, {"x": 100, "y": 100}]) == 100


def test_interpolate_curve_linear_midpoint():
    assert interpolate_curve(50, [{"x": 0, "y": 0}, {"x": 100, "y": 100}]) == 50


def test_interpolate_curve_nan_returns_first_point():
    assert interpolate_curve(float("nan"), [{"x": 0, "y": 15}, {"x": 100, "y": 100}]) == 15


def test_normalize_identity_curve_cumplimiento():
    assert normalize("cumplimiento", 0) == 0
    assert normalize("cumplimiento", 100) == 100
    assert normalize("cumplimiento", 50) == 50


def test_normalize_vencidas_curve_matches_legacy_linear_formula():
    # x=1 (1 tarea vencida normal) -> 100 - 10*1 = 90 en el tramo lineal legacy.
    assert normalize("vencidas", 1) == 90


def test_normalize_carga_curve_peaks_at_100():
    assert normalize("carga", 100) == 100


def test_normalize_clamped_to_0_100_even_with_custom_out_of_range_curve():
    result = normalize("cumplimiento", 50, points=[{"x": 0, "y": -50}, {"x": 100, "y": 200}])
    assert 0 <= result <= 100


def test_normalize_falls_back_to_default_when_custom_curve_has_1_point():
    assert normalize("cumplimiento", 50, points=[{"x": 0, "y": 0}]) == 50


def test_default_curves_has_all_6_names():
    assert set(DEFAULT_CURVES.keys()) == {"cumplimiento", "vencidas", "carga", "capacidad", "consistencia", "trazabilidad"}


def test_is_valid_curve_requires_at_least_2_points():
    assert is_valid_curve([{"x": 0, "y": 0}]) is False
    assert is_valid_curve([{"x": 0, "y": 0}, {"x": 100, "y": 100}]) is True


def test_is_valid_curve_rejects_y_out_of_range():
    assert is_valid_curve([{"x": 0, "y": -1}, {"x": 100, "y": 100}]) is False
    assert is_valid_curve([{"x": 0, "y": 0}, {"x": 100, "y": 101}]) is False


def test_is_valid_curve_rejects_non_finite_values():
    assert is_valid_curve([{"x": 0, "y": 0}, {"x": float("inf"), "y": 100}]) is False
    assert is_valid_curve([{"x": 0, "y": 0}, {"x": float("nan"), "y": 100}]) is False


def test_is_valid_curve_rejects_non_list():
    assert is_valid_curve("not-a-list") is False
    assert is_valid_curve(None) is False
