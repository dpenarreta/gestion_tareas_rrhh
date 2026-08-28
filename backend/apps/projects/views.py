from django.db.models import Q
from rest_framework import generics, status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.recovery.services import RecoveryError, get_remaining_retention_time, purge_expired_items

from .models import Project, ProjectDocument, ProjectParticipant, ProjectPhase
from .permissions import (
    CanAccessProject,
    CanCreateProject,
    CanDeleteProject,
    CanManageProject,
    is_leadership,
    is_project_creator,
)
from .serializers import (
    AddParticipantSerializer,
    CommentCreateSerializer,
    ProjectActivityCreateSerializer,
    ProjectActivitySerializer,
    ProjectCommentSerializer,
    ProjectCreateSerializer,
    ProjectDetailSerializer,
    ProjectDocumentDetailSerializer,
    ProjectDocumentListSerializer,
    ProjectDocumentUploadSerializer,
    ProjectHistorySerializer,
    ProjectListSerializer,
    ProjectParticipantSerializer,
    ProjectPhaseCreateSerializer,
    ProjectPhaseSerializer,
    ProjectPhaseUpdateSerializer,
    ProjectUpdateSerializer,
)
from .services import (
    ActivityService,
    CommentService,
    DocumentService,
    ParticipantService,
    PhaseService,
    ProjectService,
)

# Mismo literal que MAX_BASE64_LENGTH en src/app/api/projects/[id]/documents/route.ts
# (~4.5MB de binario; cuerpos grandes en base64 fallan silenciosamente en
# producción — ver comentario original del TS).
MAX_BASE64_LENGTH = 6_000_000


class ProjectViewSet(viewsets.ModelViewSet):
    """Fases 5a (CRUD core), 5b (Participantes/Comentarios/Historial),
    5c (Fases), 5d (Documentos) y 5e (Actividades) de la migración de
    stack (ver docs/AUDIT_LOG.md § 2026-08-13/2026-08-14) — sin
    Papelera todavía. **Sin cutover de `route.ts`** — Next.js sigue
    sirviendo `/api/projects` desde Postgres/Prisma; esta ruta Django
    no tiene consumidor real todavía."""

    http_method_names = ["get", "post", "patch", "delete", "head", "options"]
    queryset = Project.objects.select_related("responsible", "created_by").prefetch_related(
        "participants__user", "participants__added_by"
    )

    def get_queryset(self):
        qs = self.queryset.filter(deleted_at__isnull=True)
        if self.action != "list":
            return qs
        user = self.request.user
        if is_leadership(user):
            return qs
        # Réplica del OR de `GET /api/projects` legacy — `.distinct()`
        # porque el JOIN contra `participants` (necesario para el OR)
        # puede duplicar filas cuando el usuario también es responsable/
        # creador del mismo proyecto.
        return qs.filter(
            Q(responsible=user) | Q(created_by=user) | Q(participants__user=user)
        ).distinct()

    def get_permissions(self):
        if self.action in ("create", "trash"):
            return [CanCreateProject()]
        if self.action == "destroy":
            return [CanDeleteProject()]
        if self.action in ("partial_update", "participants", "phases"):
            return [CanManageProject()]
        if self.action in ("retrieve", "comments", "history", "documents", "activities"):
            # `comments`/`documents`/`activities` usan el mismo
            # permiso que `retrieve` (`CanAccessProject`/
            # `can_view_project`) a propósito: el TS legacy exige
            # `isProjectParticipant` para postear un comentario, subir
            # un documento o registrar una actividad, pero esa
            # condición (`is_project_manager(...) or participante`) es
            # exactamente el mismo conjunto de usuarios que
            # `can_view_project` (`is_leadership or responsable/
            # creador or participante`) — verificado comparando ambas
            # fórmulas en `permissions.py`, no una relajación del
            # permiso original.
            return [CanAccessProject()]
        return super().get_permissions()

    def list(self, request, *args, **kwargs):
        projects = self.get_queryset().order_by("-created_at")
        return Response(ProjectListSerializer(projects, many=True, context={"request": request}).data)

    def retrieve(self, request, *args, **kwargs):
        project = self.get_object()
        return Response(ProjectDetailSerializer(project, context={"request": request}).data)

    def create(self, request, *args, **kwargs):
        serializer = ProjectCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        fields = dict(serializer.validated_data)
        participant_ids = fields.pop("participant_ids")
        project = ProjectService.create_project(actor=request.user, participant_ids=participant_ids, **fields)
        return Response(
            ProjectDetailSerializer(project, context={"request": request}).data,
            status=status.HTTP_201_CREATED,
        )

    def partial_update(self, request, *args, **kwargs):
        project = self.get_object()
        serializer = ProjectUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        project = ProjectService.update_project(actor=request.user, project=project, fields=dict(serializer.validated_data))
        return Response(ProjectDetailSerializer(project, context={"request": request}).data)

    def destroy(self, request, *args, **kwargs):
        project = self.get_object()
        try:
            ProjectService.soft_delete_project(actor=request.user, project=project)
        except RecoveryError as exc:
            return Response({"error": str(exc)}, status=409)
        return Response({"success": True})

    @action(detail=False, methods=["get"])
    def trash(self, request):
        """`GET /api/v1/projects/trash/` — réplica de `route.ts`
        (`src/app/api/projects/trash/route.ts`) — Fase 14 (ver
        docs/AUDIT_LOG.md § 2026-08-20). Dispara el barrido perezoso de
        purga (`purge_expired_items`, sin filtrar por tipo de entidad —
        también purga notas de Escritorio Digital vencidas, réplica
        fiel del acoplamiento incidental del TS: abrir la papelera de
        Proyectos purga la de Notas también)."""
        purge_expired_items()

        qs = Project.objects.filter(deleted_at__isnull=False).select_related("responsible", "created_by")
        if not is_leadership(request.user):
            # Sprint 2.1 §3: solo el creador puede restaurar/eliminar
            # definitivamente. Liderazgo conserva visibilidad de TODA
            # la papelera (supervisión); el resto solo ve lo que creó.
            qs = qs.filter(created_by=request.user)

        payload = []
        for project in qs.order_by("-deleted_at"):
            retention = get_remaining_retention_time("PROJECT", str(project.id))
            payload.append(
                {
                    "id": project.id,
                    "name": project.name,
                    "status": project.status,
                    "responsible": {"id": project.responsible.id, "name": project.responsible.first_name},
                    "created_by": {"id": project.created_by.id, "name": project.created_by.first_name},
                    "deleted_at": project.deleted_at,
                    "expires_at": retention["expires_at"] if retention else None,
                    "ms_remaining": retention["ms_remaining"] if retention else 0,
                    "can_delete": project.created_by_id == request.user.id,
                }
            )
        return Response(payload)

    @action(detail=True, methods=["post"])
    def restore(self, request, pk=None):
        """`POST /api/v1/projects/<id>/restore/` — réplica de
        `route.ts` (`src/app/api/projects/[id]/restore/route.ts`) —
        Fase 14 (ver docs/AUDIT_LOG.md § 2026-08-20). Chequeos
        manuales (no vía `get_permissions`/`get_object`) para preservar
        el orden exacto del TS: 404 (no existe) -> 409 (no está en la
        papelera) -> 403 (no es el creador) — un `has_object_permission`
        automático de DRF correría el 403 ANTES del 409."""
        project = Project.objects.filter(pk=pk).first()
        if project is None:
            return Response({"error": "Proyecto no encontrado"}, status=404)
        if project.deleted_at is None:
            return Response({"error": "Este proyecto no está en la papelera"}, status=409)
        if not is_project_creator(request.user, project):
            return Response({"error": "Solo el creador del proyecto puede restaurarlo"}, status=403)

        try:
            ProjectService.restore_project(actor=request.user, project=project)
        except RecoveryError as exc:
            return Response({"error": str(exc)}, status=409)
        return Response({"success": True})

    @action(detail=True, methods=["delete"])
    def permanent(self, request, pk=None):
        """`DELETE /api/v1/projects/<id>/permanent/` — réplica de
        `route.ts` (`src/app/api/projects/[id]/permanent/route.ts`) —
        Fase 14 (ver docs/AUDIT_LOG.md § 2026-08-20). Irreversible —
        ver docstring de `ProjectService.delete_project_permanently`.
        Mismo orden de chequeos manuales que `restore`."""
        project = Project.objects.filter(pk=pk).first()
        if project is None:
            return Response({"error": "Proyecto no encontrado"}, status=404)
        if project.deleted_at is None:
            return Response({"error": "Este proyecto no está en la papelera"}, status=409)
        if not is_project_creator(request.user, project):
            return Response({"error": "Solo el creador del proyecto puede eliminarlo definitivamente"}, status=403)

        try:
            ProjectService.delete_project_permanently(actor=request.user, project=project)
        except RecoveryError as exc:
            return Response({"error": str(exc)}, status=409)
        return Response({"success": True})

    @action(detail=True, methods=["get", "post"])
    def comments(self, request, pk=None):
        project = self.get_object()
        if request.method == "GET":
            comments = project.comments.select_related("author").all()
            return Response(ProjectCommentSerializer(comments, many=True).data)

        serializer = CommentCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        comment = CommentService.create_comment(project=project, author=request.user, text=serializer.validated_data["text"])
        return Response(ProjectCommentSerializer(comment).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["get"])
    def history(self, request, pk=None):
        project = self.get_object()
        return Response(ProjectHistorySerializer(project.history.select_related("actor").all(), many=True).data)

    @action(detail=True, methods=["post"])
    def participants(self, request, pk=None):
        """Réplica de `POST /api/projects/[id]/participants` — 409 si
        el usuario ya es participante (mismo status que el TS, ver
        `CloseMonthView` en `apps/tasks/views.py` para el precedente de
        409 explícito en este backend)."""
        project = self.get_object()
        serializer = AddParticipantSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.validated_data["user"]

        if ProjectParticipant.objects.filter(project=project, user=user).exists():
            return Response({"error": "Este usuario ya es participante del proyecto"}, status=status.HTTP_409_CONFLICT)

        participant = ParticipantService.add_participant(actor=request.user, project=project, user=user)
        return Response(ProjectParticipantSerializer(participant).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"])
    def phases(self, request, pk=None):
        """Réplica de `POST /api/projects/[id]/phases` — el listado ya
        viaja en el detalle (`ProjectDetailSerializer.phases`)."""
        project = self.get_object()
        serializer = ProjectPhaseCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        phase = PhaseService.create_phase(actor=request.user, project=project, **serializer.validated_data)
        return Response(ProjectPhaseSerializer(phase).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["get", "post"])
    def documents(self, request, pk=None):
        project = self.get_object()
        if request.method == "GET":
            documents = project.documents.select_related("uploaded_by").order_by("-created_at")
            return Response(ProjectDocumentListSerializer(documents, many=True).data)

        file_data = request.data.get("file_data") or ""
        if len(file_data) > MAX_BASE64_LENGTH:
            return Response({"error": "El archivo es demasiado grande (máximo ~4.5MB)"}, status=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE)

        serializer = ProjectDocumentUploadSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        document = DocumentService.upload_document(actor=request.user, project=project, **serializer.validated_data)
        return Response(ProjectDocumentDetailSerializer(document).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["get", "post"])
    def activities(self, request, pk=None):
        project = self.get_object()
        if request.method == "GET":
            activities = project.activities.select_related("author").prefetch_related("documents")
            return Response(ProjectActivitySerializer(activities, many=True).data)

        serializer = ProjectActivityCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        activity = ActivityService.create_activity(actor=request.user, project=project, **serializer.validated_data)
        return Response(ProjectActivitySerializer(activity).data, status=status.HTTP_201_CREATED)


class ParticipantDetailView(generics.GenericAPIView):
    """`DELETE /api/v1/projects/<project_id>/participants/<participant_id>/`
    — Fase 5b (ver docs/AUDIT_LOG.md § 2026-08-13). No es una acción
    anidada de `ProjectViewSet` (2 identificadores en la URL, no un
    solo `pk`) — mismo patrón que `ActivityDetailView` en
    `apps/tasks/views.py`."""

    permission_classes = [IsAuthenticated]

    def delete(self, request, project_id, participant_id):
        project = generics.get_object_or_404(Project, pk=project_id, deleted_at__isnull=True)
        if not CanManageProject().has_object_permission(request, self, project):
            return Response({"error": "No tienes permiso para quitar participantes"}, status=status.HTTP_403_FORBIDDEN)

        participant = generics.get_object_or_404(ProjectParticipant, pk=participant_id, project_id=project_id)
        if participant.user_id == project.responsible_id:
            return Response(
                {"error": "No puedes quitar al responsable principal — cambia el responsable primero"},
                status=status.HTTP_409_CONFLICT,
            )

        ParticipantService.remove_participant(actor=request.user, project=project, participant=participant)
        return Response({"success": True})


class PhaseDetailView(generics.GenericAPIView):
    """`PATCH|DELETE /api/v1/projects/<project_id>/phases/<phase_id>/`
    — Fase 5c (ver docs/AUDIT_LOG.md § 2026-08-13). Mismo patrón que
    `ParticipantDetailView`/`ActivityDetailView`: 2 identificadores en
    la URL, no una acción anidada de un solo `pk`."""

    permission_classes = [IsAuthenticated]

    def _load_project_and_phase(self, project_id, phase_id):
        project = generics.get_object_or_404(Project, pk=project_id, deleted_at__isnull=True)
        phase = generics.get_object_or_404(ProjectPhase, pk=phase_id, project_id=project_id)
        return project, phase

    def patch(self, request, project_id, phase_id):
        project, phase = self._load_project_and_phase(project_id, phase_id)
        if not CanManageProject().has_object_permission(request, self, project):
            return Response({"error": "No tienes permiso para modificar fases"}, status=status.HTTP_403_FORBIDDEN)

        serializer = ProjectPhaseUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        phase = PhaseService.update_phase(actor=request.user, project=project, phase=phase, fields=dict(serializer.validated_data))
        return Response(ProjectPhaseSerializer(phase).data)

    def delete(self, request, project_id, phase_id):
        project, phase = self._load_project_and_phase(project_id, phase_id)
        if not CanManageProject().has_object_permission(request, self, project):
            return Response({"error": "No tienes permiso para eliminar fases"}, status=status.HTTP_403_FORBIDDEN)

        PhaseService.delete_phase(actor=request.user, project=project, phase=phase)
        return Response({"success": True})


class DocumentDetailView(generics.GenericAPIView):
    """`GET /api/v1/projects/<project_id>/documents/<document_id>/`
    — Fase 5d (ver docs/AUDIT_LOG.md § 2026-08-13). Mismo patrón que
    `ParticipantDetailView`/`PhaseDetailView`: 2 identificadores en la
    URL, no una acción anidada de un solo `pk`."""

    permission_classes = [IsAuthenticated]

    def get(self, request, project_id, document_id):
        project = generics.get_object_or_404(Project, pk=project_id, deleted_at__isnull=True)
        if not CanAccessProject().has_object_permission(request, self, project):
            return Response({"error": "No tienes acceso a este proyecto"}, status=status.HTTP_403_FORBIDDEN)

        document = generics.get_object_or_404(ProjectDocument, pk=document_id, project_id=project_id)
        return Response(ProjectDocumentDetailSerializer(document).data)
