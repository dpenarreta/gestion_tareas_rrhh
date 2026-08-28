from django.urls import path

from .views import (
    ExecutiveDashboardView,
    KpiMeRangeView,
    KpiMeView,
    KpiUserView,
    TeamCapacityView,
    TeamKpiView,
)

urlpatterns = [
    path("me/range/", KpiMeRangeView.as_view(), name="kpis-me-range"),
    path("me/", KpiMeView.as_view(), name="kpis-me"),
    # Fase 19 (ver docs/AUDIT_LOG.md § 2026-08-20): rutas explícitas ANTES
    # del genérico `<int:user_id>/` — no colisionan (el converter `int` no
    # matchea "team"/"team-capacity"/"executive"), pero se listan primero
    # por legibilidad, mismo criterio que `apps.tasks.urls`.
    path("team-capacity/", TeamCapacityView.as_view(), name="kpis-team-capacity"),
    path("team/", TeamKpiView.as_view(), name="kpis-team"),
    # Fase 21 (ver docs/AUDIT_LOG.md § 2026-08-20).
    path("executive/", ExecutiveDashboardView.as_view(), name="kpis-executive"),
    path("<int:user_id>/", KpiUserView.as_view(), name="kpis-user"),
]
