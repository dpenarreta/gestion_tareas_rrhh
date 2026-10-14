from django.urls import path

from . import views

urlpatterns = [
    path("me/", views.MeView.as_view(), name="novedades-me"),
    path("supervisors/", views.SupervisorListView.as_view(), name="novedades-supervisors"),
    path("periods/", views.PeriodListView.as_view(), name="novedades-periods"),
    path("periods/status/", views.PeriodStatusView.as_view(), name="novedades-period-status"),
    path(
        "periods/close-summary/", views.CloseSummaryView.as_view(), name="novedades-close-summary"
    ),
    path("periods/close/", views.ClosePeriodView.as_view(), name="novedades-close"),
    path("collaborators/", views.CollaboratorListView.as_view(), name="novedades-collaborators"),
    path(
        "collaborators/template/",
        views.CollaboratorTemplateView.as_view(),
        name="novedades-collaborators-template",
    ),
    path(
        "collaborators/<int:pk>/",
        views.CollaboratorDetailView.as_view(),
        name="novedades-collaborator",
    ),
    path(
        "collaborators/<int:pk>/status/",
        views.CollaboratorStatusView.as_view(),
        name="novedades-collaborator-status",
    ),
    path(
        "collaborators/<int:pk>/reassign/",
        views.CollaboratorReassignView.as_view(),
        name="novedades-collaborator-reassign",
    ),
    path(
        "collaborators/<int:pk>/history/",
        views.CollaboratorHistoryView.as_view(),
        name="novedades-collaborator-history",
    ),
    path("worked-days/", views.WorkedDayMatrixView.as_view(), name="novedades-worked-days"),
    path("worked-days/save/", views.WorkedDaySaveView.as_view(), name="novedades-worked-days-save"),
    path(
        "worked-days/export/",
        views.WorkedDayExportView.as_view(),
        name="novedades-worked-days-export",
    ),
    path("overtime/", views.OvertimeListView.as_view(), name="novedades-overtime"),
    path("overtime/bulk/", views.OvertimeBulkView.as_view(), name="novedades-overtime-bulk"),
    path(
        "overtime/months/", views.OvertimeMonthListView.as_view(), name="novedades-overtime-months"
    ),
    path(
        "overtime/months/check/",
        views.OvertimeMonthCheckView.as_view(),
        name="novedades-overtime-month-check",
    ),
    path(
        "overtime/months/close/",
        views.OvertimeMonthCloseView.as_view(),
        name="novedades-overtime-month-close",
    ),
    path("depuration/", views.DepurationView.as_view(), name="novedades-depuration"),
    path(
        "depuration/create/",
        views.DepurationCreateView.as_view(),
        name="novedades-depuration-create",
    ),
    path("depuration/rows/", views.DepurationRowsView.as_view(), name="novedades-depuration-rows"),
    path(
        "depuration/rows/save/",
        views.DepurationSaveView.as_view(),
        name="novedades-depuration-save",
    ),
    path(
        "depuration/history/",
        views.DepurationHistoryView.as_view(),
        name="novedades-depuration-history",
    ),
    path(
        "depuration/export/",
        views.DepurationExportView.as_view(),
        name="novedades-depuration-export",
    ),
    path(
        "deadlines/settings/",
        views.DeadlineSettingsView.as_view(),
        name="novedades-deadline-settings",
    ),
    path(
        "overtime/settings/",
        views.OvertimeSettingsView.as_view(),
        name="novedades-overtime-settings",
    ),
    path(
        "overtime/template/",
        views.OvertimeTemplateView.as_view(),
        name="novedades-overtime-template",
    ),
    path(
        "worked-days/template/",
        views.WorkedDayTemplateView.as_view(),
        name="novedades-worked-days-template",
    ),
    path("overtime/export/", views.OvertimeExportView.as_view(), name="novedades-overtime-export"),
    path(
        "overtime/<int:pk>/", views.OvertimeDetailView.as_view(), name="novedades-overtime-detail"
    ),
    path("imports/preview/", views.ImportPreviewView.as_view(), name="novedades-import-preview"),
    path(
        "imports/<int:pk>/confirm/",
        views.ImportConfirmView.as_view(),
        name="novedades-import-confirm",
    ),
    path(
        "imports/<int:pk>/cancel/", views.ImportCancelView.as_view(), name="novedades-import-cancel"
    ),
    path(
        "imports/<int:pk>/errors/", views.ImportErrorsView.as_view(), name="novedades-import-errors"
    ),
    path(
        "corrections/worked-day/",
        views.WorkedDayCorrectionView.as_view(),
        name="novedades-correction-worked-day",
    ),
    path(
        "corrections/overtime/",
        views.OvertimeCorrectionView.as_view(),
        name="novedades-correction-overtime",
    ),
    path("history/", views.HistoryView.as_view(), name="novedades-history"),
    path("repository/", views.RepositoryView.as_view(), name="novedades-repository"),
    path(
        "permissions/config/",
        views.PermissionConfigView.as_view(),
        name="novedades-permissions-config",
    ),
    path(
        "permissions/roles/", views.RolePermissionView.as_view(), name="novedades-permissions-roles"
    ),
    path(
        "permissions/users/",
        views.OperationalUsersView.as_view(),
        name="novedades-permissions-users",
    ),
    path(
        "permissions/effective/<int:user_id>/",
        views.EffectivePermissionsView.as_view(),
        name="novedades-permissions-effective",
    ),
    path("permissions/overrides/", views.OverrideListView.as_view(), name="novedades-overrides"),
    path(
        "permissions/overrides/<int:pk>/revoke/",
        views.OverrideRevokeView.as_view(),
        name="novedades-override-revoke",
    ),
    path(
        "exit-notifications/recipients/",
        views.ExitRecipientListView.as_view(),
        name="novedades-exit-recipients",
    ),
    path(
        "exit-notifications/recipients/<int:pk>/",
        views.ExitRecipientDetailView.as_view(),
        name="novedades-exit-recipient",
    ),
    path(
        "exit-notifications/",
        views.ExitNotificationListView.as_view(),
        name="novedades-exit-notifications",
    ),
    path(
        "exit-notifications/<int:pk>/retry/",
        views.ExitNotificationRetryView.as_view(),
        name="novedades-exit-notification-retry",
    ),
    path(
        "movements/access/", views.MovementAccessView.as_view(), name="novedades-movements-access"
    ),
    path(
        "movements/options/",
        views.MovementOptionsView.as_view(),
        name="novedades-movements-options",
    ),
    path(
        "movements/entries/",
        views.MovementEntriesView.as_view(),
        name="novedades-movements-entries",
    ),
    path("movements/exits/", views.MovementExitsView.as_view(), name="novedades-movements-exits"),
    path(
        "movements/entries/export/",
        views.MovementExportView.as_view(kind="entries"),
        name="novedades-movements-entries-export",
    ),
    path(
        "movements/exits/export/",
        views.MovementExportView.as_view(kind="exits"),
        name="novedades-movements-exits-export",
    ),
    path(
        "movements/permissions/",
        views.MovementPermissionListView.as_view(),
        name="novedades-movements-permissions",
    ),
    path(
        "movements/permissions/<int:user_id>/",
        views.MovementPermissionDetailView.as_view(),
        name="novedades-movements-permission",
    ),
]
