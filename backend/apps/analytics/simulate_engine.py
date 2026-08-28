"""Simulador — Bloque 8 de Inteligencia Preventiva (Fase 9c, ver
docs/AUDIT_LOG.md § 2026-08-18). 3 escenarios "qué pasaría si" que
NUNCA persisten los valores simulados, reutilizando por completo
funciones puras ya portadas (`compute_capacity_forecast`/
`compute_team_capacity_forecast`/`classify_capacity`/
`capacity_to_score`/`weighted_points`/`compute_health_score`/
`get_official_target_time`). Réplica exacta de los 3 `route.ts` de
`/api/predictive/simulate/**` — ninguno recalcula un KPI real, solo
proyecta el efecto de un cambio hipotético sobre valores YA
calculados."""

from apps.core.rounding import round_half_up

from .capacity_forecast import classify_capacity
from .health_score import capacity_to_score
from .scoring import weighted_points
from .target_time import get_official_target_time


def _simulate_capacity_delta(capacity: dict, delta_comprometido: float) -> dict:
    """Réplica exacta del helper local `simulate()` de
    `simulate/redistribute/route.ts` — reutilizado también por el
    escenario "ajustar tiempo objetivo" (mismo cálculo, delta
    distinto)."""
    new_comprometido = max(0.0, round_half_up((capacity["comprometido_futuro"] + delta_comprometido) * 100) / 100)
    new_disponible = round_half_up((capacity["base_futura_total"] - new_comprometido) * 100) / 100
    new_disponible_pct = round_half_up(new_disponible / capacity["base_futura_total"] * 100) if capacity["base_futura_total"] > 0 else 0
    cls = classify_capacity(new_disponible, capacity["base_futura_total"], new_disponible_pct)
    return {
        "capacidad_disponible_pct": new_disponible_pct,
        "capacidad_disponible_horas": new_disponible,
        "estado": cls["estado"],
    }


def simulate_adjust_target_time(*, capacity: dict, health_score: dict, task, new_target_time_hours: float) -> dict:
    """Escenario "modificar tiempo objetivo" (nivel tarea). Mismo
    criterio que `compute_team_capacity_forecast`: una tarea En
    Progreso aporta (tiempo objetivo - horas ya reales) a
    `comprometido_futuro`; Pendiente aporta el tiempo objetivo
    completo. Réplica exacta de `simulate/[userId]/route.ts`."""
    current_official = get_official_target_time(task.estimated_hours, task.target_time_validated)
    current_contribution = max(0.0, current_official - task.real_hours) if task.status == "EN_PROGRESO" else current_official
    new_contribution = max(0.0, new_target_time_hours - task.real_hours) if task.status == "EN_PROGRESO" else new_target_time_hours
    delta = new_contribution - current_contribution

    after_capacity = _simulate_capacity_delta(capacity, delta)
    new_capacity_score = capacity_to_score(after_capacity["estado"], after_capacity["capacidad_disponible_pct"])

    capacity_factor = next(f for f in health_score["factors"] if f["name"] == "Capacidad futura")
    other_points = sum(f["points"] for f in health_score["factors"] if f["name"] != "Capacidad futura")
    new_score = round_half_up((other_points + weighted_points(new_capacity_score, capacity_factor["weight"])) * 100) / 100
    new_classification = "Excelente" if new_score >= 90 else "Bueno" if new_score >= 75 else "Riesgo" if new_score >= 60 else "Crítico"

    before = {
        "capacidad_disponible_pct": capacity["disponible_pct"],
        "capacidad_disponible_horas": capacity["disponible"],
        "health_score": health_score["score"],
        "health_classification": health_score["classification"],
    }
    after = {
        "capacidad_disponible_pct": after_capacity["capacidad_disponible_pct"],
        "capacidad_disponible_horas": after_capacity["capacidad_disponible_horas"],
        "health_score": new_score,
        "health_classification": new_classification,
    }
    return {
        "before": before,
        "after": after,
        "diff": {"health_score": round_half_up((after["health_score"] - before["health_score"]) * 100) / 100},
        "scenario": {"type": "adjust_target_time", "task_id": task.id, "new_target_time_hours": new_target_time_hours},
    }


def simulate_add_participants(
    *, target_time_hours: float, real_hours: float, participant_count: int, additional_participants: float, project_id: int
) -> dict:
    """Escenario "agregar participantes" (nivel proyecto): recalcula
    el promedio de horas restantes por participante. Réplica exacta de
    `simulate/project/[projectId]/route.ts`."""
    remaining_hours = max(0.0, target_time_hours - real_hours)
    current_participants = max(1, participant_count)
    new_participants = current_participants + additional_participants
    return {
        "before": {
            "participants": current_participants,
            "avg_remaining_hours_per_participant": round_half_up(remaining_hours / current_participants * 100) / 100,
        },
        "after": {
            "participants": new_participants,
            "avg_remaining_hours_per_participant": round_half_up(remaining_hours / new_participants * 100) / 100,
        },
        "scenario": {"type": "add_participants", "project_id": project_id, "additional_participants": additional_participants},
    }


def simulate_redistribute_load(*, from_user_id: int, to_user_id: int, from_capacity: dict, to_capacity: dict, hours: float) -> dict:
    """Escenario "redistribuir carga" (bi-usuario): resta `hours` de
    la capacidad comprometida de `from_user_id` y las suma a la de
    `to_user_id`. Réplica exacta de `simulate/redistribute/route.ts`."""
    from_before = {
        "capacidad_disponible_pct": from_capacity["disponible_pct"],
        "capacidad_disponible_horas": from_capacity["disponible"],
        "estado": from_capacity["estado"],
    }
    to_before = {
        "capacidad_disponible_pct": to_capacity["disponible_pct"],
        "capacidad_disponible_horas": to_capacity["disponible"],
        "estado": to_capacity["estado"],
    }
    return {
        "from": {"user_id": from_user_id, "before": from_before, "after": _simulate_capacity_delta(from_capacity, -hours)},
        "to": {"user_id": to_user_id, "before": to_before, "after": _simulate_capacity_delta(to_capacity, hours)},
        "scenario": {"type": "redistribute_load", "from_user_id": from_user_id, "to_user_id": to_user_id, "hours": hours},
    }
