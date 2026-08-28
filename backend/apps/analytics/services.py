"""Orquestador del payload de `GET /api/kpis/me`, `/api/kpis/[userId]` y
`/api/analytics/[userId]` — Fases 4b y 4m (ver docs/AUDIT_LOG.md §
2026-08-11 y § 2026-08-12). Réplica campo por campo de las rutas
legacy."""

from datetime import datetime, timedelta
from datetime import timezone as dt_timezone

from django.db.models import Prefetch
from django.utils import timezone as django_timezone

from apps.configuration.services import business_base_for_range
from apps.core.rounding import round_half_up
from apps.tasks.business_time import business_day_real_range
from apps.tasks.models import Comment, Task, TaskActivity

from .explain import cumplimiento_color
from .models import ANALYTICS_ENGINE_VERSION, FORMULA_SET_VERSION
from .priority_compliance import compute_priority_compliance, is_completed_on_time
from .risk_alerts import compute_risk_alerts
from .scoring import (
    compute_completed_pct_any,
    compute_estimated_vs_real_ratio,
    compute_simple_score,
    validate_cumplimiento_consistency,
)
from .utils import is_task_overdue
from .workload import (
    _MONTH_NAMES,
    compute_carga_history,
    compute_carga_tiempo,
    compute_workload_pct,
    compute_workload_range,
    monthly_business_base_for_users,
    redact_sensitive_workload_detail,
)

RECURRING_FREQUENCIES = {"MENSUAL", "SEMANAL", "DIARIA", "QUINCENAL"}
_MONTH_ABBR = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"]


def _carga_color(workload_color: str) -> str:
    """El indicador "Carga Laboral" traduce los 5 colores del semáforo de
    `compute_workload_range` a los 3 niveles KPI — mismo criterio que
    `cargaColor` legacy: verde/rojo se preservan, amarillo/naranja
    (Moderado/Carga elevada) comparten el nivel intermedio."""
    if workload_color == "green":
        return "green"
    if workload_color == "red":
        return "red"
    return "yellow"


def _shift_month(year: int, month: int, delta: int) -> tuple[int, int]:
    total = (year * 12 + (month - 1)) + delta
    return total // 12, total % 12 + 1


def _month_bounds(year: int, month: int) -> tuple[datetime, datetime]:
    next_year, next_month = _shift_month(year, month, 1)
    start = datetime(year, month, 1, tzinfo=dt_timezone.utc)
    end = datetime(next_year, next_month, 1, tzinfo=dt_timezone.utc) - timedelta(microseconds=1)
    return start, end


def build_kpi_payload(*, actor, target, month_param: str | None) -> dict:
    now = django_timezone.now()

    if month_param:
        year_str, month_str = month_param.split("-")
        year, month = int(year_str), int(month_str)
    else:
        year, month = now.year, now.month
        month_param = f"{year}-{month:02d}"

    start, end = _month_bounds(year, month)
    ref_date = end if end < now else now

    tasks = list(
        Task.objects.filter(assigned_to=target, end_date__gte=start, end_date__lte=end).prefetch_related(
            Prefetch(
                "activities",
                queryset=TaskActivity.objects.filter(created_at__gte=start, created_at__lte=end),
            )
        )
    )
    total_comments = Comment.objects.filter(author=target, created_at__gte=start, created_at__lte=end).count()

    carga_tiempo_base = compute_carga_tiempo(user=target, now=now)
    carga_history = compute_carga_history(user=target, now=now)
    carga_tiempo_full = {**carga_tiempo_base, "daily_history": carga_history["daily"], "weekly_history": carga_history["weekly"]}

    # Los permisos médicos y el estado de maternidad/lactancia son datos de
    # salud (Art. 26 LOPDP) — visibles en detalle solo para el propio
    # titular y el Administrador (is_superuser, mismo bypass ya
    # establecido). Para `/kpis/me`, actor y target siempre coinciden, así
    # que esta condición nunca redacta ahí — mismo comportamiento legacy.
    can_see_sensitive_detail = actor.id == target.id or actor.is_superuser
    carga_tiempo = carga_tiempo_full if can_see_sensitive_detail else redact_sensitive_workload_detail(carga_tiempo_full)

    risk_alerts = compute_risk_alerts(
        user=target, now=now, carga_label=carga_tiempo_base["mensual"]["label"], carga_pct=carga_tiempo_base["mensual"]["pct"]
    )

    completed = [t for t in tasks if t.status == Task.Status.COMPLETADA]
    completed_on_time = [t for t in tasks if is_completed_on_time(t)]
    in_progress_tasks = [t for t in tasks if t.status == Task.Status.EN_PROGRESO]
    pending_tasks = [t for t in tasks if t.status == Task.Status.PENDIENTE]
    overdue_tasks = [t for t in tasks if is_task_overdue(t.end_date, t.status, ref_date)]
    completed_pct = round_half_up(len(completed_on_time) / len(tasks) * 100) if tasks else 0
    overdue_pct = round_half_up(len(overdue_tasks) / len(tasks) * 100) if tasks else 0
    avg_delay_days = (
        round_half_up(
            sum(max(0, int((ref_date - t.end_date).total_seconds() // 86400)) for t in overdue_tasks)
            / len(overdue_tasks)
        )
        if overdue_tasks
        else 0
    )

    total_estimated = sum(t.estimated_hours for t in tasks)
    total_real = sum(t.real_hours for t in tasks)
    carga_ratio = compute_estimated_vs_real_ratio(total_real, total_estimated)

    cumplimiento_por_prioridad = compute_priority_compliance(tasks)

    seguimiento_tasks = [t for t in tasks if t.type == Task.Type.SEGUIMIENTO]
    all_activities = [a for t in seguimiento_tasks for a in t.activities.all()]
    by_reason_map: dict[str, dict] = {}
    for act in all_activities:
        entry = by_reason_map.setdefault(act.reason, {"count": 0, "total_minutes": 0})
        entry["count"] += 1
        entry["total_minutes"] += act.duration
    by_reason = [
        {"reason": reason, "count": d["count"], "total_minutes": d["total_minutes"], "avg_minutes": round_half_up(d["total_minutes"] / d["count"])}
        for reason, d in by_reason_map.items()
    ]

    avg_progress = round_half_up(sum(t.progress for t in in_progress_tasks) / len(in_progress_tasks)) if in_progress_tasks else 0
    recurring_tasks = [t for t in tasks if t.frequency in RECURRING_FREQUENCIES]
    recurring_completed = [t for t in recurring_tasks if t.status == Task.Status.COMPLETADA]
    recurring_pct = round_half_up(len(recurring_completed) / len(recurring_tasks) * 100) if recurring_tasks else 0

    assigned_by_others = sum(1 for t in tasks if t.created_by_id != target.id)
    own_tasks = sum(1 for t in tasks if t.created_by_id == target.id)

    score = compute_simple_score(completed_pct, carga_ratio, avg_progress, total_comments)

    week_map: dict[int, dict] = {}
    for t in tasks:
        week_number = -(-t.end_date.day // 7)  # división hacia arriba (ceil)
        entry = week_map.setdefault(week_number, {"estimated": 0.0, "real": 0.0})
        entry["estimated"] += t.estimated_hours
        entry["real"] += t.real_hours
    horas_by_week = [
        {"week": f"Sem {w}", "estimated": round_half_up(d["estimated"], 1), "real": round_half_up(d["real"], 1)}
        for w, d in sorted(week_map.items())
    ]

    history_start_year, history_start_month = _shift_month(year, month, -6)
    history_start = datetime(history_start_year, history_start_month, 1, tzinfo=dt_timezone.utc)
    history_tasks = list(
        Task.objects.filter(assigned_to=target, end_date__gte=history_start, end_date__lte=end).only(
            "end_date", "status", "completed_at"
        )
    )
    cumplimiento_history = []
    for i in range(6):
        hy, hm = _shift_month(year, month, -5 + i)
        hs, he = _month_bounds(hy, hm)
        mt = [t for t in history_tasks if hs <= t.end_date <= he]
        if not mt:
            continue
        mc = sum(1 for t in mt if is_completed_on_time(t))
        pct = round_half_up(mc / len(mt) * 100)
        cumplimiento_history.append(
            {"month": f"{hy}-{hm:02d}", "label": f"{_MONTH_ABBR[hm - 1]}. {hy % 100:02d}", "completed_pct": pct}
        )

    prev_year, prev_month = _shift_month(year, month, -1)
    ps, pe = _month_bounds(prev_year, prev_month)
    prev_real_start, _ = business_day_real_range(ps.date())
    _, prev_real_end = business_day_real_range(pe.date())
    prev_tasks = list(
        Task.objects.filter(assigned_to=target, end_date__gte=ps, end_date__lte=pe).only(
            "status", "completed_at", "end_date"
        )
    )
    prev_activities_count = TaskActivity.objects.filter(author=target, created_at__gte=ps, created_at__lte=pe).count()
    prev_base = business_base_for_range(ps.date(), pe.date())
    prev_fija_hours = sum(
        Task.objects.filter(
            assigned_to=target, type=Task.Type.FIJA, archived_month__isnull=True,
            completed_at__gte=prev_real_start, completed_at__lte=prev_real_end,
        ).values_list("real_hours", flat=True)
    )
    prev_activity_minutes = sum(
        TaskActivity.objects.filter(
            author=target, created_at__gte=prev_real_start, created_at__lte=prev_real_end,
        ).values_list("duration", flat=True)
    )
    prev_carga_real_hours = round_half_up(prev_fija_hours + prev_activity_minutes / 60, 2)
    prev_carga_range = compute_workload_range(
        prev_carga_real_hours, prev_base["limit_base_hours"], prev_base["limit_low_hours"],
        prev_base["limit_high_hours"], prev_base["limit_overload_hours"],
    )
    prev_carga = compute_workload_pct(prev_carga_real_hours, prev_base["limit_base_hours"], prev_carga_range["max"])
    prev_completed = sum(1 for t in prev_tasks if is_completed_on_time(t))
    prev_pct = round_half_up(prev_completed / len(prev_tasks) * 100) if prev_tasks else 0

    validation_failures = validate_cumplimiento_consistency(
        user=target,
        cumplimiento_general={"total": len(tasks), "pct": completed_pct},
        priority_compliance=cumplimiento_por_prioridad,
        now=now,
    )

    payload = {
        "user": {"id": target.id, "name": target.first_name or target.username, "role": _role_name(target)},
        "period": {"month": month_param},
        "cumplimiento": {
            "total": len(tasks),
            "completed": len(completed),
            "completed_on_time": len(completed_on_time),
            "in_progress": len(in_progress_tasks),
            "pending": len(pending_tasks),
            "overdue": len(overdue_tasks),
            "completed_pct": completed_pct,
            "overdue_pct": overdue_pct,
            "avg_delay_days": avg_delay_days,
            "color": cumplimiento_color(completed_pct),
            "explain": {
                "formula": "completadas_a_tiempo / total_tareas × 100",
                "steps": [
                    f"Tareas del período: {len(tasks)}",
                    f"Completadas (cualquier momento): {len(completed)}",
                    f"Completadas a tiempo (completedAt ≤ endDate): {len(completed_on_time)}",
                    f"Cumplimiento = {len(completed_on_time)} / {len(tasks)} = {completed_pct}%",
                ],
            },
        },
        "carga_laboral": {
            "estimated_hours": carga_tiempo_base["mensual"]["base_hours"],
            "real_hours": carga_tiempo_base["mensual"]["real_hours"],
            "ratio": carga_tiempo_base["mensual"]["pct"],
            "color": _carga_color(carga_tiempo_base["mensual"]["color"]),
        },
        "carga_tiempo": carga_tiempo,
        "risk_alerts": risk_alerts,
        "cumplimiento_por_prioridad": cumplimiento_por_prioridad,
        "seguimiento": {"total": len(all_activities), "by_reason": by_reason},
        "calidad": {
            "avg_progress": avg_progress,
            "recurring_completed": len(recurring_completed),
            "recurring_total": len(recurring_tasks),
            "recurring_pct": recurring_pct,
        },
        "actividad": {"total_comments": total_comments, "assigned_by_others": assigned_by_others, "own_tasks": own_tasks},
        "score": score,
        "horas_by_week": horas_by_week,
        "cumplimiento_history": cumplimiento_history,
        "tasks": [_serialize_task_row(t, ref_date) for t in tasks],
        "prev_month": {
            "completed_pct": prev_pct,
            "carga_ratio": prev_carga,
            "total_tasks": len(prev_tasks),
            "seguimiento_total": prev_activities_count,
        },
    }
    if actor.is_superuser and validation_failures:
        payload["validation_warnings"] = validation_failures
    return payload


def build_analytics_bundle_payload(*, actor, target, now: datetime | None = None) -> dict:
    """Payload de `GET /api/analytics/[userId]` — Fase 4m (ver
    docs/AUDIT_LOG.md § 2026-08-12). Envuelve `run_analytics_pipeline`
    (`pipeline.py`, Fase 4l) con la misma redacción admin-only de
    `validation_failures` → `validation_warnings` que ya usa
    `build_kpi_payload` arriba, y agrega los metadatos de versión/caché
    que el frontend (`AnalyticsBundle`, `src/components/kpis/types.ts`)
    espera. `now` se resuelve tarde (no en la firma con default) para
    que los tests puedan fijar un instante determinístico sin depender
    del reloj real.

    Import local de `run_analytics_pipeline` (no al tope del archivo):
    `pipeline.py` importa de `history.py`, que a su vez importa
    `_month_bounds`/`_shift_month` de ESTE módulo (`services.py`) — un
    import a nivel de módulo aquí crearía un ciclo real (a diferencia de
    `_month_bounds` en `scoring.py`, que se duplicó deliberadamente por
    el mismo motivo). Mismo patrón de import diferido ya usado en
    `normalization.get_effective_curve` para evitar el ciclo
    analytics↔configuration."""
    from .pipeline import run_analytics_pipeline

    now = now or django_timezone.now()
    result = run_analytics_pipeline(user=target, now=now)
    validation_failures = result.pop("validation_failures")

    payload = {
        **result,
        "engine_version": ANALYTICS_ENGINE_VERSION,
        "formula_set_version": FORMULA_SET_VERSION,
        "last_updated": now.isoformat(),
        "cache_active": False,
    }
    if actor.is_superuser and validation_failures:
        payload["validation_warnings"] = validation_failures
    return payload


# Máximo de tareas abiertas evaluadas por predicción de retraso individual en
# el bundle de Inteligencia Preventiva — cada llamada a
# `compute_task_delay_prediction` recalcula capacidad/consistencia del MISMO
# usuario (redundante entre tareas), acotado para no degradar el tiempo de
# respuesta cuando alguien tiene muchas tareas abiertas a la vez. Réplica de
# `MAX_TASK_DELAY_PREDICTIONS` (route.ts).
MAX_TASK_DELAY_PREDICTIONS = 10


def build_prediction_bundle_payload(*, actor, target, now: datetime | None = None) -> dict:
    """Payload de `GET /api/predictive/predictions/[userId]` — Fase 9
    (ver docs/AUDIT_LOG.md § 2026-08-18). Réplica de `computeBundle`
    (route.ts): cumplimiento + sobrecarga + estabilidad operativa +
    predicción de retraso de hasta `MAX_TASK_DELAY_PREDICTIONS` tareas
    abiertas del colaborador. Sin capa de caché con TTL — mismo gap ya
    aceptado en `build_analytics_bundle_payload` (`cache_active:
    False`): se calcula en vivo en cada request. `actor` no se usa
    todavía (sin redacción admin-only en este payload), se recibe por
    consistencia de firma con el resto de `build_*_payload`."""
    from .prediction_engine import (
        compute_cumplimiento_projection,
        compute_operational_stability,
        compute_sobrecarga_probability,
        compute_task_delay_prediction,
    )

    now = now or django_timezone.now()
    cumplimiento = compute_cumplimiento_projection(user=target, now=now)
    sobrecarga = compute_sobrecarga_probability(user=target, now=now)
    estabilidad = compute_operational_stability(user=target, now=now)
    open_tasks = list(
        Task.objects.filter(assigned_to=target, archived_month__isnull=True)
        .exclude(status=Task.Status.COMPLETADA)
        .only("id", "title", "end_date")
        .order_by("end_date")[:MAX_TASK_DELAY_PREDICTIONS]
    )
    task_delays = [
        {"task_id": t.id, "title": t.title, "prediction": compute_task_delay_prediction(task_id=t.id, now=now)} for t in open_tasks
    ]
    return {"cumplimiento": cumplimiento, "sobrecarga": sobrecarga, "estabilidad": estabilidad, "task_delays": task_delays}


EMPTY_EXECUTIVE_DASHBOARD: dict = {
    "month": "",
    "overview": {
        "avg_cumplimiento": 0, "avg_cumplimiento_color": "red", "sobrecarga_count": 0,
        "subutilizacion_count": 0, "total_horas": 0, "total_consultas": 0,
    },
    "trend": [],
    "trend_delta": 0,
    "alerts": {"low_cumplimiento": [], "sobrecarga": [], "pending_ideas": []},
    "ranking": [],
    "workload": [],
    "ceo": {
        "estado": "green", "estado_label": "Sin datos", "cambios": [], "atender": [],
        # Réplica fiel del `EMPTY_RESPONSE` del TS — valores por DEFECTO
        # hardcodeados, no calculados (Performance "Crítico"/"red",
        # Operational Risk "Bajo"/"green"), aunque a simple vista parezcan
        # contradictorios con "Sin datos".
        "performance": {"avg": 0, "classification": "Crítico", "color": "red"},
        "operational_risk": {"avg": 0, "classification": "Bajo", "color": "green"},
    },
}


def build_executive_dashboard_payload(*, actor, now: datetime | None = None) -> dict:
    """Payload de `GET /api/kpis/executive` — Fase 21 (ver
    docs/AUDIT_LOG.md § 2026-08-20). Réplica campo por campo de
    `route.ts`: snapshot de 6 meses de los subordinados EJECUTORES de
    `actor` (`get_subordinate_executor_groups`, Fase 19), ranking,
    tendencia, alertas, y un bloque "CEO" (Performance Score/Riesgo
    Operativo promedio del equipo, nunca mezclados en un solo número —
    Sprint 5 § S5-K). 100% ensamblado sobre motor ya portado, sin
    lógica de negocio nueva. Sin capa de caché con TTL — mismo gap ya
    aceptado desde `AnalyticsBundleView` (Fase 4m).

    Imports de `operational_risk`/`performance_score` diferidos (no al
    tope del archivo): ambos módulos importan de `history.py`, que a
    su vez importa `_month_bounds`/`_shift_month` de ESTE módulo
    (`services.py`) — un import a nivel de módulo aquí crearía un
    ciclo real, mismo patrón ya documentado en
    `build_analytics_bundle_payload` para `pipeline.py`."""
    from apps.configuration.services import get_effective_analytics_config
    from apps.hierarchy.services import get_subordinate_executor_groups
    from apps.ideas.models import ImprovementIdea
    from apps.users.models import User

    from .operational_risk import classify_operational_risk, compute_operational_risk
    from .performance_score import classify_performance_score, compute_performance_score

    now = now or django_timezone.now()

    groups = get_subordinate_executor_groups(actor)
    users = sorted(User.objects.filter(groups__in=groups).distinct(), key=lambda u: u.first_name or u.username)
    if not users:
        return EMPTY_EXECUTIVE_DASHBOARD
    user_ids = [u.id for u in users]

    months = [_shift_month(now.year, now.month, -(5 - i)) for i in range(6)]
    range_start, _ = _month_bounds(*months[0])
    _, range_end = _month_bounds(*months[-1])

    month_business_info = []
    for year, month in months:
        biz = monthly_business_base_for_users(users, year, month)
        shared = biz["shared"]
        real_start, _ = business_day_real_range(shared["start"])
        _, real_end = business_day_real_range(shared["end"])
        month_business_info.append({"year": year, "month": month, **shared, "real_start": real_start, "real_end": real_end, "per_user": biz["per_user"]})
    range_real_start = month_business_info[0]["real_start"]
    range_real_end = month_business_info[-1]["real_end"]

    all_tasks = list(
        Task.objects.filter(assigned_to_id__in=user_ids, end_date__gte=range_start, end_date__lte=range_end).only(
            "assigned_to_id", "status", "end_date", "progress", "estimated_hours", "real_hours"
        )
    )
    all_activities = list(
        TaskActivity.objects.filter(
            author_id__in=user_ids, created_at__gte=range_start, created_at__lte=range_end, task__type=Task.Type.SEGUIMIENTO
        ).only("author_id", "created_at")
    )
    fija_tasks_for_carga = list(
        Task.objects.filter(
            assigned_to_id__in=user_ids, type=Task.Type.FIJA, archived_month__isnull=True,
            completed_at__gte=range_real_start, completed_at__lte=range_real_end,
        ).only("assigned_to_id", "real_hours", "completed_at")
    )
    activities_for_carga = list(
        TaskActivity.objects.filter(
            author_id__in=user_ids, created_at__gte=range_real_start, created_at__lte=range_real_end
        ).only("author_id", "duration", "created_at")
    )
    pending_ideas_raw = list(
        ImprovementIdea.objects.filter(status__in=[ImprovementIdea.Status.PROPUESTA, ImprovementIdea.Status.EN_REVISION])
        .select_related("author")
        .order_by("-created_at")[:10]
    )

    def biz_for_user(biz_info: dict, user_id: int) -> dict:
        return biz_info["per_user"].get(user_id, biz_info)

    month_snapshots = []
    for biz_info in month_business_info:
        start, end = _month_bounds(biz_info["year"], biz_info["month"])
        month_tasks = [t for t in all_tasks if start <= t.end_date <= end]
        month_acts = [a for a in all_activities if start <= a.created_at <= end]
        month_fija = [t for t in fija_tasks_for_carga if biz_info["real_start"] <= t.completed_at <= biz_info["real_end"]]
        month_carga_acts = [a for a in activities_for_carga if biz_info["real_start"] <= a.created_at <= biz_info["real_end"]]

        members: list[dict] = []
        for user in users:
            tasks = [t for t in month_tasks if t.assigned_to_id == user.id]
            completed = sum(1 for t in tasks if t.status == Task.Status.COMPLETADA)
            completed_pct = compute_completed_pct_any(tasks)

            fija_hours = sum(t.real_hours for t in month_fija if t.assigned_to_id == user.id)
            activity_hours = sum(a.duration for a in month_carga_acts if a.author_id == user.id) / 60
            carga_real_hours = round_half_up(fija_hours + activity_hours, 2)

            user_biz = biz_for_user(biz_info, user.id)
            carga_range = compute_workload_range(
                carga_real_hours, user_biz["limit_base_hours"], user_biz["limit_low_hours"],
                user_biz["limit_high_hours"], user_biz["limit_overload_hours"],
            )
            carga_pct = compute_workload_pct(carga_real_hours, user_biz["limit_base_hours"], carga_range["max"])

            in_progress = [t for t in tasks if t.status == Task.Status.EN_PROGRESO]
            avg_progress = round_half_up(sum(t.progress for t in in_progress) / len(in_progress)) if in_progress else 0
            total_estimated = sum(t.estimated_hours for t in tasks)
            total_real = sum(t.real_hours for t in tasks)
            carga_ratio = compute_estimated_vs_real_ratio(total_real, total_estimated)
            score = compute_simple_score(completed_pct, carga_ratio, avg_progress)

            members.append(
                {
                    "id": user.id, "name": user.first_name or user.username, "role": _role_name(user),
                    "completed_pct": completed_pct, "completed": completed, "carga_pct": carga_pct,
                    "carga_real_hours": carga_real_hours, "carga_base_hours": user_biz["base_hours"],
                    "carga_color": carga_range["color"], "carga_label": carga_range["label"],
                    "total_tasks": len(tasks), "score": score,
                }
            )

        active_members = [m for m in members if m["total_tasks"] > 0]
        avg_cumplimiento = round_half_up(sum(m["completed_pct"] for m in active_members) / len(active_members)) if active_members else 0

        month_snapshots.append(
            {
                "key": f"{biz_info['year']}-{biz_info['month']:02d}",
                "label": f"{_MONTH_ABBR[biz_info['month'] - 1]}. {biz_info['year'] % 100:02d}",
                "avg_cumplimiento": avg_cumplimiento,
                "total_horas": round_half_up(sum(m["carga_real_hours"] for m in members), 2),
                "total_consultas": len(month_acts),
                "members": members,
            }
        )

    current = month_snapshots[-1]
    previous = month_snapshots[-2] if len(month_snapshots) >= 2 else None
    previous_by_user = {m["id"]: m for m in previous["members"]} if previous else {}

    sobrecarga_count = sum(1 for m in current["members"] if m["carga_label"] == "Sobrecarga")
    subutilizacion_count = sum(1 for m in current["members"] if m["carga_label"] == "Subutilización")

    trend = [
        {"month": ms["key"], "label": ms["label"], "avg_cumplimiento": ms["avg_cumplimiento"]}
        for ms in month_snapshots
        if any(m["total_tasks"] > 0 for m in ms["members"])
    ]
    trend_delta = current["avg_cumplimiento"] - previous["avg_cumplimiento"] if previous else 0

    low_cumplimiento = [
        {"type": "cumplimiento", "user_id": m["id"], "name": m["name"], "value": m["completed_pct"]}
        for m in current["members"]
        if m["total_tasks"] > 0 and m["completed_pct"] < 60
    ]
    sobrecarga_alerts = [
        {"type": "sobrecarga", "user_id": m["id"], "name": m["name"], "value": m["carga_pct"]}
        for m in current["members"]
        if m["carga_label"] == "Sobrecarga"
    ]
    pending_ideas = [
        {"id": i.id, "title": i.title, "status": i.status, "author_name": i.author.first_name or i.author.username}
        for i in pending_ideas_raw
    ]

    ranking = sorted(
        (
            {**m, "score_trend": m["score"] - previous_by_user.get(m["id"], {}).get("score", m["score"])}
            for m in current["members"]
        ),
        key=lambda m: m["score"],
        reverse=True,
    )
    workload = [
        {"id": m["id"], "name": m["name"], "real_hours": m["carga_real_hours"], "base_hours": m["carga_base_hours"], "color": m["carga_color"]}
        for m in current["members"]
    ]

    # ── Bloque CEO (§S2-A, ampliado en Sprint 5 § S5-K) ──────────────────
    analytics_config = get_effective_analytics_config(now)
    perf_scores = [compute_performance_score(user=u, now=now)["score"] for u in users]
    risk_scores = [compute_operational_risk(user=u, now=now)["score"] for u in users]
    avg_perf = round_half_up(sum(perf_scores) / len(perf_scores) * 10) / 10 if perf_scores else 0
    avg_risk = round_half_up(sum(risk_scores) / len(risk_scores) * 10) / 10 if risk_scores else 0
    perf_classification_info = classify_performance_score(avg_perf)
    perf_classification, perf_color = perf_classification_info["classification"], perf_classification_info["classification_color"]
    risk_classified = classify_operational_risk(
        avg_risk, analytics_config["risk_threshold_medio"], analytics_config["risk_threshold_alto"], analytics_config["risk_threshold_critico"]
    )

    if current["avg_cumplimiento"] < 60 or sobrecarga_count >= 2:
        estado = "red"
    elif current["avg_cumplimiento"] < 80 or sobrecarga_count >= 1 or len(low_cumplimiento) >= 1:
        estado = "yellow"
    else:
        estado = "green"
    estado_label = {"red": "Crítico", "yellow": "Atención"}.get(estado, "Saludable")

    cambios: list[dict] = []
    if previous:
        cambios.append({"text": f"Cumplimiento {'+' if trend_delta >= 0 else ''}{trend_delta}%", "positive": trend_delta >= 0})
    for m in current["members"]:
        prev_label = previous_by_user.get(m["id"], {}).get("carga_label")
        if m["carga_label"] == "Sobrecarga" and prev_label != "Sobrecarga":
            cambios.append({"text": f"{m['name']} quedó sobrecargado/a", "positive": False})
        elif prev_label == "Sobrecarga" and m["carga_label"] != "Sobrecarga":
            cambios.append({"text": f"{m['name']} salió de sobrecarga", "positive": True})

    ranking_with_trend = [m for m in ranking if abs(m["score_trend"]) >= 5]
    improvers = sorted((m for m in ranking_with_trend if m["score_trend"] > 0), key=lambda m: m["score_trend"], reverse=True)
    if improvers:
        top = improvers[0]
        cambios.append({"text": f"{top['name']} mejoró su score +{top['score_trend']} pts", "positive": True})
    decliners = sorted((m for m in ranking_with_trend if m["score_trend"] < 0), key=lambda m: m["score_trend"])
    if decliners:
        top = decliners[0]
        cambios.append({"text": f"{top['name']} bajó su score {top['score_trend']} pts", "positive": False})
    completers = sorted((m for m in current["members"] if m["completed"] >= 3), key=lambda m: m["completed"], reverse=True)
    if completers:
        top = completers[0]
        cambios.append({"text": f"{top['name']} completó {top['completed']} tareas este mes", "positive": True})

    atender_candidates: list[dict] = []
    for a in sobrecarga_alerts:
        atender_candidates.append({"text": f"{a['name']} — sobrecarga proyectada ({a['value']}%)", "severity": 100 + a["value"]})
    for a in low_cumplimiento:
        prev_pct = previous_by_user.get(a["user_id"], {}).get("completed_pct")
        declining = prev_pct is not None and a["value"] < prev_pct
        text = (
            f"{a['name']} — cumplimiento en descenso ({a['value']}%, antes {prev_pct}%)"
            if declining
            else f"{a['name']} — cumplimiento bajo ({a['value']}%)"
        )
        atender_candidates.append({"text": text, "severity": 100 - a["value"]})
    if perf_classification in ("Riesgo", "Crítico"):
        atender_candidates.append({"text": f"Performance Score del equipo en {perf_classification} ({avg_perf})", "severity": 100 - avg_perf})
    if risk_classified["classification"] in ("Alto", "Crítico"):
        atender_candidates.append({"text": f"Operational Risk del equipo en {risk_classified['classification']} ({avg_risk})", "severity": avg_risk})
    atender = [c["text"] for c in sorted(atender_candidates, key=lambda c: c["severity"], reverse=True)[:3]]

    return {
        "month": current["key"],
        "overview": {
            "avg_cumplimiento": current["avg_cumplimiento"],
            "avg_cumplimiento_color": cumplimiento_color(current["avg_cumplimiento"]),
            "sobrecarga_count": sobrecarga_count,
            "subutilizacion_count": subutilizacion_count,
            "total_horas": current["total_horas"],
            "total_consultas": current["total_consultas"],
        },
        "trend": trend,
        "trend_delta": trend_delta,
        "alerts": {"low_cumplimiento": low_cumplimiento, "sobrecarga": sobrecarga_alerts, "pending_ideas": pending_ideas},
        "ranking": ranking,
        "workload": workload,
        "ceo": {
            "estado": estado,
            "estado_label": estado_label,
            "cambios": cambios[:4],
            "atender": atender,
            "performance": {"avg": avg_perf, "classification": perf_classification, "color": perf_color},
            "operational_risk": {"avg": avg_risk, "classification": risk_classified["classification"], "color": risk_classified["classification_color"]},
        },
    }


def get_team_members(user) -> list:
    """Colaboradores "subordinados" de `user` — mismo conjunto que
    `getSubordinateRoles`: grupos visibles EXCLUYENDO el propio.
    Consumido por `team-alerts`/`team-subutilization` (Fase 9b, ver
    docs/AUDIT_LOG.md § 2026-08-18)."""
    from apps.hierarchy.services import get_subordinate_groups
    from apps.users.models import User

    groups = get_subordinate_groups(user)
    if not groups:
        return []
    return list(User.objects.filter(groups__in=groups).distinct().only("id", "first_name"))


def get_visible_team_project_ids(user, subordinate_user_ids: list[int]) -> list[int]:
    """Proyectos activos visibles para un escaneo de equipo — liderazgo
    (nivel >= 3) ve todos los proyectos activos; el resto solo los
    propios (responsable/creador/participante, propio o de un
    subordinado directo). Réplica del filtro inline de
    `team-alerts/route.ts` (Fase 9b, ver docs/AUDIT_LOG.md §
    2026-08-18), mismo criterio que `apps.projects.permissions.
    can_view_project` extendido aquí a una lista."""
    from django.db.models import Q

    from apps.hierarchy.services import is_leadership
    from apps.projects.models import Project

    qs = Project.objects.filter(deleted_at__isnull=True).exclude(status__in=[Project.Status.COMPLETADO, Project.Status.CANCELADO])
    if not is_leadership(user):
        qs = qs.filter(
            Q(responsible=user) | Q(created_by=user) | Q(participants__user_id__in=[user.id, *subordinate_user_ids])
        ).distinct()
    return list(qs.values_list("id", flat=True))


def _role_name(user) -> str:
    group = user.groups.first()
    return group.name if group else ""


def _month_key(now: datetime) -> str:
    return f"{now.year}-{now.month:02d}"


def notify_if_high_risk(*, user, risk: dict, now: datetime) -> None:
    """Réplica de `notifyIfHighRisk` (`operational-risk/team/route.ts`)
    — Fase 20 (ver docs/AUDIT_LOG.md § 2026-08-20). Cuando el Riesgo
    Operativo de `user` es Alto/Crítico, notifica UNA vez por persona/
    mes a sus superiores directos (`get_notification_target_groups`,
    ya portado desde la Fase 1). Deduplicado vía
    `Notification.dedup_key` (campo nuevo — el TS reutiliza `taskId`,
    un `String` en Prisma, como marcador de texto libre; en Django
    `task_id` es un `PositiveBigIntegerField` real desde la Fase 3f,
    no reutilizable para esto, ver `apps/notifications/models.py`).
    Usa la configuración por DEFECTO de destinos de notificación
    (`get_notification_target_groups`) — el override configurable vía
    Ajustes → Reglas de Notificación (`commentTargets` en
    `getNotificationRules()`) todavía no tiene equivalente en Django,
    gap documentado en `docs/AUDIT_LOG.md`."""
    from apps.hierarchy.services import get_notification_target_groups, get_role_group
    from apps.notifications.models import Notification
    from apps.users.models import User

    if risk["classification"] not in ("Alto", "Crítico"):
        return
    marker = f"analytics-risk:{user.id}:{_month_key(now)}"
    if Notification.objects.filter(dedup_key=marker).exists():
        return

    role_group = get_role_group(user)
    if role_group is None:
        return
    target_groups = get_notification_target_groups(role_group)
    if not target_groups:
        return
    targets = list(User.objects.filter(groups__in=target_groups).distinct())
    if not targets:
        return

    message = f"Riesgo operativo {risk['classification'].lower()} ({risk['score']}/100) detectado para {user.first_name or user.username}"
    Notification.objects.bulk_create([Notification(user=t, message=message, dedup_key=marker) for t in targets])


def _serialize_task_row(task: Task, ref_date: datetime) -> dict:
    is_overdue = is_task_overdue(task.end_date, task.status, ref_date)
    delay_days = max(0, int((ref_date - task.end_date).total_seconds() // 86400)) if is_overdue else 0
    if task.status == Task.Status.COMPLETADA:
        color = "green"
    elif is_overdue:
        color = "red"
    else:
        color = "yellow"
    return {
        "id": task.id,
        "title": task.title,
        "type": task.type,
        "status": task.status,
        "end_date": task.end_date.isoformat(),
        "delay_days": delay_days,
        "color": color,
    }


def _month_label_range(year: int, month: int) -> str:
    """Formato "{mes} de {año}" (`Intl.DateTimeFormat('es-CL', {month:
    'long', year:'numeric'})`) — DELIBERADAMENTE distinto del
    "{mes} {año}" sin "de" de `_format_month_label`
    (`carga_tiempo.mensual.month_label`, Fase 4b): son 2 formatos legacy
    independientes (funciones distintas en el TS original), no un
    error a unificar."""
    return f"{_MONTH_NAMES[month - 1]} de {year}"


def build_kpi_range_payload(*, user, from_str: str, to_str: str, months: list[tuple[int, int]]) -> dict:
    """Orquestador de `GET /api/kpis/me/range` — Fase 4c (ver
    docs/AUDIT_LOG.md § 2026-08-11). Réplica del cuerpo de la ruta
    legacy una vez validados `from`/`to`/`months` (la validación de
    forma vive en la vista, igual que el resto de las vistas de esta
    app). Usa la Definición A de "cumplimiento" (`compute_completed_pct_any`),
    deliberadamente distinta de la Definición B (`is_completed_on_time`)
    que usan `/kpis/me`/`/kpis/<id>/` — mismo gap legacy aceptado."""
    now = django_timezone.now()
    fy, fm = months[0]
    ty, tm = months[-1]
    range_start, _ = _month_bounds(fy, fm)
    _, range_end = _month_bounds(ty, tm)

    month_business_info = []
    for year, month in months:
        month_str = f"{year}-{month:02d}"
        multi = monthly_business_base_for_users([user], year, month)
        info = multi["per_user"].get(user.id) or multi["shared"]
        real_start, _ = business_day_real_range(info["start"])
        _, real_end = business_day_real_range(info["end"])
        month_business_info.append(
            {
                "month_str": month_str,
                "real_start": real_start,
                "real_end": real_end,
                "base_hours": info["base_hours"],
                "limit_base_hours": info["limit_base_hours"],
                "limit_low_hours": info["limit_low_hours"],
                "limit_high_hours": info["limit_high_hours"],
                "limit_overload_hours": info["limit_overload_hours"],
            }
        )
    range_real_start = month_business_info[0]["real_start"]
    range_real_end = month_business_info[-1]["real_end"]

    all_tasks = list(
        Task.objects.filter(assigned_to=user, end_date__gte=range_start, end_date__lte=range_end).only(
            "end_date", "status", "type", "estimated_hours", "real_hours", "progress"
        )
    )
    all_activities = list(
        TaskActivity.objects.filter(
            author=user, created_at__gte=range_start, created_at__lte=range_end, task__type=Task.Type.SEGUIMIENTO
        ).only("reason", "duration", "created_at")
    )
    fija_completed_tasks = list(
        Task.objects.filter(
            assigned_to=user, type=Task.Type.FIJA, completed_at__gte=range_start, completed_at__lte=range_end
        ).only("completed_at", "real_hours")
    )
    fija_tasks_for_carga = list(
        Task.objects.filter(
            assigned_to=user, type=Task.Type.FIJA, completed_at__gte=range_real_start, completed_at__lte=range_real_end
        ).only("completed_at", "real_hours")
    )
    activities_for_carga = list(
        TaskActivity.objects.filter(
            author=user, created_at__gte=range_real_start, created_at__lte=range_real_end
        ).only("duration", "created_at")
    )

    month_snapshots = []
    for year, month in months:
        start, end = _month_bounds(year, month)
        ref_date = end if end < now else now
        month_str = f"{year}-{month:02d}"
        biz_info = next(b for b in month_business_info if b["month_str"] == month_str)

        tasks = [t for t in all_tasks if start <= t.end_date <= end]
        activities = [a for a in all_activities if start <= a.created_at <= end]

        completed = sum(1 for t in tasks if t.status == Task.Status.COMPLETADA)
        completed_pct = compute_completed_pct_any(tasks)

        total_estimated = sum(t.estimated_hours for t in tasks)
        non_fija_real = sum(t.real_hours for t in tasks if t.type != Task.Type.FIJA)
        fija_real = sum(t.real_hours for t in fija_completed_tasks if t.completed_at and start <= t.completed_at <= end)
        total_real = non_fija_real + fija_real
        carga_ratio = compute_estimated_vs_real_ratio(total_real, total_estimated)

        in_progress = [t for t in tasks if t.status == Task.Status.EN_PROGRESO]
        avg_progress = round_half_up(sum(t.progress for t in in_progress) / len(in_progress)) if in_progress else 0

        score = compute_simple_score(completed_pct, carga_ratio, avg_progress)

        overdue_count = sum(1 for t in tasks if is_task_overdue(t.end_date, t.status, ref_date))

        month_fija_carga = [
            t for t in fija_tasks_for_carga if t.completed_at and biz_info["real_start"] <= t.completed_at <= biz_info["real_end"]
        ]
        month_acts_carga = [
            a for a in activities_for_carga if biz_info["real_start"] <= a.created_at <= biz_info["real_end"]
        ]
        carga_real_hours = round_half_up(
            sum(t.real_hours for t in month_fija_carga) + sum(a.duration for a in month_acts_carga) / 60, 2
        )
        carga_base_hours = biz_info["base_hours"]
        carga_range = compute_workload_range(
            carga_real_hours, biz_info["limit_base_hours"], biz_info["limit_low_hours"],
            biz_info["limit_high_hours"], biz_info["limit_overload_hours"],
        )
        carga_pct = compute_workload_pct(carga_real_hours, biz_info["limit_base_hours"], carga_range["max"])

        month_snapshots.append(
            {
                "month": month_str,
                "label": _month_label_range(year, month),
                "completed_pct": completed_pct,
                "total_tasks": len(tasks),
                "completed_tasks": completed,
                "overdue_count": overdue_count,
                "real_hours": round_half_up(total_real, 2),
                "estimated_hours": round_half_up(total_estimated, 2),
                "seguimiento_total": len(activities),
                "score": score,
                "carga_real_hours": carga_real_hours,
                "carga_base_hours": carga_base_hours,
                "carga_pct": carga_pct,
                "carga_color": carga_range["color"],
                "carga_label": carga_range["label"],
                "carga_range_min": round_half_up(biz_info["limit_base_hours"], 2),
                "carga_range_max": carga_range["max"],
            }
        )

    active_months = [m for m in month_snapshots if m["total_tasks"] > 0]
    avg_cumplimiento = round_half_up(sum(m["completed_pct"] for m in active_months) / len(active_months)) if active_months else 0
    avg_score = round_half_up(sum(m["score"] for m in active_months) / len(active_months)) if active_months else 0
    total_tasks = sum(m["total_tasks"] for m in month_snapshots)
    total_completed_tasks = sum(m["completed_tasks"] for m in month_snapshots)
    total_real_hours = round_half_up(sum(m["real_hours"] for m in month_snapshots), 2)
    total_estimated_hours = round_half_up(sum(m["estimated_hours"] for m in month_snapshots), 2)
    total_seguimiento = sum(m["seguimiento_total"] for m in month_snapshots)

    total_carga_real_hours = round_half_up(sum(m["carga_real_hours"] for m in month_snapshots), 2)
    total_carga_base_hours = round_half_up(sum(b["base_hours"] for b in month_business_info), 2)
    total_limit_base_hours = sum(b["limit_base_hours"] for b in month_business_info)
    total_limit_low_hours = sum(b["limit_low_hours"] for b in month_business_info)
    total_limit_high_hours = sum(b["limit_high_hours"] for b in month_business_info)
    total_limit_overload_hours = sum(b["limit_overload_hours"] for b in month_business_info)
    carga_range_agg = compute_workload_range(
        total_carga_real_hours, total_limit_base_hours, total_limit_low_hours,
        total_limit_high_hours, total_limit_overload_hours,
    )
    avg_carga_pct = compute_workload_pct(total_carga_real_hours, total_limit_base_hours, carga_range_agg["max"])

    by_reason_map: dict[str, dict] = {}
    for act in all_activities:
        entry = by_reason_map.setdefault(act.reason, {"count": 0, "total_minutes": 0})
        entry["count"] += 1
        entry["total_minutes"] += act.duration
    consultas_by_reason = sorted(
        ({"reason": r, "count": d["count"], "total_minutes": d["total_minutes"]} for r, d in by_reason_map.items()),
        key=lambda x: x["count"],
        reverse=True,
    )

    first_active = next((m for m in month_snapshots if m["total_tasks"] > 0), None)
    last_active = next((m for m in reversed(month_snapshots) if m["total_tasks"] > 0), None)
    first_pct = first_active["completed_pct"] if first_active else 0
    last_pct = last_active["completed_pct"] if last_active else 0
    change = last_pct - first_pct
    if abs(change) > 5:
        trend = "mejora" if change > 0 else "deterioro"
    else:
        trend = "estancamiento"

    return {
        "report": {
            "from": from_str,
            "to": to_str,
            "months": month_snapshots,
            "aggregated": {
                "avg_cumplimiento": avg_cumplimiento,
                "avg_score": avg_score,
                "total_tasks": total_tasks,
                "total_completed_tasks": total_completed_tasks,
                "total_real_hours": total_real_hours,
                "total_estimated_hours": total_estimated_hours,
                "total_seguimiento": total_seguimiento,
                "consultas_by_reason": consultas_by_reason,
                "total_carga_real_hours": total_carga_real_hours,
                "total_carga_base_hours": total_carga_base_hours,
                "avg_carga_pct": avg_carga_pct,
                "carga_color": carga_range_agg["color"],
                "carga_label": carga_range_agg["label"],
                "carga_range_min": round_half_up(total_limit_base_hours, 2),
                "carga_range_max": carga_range_agg["max"],
            },
            "trends": {
                "cumplimiento_trend": trend,
                "cumplimiento_change": change,
                "first_month_cumplimiento": first_pct,
                "last_month_cumplimiento": last_pct,
            },
        }
    }
