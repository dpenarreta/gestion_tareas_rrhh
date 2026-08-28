"""Fases 7a-7f (ver docs/AUDIT_LOG.md § 2026-08-17): 3 prefijos
separados dentro de la misma app — réplica de que el TS también sirve
`/api/desk-notes/**`, `/api/desk-reminders/**` y `/api/desk/**` como
raíces independientes, no anidadas una bajo la otra."""

from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import DeskNoteViewSet, DeskReminderViewSet, DeskSearchView, DeskTodayView

notes_router = DefaultRouter()
notes_router.register("", DeskNoteViewSet, basename="desk-notes")

reminders_router = DefaultRouter()
reminders_router.register("", DeskReminderViewSet, basename="desk-reminders")

urlpatterns = [
    path("desk-notes/", include(notes_router.urls)),
    path("desk-reminders/", include(reminders_router.urls)),
    path("desk/today/", DeskTodayView.as_view(), name="desk-today"),
    path("desk/search/", DeskSearchView.as_view(), name="desk-search"),
]
