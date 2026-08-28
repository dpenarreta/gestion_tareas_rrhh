"""Fase 12 de la migración de stack (ver docs/AUDIT_LOG.md §
2026-08-19)."""

from django.urls import path

from .views import DataRequestDetailView, DataRequestListCreateView, MyDataExportView

urlpatterns = [
    path("", DataRequestListCreateView.as_view(), name="data-request-list-create"),
    path("my-data/", MyDataExportView.as_view(), name="data-request-my-data"),
    path("<int:request_id>/", DataRequestDetailView.as_view(), name="data-request-detail"),
]
