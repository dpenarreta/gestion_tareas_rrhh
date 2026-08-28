"""Serializers del módulo Proyectos — Fases 5a-5f (ver
docs/AUDIT_LOG.md § 2026-08-13/2026-08-14). `ProjectUserRefSerializer`
duplica `TaskUserRefSerializer` (`apps/tasks/serializers.py`) en vez de
importarla — mismo criterio que el resto del backend: `apps.projects`
no depende de `apps.tasks`, cada app feature es independiente (solo
comparten modelos de `apps.users`/`apps.tasks.models.Task.Priority`,
nunca serializers/vistas)."""

from rest_framework import serializers

from apps.tasks.models import Task
from apps.users.models import User

from .models import (
    Project,
    ProjectActivity,
    ProjectComment,
    ProjectDocument,
    ProjectHistory,
    ProjectParticipant,
    ProjectPhase,
)


class ProjectUserRefSerializer(serializers.ModelSerializer):
    """Referencia mínima a un usuario dentro de un proyecto (responsible/
    created_by/participant.user/participant.added_by). `roles` — Fase 5f
    (ver docs/AUDIT_LOG.md § 2026-08-14): gap cerrado antes del cutover
    de `route.ts`, mismo patrón que `apps.tasks.serializers.
    TaskUserRefSerializer` (duplicado, no importado — ver docstring de
    módulo)."""

    roles = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ["id", "username", "first_name", "email", "roles"]
        read_only_fields = fields

    def get_roles(self, obj: User) -> list[dict]:
        return [{"id": group.id, "name": group.name} for group in obj.groups.all()]


class ProjectParticipantSerializer(serializers.ModelSerializer):
    user = ProjectUserRefSerializer(read_only=True)
    added_by = ProjectUserRefSerializer(read_only=True)

    class Meta:
        model = ProjectParticipant
        fields = ["id", "user", "added_by", "added_at"]
        read_only_fields = fields


class ProjectPhaseSerializer(serializers.ModelSerializer):
    """Réplica de `phaseSelect` — Fase 5c (ver docs/AUDIT_LOG.md §
    2026-08-13). `registered_minutes`/`participants` — réplica de
    `getPhaseStats` (`projectPhaseStats.ts`) desde la Fase 5e (ver
    docs/AUDIT_LOG.md § 2026-08-14): "participantes de una fase" no es
    una relación propia, se deriva de quién registró al menos una
    actividad ahí — mismo criterio que "participante de proyecto"."""

    responsible = ProjectUserRefSerializer(read_only=True)
    registered_minutes = serializers.SerializerMethodField()
    participants = serializers.SerializerMethodField()

    class Meta:
        model = ProjectPhase
        fields = [
            "id", "name", "status", "responsible", "start_date", "target_date",
            "progress", "notes", "target_time_hours", "order", "registered_minutes", "participants",
        ]
        read_only_fields = fields

    def get_registered_minutes(self, obj: ProjectPhase) -> int:
        return sum(a.duration for a in obj.activities.all())

    def get_participants(self, obj: ProjectPhase) -> list:
        seen: dict[int, str] = {}
        for activity in obj.activities.all():
            seen.setdefault(activity.author_id, activity.author.first_name or activity.author.username)
        return [{"id": user_id, "name": name} for user_id, name in seen.items()]


class ProjectListSerializer(serializers.ModelSerializer):
    """Réplica de `projectListSelect` — sin `observations` (solo en el
    detalle). `phase_count`/`comment_count`/`document_count` — Fase 5f
    (ver docs/AUDIT_LOG.md § 2026-08-14): gap cerrado antes del cutover
    de `route.ts` (los 3 modelos ya estaban portados desde 5b-5d, solo
    faltaba exponer el conteo)."""

    responsible = ProjectUserRefSerializer(read_only=True)
    created_by = ProjectUserRefSerializer(read_only=True)
    participant_count = serializers.SerializerMethodField()
    phase_count = serializers.SerializerMethodField()
    comment_count = serializers.SerializerMethodField()
    document_count = serializers.SerializerMethodField()

    class Meta:
        model = Project
        fields = [
            "id", "name", "description", "status", "priority", "area", "tags",
            "start_date", "target_date", "target_time_hours", "real_hours", "completed_at",
            "responsible", "created_by", "participant_count", "phase_count", "comment_count",
            "document_count", "created_at", "updated_at",
        ]
        read_only_fields = fields

    def get_participant_count(self, obj: Project) -> int:
        return obj.participants.count()

    def get_phase_count(self, obj: Project) -> int:
        return obj.phases.count()

    def get_comment_count(self, obj: Project) -> int:
        return obj.comments.count()

    def get_document_count(self, obj: Project) -> int:
        return obj.documents.count()


class ProjectDetailSerializer(ProjectListSerializer):
    """Agrega `observations`, `participants`, `phases`, `last_activity`
    y `activity_count` completos. `last_activity`/`activity_count` —
    réplica de `getLastActivity` (`projectPhaseStats.ts`); `_count` del
    TS en el detalle es `{comments,documents,activities}` —
    `comment_count`/`document_count` ya vienen heredados de
    `ProjectListSerializer` (Fase 5f, ver docs/AUDIT_LOG.md §
    2026-08-14)."""

    participants = ProjectParticipantSerializer(many=True, read_only=True)
    phases = ProjectPhaseSerializer(many=True, read_only=True)
    last_activity = serializers.SerializerMethodField()
    activity_count = serializers.SerializerMethodField()

    class Meta(ProjectListSerializer.Meta):
        fields = ProjectListSerializer.Meta.fields + [
            "observations", "participants", "phases", "last_activity", "activity_count",
        ]
        read_only_fields = fields

    def get_last_activity(self, obj: Project) -> dict | None:
        last = obj.activities.select_related("author").order_by("-created_at").first()
        if not last:
            return None
        return {"author_name": last.author.first_name or last.author.username, "created_at": last.created_at}

    def get_activity_count(self, obj: Project) -> int:
        return obj.activities.count()


class ProjectCreateSerializer(serializers.Serializer):
    """Mismos campos requeridos que `POST /api/projects` (TS)."""

    name = serializers.CharField(max_length=255)
    description = serializers.CharField(required=False, allow_blank=True, default="")
    responsible = serializers.PrimaryKeyRelatedField(queryset=User.objects.all())
    participant_ids = serializers.ListField(child=serializers.IntegerField(), required=False, default=list)
    start_date = serializers.DateTimeField()
    target_date = serializers.DateTimeField()
    status = serializers.ChoiceField(choices=Project.Status.choices, required=False, default=Project.Status.PENDIENTE)
    priority = serializers.ChoiceField(choices=Task.Priority.choices)
    target_time_hours = serializers.FloatField(min_value=0.01)
    tags = serializers.ListField(child=serializers.CharField(), required=False, default=list)
    area = serializers.CharField(required=False, allow_blank=True, default="")
    observations = serializers.CharField(required=False, allow_blank=True, default="")

    def validate_name(self, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise serializers.ValidationError("Faltan campos requeridos")
        return stripped

    def validate_tags(self, value: list) -> list:
        return [t.strip() for t in value if isinstance(t, str) and t.strip()]


class ProjectUpdateSerializer(serializers.Serializer):
    """Todos los campos opcionales — réplica de `PATCH /api/projects/[id]`."""

    name = serializers.CharField(max_length=255, required=False)
    description = serializers.CharField(required=False, allow_blank=True)
    area = serializers.CharField(required=False, allow_blank=True)
    tags = serializers.ListField(child=serializers.CharField(), required=False)
    observations = serializers.CharField(required=False, allow_blank=True)
    start_date = serializers.DateTimeField(required=False)
    target_date = serializers.DateTimeField(required=False)
    target_time_hours = serializers.FloatField(min_value=0.01, required=False)
    priority = serializers.ChoiceField(choices=Task.Priority.choices, required=False)
    status = serializers.ChoiceField(choices=Project.Status.choices, required=False)
    responsible = serializers.PrimaryKeyRelatedField(queryset=User.objects.all(), required=False)

    def validate_name(self, value: str) -> str:
        return value.strip()

    def validate_tags(self, value: list) -> list:
        return [t.strip() for t in value if isinstance(t, str) and t.strip()]


# ── Fase 5b (ver docs/AUDIT_LOG.md § 2026-08-13) — Participantes/Comentarios/Historial ──


class ProjectCommentSerializer(serializers.ModelSerializer):
    author = ProjectUserRefSerializer(read_only=True)

    class Meta:
        model = ProjectComment
        fields = ["id", "text", "author", "created_at"]
        read_only_fields = fields


class CommentCreateSerializer(serializers.Serializer):
    text = serializers.CharField()

    def validate_text(self, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise serializers.ValidationError("El comentario no puede estar vacío")
        return stripped


class ProjectHistorySerializer(serializers.ModelSerializer):
    actor = ProjectUserRefSerializer(read_only=True)

    class Meta:
        model = ProjectHistory
        fields = ["id", "event", "description", "previous_value", "new_value", "actor", "created_at"]
        read_only_fields = fields


class AddParticipantSerializer(serializers.Serializer):
    """`user` ya validado como existente por `PrimaryKeyRelatedField` —
    réplica de `POST /participants` (que valida `userId` inválido con
    400 "Usuario inválido")."""

    user = serializers.PrimaryKeyRelatedField(queryset=User.objects.all())


# ── Fase 5c (ver docs/AUDIT_LOG.md § 2026-08-13) — Fases ──────────────────────


class ProjectPhaseCreateSerializer(serializers.Serializer):
    """Réplica de `POST /phases` — `order` lo calcula `PhaseService`,
    no viene del cliente."""

    name = serializers.CharField(max_length=255)
    status = serializers.ChoiceField(choices=Task.Status.choices, required=False, default=Task.Status.PENDIENTE)
    responsible = serializers.PrimaryKeyRelatedField(queryset=User.objects.all(), required=False, allow_null=True, default=None)
    start_date = serializers.DateTimeField(required=False, allow_null=True, default=None)
    target_date = serializers.DateTimeField(required=False, allow_null=True, default=None)
    target_time_hours = serializers.FloatField(required=False, allow_null=True, default=None)
    notes = serializers.CharField(required=False, allow_blank=True, default="")

    def validate_name(self, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise serializers.ValidationError("El nombre de la fase es requerido")
        return stripped


class ProjectPhaseUpdateSerializer(serializers.Serializer):
    """Todos los campos opcionales — réplica de `PATCH /phases/[phaseId]`."""

    name = serializers.CharField(max_length=255, required=False)
    status = serializers.ChoiceField(choices=Task.Status.choices, required=False)
    responsible = serializers.PrimaryKeyRelatedField(queryset=User.objects.all(), required=False, allow_null=True)
    start_date = serializers.DateTimeField(required=False, allow_null=True)
    target_date = serializers.DateTimeField(required=False, allow_null=True)
    target_time_hours = serializers.FloatField(required=False, allow_null=True)
    notes = serializers.CharField(required=False, allow_blank=True)
    progress = serializers.IntegerField(required=False, min_value=0, max_value=100)

    def validate_name(self, value: str) -> str:
        return value.strip()


# ── Fase 5d (ver docs/AUDIT_LOG.md § 2026-08-13) — Documentos ──────────────────


class ProjectDocumentListSerializer(serializers.ModelSerializer):
    """Réplica de `documentSelect` — SIN `file_data` (la lista nunca
    trae el binario, mismo criterio que el TS). `activity_id` llegó en
    la Fase 5e (ver docs/AUDIT_LOG.md § 2026-08-14) — 5d lo dejó
    diferido porque `ProjectActivity` no existía todavía."""

    uploaded_by = ProjectUserRefSerializer(read_only=True)
    activity_id = serializers.IntegerField(read_only=True)

    class Meta:
        model = ProjectDocument
        fields = [
            "id", "category", "file_name", "mime_type", "version", "previous_version_id",
            "activity_id", "uploaded_by", "created_at",
        ]
        read_only_fields = fields


class ProjectDocumentDetailSerializer(ProjectDocumentListSerializer):
    """Agrega `file_data` — réplica del `select` de
    `GET /documents/[documentId]`."""

    class Meta(ProjectDocumentListSerializer.Meta):
        fields = ProjectDocumentListSerializer.Meta.fields + ["file_data"]
        read_only_fields = fields


class ProjectDocumentUploadSerializer(serializers.Serializer):
    """Réplica de `POST /documents`. `previous_version_id` es un
    `IntegerField` (no `PrimaryKeyRelatedField`) porque es una
    referencia SUELTA — `DocumentService` valida su existencia (y
    devuelve el mismo 400 "Versión anterior inválida" que el TS).
    `activity` (Fase 5e) SÍ es `PrimaryKeyRelatedField` — es una FK
    real; `DocumentService` valida que pertenezca al mismo proyecto."""

    file_name = serializers.CharField(max_length=255)
    mime_type = serializers.CharField(required=False, allow_blank=True, default="")
    file_data = serializers.CharField()
    category = serializers.ChoiceField(choices=ProjectDocument.Category.choices, required=False, default=ProjectDocument.Category.OTRO)
    previous_version_id = serializers.IntegerField(required=False, allow_null=True, default=None)
    activity = serializers.PrimaryKeyRelatedField(queryset=ProjectActivity.objects.all(), required=False, allow_null=True, default=None)

    def validate_file_name(self, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise serializers.ValidationError("Faltan campos requeridos")
        return stripped

    def validate_file_data(self, value: str) -> str:
        if not value:
            raise serializers.ValidationError("Faltan campos requeridos")
        return value


# ── Fase 5e (ver docs/AUDIT_LOG.md § 2026-08-14) — Actividades ─────────────────


class ProjectActivityDocumentSerializer(serializers.ModelSerializer):
    """Referencia mínima a un documento dentro de una actividad —
    réplica del `documents: { select: {...} }` anidado de
    `activitySelect`."""

    class Meta:
        model = ProjectDocument
        fields = ["id", "file_name", "category", "mime_type"]
        read_only_fields = fields


class ProjectActivitySerializer(serializers.ModelSerializer):
    """Réplica de `activitySelect`."""

    author = ProjectUserRefSerializer(read_only=True)
    documents = ProjectActivityDocumentSerializer(many=True, read_only=True)
    phase_id = serializers.IntegerField(read_only=True)

    class Meta:
        model = ProjectActivity
        fields = [
            "id", "phase_id", "description", "comments", "start_time", "end_time",
            "duration", "is_retroactive", "activity_date", "author", "created_at", "documents",
        ]
        read_only_fields = fields


class ProjectActivityCreateSerializer(serializers.Serializer):
    """Réplica de `POST /activities`. `activity_date` es un
    `CharField` (no `DateField` de DRF) — se parsea con
    `parse_date_only` dentro de `ActivityService`, para preservar el
    mensaje de error exacto del TS ("Fecha inválida") en vez del
    genérico de DRF."""

    description = serializers.CharField()
    comments = serializers.CharField(required=False, allow_blank=True, default="")
    start_time = serializers.CharField()
    end_time = serializers.CharField()
    phase = serializers.PrimaryKeyRelatedField(queryset=ProjectPhase.objects.all(), required=False, allow_null=True, default=None)
    activity_date = serializers.CharField(required=False, allow_null=True, default=None, source="activity_date_raw")
