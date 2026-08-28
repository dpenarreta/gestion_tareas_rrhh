"""Motor de Benchmarks Inteligente (Sprint 7) — Fase 22 (ver
docs/AUDIT_LOG.md § 2026-08-20). Réplica exacta de
`computeSmartBenchmark`/`computePersonalEvolution`
(`src/lib/analytics.ts`): decide automáticamente entre comparación por
cargo (n>=3 pares), promedio limitado (n==2) o Benchmark Personal
(n<=1) para 5 indicadores. NUNCA compara cargos distintos, NUNCA
modifica el cálculo de ningún KPI (el objetivo del cargo es solo
referencia), y NUNCA devuelve "sin compañeros" — siempre hay un
benchmark útil que mostrar."""

from datetime import datetime, timedelta

from apps.configuration.services import get_effective_role_target
from apps.core.rounding import round_half_up
from apps.hierarchy.services import get_role_group
from apps.tasks.business_time import business_calendar_day
from apps.users.models import User

from .audit_history import closest_factor_point, get_factor_audit_history
from .capacity_forecast import compute_capacity_forecast
from .history import compute_monthly_history, compute_weekly_history
from .models import ANALYTICS_ENGINE_VERSION
from .operational_risk import compute_operational_risk
from .performance_score import compute_performance_score
from .scoring import audit_calculation

PERSONAL_HISTORY_WINDOW_DAYS = 366


def _round1(x: float) -> float:
    return round_half_up(x * 10) / 10


def _empty_personal_metric(value: float, target: float | None, note: str) -> dict:
    return {
        "mode": "personal", "value": value,
        "best_ever": None, "best_ever_diff": None,
        "avg_last_90_days": None, "avg_last_90_days_diff": None,
        "semana_anterior": None, "semana_anterior_diff": None,
        "mes_anterior": None, "mes_anterior_diff": None,
        "target": target, "target_gap": _round1(value - target) if target is not None else None,
        "note": note,
    }


def compute_benchmark_metric_values(*, user, now: datetime) -> dict:
    """Reutiliza las MISMAS fuentes que `/kpis/executive` (Fase 21) —
    sin capa de caché con TTL, mismo gap ya aceptado."""
    performance = compute_performance_score(user=user, now=now)["score"]
    operational_risk = compute_operational_risk(user=user, now=now)["score"]
    monthly = compute_monthly_history(user=user, months_back=1, now=now)
    capacity = compute_capacity_forecast(user=user, now=now)
    current = monthly[-1] if monthly else None
    return {
        "performance": performance,
        "operational_risk": operational_risk,
        "cumplimiento": current["completed_pct"] if current else 0,
        "carga_laboral": current["carga_pct"] if current else 0,
        "capacidad_futura": capacity["disponible_pct"],
    }


# --- Nivel 1/2 — comparación entre pares del mismo cargo --------------------


def build_cargo_benchmark(value: float, peer_values: list[float], higher_is_better: bool) -> dict:
    peer_average = _round1(sum(peer_values) / len(peer_values))
    not_better = sum(1 for v in peer_values if (v <= value if higher_is_better else v >= value))
    percentile = round_half_up(not_better / len(peer_values) * 100)
    best = max(value, *peer_values) if higher_is_better else min(value, *peer_values)
    return {
        "mode": "cargo", "value": value, "peer_average": peer_average, "percentile": percentile,
        "best": best, "diff_from_average": _round1(value - peer_average), "peer_count": len(peer_values),
    }


def build_cargo_benchmark_carga(value: float, peer_values: list[float]) -> dict:
    """Carga laboral no tiene "más alto es mejor" — el óptimo es 100%.
    "Mejor"/percentil se miden por cercanía a 100, no por magnitud."""
    peer_average = _round1(sum(peer_values) / len(peer_values))

    def distance(v: float) -> float:
        return abs(v - 100)

    not_better = sum(1 for v in peer_values if distance(v) >= distance(value))
    percentile = round_half_up(not_better / len(peer_values) * 100)
    best = min([value, *peer_values], key=distance)
    return {
        "mode": "cargo", "value": value, "peer_average": peer_average, "percentile": percentile,
        "best": best, "diff_from_average": _round1(value - peer_average), "peer_count": len(peer_values),
    }


def build_cargo_limitado_benchmark(value: float, peer_values: list[float]) -> dict:
    peer_average = _round1(sum(peer_values) / len(peer_values))
    return {
        "mode": "cargo-limitado", "value": value, "peer_average": peer_average,
        "diff_from_average": _round1(value - peer_average), "peer_count": len(peer_values),
    }


# --- Nivel 3 — Benchmark Personal (cargo único) ------------------------------


def build_personal_from_audit_history(
    *, user, kind: str, value: float, target: float | None, now: datetime, higher_is_better: bool
) -> dict:
    """Performance Score y Riesgo Operativo: historial vía
    `AnalyticsAuditLog` (`get_factor_audit_history`, ya portada desde
    la Fase 4j/9)."""
    history = get_factor_audit_history(user=user, kind=kind, now=now, window_days=PERSONAL_HISTORY_WINDOW_DAYS)
    if not history:
        return _empty_personal_metric(value, target, "Sin historial personal suficiente todavía.")

    scores = [h["score"] for h in history]
    best_ever = max(scores) if higher_is_better else min(scores)
    last_90 = [h for h in history if h["created_at"] >= now - timedelta(days=90)]
    avg_last_90_days = _round1(sum(h["score"] for h in last_90) / len(last_90)) if last_90 else None
    semana_point = closest_factor_point(history, now, 7)
    semana_anterior = semana_point["score"] if semana_point else None
    mes_point = closest_factor_point(history, now, 30)
    mes_anterior = mes_point["score"] if mes_point else None

    return {
        "mode": "personal", "value": value,
        "best_ever": best_ever, "best_ever_diff": _round1(value - best_ever),
        "avg_last_90_days": avg_last_90_days,
        "avg_last_90_days_diff": _round1(value - avg_last_90_days) if avg_last_90_days is not None else None,
        "semana_anterior": semana_anterior,
        "semana_anterior_diff": _round1(value - semana_anterior) if semana_anterior is not None else None,
        "mes_anterior": mes_anterior,
        "mes_anterior_diff": _round1(value - mes_anterior) if mes_anterior is not None else None,
        "target": target, "target_gap": _round1(value - target) if target is not None else None,
        "note": None,
    }


def build_personal_from_work_history(*, user, metric: str, value: float, target: float | None, now: datetime, pick_best) -> dict:
    """Cumplimiento/Carga laboral: no viven en `AnalyticsAuditLog` — se
    recalculan siempre desde las tablas fuente (`compute_monthly_history`/
    `compute_weekly_history`), más preciso que muestrear auditoría.
    `pick_best` decide qué significa "mejor" (max para cumplimiento,
    más cercano a 100 para carga)."""
    monthly = compute_monthly_history(user=user, months_back=12, now=now)
    weekly = compute_weekly_history(user=user, weeks_back=6, now=now)

    if metric == "cumplimiento":
        months_with_data = [m for m in monthly if m["total_tasks"] > 0]
    else:
        months_with_data = [m for m in monthly if m["carga_base_hours"] > 0]
    if not months_with_data:
        return _empty_personal_metric(value, target, "Sin historial personal suficiente todavía.")

    monthly_points = [m["completed_pct"] if metric == "cumplimiento" else m["carga_pct"] for m in months_with_data]
    best_ever = pick_best(monthly_points)
    last_3_months = monthly_points[-3:]
    avg_last_90_days = _round1(sum(last_3_months) / len(last_3_months))

    prev_month = monthly[-2] if len(monthly) >= 2 else None
    prev_month_has_data = prev_month is not None and (
        prev_month["total_tasks"] > 0 if metric == "cumplimiento" else prev_month["carga_base_hours"] > 0
    )
    mes_anterior = (
        (prev_month["completed_pct"] if metric == "cumplimiento" else prev_month["carga_pct"]) if prev_month_has_data else None
    )

    weeks_with_data = [w for w in weekly if w["business_days"] > 0 and w["days_with_registration"] > 0]
    prev_week = weeks_with_data[-2] if len(weeks_with_data) >= 2 else None
    if prev_week is None:
        semana_anterior = None
    elif metric == "cumplimiento":
        semana_anterior = prev_week["completed_pct"]
    else:
        semana_anterior = round_half_up(prev_week["real_hours"] / prev_week["base_hours"] * 100) if prev_week["base_hours"] > 0 else None

    return {
        "mode": "personal", "value": value,
        "best_ever": best_ever, "best_ever_diff": _round1(value - best_ever),
        "avg_last_90_days": avg_last_90_days, "avg_last_90_days_diff": _round1(value - avg_last_90_days),
        "semana_anterior": semana_anterior,
        "semana_anterior_diff": _round1(value - semana_anterior) if semana_anterior is not None else None,
        "mes_anterior": mes_anterior,
        "mes_anterior_diff": _round1(value - mes_anterior) if mes_anterior is not None else None,
        "target": target, "target_gap": _round1(value - target) if target is not None else None,
        "note": None,
    }


def build_personal_capacidad_futura(value: float) -> dict:
    """Capacidad futura es una PROYECCIÓN hacia adelante (cambia
    estructuralmente cada día) — no existe un historial acumulado
    honesto contra el cual compararla."""
    return _empty_personal_metric(value, None, "La capacidad futura es una proyección hacia adelante — no existe un historial acumulado comparable.")


# --- Motor de decisión --------------------------------------------------------


def _build_benchmark_explain(mode: str, peer_count: int, period_analyzed: str, data_available: str) -> dict:
    if mode == "cargo":
        reason = f"Existen {peer_count} colaboradores con el mismo cargo — muestra suficiente para comparar de forma estadísticamente válida."
    elif mode == "cargo-limitado":
        reason = (
            f"Solo existen {peer_count} colaboradores con el mismo cargo — se muestra el promedio, "
            "sin percentiles ni \"mejor del cargo\" (muestra insuficiente para eso)."
        )
    elif peer_count == 1:
        reason = "Existe un único colaborador con este cargo — no hay una muestra válida para comparar entre pares."
    else:
        reason = "No existen otros colaboradores con el mismo cargo — no hay una muestra válida para comparar entre pares."
    return {"mode": mode, "reason": reason, "peer_count": peer_count, "period_analyzed": period_analyzed, "data_available": data_available}


def compute_smart_benchmark(*, user, now: datetime) -> dict:
    """Réplica exacta de `computeSmartBenchmark`."""
    role_group = get_role_group(user)
    role_name = role_group.name if role_group else ""
    peers = list(User.objects.filter(groups=role_group).exclude(id=user.id)) if role_group else []
    role_target = get_effective_role_target(role_name, now) if role_name else None
    self_metrics = compute_benchmark_metric_values(user=user, now=now)

    mode = "cargo" if len(peers) >= 3 else "cargo-limitado" if len(peers) == 2 else "personal"

    if mode in ("cargo", "cargo-limitado"):
        peer_metrics = [compute_benchmark_metric_values(user=p, now=now) for p in peers]
        build = build_cargo_benchmark if mode == "cargo" else build_cargo_limitado_benchmark
        build_carga = build_cargo_benchmark_carga if mode == "cargo" else build_cargo_limitado_benchmark

        def peer_values(key: str) -> list[float]:
            return [m[key] for m in peer_metrics]

        if mode == "cargo":
            performance = build(self_metrics["performance"], peer_values("performance"), True)
            operational_risk = build(self_metrics["operational_risk"], peer_values("operational_risk"), False)
            cumplimiento = build(self_metrics["cumplimiento"], peer_values("cumplimiento"), True)
            capacidad_futura = build(self_metrics["capacidad_futura"], peer_values("capacidad_futura"), True)
        else:
            performance = build(self_metrics["performance"], peer_values("performance"))
            operational_risk = build(self_metrics["operational_risk"], peer_values("operational_risk"))
            cumplimiento = build(self_metrics["cumplimiento"], peer_values("cumplimiento"))
            capacidad_futura = build(self_metrics["capacidad_futura"], peer_values("capacidad_futura"))
        carga_laboral = build_carga(self_metrics["carga_laboral"], peer_values("carga_laboral"))
        data_available = f"{len(peers) + 1} colaboradores del cargo con datos del mes en curso"
    else:
        performance = build_personal_from_audit_history(
            user=user, kind="performance_score", value=self_metrics["performance"],
            target=role_target["performance"] if role_target else None, now=now, higher_is_better=True,
        )
        operational_risk = build_personal_from_audit_history(
            user=user, kind="operational_risk", value=self_metrics["operational_risk"],
            target=role_target["riesgo_max"] if role_target else None, now=now, higher_is_better=False,
        )
        cumplimiento = build_personal_from_work_history(
            user=user, metric="cumplimiento", value=self_metrics["cumplimiento"],
            target=role_target["cumplimiento"] if role_target else None, now=now, pick_best=max,
        )
        carga_laboral = build_personal_from_work_history(
            user=user, metric="carga", value=self_metrics["carga_laboral"], target=None, now=now,
            pick_best=lambda scores: min(scores, key=lambda v: abs(v - 100)),
        )
        capacidad_futura = build_personal_capacidad_futura(self_metrics["capacidad_futura"])
        perf_observations = "con historial" if performance["best_ever"] is not None else "sin historial"
        data_available = f"Historial personal de Performance Score {perf_observations} · ventana de hasta {PERSONAL_HISTORY_WINDOW_DAYS} días"

    period_analyzed = f"Hasta {PERSONAL_HISTORY_WINDOW_DAYS} días de historial personal" if mode == "personal" else "Mes en curso"
    explain = _build_benchmark_explain(mode, len(peers), period_analyzed, data_available)

    result = {
        "mode": mode, "performance": performance, "operational_risk": operational_risk,
        "cumplimiento": cumplimiento, "carga_laboral": carga_laboral, "capacidad_futura": capacidad_futura,
        "role_target": role_target, "explain": explain, "engine_version": ANALYTICS_ENGINE_VERSION,
    }

    today = business_calendar_day(now)
    audit_calculation(
        user=user, kind="smart_benchmark", period=f"{today.year}-{today.month:02d}",
        inputs={"role": role_name, "peer_count": len(peers)}, result={"mode": mode, "values": self_metrics},
    )
    return result


# --- Evolución Personal -------------------------------------------------------
# Tarjeta SIEMPRE visible (independiente del modo de benchmark) —
# Performance actual vs. mejor/peor/promedio histórico propio, con
# tendencia acotada al historial realmente disponible.


def compute_personal_evolution(*, user, current_score: float, now: datetime) -> dict:
    """Réplica exacta de `computePersonalEvolution`."""
    history = get_factor_audit_history(user=user, kind="performance_score", now=now, window_days=PERSONAL_HISTORY_WINDOW_DAYS)
    if not history:
        return {"available": False, "reason": "Sin historial personal todavía — vuelva a revisar en unos días.", "current": current_score}

    scores = [h["score"] for h in history]
    best_ever = max(scores)
    worst_ever = min(scores)
    average = _round1(sum(scores) / len(scores))
    oldest_entry = history[-1]
    span_weeks = int((now - oldest_entry["created_at"]).total_seconds() // (7 * 86400))

    if span_weeks < 4:
        trend = {"available": False}
    else:
        week_point = closest_factor_point(history, now, 7)
        basis_value = week_point["score"] if week_point else average
        diff = _round1(current_score - basis_value)
        direction = "mejora" if diff > 0.5 else "empeoro" if diff < -0.5 else "estable"
        trend = {
            "available": True, "direction": direction, "diff": diff,
            "basis": "semana anterior" if week_point else "promedio histórico",
        }

    return {
        "available": True, "current": current_score, "best_ever": best_ever, "worst_ever": worst_ever,
        "average": average, "trend": trend, "observations": len(history), "span_weeks": span_weeks,
    }
