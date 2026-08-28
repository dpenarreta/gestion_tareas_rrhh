"""Serializers de Solicitudes LOPD — Fase 12 (ver docs/AUDIT_LOG.md §
2026-08-19)."""

from rest_framework import serializers

from apps.users.models import User

from .models import DataSubjectRequest


class DataRequestUserRefSerializer(serializers.ModelSerializer):
    """Referencia de usuario en `user` — mismo patrón que
    `apps.tasks.serializers.TaskUserRefSerializer` (duplicado, no
    importado): `roles` es una lista, no el `role: string` singular
    del TS."""

    roles = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ["id", "username", "first_name", "email", "roles"]
        read_only_fields = fields

    def get_roles(self, obj: User) -> list[dict]:
        return [{"id": group.id, "name": group.name} for group in obj.groups.all()]


class DataRequestResolverRefSerializer(serializers.ModelSerializer):
    """Referencia de usuario en `resolver` — el TS solo selecciona
    `{id, name}` acá (shape más chico que `user`, réplica fiel)."""

    class Meta:
        model = User
        fields = ["id", "first_name"]
        read_only_fields = fields


class DataSubjectRequestFlatSerializer(serializers.ModelSerializer):
    """Réplica de la respuesta de `POST /api/data-requests` — el
    `create()` del TS no usa `include`, así que son los campos
    escalares crudos (`user_id`/`resolved_by_id`), sin objetos
    anidados."""

    class Meta:
        model = DataSubjectRequest
        fields = ["id", "user_id", "type", "description", "status", "resolved_by_id", "resolved_at", "created_at"]
        read_only_fields = fields


class DataSubjectRequestSerializer(serializers.ModelSerializer):
    """Réplica de la respuesta de `GET /api/data-requests` y `PATCH
    /api/data-requests/[id]` — con `include: {user, resolver}`: además
    de los IDs crudos (`user_id`/`resolved_by_id`), trae los objetos
    anidados `user`/`resolver`."""

    user = DataRequestUserRefSerializer(read_only=True)
    resolver = DataRequestResolverRefSerializer(source="resolved_by", read_only=True)

    class Meta:
        model = DataSubjectRequest
        fields = [
            "id", "user_id", "type", "description", "status",
            "resolved_by_id", "resolved_at", "created_at", "user", "resolver",
        ]
        read_only_fields = fields


class DataRequestCreateSerializer(serializers.Serializer):
    """Réplica de la validación inline de `POST /api/data-requests`."""

    type = serializers.ChoiceField(choices=DataSubjectRequest.Type.choices)
    description = serializers.CharField(required=False, allow_blank=True, allow_null=True, default=None)

    def validate_description(self, value: str | None) -> str | None:
        return value.strip() or None if value else None


class DataRequestStatusSerializer(serializers.Serializer):
    """Réplica de la validación inline de `PATCH /api/data-requests/[id]`."""

    status = serializers.ChoiceField(choices=DataSubjectRequest.Status.choices)
