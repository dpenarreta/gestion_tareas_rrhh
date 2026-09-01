"""Fase 8 de la migración de stack (ver docs/AUDIT_LOG.md § 2026-08-18):
solo lectura de reportes ejecutivos ya generados — sin endpoint de
generación (ver docstring de `models.py`). `closure-status` agregado en
la Fase 34 (ver docs/AUDIT_LOG.md § 2026-08-21). `POST` de creación de
snapshot/auditoría agregados en la Fase 56 (ver docs/AUDIT_LOG.md §
2026-08-25) — el cálculo del snapshot sigue en Next.js, estos endpoints
solo persisten el resultado ya calculado. `user-lookup/` (puente
cuid→id numérico para el roster, Fase 57) retirado — decisión explícita
del usuario, ver docs/AUDIT_LOG.md § 2026-08-31: `roster/` expone el id
numérico de Django directo, sin traducción."""

from django.urls import path

from .views import (
    ClosureStatusView,
    CustomRangeTeamReportView,
    ExecutiveReportAuditCreateView,
    ExecutiveReportCreateView,
    ExecutiveReportDetailView,
    ExecutiveReportIntegrityIncidentCreateView,
    ExecutiveReportListView,
    MonthlyReportView,
    MonthlyTeamReportView,
    RangeTeamReportView,
    RosterView,
    TeamSubutilizationReportView,
)

urlpatterns = [
    # `list/`/`closure-status/`/`audit/`/`integrity-incidents/`/`*-team-kpis/`
    # ANTES del catch-all `<str:report_id>/` — de otro modo el converter
    # `str` los capturaría como un `report_id` literal.
    path("executive/list/", ExecutiveReportListView.as_view(), name="executive-report-list"),
    path("executive/closure-status/", ClosureStatusView.as_view(), name="executive-closure-status"),
    path("executive/audit/", ExecutiveReportAuditCreateView.as_view(), name="executive-report-audit-create"),
    path(
        "executive/integrity-incidents/",
        ExecutiveReportIntegrityIncidentCreateView.as_view(),
        name="executive-report-integrity-incident-create",
    ),
    path("executive/monthly-team-kpis/", MonthlyTeamReportView.as_view(), name="executive-monthly-team-kpis"),
    path("executive/custom-range-team-kpis/", CustomRangeTeamReportView.as_view(), name="executive-custom-range-team-kpis"),
    path("executive/range-team-kpis/", RangeTeamReportView.as_view(), name="executive-range-team-kpis"),
    path("executive/team-subutilization/", TeamSubutilizationReportView.as_view(), name="executive-team-subutilization"),
    path("executive/", ExecutiveReportCreateView.as_view(), name="executive-report-create"),
    path("roster/", RosterView.as_view(), name="reports-roster"),
    path("monthly-report/", MonthlyReportView.as_view(), name="reports-monthly-report"),
    path("executive/<str:report_id>/", ExecutiveReportDetailView.as_view(), name="executive-report-detail"),
]
