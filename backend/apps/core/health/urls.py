from django.urls import path

from .views import health_check, readiness_check

urlpatterns = [
    path("", health_check, name="health-check"),
    path("ready/", readiness_check, name="health-ready"),
]
