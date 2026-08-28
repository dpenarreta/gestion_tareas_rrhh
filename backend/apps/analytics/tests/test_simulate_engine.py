"""Cobertura de apps.analytics.simulate_engine — Fase 9c (ver
docs/AUDIT_LOG.md § 2026-08-18), réplica de los 3 `route.ts` de
`/api/predictive/simulate/**`. Funciones puras: se testean con dicts
de capacidad/health_score de fixture, sin tocar la base de datos."""

from types import SimpleNamespace

from apps.analytics.simulate_engine import (
    simulate_add_participants,
    simulate_adjust_target_time,
    simulate_redistribute_load,
)


def _capacity(**overrides) -> dict:
    base = {"comprometido_futuro": 10, "base_futura_total": 40, "disponible": 30, "disponible_pct": 75, "estado": "alta"}
    return {**base, **overrides}


def _health_score(**overrides) -> dict:
    base = {"score": 50, "classification": "Riesgo", "factors": [{"name": "Capacidad futura", "points": 20, "weight": 20}]}
    return {**base, **overrides}


# --- simulate_adjust_target_time -------------------------------------------------


def test_adjust_target_time_pending_task_uses_full_target():
    task = SimpleNamespace(id=1, estimated_hours=10, target_time_validated=None, real_hours=0, status="PENDIENTE")
    result = simulate_adjust_target_time(
        capacity=_capacity(), health_score=_health_score(), task=task, new_target_time_hours=20
    )
    # delta = 20 (nuevo) - 10 (actual) = 10 -> comprometido 10+10=20, disponible 40-20=20 (50%).
    assert result["after"]["capacidad_disponible_pct"] == 50
    assert result["after"]["capacidad_disponible_horas"] == 20.0
    assert result["before"] == {
        "capacidad_disponible_pct": 75, "capacidad_disponible_horas": 30, "health_score": 50, "health_classification": "Riesgo",
    }
    # capacity_to_score("alta", *) siempre 100 -> new_score = weighted_points(100, 20) = 20.0.
    assert result["after"]["health_score"] == 20.0
    assert result["after"]["health_classification"] == "Crítico"
    assert result["diff"]["health_score"] == -30.0
    assert result["scenario"] == {"type": "adjust_target_time", "task_id": 1, "new_target_time_hours": 20}


def test_adjust_target_time_en_progreso_task_discounts_real_hours():
    task = SimpleNamespace(id=2, estimated_hours=10, target_time_validated=None, real_hours=4, status="EN_PROGRESO")
    result = simulate_adjust_target_time(
        capacity=_capacity(comprometido_futuro=0, base_futura_total=40), health_score=_health_score(), task=task,
        new_target_time_hours=14,
    )
    # actual: max(0, 10-4)=6; nuevo: max(0, 14-4)=10; delta=4 -> comprometido 0+4=4, disponible 40-4=36 (90%).
    assert result["after"]["capacidad_disponible_pct"] == 90
    assert result["after"]["capacidad_disponible_horas"] == 36.0


def test_adjust_target_time_uses_validated_target_time_over_initial():
    task = SimpleNamespace(id=3, estimated_hours=10, target_time_validated=6, real_hours=0, status="PENDIENTE")
    result = simulate_adjust_target_time(
        capacity=_capacity(comprometido_futuro=0, base_futura_total=40), health_score=_health_score(), task=task,
        new_target_time_hours=6,
    )
    # actual (validado) = 6, nuevo = 6 -> delta 0 -> comprometido sin cambios.
    assert result["after"]["capacidad_disponible_horas"] == 40.0


# --- simulate_add_participants ---------------------------------------------------


def test_add_participants_recomputes_average_remaining_hours():
    result = simulate_add_participants(
        target_time_hours=100, real_hours=40, participant_count=4, additional_participants=1, project_id=7
    )
    assert result == {
        "before": {"participants": 4, "avg_remaining_hours_per_participant": 15.0},
        "after": {"participants": 5, "avg_remaining_hours_per_participant": 12.0},
        "scenario": {"type": "add_participants", "project_id": 7, "additional_participants": 1},
    }


def test_add_participants_floors_current_count_to_one():
    result = simulate_add_participants(
        target_time_hours=30, real_hours=0, participant_count=0, additional_participants=2, project_id=1
    )
    assert result["before"]["participants"] == 1
    assert result["after"]["participants"] == 3


# --- simulate_redistribute_load ---------------------------------------------------


def test_redistribute_load_moves_hours_between_users():
    from_capacity = _capacity(comprometido_futuro=36, base_futura_total=40, disponible=4, disponible_pct=10, estado="limitada")
    to_capacity = _capacity(comprometido_futuro=4, base_futura_total=40, disponible=36, disponible_pct=90, estado="alta")
    result = simulate_redistribute_load(from_user_id=1, to_user_id=2, from_capacity=from_capacity, to_capacity=to_capacity, hours=10)
    assert result["from"]["before"] == {"capacidad_disponible_pct": 10, "capacidad_disponible_horas": 4, "estado": "limitada"}
    assert result["from"]["after"] == {"capacidad_disponible_pct": 35, "capacidad_disponible_horas": 14.0, "estado": "alta"}
    assert result["to"]["before"] == {"capacidad_disponible_pct": 90, "capacidad_disponible_horas": 36, "estado": "alta"}
    assert result["to"]["after"] == {"capacidad_disponible_pct": 65, "capacidad_disponible_horas": 26.0, "estado": "alta"}
    assert result["scenario"] == {"type": "redistribute_load", "from_user_id": 1, "to_user_id": 2, "hours": 10}


def test_redistribute_load_never_leaves_comprometido_negative():
    from_capacity = _capacity(comprometido_futuro=5, base_futura_total=40)
    to_capacity = _capacity(comprometido_futuro=0, base_futura_total=40)
    result = simulate_redistribute_load(from_user_id=1, to_user_id=2, from_capacity=from_capacity, to_capacity=to_capacity, hours=100)
    # comprometido no puede bajar de 0 -> disponible tope en base_futura_total.
    assert result["from"]["after"]["capacidad_disponible_horas"] == 40.0
