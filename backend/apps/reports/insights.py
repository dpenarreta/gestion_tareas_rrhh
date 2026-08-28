"""Port de `src/lib/reportInsights.ts` — Fase 67 de la migración de
stack (ver docs/AUDIT_LOG.md § 2026-08-26). Motor de interpretación de
Reportes Ejecutivos: capa de composición sobre datos YA calculados por
`apps.reports.member_kpis`/`apps.analytics.*` — NUNCA recalcula un KPI
ni usa IA (Groq). Mismo principio que el TS original: cada función acá
es una regla fija sobre números que otro módulo ya produjo.

Deliberadamente SIN wiring a ningún endpoint HTTP todavía — mismo
criterio que `member_kpis.py` (Fases 64-66).

`deriveEstadoOperativo`/`computeEffectiveMemberBases`/
`computePrincipalHallazgo` de `reportInsights.ts` YA están portadas
en `apps.reports.member_kpis` (Fases 64/65) — no se duplican acá.

Hallazgo (no accionable) durante esta fase: `computeEffectiveMemberBases`
(TS, `reportInsights.ts`) llama a `computeEffectiveHistoryStart(id,
periodEnd)` — usa `periodEnd` como valor de reserva si el colaborador
no tiene NINGÚN historial (ni tareas, ni actividades, ni
`kpiStartDate`, ni `createdAt`). El port ya existente
(`compute_effective_member_bases` en `member_kpis.py`, Fase 64) usa
`now` en ese mismo lugar en vez de `period_end` — una divergencia
menor frente al TS. En la práctica es inalcanzable: `User.created_at`
(`auto_now_add`) SIEMPRE está presente en Django, así que la rama "sin
historial" nunca se ejecuta para un usuario real. No se corrige acá
para no reabrir 3 sub-fases ya verificadas (64/65/66) sin una razón
con impacto real — documentado, no una tarea pendiente."""

from datetime import datetime, timedelta
from datetime import timezone as dt_timezone

from apps.analytics.scoring import compute_completed_pct_any
from apps.analytics.workload import (
    compute_workload_pct,
    compute_workload_range,
    monthly_business_base_for_users,
)
from apps.core.rounding import round_half_up
from apps.tasks.business_time import business_day_real_range
from apps.tasks.models import ActivityReason, MonthClosure, Task, TaskActivity
from apps.users.models import User

# ── Bloque 5 — Interpretación por indicador ──────────────────────────────────


def explain_cumplimiento_indicator(pct: float, member_count: int) -> dict:
    """Réplica exacta de `explainCumplimientoIndicator`."""
    return {
        "meaning": "Porcentaje de tareas del equipo cerradas como Completada sobre el total del período.",
        "why": (
            f"El {pct}% de las tareas de los {member_count} colaboradores incluidos se completaron en el período."
            if pct >= 80
            else f"Solo el {pct}% de las tareas del equipo se completaron — por debajo del objetivo mínimo del 60%."
        ),
        "impact": (
            "El equipo mantiene su capacidad de respuesta y compromisos al día."
            if pct >= 80
            else "Los pendientes acumulados pueden derivar en retrasos operativos si la tendencia continúa."
        ),
        "action": (
            "Mantener el ritmo actual de cierre de tareas."
            if pct >= 80
            else "Priorizar el cierre de tareas próximas a vencer y revisar la carga de quienes están por debajo del objetivo."
        ),
    }


def explain_carga_indicator(pct: float) -> dict:
    """Réplica exacta de `explainCargaIndicator`."""
    return {
        "meaning": "Porcentaje de horas reales registradas por el equipo frente a su base laboral esperada del período.",
        "why": (
            f"El equipo registró {pct}% de su base laboral — por encima del rango óptimo."
            if pct > 100
            else f"El equipo registró {pct}% de su base laboral, dentro o por debajo del rango esperado."
        ),
        "impact": (
            "Una carga sostenida por encima del rango óptimo eleva el riesgo de sobrecarga y desgaste."
            if pct > 100
            else "La carga del equipo no representa un riesgo operativo inmediato."
        ),
        "action": (
            "Redistribuir tareas hacia colaboradores con capacidad disponible."
            if pct > 100
            else "Sin acción requerida — monitorear en el próximo período."
        ),
    }


def explain_consultas_indicator(total: int, prev_total: int | None) -> dict:
    """Réplica exacta de `explainConsultasIndicator`."""
    delta_pct = round_half_up(((total - prev_total) / prev_total) * 100) if prev_total and prev_total > 0 else None
    if delta_pct is None:
        why = f"El equipo atendió {total} consultas en el período."
    else:
        variacion = f"un {delta_pct}% más" if delta_pct >= 0 else f"un {abs(delta_pct)}% menos"
        why = f"El equipo atendió {total} consultas, {variacion} que en el período anterior."
    return {
        "meaning": "Total de consultas (actividades tipo Seguimiento) atendidas por el equipo en el período.",
        "why": why,
        "impact": (
            "Un aumento sostenido de consultas puede requerir más capacidad operativa dedicada a atención."
            if delta_pct is not None and delta_pct >= 30
            else "El volumen de consultas se mantiene dentro de lo gestionable por el equipo."
        ),
        "action": (
            "Evaluar si el aumento requiere reforzar el equipo o ajustar procesos."
            if delta_pct is not None and delta_pct >= 30
            else "Sin acción requerida — monitorear en el próximo período."
        ),
    }


# ── Bloque 8 — Mapa de Riesgo (Cumplimiento vs Carga) ────────────────────────

RISK_QUADRANT_LABEL: dict[str, str] = {
    "criticos": "Crítico — bajo cumplimiento y sobrecarga",
    "atencion-carga": "Atención — sobrecarga con cumplimiento aceptable",
    "atencion-cumplimiento": "Atención — bajo cumplimiento sin sobrecarga",
    "saludables": "Saludable — cumplimiento y carga dentro de rango",
}


def compute_risk_quadrant(members: list[dict]) -> list[dict]:
    """Réplica exacta de `computeRiskQuadrant`. `members` — dicts con al
    menos `completed_pct`/`carga_pct`; devuelve los mismos dicts con
    `quadrant` agregado. Umbrales: cumplimiento <60% = bajo; carga
    >100% del rango óptimo = sobrecarga relativa (mismo umbral que las
    alertas del reporte)."""
    result = []
    for m in members:
        low_cumplimiento = m["completed_pct"] < 60
        high_carga = m["carga_pct"] > 100
        if low_cumplimiento and high_carga:
            quadrant = "criticos"
        elif high_carga:
            quadrant = "atencion-carga"
        elif low_cumplimiento:
            quadrant = "atencion-cumplimiento"
        else:
            quadrant = "saludables"
        result.append({**m, "quadrant": quadrant})
    return result


# ── Bloque 6 — Distribución por Motivo ───────────────────────────────────────

# Pistas de negocio por motivo conocido (catálogo por defecto del seed) —
# motivos personalizados creados en Ajustes usan el texto genérico.
_REASON_HINT: dict[str, str] = {
    "NOVEDADES_PAGO": "puede indicar un incremento en ajustes de nómina o mayor demanda operativa",
    "RETENCION_PAGO": "puede reflejar casos de retención salarial que requieren seguimiento legal/administrativo",
    "FACTURAS": "puede indicar mayor volumen de gestión documental con proveedores o colaboradores",
    "CONSULTA_OPERACIONES": "sugiere una mayor necesidad de soporte operativo del equipo",
    "SOLICITUD_VACACIONES": "es esperable en períodos de alta demanda de vacaciones",
    "SOLICITUD_PERMISO": "puede indicar mayor ausentismo planificado en el período",
    "VISITA_DOMICILIARIA": "refleja actividad de campo — puede impactar la disponibilidad de quienes las realizan",
    "SEGUIMIENTO_AUSENTISMOS": "sugiere mayor necesidad de gestión de ausentismos en el período",
    "RECLUTAMIENTO_SELECCION": "puede indicar apertura de nuevas vacantes o procesos de selección activos",
    "SEGUIMIENTO_DOCUMENTACION": "puede indicar pendientes documentales acumulados que requieren cierre",
    "SOLICITUDES_INTERNAS": "sugiere mayor demanda de gestión interna del equipo",
}


def explain_motivo_distribution(reason_key: str, label: str, pct_of_total: float, trend_pct: float | None) -> str:
    """Réplica exacta de `explainMotivoDistribution`."""
    hint = _REASON_HINT.get(reason_key)
    text = f"{label} representa el {pct_of_total}% de las consultas del período"
    text += ", convirtiéndose en el principal motivo de gestión del equipo." if pct_of_total >= 30 else "."
    if hint:
        text += f" Esto {hint}."
    if trend_pct is not None:
        if trend_pct >= 20:
            text += f" Aumentó {trend_pct}% respecto al período anterior."
        elif trend_pct <= -20:
            text += f" Disminuyó {abs(trend_pct)}% respecto al período anterior."
    return text


def get_activity_reason_label_map() -> dict[str, str]:
    """Réplica exacta de `getActivityReasonLabelMap` — `key` -> `label`
    para TODOS los motivos (activos e inactivos)."""
    return dict(ActivityReason.objects.values_list("key", "label"))


# ── Bloque 2/3 — Hallazgos Automáticos y Recomendaciones ─────────────────────
# Reglas fijas sobre datos ya calculados por el reporte — ninguna generada
# por IA (el "Análisis IA" de Nova es un módulo aparte, independiente de
# este, nunca portado — ver docs/DECISIONS.md § Sprint Reportes
# Ejecutivos 2.0).


def compute_findings(
    *,
    avg_cumplimiento: float,
    avg_cumplimiento_delta: float | None,
    members: list[dict],
    total_overdue: int,
    top_reason: dict | None,
) -> list[dict]:
    """Réplica exacta de `computeFindings`. `members` — dicts con
    `name`/`carga_label`/`completed_pct`/`overdue_count`. `top_reason`
    — `{"label": str, "pct": float}` o `None`."""
    findings: list[dict] = []

    if avg_cumplimiento_delta is not None:
        d = avg_cumplimiento_delta
        if d >= 3:
            findings.append({"text": f"El cumplimiento del equipo aumentó {d} puntos porcentuales respecto al mes anterior.", "tone": "positive"})
        elif d <= -3:
            findings.append({"text": f"El cumplimiento del equipo disminuyó {abs(d)} puntos porcentuales respecto al mes anterior.", "tone": "risk"})

    subutilizados = [m for m in members if m["carga_label"] == "Subutilización"]
    sobrecargados = [m for m in members if m["carga_label"] == "Sobrecarga"]
    if subutilizados:
        findings.append({"text": f"Existen {len(subutilizados)} colaborador(es) subutilizados: {', '.join(m['name'] for m in subutilizados)}.", "tone": "neutral"})
    if sobrecargados:
        findings.append({"text": f"Existen {len(sobrecargados)} colaborador(es) en sobrecarga: {', '.join(m['name'] for m in sobrecargados)}.", "tone": "risk"})
    else:
        findings.append({"text": "La carga general del equipo es adecuada — nadie está en sobrecarga este período.", "tone": "positive"})

    if total_overdue == 0:
        findings.append({"text": "No existen tareas vencidas en el equipo este período.", "tone": "positive"})
    else:
        findings.append({"text": f"Existen {total_overdue} tarea(s) vencida(s) en el equipo.", "tone": "risk"})

    if top_reason and top_reason["pct"] >= 30:
        findings.append({"text": f"\"{top_reason['label']}\" concentra el {top_reason['pct']}% de las consultas del período.", "tone": "neutral"})

    return findings


def compute_recommendations(*, avg_cumplimiento: float, members: list[dict], top_reason: dict | None) -> list[dict]:
    """Réplica exacta de `computeRecommendations`. `id` es estable por
    regla (no aleatorio) — Executive Reporting Engine 2.0 lo usa para
    que NOVA enriquezca 1:1 esta lista sin poder inventar
    recomendaciones nuevas."""
    recs: list[dict] = []
    subutilizados = [m for m in members if m["carga_label"] == "Subutilización"]
    sobrecargados = [m for m in members if m["carga_label"] == "Sobrecarga"]
    bajo_cumplimiento = [m for m in members if m["completed_pct"] < 60]

    if sobrecargados and subutilizados:
        recs.append({
            "id": "redistribuir-carga-mixta",
            "text": f"Redistribuir carga: {', '.join(m['name'] for m in sobrecargados)} está(n) en sobrecarga mientras {', '.join(m['name'] for m in subutilizados)} tiene(n) capacidad disponible.",
            "priority": "alta",
        })
    elif sobrecargados:
        recs.append({
            "id": "redistribuir-carga-sobrecarga",
            "text": f"Redistribuir carga de {', '.join(m['name'] for m in sobrecargados)} hacia colaboradores con capacidad disponible.",
            "priority": "alta",
        })

    if bajo_cumplimiento:
        recs.append({
            "id": "revisar-bajo-cumplimiento",
            "text": f"Revisar proyectos/tareas de {', '.join(m['name'] for m in bajo_cumplimiento)} — cumplimiento por debajo del 60%.",
            "priority": "alta",
        })

    if top_reason and top_reason["pct"] >= 30:
        recs.append({
            "id": "reforzar-motivo-concentrado",
            "text": f"Evaluar capacitar o reforzar el proceso de \"{top_reason['label']}\" — concentra {top_reason['pct']}% de las consultas del equipo.",
            "priority": "media",
        })

    if not sobrecargados and not bajo_cumplimiento and avg_cumplimiento >= 80:
        recs.append({
            "id": "mantener-planificacion",
            "text": "Mantener la planificación actual — los indicadores del equipo están dentro de rangos saludables.",
            "priority": "media",
        })

    return recs


# ── Bloque 10 — Insights ──────────────────────────────────────────────────────


def compute_team_insights(
    *,
    members: list[dict],
    total_carga_real_hours: float,
    health_by_member: list[dict] | None = None,
    variable_consistency_members: list[str] | None = None,
) -> list[str]:
    """Réplica exacta de `computeTeamInsights`. `members` — dicts con
    `name`/`carga_real_hours`. `health_by_member` — dicts con
    `name`/`score`, opcional."""
    insights: list[str] = []

    if total_carga_real_hours > 0 and members:
        top = max(members, key=lambda m: m["carga_real_hours"])
        pct = round_half_up((top["carga_real_hours"] / total_carga_real_hours) * 100)
        if pct >= 20:
            insights.append(f"{top['name']} concentró el {pct}% del tiempo ejecutado por el equipo este período.")

    if health_by_member:
        best = max(health_by_member, key=lambda m: m["score"])
        insights.append(f"{best['name']} mantiene el mayor Equilibrio Operativo del equipo ({best['score']}/100).")

    for name in (variable_consistency_members or [])[:2]:
        insights.append(f"{name} presenta variaciones importantes entre semanas.")

    return insights


# ── Sprint Analytics 2.1 — Período anterior equivalente ──────────────────────


def previous_equivalent_period(period_start: datetime, period_end: datetime) -> dict:
    """Réplica exacta de `previousEquivalentPeriod` — período anterior
    de igual duración, terminando el día previo al inicio del período
    dado. Sirve para el % de tendencia de motivos de consulta en
    CUALQUIER largo de período, no solo meses calendario."""
    duration = period_end - period_start
    end = period_start - timedelta(microseconds=1)
    start = end - duration
    return {"start": start, "end": end}


# ── FPS Parte IV §6 — Estado del período evaluado ────────────────────────────
# Se apoya en MonthClosure (ya existente) — no crea un concepto de cierre
# paralelo.


def resolve_monthly_period_status(month: int, year: int, now: datetime | None = None) -> str:
    """Réplica exacta de `resolveMonthlyPeriodStatus` — reporte de un
    solo mes calendario (MENSUAL)."""
    now = now or datetime.now(dt_timezone.utc)
    if month == now.month and year == now.year:
        return "EN_CURSO"
    closure = MonthClosure.objects.filter(month=month, year=year).first()
    return "CERRADO" if closure else "HISTORICO"


def resolve_range_period_status(last_month: int, last_year: int, now: datetime | None = None) -> str:
    """Réplica exacta de `resolveRangePeriodStatus` — rango de meses
    calendario completos (RANGO_MESES), evaluado sobre el ÚLTIMO mes
    del rango."""
    return resolve_monthly_period_status(last_month, last_year, now)


def resolve_custom_range_period_status(period_end: datetime, now: datetime | None = None) -> str:
    """Réplica exacta de `resolveCustomRangePeriodStatus` — rango de
    fechas arbitrario (RANGO_PERSONALIZADO); CERRADO nunca aplica acá
    (no hay `MonthClosure` que consultar)."""
    now = now or datetime.now(dt_timezone.utc)
    return "HISTORICO" if period_end < now else "EN_CURSO"


# ── Bloque 9 — Tendencias (mes anterior / trimestre / semestre) ─────────────
# Snapshots mensuales livianos (cumplimiento/carga/consultas) para las 3
# tarjetas comparativas del Resumen Ejecutivo — solo se usa desde el
# informe de UN mes; el informe de rango ya expone su propia evolución
# mes a mes (`compute_range_member_kpis`, Fase 66), que arma un desglose
# COMPLETO por colaborador (score incluido) — esta función es más liviana
# a propósito (sin desglose por miembro ni score), no un duplicado.

_MONTH_NAMES_SHORT = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"]


def _month_bounds_util(year: int, month: int) -> tuple[datetime, datetime]:
    next_year, next_month = (year + 1, 1) if month == 12 else (year, month + 1)
    start = datetime(year, month, 1, tzinfo=dt_timezone.utc)
    end = datetime(next_year, next_month, 1, tzinfo=dt_timezone.utc) - timedelta(microseconds=1)
    return start, end


def _month_label_short(year: int, month: int) -> str:
    return f"{_MONTH_NAMES_SHORT[month - 1]} {year % 100:02d}"


def compute_team_monthly_snapshots(user_ids: list[int], end_year: int, end_month: int, months_back: int) -> list[dict]:
    """Réplica exacta de `computeTeamMonthlySnapshots` — construye hasta
    `months_back + 1` snapshots mensuales (el mes `end_year/end_month`
    incluido, más los `months_back` anteriores), en una sola tanda de
    queries."""
    if not user_ids:
        return []

    months: list[tuple[int, int]] = []
    for i in range(months_back + 1):
        offset = months_back - i
        y, m = end_year, end_month - offset
        while m < 1:
            m += 12
            y -= 1
        months.append((y, m))

    range_start, _ = _month_bounds_util(*months[0])
    _, range_end = _month_bounds_util(*months[-1])

    users = list(User.objects.filter(id__in=user_ids))
    month_business_info = []
    for year, month in months:
        biz = monthly_business_base_for_users(users, year, month)
        shared = biz["shared"]
        real_start, _ = business_day_real_range(shared["start"])
        _, real_end = business_day_real_range(shared["end"])
        month_business_info.append({
            "year": year, "month": month, "shared": shared,
            "real_start": real_start, "real_end": real_end, "per_user": biz["per_user"],
        })

    def biz_for_user(biz_info: dict, user_id: int) -> dict:
        return biz_info["per_user"].get(user_id, biz_info["shared"])

    range_real_start = month_business_info[0]["real_start"]
    range_real_end = month_business_info[-1]["real_end"]

    all_tasks = list(
        Task.objects.filter(assigned_to_id__in=user_ids, end_date__gte=range_start, end_date__lte=range_end).only(
            "assigned_to_id", "status", "end_date"
        )
    )
    all_activities = list(
        TaskActivity.objects.filter(
            author_id__in=user_ids, created_at__gte=range_start, created_at__lte=range_end, task__type=Task.Type.SEGUIMIENTO
        ).only("author_id", "created_at")
    )
    fija_tasks_for_carga = list(
        Task.objects.filter(assigned_to_id__in=user_ids, type=Task.Type.FIJA, completed_at__gte=range_real_start, completed_at__lte=range_real_end).only(
            "assigned_to_id", "real_hours", "completed_at"
        )
    )
    activities_for_carga = list(
        TaskActivity.objects.filter(author_id__in=user_ids, created_at__gte=range_real_start, created_at__lte=range_real_end).only(
            "author_id", "duration", "created_at"
        )
    )

    result: list[dict] = []
    for biz_info in month_business_info:
        year, month = biz_info["year"], biz_info["month"]
        start, end = _month_bounds_util(year, month)
        month_tasks = [t for t in all_tasks if start <= t.end_date <= end]
        month_acts = [a for a in all_activities if start <= a.created_at <= end]
        month_fija = [t for t in fija_tasks_for_carga if biz_info["real_start"] <= t.completed_at <= biz_info["real_end"]]
        month_carga_acts = [a for a in activities_for_carga if biz_info["real_start"] <= a.created_at <= biz_info["real_end"]]

        member_stats = []
        for user_id in user_ids:
            tasks = [t for t in month_tasks if t.assigned_to_id == user_id]
            completed_pct = compute_completed_pct_any(tasks)
            fija_hours = sum(t.real_hours for t in month_fija if t.assigned_to_id == user_id)
            activity_hours = sum(a.duration for a in month_carga_acts if a.author_id == user_id) / 60
            carga_real_hours = round_half_up((fija_hours + activity_hours) * 100) / 100
            user_biz = biz_for_user(biz_info, user_id)
            carga_range = compute_workload_range(carga_real_hours, user_biz["limit_base_hours"], user_biz["limit_low_hours"], user_biz["limit_high_hours"], user_biz["limit_overload_hours"])
            carga_pct = compute_workload_pct(carga_real_hours, user_biz["limit_base_hours"], carga_range["max"])
            member_stats.append({"completed_pct": completed_pct, "carga_pct": carga_pct, "total_tasks": len(tasks)})

        active_members = [m for m in member_stats if m["total_tasks"] > 0]
        avg_cumplimiento = round_half_up(sum(m["completed_pct"] for m in active_members) / len(active_members)) if active_members else 0
        # A diferencia de `avg_cumplimiento` (solo miembros ACTIVOS), `avg_carga_pct`
        # promedia TODOS los miembros del roster — asimetría real del TS original
        # (`memberStats.length`, no `activeMembers.length`), no un error de este port.
        avg_carga_pct = round_half_up(sum(m["carga_pct"] for m in member_stats) / len(member_stats)) if member_stats else 0

        result.append({
            "month": f"{year:04d}-{month:02d}",
            "label": _month_label_short(year, month),
            "avg_cumplimiento": avg_cumplimiento,
            "avg_carga_pct": avg_carga_pct,
            "total_consultas": len(month_acts),
            "total_tasks": len(month_tasks),
        })

    return result


def _classify_delta(delta: float) -> str:
    if delta >= 5:
        return "mejora"
    if delta <= -5:
        return "deterioro"
    return "estable"


def compute_trend_comparisons(points: list[dict]) -> dict:
    """Réplica exacta de `computeTrendComparisons` — a partir de los
    snapshots (más antiguo → más reciente, el último es el mes del
    informe), arma las 3 comparaciones del Bloque 9."""
    current = points[-1] if points else None
    current_value = current["avg_cumplimiento"] if current else 0

    def comparison_from(label: str, window: list[dict]) -> dict:
        with_data = [p for p in window if p["total_tasks"] > 0]
        if not with_data:
            return {"label": label, "current_value": current_value, "compare_value": None, "delta": None, "direction": "sin-datos"}
        compare_value = round_half_up(sum(p["avg_cumplimiento"] for p in with_data) / len(with_data))
        delta = current_value - compare_value
        return {"label": label, "current_value": current_value, "compare_value": compare_value, "delta": delta, "direction": _classify_delta(delta)}

    prior_months = points[:-1]  # todo lo anterior al mes actual, más antiguo primero
    mes_anterior = comparison_from("Mes anterior", prior_months[-1:])
    trimestre = comparison_from("Trimestre (prom. 3 meses)", prior_months[-3:])
    semestre = comparison_from("Semestre (prom. 6 meses)", prior_months[-6:])
    return {"mes_anterior": mes_anterior, "trimestre": trimestre, "semestre": semestre}
