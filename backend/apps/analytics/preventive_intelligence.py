"""Inteligencia Preventiva — Fase 9b (ver docs/AUDIT_LOG.md §
2026-08-18). Réplica exacta de `src/lib/preventiveIntelligence.ts`:
compone las salidas YA CALCULADAS de `trend_engine.py`/
`prediction_engine.py` en una lista priorizada de alertas legibles.
Explícitamente SEPARADA del motor de 8 reglas de `pipeline.py`/
`alerts_engine.py` — ninguno de los dos se importa para mutar ni se
toca."""

from datetime import datetime
from datetime import timezone as dt_timezone

from apps.projects.models import Project
from apps.users.models import User

from .prediction_engine import (
    compute_operational_stability,
    compute_project_delay_prediction,
    compute_sobrecarga_probability,
    compute_subutilizacion_predictions,
)
from .trend_engine import compute_trend_engine

SEVERITY_RANK = {"roja": 4, "naranja": 3, "amarilla": 2, "verde": 1}

ORDINAL = {1: "primera", 2: "segunda", 3: "tercera", 4: "cuarta", 5: "quinta"}


def _sort_by_severity(alerts: list[dict]) -> list[dict]:
    return sorted(alerts, key=lambda a: SEVERITY_RANK[a["severity"]], reverse=True)


def _consecutive_decline_weeks(points: list[dict]) -> int:
    """Semanas consecutivas (desde la más reciente hacia atrás) en que
    el valor bajó respecto a la anterior. Réplica exacta de
    `consecutiveDeclineWeeks`."""
    streak = 0
    for i in range(len(points) - 1, 0, -1):
        if points[i]["value"] < points[i - 1]["value"]:
            streak += 1
        else:
            break
    return streak + 1 if streak > 0 else 0  # +1: el streak cuenta caídas, la "semana" incluye el punto de partida.


def compute_preventive_alerts(*, user, now: datetime | None = None) -> list[dict]:
    """Réplica exacta de `computePreventiveAlerts`."""
    now = now or datetime.now(dt_timezone.utc)
    sobrecarga = compute_sobrecarga_probability(user=user, now=now)
    trend = compute_trend_engine(user=user, now=now)
    stability = compute_operational_stability(user=user, now=now)
    subutilizacion_map = compute_subutilizacion_predictions(user_ids=[user.id], now=now)

    alerts: list[dict] = []

    if sobrecarga["available"] and sobrecarga["nivel"] != "Bajo":
        alto = sobrecarga["nivel"] == "Alto"
        alerts.append(
            {
                "severity": "roja" if alto else "naranja",
                "message": (
                    f"Existe {'alta' if alto else 'media'} probabilidad de sobrecarga la próxima semana."
                    if sobrecarga["horizon"] <= 7
                    else f"Existe {'alta' if alto else 'media'} probabilidad de sobrecarga en los próximos {sobrecarga['horizon']} días."
                ),
                "source": "Predicción de Sobrecarga",
                "related_indicator": "sobrecarga",
            }
        )

    cumplimiento = trend["indicators"]["cumplimiento"]
    if cumplimiento["available"] and cumplimiento["direction"] == "negativa":
        streak = _consecutive_decline_weeks(cumplimiento["data_points"])
        if streak >= 2:
            ordinal = ORDINAL.get(min(streak, 5), f"{streak}ª")
            alerts.append(
                {
                    "severity": "roja" if streak >= 3 else "naranja",
                    "message": f"La tendencia de cumplimiento disminuye por {ordinal} semana consecutiva.",
                    "source": "Trend Engine — Cumplimiento",
                    "related_indicator": "cumplimiento",
                }
            )

    subutilizacion = subutilizacion_map.get(user.id)
    if subutilizacion and subutilizacion["nivel"] == "Alto":
        alerts.append(
            {
                "severity": "amarilla",
                "message": "Presenta una proyección de subutilización de capacidad.",
                "source": "Predicción de Subutilización",
                "related_indicator": "subutilizacion",
            }
        )

    if stability["classification"] in ("Baja", "Muy Baja"):
        alerts.append(
            {
                "severity": "naranja" if stability["classification"] == "Muy Baja" else "amarilla",
                "message": (
                    f"Estabilidad operativa {stability['classification'].lower()} — variabilidad significativa en: "
                    f"{', '.join(stability['based_on']) or 'varios indicadores'}."
                ),
                "source": "Estabilidad Operativa",
                "related_indicator": "estabilidad",
            }
        )

    if not alerts:
        return [
            {
                "severity": "verde",
                "message": "Sin riesgos preventivos detectados.",
                "source": "Inteligencia Preventiva",
                "related_indicator": "estabilidad",
            }
        ]
    return _sort_by_severity(alerts)


def compute_team_preventive_alerts(*, user_ids: list[int], project_ids: list[int], now: datetime | None = None) -> list[dict]:
    """Vista de equipo — mismos bloques de predicción, en lote (batch
    de `compute_subutilizacion_predictions` ya evita N+1;
    `compute_project_delay_prediction` se llama una vez por proyecto
    visible, no por participante). Réplica exacta de
    `computeTeamPreventiveAlerts`."""
    now = now or datetime.now(dt_timezone.utc)
    subutilizacion_map = compute_subutilizacion_predictions(user_ids=user_ids, now=now)
    user_names = {u.id: u.first_name for u in User.objects.filter(id__in=user_ids).only("id", "first_name")}
    project_delays = [compute_project_delay_prediction(project_id=pid, now=now) for pid in project_ids]
    project_names = {p.id: p.name for p in Project.objects.filter(id__in=project_ids).only("id", "name")}

    alerts: list[dict] = []

    for user_id, prediction in subutilizacion_map.items():
        if prediction["nivel"] == "Alto":
            name = user_names.get(user_id)
            alerts.append(
                {
                    "severity": "amarilla",
                    "message": f"{name if name is not None else 'Un colaborador'} presenta una proyección de subutilización.",
                    "source": "Predicción de Subutilización",
                    "related_indicator": "subutilizacion",
                }
            )

    for project_id, prediction in zip(project_ids, project_delays, strict=False):
        if prediction.get("available") and prediction["nivel"] != "Bajo":
            name = project_names.get(project_id)
            alerts.append(
                {
                    "severity": "roja" if prediction["nivel"] == "Alto" else "naranja",
                    "message": (
                        f"Existe riesgo {'elevado' if prediction['nivel'] == 'Alto' else 'moderado'} de retraso en "
                        f"{name if name is not None else 'un proyecto'}."
                    ),
                    "source": "Predicción de Retrasos",
                    "related_indicator": "retraso",
                }
            )

    if not alerts:
        return [
            {
                "severity": "verde",
                "message": "Sin riesgos preventivos detectados en el equipo.",
                "source": "Inteligencia Preventiva",
                "related_indicator": "estabilidad",
            }
        ]
    return _sort_by_severity(alerts)
