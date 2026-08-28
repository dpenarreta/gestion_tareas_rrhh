"""Fase 18 de la migración de stack (ver docs/AUDIT_LOG.md §
2026-08-20)."""

from django.urls import path

from .views import TeamListView, TeamMemberTasksView

urlpatterns = [
    path("", TeamListView.as_view(), name="team-list"),
    path("<int:user_id>/tasks/", TeamMemberTasksView.as_view(), name="team-member-tasks"),
]
