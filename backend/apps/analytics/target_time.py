"""Tiempo Objetivo — Fase 4d (ver docs/AUDIT_LOG.md § 2026-08-11).
Subset puro de `src/lib/targetTime.ts`: solo lo que consumen
`compute_data_quality`/`compute_target_time_precision`
(`computeDeviation`/`canValidateTargetTime`/catálogo de razones no lo
usa ninguna función de esta sub-fase — se porta cuando haga falta)."""

from typing import Literal

from apps.core.rounding import round_half_up

PrecisionClassification = Literal["Excelente", "Buena", "Aceptable", "Baja", "Muy baja"]


def is_target_time_validated(target_time_validated: float | None) -> bool:
    return target_time_validated is not None


def get_official_target_time(estimated_hours: float, target_time_validated: float | None) -> float:
    return target_time_validated if target_time_validated is not None else estimated_hours


def compute_precision_pct(real_hours: float, official_target: float) -> float | None:
    """`None` si el objetivo es <= 0 (no se puede calcular precisión sin
    un objetivo válido). Resultado en puntos 0-100, 1 decimal."""
    if official_target <= 0:
        return None
    raw = 1 - abs(real_hours - official_target) / official_target
    return round_half_up(max(0.0, raw) * 1000) / 10


def precision_classification(pct: float) -> PrecisionClassification:
    if pct >= 90:
        return "Excelente"
    if pct >= 75:
        return "Buena"
    if pct >= 60:
        return "Aceptable"
    if pct >= 40:
        return "Baja"
    return "Muy baja"
