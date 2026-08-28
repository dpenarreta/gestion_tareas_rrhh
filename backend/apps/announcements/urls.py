"""Fase 25 de la migración de stack (ver docs/AUDIT_LOG.md § 2026-08-20)."""

from django.urls import path

from .views import AnnouncementDetailView, AnnouncementListView

urlpatterns = [
    path("", AnnouncementListView.as_view(), name="announcement-list"),
    path("<int:pk>/", AnnouncementDetailView.as_view(), name="announcement-detail"),
]
