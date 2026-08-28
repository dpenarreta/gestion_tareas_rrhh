from rest_framework import serializers

from apps.hierarchy.services import ALL_ROLES
from apps.users.models import User

from .models import (
    ActivityComment,
    ActivityReason,
    Comment,
    EndDateAuditLog,
    TargetTimeAuditLog,
    Task,
    TaskActivity,
    TaskCommentView,
)


class TaskUserRefSerializer(serializers.ModelSerializer):
    """Referencia mínima a un usuario dentro de una tarea (assigned_to/
    created_by/author) — evita serializar el User completo. `roles` es una
    lista (no un solo valor) porque así vive en Django (`auth.Group`
    M2M); el invariante de "1 rol por usuario" lo garantiza Nexo, no el
    modelo — ver apps/hierarchy/services.py del backend."""

    roles = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ["id", "username", "first_name", "email", "roles"]
        read_only_fields = fields

    def get_roles(self, obj) -> list[dict]:
        return [{"id": group.id, "name": group.name} for group in obj.groups.all()]


class TaskListSerializer(serializers.ModelSerializer):
    assigned_to = TaskUserRefSerializer(read_only=True)
    created_by = TaskUserRefSerializer(read_only=True)
    comment_count = serializers.SerializerMethodField()
    has_unread_comments = serializers.SerializerMethodField()

    class Meta:
        model = Task
        fields = [
            "id", "title", "description", "type", "status", "priority", "frequency",
            "start_date", "end_date", "estimated_hours", "real_hours",
            "target_time_validated", "progress", "color", "corrected",
            "assigned_to", "created_by", "comment_count", "has_unread_comments",
            "created_at", "updated_at",
        ]
        read_only_fields = fields

    def get_comment_count(self, obj: Task) -> int:
        return obj.comments.count()

    def get_has_unread_comments(self, obj: Task) -> bool:
        request = self.context.get("request")
        if request is None or not request.user.is_authenticated:
            return False
        view = TaskCommentView.objects.filter(task=obj, user=request.user).first()
        last_viewed = view.updated_at if view else None
        others_comments = obj.comments.exclude(author=request.user)
        if last_viewed is None:
            return others_comments.exists()
        return others_comments.filter(created_at__gt=last_viewed).exists()


class TaskCreateSerializer(serializers.Serializer):
    """Mismos campos requeridos que `src/app/api/tasks/route.ts` (POST)."""

    title = serializers.CharField(max_length=255)
    description = serializers.CharField(required=False, allow_blank=True, default="")
    priority = serializers.ChoiceField(choices=Task.Priority.choices)
    frequency = serializers.ChoiceField(choices=Task.Frequency.choices)
    type = serializers.ChoiceField(choices=Task.Type.choices, required=False, default=Task.Type.FIJA)
    start_date = serializers.DateTimeField()
    end_date = serializers.DateTimeField()
    estimated_hours = serializers.FloatField(min_value=0)
    assigned_to = serializers.PrimaryKeyRelatedField(queryset=User.objects.all())
    status = serializers.ChoiceField(choices=Task.Status.choices, required=False, default=Task.Status.PENDIENTE)


class TaskUpdateSerializer(serializers.Serializer):
    """Todos los campos opcionales — el servicio decide cuáles de los
    presentes puede tocar el actor (ver `services.py::update_task`)."""

    title = serializers.CharField(max_length=255, required=False)
    description = serializers.CharField(required=False, allow_blank=True)
    type = serializers.ChoiceField(choices=Task.Type.choices, required=False)
    priority = serializers.ChoiceField(choices=Task.Priority.choices, required=False)
    frequency = serializers.ChoiceField(choices=Task.Frequency.choices, required=False)
    start_date = serializers.DateTimeField(required=False)
    end_date = serializers.DateTimeField(required=False)
    estimated_hours = serializers.FloatField(min_value=0, required=False)
    assigned_to = serializers.PrimaryKeyRelatedField(queryset=User.objects.all(), required=False)
    real_hours = serializers.FloatField(min_value=0, required=False)
    color = serializers.CharField(required=False, allow_blank=True)
    status = serializers.ChoiceField(choices=Task.Status.choices, required=False)


class CommentSerializer(serializers.ModelSerializer):
    author = TaskUserRefSerializer(read_only=True)

    class Meta:
        model = Comment
        fields = ["id", "task", "author", "text", "created_at"]
        read_only_fields = fields


class CommentCreateSerializer(serializers.Serializer):
    text = serializers.CharField()


class ActivitySerializer(serializers.ModelSerializer):
    author = TaskUserRefSerializer(read_only=True)
    comment_count = serializers.SerializerMethodField()

    class Meta:
        model = TaskActivity
        fields = [
            "id", "task", "author", "reason", "start_time", "end_time", "duration",
            "description", "is_retroactive", "activity_date", "admin_comment",
            "modified_by_admin", "modified_at", "comment_count", "created_at",
        ]
        read_only_fields = fields

    def get_comment_count(self, obj: TaskActivity) -> int:
        return obj.comments.count()


class ActivityCreateSerializer(serializers.Serializer):
    reason = serializers.CharField()
    hours = serializers.IntegerField(min_value=0, max_value=23)
    minutes = serializers.IntegerField(min_value=0, max_value=59)
    description = serializers.CharField(required=False, allow_blank=True, default="")
    start_time = serializers.CharField(required=False, allow_null=True, default=None)
    end_time = serializers.CharField(required=False, allow_null=True, default=None)


class RetroactiveActivityCreateSerializer(serializers.Serializer):
    """Sub-fase 3f (ver docs/AUDIT_LOG.md § 2026-08-07) — a diferencia de
    `ActivityCreateSerializer`, `description` es obligatoria y agrega
    `activity_date` (fecha del día que se registra retroactivamente)."""

    reason = serializers.CharField()
    hours = serializers.IntegerField(min_value=0, max_value=23)
    minutes = serializers.IntegerField(min_value=0, max_value=59)
    description = serializers.CharField()
    activity_date = serializers.CharField(source="activity_date_raw")
    start_time = serializers.CharField(required=False, allow_null=True, default=None)
    end_time = serializers.CharField(required=False, allow_null=True, default=None)


class AdminEditActivitySerializer(serializers.Serializer):
    hours = serializers.IntegerField(min_value=0, max_value=23)
    minutes = serializers.IntegerField(min_value=0, max_value=59)
    comment = serializers.CharField()


class ActivityCommentSerializer(serializers.ModelSerializer):
    author = TaskUserRefSerializer(read_only=True)

    class Meta:
        model = ActivityComment
        fields = ["id", "activity", "author", "text", "created_at"]
        read_only_fields = fields


class ActivityCommentCreateSerializer(serializers.Serializer):
    text = serializers.CharField()


class ActivityReasonSerializer(serializers.ModelSerializer):
    class Meta:
        model = ActivityReason
        fields = [
            "id", "key", "label", "description", "is_active", "is_archived",
            "archived_at", "assigned_roles", "created_at", "updated_at",
        ]
        read_only_fields = fields


class ActivityReasonCreateSerializer(serializers.Serializer):
    """Réplica de la validación inline de `POST
    /api/settings/activity-reasons` — Fase 30 (ver docs/AUDIT_LOG.md §
    2026-08-21)."""

    label = serializers.CharField(allow_blank=False)
    description = serializers.CharField(required=False, allow_null=True, allow_blank=True)
    assigned_roles = serializers.ListField(
        child=serializers.ChoiceField(choices=ALL_ROLES), allow_empty=False
    )


class ActivityReasonUpdateSerializer(serializers.Serializer):
    """Réplica de la validación inline de `PATCH
    /api/settings/activity-reasons/<id>` — Fase 30. Todos los campos
    opcionales (solo se actualiza lo presente, mismo criterio que
    `TaskUpdateSerializer`)."""

    label = serializers.CharField(allow_blank=False, required=False)
    description = serializers.CharField(required=False, allow_null=True, allow_blank=True)
    assigned_roles = serializers.ListField(
        child=serializers.ChoiceField(choices=ALL_ROLES), allow_empty=False, required=False
    )
    is_active = serializers.BooleanField(required=False)
    is_archived = serializers.BooleanField(required=False)


class TargetTimeAuditLogSerializer(serializers.ModelSerializer):
    user = TaskUserRefSerializer(read_only=True)

    class Meta:
        model = TargetTimeAuditLog
        fields = [
            "id", "user", "user_role", "previous_value", "new_value",
            "reason", "reason_detail", "created_at",
        ]
        read_only_fields = fields


class TargetTimeValidateSerializer(serializers.Serializer):
    new_value = serializers.FloatField(min_value=0.01)
    reason = serializers.ChoiceField(choices=TargetTimeAuditLog.Reason.choices)
    reason_detail = serializers.CharField(required=False, allow_null=True, allow_blank=True, default=None)

    def validate(self, attrs):
        if attrs["reason"] == TargetTimeAuditLog.Reason.OTRO and not attrs.get("reason_detail"):
            raise serializers.ValidationError(
                {"reason_detail": ["Debes indicar el detalle cuando el motivo es \"Otro\"."]}
            )
        return attrs


class TargetTimeBulkValidateSerializer(serializers.Serializer):
    """Sub-fase 3c-bulk (ver docs/AUDIT_LOG.md § 2026-08-07): mismo
    `new_value`/`reason`/`reason_detail` aplicado a TODAS las tareas de
    `task_ids` — no hay valores por tarea, igual que el legacy."""

    task_ids = serializers.ListField(child=serializers.IntegerField(), allow_empty=False)
    new_value = serializers.FloatField(min_value=0.01)
    reason = serializers.ChoiceField(choices=TargetTimeAuditLog.Reason.choices)
    reason_detail = serializers.CharField(required=False, allow_null=True, allow_blank=True, default=None)

    def validate(self, attrs):
        if attrs["reason"] == TargetTimeAuditLog.Reason.OTRO and not attrs.get("reason_detail"):
            raise serializers.ValidationError(
                {"reason_detail": ["Debes indicar el detalle cuando el motivo es \"Otro\"."]}
            )
        return attrs


class EndDateAuditLogSerializer(serializers.ModelSerializer):
    user = TaskUserRefSerializer(read_only=True)

    class Meta:
        model = EndDateAuditLog
        fields = ["id", "user", "user_role", "action", "previous_value", "new_value", "observaciones", "created_at"]
        read_only_fields = fields


# Decisión que pide el líder (verbo) — distinto de `EndDateAuditLog.Action`
# (el evento resultante, ya registrado en el log). Mismos 3 valores que
# `EndDateAction`/`END_DATE_ACTIONS` en `src/lib/endDate.ts`.
END_DATE_DECISION_CHOICES = (
    ("APROBAR", "APROBAR"),
    ("MODIFICAR", "MODIFICAR"),
    ("RECHAZAR", "RECHAZAR"),
)


class EndDateActionSerializer(serializers.Serializer):
    action = serializers.ChoiceField(choices=END_DATE_DECISION_CHOICES)
    new_end_date = serializers.DateTimeField(required=False, allow_null=True, default=None)
    observaciones = serializers.CharField(required=False, allow_null=True, allow_blank=True, default=None)

    def validate(self, attrs):
        if attrs["action"] == "MODIFICAR" and not attrs.get("new_end_date"):
            raise serializers.ValidationError(
                {"new_end_date": ["Requerido cuando la acción es \"MODIFICAR\"."]}
            )
        return attrs


class EndDateBulkApproveItemSerializer(serializers.Serializer):
    """Sub-fase 3c-bulk: sin `new_end_date` → aprobación simple; con
    `new_end_date` el servicio decide APROBAR/MODIFICAR según difiera o
    no de la fecha vigente — ver `EndDateService.bulk_approve`."""

    task_id = serializers.IntegerField()
    new_end_date = serializers.DateTimeField(required=False, allow_null=True, default=None)


class EndDateBulkApproveSerializer(serializers.Serializer):
    items = EndDateBulkApproveItemSerializer(many=True, allow_empty=False)
    observaciones = serializers.CharField(required=False, allow_null=True, allow_blank=True, default=None)


class CorrectTaskSerializer(serializers.Serializer):
    """Corrección de Admin sobre una tarea archivada — sub-fase 3d (ver
    docs/AUDIT_LOG.md § 2026-08-07). Ambos campos opcionales; el servicio
    decide qué constituye un cambio real (ver
    `MonthClosureService.correct_archived_task`)."""

    real_hours = serializers.FloatField(min_value=0, required=False, default=None, allow_null=True)
    status = serializers.ChoiceField(choices=Task.Status.choices, required=False, default=None, allow_null=True)

    def validate(self, attrs):
        if attrs.get("real_hours") is None and attrs.get("status") is None:
            raise serializers.ValidationError({"non_field_errors": ["Nada que corregir"]})
        return attrs


class PendingTaskSerializer(serializers.ModelSerializer):
    """Pantalla combinada de pendientes (sub-fase 3c-bulk) — igual forma
    que cada item de `getPendingTaskValidations` legacy."""

    assigned_to = TaskUserRefSerializer(read_only=True)

    class Meta:
        model = Task
        fields = [
            "id", "title", "status", "type", "priority", "start_date",
            "estimated_hours", "real_hours", "target_time_validated",
            "end_date", "end_date_approval_status", "archived_month", "assigned_to",
        ]
        read_only_fields = fields
