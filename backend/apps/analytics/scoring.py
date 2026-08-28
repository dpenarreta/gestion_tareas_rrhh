"""Score básico y validación de consistencia de cumplimiento — Fase 4b
(ver docs/AUDIT_LOG.md § 2026-08-11). Portado de 3 funciones puntuales de
`src/lib/analytics.ts` (2430 líneas) — el resto del archivo (Performance
Score, Riesgo Operativo, Equilibrio, Predicción, etc.) se porta en
sub-fases futuras."""

import logging
from datetime import datetime, timedelta
from datetime import timezone as dt_timezone

from django.db.models import Exists, OuterRef
from django.utils import timezone

from apps.configuration.models import SystemConfigHistory
from apps.configuration.services import CONFIG_KEY_HORAS_EFECTIVAS
from apps.core.rounding import round_half_up
from apps.tasks.business_time import business_calendar_day
from apps.tasks.models import Task, TaskActivity

from .models import (
    ANALYTICS_ENGINE_VERSION,
    AUDIT_KIND_FORMULAS,
    FORMULA_VERSIONS,
    AnalyticsAuditLog,
)
from .target_time import (
    compute_precision_pct,
    get_official_target_time,
    is_target_time_validated,
    precision_classification,
)

logger = logging.getLogger(__name__)


def _month_bounds(year: int, month: int) -> tuple[datetime, datetime]:
    # Duplicado deliberado de `services._month_bounds` — `services.py` ya
    # importa de este módulo, así que importarlo de vuelta crearía un
    # ciclo. 3 líneas, no vale la pena una abstracción compartida nueva.
    next_year, next_month = (year + 1, 1) if month == 12 else (year, month + 1)
    start = datetime(year, month, 1, tzinfo=dt_timezone.utc)
    end = datetime(next_year, next_month, 1, tzinfo=dt_timezone.utc) - timedelta(microseconds=1)
    return start, end


def weighted_points(raw_score: float, weight_pct: float) -> float:
    """Puntos ponderados = rawScore(0-100) × weight% / 100, redondeado a
    2 decimales — réplica exacta de `weightedPoints`. Usada por
    Performance Score (y, en sub-fases futuras, Equilibrio Operativo e
    Índice de Riesgo Operativo)."""
    return round_half_up((raw_score * weight_pct) / 100, 2)


def audit_calculation(*, user, kind: str, period: str, inputs: dict, result: dict) -> None:
    """Auditoría best-effort de un cálculo del motor — réplica exacta de
    `auditCalculation`. Nunca lanza (try/except silencioso, igual que
    el resto del motor). `validate_cumplimiento_consistency` (Fase 4b)
    sigue escribiendo `AnalyticsAuditLog` inline en vez de usar este
    helper (código ya probado, no se refactoriza) — este helper es
    para las piezas nuevas que auditen desde ahora en adelante."""
    try:
        formula_versions = {f: FORMULA_VERSIONS[f] for f in AUDIT_KIND_FORMULAS.get(kind, [])}
        AnalyticsAuditLog.objects.create(
            user=user, kind=kind, period=period, inputs=inputs,
            result={**result, "formula_versions": formula_versions}, engine_version=ANALYTICS_ENGINE_VERSION,
        )
    except Exception:  # noqa: BLE001 — auditoría best-effort, nunca bloquea la respuesta
        logger.exception("No se pudo auditar el cálculo '%s' para el usuario %s", kind, user.id)


def compute_simple_score(completed_pct: float, carga_ratio: float, avg_progress: float, total_comments: int = 0) -> int:
    """Score /100, ponderado 40/20/20/20 — réplica exacta de
    `computeSimpleScore`. Sin tareas (todos los inputs en 0): score=20
    (scoreL parte de 20 sin penalización de sobrecarga)."""
    score_c = (completed_pct / 100) * 40
    score_l = max(0.0, 20 - max(0.0, carga_ratio - 100) * 0.5)
    score_a = (avg_progress / 100) * 20
    score_act = min(1.0, total_comments / 10) * 20
    return round_half_up(score_c + score_l + score_a + score_act)


def compute_completed_pct_any(tasks, empty_value: int = 0) -> int:
    """% de tareas con `status == COMPLETADA`, sin importar si fue a
    tiempo — Definición A de "cumplimiento", réplica exacta de
    `computeCompletedPctAny`. Deliberadamente distinta e inconsistente
    con `is_completed_on_time`/Definición B (usada por
    `/kpis/me`/`/kpis/<id>/`) — mismo gap legacy aceptado, no un bug a
    resolver (ver docs/AUDIT_LOG.md § 2026-08-11, Fase 4b)."""
    tasks = list(tasks)
    if not tasks:
        return empty_value
    completed = sum(1 for t in tasks if t.status == "COMPLETADA")
    return round_half_up(completed / len(tasks) * 100)


def compute_estimated_vs_real_ratio(total_real: float, total_estimated: float) -> int:
    """% de horas reales sobre estimadas — réplica exacta de
    `computeEstimatedVsRealRatio`. Centinela `200` si no hay horas
    estimadas pero sí reales (evita división 0/0, señala desvío); usado
    SOLO como input de `compute_simple_score`, nunca del indicador
    "Carga Laboral" mostrado en la UI (esa cifra viene de
    `compute_carga_tiempo`)."""
    if total_estimated > 0:
        return round_half_up(total_real / total_estimated * 100)
    return 200 if total_real > 0 else 0


def validate_cumplimiento_consistency(
    *, user, cumplimiento_general: dict, priority_compliance: list[dict], now=None
) -> list[dict]:
    """Réplica de `validateCumplimientoConsistency` — 4 checks de
    coherencia entre el cumplimiento general y su desglose por prioridad.
    Si hay fallas, audita en `AnalyticsAuditLog` (best-effort, nunca
    lanza) — nunca bloquea la respuesta del endpoint."""
    now = now or timezone.now()
    failures: list[dict] = []

    sum_priority_totals = sum(p["total"] for p in priority_compliance)
    if sum_priority_totals != cumplimiento_general["total"]:
        failures.append(
            {
                "rule": "suma_prioridad_total",
                "detail": f"Suma por prioridad ({sum_priority_totals}) ≠ total ({cumplimiento_general['total']})",
            }
        )

    if sum_priority_totals > 0:
        weighted = sum(p["pct"] * p["total"] for p in priority_compliance) / sum_priority_totals
        if abs(weighted - cumplimiento_general["pct"]) > 15:
            failures.append(
                {
                    "rule": "cumplimiento_incoherente",
                    "detail": (
                        f"Ponderado por prioridad ({round_half_up(weighted)}%) muy distinto "
                        f"del general ({cumplimiento_general['pct']}%)"
                    ),
                }
            )

    if cumplimiento_general["pct"] > 100:
        failures.append({"rule": "cumplimiento_excede_100", "detail": f"Cumplimiento general {cumplimiento_general['pct']}%"})

    for p in priority_compliance:
        if p["pct"] > 100:
            failures.append({"rule": "cumplimiento_prioridad_excede_100", "detail": f"{p['priority']}: {p['pct']}%"})

    if failures:
        today = business_calendar_day(now)
        period = f"{today.year}-{today.month:02d}"
        try:
            AnalyticsAuditLog.objects.create(
                user=user,
                kind="validation_failure",
                period=period,
                inputs={},
                result={"failures": failures, "detected_at": now.isoformat(), "formula_versions": {}},
                engine_version=ANALYTICS_ENGINE_VERSION,
            )
        except Exception:  # noqa: BLE001 — auditoría best-effort, nunca bloquea la respuesta
            logger.exception("No se pudo auditar una inconsistencia de cumplimiento para el usuario %s", user.id)

    return failures


def compute_data_quality(*, user_ids: list[int]) -> dict:
    """Réplica exacta de `computeDataQuality` — 4 issues posibles sobre
    `user_ids` (funciona igual para 1 usuario o un equipo)."""
    if not user_ids:
        return {"pct": 100, "issues": []}

    open_tasks = list(
        Task.objects.filter(assigned_to_id__in=user_ids, archived_month__isnull=True)
        .exclude(status=Task.Status.COMPLETADA)
        .only("estimated_hours", "target_time_validated")
    )
    all_tasks_for_dates = list(
        Task.objects.filter(assigned_to_id__in=user_ids, archived_month__isnull=True).only("start_date", "end_date")
    )
    seguimiento_sin_actividad = (
        Task.objects.filter(assigned_to_id__in=user_ids, type=Task.Type.SEGUIMIENTO, archived_month__isnull=True)
        .annotate(has_activity=Exists(TaskActivity.objects.filter(task=OuterRef("pk"))))
        .filter(has_activity=False)
        .count()
    )
    has_hours_config = SystemConfigHistory.objects.filter(key=CONFIG_KEY_HORAS_EFECTIVAS).count()

    tasks_sin_estimar = sum(1 for t in open_tasks if get_official_target_time(t.estimated_hours, t.target_time_validated) <= 0)
    fechas_inconsistentes = sum(1 for t in all_tasks_for_dates if t.start_date > t.end_date)
    sin_horas_config = has_hours_config == 0

    issues = []
    if tasks_sin_estimar > 0:
        issues.append({"key": "sin_estimar", "label": "Tareas sin tiempo objetivo definido", "count": tasks_sin_estimar})
    if fechas_inconsistentes > 0:
        issues.append(
            {"key": "fechas_inconsistentes", "label": "Tareas con fecha de inicio posterior a la fecha fin", "count": fechas_inconsistentes}
        )
    if seguimiento_sin_actividad > 0:
        issues.append(
            {"key": "seguimiento_sin_actividad", "label": "Tareas de Seguimiento sin actividades registradas", "count": seguimiento_sin_actividad}
        )
    if sin_horas_config:
        issues.append(
            {"key": "sin_horas_config", "label": "Horas efectivas nunca configuradas explícitamente (usando el valor por defecto del sistema)", "count": 1}
        )

    pct = max(
        0,
        round_half_up(100 - (tasks_sin_estimar * 3 + fechas_inconsistentes * 10 + seguimiento_sin_actividad * 2 + (10 if sin_horas_config else 0))),
    )
    return {"pct": pct, "issues": issues}


def compute_target_time_precision(*, user, now: datetime) -> dict:
    """Réplica exacta de `computeTargetTimePrecision` — precisión
    promedio del mes en curso, usando el Tiempo Objetivo Validado como
    referencia cuando existe, si no el inicial (nunca deja de calcularse
    por falta de validación)."""
    today = business_calendar_day(now)
    start, end = _month_bounds(today.year, today.month)

    tasks = list(
        Task.objects.filter(
            assigned_to=user, status=Task.Status.COMPLETADA, completed_at__gte=start, completed_at__lte=end, real_hours__gt=0
        ).only("estimated_hours", "target_time_validated", "real_hours")
    )
    if not tasks:
        return {"available": False, "reason": "Sin tareas completadas con horas reales registradas este mes."}

    scored = []
    for t in tasks:
        official = get_official_target_time(t.estimated_hours, t.target_time_validated)
        if official <= 0:
            continue
        scored.append({"validated": is_target_time_validated(t.target_time_validated), "pct": compute_precision_pct(t.real_hours, official)})
    if not scored:
        return {"available": False, "reason": "Ninguna tarea completada este mes tiene un Tiempo Objetivo mayor a cero."}

    avg_precision_pct = round_half_up(sum(s["pct"] for s in scored) / len(scored) * 10) / 10
    validated_pct = round_half_up(sum(1 for s in scored if s["validated"]) / len(scored) * 100)

    return {
        "available": True,
        "avg_precision_pct": avg_precision_pct,
        "classification": precision_classification(avg_precision_pct),
        "sample_size": len(scored),
        "validated_pct": validated_pct,
    }
