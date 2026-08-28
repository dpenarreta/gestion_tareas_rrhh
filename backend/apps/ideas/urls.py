"""Fase 11 de la migración de stack (ver docs/AUDIT_LOG.md §
2026-08-19)."""

from django.urls import path

from .views import IdeaDetailView, IdeaHistoryView, IdeaListCreateView, IdeaStatusView, IdeaVoteView

urlpatterns = [
    path("", IdeaListCreateView.as_view(), name="idea-list-create"),
    path("<int:idea_id>/", IdeaDetailView.as_view(), name="idea-detail"),
    path("<int:idea_id>/vote/", IdeaVoteView.as_view(), name="idea-vote"),
    path("<int:idea_id>/status/", IdeaStatusView.as_view(), name="idea-status"),
    path("<int:idea_id>/history/", IdeaHistoryView.as_view(), name="idea-history"),
]
