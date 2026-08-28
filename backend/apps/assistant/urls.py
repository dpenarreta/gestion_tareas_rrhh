"""Fase 58 de la migración de stack (ver docs/AUDIT_LOG.md § 2026-08-25)."""

from django.urls import path

from .views import (
    DocumentChunkBulkCreateView,
    DocumentChunkListView,
    KnowledgeDocumentDetailView,
    KnowledgeDocumentListCreateView,
)

urlpatterns = [
    path("documents/", KnowledgeDocumentListCreateView.as_view(), name="assistant-documents"),
    path("documents/<int:pk>/", KnowledgeDocumentDetailView.as_view(), name="assistant-document-detail"),
    path("documents/<int:pk>/chunks/", DocumentChunkBulkCreateView.as_view(), name="assistant-document-chunks"),
    path("chunks/", DocumentChunkListView.as_view(), name="assistant-chunks"),
]
