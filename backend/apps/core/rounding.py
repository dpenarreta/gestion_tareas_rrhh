"""Fase 70 de la migración de stack (ver docs/AUDIT_LOG.md § 2026-08-26)
— hallazgo de un bug de producción activo, descubierto al verificar los
endpoints de Reportes Ejecutivos (Fases 68/69) contra `buildSnapshotData.ts`
con datos sintéticos reales en ambos lados.

`round()` de Python usa "banker's rounding" (redondeo al PAR más cercano
cuando el valor cae exactamente en .5: `round(0.5) == 0`, `round(1.5) ==
2`, `round(2.5) == 2`). `Math.round()` de JavaScript SIEMPRE redondea .5
hacia +Infinity (`Math.round(0.5) === 1`, `Math.round(1.5) === 2`,
`Math.round(2.5) === 3`). Todo el backend Django de esta migración es una
réplica línea por línea del TypeScript original — cualquier `round()`
que mirroree un `Math.round()` de TS con `round()` nativo de Python
diverge exactamente cuando el valor cae en .5, un caso nada raro en
promedios/porcentajes reales (confirmado con un caso real: `(33+100)/2
= 66.5` → TS da 67, Python nativo daba 66).

`round_half_up` reemplaza esos usos — real de este backend desde las
primeras fases del port (Fases 4a-4d, antes de esta sesión): un `grep`
de `apps/analytics/*.py` solo encontró 157 usos de `round(`, la mayoría
réplicas directas de un `Math.round()` de TS, varias ya en producción
desde el cutover de Analytics/KPIs (Fase 47) — este bug probablemente
ya afectaba números reales antes de esta fase, no es exclusivo de
`apps.reports` (Fases 64-69, donde se descubrió)."""

import math


def round_half_up(value: float, ndigits: int = 0) -> float | int:
    """Réplica exacta de `Math.round()` de JavaScript.

    `ndigits=0` (default) réplica `Math.round(value)` — devuelve `int`,
    igual que `round(value)` nativo de Python. `ndigits=n` réplica el
    patrón `Math.round(value * 10**n) / 10**n`, omnipresente en el TS
    original para redondear a `n` decimales — devuelve `float`, igual
    que `round(value, n)` nativo. `math.floor(value * factor + 0.5)`
    es aritmética IEEE 754 de doble precisión, idéntica bit a bit en
    Python y JavaScript — no hay margen de divergencia adicional por
    representación de punto flotante."""
    factor = 10**ndigits
    result = math.floor(value * factor + 0.5) / factor
    return result if ndigits else int(result)
