"""Serializers de Reuniones — Fase 10 (ver docs/AUDIT_LOG.md §
2026-08-19). Réplica del `meetingInclude`/`serialize()` de `route.ts`
(lectura) y de la validación inline de `POST`/`PATCH`."""

from rest_framework import serializers

from apps.users.models import User

from .models import Meeting, MeetingInvitee


class MeetingUserRefSerializer(serializers.ModelSerializer):
    """Referencia mínima a un usuario dentro de una reunión (host/
    invitee.user) — mismo patrón que `apps.tasks.serializers.
    TaskUserRefSerializer` (duplicado, no importado): `roles` es una
    lista (no el `role: string` singular del TS) porque así vive en
    Django (`auth.Group` M2M); el invariante de "1 rol por usuario" lo
    garantiza Nexo, no el modelo."""

    roles = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ["id", "username", "first_name", "email", "roles"]
        read_only_fields = fields

    def get_roles(self, obj: User) -> list[dict]:
        return [{"id": group.id, "name": group.name} for group in obj.groups.all()]


class MeetingInviteeSerializer(serializers.ModelSerializer):
    user = MeetingUserRefSerializer(read_only=True)

    class Meta:
        model = MeetingInvitee
        fields = ["id", "user", "attended"]
        read_only_fields = fields


class MeetingSerializer(serializers.ModelSerializer):
    """Réplica de `serialize()`/`meetingInclude` — incluye host e
    invitados (ordenados por `user.first_name`, equivalente al
    `user.name` del TS)."""

    host = MeetingUserRefSerializer(read_only=True)
    invitees = serializers.SerializerMethodField()

    class Meta:
        model = Meeting
        fields = [
            "id", "title", "description", "host", "meeting_date", "duration",
            "zoom_meeting_id", "zoom_join_url", "zoom_password", "status",
            "otter_invited", "otter_summary", "otter_transcript_url",
            "created_at", "updated_at", "invitees",
        ]
        read_only_fields = fields

    def get_invitees(self, obj: Meeting) -> list[dict]:
        invitees = obj.invitees.select_related("user").prefetch_related("user__groups").order_by("user__first_name")
        return MeetingInviteeSerializer(invitees, many=True).data


class MeetingCreateSerializer(serializers.Serializer):
    """Réplica de la validación inline de `POST /api/meetings`:
    `title` vacío/solo-espacios, `meeting_date`, `duration` faltantes
    (o 0, `!duration` en JS es falsy) -> inválido."""

    title = serializers.CharField()
    description = serializers.CharField(required=False, allow_null=True, allow_blank=True, default=None)
    meeting_date = serializers.DateTimeField()
    duration = serializers.IntegerField(min_value=1)
    invitee_ids = serializers.ListField(child=serializers.IntegerField(), required=False, default=list)

    def validate_title(self, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise serializers.ValidationError("Faltan campos requeridos")
        return stripped


class MeetingPatchSerializer(serializers.Serializer):
    """Réplica de la whitelist `allowed` de `PATCH /api/meetings/[id]`
    — cualquier campo fuera de esta lista se ignora silenciosamente
    (comportamiento por defecto de un `Serializer` de DRF: solo lee
    los campos declarados)."""

    title = serializers.CharField(required=False)
    description = serializers.CharField(required=False, allow_null=True, allow_blank=True)
    meeting_date = serializers.DateTimeField(required=False)
    duration = serializers.IntegerField(required=False, min_value=1)
    status = serializers.ChoiceField(choices=Meeting.Status.choices, required=False)
    otter_invited = serializers.BooleanField(required=False)
    otter_summary = serializers.CharField(required=False, allow_null=True, allow_blank=True)
    otter_transcript_url = serializers.CharField(required=False, allow_null=True, allow_blank=True)
