import time

from django.db.models import Count
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from rest_framework import generics
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.configuration.services import get_effective_config_string, set_config_value
from apps.core.rounding import round_half_up
from apps.hierarchy.services import (
    can_view_team,
    get_role_group,
    get_subordinate_executor_groups,
    is_leadership,
    is_visible_to,
)
from apps.projects.models import Project
from apps.projects.permissions import can_view_project
from apps.tasks.business_time import business_day_real_range
from apps.tasks.models import Comment, Task, TaskActivity
from apps.users.models import User

from .audit_history import get_score_series
from .benchmark import compute_personal_evolution, compute_smart_benchmark
from .capacity_forecast import compute_capacity_forecast, compute_team_capacity_forecast
from .explain import (
    cumplimiento_color,
    derived_normalized_value,
    reliability_pct_from_observations,
    reliability_pct_from_stars,
)
from .health_score import (
    ESCALA_INTERPRETACION_EQUILIBRIO,
    classify_estado_operativo,
    compute_health_score,
)
from .history import compute_consistency, compute_monthly_history
from .insights_engine import (
    INSIGHTS_ENGINE_VERSION,
    compute_confidence,
    compute_equilibrio_insights,
    compute_indicator_relations,
    compute_insights,
    compute_personal_benchmark,
    compute_recommendation_reevaluation,
    explain_equilibrio_factor,
    explain_equilibrio_impact,
    explain_equilibrio_meaning,
    get_score_trend_explanation,
    prioritize_insights,
    prioritize_recommendations,
)
from .kpi_simulate import is_valid_scenario, simulate_kpi_scenario
from .models import ANALYTICS_ENGINE_VERSION, FORMULA_SET_VERSION
from .operational_risk import compute_operational_risk
from .permissions import can_view_operational_risk
from .prediction_engine import compute_project_delay_prediction, compute_subutilizacion_predictions
from .preventive_intelligence import compute_preventive_alerts, compute_team_preventive_alerts
from .recommendations import compute_team_recommendations
from .scoring import (
    compute_completed_pct_any,
    compute_data_quality,
    compute_estimated_vs_real_ratio,
    compute_simple_score,
    compute_target_time_precision,
)
from .serializers import (
    AddParticipantsSimulationSerializer,
    AdjustTargetTimeSimulationSerializer,
    RedistributeLoadSimulationSerializer,
)
from .services import (
    build_analytics_bundle_payload,
    build_executive_dashboard_payload,
    build_kpi_payload,
    build_kpi_range_payload,
    build_prediction_bundle_payload,
    get_team_members,
    get_visible_team_project_ids,
    notify_if_high_risk,
)
from .simulate_engine import (
    simulate_add_participants,
    simulate_adjust_target_time,
    simulate_redistribute_load,
)
from .trend_engine import compute_trend_engine
from .utils import is_task_overdue
from .workload import compute_workload_pct, compute_workload_range, monthly_business_base_for_users

# Tope defensivo sobre la CANTIDAD de meses que se llega a generar antes de
# rechazar por "> 24 meses" — el legacy no lo tiene (un rango de miles de
# años igual sería rechazado después, pero iterando primero); esta cota es
# una higiene de entrada nueva de esta superficie HTTP, no un cambio de
# comportamiento para ningún rango realista.
_MAX_MONTHS_TO_GENERATE = 1000


def _month_bounds(year: int, month: int) -> tuple:
    """Duplicado deliberado de `services._month_bounds`/`scoring._month_bounds`
    (mismo criterio ya documentado en `build_analytics_bundle_payload`:
    evita un ciclo de import real entre `views.py` y esos módulos para
    una función de 3 líneas). Fase 19 (ver docs/AUDIT_LOG.md §
    2026-08-20)."""
    from datetime import datetime, timedelta
    from datetime import timezone as dt_timezone

    next_year, next_month = (year + 1, 1) if month == 12 else (year, month + 1)
    start = datetime(year, month, 1, tzinfo=dt_timezone.utc)
    end = datetime(next_year, next_month, 1, tzinfo=dt_timezone.utc) - timedelta(microseconds=1)
    return start, end


def _role_name(user) -> str:
    group = get_role_group(user)
    return group.name if group else ""


def _parse_months_range(from_str: str, to_str: str) -> list[tuple[int, int]]:
    try:
        fy, fm = (int(part) for part in from_str.split("-"))
        ty, tm = (int(part) for part in to_str.split("-"))
    except ValueError:
        return []
    months: list[tuple[int, int]] = []
    cy, cm = fy, fm
    while (cy, cm) <= (ty, tm) and len(months) < _MAX_MONTHS_TO_GENERATE:
        months.append((cy, cm))
        cm += 1
        if cm > 12:
            cm = 1
            cy += 1
    return months


class KpiMeView(generics.GenericAPIView):
    """`GET /api/v1/kpis/me/` — KPIs propios, sin chequeo de jerarquía
    (uno siempre puede ver sus propios datos) ni redacción (réplica de
    `/api/kpis/me`)."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        month_param = request.query_params.get("month")
        payload = build_kpi_payload(actor=request.user, target=request.user, month_param=month_param)
        return Response(payload)


class KpiMeRangeView(generics.GenericAPIView):
    """`GET /api/v1/kpis/me/range/?from=YYYY-MM&to=YYYY-MM` — KPIs
    propios agregados por rango de meses, réplica de
    `/api/kpis/me/range` (Fase 4c, ver docs/AUDIT_LOG.md § 2026-08-11).
    Usa la Definición A de "cumplimiento" (`compute_completed_pct_any`),
    deliberadamente distinta de `/kpis/me`/`/kpis/<id>/` — mismo gap
    legacy aceptado."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        from_str = request.query_params.get("from")
        to_str = request.query_params.get("to")
        if not from_str or not to_str:
            return Response({"detail": "Parámetros from y to requeridos"}, status=400)
        if from_str >= to_str:
            return Response({"detail": "El mes de inicio debe ser anterior al de fin"}, status=400)

        months = _parse_months_range(from_str, to_str)
        if len(months) < 2:
            return Response({"detail": "El rango debe incluir al menos 2 meses"}, status=400)
        if len(months) > 24:
            return Response({"detail": "El rango no puede superar 24 meses"}, status=400)

        payload = build_kpi_range_payload(user=request.user, from_str=from_str, to_str=to_str, months=months)
        return Response(payload)


class KpiUserView(generics.GenericAPIView):
    """`GET /api/v1/kpis/<user_id>/` — KPIs de un tercero, gateado por
    visibilidad jerárquica (réplica de `/api/kpis/[userId]`)."""

    permission_classes = [IsAuthenticated]

    def get(self, request, user_id: int):
        target = get_object_or_404(User, pk=user_id)
        target_group = get_role_group(target)
        if request.user.id != target.id and not request.user.is_superuser:
            if target_group is None or not is_visible_to(request.user, target_group):
                return Response({"detail": "No tiene permiso para ver los KPIs de este usuario."}, status=403)
        month_param = request.query_params.get("month")
        payload = build_kpi_payload(actor=request.user, target=target, month_param=month_param)
        return Response(payload)


class ExecutiveDashboardView(generics.GenericAPIView):
    """`GET /api/v1/kpis/executive/` — dashboard ejecutivo del equipo
    (6 meses de tendencia, ranking, alertas, bloque "CEO"), réplica de
    `/api/kpis/executive` — Fase 21 (ver docs/AUDIT_LOG.md §
    2026-08-20). Gateado por `is_leadership` (`ROLE_LEVEL>=3`, ya
    existente) — DISTINTO del filtro `isExecutorRole`
    (`ROLE_LEVEL>=4`) que sí se aplica a los SUJETOS del dashboard
    (`get_subordinate_executor_groups`, dentro de
    `build_executive_dashboard_payload`)."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        if not is_leadership(request.user):
            return Response({"error": "Sin permisos"}, status=403)
        payload = build_executive_dashboard_payload(actor=request.user)
        return Response(payload)


class TeamCapacityView(generics.GenericAPIView):
    """`GET /api/v1/kpis/team-capacity/` — proyección de capacidad de
    TODOS los subordinados EJECUTORES del actor, réplica de
    `/api/kpis/team-capacity` — Fase 19 (ver docs/AUDIT_LOG.md §
    2026-08-20). A diferencia de `apps.team` (Fase 18, sin filtro de
    rol), excluye roles de liderazgo (`get_subordinate_executor_groups`,
    `ROLE_LEVEL>=4`, Sprint 0A) — sus indicadores individuales de
    ejecución no son representativos."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        if not can_view_team(request.user):
            return Response({"error": "Sin permisos"}, status=403)

        groups = get_subordinate_executor_groups(request.user)
        members = sorted(
            User.objects.filter(groups__in=groups).distinct(), key=lambda m: m.first_name or m.username
        )
        if not members:
            return Response(
                {"members": [], "summary": {"total": 0, "alta": 0, "limitada": 0, "sobrecargados": 0, "sin_planificacion": 0}}
            )

        now = timezone.now()
        forecasts = compute_team_capacity_forecast(user_ids=[m.id for m in members], now=now)
        payload_members = [{"id": m.id, "name": m.first_name or m.username, "role": _role_name(m), **forecasts[m.id]} for m in members]

        summary = {
            "total": len(payload_members),
            "alta": sum(1 for x in payload_members if x["estado"] == "alta"),
            "limitada": sum(1 for x in payload_members if x["estado"] == "limitada"),
            "sobrecargados": sum(1 for x in payload_members if x["estado_color"] == "red"),
            "sin_planificacion": sum(1 for x in payload_members if x["estado"] == "sin-planificacion"),
        }
        return Response({"members": payload_members, "summary": summary})


class TeamKpiView(generics.GenericAPIView):
    """`GET /api/v1/kpis/team/?month=YYYY-MM` — snapshot mensual de
    KPIs (score/cumplimiento/carga/capacidad disponible) de todos los
    subordinados EJECUTORES del actor, réplica de `/api/kpis/team` —
    Fase 19 (ver docs/AUDIT_LOG.md § 2026-08-20). Sin validación de
    `month` malformado — mismo comportamiento (sin guardas) que el
    `route.ts` original."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        if not can_view_team(request.user):
            return Response({"error": "Sin permisos"}, status=403)

        now = timezone.now()
        month_param = request.query_params.get("month")
        if month_param:
            year_str, month_str = month_param.split("-")
            year, month = int(year_str), int(month_str)
        else:
            year, month = now.year, now.month

        groups = get_subordinate_executor_groups(request.user)
        members = sorted(
            User.objects.filter(groups__in=groups).distinct(), key=lambda m: m.first_name or m.username
        )
        if not members:
            return Response({"users": []})
        member_ids = [m.id for m in members]

        start, end = _month_bounds(year, month)
        ref_date = end if end < now else now

        biz = monthly_business_base_for_users(members, year, month)
        shared_biz, per_user_biz = biz["shared"], biz["per_user"]
        real_start, _ = business_day_real_range(shared_biz["start"])
        _, real_end = business_day_real_range(shared_biz["end"])

        tasks = list(
            Task.objects.filter(assigned_to_id__in=member_ids, end_date__gte=start, end_date__lte=end).only(
                "assigned_to_id", "status", "estimated_hours", "real_hours", "end_date", "progress"
            )
        )
        comment_counts = dict(
            Comment.objects.filter(author_id__in=member_ids, created_at__gte=start, created_at__lte=end)
            .values("author_id")
            .annotate(count=Count("id"))
            .values_list("author_id", "count")
        )
        fija_tasks = list(
            Task.objects.filter(
                assigned_to_id__in=member_ids, type=Task.Type.FIJA, archived_month__isnull=True,
                completed_at__gte=real_start, completed_at__lte=real_end,
            ).only("assigned_to_id", "real_hours", "completed_at")
        )
        activities = list(
            TaskActivity.objects.filter(
                author_id__in=member_ids, created_at__gte=real_start, created_at__lte=real_end
            ).only("author_id", "duration", "created_at")
        )

        payload_users = []
        for m in members:
            m_tasks = [t for t in tasks if t.assigned_to_id == m.id]
            overdue_count = sum(1 for t in m_tasks if is_task_overdue(t.end_date, t.status, ref_date))
            completed_pct = compute_completed_pct_any(m_tasks)
            total_est = sum(t.estimated_hours for t in m_tasks)
            total_real = sum(t.real_hours for t in m_tasks)
            carga_ratio = compute_estimated_vs_real_ratio(total_real, total_est)
            in_progress = [t for t in m_tasks if t.status == Task.Status.EN_PROGRESO]
            avg_progress = round_half_up(sum(t.progress for t in in_progress) / len(in_progress)) if in_progress else 0
            score = compute_simple_score(completed_pct, carga_ratio, avg_progress, comment_counts.get(m.id, 0))
            color = cumplimiento_color(completed_pct)

            fija_hours = sum(t.real_hours for t in fija_tasks if t.assigned_to_id == m.id)
            activity_hours = sum(a.duration for a in activities if a.author_id == m.id) / 60
            carga_real_hours = round_half_up(fija_hours + activity_hours, 2)

            user_biz = per_user_biz.get(m.id, shared_biz)
            carga_range = compute_workload_range(
                carga_real_hours, user_biz["limit_base_hours"], user_biz["limit_low_hours"],
                user_biz["limit_high_hours"], user_biz["limit_overload_hours"],
            )
            carga_pct = compute_workload_pct(carga_real_hours, user_biz["limit_base_hours"], carga_range["max"])

            horas_disponibles = max(0, round_half_up(user_biz["limit_high_hours"] - carga_real_hours, 2))
            capacidad_disponible_pct = (
                max(0, round_half_up(horas_disponibles / user_biz["base_hours"] * 100)) if user_biz["base_hours"] > 0 else 0
            )

            payload_users.append(
                {
                    "id": m.id,
                    "name": m.first_name or m.username,
                    "role": _role_name(m),
                    "score": score,
                    "completed_pct": completed_pct,
                    "carga_ratio": carga_ratio,
                    "total_tasks": len(m_tasks),
                    "overdue_count": overdue_count,
                    "color": color,
                    "carga_pct": carga_pct,
                    "carga_color": carga_range["color"],
                    "carga_label": carga_range["label"],
                    "carga_real_hours": carga_real_hours,
                    "carga_base_hours": user_biz["base_hours"],
                    "capacidad_disponible_pct": capacidad_disponible_pct,
                    "horas_disponibles": horas_disponibles,
                }
            )

        return Response({"users": payload_users})


class AnalyticsBundleView(generics.GenericAPIView):
    """`GET /api/v1/analytics/<user_id>/` — bundle completo de Analytics
    (Equilibrio Operativo/Performance Score/alertas/tendencias/
    consistencia/anomalías/predicción/calidad de datos) para UN
    colaborador, réplica de `/api/analytics/[userId]` — Fase 4m (ver
    docs/AUDIT_LOG.md § 2026-08-12). Mismo patrón de auth/visibilidad
    jerárquica que `KpiUserView`."""

    permission_classes = [IsAuthenticated]

    def get(self, request, user_id: int):
        target = get_object_or_404(User, pk=user_id)
        target_group = get_role_group(target)
        if request.user.id != target.id and not request.user.is_superuser:
            if target_group is None or not is_visible_to(request.user, target_group):
                return Response({"detail": "No tiene permiso para ver el Analytics de este usuario."}, status=403)
        payload = build_analytics_bundle_payload(actor=request.user, target=target)
        return Response(payload)


class InsightsView(generics.GenericAPIView):
    """`GET /api/v1/analytics/insights/<user_id>/` — Motor de Insights
    (Decision Intelligence Engine, Sprint 6), réplica de
    `/api/analytics/insights/[userId]` — Fase 16 (ver
    docs/AUDIT_LOG.md § 2026-08-20). Compone ÚNICAMENTE sobre KPIs ya
    calculados por el pipeline central (`run_analytics_pipeline`) y
    Riesgo Operativo — no recalcula ningún KPI de negocio. Mismo patrón
    de auth/visibilidad jerárquica que `KpiUserView`. Gap ya aceptado
    desde `AnalyticsBundleView` (Fase 4m): sin capa de caché con TTL
    (`cached()` en el TS) — se calcula en vivo en cada request."""

    permission_classes = [IsAuthenticated]

    def get(self, request, user_id: int):
        from .pipeline import run_analytics_pipeline

        target = get_object_or_404(User, pk=user_id)
        denied = _check_target_visibility(request, target)
        if denied is not None:
            return denied

        now = timezone.now()
        pipeline = run_analytics_pipeline(user=target, now=now)
        operational_risk = compute_operational_risk(user=target, now=now)
        monthly = compute_monthly_history(user=target, months_back=6, now=now)
        capacity = compute_capacity_forecast(user=target, now=now)

        insights = compute_insights(user=target, now=now, pipeline=pipeline, operational_risk=operational_risk)
        personal_benchmark = compute_personal_benchmark(
            user=target,
            current_score=pipeline["performance_score"]["score"],
            data_quality_pct=pipeline["data_quality"]["pct"],
            now=now,
        )
        reevaluations = compute_recommendation_reevaluation(
            user=target, current_alerts=pipeline["alerts"], current_risk_score=operational_risk["score"], now=now
        )
        performance_trend_explained = get_score_trend_explanation(
            user=target,
            kind="performance_score",
            current_score=pipeline["performance_score"]["score"],
            current_factors=pipeline["performance_score"]["factors"],
            now=now,
            days_ago=30,
        )
        relations = compute_indicator_relations(monthly, pipeline["consistency"], operational_risk, capacity)
        prioritized = prioritize_insights(insights)

        return Response(
            {
                "insights": insights,
                "prioritized": prioritized,
                "relations": relations,
                "personal_benchmark": personal_benchmark,
                "reevaluations": reevaluations,
                "performance_trend_explained": performance_trend_explained,
                "engine_version": ANALYTICS_ENGINE_VERSION,
                "insights_engine_version": INSIGHTS_ENGINE_VERSION,
                "last_updated": now.isoformat(),
            }
        )


class EquilibrioView(generics.GenericAPIView):
    """`GET /api/v1/analytics/equilibrio/<user_id>/` — capa de
    interpretación del Equilibrio Operativo (estado/tendencia/insights/
    calidad), réplica de `/api/analytics/equilibrio/[userId]` — Fase 16
    (ver docs/AUDIT_LOG.md § 2026-08-20). Nunca recalcula el score en sí
    (`compute_health_score`) — solo compone encima, mismo patrón que
    `OperationalRiskView`/`InsightsView`."""

    permission_classes = [IsAuthenticated]

    def get(self, request, user_id: int):
        target = get_object_or_404(User, pk=user_id)
        denied = _check_target_visibility(request, target)
        if denied is not None:
            return denied

        now = timezone.now()
        started_at = time.monotonic()
        value = compute_health_score(user=target, now=now)
        tiempo_calculo_ms = round_half_up((time.monotonic() - started_at) * 1000)
        consistency = compute_consistency(user=target, now=now)
        data_quality = compute_data_quality(user_ids=[target.id])

        estado = classify_estado_operativo(value["score"])
        trend = get_score_trend_explanation(
            user=target, kind="health_score", current_score=value["score"], current_factors=value["factors"], now=now, days_ago=30
        )

        # `insight_confidence` (★ 1-5, S6-F) alimenta compute_equilibrio_insights
        # — DISTINTO del `confidence` de presentación (data_quality_pct/
        # reliability_pct) que va en la respuesta más abajo, réplica fiel de
        # la doble variable `confidence` del TS (misma clave, dos formas).
        insight_confidence = compute_confidence(
            observations=consistency["weeks_analyzed"] if consistency.get("available") else 2,
            data_quality_pct=data_quality["pct"],
            consistent=(
                (consistency["level"] in ("muy-consistente", "consistente")) if consistency.get("available") else None
            ),
        )

        insights = compute_equilibrio_insights(value, insight_confidence)
        dimensiones = []
        for factor in value["factors"]:
            normalized_value = derived_normalized_value(factor["points"], factor["weight"])
            dimensiones.append(
                {**factor, "normalized_value": normalized_value, "explicacion": explain_equilibrio_factor(factor["name"], normalized_value)}
            )
        meaning = explain_equilibrio_meaning(estado, trend)
        impact = explain_equilibrio_impact(estado)
        strengths = [i for i in insights if i["tone"] == "positive"]
        weaknesses = [i for i in insights if i["tone"] == "risk"]
        recommendations = [i["accion"] for i in weaknesses if i.get("accion") is not None]

        advertencias: list[str] = []
        if not consistency.get("available"):
            advertencias.append("Consistencia sin historial suficiente — se usó un valor neutro (70/100) en esa dimensión.")

        return Response(
            {
                "health_score": value,
                "dimensiones": dimensiones,
                "estado": estado,
                "escala": ESCALA_INTERPRETACION_EQUILIBRIO,
                "trend": trend,
                "meaning": meaning,
                "impact": impact,
                "strengths": strengths,
                "weaknesses": weaknesses,
                "recommendations": recommendations,
                "confidence": {
                    "data_quality_pct": data_quality["pct"],
                    "reliability_pct": (
                        reliability_pct_from_stars(consistency["reliability"]["stars"]) if consistency.get("available") else 50
                    ),
                },
                "calidad": {
                    "engine_version": ANALYTICS_ENGINE_VERSION,
                    "formula_set_version": FORMULA_SET_VERSION,
                    "insights_engine_version": INSIGHTS_ENGINE_VERSION,
                    "fecha": now.isoformat(),
                    "origen": "Tareas del mes en curso, carga horaria, consistencia semanal y capacidad proyectada",
                    # Sin caché con TTL portada (mismo gap ya aceptado desde
                    # AnalyticsBundleView, Fase 4m) — siempre en vivo.
                    "cache_active": False,
                    "tiempo_calculo_ms": tiempo_calculo_ms,
                    "registros_utilizados": {
                        "semanas_consistencia": consistency["weeks_analyzed"] if consistency.get("available") else 0,
                        "dias_consistencia": consistency["days_analyzed"] if consistency.get("available") else 0,
                    },
                    "registros_descartados": consistency["explain"]["periods_excluded"] if consistency.get("available") else [],
                    "advertencias": advertencias,
                },
            }
        )


class OperationalRiskView(generics.GenericAPIView):
    """`GET /api/v1/analytics/operational-risk/<user_id>/` — Índice de
    Riesgo Operativo individual, réplica de
    `/api/analytics/operational-risk/[userId]` — Fase 16 (ver
    docs/AUDIT_LOG.md § 2026-08-20). Visibilidad restringida a gerencia
    (`can_view_operational_risk`, nunca nivel 1) — chequeada ANTES de
    buscar al usuario objetivo, mismo orden que el `route.ts` original
    — ADEMÁS de la visibilidad jerárquica estándar sobre ese usuario.
    `confidence`/`trend_explained` son metadata de PRESENTACIÓN
    calculada en esta vista — nunca alteran `score`/`classification`/
    `factors`, que vienen intactos de `compute_operational_risk`."""

    permission_classes = [IsAuthenticated]

    def get(self, request, user_id: int):
        if not can_view_operational_risk(request.user):
            return Response({"error": "Sin permisos"}, status=403)

        target = get_object_or_404(User, pk=user_id)
        denied = _check_target_visibility(request, target)
        if denied is not None:
            return denied

        now = timezone.now()
        value = compute_operational_risk(user=target, now=now)
        consistency = compute_consistency(user=target, now=now)
        data_quality = compute_data_quality(user_ids=[target.id])

        confidence = {
            "data_quality_pct": data_quality["pct"],
            "reliability_pct": (
                reliability_pct_from_stars(consistency["reliability"]["stars"]) if consistency.get("available") else 50
            ),
        }
        trend_explained = get_score_trend_explanation(
            user=target, kind="operational_risk", current_score=value["score"], current_factors=value["factors"], now=now, days_ago=30
        )

        return Response(
            {
                **value,
                "confidence": confidence,
                "trend_explained": trend_explained,
                "engine_version": ANALYTICS_ENGINE_VERSION,
                "last_updated": now.isoformat(),
            }
        )


class BenchmarkView(generics.GenericAPIView):
    """`GET /api/v1/analytics/benchmarks/<user_id>/` — Motor de
    Benchmarks Inteligente (Sprint 7), réplica de
    `/api/analytics/benchmarks/[userId]` — Fase 22 (ver
    docs/AUDIT_LOG.md § 2026-08-20). Compone `compute_smart_benchmark`
    (comparación entre pares del mismo cargo o Benchmark Personal) +
    `compute_personal_evolution` (tarjeta siempre visible) + confianza
    de presentación. Mismo patrón de auth/visibilidad jerárquica que
    `KpiUserView`."""

    permission_classes = [IsAuthenticated]

    def get(self, request, user_id: int):
        target = get_object_or_404(User, pk=user_id)
        denied = _check_target_visibility(request, target)
        if denied is not None:
            return denied

        now = timezone.now()
        benchmark = compute_smart_benchmark(user=target, now=now)
        # `benchmark["performance"]["value"]` ES el Performance Score
        # actual del usuario (ya calculado dentro de
        # `compute_smart_benchmark`) — se reutiliza en vez de
        # recalcularlo, réplica exacta del `route.ts`.
        evolution = compute_personal_evolution(user=target, current_score=benchmark["performance"]["value"], now=now)
        data_quality = compute_data_quality(user_ids=[target.id])

        if benchmark["mode"] == "cargo":
            reliability_pct = 92
        elif benchmark["mode"] == "cargo-limitado":
            reliability_pct = 68
        else:
            reliability_pct = reliability_pct_from_observations(evolution["observations"] if evolution.get("available") else 0)

        return Response(
            {
                "benchmark": benchmark,
                "evolution": evolution,
                "confidence": {"data_quality_pct": data_quality["pct"], "reliability_pct": reliability_pct},
                "last_updated": now.isoformat(),
            }
        )


class SimulateKpiView(generics.GenericAPIView):
    """`POST /api/v1/analytics/simulate/<user_id>/` — simulador
    interactivo de KPIs individuales (8 escenarios), réplica de
    `/api/analytics/simulate/[userId]` — Fase 23 (ver
    docs/AUDIT_LOG.md § 2026-08-20). NUNCA persiste nada. Mismo
    patrón de auth/visibilidad jerárquica que `KpiUserView`; el cuerpo
    se valida manualmente (`is_valid_scenario`) en vez de un
    `Serializer` — es una unión discriminada por `type` con campos
    distintos por escenario, réplica exacta de `isValidScenario`."""

    permission_classes = [IsAuthenticated]

    def post(self, request, user_id: int):
        target = get_object_or_404(User, pk=user_id)
        denied = _check_target_visibility(request, target)
        if denied is not None:
            return denied

        body = request.data
        if not is_valid_scenario(body):
            return Response({"error": "Escenario inválido"}, status=400)

        payload = simulate_kpi_scenario(user=target, body=body, now=timezone.now())
        return Response(payload)


class TeamOperationalRiskView(generics.GenericAPIView):
    """`GET /api/v1/analytics/operational-risk/team/` — Índice de
    Riesgo Operativo del equipo (resumen para gerencia), réplica de
    `/api/analytics/operational-risk/team` — Fase 20 (ver
    docs/AUDIT_LOG.md § 2026-08-20). Solo subordinados EJECUTORES
    (`get_subordinate_executor_groups`, Fase 19) — el Riesgo Operativo
    individual no es representativo para quien dirige, no ejecuta
    (Sprint 0A). Efecto lateral: `notify_if_high_risk` notifica a los
    superiores directos cuando el riesgo de un subordinado es Alto/
    Crítico, deduplicado una vez por persona/mes."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        if not can_view_operational_risk(request.user):
            return Response({"error": "Sin permisos"}, status=403)

        now = timezone.now()
        groups = get_subordinate_executor_groups(request.user)
        subordinates = sorted(
            User.objects.filter(groups__in=groups).distinct(), key=lambda m: m.first_name or m.username
        )
        if not subordinates:
            return Response(
                {
                    "members": [],
                    "summary": {"bajo": 0, "medio": 0, "alto": 0, "critico": 0},
                    "engine_version": ANALYTICS_ENGINE_VERSION,
                    "last_updated": now.isoformat(),
                }
            )

        members = []
        for s in subordinates:
            value = compute_operational_risk(user=s, now=now)
            notify_if_high_risk(user=s, risk=value, now=now)
            members.append({"id": s.id, "name": s.first_name or s.username, "role": _role_name(s), **value})
        members.sort(key=lambda m: m["score"], reverse=True)

        summary = {
            "bajo": sum(1 for m in members if m["classification"] == "Bajo"),
            "medio": sum(1 for m in members if m["classification"] == "Medio"),
            "alto": sum(1 for m in members if m["classification"] == "Alto"),
            "critico": sum(1 for m in members if m["classification"] == "Crítico"),
        }
        return Response(
            {"members": members, "summary": summary, "engine_version": ANALYTICS_ENGINE_VERSION, "last_updated": now.isoformat()}
        )


class TeamRecommendationsView(generics.GenericAPIView):
    """`GET /api/v1/analytics/recommendations/team/` — recomendaciones
    deterministas de redistribución de carga con impacto cuantificado
    (§S3-A), réplica de `/api/analytics/recommendations/team` — Fase
    24 (ver docs/AUDIT_LOG.md § 2026-08-20). Mismo gate y mismo
    conjunto de subordinados EJECUTORES que `TeamOperationalRiskView`.
    El motor cruza exceso de horas vs. capacidad disponible del
    equipo, sin IA — Gemini (si se usa en otra vista) solo redactaría
    este resultado ya calculado, nunca lo calcula."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        if not can_view_operational_risk(request.user):
            return Response({"error": "Sin permisos"}, status=403)

        groups = get_subordinate_executor_groups(request.user)
        subordinates = sorted(
            User.objects.filter(groups__in=groups).distinct(), key=lambda m: m.first_name or m.username
        )
        members = [{"id": s.id, "name": s.first_name or s.username, "role": _role_name(s)} for s in subordinates]

        now = timezone.now()
        recommendations = compute_team_recommendations(members=members, now=now)
        prioritized = prioritize_recommendations(recommendations)

        return Response(
            {
                "recommendations": recommendations,
                "prioritized": prioritized,
                "engine_version": ANALYTICS_ENGINE_VERSION,
                "last_updated": now.isoformat(),
            }
        )


_VALID_HISTORY_KINDS = {"performance_score", "operational_risk", "health_score"}
_VALID_HISTORY_MONTHS = {1, 3, 6, 12}


class HistoryView(generics.GenericAPIView):
    """`GET /api/v1/analytics/history/<user_id>/?kind=<kind>&months=<n>`
    — histórico de evolución con selector de período, réplica de
    `/api/analytics/history/[userId]` — Fase 17 (ver docs/AUDIT_LOG.md
    § 2026-08-20). Lectura pura sobre `AnalyticsAuditLog`
    (`get_score_series`, capa complementaria ya portada en la Fase 4j/9)
    — nunca recalcula un score. Mismo patrón de auth/visibilidad
    jerárquica que `KpiUserView`."""

    permission_classes = [IsAuthenticated]

    def get(self, request, user_id: int):
        target = get_object_or_404(User, pk=user_id)
        denied = _check_target_visibility(request, target)
        if denied is not None:
            return denied

        kind_param = request.query_params.get("kind")
        kind = kind_param if kind_param in _VALID_HISTORY_KINDS else "performance_score"
        try:
            months_param = int(request.query_params.get("months", ""))
        except ValueError:
            months_param = None
        months = months_param if months_param in _VALID_HISTORY_MONTHS else 3

        now = timezone.now()
        points = get_score_series(user=target, kind=kind, now=now, window_days=months * 31)
        return Response({"kind": kind, "months": months, "points": points})


class TargetTimePrecisionView(generics.GenericAPIView):
    """`GET /api/v1/analytics/target-time/<user_id>/` — precisión
    promedio del Tiempo Objetivo del mes en curso (Sprint 6 S6-F),
    réplica de `/api/analytics/target-time/[userId]` — Fase 17 (ver
    docs/AUDIT_LOG.md § 2026-08-20). `compute_target_time_precision`
    ya estaba portada desde la Fase 4d, sin consumidor HTTP hasta
    ahora. Mismo patrón de auth/visibilidad jerárquica que
    `KpiUserView`. Gap ya aceptado: sin capa de caché con TTL."""

    permission_classes = [IsAuthenticated]

    def get(self, request, user_id: int):
        target = get_object_or_404(User, pk=user_id)
        denied = _check_target_visibility(request, target)
        if denied is not None:
            return denied

        now = timezone.now()
        value = compute_target_time_precision(user=target, now=now)
        return Response({**value, "engine_version": ANALYTICS_ENGINE_VERSION, "last_updated": now.isoformat()})


class DataQualityView(generics.GenericAPIView):
    """`GET /api/v1/analytics/data-quality/?scope=self|team` — calidad
    de los datos usados por Analytics, réplica de
    `/api/analytics/data-quality` — Fase 17 (ver docs/AUDIT_LOG.md §
    2026-08-20). `scope=self` (default): cualquier usuario autenticado
    sobre sus propios datos. `scope=team`: requiere `can_view_team`
    (nivel >= 2), acotado a los subordinados visibles — reutiliza
    `get_team_members` (mismo conjunto que `TeamPreventiveAlertsView`/
    `TeamSubutilizationView`, Fase 9b)."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        scope = "team" if request.query_params.get("scope") == "team" else "self"

        if scope == "self":
            return Response(compute_data_quality(user_ids=[request.user.id]))

        if not can_view_team(request.user):
            return Response({"error": "Sin permisos"}, status=403)
        members = get_team_members(request.user)
        return Response(compute_data_quality(user_ids=[m.id for m in members]))


_CONFIG_KEY_ANALYTICS_ENGINE_VERSION_SEEN = "analytics_engine_version_seen"


class AnalyticsDiagnosticsView(generics.GenericAPIView):
    """`GET /api/v1/analytics/diagnostics/?engine_version=<X>` — Fase 88
    de la migración de stack (ver docs/AUDIT_LOG.md § 2026-08-28).
    Réplica de los 2 únicos cálculos que el panel "Diagnóstico del
    Motor" (`/api/analytics/diagnostics`, admin-only) seguía resolviendo
    contra Prisma: `computeDataQuality` (ya con réplica exacta acá,
    `compute_data_quality`, 3 consumidores Django reales) y
    `recordEngineVersionIfChanged` (comparación perezosa de versión,
    vía `get_effective_config_string`/`set_config_value`, ya genéricos
    y usados por 6+ configuraciones — solo se agrega la key nueva).

    `engine_version` es un query param porque Django no conoce
    `ANALYTICS_ENGINE_VERSION` (constante TS) — el caller (`route.ts`)
    la pasa. El resto del panel (contadores de caché/validaciones en
    memoria del proceso Next.js, `getDiagnosticsSnapshot`) NO se porta
    — es intrínsecamente proceso-local, sin equivalente Django
    significativo; el panel sigue siendo mixto TS/Django en ese
    aspecto, documentado a propósito."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        if _role_name(request.user) != "ADMINISTRADOR":
            return Response({"error": "Sin permisos"}, status=403)

        engine_version = request.query_params.get("engine_version", "")

        all_user_ids = list(User.objects.values_list("id", flat=True))
        data_quality = compute_data_quality(user_ids=all_user_ids)

        previous_version = get_effective_config_string(_CONFIG_KEY_ANALYTICS_ENGINE_VERSION_SEEN, timezone.now(), "")
        changed = previous_version != engine_version
        if changed:
            set_config_value(_CONFIG_KEY_ANALYTICS_ENGINE_VERSION_SEEN, engine_version, request.user)

        return Response(
            {
                "data_quality_pct": data_quality["pct"],
                "version_change": {"previous_version": previous_version or None, "changed": changed},
            }
        )


def _can_view_target_user(actor, target) -> bool:
    """Propio o visible jerárquicamente — mismo criterio que
    `KpiUserView`/`AnalyticsBundleView`, extraído como booleano para
    reusarse tanto en chequeos de un solo objetivo como en el
    bi-usuario de `SimulateRedistributeLoadView`."""
    if actor.id == target.id or actor.is_superuser:
        return True
    target_group = get_role_group(target)
    return target_group is not None and is_visible_to(actor, target_group)


def _parse_as_of(request):
    """`?as_of=<ISO date>` opcional — `timezone.now()` si ausente o
    inválido (nunca lanza). Fase 85 (ver docs/AUDIT_LOG.md §
    2026-08-27), mismo criterio que `ClosureStatusView`."""
    raw = request.query_params.get("as_of")
    if not raw:
        return timezone.now()
    parsed = parse_datetime(raw)
    if parsed is None:
        return timezone.now()
    return parsed if timezone.is_aware(parsed) else timezone.make_aware(parsed)


def _check_target_visibility(request, target) -> Response | None:
    """Chequeo de visibilidad jerárquica compartido por las vistas de
    Inteligencia Preventiva — mismo patrón que `KpiUserView`/
    `AnalyticsBundleView`. Devuelve una `Response` 403 si no hay
    permiso, o `None` si el acceso es válido."""
    if not _can_view_target_user(request.user, target):
        return Response({"detail": "No tiene permiso para ver la Inteligencia Preventiva de este usuario."}, status=403)
    return None


class PredictionBundleView(generics.GenericAPIView):
    """`GET /api/v1/predictive/predictions/<user_id>/` — bundle de
    predicciones explicables (Cumplimiento/Sobrecarga/Estabilidad
    Operativa/Retrasos de hasta 10 tareas abiertas) para UN
    colaborador, réplica de `/api/predictive/predictions/[userId]` —
    Fase 9 (ver docs/AUDIT_LOG.md § 2026-08-18). Mismo patrón de auth/
    visibilidad jerárquica que `KpiUserView`.

    `?as_of=<ISO date>` opcional agregado en la Fase 85 (ver
    docs/AUDIT_LOG.md § 2026-08-27) — mismo patrón que `weeks_back` en
    `TrendEngineView`: `build_prediction_bundle_payload` ya aceptaba
    `now` como parámetro Python, solo faltaba exponerlo por HTTP. Sin
    esto, el bloque "Predictivo" de Reportes Ejecutivos no podía
    reusar este endpoint para regenerar un reporte con fecha de corte
    explícita distinta de "ahora"."""

    permission_classes = [IsAuthenticated]

    def get(self, request, user_id: int):
        target = get_object_or_404(User, pk=user_id)
        denied = _check_target_visibility(request, target)
        if denied is not None:
            return denied

        as_of = _parse_as_of(request)
        payload = build_prediction_bundle_payload(actor=request.user, target=target, now=as_of)
        return Response(payload)


class TrendEngineView(generics.GenericAPIView):
    """`GET /api/v1/predictive/trend/<user_id>/?weeks_back=<n>` —
    Trend Engine (8 indicadores de dirección/estabilidad), réplica de
    `/api/predictive/trend/[userId]` — Fase 9 (ver docs/AUDIT_LOG.md §
    2026-08-18). `weeks_back` es un override opcional (1-52) para
    Tendencias Históricas, independiente de la Ventana Histórica de
    Predicción configurada globalmente — mismo motivo que en el TS, no
    se cachea al usarse (petición interactiva, no repetitiva)."""

    permission_classes = [IsAuthenticated]

    def get(self, request, user_id: int):
        target = get_object_or_404(User, pk=user_id)
        denied = _check_target_visibility(request, target)
        if denied is not None:
            return denied

        weeks_back_param = request.query_params.get("weeks_back")
        window_weeks_override = None
        if weeks_back_param is not None:
            try:
                parsed = round_half_up(float(weeks_back_param))
            except ValueError:
                parsed = None
            if parsed is not None and 0 < parsed <= 52:
                window_weeks_override = parsed

        payload = compute_trend_engine(user=target, window_weeks_override=window_weeks_override)
        return Response(payload)


class PreventiveAlertsView(generics.GenericAPIView):
    """`GET /api/v1/predictive/alerts/<user_id>/` — alertas preventivas
    individuales, réplica de `/api/predictive/alerts/[userId]` — Fase
    9b (ver docs/AUDIT_LOG.md § 2026-08-18). Mismo patrón de auth/
    visibilidad jerárquica que `KpiUserView`."""

    permission_classes = [IsAuthenticated]

    def get(self, request, user_id: int):
        target = get_object_or_404(User, pk=user_id)
        denied = _check_target_visibility(request, target)
        if denied is not None:
            return denied
        alerts = compute_preventive_alerts(user=target)
        return Response({"alerts": alerts})


class TeamPreventiveAlertsView(generics.GenericAPIView):
    """`GET /api/v1/predictive/team-alerts/` — alertas preventivas del
    equipo visible del actor (subordinados + proyectos activos
    visibles), réplica de `/api/predictive/team-alerts` — Fase 9b (ver
    docs/AUDIT_LOG.md § 2026-08-18)."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        if not can_view_team(request.user):
            return Response({"detail": "No tiene permiso para ver alertas de equipo."}, status=403)
        members = get_team_members(request.user)
        user_ids = [m.id for m in members]
        project_ids = get_visible_team_project_ids(request.user, user_ids)
        alerts = compute_team_preventive_alerts(user_ids=user_ids, project_ids=project_ids)
        return Response({"alerts": alerts})


class TeamSubutilizationView(generics.GenericAPIView):
    """`GET /api/v1/predictive/team-subutilization/` — predicción de
    subutilización de cada subordinado visible del actor, réplica de
    `/api/predictive/team-subutilization` — Fase 9b (ver
    docs/AUDIT_LOG.md § 2026-08-18)."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        if not can_view_team(request.user):
            return Response({"detail": "No tiene permiso para ver la subutilización del equipo."}, status=403)
        members = get_team_members(request.user)
        predictions = compute_subutilizacion_predictions(user_ids=[m.id for m in members])
        payload = [
            {"user_id": m.id, "name": m.first_name, "prediction": predictions.get(m.id)} for m in members
        ]
        return Response({"members": payload})


class ProjectDelayView(generics.GenericAPIView):
    """`GET /api/v1/predictive/project-delay/<project_id>/` —
    predicción de retraso de un proyecto, réplica de
    `/api/predictive/project-delay/[projectId]` — Fase 9b (ver
    docs/AUDIT_LOG.md § 2026-08-18). Gateado por `can_view_project`
    (mismo permiso que el detalle del proyecto), no por visibilidad
    jerárquica de usuario."""

    permission_classes = [IsAuthenticated]

    def get(self, request, project_id: int):
        project = get_object_or_404(Project, pk=project_id)
        participant_ids = list(project.participants.values_list("user_id", flat=True))
        if not can_view_project(request.user, project, participant_ids):
            return Response({"detail": "No tiene permiso para ver este proyecto."}, status=403)
        payload = compute_project_delay_prediction(project_id=project_id)
        return Response(payload)


class SimulateAdjustTargetTimeView(generics.GenericAPIView):
    """`POST /api/v1/predictive/simulate/<user_id>/` — escenario
    "modificar tiempo objetivo" de una tarea (nivel individual),
    réplica de `/api/predictive/simulate/[userId]` — Fase 9c (ver
    docs/AUDIT_LOG.md § 2026-08-18). Nunca persiste nada."""

    permission_classes = [IsAuthenticated]
    serializer_class = AdjustTargetTimeSimulationSerializer

    def post(self, request, user_id: int):
        target = get_object_or_404(User, pk=user_id)
        denied = _check_target_visibility(request, target)
        if denied is not None:
            return denied

        serializer = self.get_serializer(data=request.data)
        if not serializer.is_valid():
            return Response({"detail": "Escenario inválido"}, status=400)
        task_id = serializer.validated_data["task_id"]
        new_target_time_hours = serializer.validated_data["new_target_time_hours"]

        task = (
            Task.objects.filter(pk=task_id)
            .only("assigned_to", "status", "estimated_hours", "target_time_validated", "real_hours")
            .first()
        )
        if not task or task.assigned_to_id != user_id:
            return Response({"detail": "Tarea no encontrada para este usuario"}, status=404)
        if task.status not in (Task.Status.PENDIENTE, Task.Status.EN_PROGRESO):
            return Response({"detail": "Solo se puede simular sobre tareas Pendientes o En Progreso"}, status=400)

        now = timezone.now()
        capacity = compute_capacity_forecast(user=target, now=now)
        health_score = compute_health_score(user=target, now=now)
        payload = simulate_adjust_target_time(
            capacity=capacity, health_score=health_score, task=task, new_target_time_hours=new_target_time_hours
        )
        return Response(payload)


class SimulateAddParticipantsView(generics.GenericAPIView):
    """`POST /api/v1/predictive/simulate/project/<project_id>/` —
    escenario "agregar participantes" (nivel proyecto), réplica de
    `/api/predictive/simulate/project/[projectId]` — Fase 9c (ver
    docs/AUDIT_LOG.md § 2026-08-18). Nunca persiste nada."""

    permission_classes = [IsAuthenticated]
    serializer_class = AddParticipantsSimulationSerializer

    def post(self, request, project_id: int):
        project = get_object_or_404(Project, pk=project_id)
        participant_ids = list(project.participants.values_list("user_id", flat=True))
        if not can_view_project(request.user, project, participant_ids):
            return Response({"detail": "No tiene permiso para ver este proyecto."}, status=403)

        serializer = self.get_serializer(data=request.data)
        if not serializer.is_valid():
            return Response({"detail": "Escenario inválido"}, status=400)

        payload = simulate_add_participants(
            target_time_hours=project.target_time_hours,
            real_hours=project.real_hours,
            participant_count=len(participant_ids),
            additional_participants=serializer.validated_data["additional_participants"],
            project_id=project_id,
        )
        return Response(payload)


class SimulateRedistributeLoadView(generics.GenericAPIView):
    """`POST /api/v1/predictive/simulate/redistribute/` — escenario
    "redistribuir carga" (bi-usuario), réplica de
    `/api/predictive/simulate/redistribute` — Fase 9c (ver
    docs/AUDIT_LOG.md § 2026-08-18). Nunca persiste nada."""

    permission_classes = [IsAuthenticated]
    serializer_class = RedistributeLoadSimulationSerializer

    def post(self, request):
        serializer = self.get_serializer(data=request.data)
        if not serializer.is_valid():
            return Response({"detail": "Escenario inválido"}, status=400)
        from_user_id = serializer.validated_data["from_user_id"]
        to_user_id = serializer.validated_data["to_user_id"]
        hours = serializer.validated_data["hours"]

        users = list(User.objects.filter(id__in=[from_user_id, to_user_id]))
        if len(users) != 2:
            return Response({"detail": "Usuario no encontrado"}, status=404)
        if not all(_can_view_target_user(request.user, u) for u in users):
            return Response({"detail": "No tiene permiso para ver a estos usuarios."}, status=403)

        now = timezone.now()
        capacity_map = compute_team_capacity_forecast(user_ids=[from_user_id, to_user_id], now=now)
        payload = simulate_redistribute_load(
            from_user_id=from_user_id,
            to_user_id=to_user_id,
            from_capacity=capacity_map[from_user_id],
            to_capacity=capacity_map[to_user_id],
            hours=hours,
        )
        return Response(payload)
