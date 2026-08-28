"""Serializers de la base de conocimiento — Fase 58 (ver docs/AUDIT_LOG.md
§ 2026-08-25)."""

from rest_framework import serializers

from .models import DocumentChunk, KnowledgeDocument


class KnowledgeDocumentSerializer(serializers.ModelSerializer):
    """Réplica de la forma de fila de `GET /assistant/documents/route.ts` —
    incluye el conteo de chunks (`_count.chunks` en el TS original), sin
    `content` (el texto completo nunca se lista, solo se guarda). Incluye
    `github_sha` (aditivo: el TS original leía el registro completo de
    Prisma sin `select`) porque `DELETE .../[id]/route.ts` lo necesita para
    borrar el archivo en GitHub antes de eliminar el registro."""

    uploaded_by_name = serializers.SerializerMethodField()
    chunk_count = serializers.IntegerField(source="chunks.count", read_only=True)

    class Meta:
        model = KnowledgeDocument
        fields = [
            "id", "title", "file_name", "github_path", "github_sha", "created_at", "status",
            "processing_error", "uploaded_by_name", "chunk_count",
        ]
        read_only_fields = fields

    def get_uploaded_by_name(self, obj: KnowledgeDocument) -> str:
        return obj.uploaded_by.first_name or obj.uploaded_by.username


class KnowledgeDocumentCreateSerializer(serializers.ModelSerializer):
    """`POST /assistant/documents/` — crea el registro ANTES de subir a
    GitHub/procesar (mismo orden que el TS original: `status=PROCESANDO`
    hasta que `PATCH`/`.../chunks/` lo actualicen)."""

    class Meta:
        model = KnowledgeDocument
        fields = ["title", "file_name"]


class KnowledgeDocumentUpdateSerializer(serializers.ModelSerializer):
    """`PATCH /assistant/documents/<id>/` — réplica de las 3 escrituras
    parciales que hace `processGithubDocument`/el route.ts original
    (github_path/sha tras subir; status/processing_error/content tras
    extraer texto; status final tras generar los chunks)."""

    class Meta:
        model = KnowledgeDocument
        fields = ["github_path", "github_sha", "status", "processing_error", "content"]
        extra_kwargs = {field: {"required": False} for field in fields}


class DocumentChunkInputSerializer(serializers.Serializer):
    content = serializers.CharField()
    embedding = serializers.JSONField()
    page_number = serializers.IntegerField()
    chunk_index = serializers.IntegerField()


class DocumentChunkBulkCreateSerializer(serializers.Serializer):
    """`POST /assistant/documents/<id>/chunks/` — reemplaza TODOS los
    chunks de un documento en una sola llamada (réplica de
    `embedChunks`+`prisma.documentChunk.createMany` en el `route.ts`
    original, que siempre procesa el documento completo de una vez, nunca
    incrementalmente). `content` es opcional — el texto completo extraído
    del PDF, mismo campo que el `route.ts` original escribía en la MISMA
    transacción que los chunks (`prisma.knowledgeDocument.update` con
    `chunks: { create: [...] }` anidado)."""

    chunks = DocumentChunkInputSerializer(many=True)
    content = serializers.CharField(required=False, allow_null=True, allow_blank=True)


class DocumentChunkListSerializer(serializers.ModelSerializer):
    """`GET /assistant/chunks/` — TODOS los chunks de TODOS los documentos,
    con el embedding incluido, para que `findRelevantChunks` (Next.js)
    siga calculando la similitud coseno localmente, sin cambios."""

    doc_title = serializers.CharField(source="document.title", read_only=True)
    doc_file_name = serializers.CharField(source="document.file_name", read_only=True)

    class Meta:
        model = DocumentChunk
        fields = ["content", "embedding", "page_number", "doc_title", "doc_file_name"]
        read_only_fields = fields
