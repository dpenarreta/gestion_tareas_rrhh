"""Cobertura de apps.analytics.explain — Fase 4j (ver docs/AUDIT_LOG.md §
2026-08-12). `cumplimiento_color` (Fase 4b) no tenía tests dedicados
todavía; se agregan junto con `score_level`/`derived_normalized_value`
(nuevas en esta sub-fase) por tocar el mismo archivo.
`reliability_pct_from_stars` se agrega en la Fase 16 (ver
docs/AUDIT_LOG.md § 2026-08-20)."""

import pytest

from apps.analytics.explain import (
    cumplimiento_color,
    derived_normalized_value,
    reliability_pct_from_observations,
    reliability_pct_from_stars,
    score_level,
)


@pytest.mark.parametrize("pct,expected", [(100, "green"), (80, "green"), (79.9, "yellow"), (60, "yellow"), (59.9, "red"), (0, "red")])
def test_cumplimiento_color_thresholds(pct, expected):
    assert cumplimiento_color(pct) == expected


@pytest.mark.parametrize(
    "value,expected",
    [(0, "Bajo"), (39.9, "Bajo"), (40, "Medio"), (69.9, "Medio"), (70, "Alto"), (89.9, "Alto"), (90, "Muy alto"), (100, "Muy alto")],
)
def test_score_level_thresholds(value, expected):
    assert score_level(value) == expected


def test_derived_normalized_value_zero_weight_returns_zero():
    assert derived_normalized_value(10, 0) == 0


def test_derived_normalized_value_computes_ratio():
    assert derived_normalized_value(20, 40) == 50.0


def test_derived_normalized_value_rounds_to_one_decimal():
    assert derived_normalized_value(10, 30) == 33.3


@pytest.mark.parametrize("stars,expected", [(2, 55), (3, 72), (4, 86), (5, 96)])
def test_reliability_pct_from_stars(stars, expected):
    assert reliability_pct_from_stars(stars) == expected


@pytest.mark.parametrize("observations,expected", [(0, 30), (6, 95), (4, 73), (12, 95)])
def test_reliability_pct_from_observations_caps_at_max(observations, expected):
    assert reliability_pct_from_observations(observations) == expected
