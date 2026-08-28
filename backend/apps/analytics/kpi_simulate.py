"""Simulador interactivo de KPIs individuales (§9, ampliado en Sprint
A) — Fase 23 (ver docs/AUDIT_LOG.md § 2026-08-20). Réplica exacta de
`src/app/api/analytics/simulate/[userId]/route.ts` — 8 escenarios que
NUNCA persisten nada, solo recalculan en memoria a partir del estado
real actual usando las MISMAS funciones puras del motor. Distinto del
simulador de Inteligencia Preventiva (`simulate_engine.py`, Fase 9c,
3 escenarios sobre predicciones) — este es el simulador MÁS ANTIGUO,
directamente sobre Equilibrio Operativo/Performance Score/Carga/
Capacidad Proyectada, sin tocar el motor de predicción.

Los 4 escenarios originales (`assign_task`/`daily_hours`/`vacation`/
`permiso`) solo afectan Carga/Capacidad/Equilibrio Operativo — por
diseño el Performance Score no pondera horas ni capacidad, se
mantiene idéntico al valor real en esos casos (no es un error, es la
separación de responsabilidades ya documentada en
`compute_performance_score`). Los 4 escenarios de Sprint A
(`complete_task`/`reduce_overdue`/`increase_consistency`, más
`register_hours`) afectan Performance Score o Carga recalculando UN
SOLO factor con la curva/peso reales, dejando los otros intactos."""

from datetime import datetime

from apps.configuration.services import get_effective_horas_efectivas
from apps.core.rounding import round_half_up
from apps.tasks.business_time import business_calendar_day

from .capacity_forecast import classify_capacity, compute_capacity_forecast
from .health_score import capacity_to_score, carga_health_score, compute_health_score
from .history import compute_monthly_history
from .normalization import get_effective_curve, normalize
from .performance_score import classify_performance_score, compute_performance_score
from .scoring import weighted_points
from .workload import (
    compute_carga_tiempo,
    compute_workload_pct,
    compute_workload_range,
    monthly_business_base,
)


def _round2(x: float) -> float:
    return round_half_up(x * 100) / 100


def _num(body: dict, key: str) -> float | None:
    value = body.get(key)
    return value if isinstance(value, (int, float)) and not isinstance(value, bool) else None


def is_valid_scenario(body: object) -> bool:
    """Réplica exacta de `isValidScenario`."""
    if not isinstance(body, dict) or "type" not in body:
        return False
    scenario_type = body.get("type")

    if scenario_type == "assign_task":
        hours = _num(body, "hours")
        return hours is not None and 0 < hours < 1000
    if scenario_type == "daily_hours":
        value = _num(body, "new_hours_per_day")
        return value is not None and 0 < value <= 24
    if scenario_type == "vacation":
        days = _num(body, "days")
        return days is not None and 0 < days <= 60
    if scenario_type == "permiso":
        hours = _num(body, "hours")
        return hours is not None and 0 < hours < 200
    if scenario_type == "register_hours":
        hours = _num(body, "hours")
        return hours is not None and 0 < hours < 200
    if scenario_type == "complete_task":
        count = _num(body, "count")
        return count is not None and 0 < count <= 50
    if scenario_type == "reduce_overdue":
        count = _num(body, "count")
        alta = _num(body, "alta")
        return count is not None and 0 < count <= 50 and alta is not None and 0 <= alta <= count
    if scenario_type == "increase_consistency":
        delta = _num(body, "delta_points")
        return delta is not None and 0 < delta <= 100
    return False


def _find_factor(factors: list[dict], name: str) -> dict:
    return next(f for f in factors if f["name"] == name)


def simulate_kpi_scenario(*, user, body: dict, now: datetime) -> dict:
    """Réplica exacta del cuerpo de `POST /api/analytics/simulate/[userId]`
    una vez validado el escenario (la validación de forma vive en la
    vista, igual que el resto de las vistas de esta app)."""
    today = business_calendar_day(now)
    year, month = today.year, today.month

    biz = monthly_business_base(year, month)
    hours_per_day = get_effective_horas_efectivas(now)
    carga_tiempo = compute_carga_tiempo(user=user, now=now)
    capacity = compute_capacity_forecast(user=user, now=now)
    health_score = compute_health_score(user=user, now=now)
    monthly_point = compute_monthly_history(user=user, months_back=1, now=now)[0]
    performance_score = compute_performance_score(user=user, now=now)

    before = {
        "carga_pct": carga_tiempo["mensual"]["pct"],
        "carga_label": carga_tiempo["mensual"]["label"],
        "carga_color": carga_tiempo["mensual"]["color"],
        "capacidad_disponible_pct": capacity["disponible_pct"],
        "capacidad_disponible_horas": capacity["disponible"],
        "cumplimiento_pct": monthly_point["completed_pct"],
        "health_score": health_score["score"],
        "health_classification": health_score["classification"],
        "performance_score_pts": performance_score["score"],
        "performance_score_class": performance_score["classification"],
    }

    # Factor "Capacidad futura" y "Carga laboral" del Equilibrio Operativo —
    # se recalculan con el escenario aplicado y se reinsertan en la suma
    # total, sin volver a consultar el resto de factores (no cambian en
    # ningún escenario).
    capacity_factor = _find_factor(health_score["factors"], "Capacidad futura")
    carga_factor = _find_factor(health_score["factors"], "Carga laboral")
    other_health_points = sum(
        f["points"] for f in health_score["factors"] if f["name"] not in ("Capacidad futura", "Carga laboral")
    )

    def recombine_health(new_capacity_points: float, new_carga_points: float) -> tuple[float, str]:
        score = _round2(other_health_points + new_capacity_points + new_carga_points)
        classification = "Excelente" if score >= 90 else "Bueno" if score >= 75 else "Riesgo" if score >= 60 else "Crítico"
        return score, classification

    # Sprint A — recalcula UN factor de Performance Score con la curva/
    # peso reales (`normalize`/`weighted_points`, iguales a
    # `compute_performance_score`) y lo recombina con los otros 3
    # factores YA calculados, sin tocarlos.
    def recombine_performance(factor_name: str, new_raw_value: float) -> tuple[float, str]:
        factor = _find_factor(performance_score["factors"], factor_name)
        curve_points = get_effective_curve(factor["curve"], now)
        new_normalized = normalize(factor["curve"], new_raw_value, curve_points)
        new_points = weighted_points(new_normalized, factor["weight"])
        other_points = sum(f["points"] for f in performance_score["factors"] if f["name"] != factor_name)
        score = _round2(other_points + new_points)
        return score, classify_performance_score(score)["classification"]

    scenario_type = body["type"]
    after = dict(before)

    if scenario_type == "assign_task":
        hours = body["hours"]
        new_disponible = _round2(capacity["disponible"] - hours)
        new_disponible_pct = round_half_up(new_disponible / capacity["base_futura_total"] * 100) if capacity["base_futura_total"] > 0 else 0
        cls = classify_capacity(new_disponible, capacity["base_futura_total"], new_disponible_pct)
        new_capacity_score = capacity_to_score(cls["estado"], new_disponible_pct)
        # La carga laboral (horas ya trabajadas este mes) no cambia al
        # asignar una tarea nueva todavía sin iniciar — se conserva el
        # puntaje de carga actual.
        score, classification = recombine_health(weighted_points(new_capacity_score, capacity_factor["weight"]), carga_factor["points"])
        after.update(
            {
                "capacidad_disponible_pct": new_disponible_pct, "capacidad_disponible_horas": new_disponible,
                "health_score": score, "health_classification": classification,
            }
        )

    elif scenario_type == "daily_hours":
        new_hours_per_day = body["new_hours_per_day"]
        ratio = new_hours_per_day / hours_per_day if hours_per_day > 0 else 1
        new_base_hours = _round2(biz["limit_base_hours"] * ratio)
        new_limit_low = biz["limit_low_hours"] * ratio
        new_limit_high = biz["limit_high_hours"] * ratio
        new_limit_overload = biz["limit_overload_hours"] * ratio
        range_ = compute_workload_range(carga_tiempo["mensual"]["real_hours"], new_base_hours, new_limit_low, new_limit_high, new_limit_overload)
        pct = compute_workload_pct(carga_tiempo["mensual"]["real_hours"], new_base_hours, range_["max"])

        new_base_futura_total = _round2(capacity["base_futura_total"] * ratio)
        new_disponible = _round2(new_base_futura_total - capacity["comprometido_futuro"])
        new_disponible_pct = round_half_up(new_disponible / new_base_futura_total * 100) if new_base_futura_total > 0 else 0
        cls = classify_capacity(new_disponible, new_base_futura_total, new_disponible_pct)

        new_carga_score = carga_health_score(carga_tiempo["mensual"]["real_hours"], new_base_hours, new_limit_high, new_limit_overload)
        new_capacity_score = capacity_to_score(cls["estado"], new_disponible_pct)
        score, classification = recombine_health(
            weighted_points(new_capacity_score, capacity_factor["weight"]), weighted_points(new_carga_score, carga_factor["weight"])
        )

        after.update(
            {
                "carga_pct": pct, "carga_label": range_["label"], "carga_color": range_["color"],
                "capacidad_disponible_pct": new_disponible_pct, "capacidad_disponible_horas": new_disponible,
                "health_score": score, "health_classification": classification,
            }
        )

    elif scenario_type == "vacation":
        days = body["days"]
        reduction = _round2(days * hours_per_day)
        new_base_futura_total = max(0.0, _round2(capacity["base_futura_total"] - reduction))
        new_disponible = _round2(new_base_futura_total - capacity["comprometido_futuro"])
        new_disponible_pct = round_half_up(new_disponible / new_base_futura_total * 100) if new_base_futura_total > 0 else 0
        cls = classify_capacity(new_disponible, new_base_futura_total, new_disponible_pct)
        new_capacity_score = capacity_to_score(cls["estado"], new_disponible_pct)
        # Las vacaciones futuras no modifican las horas ya trabajadas este
        # mes — el puntaje de carga se conserva.
        score, classification = recombine_health(weighted_points(new_capacity_score, capacity_factor["weight"]), carga_factor["points"])
        after.update(
            {
                "capacidad_disponible_pct": new_disponible_pct, "capacidad_disponible_horas": new_disponible,
                "health_score": score, "health_classification": classification,
            }
        )

    elif scenario_type == "permiso":
        # permiso: reduce tanto la base mensual de carga (menos horas
        # objetivo este mes) como la capacidad futura restante.
        hours = body["hours"]
        new_base_hours = max(0.0, _round2(biz["limit_base_hours"] - hours))
        new_limit_high = max(0.0, biz["limit_high_hours"] - hours)
        new_limit_overload = max(0.0, biz["limit_overload_hours"] - hours)
        range_ = compute_workload_range(
            carga_tiempo["mensual"]["real_hours"], new_base_hours, max(0.0, biz["limit_low_hours"] - hours), new_limit_high, new_limit_overload
        )
        pct = compute_workload_pct(carga_tiempo["mensual"]["real_hours"], new_base_hours, range_["max"])

        new_base_futura_total = max(0.0, _round2(capacity["base_futura_total"] - hours))
        new_disponible = _round2(new_base_futura_total - capacity["comprometido_futuro"])
        new_disponible_pct = round_half_up(new_disponible / new_base_futura_total * 100) if new_base_futura_total > 0 else 0
        cls = classify_capacity(new_disponible, new_base_futura_total, new_disponible_pct)

        new_carga_score = carga_health_score(carga_tiempo["mensual"]["real_hours"], new_base_hours, new_limit_high, new_limit_overload)
        new_capacity_score = capacity_to_score(cls["estado"], new_disponible_pct)
        score, classification = recombine_health(
            weighted_points(new_capacity_score, capacity_factor["weight"]), weighted_points(new_carga_score, carga_factor["weight"])
        )

        after.update(
            {
                "carga_pct": pct, "carga_label": range_["label"], "carga_color": range_["color"],
                "capacidad_disponible_pct": new_disponible_pct, "capacidad_disponible_horas": new_disponible,
                "health_score": score, "health_classification": classification,
            }
        )

    elif scenario_type == "register_hours":
        # Horas adicionales YA trabajadas este mes — sube la Carga
        # Laboral real, no cambia la capacidad futura (eso es proyección
        # hacia adelante) ni el Performance Score (que por diseño nunca
        # pondera horas trabajadas).
        hours = body["hours"]
        new_real_hours = _round2(carga_tiempo["mensual"]["real_hours"] + hours)
        range_ = compute_workload_range(new_real_hours, biz["limit_base_hours"], biz["limit_low_hours"], biz["limit_high_hours"], biz["limit_overload_hours"])
        pct = compute_workload_pct(new_real_hours, biz["limit_base_hours"], range_["max"])
        new_carga_score = carga_health_score(new_real_hours, biz["limit_base_hours"], biz["limit_high_hours"], biz["limit_overload_hours"])
        score, classification = recombine_health(capacity_factor["points"], weighted_points(new_carga_score, carga_factor["weight"]))
        after.update(
            {
                "carga_pct": pct, "carga_label": range_["label"], "carga_color": range_["color"],
                "health_score": score, "health_classification": classification,
            }
        )

    elif scenario_type == "complete_task":
        cumplimiento_factor = _find_factor(performance_score["factors"], "Cumplimiento")
        total_tasks = monthly_point["total_tasks"]
        completed = round_half_up(monthly_point["completed_pct"] / 100 * total_tasks)
        new_completed_pct = (
            round_half_up(min(completed + body["count"], total_tasks) / total_tasks * 100) if total_tasks > 0 else cumplimiento_factor["raw_value"]
        )
        score, classification = recombine_performance("Cumplimiento", new_completed_pct)
        after.update({"cumplimiento_pct": new_completed_pct, "performance_score_pts": score, "performance_score_class": classification})

    elif scenario_type == "reduce_overdue":
        # weightedOverdue = overdueNormal + overdueAlta×2 = count + alta
        # (ver Analytics Formulas §1).
        vencidas_factor = _find_factor(performance_score["factors"], "Tareas vencidas")
        reduction = body["count"] + body["alta"]
        new_weighted_overdue = max(0.0, _round2(vencidas_factor["raw_value"] - reduction))
        score, classification = recombine_performance("Tareas vencidas", new_weighted_overdue)
        after.update({"performance_score_pts": score, "performance_score_class": classification})

    else:  # increase_consistency
        consistencia_factor = _find_factor(performance_score["factors"], "Consistencia")
        new_consistency_raw = max(0.0, min(100.0, round_half_up((consistencia_factor["raw_value"] + body["delta_points"]) * 10) / 10))
        score, classification = recombine_performance("Consistencia", new_consistency_raw)
        after.update({"performance_score_pts": score, "performance_score_class": classification})

    diff = {
        "health_score": _round2(after["health_score"] - before["health_score"]),
        "performance_score": _round2(after["performance_score_pts"] - before["performance_score_pts"]),
    }
    return {"before": before, "after": after, "diff": diff, "scenario": body}
