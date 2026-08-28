"""Motor de normalización — Fase 4d (ver docs/AUDIT_LOG.md § 2026-08-11).
Réplica exacta de `src/lib/normalizationEngine.ts`: interpolación lineal
por tramos entre puntos de control configurables, clamada a [0,100]."""

import json
import math
from datetime import datetime
from typing import Literal, TypedDict

from apps.core.rounding import round_half_up

CurveName = Literal["cumplimiento", "vencidas", "carga", "capacidad", "consistencia", "trazabilidad"]


class CurvePoint(TypedDict):
    x: float
    y: float


DEFAULT_CURVES: dict[CurveName, list[CurvePoint]] = {
    "cumplimiento": [{"x": 0, "y": 0}, {"x": 100, "y": 100}],
    "vencidas": [{"x": 0, "y": 100}, {"x": 10, "y": 0}],
    "carga": [
        {"x": 0, "y": 15},
        {"x": 50, "y": 35},
        {"x": 85, "y": 75},
        {"x": 100, "y": 100},
        {"x": 115, "y": 75},
        {"x": 130, "y": 40},
        {"x": 160, "y": 10},
    ],
    "capacidad": [
        {"x": -50, "y": 0},
        {"x": 0, "y": 20},
        {"x": 10, "y": 40},
        {"x": 20, "y": 70},
        {"x": 40, "y": 100},
        {"x": 100, "y": 100},
    ],
    "consistencia": [{"x": 0, "y": 0}, {"x": 100, "y": 100}],
    "trazabilidad": [{"x": 0, "y": 0}, {"x": 100, "y": 100}],
}


def interpolate_curve(x: float, points: list[CurvePoint]) -> float:
    """Interpolación lineal por tramos, clamada en los extremos — pura."""
    if not points:
        return 0
    sorted_points = sorted(points, key=lambda p: p["x"])
    if not math.isfinite(x):
        return sorted_points[0]["y"]
    if x <= sorted_points[0]["x"]:
        return sorted_points[0]["y"]
    if x >= sorted_points[-1]["x"]:
        return sorted_points[-1]["y"]
    for a, b in zip(sorted_points, sorted_points[1:], strict=False):
        if a["x"] <= x <= b["x"]:
            if b["x"] == a["x"]:
                return a["y"]
            t = (x - a["x"]) / (b["x"] - a["x"])
            return a["y"] + t * (b["y"] - a["y"])
    return sorted_points[-1]["y"]


def normalize(curve_name: CurveName, raw_value: float, points: list[CurvePoint] | None = None) -> float:
    """Normaliza `raw_value` a un puntaje 0-100 según `curve_name`, usando
    `points` (o el default si no se pasan o son inválidos). Resultado
    siempre acotado a [0,100] y redondeado a 1 decimal."""
    curve = points if points and len(points) >= 2 else DEFAULT_CURVES[curve_name]
    y = interpolate_curve(raw_value, curve)
    clamped = max(0.0, min(100.0, y))
    return round_half_up(clamped * 10) / 10


def is_valid_curve(points) -> bool:
    """Válida si tiene >=2 puntos con x/y finitos e y en [0,100] — usado
    al guardar configuración desde Ajustes."""
    if not isinstance(points, list) or len(points) < 2:
        return False
    for p in points:
        if not isinstance(p, dict):
            return False
        x, y = p.get("x"), p.get("y")
        if not isinstance(x, (int, float)) or isinstance(x, bool) or not math.isfinite(x):
            return False
        if not isinstance(y, (int, float)) or isinstance(y, bool) or not math.isfinite(y):
            return False
        if not (0 <= y <= 100):
            return False
    return True


_CURVE_CONFIG_KEY: dict[CurveName, str] = {
    "cumplimiento": "analytics_curve_cumplimiento",
    "vencidas": "analytics_curve_vencidas",
    "carga": "analytics_curve_carga",
    "capacidad": "analytics_curve_capacidad",
    "consistencia": "analytics_curve_consistencia",
    "trazabilidad": "analytics_curve_trazabilidad",
}


def get_effective_curve(name: CurveName, as_of: datetime) -> list[CurvePoint]:
    """Curva de normalización vigente en `as_of` — JSON en
    `SystemConfigHistory` (vía `apps.configuration.services`, única
    dirección de dependencia válida entre estas 2 apps), réplica de
    `getEffectiveCurve`. Fallback a `DEFAULT_CURVES[name]` si no hay
    override o el JSON es inválido."""
    from apps.configuration.services import get_effective_config_string

    raw = get_effective_config_string(_CURVE_CONFIG_KEY[name], as_of, "")
    if not raw:
        return DEFAULT_CURVES[name]
    try:
        parsed = json.loads(raw)
    except ValueError:
        return DEFAULT_CURVES[name]
    return parsed if is_valid_curve(parsed) else DEFAULT_CURVES[name]


def get_all_effective_curves(as_of: datetime) -> dict[CurveName, list[CurvePoint]]:
    return {name: get_effective_curve(name, as_of) for name in _CURVE_CONFIG_KEY}


def set_curve_config(name: CurveName, points: list[CurvePoint], actor) -> None:
    """Réplica de `setCurveConfig` — Fase 32 (ver docs/AUDIT_LOG.md §
    2026-08-21), primer consumidor HTTP de este motor de curvas desde
    la Fase 4d. `points` ya viene validado (`is_valid_curve`) por el
    caller (`apps.configuration.views.NormalizationCurvesView`)."""
    from apps.configuration.services import set_config_value

    set_config_value(_CURVE_CONFIG_KEY[name], json.dumps(points), actor)
