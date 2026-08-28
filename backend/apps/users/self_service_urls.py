"""Fase 26 de la migración de stack (ver docs/AUDIT_LOG.md § 2026-08-20).
`activity-format/`/`<pk>/view-preferences/` agregados en la Fase 55
(ver docs/AUDIT_LOG.md § 2026-08-25)."""

from django.urls import path

from .self_service_views import (
    ActivityFormatView,
    AssignableUsersView,
    UserThemeView,
    UserViewPreferencesView,
)

urlpatterns = [
    path("assignable/", AssignableUsersView.as_view(), name="users-assignable"),
    path("activity-format/", ActivityFormatView.as_view(), name="users-activity-format"),
    path("<int:pk>/theme/", UserThemeView.as_view(), name="users-theme"),
    path("<int:pk>/view-preferences/", UserViewPreferencesView.as_view(), name="users-view-preferences"),
]
