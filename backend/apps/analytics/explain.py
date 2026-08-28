from apps.core.rounding import round_half_up

"""Puerto parcial de `src/lib/analyticsExplain.ts` (199 líneas) — solo lo
que cada consumidor necesitó hasta ahora: `cumplimiento_color` (Fase 4b),
`score_level`/`derived_normalized_value` (Fase 4j, usadas por
`insights_engine.py`), `reliability_pct_from_stars` (Fase 16, usada por
las rutas delgadas de Equilibrio Operativo/Riesgo Operativo) y
`reliability_pct_from_observations` (Fase 22, ver docs/AUDIT_LOG.md §
2026-08-20, usada por Benchmarks Inteligente en modo "personal"). El
resto del archivo (`resultBarClass`, etc.) se porta cuando haga falta."""


def cumplimiento_color(pct: float) -> str:
    """Umbrales literales: >=80 verde, >=60 amarillo, si no rojo."""
    if pct >= 80:
        return "green"
    if pct >= 60:
        return "yellow"
    return "red"


def score_level(normalized_value: float) -> str:
    """Mismos umbrales que ScoreZoneBar (0-40-70-90-100) — réplica exacta
    de `scoreLevel`."""
    if normalized_value < 40:
        return "Bajo"
    if normalized_value < 70:
        return "Medio"
    if normalized_value < 90:
        return "Alto"
    return "Muy alto"


def derived_normalized_value(points: float, weight: float) -> float:
    """Invierte `points/weight` → valor normalizado 0-100 (1 decimal),
    para factores que solo traen `points`/`weight` (`HealthFactor`), sin
    el valor normalizado en sí. Réplica exacta de `derivedNormalizedValue`."""
    return round_half_up((points / weight) * 100 * 10) / 10 if weight > 0 else 0


_RELIABILITY_PCT_BY_STARS = {2: 55, 3: 72, 4: 86, 5: 96}


def reliability_pct_from_stars(stars: int) -> int:
    """Confiabilidad (%) a partir de las estrellas de
    `consistency_reliability_from_weeks` — réplica exacta de
    `reliabilityPctFromStars`."""
    return _RELIABILITY_PCT_BY_STARS[stars]


def reliability_pct_from_observations(observations: int, max_observations: int = 6) -> int:
    """Confiabilidad (%) a partir de una cantidad de observaciones/
    semanas frente a un máximo de referencia — usada donde no hay un
    `ConsistencyReliability` disponible (p. ej. Benchmark Personal en
    modo "personal"). Réplica exacta de `reliabilityPctFromObservations`."""
    ratio = max(0.0, min(1.0, observations / max_observations))
    return round_half_up(30 + ratio * 65)
