from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import (
    ActivityCommentListCreateView,
    ActivityDetailView,
    CloseMonthView,
    EndDateBulkApproveView,
    PendingValidationsView,
    RepositoryDetailView,
    RepositoryListView,
    TargetTimeBulkValidateView,
    TaskImportView,
    TaskTemplateView,
    TaskViewSet,
)

router = DefaultRouter()
router.register("", TaskViewSet, basename="tasks")

# Sub-fases 3c-bulk/3d (ver docs/AUDIT_LOG.md § 2026-08-07): rutas
# explícitas ANTES del router — no son acciones anidadas de `TaskViewSet`
# (no operan sobre un `pk` de tarea), aunque no colisionan con sus
# patrones de detalle por ir primero en la lista (Django resuelve por
# orden, y `close-month`/`repository` de un solo segmento coincidirían
# con `<pk>/` si el router fuera primero).
urlpatterns = [
    path("target-time/bulk-validate/", TargetTimeBulkValidateView.as_view(), name="tasks-target-time-bulk-validate"),
    path("end-date/bulk-approve/", EndDateBulkApproveView.as_view(), name="tasks-end-date-bulk-approve"),
    path("validations/pending/", PendingValidationsView.as_view(), name="tasks-validations-pending"),
    path("close-month/", CloseMonthView.as_view(), name="tasks-close-month"),
    path("repository/", RepositoryListView.as_view(), name="tasks-repository"),
    path("repository/<int:year>/<int:month>/", RepositoryDetailView.as_view(), name="tasks-repository-detail"),
    path("import/", TaskImportView.as_view(), name="tasks-import"),
    path("template/", TaskTemplateView.as_view(), name="tasks-template"),
    path(
        "<int:task_id>/activities/<int:activity_id>/",
        ActivityDetailView.as_view(),
        name="tasks-activity-detail",
    ),
    path(
        "<int:task_id>/activities/<int:activity_id>/comments/",
        ActivityCommentListCreateView.as_view(),
        name="tasks-activity-comments",
    ),
] + router.urls
