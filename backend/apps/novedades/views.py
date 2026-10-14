"""Endpoints del módulo Control Operativo de Novedades (`/api/v1/novedades/`).

Las vistas solo resuelven parámetros y delegan en `services.py`/`excel.py`;
toda regla de autorización por registro vive allí. `NovedadesError` se
traduce al contrato de error uniforme (`apps.core.responses`)."""

from functools import cached_property

from django.db.models import Q
from django.http import HttpResponse
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.request_meta import get_request_context
from apps.core.responses import error_response

from .access import NovedadesAccess
from .excel import CollaboratorImportService, ExportService, ImportService
from .models import ImportBatch
from .periods import month_for_date, parse_month_code, parse_period_code, period_for_date
from .permissions import CanAccessNovedades
from .serializers import (
    BulkOvertimeSerializer,
    CloseSerializer,
    CollaboratorCreateSerializer,
    CollaboratorSerializer,
    CollaboratorUpdateSerializer,
    DeadlineSettingsSerializer,
    DeleteSerializer,
    EventSerializer,
    ImportBatchSerializer,
    ImportConfirmSerializer,
    ImportPreviewSerializer,
    OverrideCreateSerializer,
    OverrideRevokeSerializer,
    OvertimeCorrectionSerializer,
    OvertimeRecordSerializer,
    OvertimeSettingsSerializer,
    OvertimeWriteSerializer,
    ReassignSerializer,
    RolePermissionSerializer,
    SaveCellsSerializer,
    StatusChangeSerializer,
    WorkedDayCorrectionSerializer,
)
from .services import (
    CollaboratorInput,
    CollaboratorService,
    CorrectionService,
    DepurationService,
    HistoryService,
    NovedadesError,
    OvertimeMonthService,
    OvertimeService,
    PeriodService,
    PermissionAdminService,
    RecordDeadlineService,
    WorkedDayService,
    _parse_id_param,
    today,
    user_display,
)

XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


class NovedadesView(APIView):
    permission_classes = [IsAuthenticated, CanAccessNovedades]

    @cached_property
    def access(self) -> NovedadesAccess:
        return NovedadesAccess.for_user(self.request.user)

    @property
    def context(self) -> dict:
        return get_request_context(self.request)

    def handle_exception(self, exc):
        if isinstance(exc, NovedadesError):
            return error_response(exc.code, exc.message, exc.status, exc.details)
        return super().handle_exception(exc)

    def period_param(self, value=None):
        raw = value if value is not None else self.request.query_params.get("period")
        if not raw:
            return period_for_date(today())
        try:
            return parse_period_code(raw)
        except ValueError as exc:
            raise NovedadesError(str(exc)) from exc

    def month_param(self, value=None):
        """Mes calendario de Horas extras (`AAAA-MM`); por defecto, el actual."""
        raw = value if value is not None else self.request.query_params.get("period")
        if not raw:
            return month_for_date(today())
        try:
            return parse_month_code(raw)
        except ValueError as exc:
            raise NovedadesError(str(exc)) from exc

    def supervisor_param(self, value=None):
        """Supervisor objetivo: el propio usuario si es Supervisor; si no, el
        indicado (validado contra su ámbito en el servicio)."""
        raw = value if value is not None else self.request.query_params.get("supervisor")
        if self.access.is_supervisor and not self.access.national_write:
            if raw and str(raw) != str(self.request.user.pk):
                raise NovedadesError(
                    "No puede operar sobre el equipo de otro supervisor.",
                    code="permission_denied",
                    status=403,
                )
            return self.request.user
        if not raw:
            raise NovedadesError("Seleccione un supervisor.", code="supervisor_required")
        supervisor = PeriodService.get_supervisor(raw)
        if not self.access.can_read_supervisor(supervisor.pk):
            raise NovedadesError(
                "No puede consultar el equipo de otro supervisor.",
                code="permission_denied",
                status=403,
            )
        return supervisor

    def validated(self, serializer_class, data=None):
        serializer = serializer_class(data=self.request.data if data is None else data)
        serializer.is_valid(raise_exception=True)
        return serializer.validated_data

    def xlsx(self, content: bytes, filename: str) -> HttpResponse:
        response = HttpResponse(content, content_type=XLSX)
        response["Content-Disposition"] = f'attachment; filename="{filename}"'
        return response


class MeView(NovedadesView):
    def get(self, request):
        data = self.access.as_dict()
        current = None
        if self.access.is_supervisor:
            sp = PeriodService.ensure_current(request.user)
            current = {"code": sp.period.code, "label": sp.period.key.label, "status": sp.status}
        data["current_period"] = current or {
            "code": period_for_date(today()).code,
            "label": period_for_date(today()).label,
            "status": None,
        }
        month = month_for_date(today())
        data["current_month"] = {"code": month.code, "label": month.label}
        # Plazo por fecha de trabajo ya calculado por el servidor (la pantalla
        # no recalcula reglas: solo bloquea lo que aquí se informa).
        data["deadline_rules"] = RecordDeadlineService.rules(self.access)
        data["user"] = {"id": request.user.pk, "name": user_display(request.user)}
        return Response(data)


class SupervisorListView(NovedadesView):
    def get(self, request):
        supervisors = PeriodService.supervisors()
        ids = self.access.readable_supervisor_ids()
        if ids is not None:
            supervisors = supervisors.filter(pk__in=ids)
        return Response([{"id": s.pk, "name": user_display(s)} for s in supervisors])


class PeriodListView(NovedadesView):
    def get(self, request):
        supervisor = None
        if request.query_params.get("supervisor") or self.access.is_supervisor:
            supervisor = self.supervisor_param()
        return Response(PeriodService.periods_for(self.access, supervisor))


class PeriodStatusView(NovedadesView):
    def get(self, request):
        return Response(PeriodService.status_overview(self.access, self.period_param()))


class CloseSummaryView(NovedadesView):
    def get(self, request):
        return Response(
            PeriodService.close_summary(self.access, self.period_param(), self.supervisor_param())
        )


class ClosePeriodView(NovedadesView):
    def post(self, request):
        data = self.validated(CloseSerializer)
        key = self.period_param(data["period"])
        supervisor = self.supervisor_param(data.get("supervisor_id"))
        return Response(PeriodService.close(self.access, key, supervisor, context=self.context))


class CollaboratorListView(NovedadesView):
    def get(self, request):
        qs = CollaboratorService.queryset_for(self.access)
        params = request.query_params
        if params.get("status"):
            qs = qs.filter(status=params["status"])
        if params.get("supervisor"):
            qs = qs.filter(
                current_supervisor_id=_parse_id_param(params["supervisor"], "supervisor")
            )
        if params.get("q"):
            q = params["q"].strip()
            qs = qs.filter(Q(full_name__icontains=q) | Q(cedula__icontains=q))
        return Response(CollaboratorSerializer(qs[:2000], many=True).data)

    def post(self, request):
        data = self.validated(CollaboratorCreateSerializer)
        collaborator = CollaboratorService.create(
            self.access,
            CollaboratorInput(
                cedula=data["cedula"],
                full_name=data["full_name"],
                regional=data["regional"],
                area=data["area"],
                cargo=data["cargo"],
            ),
            supervisor_id=data.get("supervisor_id"),
            context=self.context,
        )
        return Response(CollaboratorSerializer(collaborator).data, status=201)


class CollaboratorDetailView(NovedadesView):
    def get(self, request, pk):
        return Response(
            CollaboratorSerializer(CollaboratorService.get_for_read(self.access, pk)).data
        )

    def patch(self, request, pk):
        data = self.validated(CollaboratorUpdateSerializer)
        collaborator = CollaboratorService.update(self.access, pk, data, context=self.context)
        return Response(CollaboratorSerializer(collaborator).data)

    def delete(self, request, pk):
        data = self.validated(DeleteSerializer, request.data or {})
        CollaboratorService.delete(self.access, pk, data["reason"], context=self.context)
        return Response(status=204)


class CollaboratorStatusView(NovedadesView):
    def post(self, request, pk):
        data = self.validated(StatusChangeSerializer)
        collaborator = CollaboratorService.change_status(
            self.access, pk, data["status"], data["reason"], context=self.context
        )
        return Response(CollaboratorSerializer(collaborator).data)


class CollaboratorReassignView(NovedadesView):
    def post(self, request, pk):
        data = self.validated(ReassignSerializer)
        collaborator = CollaboratorService.reassign(
            self.access, pk, data["supervisor_id"], data["reason"], context=self.context
        )
        return Response(CollaboratorSerializer(collaborator).data)


class CollaboratorHistoryView(NovedadesView):
    def get(self, request, pk):
        return Response(CollaboratorService.history(self.access, pk))


class WorkedDayMatrixView(NovedadesView):
    def get(self, request):
        # Sin `supervisor` y con alcance nacional = "Todos los supervisores"
        # (no se simula con un id ficticio). El Supervisor siempre ve su equipo.
        if not request.query_params.get("supervisor") and self.access.national_read:
            return Response(WorkedDayService.consolidated_matrix(self.access, self.period_param()))
        return Response(
            WorkedDayService.matrix(self.access, self.period_param(), self.supervisor_param())
        )


class WorkedDaySaveView(NovedadesView):
    def post(self, request):
        data = self.validated(SaveCellsSerializer)
        key = self.period_param(data["period"])
        supervisor = self.supervisor_param(data.get("supervisor_id"))
        result = WorkedDayService.save_cells(
            self.access, key, supervisor, data["cells"], context=self.context
        )
        return Response(result)


class WorkedDayExportView(NovedadesView):
    def get(self, request):
        key = self.period_param()
        matrix = WorkedDayService.matrix(self.access, key, self.supervisor_param())
        content = ExportService.worked_days(self.access, matrix)
        return self.xlsx(content, f"dias-laborados-{key.code}.xlsx")


def _overtime_filters(view) -> dict:
    params = view.request.query_params
    filters = {
        k: params.get(k)
        for k in (
            "date",
            "date_from",
            "date_to",
            "cedula",
            "name",
            "regional",
            "area",
            "cargo",
            "jornada",
        )
    }
    if params.get("period"):
        filters["period"] = view.month_param()  # mes calendario, no 23 → 22
    if params.get("supervisor"):
        filters["supervisor"] = params["supervisor"]
    return filters


class OvertimeListView(NovedadesView):
    def get(self, request):
        qs = OvertimeService.filter(
            OvertimeService.queryset_for(self.access), _overtime_filters(self)
        )
        params = request.query_params
        try:
            offset = max(int(params.get("offset", 0)), 0)
            limit = min(max(int(params.get("limit", 200)), 1), 1000)
        except ValueError:
            offset, limit = 0, 200
        indicators = OvertimeService.indicators(qs)
        if params.get("period") and self.access.national_read:
            # Cierre manual del MES de Horas extras, independiente de Días laborados.
            total = PeriodService.supervisors().count()
            closed = len(OvertimeMonthService.closes_for(self.month_param()))
            indicators["supervisors_closed"] = closed
            indicators["supervisors_pending"] = max(total - closed, 0)
        # Los totales salen del filtro completo; la página solo limita filas.
        return Response(
            {
                "indicators": indicators,
                "count": indicators["records"],
                "offset": offset,
                "limit": limit,
                "records": OvertimeRecordSerializer(qs[offset : offset + limit], many=True).data,
            }
        )

    def post(self, request):
        data = self.validated(OvertimeWriteSerializer)
        if "collaborator_id" not in data or "date" not in data:
            raise NovedadesError("Colaborador y fecha son obligatorios.")
        record = OvertimeService.create(self.access, data, context=self.context)
        return Response(OvertimeRecordSerializer(record).data, status=201)


class OvertimeDetailView(NovedadesView):
    def patch(self, request, pk):
        data = self.validated(OvertimeWriteSerializer)
        data.pop("collaborator_id", None)
        data.pop("date", None)
        # Solo lo que realmente se envió: el serializer completa SABADO/
        # DOMINGO/FERIADO con None y eso devolvía a "automático" una marca
        # manual aunque la edición no la tocara.
        data = {k: v for k, v in data.items() if k in request.data}
        record = OvertimeService.update(self.access, pk, data, context=self.context)
        return Response(OvertimeRecordSerializer(record).data)

    def delete(self, request, pk):
        data = self.validated(DeleteSerializer, request.data or {})
        OvertimeService.delete(self.access, pk, data["reason"], context=self.context)
        return Response(status=204)


class OvertimeExportView(NovedadesView):
    def get(self, request):
        qs = OvertimeService.filter(
            OvertimeService.queryset_for(self.access), _overtime_filters(self)
        )
        content = ExportService.overtime(
            self.access, qs, filters=dict(request.query_params.items()), context=self.context
        )
        suffix = request.query_params.get("period") or "consolidado"
        return self.xlsx(content, f"horas-extras-{suffix}-exportado-{today():%Y%m%d}.xlsx")


class OvertimeBulkView(NovedadesView):
    """Guardado masivo de la captura tipo Excel: resultado por fila."""

    def post(self, request):
        data = self.validated(BulkOvertimeSerializer)
        result = OvertimeService.bulk_save(
            self.access, self.month_param(data["period"]), data["rows"], context=self.context
        )
        return Response(result)


class OvertimeMonthListView(NovedadesView):
    """Meses de Horas extras con su estado, fecha límite y tiempo restante."""

    def get(self, request):
        supervisor = None
        if request.query_params.get("supervisor") or self.access.is_supervisor:
            supervisor = self.supervisor_param()
        return Response(OvertimeMonthService.months(self.access, supervisor))


class DepurationView(NovedadesView):
    """Estado de la base de Horas depuradas del mes (o su ausencia)."""

    def get(self, request):
        return Response(DepurationService.status(self.access, self.month_param()))


class DepurationCreateView(NovedadesView):
    """Crea (o abre, si ya existe) la base depurable del mes. Idempotente."""

    def post(self, request):
        data = self.validated(CloseSerializer)
        return Response(
            DepurationService.create(
                self.access, self.month_param(data["period"]), context=self.context
            )
        )


class DepurationRowsView(NovedadesView):
    def get(self, request):
        return Response(
            DepurationService.rows(
                self.access, self.month_param(), dict(request.query_params.items())
            )
        )


class DepurationSaveView(NovedadesView):
    """Guardado automático de filas depuradas (resultado por fila)."""

    def post(self, request):
        data = request.data if isinstance(request.data, dict) else {}
        rows = data.get("rows")
        if not isinstance(rows, list) or not rows:
            raise NovedadesError("No hay filas para guardar.")
        return Response(
            DepurationService.save_rows(
                self.access,
                self.month_param(str(data.get("period") or "")),
                rows,
                context=self.context,
            )
        )


class DepurationHistoryView(NovedadesView):
    def get(self, request):
        return Response(
            DepurationService.history(
                self.access, self.month_param(), request.query_params.get("row")
            )
        )


class DepurationExportView(NovedadesView):
    def get(self, request):
        month = self.month_param()
        depuration, qs = DepurationService.export_rows(self.access, month)
        content = ExportService.depurated(self.access, depuration, qs, context=self.context)
        return self.xlsx(content, f"horas-depuradas-{month.code}.xlsx")


class DeadlineSettingsView(NovedadesView):
    """Control de plazos de registro (Ajustes). Lectura: cualquier usuario del
    módulo; modificación: solo el Administrador (se revalida en el servicio)."""

    def get(self, request):
        return Response(RecordDeadlineService.settings(self.access))

    def patch(self, request):
        data = self.validated(DeadlineSettingsSerializer)
        return Response(RecordDeadlineService.set_hours(self.access, data, context=self.context))


class OvertimeMonthCheckView(NovedadesView):
    """Revisión previa al cierre del mes (solo informa, no bloquea)."""

    def get(self, request):
        return Response(
            OvertimeMonthService.pre_close_check(
                self.access, self.month_param(), self.supervisor_param()
            )
        )


class OvertimeMonthCloseView(NovedadesView):
    """Cierre MANUAL del mes de Horas extras de un equipo (idempotente)."""

    def post(self, request):
        data = self.validated(CloseSerializer)
        supervisor = self.supervisor_param(data.get("supervisor_id"))
        result = OvertimeMonthService.close(
            self.access, self.month_param(data["period"]), supervisor, context=self.context
        )
        return Response(result)


class OvertimeSettingsView(NovedadesView):
    """Plazo de cierre de Horas extras (48–72 horas laborables, Ajustes)."""

    def get(self, request):
        return Response(
            {
                "grace_hours": OvertimeMonthService.current_grace_hours(),
                "min_hours": OvertimeMonthService.MIN_HOURS,
                "max_hours": OvertimeMonthService.MAX_HOURS,
            }
        )

    def patch(self, request):
        data = self.validated(OvertimeSettingsSerializer)
        OvertimeMonthService.set_grace_hours(self.access, data["grace_hours"], context=self.context)
        return self.get(request)


class CollaboratorTemplateView(NovedadesView):
    def get(self, request):
        return self.xlsx(CollaboratorImportService.template(), "plantilla-base-colaboradores.xlsx")


class OvertimeTemplateView(NovedadesView):
    def get(self, request):
        return self.xlsx(ExportService.overtime_template(), "plantilla-horas-extras.xlsx")


class WorkedDayTemplateView(NovedadesView):
    def get(self, request):
        key = self.period_param()
        matrix = WorkedDayService.matrix(self.access, key, self.supervisor_param())
        return self.xlsx(
            ExportService.worked_days(self.access, matrix, blank=True),
            f"plantilla-dias-laborados-{key.code}.xlsx",
        )


class ImportPreviewView(NovedadesView):
    parser_classes = [MultiPartParser, FormParser]

    def post(self, request):
        data = self.validated(ImportPreviewSerializer)
        if data["kind"] == ImportBatch.Kind.COLLABORATORS:
            batch = CollaboratorImportService.preview(
                self.access,
                file=data["file"],
                file_name=data["file"].name,
                supervisor_id=data.get("supervisor_id"),
            )
        else:
            batch = ImportService.preview(
                self.access,
                kind=data["kind"],
                key=self.period_param(data["period"]),
                file=data["file"],
                file_name=data["file"].name,
            )
        return Response(ImportBatchSerializer(batch).data, status=201)


class ImportConfirmView(NovedadesView):
    def post(self, request, pk):
        data = self.validated(ImportConfirmSerializer)
        batch = ImportService.confirm(self.access, pk, data["strategy"], context=self.context)
        return Response(ImportBatchSerializer(batch).data)


class ImportCancelView(NovedadesView):
    def post(self, request, pk):
        ImportService.cancel(self.access, pk)
        return Response(status=204)


class ImportErrorsView(NovedadesView):
    def get(self, request, pk):
        batch = ImportBatch.objects.filter(pk=pk, uploaded_by=request.user).first()
        if batch is None:
            raise NovedadesError("Importación no encontrada.", code="not_found", status=404)
        return self.xlsx(ExportService.import_errors(batch), f"errores-importacion-{batch.pk}.xlsx")


class WorkedDayCorrectionView(NovedadesView):
    def post(self, request):
        data = self.validated(WorkedDayCorrectionSerializer)
        correction = CorrectionService.correct_worked_day(
            self.access,
            collaborator_id=data["collaborator_id"],
            supervisor_id=data["supervisor_id"],
            day=data["date"],
            hours=data.get("hours"),
            reason=data["reason"],
            context=self.context,
        )
        return Response({"id": correction.pk}, status=201)


class OvertimeCorrectionView(NovedadesView):
    def post(self, request):
        data = self.validated(OvertimeCorrectionSerializer)
        correction = CorrectionService.correct_overtime(
            self.access,
            record_id=data["record_id"],
            changes=data,
            delete=data.get("delete", False),
            reason=data["reason"],
            context=self.context,
        )
        return Response({"id": correction.pk}, status=201)


class HistoryView(NovedadesView):
    def get(self, request):
        params = dict(request.query_params.items())
        if params.get("period"):
            params["period"] = self.period_param()
        qs = HistoryService.events(self.access, params)
        try:
            offset = max(int(params.get("offset", 0)), 0)
            limit = min(max(int(params.get("limit", 100)), 1), 500)
        except ValueError:
            offset, limit = 0, 100
        return Response(
            {
                "count": qs.count(),
                "results": EventSerializer(qs[offset : offset + limit], many=True).data,
            }
        )


class RepositoryView(NovedadesView):
    def get(self, request):
        return Response(HistoryService.repository(self.access))


class PermissionConfigView(NovedadesView):
    def get(self, request):
        return Response(PermissionAdminService.config(self.access))


class RolePermissionView(NovedadesView):
    def post(self, request):
        data = self.validated(RolePermissionSerializer)
        PermissionAdminService.set_role_permission(self.access, **data, context=self.context)
        return Response(PermissionAdminService.config(self.access))


class OperationalUsersView(NovedadesView):
    def get(self, request):
        return Response(PermissionAdminService.operational_users(self.access))


class EffectivePermissionsView(NovedadesView):
    def get(self, request, user_id):
        return Response(PermissionAdminService.effective(self.access, user_id))


class OverrideListView(NovedadesView):
    def get(self, request):
        return Response(PermissionAdminService.overrides(self.access))

    def post(self, request):
        data = self.validated(OverrideCreateSerializer)
        override = PermissionAdminService.create_override(self.access, **data, context=self.context)
        return Response(PermissionAdminService.serialize_override(override), status=201)


class OverrideRevokeView(NovedadesView):
    def post(self, request, pk):
        data = self.validated(OverrideRevokeSerializer)
        override = PermissionAdminService.revoke_override(
            self.access, pk, data["reason"], context=self.context
        )
        return Response(PermissionAdminService.serialize_override(override))
