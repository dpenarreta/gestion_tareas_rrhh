from django.db import IntegrityError
from rest_framework import generics
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.analytics.prediction_engine import compute_subutilizacion_predictions
from apps.analytics.workload import get_month_closure_period
from apps.hierarchy.services import get_visible_groups, is_executor_group
from apps.users.models import User

from .models import ExecutiveReportSnapshot, MonthlyReport
from .permissions import CanAccessReports, role_name, scope_for_role
from .serializers import (
    CustomRangeTeamReportRequestSerializer,
    ExecutiveReportAuditCreateSerializer,
    ExecutiveReportCreateSerializer,
    ExecutiveReportIntegrityIncidentCreateSerializer,
    ExecutiveReportListItemSerializer,
    MonthlyTeamReportRequestSerializer,
    RangeTeamReportRequestSerializer,
    TeamSubutilizationRequestSerializer,
)
from .services import ensure_snapshot_meta, log_report_audit
from .team_report import (
    assemble_custom_range_team_report,
    assemble_monthly_team_report,
    assemble_range_team_report,
)


class UserLegacyIdLookupView(APIView):
    """`GET /api/v1/reports/user-lookup/?legacy_ids=<cuid1>,<cuid2>,...` —
    Fase 57 de la migración de stack (ver docs/AUDIT_LOG.md § 2026-08-25).
    Resuelve el id numérico de Django de una lista de usuarios a partir de
    su `legacy_postgres_id` (cuid de Postgres) — el roster de un Executive
    Report se resuelve contra Prisma (`resolveRoster.ts`, sin cutover:
    las consultas de Tareas/Actividades del builder siguen necesitando el
    cuid), pero portar el cálculo del Índice Ejecutivo a Django requiere
    el id numérico de cada colaborador para llamar a `/analytics/<id>/`.

    Gateado por `CanAccessReports`, NO por el catálogo de administración
    de usuarios (`usuarios.ver`) — un Coordinador Nacional puede generar
    reportes sin tener acceso a administración de usuarios; reusar
    `GET /admin/users/` (permiso distinto) le devolvería 403 sin motivo."""

    permission_classes = [CanAccessReports]

    def get(self, request):
        raw_ids = request.query_params.get("legacy_ids", "")
        legacy_ids = [v.strip() for v in raw_ids.split(",") if v.strip()]
        if not legacy_ids:
            return Response({"error": "legacy_ids es requerido"}, status=400)

        users = User.objects.filter(legacy_postgres_id__in=legacy_ids).values("legacy_postgres_id", "id")
        return Response(list(users))


class RosterView(APIView):
    """`GET /api/v1/reports/roster/?roles=<csv>&areas=<csv>&colaboradores=<csv de cuids>` —
    Fase 87 de la migración de stack (ver docs/AUDIT_LOG.md § 2026-08-28).
    Réplica exacta de `resolveReportRoster` (`src/lib/executiveReporting/
    resolveRoster.ts`) — roster de colaboradores incluidos en un Executive
    Report, misma fuente para los 3 tipos de reporte y los 3 alcances
    (consolidado/por área/individual). `roles`/`areas` (alias literal de
    `roles` — NEXO no tiene campo de área propio, ver `filters.ts`) y
    `colaboradores` solo NARROWAN el roster que la jerarquía del generador
    ya permite ver (`get_visible_groups` + `is_executor_group`, exclusión
    de liderazgo) — nunca lo amplían, sin importar lo que el caller pida.

    Expone `legacy_postgres_id` (no el id numérico de Django) en `users[].id`
    porque el builder que llama a este endpoint (`buildSnapshotData.ts`)
    sigue operando en cuids, resolviendo el id de Django por su cuenta vía
    `user-lookup/` (Fase 57) — mismo criterio que ese endpoint."""

    permission_classes = [CanAccessReports]

    def get(self, request):
        allowed_groups = [g for g in get_visible_groups(request.user) if is_executor_group(g)]

        roles_param = [v.strip() for v in request.query_params.get("roles", "").split(",") if v.strip()]
        areas_param = [v.strip() for v in request.query_params.get("areas", "").split(",") if v.strip()]
        colaboradores_param = [v.strip() for v in request.query_params.get("colaboradores", "").split(",") if v.strip()]

        if roles_param:
            requested = set(roles_param)
            allowed_groups = [g for g in allowed_groups if g.name in requested]
        if areas_param:
            requested_areas = set(areas_param)
            allowed_groups = [g for g in allowed_groups if g.name in requested_areas]

        queryset = User.objects.filter(groups__in=allowed_groups).distinct()
        if colaboradores_param:
            queryset = queryset.filter(legacy_postgres_id__in=colaboradores_param)

        # Orden por nombre en Python, no en el queryset — mismo criterio que
        # `TeamListView` (`apps.team.views`): "nombre" es `first_name or
        # username`, no ordenable directo a nivel SQL sin anotar.
        members = sorted(queryset, key=lambda u: u.first_name or u.username)
        payload_users = [
            {"id": u.legacy_postgres_id, "name": u.first_name or u.username, "role": role_name(u)} for u in members
        ]

        if colaboradores_param:
            roster_kind = "INDIVIDUAL" if len(colaboradores_param) == 1 else "POR_AREA"
        elif roles_param or areas_param:
            roster_kind = "POR_AREA"
        else:
            roster_kind = "CONSOLIDADO"

        return Response(
            {
                "users": payload_users,
                "user_ids": [u["id"] for u in payload_users],
                "scope": scope_for_role(request.user),
                "roster_kind": roster_kind,
            }
        )


class MonthlyReportView(APIView):
    """`GET /api/v1/reports/monthly-report/?month=&year=&scope=` — Fase 89
    de la migración de stack (ver docs/AUDIT_LOG.md § 2026-08-28). Réplica
    del último `prisma.monthlyReport.findUnique` que le quedaba a
    `buildSnapshotData.ts` (variación del Índice Ejecutivo contra el mes
    anterior). `MonthlyReport` (ver docstring del modelo) no recibe filas
    nuevas en NINGÚN lado del sistema desde antes de esta fase — este
    endpoint preserva ese comportamiento EXACTO (siempre 404 hoy), no
    inventa ninguna escritura nueva."""

    permission_classes = [CanAccessReports]

    def get(self, request):
        try:
            month = int(request.query_params.get("month"))
            year = int(request.query_params.get("year"))
        except (TypeError, ValueError):
            return Response({"error": "Año o mes inválido"}, status=400)
        scope = request.query_params.get("scope")
        if scope not in dict(ExecutiveReportSnapshot.Scope.choices):
            return Response({"error": "Scope inválido"}, status=400)

        report = MonthlyReport.objects.filter(month=month, year=year, scope=scope).first()
        if report is None:
            return Response({"error": "No encontrado"}, status=404)
        return Response({"data": report.data})


class ClosureStatusView(APIView):
    """Réplica exacta de `GET /api/reports/executive/closure-status` —
    Fase 34 de la migración de stack (ver docs/AUDIT_LOG.md §
    2026-08-21). Deliberadamente separado de `GET /api/tasks/close-month`
    (que exige el permiso de administración de cierres, mucho más
    restrictivo que quién puede simplemente GENERAR un reporte) — este
    endpoint solo expone si el mes tiene un cierre con corte
    anticipado/regularizado, para que el asistente de generación de
    reportes pueda avisarlo ANTES de generar.

    Fase 84 (ver docs/AUDIT_LOG.md § 2026-08-27) agrega `closed_at`/
    `calendar_days_total`/`calendar_days_considered`/
    `working_days_considered`/`working_hours_considered` — el `route.ts`
    de vista previa (`closure-status/route.ts`) solo necesitaba los 3
    campos originales, pero `buildSnapshotData.ts::closureMetaFrom`
    (metadatos de cierre del propio snapshot de un Reporte Ejecutivo)
    necesita los 7, y hoy los sigue leyendo de Prisma — mismo patrón de
    divergencia ya encontrado en `holidays.ts`."""

    permission_classes = [CanAccessReports]

    def get(self, request):
        try:
            year = int(request.query_params.get("year"))
            month = int(request.query_params.get("month"))
        except (TypeError, ValueError):
            return Response({"error": "Año o mes inválido"}, status=400)
        if month < 1 or month > 12:
            return Response({"error": "Año o mes inválido"}, status=400)

        closure, _natural_end, _effective_end = get_month_closure_period(year, month)
        return Response(
            {
                "closed": closure is not None,
                "cutoff_date": closure.cutoff_date.date().isoformat() if closure else None,
                "closure_type": closure.closure_type if closure else None,
                "closed_at": closure.closed_at.isoformat() if closure else None,
                "calendar_days_total": closure.calendar_days_total if closure else None,
                "calendar_days_considered": closure.calendar_days_considered if closure else None,
                "working_days_considered": closure.working_days_considered if closure else None,
                "working_hours_considered": closure.working_hours_considered if closure else None,
            }
        )


class MonthlyTeamReportView(APIView):
    """`POST /reports/executive/monthly-team-kpis/` — Fase 68 de la
    migración de stack (ver docs/AUDIT_LOG.md § 2026-08-26). Primer
    endpoint HTTP del bundle de CÁLCULO de Reportes Ejecutivos
    (`ReportMemberKpi` + agregados de equipo, builder MENSUAL) — ver
    docstring de `team_report.py` para el alcance completo y lo que
    deliberadamente queda fuera (Índice Ejecutivo/Predictivo/NOVA/
    metadatos de reporte). Deliberadamente SIN wiring desde
    `buildSnapshotData.ts` todavía — mismo criterio que `member_kpis.py`/
    `insights.py`: el endpoint se construye y prueba en aislamiento,
    el cutover real queda para una fase futura con verificación campo
    por campo contra datos reales."""

    permission_classes = [CanAccessReports]

    def post(self, request):
        serializer = MonthlyTeamReportRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        report = assemble_monthly_team_report(
            user_ids=data["user_ids"],
            year=data["year"],
            month=data["month"],
            explicit_fecha_corte=data.get("fecha_corte"),
        )
        return Response(report)


class TeamSubutilizationReportView(APIView):
    """`POST /reports/executive/team-subutilization/` — Fase 85 de la
    migración de stack (ver docs/AUDIT_LOG.md § 2026-08-27). Predicción
    de subutilización para un roster EXPLÍCITO de usuarios — a
    diferencia de `apps.analytics.views.TeamSubutilizationView` (GET,
    deriva la lista del equipo jerárquico visible del actor, sirve la
    pantalla en vivo de Inteligencia Preventiva, SIN cambios acá), el
    roster de un Reporte Ejecutivo puede no coincidir con el equipo de
    quien lo genera (admin generando para otro jefe, scope custom).
    Reutiliza `compute_subutilizacion_predictions` tal cual — ya acepta
    `user_ids`/`now` como parámetros explícitos, sin cambios; esta
    vista solo cambia CÓMO se resuelve la lista de entrada. Respuesta
    keyed por id (no por nombre) — el caller (`buildSnapshotData.ts`)
    ya tiene los nombres del roster resuelto."""

    permission_classes = [CanAccessReports]

    def post(self, request):
        serializer = TeamSubutilizationRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        predictions = compute_subutilizacion_predictions(user_ids=data["user_ids"], now=data.get("as_of"))
        return Response({"predictions": predictions})


class CustomRangeTeamReportView(APIView):
    """`POST /reports/executive/custom-range-team-kpis/` — Fase 69 de la
    migración de stack (ver docs/AUDIT_LOG.md § 2026-08-26). Mismo
    criterio que `MonthlyTeamReportView` (ver docstring de
    `team_report.py`) aplicado al builder RANGO PERSONALIZADO."""

    permission_classes = [CanAccessReports]

    def post(self, request):
        serializer = CustomRangeTeamReportRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        report = assemble_custom_range_team_report(
            user_ids=data["user_ids"],
            period_start=data["period_start"],
            period_end=data["period_end"],
            explicit_fecha_corte=data.get("fecha_corte"),
        )
        return Response(report)


class RangeTeamReportView(APIView):
    """`POST /reports/executive/range-team-kpis/` — Fase 69. Mismo
    criterio que `MonthlyTeamReportView` aplicado al builder RANGO DE
    MESES."""

    permission_classes = [CanAccessReports]

    def post(self, request):
        serializer = RangeTeamReportRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        report = assemble_range_team_report(
            user_ids=data["user_ids"],
            from_year=data["from_year"],
            from_month=data["from_month"],
            to_year=data["to_year"],
            to_month=data["to_month"],
            explicit_fecha_corte=data.get("fecha_corte"),
        )
        return Response(report)


class ExecutiveReportCreateView(generics.CreateAPIView):
    """`POST /api/v1/reports/executive/` — Fase 56 de la migración de
    stack (ver docs/AUDIT_LOG.md § 2026-08-25). Réplica de `createSnapshot`
    (`src/lib/executiveReporting/snapshotStore.ts`): el CÁLCULO del
    snapshot (`buildSnapshotForFilters`, ~1183 líneas — roster, KPIs por
    colaborador, agregados de equipo, narrativa NOVA) sigue ocurriendo en
    Next.js sin ningún cambio — este endpoint solo PERSISTE el resultado
    ya calculado, para que quede visible en
    `ExecutiveReportListView`/`ExecutiveReportDetailView` (Fase 8, sin
    cambios). El reintento ante colisión de `report_id`
    (`MAX_REPORT_ID_ATTEMPTS`) vive del lado de Next.js — acá alcanza con
    devolver 409 ante una colisión real del constraint `unique=True`.
    `generated_by` se fija desde `request.user`, nunca desde el body."""

    permission_classes = [CanAccessReports]
    serializer_class = ExecutiveReportCreateSerializer

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        collaborator_count = len(serializer.validated_data.get("collaborator_ids") or [])
        try:
            serializer.save(generated_by=request.user, collaborator_count=collaborator_count)
        except IntegrityError:
            return Response({"error": "report_id ya existe"}, status=409)
        return Response({"report_id": serializer.instance.report_id}, status=201)


class ExecutiveReportAuditCreateView(generics.CreateAPIView):
    """`POST /api/v1/reports/executive/audit/` — Fase 56. Réplica de
    `logReportAudit` (`snapshotStore.ts`) — best-effort del lado de
    Next.js (si esta llamada falla, el caller la ignora, nunca rompe la
    generación/lectura que audita). `user` se fija desde `request.user`,
    nunca desde el body."""

    permission_classes = [CanAccessReports]
    serializer_class = ExecutiveReportAuditCreateSerializer

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save(user=request.user)
        return Response(status=204)


class ExecutiveReportIntegrityIncidentCreateView(generics.CreateAPIView):
    """`POST /api/v1/reports/executive/integrity-incidents/` — Sprint R
    (Fase 79, ver docs/AUDIT_LOG.md § 2026-08-27). Réplica de
    `verifySnapshotIntegrity.ts` — best-effort del lado de Next.js (si
    esta llamada falla, el caller la ignora, nunca rompe la generación
    del reporte que valida). Sin `GET`/listado todavía — no hay UI que lo
    necesite (se agrega cuando exista un consumidor real)."""

    permission_classes = [CanAccessReports]
    serializer_class = ExecutiveReportIntegrityIncidentCreateSerializer

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(status=204)


class ExecutiveReportListView(APIView):
    """Réplica de `GET /api/reports/executive/list` — historial paginado
    de reportes ya generados (GENERATED y LEGACY_MIGRATION conviven en
    la misma lista). Mismo criterio de visibilidad por `scope` que el
    detalle."""

    permission_classes = [CanAccessReports]

    def get(self, request):
        scope = scope_for_role(request.user)

        try:
            page = max(1, int(request.query_params.get("page", 1)))
        except ValueError:
            page = 1
        try:
            page_size = min(100, max(1, int(request.query_params.get("pageSize", 20))))
        except ValueError:
            page_size = 20

        queryset = ExecutiveReportSnapshot.objects.filter(scope=scope).select_related("generated_by")
        total = queryset.count()
        start = (page - 1) * page_size
        rows = queryset[start : start + page_size]

        return Response(
            {
                "page": page,
                "page_size": page_size,
                "total": total,
                "reports": ExecutiveReportListItemSerializer(rows, many=True).data,
            }
        )


class ExecutiveReportDetailView(APIView):
    """Réplica de `GET /api/reports/executive/[reportId]` — lectura
    INMUTABLE de un reporte ya generado. Nunca recalcula: `data` es
    exactamente el snapshot congelado que el builder produjo en su
    momento (fuera de alcance de esta sub-fase, ver docstring de
    `models.py`). Registra auditoría `viewed`."""

    permission_classes = [CanAccessReports]

    def get(self, request, report_id: str):
        snapshot = ExecutiveReportSnapshot.objects.select_related("generated_by").filter(report_id=report_id).first()
        if snapshot is None:
            return Response({"error": "Reporte no encontrado"}, status=404)

        viewer_scope = scope_for_role(request.user)
        if snapshot.scope != viewer_scope:
            return Response({"error": "Sin permisos"}, status=403)

        log_report_audit(report_id=report_id, action="viewed", user=request.user)

        return Response(
            {
                "report": {
                    "report_id": snapshot.report_id,
                    "type": snapshot.type,
                    "scope": snapshot.scope,
                    "origin": snapshot.origin,
                    "integrity_flag": snapshot.integrity_flag,
                    "period_label": snapshot.period_label,
                    "period_start": snapshot.period_start,
                    "period_end": snapshot.period_end,
                    "fecha_corte": snapshot.fecha_corte,
                    "period_status": snapshot.period_status,
                    "collaborator_count": snapshot.collaborator_count,
                    "generated_by": snapshot.generated_by.first_name or snapshot.generated_by.username,
                    "generated_at": snapshot.generated_at,
                    "generation_ms": snapshot.generation_ms,
                    "analytics_engine_version": snapshot.analytics_engine_version,
                    "formula_set_version": snapshot.formula_set_version,
                    "reporting_engine_version": snapshot.reporting_engine_version,
                    "nexo_version": snapshot.nexo_version,
                    "data": ensure_snapshot_meta(snapshot),
                    "nova": snapshot.nova,
                    "nova_degraded": snapshot.nova_degraded,
                    "data_quality": snapshot.data_quality,
                }
            }
        )
