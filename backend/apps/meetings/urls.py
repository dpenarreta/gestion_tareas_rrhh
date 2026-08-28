"""Fase 10 de la migración de stack (ver docs/AUDIT_LOG.md §
2026-08-19)."""

from django.urls import path

from .views import MeetingDetailView, MeetingListCreateView

urlpatterns = [
    path("", MeetingListCreateView.as_view(), name="meeting-list-create"),
    path("<int:meeting_id>/", MeetingDetailView.as_view(), name="meeting-detail"),
]
