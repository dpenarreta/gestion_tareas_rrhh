"""Motor Determinista de Recomendaciones — Compatibilidad Organizacional
(§S3-A, ampliado con Matriz de Compatibilidad Operativa) — Fase 24
(ver docs/AUDIT_LOG.md § 2026-08-20). Réplica exacta de
`computeTeamRecommendations` (`src/lib/analytics.ts`): cruza exceso de
horas vs. capacidad disponible del equipo, sin IA. Respeta la
estructura jerárquica de Nexo — prioriza el mismo cargo, usa la
Matriz de Compatibilidad Operativa configurable como respaldo entre
cargos del MISMO nivel jerárquico, NUNCA sugiere redistribución
vertical (filtro absoluto, no solo de configuración), y muestra un
mensaje explícito cuando no hay candidato compatible en vez de una
sugerencia incorrecta."""

from datetime import datetime

from apps.configuration.services import (
    get_effective_analytics_config,
    get_effective_role_compatibility,
)
from apps.core.rounding import round_half_up
from apps.hierarchy.services import ROLE_LEVEL

from .capacity_forecast import classify_capacity, compute_team_capacity_forecast
from .health_score import capacity_to_score

# Top N colaboradores más sobrecargados evaluados por corrida — mismo
# tope que el TS (`overloaded.slice(0, 5)`), acota el costo de una
# vista de equipo con muchos subordinados.
MAX_OVERLOADED_EVALUATED = 5


def _round2(x: float) -> float:
    return round_half_up(x * 100) / 100


def compute_team_recommendations(*, members: list[dict], now: datetime) -> list[dict]:
    """`members`: lista de `{"id": int, "name": str, "role": str}` —
    el caller resuelve el nombre/rol de cada subordinado (mismo
    criterio que `getAllEffectiveRoleCompatibility`: este módulo no se
    acopla a `apps.hierarchy`/`apps.users` más de lo necesario)."""
    if len(members) < 2:
        return []

    config = get_effective_analytics_config(now)
    capacity_map = compute_team_capacity_forecast(user_ids=[m["id"] for m in members], now=now)
    name_of = {m["id"]: m["name"] for m in members}
    role_of = {m["id"]: m["role"] for m in members}
    compatibility_matrix = {role: get_effective_role_compatibility(role, now) for role in {m["role"] for m in members}}

    overloaded = sorted(
        (
            {
                "id": user_id, "name": name_of[user_id], "role": role_of[user_id],
                "excess": _round2(-capacity["disponible"]), "capacity": capacity,
            }
            for user_id, capacity in capacity_map.items()
            if capacity["disponible"] < 0
        ),
        key=lambda x: x["excess"],
        reverse=True,
    )
    available_pool = sorted(
        (
            {"id": user_id, "name": name_of[user_id], "role": role_of[user_id], "free": capacity["disponible"]}
            for user_id, capacity in capacity_map.items()
            if capacity["disponible"] > 0
        ),
        key=lambda x: x["free"],
        reverse=True,
    )

    recommendations: list[dict] = []

    for person in overloaded[:MAX_OVERLOADED_EVALUATED]:
        priority = "alta" if person["excess"] >= 10 or person["capacity"]["disponible_pct"] <= -30 else "media"

        # Regla 4 (dura, no configurable): solo el mismo nivel jerárquico.
        same_level_pool = [a for a in available_pool if ROLE_LEVEL.get(a["role"], 0) == ROLE_LEVEL.get(person["role"], 0)]
        # Regla 1 (mismo cargo, siempre primero) + Regla 2/3 (matriz de
        # compatibilidad como respaldo).
        compatible_roles = set(compatibility_matrix.get(person["role"], []))
        eligible_pool = sorted(
            (a for a in same_level_pool if a["role"] == person["role"] or a["role"] in compatible_roles),
            key=lambda a: (0 if a["role"] == person["role"] else 1, -a["free"]),
        )

        remaining = person["excess"]
        allocations: list[dict] = []
        for avail in eligible_pool:
            if remaining <= 0.01:
                break
            take = _round2(min(remaining, avail["free"]))
            if take <= 0:
                continue
            allocations.append({"name": avail["name"], "hours": take})
            avail["free"] = _round2(avail["free"] - take)
            remaining = _round2(remaining - take)

        if not allocations:
            # Regla 5 — nunca una recomendación incorrecta cuando no hay
            # candidato compatible.
            recommendations.append(
                {
                    "id": person["id"], "priority": priority, "priority_color": "red" if priority == "alta" else "yellow",
                    "text": f"No existe actualmente un colaborador compatible para redistribuir esta carga operativa ({person['name']}).",
                    "impact_score_pts": 0, "impact_risk_pts": 0, "affected_count": 1, "ease_rank": 99, "has_candidate": False,
                }
            )
            continue

        moved_total = _round2(sum(a["hours"] for a in allocations))

        before = person["capacity"]
        new_disponible = _round2(before["disponible"] + moved_total)
        new_disponible_pct = round_half_up(new_disponible / before["base_futura_total"] * 100) if before["base_futura_total"] > 0 else 0
        after_estado = classify_capacity(new_disponible, before["base_futura_total"], new_disponible_pct)["estado"]

        before_cap_score = capacity_to_score(before["estado"], before["disponible_pct"])
        after_cap_score = capacity_to_score(after_estado, new_disponible_pct)
        impact_score_pts = _round2((after_cap_score - before_cap_score) * config["health_weight_capacidad"] / 100)

        before_sobrecarga_pct = min(100, abs(before["disponible_pct"])) if before["disponible"] < 0 else 0
        after_sobrecarga_pct = min(100, abs(new_disponible_pct)) if new_disponible < 0 else 0
        impact_risk_pts = _round2((after_sobrecarga_pct - before_sobrecarga_pct) * config["risk_weight_sobrecarga"] / 100)

        allocation_text = " y ".join(f"{a['name']} ({a['hours']}h disp.)" for a in allocations)

        recommendations.append(
            {
                "id": person["id"], "priority": priority, "priority_color": "red" if priority == "alta" else "yellow",
                "text": f"Redistribuir {moved_total}h de {person['name']} entre {allocation_text}",
                "impact_score_pts": impact_score_pts, "impact_risk_pts": impact_risk_pts,
                "affected_count": len(allocations) + 1, "ease_rank": len(allocations), "has_candidate": True,
            }
        )

    recommendations.sort(key=lambda r: 0 if r["priority"] == "alta" else 1)
    return recommendations
