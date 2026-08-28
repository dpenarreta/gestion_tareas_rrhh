"""Serializers de Escritorio Digital — Fases 7a-7d (ver
docs/AUDIT_LOG.md § 2026-08-17)."""

import base64
import binascii

from rest_framework import serializers

from apps.tasks.models import Task
from apps.users.models import User

from .models import DeskAuditLog, DeskNote, DeskNoteReply, PersonalReminder
from .permissions import role_name

MAX_MESSAGE_LENGTH = 500
MAX_TITLE_LENGTH = 150

# Fase 7d (ver docs/AUDIT_LOG.md § 2026-08-17) — réplica exacta de
# `ALLOWED_EXTENSIONS`/`MAX_SIZE_BYTES` en `src/lib/storage.ts`.
ATTACHMENT_ALLOWED_EXTENSIONS = {"png", "jpg", "jpeg", "pdf", "doc", "docx", "xls", "xlsx"}
ATTACHMENT_MAX_SIZE_BYTES = 8 * 1024 * 1024


class DeskUserRefSerializer(serializers.ModelSerializer):
    """Referencia mínima a un usuario (sender/recipient/author) — réplica
    de `{ select: { name: true } }` del TS. Sin `roles`/`email`: ningún
    endpoint de esta sub-fase los necesita (a diferencia de Proyectos)."""

    name = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ["id", "name"]
        read_only_fields = fields

    def get_name(self, obj: User) -> str:
        return obj.first_name or obj.username


class DeskNoteRecipientSerializer(serializers.ModelSerializer):
    """Réplica de `GET /desk-notes/recipients` — a diferencia de
    `DeskUserRefSerializer`, acá sí viaja `role` (el TS lo selecciona)."""

    name = serializers.SerializerMethodField()
    role = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ["id", "name", "role"]
        read_only_fields = fields

    def get_name(self, obj: User) -> str:
        return obj.first_name or obj.username

    def get_role(self, obj: User) -> str:
        return role_name(obj)


class DeskNoteSerializer(serializers.ModelSerializer):
    """Réplica de `serializeNote`/`noteSelect`
    (`src/lib/deskNotes.ts`)."""

    sender = DeskUserRefSerializer(read_only=True)
    recipient = DeskUserRefSerializer(read_only=True)
    is_mine = serializers.SerializerMethodField()
    reply_count = serializers.SerializerMethodField()
    has_attachment = serializers.SerializerMethodField()
    converted_to_reminder_id = serializers.IntegerField(read_only=True, allow_null=True)

    class Meta:
        model = DeskNote
        fields = [
            "id", "message", "priority", "color", "read", "read_at", "pinned",
            "archived", "archived_at", "created_at", "sender", "recipient", "is_mine", "reply_count",
            "has_attachment", "attachment_name", "attachment_mime",
            "converted_to_reminder_id", "converted_at",
        ]
        read_only_fields = fields

    def get_is_mine(self, obj: DeskNote) -> bool:
        request = self.context.get("request")
        return bool(request and obj.sender_id == request.user.id)

    def get_reply_count(self, obj: DeskNote) -> int:
        return obj.replies.count()

    def get_has_attachment(self, obj: DeskNote) -> bool:
        return bool(obj.attachment_name)


class DeskNoteCreateSerializer(serializers.Serializer):
    """Réplica de `POST /desk-notes` — el TS recibe un `File` de
    `FormData` y lo codifica en base64 en el servidor (`saveAttachment`);
    acá el cliente ya manda `attachment_data` como data URL
    (`data:<mime>;base64,<payload>`) en el body JSON, mismo criterio que
    `ProjectDocumentUploadSerializer.file_data` — solo se valida
    extensión/tamaño, no se re-codifica nada."""

    recipient = serializers.PrimaryKeyRelatedField(queryset=User.objects.all())
    message = serializers.CharField(max_length=MAX_MESSAGE_LENGTH)
    priority = serializers.ChoiceField(choices=DeskNote.Priority.choices, required=False, default=DeskNote.Priority.INFORMACION)
    color = serializers.ChoiceField(choices=DeskNote.Color.choices, required=False, default=DeskNote.Color.AMARILLO)
    attachment_name = serializers.CharField(max_length=255, required=False, allow_null=True, default=None)
    attachment_mime = serializers.CharField(required=False, allow_blank=True, allow_null=True, default=None)
    attachment_data = serializers.CharField(required=False, allow_null=True, default=None)

    def validate_message(self, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise serializers.ValidationError("Faltan campos requeridos")
        return stripped

    def validate(self, attrs: dict) -> dict:
        attachment_data = attrs.get("attachment_data")
        attachment_name = attrs.get("attachment_name")
        if not attachment_data:
            return attrs
        if not attachment_name:
            raise serializers.ValidationError({"attachment_name": ["Falta el nombre del archivo"]})

        ext = attachment_name.rsplit(".", 1)[-1].lower() if "." in attachment_name else ""
        if ext not in ATTACHMENT_ALLOWED_EXTENSIONS:
            raise serializers.ValidationError({"attachment_name": ["Tipo de archivo no permitido"]})

        payload = attachment_data.split(",", 1)[-1]
        try:
            size = len(base64.b64decode(payload, validate=True))
        except (binascii.Error, ValueError) as exc:
            raise serializers.ValidationError({"attachment_data": ["Adjunto inválido"]}) from exc
        if size > ATTACHMENT_MAX_SIZE_BYTES:
            raise serializers.ValidationError(
                {"attachment_data": ["El archivo supera el tamaño máximo permitido (8MB)"]}
            )
        return attrs


class ConvertNoteToReminderSerializer(serializers.Serializer):
    """Réplica de `POST /desk-notes/[id]/convert-to-reminder` — `title`
    vacío/ausente y `priority` ausente caen a valores derivados de la
    nota, resueltos en el service (necesita la nota como contexto)."""

    title = serializers.CharField(max_length=MAX_TITLE_LENGTH, required=False, allow_blank=True, default="")
    due_at = serializers.DateTimeField()
    priority = serializers.ChoiceField(
        choices=PersonalReminder.Priority.choices, required=False, allow_null=True, default=None
    )


class DeskNoteActionSerializer(serializers.Serializer):
    action = serializers.ChoiceField(choices=["read", "pin", "unpin", "archive", "unarchive"])


class DeskNoteReplySerializer(serializers.ModelSerializer):
    author = DeskUserRefSerializer(read_only=True)

    class Meta:
        model = DeskNoteReply
        fields = ["id", "message", "author", "created_at"]
        read_only_fields = fields


class ReplyCreateSerializer(serializers.Serializer):
    message = serializers.CharField(max_length=MAX_MESSAGE_LENGTH)

    def validate_message(self, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise serializers.ValidationError("Escribe un mensaje")
        return stripped


class DeskAuditLogSerializer(serializers.ModelSerializer):
    class Meta:
        model = DeskAuditLog
        fields = ["id", "action", "metadata", "created_at"]
        read_only_fields = fields


# ── Fase 7b (ver docs/AUDIT_LOG.md § 2026-08-17) — Recordatorios ──────────────


class PersonalReminderSerializer(serializers.ModelSerializer):
    """Réplica de `serializeReminder`/`reminderSelect`
    (`src/lib/personalReminders.ts`) — SIN `attachment_data` (réplica
    exacta: `reminderSelect` tampoco lo expone; sin endpoint de
    descarga propio, ver docstring de `models.py`)."""

    converted_to_task_id = serializers.IntegerField(read_only=True, allow_null=True)
    has_attachment = serializers.SerializerMethodField()

    class Meta:
        model = PersonalReminder
        fields = [
            "id", "title", "description", "due_at", "priority", "status",
            "repeat", "completed_at", "archived", "archived_at",
            "converted_to_task_id", "converted_to_task_at",
            "has_attachment", "attachment_name", "attachment_mime", "created_at",
        ]
        read_only_fields = fields

    def get_has_attachment(self, obj: PersonalReminder) -> bool:
        return bool(obj.attachment_name)


class PersonalReminderCreateSerializer(serializers.Serializer):
    """Réplica de `POST /desk-reminders`."""

    title = serializers.CharField(max_length=MAX_TITLE_LENGTH)
    description = serializers.CharField(required=False, allow_blank=True, default="")
    due_at = serializers.DateTimeField()
    priority = serializers.ChoiceField(choices=PersonalReminder.Priority.choices, required=False, default=PersonalReminder.Priority.MEDIA)
    repeat = serializers.ChoiceField(choices=PersonalReminder.Repeat.choices, required=False, default=PersonalReminder.Repeat.UNA_VEZ)

    def validate_title(self, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise serializers.ValidationError("Faltan campos requeridos")
        return stripped


class PersonalReminderUpdateSerializer(serializers.Serializer):
    """Réplica de la edición directa de campos de
    `PATCH /desk-reminders/[id]` (sin `action` en el body)."""

    title = serializers.CharField(max_length=MAX_TITLE_LENGTH, required=False)
    description = serializers.CharField(required=False, allow_blank=True)
    due_at = serializers.DateTimeField(required=False)
    repeat = serializers.ChoiceField(choices=PersonalReminder.Repeat.choices, required=False)
    priority = serializers.ChoiceField(choices=PersonalReminder.Priority.choices, required=False)

    def validate_title(self, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise serializers.ValidationError("El título no puede estar vacío")
        return stripped

    def validate_description(self, value: str) -> str | None:
        return value.strip() or None


class ReminderDueAtSerializer(serializers.Serializer):
    """Réplica de la rama `action === "postpone"` — `due_at` requerido."""

    due_at = serializers.DateTimeField()


class ReminderReopenSerializer(serializers.Serializer):
    """Réplica de la rama `action === "reopen"` — `due_at` opcional
    (si no viene, conserva la fecha/hora original)."""

    due_at = serializers.DateTimeField(required=False, allow_null=True, default=None)


# ── Fase 7c (ver docs/AUDIT_LOG.md § 2026-08-17) — convert-to-task ────────────


class ConvertReminderToTaskSerializer(serializers.Serializer):
    """Réplica de `POST /desk-reminders/[id]/convert-to-task` — mismos
    campos requeridos que `TaskCreateSerializer` salvo `assigned_to`
    (siempre el propio dueño) y `priority` (se traduce, no se elige).
    `title` vacío/ausente cae al título del recordatorio — resuelto en
    el service, no acá, porque necesita el recordatorio como contexto."""

    title = serializers.CharField(max_length=255, required=False, allow_blank=True, default="")
    type = serializers.ChoiceField(choices=Task.Type.choices, required=False, default=Task.Type.SEGUIMIENTO)
    frequency = serializers.ChoiceField(choices=Task.Frequency.choices, required=False, default=Task.Frequency.PUNTUAL)
    start_date = serializers.DateTimeField()
    end_date = serializers.DateTimeField()
    estimated_hours = serializers.FloatField()

    def validate_estimated_hours(self, value: float) -> float:
        if value <= 0:
            raise serializers.ValidationError("Faltan campos requeridos")
        return value
