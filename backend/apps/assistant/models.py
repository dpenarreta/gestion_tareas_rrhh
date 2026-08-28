"""Base de conocimiento del Asistente LLM/RAG — Fase 58 de la migración de
stack (ver docs/AUDIT_LOG.md § 2026-08-25). Réplica de `KnowledgeDocument`/
`DocumentChunk` (`prisma/schema.prisma`).

Decisión explícita de esta fase: el CÁLCULO de embeddings NO se porta a
Python — `@xenova/transformers` (`src/lib/embeddings.ts`) sigue corriendo
en Next.js sin cambios, igual que Groq nunca se porta en el resto de esta
migración (Nova Insights/Message, narrativa de Reportes Ejecutivos). Acá
solo se persiste el resultado ya calculado: el archivo PDF en sí sigue
viviendo en GitHub (`src/lib/githubDocuments.ts`, sin cambios), Django
solo guarda metadatos + los chunks con su embedding ya resuelto."""

from django.conf import settings
from django.db import models

from apps.core.models import BaseModel


class KnowledgeDocument(BaseModel):
    class Status(models.TextChoices):
        PROCESANDO = "PROCESANDO"
        LISTO = "LISTO"
        ERROR = "ERROR"

    legacy_postgres_id = models.CharField(max_length=30, unique=True, null=True, blank=True)
    title = models.CharField(max_length=255)
    file_name = models.CharField(max_length=255)
    content = models.TextField(null=True, blank=True)
    github_path = models.CharField(max_length=500, null=True, blank=True)
    github_sha = models.CharField(max_length=100, null=True, blank=True)
    status = models.CharField(max_length=15, choices=Status.choices, default=Status.LISTO)
    processing_error = models.TextField(null=True, blank=True)
    uploaded_by = models.ForeignKey(settings.AUTH_USER_MODEL, related_name="+", on_delete=models.CASCADE)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return self.title


class DocumentChunk(models.Model):
    """`embedding` es el vector ya calculado en TypeScript — Django nunca
    calcula ni recalcula embeddings, solo los persiste y los devuelve tal
    cual para que `findRelevantChunks` (Next.js) siga haciendo la búsqueda
    por similitud coseno sin cambios."""

    legacy_postgres_id = models.CharField(max_length=30, unique=True, null=True, blank=True)
    document = models.ForeignKey(KnowledgeDocument, related_name="chunks", on_delete=models.CASCADE)
    content = models.TextField()
    embedding = models.JSONField()
    page_number = models.PositiveIntegerField()
    chunk_index = models.PositiveIntegerField()

    class Meta:
        ordering = ["document_id", "chunk_index"]

    def __str__(self) -> str:
        return f"{self.document_id}:{self.chunk_index}"
