from django.urls import path

from .views import PermissionCatalogView

urlpatterns = [
    path("", PermissionCatalogView.as_view(), name="admin-permissions-catalog"),
]
