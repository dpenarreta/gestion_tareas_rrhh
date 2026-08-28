"""Cobertura de apps.core.rounding — Fase 70 de la migración de stack
(ver docs/AUDIT_LOG.md § 2026-08-26). `round_half_up` réplica
`Math.round()` de JavaScript, descubierto como necesario tras un
hallazgo real de divergencia de datos verificando Fases 68/69 contra
`buildSnapshotData.ts` con datos sintéticos."""

from apps.core.rounding import round_half_up


def test_round_half_up_matches_native_round_away_from_the_half_boundary():
    assert round_half_up(1.2) == 1
    assert round_half_up(1.8) == 2
    assert round_half_up(-1.2) == -1
    assert round_half_up(-1.8) == -2


def test_round_half_up_rounds_half_towards_positive_infinity_diverging_from_native_round():
    # round() nativo de Python usa banker's rounding — estos 3 casos son
    # exactamente donde diverge de Math.round() de JS.
    assert round(0.5) == 0
    assert round_half_up(0.5) == 1
    assert round(1.5) == 2
    assert round_half_up(1.5) == 2
    assert round(2.5) == 2
    assert round_half_up(2.5) == 3


def test_round_half_up_negative_half_rounds_towards_positive_infinity():
    # Math.round(-0.5) === 0 (no -1) en JS — mismo comportamiento acá,
    # y así sucesivamente: cada .5 negativo redondea hacia el entero
    # MAYOR (más cercano a +Infinity), no hacia el de mayor magnitud.
    assert round_half_up(-0.5) == 0
    assert round_half_up(-1.5) == -1
    assert round_half_up(-2.5) == -2


def test_round_half_up_returns_int_when_ndigits_omitted():
    assert isinstance(round_half_up(66.5), int)


def test_round_half_up_with_ndigits_matches_math_round_times_10n_pattern():
    # Réplica del patrón Math.round(value * 100) / 100 de TS. 0.125 (= 1/8)
    # es exactamente representable en binario — evita el ruido de punto
    # flotante de casos como 1.005 (que ni siquiera en JS redondea "bien").
    assert round(0.125, 2) == 0.12  # round() nativo: banker's rounding.
    assert round_half_up(0.125, 2) == 0.13
    assert round_half_up(1.0, 2) == 1.0
    assert isinstance(round_half_up(1.0, 2), float)


def test_round_half_up_real_world_case_found_during_fase_70_verification():
    # (33 + 100) / 2 = 66.5 — TS daba 67, round() nativo de Python daba 66.
    assert round_half_up((33 + 100) / 2) == 67
