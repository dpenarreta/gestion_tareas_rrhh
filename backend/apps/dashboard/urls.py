"""Fase 25 de la migración de stack (ver docs/AUDIT_LOG.md § 2026-08-20)."""

from django.urls import path

from .views import DashboardCardOrderView, DashboardView

urlpatterns = [
    path("", DashboardView.as_view(), name="dashboard"),
    path("card-order/", DashboardCardOrderView.as_view(), name="dashboard-card-order"),
]
