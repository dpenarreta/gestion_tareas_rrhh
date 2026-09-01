"""Fases 68/69 de la migración de stack (ver docs/AUDIT_LOG.md §
2026-08-26) — parte (2) de las "3 partes que faltan del motor de
cálculo de Reportes Ejecutivos" pedidas por el usuario tras la Fase
67: primer paso del cutover HTTP real de `buildSnapshotData.ts`.

Capa de ENSAMBLADO que combina `apps.reports.member_kpis` (Fases
64-66) + `apps.reports.insights` (Fase 67) en el "bundle" completo que
necesita cada builder de `buildSnapshotData.ts` — mismo criterio de
capas que ya separaba esos 2 módulos (`member_kpis` CALCULA KPIs,
`insights` INTERPRETA, `team_report` ENSAMBLA). Deliberadamente SIN
wiring a `buildSnapshotData.ts` todavía — mismo patrón "endpoint
primero, cutover de TS después" que el port original de KPIs/Analytics:
se construye y prueba cada endpoint en aislamiento, verificado con
datos reales recién en la fase de cutover.

**Los 3 builders, en el mismo orden que sus assemblers de
`member_kpis.py` (Fases 64/65/66):** `assemble_monthly_team_report`
(Fase 68, MENSUAL), `assemble_custom_range_team_report`/
`assemble_range_team_report` (Fase 69, RANGO PERSONALIZADO/RANGO DE
MESES).

**Fuera de alcance de este bundle, deliberadamente — el caller
(Next.js) sigue resolviendo estas piezas, sin cambios:**
- **Identidad del roster:** este módulo SÍ incluye `id`/`name`/`role`
  en cada miembro (a diferencia de `member_kpis.py`, que los omite)
  porque `compute_findings`/`compute_recommendations`/
  `compute_team_insights` (Fase 67) los necesitan en el texto de sus
  reglas — se resuelven acá desde el propio `User` de Django
  (`first_name or username` / primer `Group.name`), NO desde el
  roster de Prisma. Mismo criterio de nombre que
  `apps.users.self_service_views.AssignableUsersView`.
- **Índice Ejecutivo** (Performance Score/Equilibrio Operativo por
  colaborador, mes en curso) — ya vive en Django desde la Fase 57
  (`GET /analytics/<id>/`), pero es una llamada aparte por
  colaborador con su propio caché; no se duplica acá.
  `estado_operativo`/`principal_hallazgo` por miembro (que en el
  builder MENSUAL de TS dependen del `equilibrioScore` de ese Índice
  Ejecutivo) tampoco se calculan en este bundle — el caller los
  sigue derivando con su propia copia de `deriveEstadoOperativo`/
  `computePrincipalHallazgo` (`reportInsights.ts`), que NO se
  elimina.
- **Analytics Predictivo** (`predictionEngine.ts`) y **narrativa NOVA**
  — motores aparte, sin cambios, ninguno de los dos depende de este
  bundle.
- **Metadatos de reporte** (`reportId`/`generationMs`/versiones/
  `generatedBy`/`closure`) — el caller los sigue generando, este
  bundle es puro contenido calculado."""

from datetime import date, datetime
from datetime import timezone as dt_timezone

from apps.analytics.scoring import compute_data_quality
from apps.analytics.workload import (
    compute_workload_pct,
    compute_workload_range,
    get_month_closure_period,
    monthly_business_base,
    monthly_business_base_for_users,
)
from apps.configuration.services import business_base_for_range
from apps.core.rounding import round_half_up
from apps.tasks.models import Task, TaskActivity
from apps.users.models import User

from .insights import (
    compute_findings,
    compute_recommendations,
    compute_risk_quadrant,
    compute_team_insights,
    compute_team_monthly_snapshots,
    compute_trend_comparisons,
    explain_carga_indicator,
    explain_consultas_indicator,
    explain_cumplimiento_indicator,
    explain_motivo_distribution,
    get_activity_reason_label_map,
    previous_equivalent_period,
    resolve_custom_range_period_status,
    resolve_monthly_period_status,
)
from .member_kpis import (
    _local_month_bounds,
    _month_bounds,
    compute_custom_range_member_kpis,
    compute_effective_member_bases,
    compute_monthly_member_kpis,
    compute_range_member_kpis,
    resolve_closure_cutoff,
)


def _user_identity(user: User) -> dict:
    groups = list(user.groups.all())
    return {"id": user.id, "name": user.first_name or user.username, "role": groups[0].name if groups else ""}


def compute_team_alerts(members: list[dict]) -> list[dict]:
    """Réplica del bloque `alerts` de `buildMonthlySnapshotData` —
    umbral fijo, sin agregación por mes (a diferencia de las alertas de
    RANGO_MESES, que sí acumulan meses afectados, fuera de alcance de
    esta fase)."""
    alerts: list[dict] = []
    for m in members:
        if m["completed_pct"] < 60 and m["total_tasks"] > 0:
            alerts.append({"user_id": m["id"], "name": m["name"], "type": "cumplimiento", "value": m["completed_pct"]})
        if m["carga_label"] == "Sobrecarga":
            alerts.append({"user_id": m["id"], "name": m["name"], "type": "sobrecarga", "value": m["carga_pct"]})
    return alerts


def compute_monthly_ranking(members: list[dict]) -> list[dict]:
    """Réplica del `ranking` del builder MENSUAL — orden por `score`
    desc, `completed_pct` desc como desempate (distinto del ranking de
    RANGO_MESES, que prioriza `completed_pct` primero)."""
    ranked = sorted(members, key=lambda m: (-m["score"], -m["completed_pct"]))
    return [{"id": m["id"], "name": m["name"], "role": m["role"], "score": m["score"], "completed_pct": m["completed_pct"]} for m in ranked]


def compute_consultas_by_reason(user_ids: list[int], start: datetime, end: datetime, prev_start: datetime, prev_end: datetime) -> list[dict]:
    """Agrupa `TaskActivity` (tipo SEGUIMIENTO) por motivo dentro de
    `[start, end]`, con %/tendencia vs. `[prev_start, prev_end]` — réplica
    del bloque `teamReasonMap`/`consultasByReason` de
    `buildMonthlySnapshotData`. `end`/`prev_end` NO se acotan acá por
    `cutoff` — el caller ya debe pasar el límite superior correcto
    (`data_upper_bound` para el período actual; fin de mes calendario
    completo, SIN cutoff, para el período anterior — mismo criterio que
    el TS, que nunca acota `prevActivities` por fecha de corte)."""
    activities = list(
        TaskActivity.objects.filter(author_id__in=user_ids, created_at__gte=start, created_at__lte=end, task__type=Task.Type.SEGUIMIENTO).only(
            "reason", "duration"
        )
    )
    prev_activities = list(
        TaskActivity.objects.filter(
            author_id__in=user_ids, created_at__gte=prev_start, created_at__lte=prev_end, task__type=Task.Type.SEGUIMIENTO
        ).only("reason")
    )

    reason_map: dict[str, dict] = {}
    for act in activities:
        entry = reason_map.setdefault(act.reason, {"count": 0, "total_minutes": 0})
        entry["count"] += 1
        entry["total_minutes"] += act.duration

    prev_reason_count: dict[str, int] = {}
    for act in prev_activities:
        prev_reason_count[act.reason] = prev_reason_count.get(act.reason, 0) + 1

    total = len(activities)
    label_map = get_activity_reason_label_map()
    items = []
    for reason, d in reason_map.items():
        pct = round_half_up(d["count"] / total * 100) if total > 0 else 0
        prev_count = prev_reason_count.get(reason)
        trend_pct = round_half_up((d["count"] - prev_count) / prev_count * 100) if prev_count else None
        items.append(
            {
                "reason": reason,
                "count": d["count"],
                "total_minutes": d["total_minutes"],
                "pct": pct,
                "trend_pct": trend_pct,
                "interpretation": explain_motivo_distribution(reason, label_map.get(reason, reason), pct, trend_pct),
            }
        )
    items.sort(key=lambda x: -x["count"])
    return items


def assemble_monthly_team_report(
    *,
    user_ids: list[int],
    year: int,
    month: int,
    explicit_fecha_corte: datetime | None = None,
    now: datetime | None = None,
) -> dict:
    """Ensamblador principal — réplica del bundle de
    `buildMonthlySnapshotData` que SÍ puede calcularse solo con
    `member_kpis`/`insights` (ver docstring del módulo para lo que
    queda fuera). `user_ids` son ids numéricos de Django — el roster
    (`GET /reports/roster/`) ya los expone directo, sin traducción
    intermedia (retiro del bridge cuid↔Django, decisión explícita del
    usuario, ver docs/AUDIT_LOG.md § 2026-08-31)."""
    now = now or datetime.now(dt_timezone.utc)
    users = list(User.objects.filter(id__in=user_ids))

    kpis_by_id = compute_monthly_member_kpis(user_ids=user_ids, year=year, month=month, explicit_fecha_corte=explicit_fecha_corte, now=now)
    members = [{**_user_identity(user), **kpis_by_id[user.id]} for user in users if user.id in kpis_by_id]

    total_consultas = sum(m["seguimiento_total"] for m in members)
    total_tasks = sum(m["total_tasks"] for m in members)
    total_completed_tasks = sum(m["completed_tasks"] for m in members)
    total_overdue = sum(m["overdue_count"] for m in members)
    total_carga_real_hours = round_half_up(sum(m["carga_real_hours"] for m in members) * 100) / 100
    total_carga_base_hours = round_half_up(sum(m["carga_base_hours"] for m in members) * 100) / 100

    base = monthly_business_base(year, month)
    _closure, _natural_end, effective_end = get_month_closure_period(year, month)
    carga_start = date(year, month, 1)
    effective_bases = compute_effective_member_bases(
        users, carga_start, effective_end, base["hours_per_day"], base["limit_low_per_day"], base["limit_high_per_day"], base["limit_overload_per_day"], now=now
    )
    total_limit_base_hours = sum(effective_bases[u.id]["limit_base_hours"] for u in users)
    total_limit_low_hours = sum(effective_bases[u.id]["limit_low_hours"] for u in users)
    total_limit_high_hours = sum(effective_bases[u.id]["limit_high_hours"] for u in users)
    total_limit_overload_hours = sum(effective_bases[u.id]["limit_overload_hours"] for u in users)
    team_carga_range = compute_workload_range(total_carga_real_hours, total_limit_base_hours, total_limit_low_hours, total_limit_high_hours, total_limit_overload_hours)
    avg_carga_pct = compute_workload_pct(total_carga_real_hours, total_limit_base_hours, team_carga_range["max"])
    avg_cumplimiento = round_half_up(sum(m["completed_pct"] for m in members) / len(members)) if members else 0
    carga_range_per_person = compute_workload_range(0, base["base_hours"], base["limit_low_hours"], base["limit_high_hours"], base["limit_overload_hours"])

    start, end = _month_bounds(year, month)
    cutoff = resolve_closure_cutoff(year, month, explicit_fecha_corte, end, now)
    data_upper_bound = min(end, cutoff)
    prev_month = 12 if month == 1 else month - 1
    prev_year = year - 1 if month == 1 else year
    prev_start, prev_end = _month_bounds(prev_year, prev_month)
    consultas_by_reason = compute_consultas_by_reason(user_ids, start, data_upper_bound, prev_start, prev_end)
    total_consultas_prev = TaskActivity.objects.filter(
        author_id__in=user_ids, created_at__gte=prev_start, created_at__lte=prev_end, task__type=Task.Type.SEGUIMIENTO
    ).count()

    reason_label_map = get_activity_reason_label_map()
    top_reason = (
        {"label": reason_label_map.get(consultas_by_reason[0]["reason"], consultas_by_reason[0]["reason"]), "pct": consultas_by_reason[0]["pct"]}
        if consultas_by_reason
        else None
    )

    risk_quadrant = compute_risk_quadrant(members)
    team_snapshots = compute_team_monthly_snapshots(user_ids, year, month, 6)
    trends = compute_trend_comparisons(team_snapshots)

    findings = compute_findings(
        avg_cumplimiento=avg_cumplimiento, avg_cumplimiento_delta=trends["mes_anterior"]["delta"], members=members, total_overdue=total_overdue, top_reason=top_reason
    )
    recommendations = compute_recommendations(avg_cumplimiento=avg_cumplimiento, members=members, top_reason=top_reason)
    # `health_by_member`/`variable_consistency_members` dependen del Índice
    # Ejecutivo (Django, Fase 57, llamada aparte por colaborador) — fuera de
    # alcance de este bundle (ver docstring del módulo); el caller que sí
    # tenga esos datos disponibles puede enriquecer `insights` con
    # `compute_team_insights` directamente si lo necesita.
    insights = compute_team_insights(members=members, total_carga_real_hours=total_carga_real_hours)
    indicator_explanations = {
        "cumplimiento": explain_cumplimiento_indicator(avg_cumplimiento, len(members)),
        "carga": explain_carga_indicator(avg_carga_pct),
        "consultas": explain_consultas_indicator(total_consultas, total_consultas_prev),
    }
    alerts = compute_team_alerts(members)
    ranking = compute_monthly_ranking(members)
    data_quality = compute_data_quality(user_ids=user_ids)
    period_status = resolve_monthly_period_status(month, year, now)

    return {
        "team_summary": {
            "avg_cumplimiento": avg_cumplimiento,
            "avg_carga_pct": avg_carga_pct,
            "total_carga_real_hours": total_carga_real_hours,
            "total_carga_base_hours": total_carga_base_hours,
            "total_completed_tasks": total_completed_tasks,
            "total_consultas": total_consultas,
            "total_tasks": total_tasks,
            "hours_per_day": base["hours_per_day"],
            "carga_range_min": round_half_up(base["base_hours"] * 100) / 100,
            "carga_range_max": carga_range_per_person["max"],
        },
        "members": members,
        "ranking": ranking,
        "distribuciones": {"consultas_by_reason": consultas_by_reason, "risk_quadrant": risk_quadrant},
        "trends": trends,
        "findings": findings,
        "insights": insights,
        "indicator_explanations": indicator_explanations,
        "recommendations": recommendations,
        "alerts": alerts,
        "data_quality": data_quality,
        "period_status": period_status,
    }


# ── Fase 69 — RANGO PERSONALIZADO / RANGO DE MESES ───────────────────────────


def compute_range_ranking(members: list[dict]) -> list[dict]:
    """Réplica del `ranking` del builder RANGO_MESES — orden por
    `completed_pct` desc, `score` desc como desempate (prioridad
    INVERTIDA respecto a `compute_monthly_ranking`, que usa `score`
    primero — verificado línea por línea contra el TS, no es un
    descuido)."""
    ranked = sorted(members, key=lambda m: (-m["completed_pct"], -m["score"]))
    return [{"id": m["id"], "name": m["name"], "role": m["role"], "score": m["score"], "completed_pct": m["completed_pct"]} for m in ranked]


def compute_range_alerts(month_snapshots: list[dict], users: list[User]) -> list[dict]:
    """Réplica del bloque `alerts` de `buildRangeSnapshotData` — a
    diferencia de `compute_team_alerts` (umbral fijo por período), acá
    un colaborador entra en alerta si el problema (bajo cumplimiento o
    sobrecarga) se repite en al menos la mitad de sus meses ACTIVOS del
    rango (`total_tasks > 0`); `value` es el promedio del indicador
    solo en los meses afectados, y `months_affected` cuenta cuántos
    meses activaron la alerta."""
    alerts: list[dict] = []
    for user in users:
        active_snaps = [ms for ms in month_snapshots if ms["member_snapshots"][user.id]["total_tasks"] > 0]
        if not active_snaps:
            continue
        threshold = -(-len(active_snaps) // 2)  # ceil(len / 2), sin importar redondeo de floats
        identity = _user_identity(user)

        low_cumpl = [ms for ms in active_snaps if ms["member_snapshots"][user.id]["completed_pct"] < 60]
        if len(low_cumpl) >= threshold:
            avg_value = round_half_up(sum(ms["member_snapshots"][user.id]["completed_pct"] for ms in low_cumpl) / len(low_cumpl))
            alerts.append({"user_id": identity["id"], "name": identity["name"], "type": "cumplimiento", "value": avg_value, "months_affected": len(low_cumpl)})

        overloaded = [ms for ms in active_snaps if ms["member_snapshots"][user.id]["carga_label"] == "Sobrecarga"]
        if len(overloaded) >= threshold:
            avg_value = round_half_up(sum(ms["member_snapshots"][user.id]["carga_pct"] for ms in overloaded) / len(overloaded))
            alerts.append({"user_id": identity["id"], "name": identity["name"], "type": "sobrecarga", "value": avg_value, "months_affected": len(overloaded)})
    return alerts


def assemble_custom_range_team_report(
    *,
    user_ids: list[int],
    period_start: datetime,
    period_end: datetime,
    explicit_fecha_corte: datetime | None = None,
    now: datetime | None = None,
) -> dict:
    """Ensamblador — réplica del bundle de `buildCustomRangeSnapshotData`
    que SÍ puede calcularse solo con `member_kpis`/`insights` (ver
    docstring del módulo para lo que queda fuera). Estructuralmente
    casi idéntico a `assemble_monthly_team_report` (mismo `ranking`/
    `alerts`), la diferencia real es la fecha de corte (sin
    `MonthClosure`, mecanismo exclusivo de meses calendario) y la
    tendencia de consultas, que compara contra un período anterior de
    igual DURACIÓN (`previous_equivalent_period`), no el mes calendario
    anterior. `period_start`/`period_end` son instantes UTC ya
    resueltos por el caller (réplica de `parseDayUTC` — inicio/fin de
    día del rango elegido), mismo contrato que
    `compute_custom_range_member_kpis`."""
    now = now or datetime.now(dt_timezone.utc)
    users = list(User.objects.filter(id__in=user_ids))

    kpis_by_id = compute_custom_range_member_kpis(user_ids=user_ids, period_start=period_start, period_end=period_end, explicit_fecha_corte=explicit_fecha_corte, now=now)
    members = [{**_user_identity(user), **kpis_by_id[user.id]} for user in users if user.id in kpis_by_id]

    total_consultas = sum(m["seguimiento_total"] for m in members)
    total_tasks = sum(m["total_tasks"] for m in members)
    total_completed_tasks = sum(m["completed_tasks"] for m in members)
    total_overdue = sum(m["overdue_count"] for m in members)
    total_carga_real_hours = round_half_up(sum(m["carga_real_hours"] for m in members) * 100) / 100
    total_carga_base_hours = round_half_up(sum(m["carga_base_hours"] for m in members) * 100) / 100

    base = business_base_for_range(period_start.date(), period_end.date())
    effective_bases = compute_effective_member_bases(
        users, period_start.date(), period_end.date(), base["hours_per_day"], base["limit_low_per_day"], base["limit_high_per_day"], base["limit_overload_per_day"], now=now
    )
    total_limit_base_hours = sum(effective_bases[u.id]["limit_base_hours"] for u in users)
    total_limit_low_hours = sum(effective_bases[u.id]["limit_low_hours"] for u in users)
    total_limit_high_hours = sum(effective_bases[u.id]["limit_high_hours"] for u in users)
    total_limit_overload_hours = sum(effective_bases[u.id]["limit_overload_hours"] for u in users)
    team_carga_range = compute_workload_range(total_carga_real_hours, total_limit_base_hours, total_limit_low_hours, total_limit_high_hours, total_limit_overload_hours)
    avg_carga_pct = compute_workload_pct(total_carga_real_hours, total_limit_base_hours, team_carga_range["max"])
    avg_cumplimiento = round_half_up(sum(m["completed_pct"] for m in members) / len(members)) if members else 0
    carga_range_per_person = compute_workload_range(0, base["base_hours"], base["limit_low_hours"], base["limit_high_hours"], base["limit_overload_hours"])

    cutoff = min(explicit_fecha_corte, now) if explicit_fecha_corte else min(period_end, now)
    data_upper_bound = min(period_end, cutoff)
    prev_period = previous_equivalent_period(period_start, period_end)
    consultas_by_reason = compute_consultas_by_reason(user_ids, period_start, data_upper_bound, prev_period["start"], prev_period["end"])
    total_consultas_prev = TaskActivity.objects.filter(
        author_id__in=user_ids, created_at__gte=prev_period["start"], created_at__lte=prev_period["end"], task__type=Task.Type.SEGUIMIENTO
    ).count()

    reason_label_map = get_activity_reason_label_map()
    top_reason = (
        {"label": reason_label_map.get(consultas_by_reason[0]["reason"], consultas_by_reason[0]["reason"]), "pct": consultas_by_reason[0]["pct"]}
        if consultas_by_reason
        else None
    )

    risk_quadrant = compute_risk_quadrant(members)
    findings = compute_findings(avg_cumplimiento=avg_cumplimiento, avg_cumplimiento_delta=None, members=members, total_overdue=total_overdue, top_reason=top_reason)
    recommendations = compute_recommendations(avg_cumplimiento=avg_cumplimiento, members=members, top_reason=top_reason)
    insights = compute_team_insights(members=members, total_carga_real_hours=total_carga_real_hours)
    indicator_explanations = {
        "cumplimiento": explain_cumplimiento_indicator(avg_cumplimiento, len(members)),
        "carga": explain_carga_indicator(avg_carga_pct),
        "consultas": explain_consultas_indicator(total_consultas, total_consultas_prev),
    }
    # Mismo `ranking`/`alerts` que el builder MENSUAL — verificado línea
    # por línea contra el TS (`buildCustomRangeSnapshotData`), no una
    # reutilización aproximada.
    ranking = compute_monthly_ranking(members)
    alerts = compute_team_alerts(members)
    data_quality = compute_data_quality(user_ids=user_ids)
    period_status = resolve_custom_range_period_status(period_end, now)

    return {
        "team_summary": {
            "avg_cumplimiento": avg_cumplimiento,
            "avg_carga_pct": avg_carga_pct,
            "total_carga_real_hours": total_carga_real_hours,
            "total_carga_base_hours": total_carga_base_hours,
            "total_completed_tasks": total_completed_tasks,
            "total_consultas": total_consultas,
            "total_tasks": total_tasks,
            "hours_per_day": base["hours_per_day"],
            "carga_range_min": round_half_up(base["base_hours"] * 100) / 100,
            "carga_range_max": carga_range_per_person["max"],
        },
        "members": members,
        "ranking": ranking,
        "distribuciones": {"consultas_by_reason": consultas_by_reason, "risk_quadrant": risk_quadrant},
        "findings": findings,
        "insights": insights,
        "indicator_explanations": indicator_explanations,
        "recommendations": recommendations,
        "alerts": alerts,
        "data_quality": data_quality,
        "period_status": period_status,
    }


def assemble_range_team_report(
    *,
    user_ids: list[int],
    from_year: int,
    from_month: int,
    to_year: int,
    to_month: int,
    explicit_fecha_corte: datetime | None = None,
    now: datetime | None = None,
) -> dict:
    """Ensamblador — réplica del bundle de `buildRangeSnapshotData` que
    SÍ puede calcularse solo con `member_kpis`/`insights` (ver
    docstring del módulo para lo que queda fuera). El builder más
    distinto de los 3: `ranking`/`alerts` tienen su propia lógica
    (`compute_range_ranking`/`compute_range_alerts`, ver arriba), y
    agrega `monthly_evolution`/`range_trend`/`problematic_months` —
    ausentes en los otros 2 builders."""
    now = now or datetime.now(dt_timezone.utc)
    users = list(User.objects.filter(id__in=user_ids))

    kpis = compute_range_member_kpis(
        user_ids=user_ids, from_year=from_year, from_month=from_month, to_year=to_year, to_month=to_month, explicit_fecha_corte=explicit_fecha_corte, now=now
    )
    month_snapshots = kpis["month_snapshots"]
    aggregated_by_id = kpis["aggregated_members"]
    members = [{**_user_identity(user), **aggregated_by_id[user.id]} for user in users if user.id in aggregated_by_id]

    total_carga_real_hours = round_half_up(sum(m["carga_real_hours"] for m in members) * 100) / 100
    total_carga_base_hours = round_half_up(sum(m["carga_base_hours"] for m in members) * 100) / 100
    total_tasks = sum(m["total_tasks"] for m in members)
    total_completed_tasks = sum(m["completed_tasks"] for m in members)
    total_consultas = sum(m["seguimiento_total"] for m in members)

    active_months = [ms for ms in month_snapshots if ms["total_tasks"] > 0]
    avg_cumplimiento = round_half_up(sum(ms["team_avg_cumplimiento"] for ms in active_months) / len(active_months)) if active_months else 0

    # `_local_month_bounds` (no `_month_bounds`) — mismo hallazgo de la
    # Fase 71 (ver docs/AUDIT_LOG.md § 2026-08-26) que `compute_range_member_kpis`:
    # este ensamblador recalcula `effective_bases` de forma independiente
    # para los totales de equipo, así que necesita el mismo criterio de
    # hora LOCAL del negocio para no divergir de él.
    range_start, _ = _local_month_bounds(from_year, from_month)
    _, range_end = _local_month_bounds(to_year, to_month)
    range_start_rate = monthly_business_base(from_year, from_month)
    effective_bases = compute_effective_member_bases(
        users, range_start.date(), range_end.date(),
        range_start_rate["hours_per_day"], range_start_rate["limit_low_per_day"], range_start_rate["limit_high_per_day"], range_start_rate["limit_overload_per_day"],
        now=now, period_start_instant=range_start, period_end_instant=range_end,
    )
    total_limit_base_hours = sum(effective_bases[u.id]["limit_base_hours"] for u in users)
    total_limit_low_hours = sum(effective_bases[u.id]["limit_low_hours"] for u in users)
    total_limit_high_hours = sum(effective_bases[u.id]["limit_high_hours"] for u in users)
    total_limit_overload_hours = sum(effective_bases[u.id]["limit_overload_hours"] for u in users)
    team_carga_range = compute_workload_range(total_carga_real_hours, total_limit_base_hours, total_limit_low_hours, total_limit_high_hours, total_limit_overload_hours)
    avg_carga_pct = compute_workload_pct(total_carga_real_hours, total_limit_base_hours, team_carga_range["max"])

    last_month_biz = monthly_business_base_for_users(users, to_year, to_month)["shared"]
    carga_range_last_month = compute_workload_range(0, last_month_biz["limit_base_hours"], last_month_biz["limit_low_hours"], last_month_biz["limit_high_hours"], last_month_biz["limit_overload_hours"])

    cutoff = resolve_closure_cutoff(to_year, to_month, explicit_fecha_corte, range_end, now)
    data_upper_bound = min(range_end, cutoff)
    prev_period = previous_equivalent_period(range_start, range_end)
    consultas_by_reason = compute_consultas_by_reason(user_ids, range_start, data_upper_bound, prev_period["start"], prev_period["end"])
    total_consultas_prev = TaskActivity.objects.filter(
        author_id__in=user_ids, created_at__gte=prev_period["start"], created_at__lte=prev_period["end"], task__type=Task.Type.SEGUIMIENTO
    ).count()

    reason_label_map = get_activity_reason_label_map()
    top_reason = (
        {"label": reason_label_map.get(consultas_by_reason[0]["reason"], consultas_by_reason[0]["reason"]), "pct": consultas_by_reason[0]["pct"]}
        if consultas_by_reason
        else None
    )

    risk_quadrant = compute_risk_quadrant(members)
    ranking = compute_range_ranking(members)
    alerts = compute_range_alerts(month_snapshots, users)

    problematic_months = [
        {"month": ms["month"], "label": ms["label"], "team_avg_cumplimiento": ms["team_avg_cumplimiento"]}
        for ms in month_snapshots
        if ms["total_tasks"] > 0 and ms["team_avg_cumplimiento"] < 60
    ]
    first_active = next((ms for ms in month_snapshots if ms["total_tasks"] > 0), None)
    last_active = next((ms for ms in reversed(month_snapshots) if ms["total_tasks"] > 0), None)
    first_month_avg_cumplimiento = first_active["team_avg_cumplimiento"] if first_active else 0
    last_month_avg_cumplimiento = last_active["team_avg_cumplimiento"] if last_active else 0
    cumplimiento_change = last_month_avg_cumplimiento - first_month_avg_cumplimiento
    cumplimiento_trend = "mejora" if cumplimiento_change > 5 else "deterioro" if cumplimiento_change < -5 else "estancamiento"

    # `total_overdue` fijo en 0 — réplica de la misma limitación
    # preexistente ya documentada en `compute_range_member_kpis`
    # (Fase 66): la agregación de rango no rastrea vencidas por
    # colaborador, no algo introducido en este ensamblador.
    findings = compute_findings(avg_cumplimiento=avg_cumplimiento, avg_cumplimiento_delta=cumplimiento_change, members=members, total_overdue=0, top_reason=top_reason)
    recommendations = compute_recommendations(avg_cumplimiento=avg_cumplimiento, members=members, top_reason=top_reason)
    insights = compute_team_insights(members=members, total_carga_real_hours=total_carga_real_hours)
    indicator_explanations = {
        "cumplimiento": explain_cumplimiento_indicator(avg_cumplimiento, len(members)),
        "carga": explain_carga_indicator(avg_carga_pct),
        "consultas": explain_consultas_indicator(total_consultas, total_consultas_prev),
    }
    data_quality = compute_data_quality(user_ids=user_ids)
    period_status = resolve_monthly_period_status(to_month, to_year, now)

    return {
        "team_summary": {
            "avg_cumplimiento": avg_cumplimiento,
            "avg_carga_pct": avg_carga_pct,
            "total_completed_tasks": total_completed_tasks,
            "total_tasks": total_tasks,
            "total_carga_real_hours": total_carga_real_hours,
            "total_carga_base_hours": total_carga_base_hours,
            "total_consultas": total_consultas,
            "hours_per_day": last_month_biz["hours_per_day"],
            "carga_range_min": round_half_up(last_month_biz["limit_base_hours"] * 100) / 100,
            "carga_range_max": carga_range_last_month["max"],
        },
        "members": members,
        "ranking": ranking,
        "distribuciones": {"consultas_by_reason": consultas_by_reason, "risk_quadrant": risk_quadrant},
        "monthly_evolution": month_snapshots,
        "range_trend": {
            "cumplimiento_trend": cumplimiento_trend,
            "cumplimiento_change": cumplimiento_change,
            "first_month_avg_cumplimiento": first_month_avg_cumplimiento,
            "last_month_avg_cumplimiento": last_month_avg_cumplimiento,
        },
        "problematic_months": problematic_months,
        "findings": findings,
        "insights": insights,
        "indicator_explanations": indicator_explanations,
        "recommendations": recommendations,
        "alerts": alerts,
        "data_quality": data_quality,
        "period_status": period_status,
    }
