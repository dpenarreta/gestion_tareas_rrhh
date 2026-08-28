"""Serializers de Mejora Continua — Fase 11 (ver docs/AUDIT_LOG.md §
2026-08-19). Réplica de `ideaListSelect`/`ideaSelect`/`ideaDetailSelect`
(`route.ts`) y de la validación inline de creación/progreso/estado."""

import base64
import binascii

from rest_framework import serializers

from apps.users.models import User

from .models import IdeaStatusHistory, ImprovementIdea

# Réplica de `ALLOWED_EXTENSIONS`/`MAX_SIZE_BYTES` en `src/lib/storage.ts`
# — mismos valores que `apps.desk.serializers` (duplicado, no
# centralizado: mismo criterio ya usado para `role_name` en
# desk/reports/meetings, un único consumidor adicional no amerita
# todavía extraer un módulo compartido).
ATTACHMENT_ALLOWED_EXTENSIONS = {"png", "jpg", "jpeg", "pdf", "doc", "docx", "xls", "xlsx"}
ATTACHMENT_MAX_SIZE_BYTES = 8 * 1024 * 1024


class IdeaUserRefSerializer(serializers.ModelSerializer):
    """Referencia mínima a un usuario (author/changer) — mismo patrón
    que `apps.tasks.serializers.TaskUserRefSerializer` (duplicado, no
    importado): `roles` es una lista, no el `role: string` singular
    del TS."""

    roles = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ["id", "username", "first_name", "email", "roles"]
        read_only_fields = fields

    def get_roles(self, obj: User) -> list[dict]:
        return [{"id": group.id, "name": group.name} for group in obj.groups.all()]


class IdeaHistoryEntrySerializer(serializers.ModelSerializer):
    """`changer` en la respuesta (mismo nombre que el TS) lee del
    campo `changed_by` del modelo."""

    changer = IdeaUserRefSerializer(source="changed_by", read_only=True)

    class Meta:
        model = IdeaStatusHistory
        fields = ["id", "from_status", "to_status", "comment", "created_at", "changer"]
        read_only_fields = fields


class IdeaListItemSerializer(serializers.ModelSerializer):
    """Réplica de `ideaListSelect` — sin `attachment_data`, con
    `latest_rejection_comment` (último `history` con
    `to_status=RECHAZADA`, no el historial completo)."""

    author = IdeaUserRefSerializer(read_only=True)
    latest_rejection_comment = serializers.SerializerMethodField()
    vote_count = serializers.SerializerMethodField()
    voted_by_me = serializers.SerializerMethodField()

    class Meta:
        model = ImprovementIdea
        fields = [
            "id", "title", "description", "impact", "status", "progress",
            "attachment_name", "attachment_mime", "created_at", "updated_at",
            "author", "latest_rejection_comment", "vote_count", "voted_by_me",
        ]
        read_only_fields = fields

    def get_latest_rejection_comment(self, obj: ImprovementIdea) -> str | None:
        entry = obj.history.filter(to_status=ImprovementIdea.Status.RECHAZADA).order_by("-created_at").first()
        return entry.comment if entry else None

    def get_vote_count(self, obj: ImprovementIdea) -> int:
        return obj.votes.count()

    def get_voted_by_me(self, obj: ImprovementIdea) -> bool:
        return obj.votes.filter(user=self.context["request"].user).exists()


class IdeaSerializer(serializers.ModelSerializer):
    """Réplica de `ideaSelect` (respuesta de `POST /api/ideas` y
    `PATCH /api/ideas/[id]/status`) — sin `history`, sin
    `attachment_data`."""

    author = IdeaUserRefSerializer(read_only=True)
    vote_count = serializers.SerializerMethodField()
    voted_by_me = serializers.SerializerMethodField()

    class Meta:
        model = ImprovementIdea
        fields = [
            "id", "title", "description", "impact", "status", "progress",
            "attachment_name", "attachment_mime", "created_at", "updated_at",
            "author", "vote_count", "voted_by_me",
        ]
        read_only_fields = fields

    def get_vote_count(self, obj: ImprovementIdea) -> int:
        return obj.votes.count()

    def get_voted_by_me(self, obj: ImprovementIdea) -> bool:
        return obj.votes.filter(user=self.context["request"].user).exists()


class IdeaDetailSerializer(serializers.ModelSerializer):
    """Réplica de `ideaDetailSelect` — incluye `attachment_data` e
    historial completo. El enmascarado de adjunto fuera del estado
    PROPUESTA (`GET /api/ideas/[id]`) es responsabilidad de la vista,
    no de este serializer (la respuesta de `PATCH .../progress` usa el
    mismo shape SIN enmascarar, réplica fiel de esa asimetría del TS)."""

    author = IdeaUserRefSerializer(read_only=True)
    history = IdeaHistoryEntrySerializer(many=True, read_only=True)
    vote_count = serializers.SerializerMethodField()
    voted_by_me = serializers.SerializerMethodField()

    class Meta:
        model = ImprovementIdea
        fields = [
            "id", "title", "description", "impact", "status", "progress",
            "attachment_name", "attachment_mime", "attachment_data", "created_at", "updated_at",
            "author", "history", "vote_count", "voted_by_me",
        ]
        read_only_fields = fields

    def get_vote_count(self, obj: ImprovementIdea) -> int:
        return obj.votes.count()

    def get_voted_by_me(self, obj: ImprovementIdea) -> bool:
        return obj.votes.filter(user=self.context["request"].user).exists()


def _validate_attachment(attrs: dict) -> dict:
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
        raise serializers.ValidationError({"attachment_data": ["El archivo supera el tamaño máximo permitido (8MB)"]})
    return attrs


class IdeaCreateSerializer(serializers.Serializer):
    """Réplica de la validación inline de `POST /api/ideas`. El TS
    recibe `multipart/form-data`; acá se acepta JSON con el adjunto ya
    codificado como data: URL, mismo contrato ya establecido para
    `apps.desk` (Fase 7d)."""

    title = serializers.CharField()
    description = serializers.CharField()
    impact = serializers.ChoiceField(choices=ImprovementIdea.Impact.choices)
    attachment_name = serializers.CharField(max_length=255, required=False, allow_null=True, default=None)
    attachment_mime = serializers.CharField(required=False, allow_blank=True, allow_null=True, default=None)
    attachment_data = serializers.CharField(required=False, allow_null=True, default=None)

    def validate_title(self, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise serializers.ValidationError("Faltan campos requeridos o son inválidos")
        return stripped

    def validate_description(self, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise serializers.ValidationError("Faltan campos requeridos o son inválidos")
        return stripped

    def validate(self, attrs: dict) -> dict:
        return _validate_attachment(attrs)


class IdeaProgressSerializer(serializers.Serializer):
    """Réplica de la validación inline de `PATCH /api/ideas/[id]`:
    entero 0-100."""

    progress = serializers.IntegerField(min_value=0, max_value=100)


class IdeaStatusActionSerializer(serializers.Serializer):
    """Réplica de la validación inline de `PATCH /api/ideas/[id]/status`."""

    action = serializers.ChoiceField(choices=["ADVANCE", "RETREAT", "REJECT", "REOPEN"])
    comment = serializers.CharField(required=False, allow_blank=True, allow_null=True, default=None)

    def validate_comment(self, value: str | None) -> str | None:
        stripped = value.strip() if value else ""
        return stripped or None
