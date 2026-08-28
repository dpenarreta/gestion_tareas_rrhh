"""Capa complementaria de solo lectura sobre `AnalyticsAuditLog` — Fase 4j
(ver docs/AUDIT_LOG.md § 2026-08-12). Puerto parcial de
`src/lib/analyticsAuditHistory.ts`: `getFactorAuditHistory`/
`closestFactorPoint`, las 2 funciones que consume `insights_engine.py`
(`get_score_trend_explanation`) — y, desde la Fase 9 (ver
docs/AUDIT_LOG.md § 2026-08-18), `getScoreSeries` (`get_score_series`),
que sí gana consumidor con `trend_engine.py` (indicadores
Productividad/Equilibrio Operativo).

NO forma parte del motor oficial (`performance_score.py`/`health_score.py`/
`operational_risk.py`/`history.py`/`normalization.py`), que permanece como
única fuente de cálculo. Nunca recalcula un KPI: solo lee filas ya
escritas por `audit_calculation()` (best effort) — mismo criterio de
"nunca lanza, devuelve vacío" que el resto del motor."""

from datetime import datetime, timedelta
from typing import Literal

from .models import AnalyticsAuditLog

AuditKind = Literal["performance_score", "operational_risk", "health_score"]


def _parse_audit_result(result) -> dict:
    """Réplica exacta de `parseAuditResult` — extrae score/classification/
    factors de un `result` JSON ya persistido, tolerando forma inválida."""
    if not isinstance(result, dict):
        return {}
    score = result.get("score")
    if not isinstance(score, (int, float)) or isinstance(score, bool):
        score = None
    classification = result.get("classification")
    if not isinstance(classification, str):
        classification = None
    raw_factors = result.get("factors")
    factors: list[dict] = []
    if isinstance(raw_factors, list):
        for f in raw_factors:
            if not isinstance(f, dict):
                continue
            name = f.get("name")
            if not isinstance(name, str) or name == "":
                continue
            points = f.get("points")
            weight = f.get("weight")
            factors.append(
                {
                    "name": name,
                    "points": points if isinstance(points, (int, float)) and not isinstance(points, bool) else 0,
                    "weight": weight if isinstance(weight, (int, float)) and not isinstance(weight, bool) else 0,
                    "raw_label": f.get("raw_label") if isinstance(f.get("raw_label"), str) else None,
                    "detail": f.get("detail") if isinstance(f.get("detail"), str) else None,
                }
            )
    return {"score": score, "classification": classification, "factors": factors}


def get_factor_audit_history(*, user, kind: AuditKind, now: datetime, window_days: int) -> list[dict]:
    """Lee `AnalyticsAuditLog` para un `user`/`kind` dentro de una ventana
    de días, devolviendo score + factores tal como el motor los calculó y
    persistió (nunca recalculado aquí). Orden descendente (más reciente
    primero), igual convención que `getFactorAuditHistory`. Best-effort:
    nunca lanza."""
    window_start = now - timedelta(days=window_days)
    try:
        entries = list(
            AnalyticsAuditLog.objects.filter(user=user, kind=kind, created_at__gte=window_start, created_at__lt=now)
            .order_by("-created_at")
            .only("created_at", "period", "result")
        )
    except Exception:  # noqa: BLE001 — lectura best-effort, réplica fiel del TS (sin logging)
        return []

    points: list[dict] = []
    for entry in entries:
        parsed = _parse_audit_result(entry.result)
        if not isinstance(parsed.get("score"), (int, float)):
            continue
        point = {"created_at": entry.created_at, "period": entry.period, "score": parsed["score"], "factors": parsed["factors"]}
        if parsed.get("classification") is not None:
            point["classification"] = parsed["classification"]
        points.append(point)
    return points


def get_score_series(*, user, kind: AuditKind, now: datetime, window_days: int) -> list[dict]:
    """Serie {date, score} ascendente para gráficos de evolución — un
    punto por fila de auditoría (no se agrega/recalcula nada), réplica
    exacta de `getScoreSeries`."""
    history = get_factor_audit_history(user=user, kind=kind, now=now, window_days=window_days)
    ordered = sorted(history, key=lambda p: p["created_at"])
    return [{"date": p["created_at"].isoformat(), "score": p["score"]} for p in ordered]


def closest_factor_point(history: list[dict], now: datetime, days_ago: int, tolerance_days: int = 3) -> dict | None:
    """El punto con factores más cercano a "hace `days_ago` días", con
    tolerancia — mismo criterio que `closestScoredPoint`, reimplementado
    aquí porque esa función solo devuelve el score (no los factores).
    Réplica exacta de `closestFactorPoint`."""
    target = now - timedelta(days=days_ago)
    best: dict | None = None
    best_diff = None
    for point in history:
        diff = abs((point["created_at"] - target).total_seconds())
        if diff <= tolerance_days * 86400 and (best is None or diff < best_diff):
            best, best_diff = point, diff
    return best
