"""Vistas de la base de conocimiento del Asistente LLM/RAG — Fase 58 (ver
docs/AUDIT_LOG.md § 2026-08-25). El procesamiento real (subida a GitHub,
extracción de texto, chunking, embeddings vía `@xenova/transformers`)
sigue ocurriendo en Next.js (`src/lib/githubDocuments.ts`/
`src/lib/embeddings.ts`, sin cambios) — estas vistas solo PERSISTEN el
resultado ya calculado, mismo patrón que Reportes Ejecutivos (Fase 56)."""

from django.db import transaction
from django.shortcuts import get_object_or_404
from rest_framework import generics
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .models import DocumentChunk, KnowledgeDocument
from .permissions import CanManageKnowledgeBase, CanViewKnowledgeBase
from .serializers import (
    DocumentChunkBulkCreateSerializer,
    DocumentChunkListSerializer,
    KnowledgeDocumentCreateSerializer,
    KnowledgeDocumentSerializer,
    KnowledgeDocumentUpdateSerializer,
)


class KnowledgeDocumentListCreateView(generics.ListCreateAPIView):
    """`GET/POST /api/v1/assistant/documents/` — réplica de
    `src/app/api/assistant/documents/route.ts`. `POST` solo crea el
    registro inicial (`status=PROCESANDO`) — `PATCH .../<id>/` y
    `POST .../<id>/chunks/` lo van completando a medida que Next.js
    procesa el PDF."""

    queryset = KnowledgeDocument.objects.select_related("uploaded_by").all()

    def get_permissions(self):
        if self.request.method == "POST":
            return [CanManageKnowledgeBase()]
        return [CanViewKnowledgeBase()]

    def get_serializer_class(self):
        return KnowledgeDocumentCreateSerializer if self.request.method == "POST" else KnowledgeDocumentSerializer

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        document = serializer.save(uploaded_by=request.user, status=KnowledgeDocument.Status.PROCESANDO)
        return Response(KnowledgeDocumentSerializer(document).data, status=201)


class KnowledgeDocumentDetailView(generics.GenericAPIView):
    """`GET/PATCH/DELETE /api/v1/assistant/documents/<id>/` — `GET` es
    ADITIVO (el TS legacy nunca tuvo esta ruta como detalle propio, solo
    listado): lo necesita Next.js para leer el estado final del documento
    después de que `processGithubDocument` termina de escribirlo en varios
    pasos. `PATCH` réplica las escrituras parciales que
    `processGithubDocument` hacía in-process contra Prisma (github_path/
    sha tras subir; status/processing_error/content ante un fallo de
    extracción). `DELETE` réplica `src/app/api/assistant/documents/[id]/
    route.ts` — el borrado del archivo en GitHub lo sigue haciendo
    Next.js antes de llamar acá."""

    queryset = KnowledgeDocument.objects.select_related("uploaded_by").all()
    serializer_class = KnowledgeDocumentUpdateSerializer

    def get_permissions(self):
        if self.request.method == "GET":
            return [CanViewKnowledgeBase()]
        return [CanManageKnowledgeBase()]

    def get(self, request, pk: int):
        document = get_object_or_404(KnowledgeDocument, pk=pk)
        return Response(KnowledgeDocumentSerializer(document).data)

    def patch(self, request, pk: int):
        document = get_object_or_404(KnowledgeDocument, pk=pk)
        serializer = self.get_serializer(document, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(KnowledgeDocumentSerializer(document).data)

    def delete(self, request, pk: int):
        document = get_object_or_404(KnowledgeDocument, pk=pk)
        document.delete()
        return Response({"ok": True})


class DocumentChunkBulkCreateView(generics.GenericAPIView):
    """`POST /api/v1/assistant/documents/<id>/chunks/` — réplica de
    `embedChunks` + `prisma.documentChunk.createMany` + el `status=LISTO`
    final del `route.ts` original. Reemplaza TODOS los chunks existentes
    del documento (idempotente ante un reintento de procesamiento)."""

    queryset = KnowledgeDocument.objects.all()
    permission_classes = [CanManageKnowledgeBase]
    serializer_class = DocumentChunkBulkCreateSerializer

    def post(self, request, pk: int):
        document = get_object_or_404(KnowledgeDocument, pk=pk)
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        chunks = serializer.validated_data["chunks"]

        with transaction.atomic():
            DocumentChunk.objects.filter(document=document).delete()
            DocumentChunk.objects.bulk_create(
                DocumentChunk(
                    document=document,
                    content=c["content"],
                    embedding=c["embedding"],
                    page_number=c["page_number"],
                    chunk_index=c["chunk_index"],
                )
                for c in chunks
            )
            document.status = KnowledgeDocument.Status.LISTO
            update_fields = ["status", "updated_at"]
            content = serializer.validated_data.get("content")
            if content is not None:
                document.content = content
                update_fields.append("content")
            document.processing_error = None
            update_fields.append("processing_error")
            document.save(update_fields=update_fields)

        return Response({"ok": True, "count": len(chunks)}, status=201)


class DocumentChunkListView(generics.ListAPIView):
    """`GET /api/v1/assistant/chunks/` — TODOS los chunks de TODOS los
    documentos, con su embedding, para que `findRelevantChunks`
    (`assistant/chat/route.ts`) siga calculando la similitud coseno
    localmente, sin cambios. Gateada solo por autenticación — el TS
    original tampoco exige el permiso de base de conocimiento acá
    (cualquier usuario autenticado llega vía el chat en modo "hr"),
    distinto del gate de `CanViewKnowledgeBase` que sí aplica a la
    pantalla de administración de documentos."""

    queryset = DocumentChunk.objects.select_related("document").all()
    serializer_class = DocumentChunkListSerializer
    permission_classes = [IsAuthenticated]
    pagination_class = None
