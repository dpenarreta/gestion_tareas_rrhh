"""Fases 13/28/29/31/32/33/34/35/83 de la migración de stack (ver
docs/AUDIT_LOG.md § 2026-08-19/2026-08-20/2026-08-21/2026-08-27)."""

from django.urls import path

from .views import (
    AnalyticsConfigView,
    ConfigHistoryRestoreDefaultView,
    ConfigHistoryView,
    ConsentTextView,
    DataQualityView,
    DocumentationView,
    EscritorioDigitalConfigView,
    FavoritesView,
    HolidayDetailView,
    HolidayListView,
    KpiStartDateView,
    LeaveRecordDetailView,
    LeaveRecordListView,
    NormalizationCurvesView,
    NotificationRulesView,
    NovaCacheView,
    PredictionWindowSettingsView,
    RetentionPolicyPurgeView,
    RetentionPolicyView,
    RetroactiveWindowView,
    RoleCompatibilityView,
    RoleTargetsView,
    SeguridadConfigView,
    SnoozePresetsView,
    SpecialStatusDetailView,
    SpecialStatusListView,
    SystemInfoView,
    TrabajoAvanzadoView,
    WelcomeMessageView,
    WorkloadConfigView,
)

urlpatterns = [
    path(
        "prediction-window/",
        PredictionWindowSettingsView.as_view(),
        name="prediction-window-settings",
    ),
    path("retroactive-window/", RetroactiveWindowView.as_view(), name="retroactive-window"),
    path("snooze-presets/", SnoozePresetsView.as_view(), name="snooze-presets"),
    path("favorites/", FavoritesView.as_view(), name="config-favorites"),
    path("welcome-message/", WelcomeMessageView.as_view(), name="welcome-message"),
    path("consent-text/", ConsentTextView.as_view(), name="consent-text"),
    path("role-targets/", RoleTargetsView.as_view(), name="role-targets"),
    path("role-compatibility/", RoleCompatibilityView.as_view(), name="role-compatibility"),
    path("holidays/", HolidayListView.as_view(), name="holidays"),
    path("holidays/<int:pk>/", HolidayDetailView.as_view(), name="holiday-detail"),
    path("leave-records/", LeaveRecordListView.as_view(), name="leave-records"),
    path("leave-records/<int:pk>/", LeaveRecordDetailView.as_view(), name="leave-record-detail"),
    path("special-status/", SpecialStatusListView.as_view(), name="special-status"),
    path(
        "special-status/<int:pk>/", SpecialStatusDetailView.as_view(), name="special-status-detail"
    ),
    path("workload-config/", WorkloadConfigView.as_view(), name="workload-config"),
    path("kpi-start-date/", KpiStartDateView.as_view(), name="kpi-start-date"),
    path("retention-policy/", RetentionPolicyView.as_view(), name="retention-policy"),
    path(
        "retention-policy/purge/", RetentionPolicyPurgeView.as_view(), name="retention-policy-purge"
    ),
    path(
        "escritorio-digital-config/",
        EscritorioDigitalConfigView.as_view(),
        name="escritorio-digital-config",
    ),
    path("analytics-config/", AnalyticsConfigView.as_view(), name="analytics-config"),
    path("normalization-curves/", NormalizationCurvesView.as_view(), name="normalization-curves"),
    path("seguridad-config/", SeguridadConfigView.as_view(), name="seguridad-config"),
    path("trabajo-avanzado/", TrabajoAvanzadoView.as_view(), name="trabajo-avanzado"),
    path("system-info/", SystemInfoView.as_view(), name="system-info"),
    path("config-history/", ConfigHistoryView.as_view(), name="config-history"),
    path(
        "config-history/restore-default/",
        ConfigHistoryRestoreDefaultView.as_view(),
        name="config-history-restore-default",
    ),
    path("documentation/", DocumentationView.as_view(), name="documentation"),
    path("nova-cache/", NovaCacheView.as_view(), name="nova-cache"),
    path("data-quality/", DataQualityView.as_view(), name="settings-data-quality"),
    path("notification-rules/", NotificationRulesView.as_view(), name="notification-rules"),
]
