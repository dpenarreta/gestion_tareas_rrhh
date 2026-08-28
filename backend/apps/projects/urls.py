from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import DocumentDetailView, ParticipantDetailView, PhaseDetailView, ProjectViewSet

router = DefaultRouter()
router.register("", ProjectViewSet, basename="projects")

# Fases 5b/5c/5d (ver docs/AUDIT_LOG.md § 2026-08-13): rutas explícitas
# ANTES del router — 2 identificadores en la URL, no una acción anidada
# de un solo `pk` (mismo criterio que
# `tasks/<int:task_id>/activities/<int:activity_id>/` en
# `apps/tasks/urls.py`).
urlpatterns = [
    path(
        "<int:project_id>/participants/<int:participant_id>/",
        ParticipantDetailView.as_view(),
        name="projects-participant-detail",
    ),
    path(
        "<int:project_id>/phases/<int:phase_id>/",
        PhaseDetailView.as_view(),
        name="projects-phase-detail",
    ),
    path(
        "<int:project_id>/documents/<int:document_id>/",
        DocumentDetailView.as_view(),
        name="projects-document-detail",
    ),
] + router.urls
