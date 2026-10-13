"""Validación de entrada y serialización de salida del módulo."""

from rest_framework import serializers

from .models import Collaborator, ImportBatch, NovedadEvent, OvertimeRecord, PermissionOverride
from .services import _fmt, user_display


class CollaboratorSerializer(serializers.ModelSerializer):
    supervisor_id = serializers.IntegerField(source="current_supervisor_id", read_only=True)
    supervisor_name = serializers.SerializerMethodField()
    status_label = serializers.CharField(source="get_status_display", read_only=True)

    class Meta:
        model = Collaborator
        fields = [
            "id",
            "cedula",
            "full_name",
            "regional",
            "area",
            "cargo",
            "status",
            "status_label",
            "supervisor_id",
            "supervisor_name",
            "created_at",
            "updated_at",
        ]
        read_only_fields = fields

    def get_supervisor_name(self, obj) -> str:
        return user_display(obj.current_supervisor)


class CollaboratorCreateSerializer(serializers.Serializer):
    cedula = serializers.CharField(max_length=20)
    full_name = serializers.CharField(max_length=200)
    regional = serializers.CharField(max_length=100, required=False, allow_blank=True, default="")
    area = serializers.CharField(max_length=100, required=False, allow_blank=True, default="")
    cargo = serializers.CharField(max_length=100, required=False, allow_blank=True, default="")
    supervisor_id = serializers.IntegerField(required=False, allow_null=True)


class CollaboratorUpdateSerializer(serializers.Serializer):
    full_name = serializers.CharField(max_length=200, required=False)
    regional = serializers.CharField(max_length=100, required=False, allow_blank=True)
    area = serializers.CharField(max_length=100, required=False, allow_blank=True)
    cargo = serializers.CharField(max_length=100, required=False, allow_blank=True)


class StatusChangeSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=Collaborator.Status.choices)
    reason = serializers.CharField(max_length=500, required=False, allow_blank=True, default="")


class ReassignSerializer(serializers.Serializer):
    supervisor_id = serializers.IntegerField()
    reason = serializers.CharField(max_length=500)


class CellSerializer(serializers.Serializer):
    collaborator_id = serializers.IntegerField()
    date = serializers.DateField()
    hours = serializers.CharField(required=False, allow_null=True, allow_blank=True)
    version = serializers.IntegerField(required=False, allow_null=True)


class SaveCellsSerializer(serializers.Serializer):
    period = serializers.CharField()
    supervisor_id = serializers.IntegerField(required=False, allow_null=True)
    cells = CellSerializer(many=True, allow_empty=False)

    def validate_cells(self, value):
        if len(value) > 5000:
            raise serializers.ValidationError("Demasiadas celdas en un solo guardado.")
        return value


class OvertimeWriteSerializer(serializers.Serializer):
    collaborator_id = serializers.IntegerField(required=False)
    date = serializers.DateField(required=False)
    overtime_hours = serializers.CharField(required=False, allow_null=True, allow_blank=True)
    saturday_hours = serializers.CharField(required=False, allow_null=True, allow_blank=True)
    is_saturday = serializers.BooleanField(required=False, allow_null=True, default=None)
    is_sunday = serializers.BooleanField(required=False, allow_null=True, default=None)
    is_holiday = serializers.BooleanField(required=False, allow_null=True, default=None)
    work_done = serializers.CharField(max_length=500, required=False, allow_blank=True)
    observations = serializers.CharField(max_length=1000, required=False, allow_blank=True)
    version = serializers.IntegerField(required=False, allow_null=True)


class BulkOvertimeRowSerializer(serializers.Serializer):
    """Fila de la captura masiva. De la identidad solo viaja el id del
    colaborador: cédula, nombre, regional, área, cargo y supervisor se leen
    de la base en el servidor."""

    client_key = serializers.CharField(max_length=64)
    id = serializers.IntegerField(required=False, allow_null=True)
    version = serializers.IntegerField(required=False, allow_null=True)
    collaborator_id = serializers.IntegerField(required=False, allow_null=True)
    date = serializers.DateField(required=False, allow_null=True)
    overtime_hours = serializers.CharField(required=False, allow_null=True, allow_blank=True)
    saturday_hours = serializers.CharField(required=False, allow_null=True, allow_blank=True)
    is_saturday = serializers.BooleanField(required=False, allow_null=True, default=None)
    is_sunday = serializers.BooleanField(required=False, allow_null=True, default=None)
    is_holiday = serializers.BooleanField(required=False, allow_null=True, default=None)
    work_done = serializers.CharField(required=False, allow_blank=True, default="")
    observations = serializers.CharField(required=False, allow_blank=True, default="")


class BulkOvertimeSerializer(serializers.Serializer):
    period = serializers.CharField()
    rows = BulkOvertimeRowSerializer(many=True, allow_empty=False)


class OvertimeRecordSerializer(serializers.ModelSerializer):
    cedula = serializers.CharField(source="collaborator.cedula")
    full_name = serializers.CharField(source="collaborator.full_name")
    regional = serializers.CharField(source="collaborator.regional")
    area = serializers.CharField(source="collaborator.area")
    cargo = serializers.CharField(source="collaborator.cargo")
    supervisor_name = serializers.SerializerMethodField()
    period = serializers.CharField(source="period.code")
    overtime_hours = serializers.SerializerMethodField()
    saturday_hours = serializers.SerializerMethodField()
    created_by_name = serializers.SerializerMethodField()
    updated_by_name = serializers.SerializerMethodField()

    class Meta:
        model = OvertimeRecord
        fields = [
            "id",
            "collaborator_id",
            "date",
            "cedula",
            "full_name",
            "regional",
            "area",
            "cargo",
            "supervisor_id",
            "supervisor_name",
            "period",
            "overtime_hours",
            "saturday_hours",
            "is_saturday",
            "is_sunday",
            "is_holiday",
            "work_done",
            "observations",
            "version",
            "created_by_name",
            "updated_by_name",
            "created_at",
            "updated_at",
        ]
        read_only_fields = fields

    def get_supervisor_name(self, obj) -> str:
        return user_display(obj.supervisor)

    def get_overtime_hours(self, obj) -> str:
        return _fmt(obj.overtime_hours)

    def get_saturday_hours(self, obj) -> str:
        return _fmt(obj.saturday_hours)

    def get_created_by_name(self, obj) -> str:
        return user_display(obj.created_by)

    def get_updated_by_name(self, obj) -> str:
        return user_display(obj.updated_by)


class DeleteSerializer(serializers.Serializer):
    reason = serializers.CharField(max_length=500, required=False, allow_blank=True, default="")


class CloseSerializer(serializers.Serializer):
    period = serializers.CharField()
    supervisor_id = serializers.IntegerField(required=False, allow_null=True)
    confirm = serializers.BooleanField()

    def validate_confirm(self, value):
        if not value:
            raise serializers.ValidationError("Debe confirmar explícitamente el cierre.")
        return value


class ImportPreviewSerializer(serializers.Serializer):
    kind = serializers.ChoiceField(choices=ImportBatch.Kind.choices)
    period = serializers.CharField(required=False, allow_blank=True, default="")
    supervisor_id = serializers.IntegerField(required=False, allow_null=True)
    file = serializers.FileField()

    def validate(self, attrs):
        if attrs["kind"] != ImportBatch.Kind.COLLABORATORS and not attrs.get("period"):
            raise serializers.ValidationError({"period": "Indique el período."})
        return attrs

    def validate_file(self, value):
        if not value.name.lower().endswith(".xlsx"):
            raise serializers.ValidationError("El archivo debe ser .xlsx.")
        if value.size > 10 * 1024 * 1024:
            raise serializers.ValidationError("El archivo supera 10 MB.")
        return value


class ImportConfirmSerializer(serializers.Serializer):
    strategy = serializers.ChoiceField(
        choices=[("skip", "Omitir existentes"), ("update", "Actualizar existentes")]
    )


class ImportBatchSerializer(serializers.ModelSerializer):
    period = serializers.SerializerMethodField()

    def get_period(self, obj) -> str | None:
        return obj.period.code if obj.period else None

    class Meta:
        model = ImportBatch
        fields = [
            "id",
            "kind",
            "status",
            "period",
            "file_name",
            "rows",
            "errors",
            "summary",
            "strategy",
            "created_at",
        ]
        read_only_fields = fields


class WorkedDayCorrectionSerializer(serializers.Serializer):
    collaborator_id = serializers.IntegerField()
    supervisor_id = serializers.IntegerField()
    date = serializers.DateField()
    hours = serializers.CharField(required=False, allow_null=True, allow_blank=True)
    reason = serializers.CharField(max_length=500)


class OvertimeCorrectionSerializer(OvertimeWriteSerializer):
    record_id = serializers.IntegerField()
    delete = serializers.BooleanField(required=False, default=False)
    reason = serializers.CharField(max_length=500)


class EventSerializer(serializers.ModelSerializer):
    actor_name = serializers.SerializerMethodField()
    supervisor_name = serializers.SerializerMethodField()
    period = serializers.SerializerMethodField()
    highlight = serializers.SerializerMethodField()

    class Meta:
        model = NovedadEvent
        fields = [
            "id",
            "action",
            "actor_name",
            "actor_role",
            "supervisor_id",
            "supervisor_name",
            "period",
            "target_type",
            "target_id",
            "target_label",
            "field",
            "old_value",
            "new_value",
            "reason",
            "source_file",
            "created_at",
            "highlight",
        ]
        read_only_fields = fields

    # Etiquetas con que `change_status` guarda el estado nuevo del evento.
    DANGER_STATUSES = (
        Collaborator.Status.INACTIVE.label,
        Collaborator.Status.SUSPENDED.label,
    )

    def get_highlight(self, obj) -> str:
        """Color del EVENTO según su transición (nunca según el estado
        actual del colaborador), decidido aquí y no en la pantalla:
        "danger" (rojo) = pasó a Inactivo o Suspendido; "info" (azul) =
        reactivación (de Inactivo o Suspendido a Activo) o ingreso a la base."""
        if obj.action == "collaborator.status_changed":
            if obj.new_value in self.DANGER_STATUSES:
                return "danger"
            if (
                obj.old_value in self.DANGER_STATUSES
                and obj.new_value == Collaborator.Status.ACTIVE.label
            ):
                return "info"
            return ""
        if obj.action == "collaborator.created":
            return "info"  # azul: nuevo ingreso a la base (formulario o importación)
        return ""

    def get_actor_name(self, obj) -> str:
        return user_display(obj.actor)

    def get_supervisor_name(self, obj) -> str:
        return user_display(obj.supervisor)

    def get_period(self, obj) -> str | None:
        return obj.period.code if obj.period else None


class RolePermissionSerializer(serializers.Serializer):
    role = serializers.CharField()
    codename = serializers.CharField()
    enabled = serializers.BooleanField()
    reason = serializers.CharField(max_length=500, required=False, allow_blank=True, default="")


class OverrideCreateSerializer(serializers.Serializer):
    user_id = serializers.IntegerField()
    codename = serializers.CharField()
    effect = serializers.ChoiceField(choices=PermissionOverride.Effect.choices)
    reason = serializers.CharField(max_length=500)


class OverrideRevokeSerializer(serializers.Serializer):
    reason = serializers.CharField(max_length=500, required=False, allow_blank=True, default="")
