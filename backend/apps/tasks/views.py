import re
import unicodedata
from io import BytesIO

import openpyxl
from django.http import HttpResponse
from django.utils import timezone
from rest_framework import generics, status, viewsets
from rest_framework.decorators import action
from rest_framework.parsers import MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.core.permissions import IsAdministrador
from apps.core.request_meta import get_client_ip

from .business_time import business_calendar_day, business_day_real_range, parse_date_only
from .models import ActivityReason, Task, TaskActivity
from .permissions import CanAccessTask, CanCloseMonth, CanDeleteTask, CanRegularize
from .serializers import (
    ActivityCommentCreateSerializer,
    ActivityCommentSerializer,
    ActivityCreateSerializer,
    ActivityReasonCreateSerializer,
    ActivityReasonSerializer,
    ActivityReasonUpdateSerializer,
    ActivitySerializer,
    AdminEditActivitySerializer,
    CommentCreateSerializer,
    CommentSerializer,
    CorrectTaskSerializer,
    EndDateActionSerializer,
    EndDateAuditLogSerializer,
    EndDateBulkApproveSerializer,
    PendingTaskSerializer,
    RetroactiveActivityCreateSerializer,
    TargetTimeAuditLogSerializer,
    TargetTimeBulkValidateSerializer,
    TargetTimeValidateSerializer,
    TaskCreateSerializer,
    TaskListSerializer,
    TaskUpdateSerializer,
    TaskUserRefSerializer,
)
from .services import (
    ActivityCommentService,
    ActivityService,
    CommentService,
    EndDateService,
    MonthClosureService,
    TargetTimeService,
    TaskImportService,
    TaskService,
    TaskValidationService,
)


class TaskViewSet(viewsets.ModelViewSet):
    """Fase 3a de la migración de stack (ver docs/AUDIT_LOG.md §
    2026-08-07): CRUD core + comentarios. Sin registro de horas, sin
    validación de Tiempo Objetivo/Fecha Fin, sin Cierre Inteligente — ver
    plan de Fase 3a para la hoja de ruta de sub-fases."""

    http_method_names = ["get", "post", "patch", "delete", "head", "options"]
    queryset = Task.objects.select_related("assigned_to", "created_by")

    def get_queryset(self):
        if self.action == "list":
            return self.queryset.filter(
                assigned_to=self.request.user, archived_month__isnull=True
            )
        return self.queryset

    def get_permissions(self):
        if self.action == "destroy":
            return [CanDeleteTask()]
        if self.action == "correct":
            return [IsAdministrador()]
        if self.action in (
            "retrieve", "partial_update", "comments", "activities", "activities_retroactive",
            "target_time", "end_date",
        ):
            return [CanAccessTask()]
        return [IsAuthenticated()]

    def list(self, request, *args, **kwargs):
        tasks = self.get_queryset().order_by("-created_at")
        return Response(TaskListSerializer(tasks, many=True, context={"request": request}).data)

    def retrieve(self, request, *args, **kwargs):
        task = self.get_object()
        return Response(TaskListSerializer(task, context={"request": request}).data)

    def create(self, request, *args, **kwargs):
        serializer = TaskCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        task = TaskService.create_task(actor=request.user, **serializer.validated_data)
        return Response(
            TaskListSerializer(task, context={"request": request}).data,
            status=status.HTTP_201_CREATED,
        )

    def partial_update(self, request, *args, **kwargs):
        task = self.get_object()
        serializer = TaskUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        task = TaskService.update_task(
            actor=request.user,
            task=task,
            fields=serializer.validated_data,
            ip_address=get_client_ip(request),
        )
        return Response(TaskListSerializer(task, context={"request": request}).data)

    @action(detail=True, methods=["get", "post"])
    def comments(self, request, pk=None):
        task = self.get_object()
        if request.method == "GET":
            comments = CommentService.list_and_mark_viewed(task=task, user=request.user)
            return Response(CommentSerializer(comments, many=True).data)

        serializer = CommentCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        comment = CommentService.create_comment(
            task=task, author=request.user, text=serializer.validated_data["text"]
        )
        return Response(CommentSerializer(comment).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["get", "post"])
    def activities(self, request, pk=None):
        task = self.get_object()
        if request.method == "GET":
            activities = task.activities.select_related("author").all()
            return Response(ActivitySerializer(activities, many=True).data)

        serializer = ActivityCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        activity = ActivityService.create_activity(actor=request.user, task=task, **serializer.validated_data)
        return Response(ActivitySerializer(activity).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"], url_path="activities/retroactive")
    def activities_retroactive(self, request, pk=None):
        """Sub-fase 3f (ver docs/AUDIT_LOG.md § 2026-08-07) — igual que
        `POST /tasks/{id}/activities/retroactive/` legacy."""
        task = self.get_object()
        serializer = RetroactiveActivityCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        activity = ActivityService.create_retroactive_activity(
            actor=request.user, task=task, **serializer.validated_data
        )
        return Response(ActivitySerializer(activity).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["get", "post"], url_path="target-time")
    def target_time(self, request, pk=None):
        task = self.get_object()
        if request.method == "POST":
            serializer = TargetTimeValidateSerializer(data=request.data)
            serializer.is_valid(raise_exception=True)
            task = TargetTimeService.apply_validation(
                actor=request.user, task=task, ip_address=get_client_ip(request), **serializer.validated_data
            )

        info = TargetTimeService.get_info(actor=request.user, task=task)
        return Response(self._serialize_target_time_info(info))

    @staticmethod
    def _serialize_target_time_info(info: dict) -> dict:
        return {
            **{k: v for k, v in info.items() if k not in ("validated_by", "audit_history")},
            "validated_by": TaskUserRefSerializer(info["validated_by"]).data if info["validated_by"] else None,
            "audit_history": TargetTimeAuditLogSerializer(info["audit_history"], many=True).data,
        }

    @action(detail=True, methods=["get", "post"], url_path="end-date")
    def end_date(self, request, pk=None):
        task = self.get_object()
        if request.method == "POST":
            serializer = EndDateActionSerializer(data=request.data)
            serializer.is_valid(raise_exception=True)
            task = EndDateService.apply_action(
                actor=request.user, task=task, ip_address=get_client_ip(request), **serializer.validated_data
            )

        info = EndDateService.get_info(actor=request.user, task=task)
        return Response(self._serialize_end_date_info(info))

    @staticmethod
    def _serialize_end_date_info(info: dict) -> dict:
        return {
            **{k: v for k, v in info.items() if k not in ("approved_by", "audit_history")},
            "approved_by": TaskUserRefSerializer(info["approved_by"]).data if info["approved_by"] else None,
            "audit_history": EndDateAuditLogSerializer(info["audit_history"], many=True).data,
        }

    @action(detail=True, methods=["patch"])
    def correct(self, request, pk=None):
        """Corrección de Admin sobre una tarea archivada — sub-fase 3d
        (ver docs/AUDIT_LOG.md § 2026-08-07). Gate `IsAdministrador`, más
        estrecho que `CanAccessTask`: por eso NO usa `self.get_object()`
        (que aplicaría `CanAccessTask` vía `check_object_permissions`)
        sino una consulta directa por pk."""
        task = generics.get_object_or_404(Task.objects.all(), pk=pk)
        serializer = CorrectTaskSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        task = MonthClosureService.correct_archived_task(
            actor=request.user, task=task,
            real_hours=serializer.validated_data.get("real_hours"),
            status=serializer.validated_data.get("status"),
        )
        return Response(TaskListSerializer(task, context={"request": request}).data)


class ActivityReasonListView(generics.ListAPIView):
    """Fase 3b — solo lectura, cualquier usuario autenticado, TODOS los
    motivos (activos e inactivos) — igual que
    `src/app/api/activity-reasons/route.ts`."""

    queryset = ActivityReason.objects.all()
    serializer_class = ActivityReasonSerializer
    permission_classes = [IsAuthenticated]


def _role_name(user) -> str:
    """`is_superuser` siempre resuelve a ADMINISTRADOR — mismo criterio
    que `apps.configuration.views.role_name` y equivalentes en
    reports/meetings/ideas/data_requests/desk."""
    if user.is_superuser:
        return "ADMINISTRADOR"
    group = user.groups.first()
    return group.name if group else ""


_DIACRITICS_RE = re.compile(r"[^A-Z0-9]+")


def _slugify_activity_reason_key(label: str) -> str:
    """Réplica exacta de `slugifyKey` (`settings/activity-reasons/route.ts`):
    normaliza a NFD, descarta marcas diacríticas combinantes, mayúsculas,
    reemplaza cualquier corrida de no-alfanuméricos por `_`, recorta
    guiones bajos en los extremos — `"MOTIVO"` si el resultado queda
    vacío (ej. un label compuesto solo por símbolos)."""
    decomposed = unicodedata.normalize("NFD", label)
    without_marks = "".join(c for c in decomposed if not unicodedata.combining(c))
    base = _DIACRITICS_RE.sub("_", without_marks.upper()).strip("_")
    return base or "MOTIVO"


def _unique_activity_reason_key(label: str) -> str:
    base_key = _slugify_activity_reason_key(label)
    key = base_key
    suffix = 2
    while ActivityReason.objects.filter(key=key).exists():
        key = f"{base_key}_{suffix}"
        suffix += 1
    return key


class ActivityReasonCreateView(generics.GenericAPIView):
    """`POST /api/v1/settings/activity-reasons/` — Fase 30 de la
    migración de stack (ver docs/AUDIT_LOG.md § 2026-08-21), réplica
    exacta de `route.ts`. Solo ADMINISTRADOR. Gap documentado (mismo
    criterio que `prediction-window`/`role-targets`): el TS invalida
    la caché de Analytics tras crear (`assignedRoles` afecta el índice
    de trazabilidad/consistencia) — sin capa de caché con TTL en
    Django, no hay nada que invalidar."""

    permission_classes = [IsAuthenticated]
    serializer_class = ActivityReasonCreateSerializer

    def post(self, request):
        if _role_name(request.user) != "ADMINISTRADOR":
            return Response({"error": "Sin permisos"}, status=403)

        serializer = self.get_serializer(data=request.data)
        if not serializer.is_valid():
            return Response({"error": "El nombre del motivo es obligatorio"}, status=400)

        label = serializer.validated_data["label"].strip()
        if not label:
            return Response({"error": "El nombre del motivo es obligatorio"}, status=400)

        reason = ActivityReason.objects.create(
            key=_unique_activity_reason_key(label),
            label=label,
            # `description` no es nullable en Django (`blank=True,
            # default=""`, a diferencia del `String?` de Prisma) — "sin
            # descripción" se representa como cadena vacía, no `None`.
            description=(serializer.validated_data.get("description") or "").strip(),
            assigned_roles=serializer.validated_data["assigned_roles"],
        )
        return Response(ActivityReasonSerializer(reason).data, status=201)


class ActivityReasonUpdateView(generics.GenericAPIView):
    """`PATCH /api/v1/settings/activity-reasons/<id>/` — Fase 30,
    réplica exacta de `route.ts`. Solo ADMINISTRADOR. Archivar
    (`is_archived=True`) fuerza `is_active=False` también — restaurar
    (`is_archived=False`) solo lo devuelve al listado, no reactiva su
    selectabilidad (mismo comportamiento asimétrico del TS)."""

    permission_classes = [IsAuthenticated]
    serializer_class = ActivityReasonUpdateSerializer

    def patch(self, request, pk: int):
        if _role_name(request.user) != "ADMINISTRADOR":
            return Response({"error": "Sin permisos"}, status=403)

        serializer = self.get_serializer(data=request.data)
        if not serializer.is_valid():
            return Response({"error": "El nombre del motivo es obligatorio"}, status=400)
        data = serializer.validated_data

        if "label" in data and not data["label"].strip():
            return Response({"error": "El nombre del motivo es obligatorio"}, status=400)

        reason = generics.get_object_or_404(ActivityReason, pk=pk)

        if "label" in data:
            reason.label = data["label"].strip()
        if "description" in data:
            reason.description = (data.get("description") or "").strip()
        if "assigned_roles" in data:
            reason.assigned_roles = data["assigned_roles"]
        if "is_active" in data:
            reason.is_active = data["is_active"]
        if "is_archived" in data:
            reason.is_archived = data["is_archived"]
            reason.archived_at = timezone.now() if data["is_archived"] else None
            if data["is_archived"]:
                reason.is_active = False

        reason.save()
        return Response(ActivityReasonSerializer(reason).data)


class DayScheduleView(generics.GenericAPIView):
    """`GET /api/v1/activities/day-schedule/` — Fase 26 de la migración
    de stack (ver docs/AUDIT_LOG.md § 2026-08-20), réplica exacta de
    `src/app/api/activities/day-schedule/route.ts`: actividades del
    actor con horario registrado en tareas SEGUIMIENTO (no FIJA) para
    un día dado, usado por el cliente para validar solapamientos de
    horario antes de guardar."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        date_param = request.query_params.get("date")
        day = parse_date_only(date_param) if date_param else business_calendar_day(timezone.now())
        if day is None:
            return Response({"error": "Fecha inválida"}, status=400)

        start, end = business_day_real_range(day)
        activities = (
            TaskActivity.objects.filter(
                author=request.user, created_at__gte=start, created_at__lte=end,
                start_time__isnull=False, end_time__isnull=False, task__type=Task.Type.SEGUIMIENTO,
            )
            .select_related("task")
            .only("id", "start_time", "end_time", "task_id", "task__title")
        )
        return Response(
            [
                {
                    "id": a.id,
                    "startTime": a.start_time,
                    "endTime": a.end_time,
                    "taskId": a.task_id,
                    "taskTitle": a.task.title,
                }
                for a in activities
            ]
        )


class TargetTimeBulkValidateView(generics.GenericAPIView):
    """Sub-fase 3c-bulk (ver docs/AUDIT_LOG.md § 2026-08-07) — igual que
    `src/app/api/tasks/target-time/bulk-validate/route.ts`. No es una
    acción anidada de `TaskViewSet`: no opera sobre un `pk` de tarea."""

    serializer_class = TargetTimeBulkValidateSerializer
    permission_classes = [CanRegularize]

    def post(self, request):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        result = TargetTimeService.bulk_validate(
            actor=request.user, ip_address=get_client_ip(request), **serializer.validated_data
        )
        return Response(result)


class EndDateBulkApproveView(generics.GenericAPIView):
    """Sub-fase 3c-bulk — igual que
    `src/app/api/tasks/end-date/bulk-approve/route.ts`."""

    serializer_class = EndDateBulkApproveSerializer
    permission_classes = [CanRegularize]

    def post(self, request):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        result = EndDateService.bulk_approve(
            actor=request.user, ip_address=get_client_ip(request), **serializer.validated_data
        )
        return Response(result)


class PendingValidationsView(generics.GenericAPIView):
    """Sub-fase 3c-bulk — igual que
    `src/app/api/tasks/validations/pending/route.ts`: combina Tiempo
    Objetivo y Fecha Fin pendientes en una sola pantalla, más el % de
    calidad del dato de cada dimensión."""

    permission_classes = [CanRegularize]

    def get(self, request):
        from django.contrib.auth.models import Group

        user_id = request.query_params.get("user_id") or None
        role = request.query_params.get("role") or None
        task_type = request.query_params.get("type") or None
        # Validado una sola vez aquí (en vez de en cada service) para que
        # `tasks`/las 2 dimensiones de calidad del dato usen exactamente
        # el mismo filtro de rol — un rol inválido se ignora, nunca
        # produce un total_count=0 espurio en `data_quality`.
        if role and not Group.objects.filter(name=role).exists():
            role = None

        tasks = TaskValidationService.list_pending(user_id=user_id, role=role, task_type=task_type)
        return Response(
            {
                "tasks": PendingTaskSerializer(tasks, many=True).data,
                "target_time_data_quality": TargetTimeService.data_quality(role=role),
                "end_date_data_quality": EndDateService.data_quality(role=role),
            }
        )


class CloseMonthView(generics.GenericAPIView):
    """Motor de Cierre Inteligente — sub-fase 3d (ver docs/AUDIT_LOG.md §
    2026-08-07), igual que `src/app/api/tasks/close-month/route.ts`. No
    es una acción anidada de `TaskViewSet`: no opera sobre un `pk` de
    tarea, sino sobre un período (year/month)."""

    permission_classes = [CanCloseMonth]

    @staticmethod
    def _parse_year_month(year_raw, month_raw, now):
        from rest_framework import serializers as drf_serializers

        from .closure import previous_month

        if year_raw is None and month_raw is None:
            return previous_month(now)
        try:
            year, month = int(year_raw), int(month_raw)
        except (TypeError, ValueError):
            raise drf_serializers.ValidationError({"non_field_errors": ["Año o mes inválido"]})
        if month < 1 or month > 12:
            raise drf_serializers.ValidationError({"non_field_errors": ["Año o mes inválido"]})
        return year, month

    def get(self, request):
        year, month = self._parse_year_month(
            request.query_params.get("year"), request.query_params.get("month"), timezone.now()
        )
        preview = MonthClosureService.preview(
            year=year, month=month,
            cutoff_date_raw=request.query_params.get("cutoffDate"), now=timezone.now(),
        )
        return Response(self._serialize(preview))

    def post(self, request):
        now = timezone.now()
        year, month = self._parse_year_month(request.data.get("year"), request.data.get("month"), now)
        cutoff_date_raw = request.data.get("cutoffDate")

        preview = MonthClosureService.preview(
            year=year, month=month, cutoff_date_raw=cutoff_date_raw if isinstance(cutoff_date_raw, str) else None,
            now=now,
        )
        if preview["already_closed"]:
            return Response({"error": "Este mes ya fue cerrado"}, status=status.HTTP_409_CONFLICT)

        result = MonthClosureService.execute(
            actor=request.user, year=year, month=month,
            cutoff_date_raw=cutoff_date_raw if isinstance(cutoff_date_raw, str) else None, now=now,
        )
        return Response(self._serialize(result))

    @staticmethod
    def _serialize(data: dict) -> dict:
        return {**data, "cutoff_date": data["cutoff_date"].date().isoformat()}


class RepositoryListView(generics.GenericAPIView):
    """Listado de meses cerrados con agregados — sub-fase 3d, igual que
    `src/app/api/repository/route.ts`. Gap de visibilidad ya documentado
    en `MonthClosureService.list_repository_months`."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(MonthClosureService.list_repository_months(actor=request.user))


class RepositoryDetailView(generics.GenericAPIView):
    """Detalle de un mes cerrado — sub-fase 3d, igual que
    `src/app/api/repository/[year]/[month]/route.ts`."""

    permission_classes = [IsAuthenticated]

    def get(self, request, year: int, month: int):
        tasks = MonthClosureService.list_repository_tasks(actor=request.user, year=year, month=month)
        if tasks is None:
            return Response({"error": "Este mes no ha sido cerrado"}, status=status.HTTP_404_NOT_FOUND)
        return Response(TaskListSerializer(tasks, many=True, context={"request": request}).data)


class TaskImportView(generics.GenericAPIView):
    """Importador masivo de Tareas por Excel — sub-fase 3e (ver
    docs/AUDIT_LOG.md § 2026-08-07), igual que
    `src/app/api/tasks/import/route.ts`. Sin gate de rol, igual que el
    legacy. Si el archivo está corrupto, `load_workbook` propaga sin
    try/except propio — cae al 500 genérico ya estandarizado en
    `apps.core.exceptions.api_exception_handler`, mismo comportamiento de
    facto que el legacy (que tampoco lo maneja explícitamente)."""

    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser]

    def post(self, request):
        file = request.FILES.get("file")
        if file is None:
            return Response({"error": "No se envió ningún archivo"}, status=status.HTTP_400_BAD_REQUEST)

        workbook = openpyxl.load_workbook(file, data_only=True)
        sheet = workbook.worksheets[0]
        rows = [
            row
            for row in sheet.iter_rows(min_row=2, values_only=True)
            if any(cell is not None and cell != "" for cell in row)
        ]

        result = TaskImportService.import_rows(actor=request.user, rows=rows)
        return Response(result)


class TaskTemplateView(generics.GenericAPIView):
    """Plantilla descargable para el importador — sub-fase 3e, igual que
    `src/app/api/tasks/template/route.ts`. Su encabezado es puramente
    decorativo — `TaskImportView` lee por posición de columna, nunca por
    nombre."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        workbook = openpyxl.Workbook()
        sheet = workbook.active
        sheet.title = "Tareas"
        sheet.append(
            [
                "Título", "Descripción", "Prioridad", "Frecuencia",
                "Fecha Inicio (Formato: YYYY-MM-DD)", "Fecha Fin (Formato: YYYY-MM-DD)",
                "Tiempo Objetivo", "Asignado a (email)", "Tipo",
            ]
        )
        sheet.append(
            [
                "Ejemplo: Informe mensual", "Descripción opcional", "ALTA", "MENSUAL",
                "2026-07-01", "2026-07-15", "8", "usuario@nexo.com", "FIJA",
            ]
        )
        for index, width in enumerate([30, 30, 15, 15, 34, 32, 18, 30, 15], start=1):
            sheet.column_dimensions[openpyxl.utils.get_column_letter(index)].width = width

        buffer = BytesIO()
        workbook.save(buffer)

        response = HttpResponse(
            buffer.getvalue(),
            content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )
        response["Content-Disposition"] = 'attachment; filename="plantilla_tareas.xlsx"'
        return response


class ActivityDetailView(generics.GenericAPIView):
    """Edición por Admin / eliminación de un registro de horas — sub-fase
    3f (ver docs/AUDIT_LOG.md § 2026-08-07), igual que
    `PATCH|DELETE /tasks/{id}/activities/{activityId}/` legacy. No es una
    acción anidada de `TaskViewSet` (2 identificadores en la URL, no un
    solo `pk`) — autorización inline porque cada método tiene una regla
    distinta (solo Admin / solo el propio autor)."""

    permission_classes = [IsAuthenticated]

    def patch(self, request, task_id, activity_id):
        if not request.user.is_superuser:
            return Response({"error": "Sin permisos"}, status=status.HTTP_403_FORBIDDEN)

        activity = generics.get_object_or_404(TaskActivity, pk=activity_id, task_id=task_id)
        serializer = AdminEditActivitySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        activity = ActivityService.admin_edit_activity(
            admin=request.user, activity=activity, **serializer.validated_data
        )
        return Response(ActivitySerializer(activity).data)

    def delete(self, request, task_id, activity_id):
        activity = generics.get_object_or_404(TaskActivity, pk=activity_id, task_id=task_id)
        if activity.author_id != request.user.id:
            return Response({"error": "Sin permiso para eliminar"}, status=status.HTTP_403_FORBIDDEN)

        ActivityService.delete_activity(activity=activity)
        return Response({"ok": True})


class ActivityCommentListCreateView(generics.GenericAPIView):
    """Hilo de comentarios sobre un registro de horas — sub-fase 3f, igual
    que `GET|POST /tasks/{id}/activities/{activityId}/comments/` legacy.
    Acceso a la tarea vía `TaskService.can_access` inline (no es una
    acción de `TaskViewSet`, no puede usar `CanAccessTask` como
    `has_object_permission`)."""

    permission_classes = [IsAuthenticated]

    def _get_activity_and_task(self, request, task_id, activity_id):
        activity = generics.get_object_or_404(TaskActivity, pk=activity_id, task_id=task_id)
        task = activity.task
        if not TaskService.can_access(actor=request.user, task=task):
            return None, None
        return activity, task

    def get(self, request, task_id, activity_id):
        activity, task = self._get_activity_and_task(request, task_id, activity_id)
        if activity is None:
            return Response({"error": "Actividad no encontrada"}, status=status.HTTP_404_NOT_FOUND)
        comments = ActivityCommentService.list_comments(activity=activity)
        return Response(ActivityCommentSerializer(comments, many=True).data)

    def post(self, request, task_id, activity_id):
        activity, task = self._get_activity_and_task(request, task_id, activity_id)
        if activity is None:
            return Response({"error": "Tarea no encontrada"}, status=status.HTTP_404_NOT_FOUND)

        serializer = ActivityCommentCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        comment = ActivityCommentService.create_comment(
            actor=request.user, activity=activity, task=task, text=serializer.validated_data["text"]
        )
        return Response(ActivityCommentSerializer(comment).data, status=status.HTTP_201_CREATED)
