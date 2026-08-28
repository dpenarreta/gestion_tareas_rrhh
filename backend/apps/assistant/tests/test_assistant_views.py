"""Cobertura HTTP de la base de conocimiento del Asistente LLM/RAG — Fase
58 de la migración de stack (ver docs/AUDIT_LOG.md § 2026-08-25)."""

import pytest
from django.contrib.auth.models import Group
from rest_framework.test import APIClient

from apps.assistant.models import DocumentChunk, KnowledgeDocument
from apps.users.models import User

pytestmark = pytest.mark.django_db


def _client_for(user: User) -> APIClient:
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.fixture
def admin():
    user = User.objects.create_user(username="admin", email="admin@example.com", password="Sup3r-Secr3t!", first_name="Ana")
    user.groups.set([Group.objects.get(name="ADMINISTRADOR")])
    return user


@pytest.fixture
def jefe():
    user = User.objects.create_user(username="jefe", email="jefe@example.com", password="Sup3r-Secr3t!")
    user.groups.set([Group.objects.get(name="JEFE_NACIONAL")])
    return user


@pytest.fixture
def sin_acceso():
    user = User.objects.create_user(username="colaborador", email="colab@example.com", password="Sup3r-Secr3t!")
    user.groups.set([Group.objects.get(name="ASISTENTE_GH")])
    return user


@pytest.fixture
def document(admin) -> KnowledgeDocument:
    return KnowledgeDocument.objects.create(
        title="Manual de RRHH", file_name="manual.pdf", status=KnowledgeDocument.Status.LISTO, uploaded_by=admin
    )


class TestKnowledgeDocumentList:
    def test_requires_authentication(self):
        response = APIClient().get("/api/v1/assistant/documents/")
        assert response.status_code == 401

    def test_forbidden_for_role_without_view_access(self, sin_acceso):
        response = _client_for(sin_acceso).get("/api/v1/assistant/documents/")
        assert response.status_code == 403

    def test_jefe_nacional_can_view(self, jefe, document):
        response = _client_for(jefe).get("/api/v1/assistant/documents/")
        assert response.status_code == 200
        assert response.data[0]["title"] == "Manual de RRHH"

    def test_includes_chunk_count_and_uploader_name(self, admin, document):
        DocumentChunk.objects.create(document=document, content="a", embedding=[0.1], page_number=1, chunk_index=0)
        DocumentChunk.objects.create(document=document, content="b", embedding=[0.2], page_number=1, chunk_index=1)
        response = _client_for(admin).get("/api/v1/assistant/documents/")
        assert response.data[0]["chunk_count"] == 2
        assert response.data[0]["uploaded_by_name"] == "Ana"


class TestKnowledgeDocumentCreate:
    def test_requires_manage_permission(self, jefe):
        """Ver documentos (JEFE_NACIONAL) no alcanza para crear — solo ADMINISTRADOR."""
        response = _client_for(jefe).post(
            "/api/v1/assistant/documents/", {"title": "Nuevo", "file_name": "nuevo.pdf"}, format="json"
        )
        assert response.status_code == 403

    def test_creates_with_procesando_status_attributed_to_actor(self, admin):
        response = _client_for(admin).post(
            "/api/v1/assistant/documents/", {"title": "Política de Licencias", "file_name": "licencias.pdf"}, format="json"
        )
        assert response.status_code == 201
        assert response.data["status"] == "PROCESANDO"
        document = KnowledgeDocument.objects.get(title="Política de Licencias")
        assert document.uploaded_by == admin
        assert document.status == KnowledgeDocument.Status.PROCESANDO


class TestKnowledgeDocumentDetail:
    def test_get_requires_view_permission(self, sin_acceso, document):
        response = _client_for(sin_acceso).get(f"/api/v1/assistant/documents/{document.id}/")
        assert response.status_code == 403

    def test_get_returns_single_document(self, jefe, document):
        response = _client_for(jefe).get(f"/api/v1/assistant/documents/{document.id}/")
        assert response.status_code == 200
        assert response.data["title"] == "Manual de RRHH"

    def test_get_404_for_missing_document(self, jefe):
        response = _client_for(jefe).get("/api/v1/assistant/documents/999999/")
        assert response.status_code == 404

    def test_patch_requires_manage_permission(self, jefe, document):
        response = _client_for(jefe).patch(
            f"/api/v1/assistant/documents/{document.id}/", {"status": "ERROR"}, format="json"
        )
        assert response.status_code == 403

    def test_patch_updates_partial_fields(self, admin, document):
        response = _client_for(admin).patch(
            f"/api/v1/assistant/documents/{document.id}/",
            {"github_path": "docs/manual.pdf", "github_sha": "abc123"},
            format="json",
        )
        assert response.status_code == 200
        document.refresh_from_db()
        assert document.github_path == "docs/manual.pdf"
        assert document.github_sha == "abc123"
        assert document.status == KnowledgeDocument.Status.LISTO  # no se tocó, sigue igual

    def test_patch_can_mark_error_with_message(self, admin, document):
        response = _client_for(admin).patch(
            f"/api/v1/assistant/documents/{document.id}/",
            {"status": "ERROR", "processing_error": "La subida a GitHub falló"},
            format="json",
        )
        assert response.status_code == 200
        document.refresh_from_db()
        assert document.status == KnowledgeDocument.Status.ERROR
        assert document.processing_error == "La subida a GitHub falló"

    def test_delete_requires_manage_permission(self, jefe, document):
        response = _client_for(jefe).delete(f"/api/v1/assistant/documents/{document.id}/")
        assert response.status_code == 403

    def test_delete_404_for_missing_document(self, admin):
        response = _client_for(admin).delete("/api/v1/assistant/documents/999999/")
        assert response.status_code == 404

    def test_delete_removes_document_and_cascades_chunks(self, admin, document):
        chunk = DocumentChunk.objects.create(document=document, content="a", embedding=[0.1], page_number=1, chunk_index=0)
        response = _client_for(admin).delete(f"/api/v1/assistant/documents/{document.id}/")
        assert response.status_code == 200
        assert not KnowledgeDocument.objects.filter(pk=document.id).exists()
        assert not DocumentChunk.objects.filter(pk=chunk.id).exists()


class TestDocumentChunkBulkCreate:
    def test_requires_manage_permission(self, jefe, document):
        response = _client_for(jefe).post(
            f"/api/v1/assistant/documents/{document.id}/chunks/",
            {"chunks": [{"content": "x", "embedding": [0.1], "page_number": 1, "chunk_index": 0}]},
            format="json",
        )
        assert response.status_code == 403

    def test_404_for_missing_document(self, admin):
        response = _client_for(admin).post(
            "/api/v1/assistant/documents/999999/chunks/",
            {"chunks": [{"content": "x", "embedding": [0.1], "page_number": 1, "chunk_index": 0}]},
            format="json",
        )
        assert response.status_code == 404

    def test_creates_chunks_and_marks_ready(self, admin):
        document = KnowledgeDocument.objects.create(
            title="Doc", file_name="doc.pdf", status=KnowledgeDocument.Status.PROCESANDO,
            processing_error="pendiente", uploaded_by=admin,
        )
        response = _client_for(admin).post(
            f"/api/v1/assistant/documents/{document.id}/chunks/",
            {
                "content": "primer fragmento segundo fragmento",
                "chunks": [
                    {"content": "primer fragmento", "embedding": [0.1, 0.2], "page_number": 1, "chunk_index": 0},
                    {"content": "segundo fragmento", "embedding": [0.3, 0.4], "page_number": 1, "chunk_index": 1},
                ],
            },
            format="json",
        )
        assert response.status_code == 201
        assert response.data["count"] == 2
        document.refresh_from_db()
        assert document.status == KnowledgeDocument.Status.LISTO
        assert document.chunks.count() == 2
        assert document.content == "primer fragmento segundo fragmento"
        assert document.processing_error is None

    def test_content_is_optional(self, admin, document):
        response = _client_for(admin).post(
            f"/api/v1/assistant/documents/{document.id}/chunks/",
            {"chunks": [{"content": "x", "embedding": [0.1], "page_number": 1, "chunk_index": 0}]},
            format="json",
        )
        assert response.status_code == 201
        document.refresh_from_db()
        assert document.content is None

    def test_replaces_existing_chunks_on_retry(self, admin, document):
        DocumentChunk.objects.create(document=document, content="viejo", embedding=[0.9], page_number=1, chunk_index=0)
        response = _client_for(admin).post(
            f"/api/v1/assistant/documents/{document.id}/chunks/",
            {"chunks": [{"content": "nuevo", "embedding": [0.1], "page_number": 1, "chunk_index": 0}]},
            format="json",
        )
        assert response.status_code == 201
        assert document.chunks.count() == 1
        assert document.chunks.first().content == "nuevo"


class TestDocumentChunkList:
    def test_requires_authentication(self):
        response = APIClient().get("/api/v1/assistant/chunks/")
        assert response.status_code == 401

    def test_any_authenticated_role_can_read_no_knowledge_base_permission_required(self, sin_acceso, document):
        """El chat en modo 'hr' llama a esto para cualquier usuario
        autenticado — a diferencia de /assistant/documents/, NO exige
        `CanViewKnowledgeBase`."""
        DocumentChunk.objects.create(document=document, content="a", embedding=[0.1], page_number=1, chunk_index=0)
        response = _client_for(sin_acceso).get("/api/v1/assistant/chunks/")
        assert response.status_code == 200

    def test_returns_content_embedding_and_document_metadata(self, admin, document):
        DocumentChunk.objects.create(document=document, content="contenido del fragmento", embedding=[0.1, 0.2], page_number=3, chunk_index=0)
        response = _client_for(admin).get("/api/v1/assistant/chunks/")
        assert response.status_code == 200
        assert len(response.data) == 1
        row = response.data[0]
        assert row["content"] == "contenido del fragmento"
        assert row["embedding"] == [0.1, 0.2]
        assert row["page_number"] == 3
        assert row["doc_title"] == "Manual de RRHH"
        assert row["doc_file_name"] == "manual.pdf"

    def test_returns_flat_array_not_paginated_envelope(self, admin, document):
        response = _client_for(admin).get("/api/v1/assistant/chunks/")
        assert isinstance(response.data, list)
