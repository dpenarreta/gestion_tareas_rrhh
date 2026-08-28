from rest_framework.routers import DefaultRouter

from .audit_views import AuditLogViewSet

router = DefaultRouter()
router.register("", AuditLogViewSet, basename="admin-audit-logs")

urlpatterns = router.urls
