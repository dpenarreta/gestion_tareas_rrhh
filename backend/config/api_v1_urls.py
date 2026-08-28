from django.urls import include, path
from drf_spectacular.views import SpectacularAPIView, SpectacularRedocView, SpectacularSwaggerView

from apps.analytics.views import (
    AnalyticsBundleView,
    AnalyticsDiagnosticsView,
    BenchmarkView,
    DataQualityView,
    EquilibrioView,
    HistoryView,
    InsightsView,
    OperationalRiskView,
    PredictionBundleView,
    PreventiveAlertsView,
    ProjectDelayView,
    SimulateAddParticipantsView,
    SimulateAdjustTargetTimeView,
    SimulateKpiView,
    SimulateRedistributeLoadView,
    TargetTimePrecisionView,
    TeamOperationalRiskView,
    TeamPreventiveAlertsView,
    TeamRecommendationsView,
    TeamSubutilizationView,
    TrendEngineView,
)
from apps.authentication.views import LoginAttemptsCleanupView
from apps.core.version_views import version_info
from apps.tasks.views import (
    ActivityReasonCreateView,
    ActivityReasonListView,
    ActivityReasonUpdateView,
    DayScheduleView,
)
from apps.users.self_service_views import BadgesView

urlpatterns = [
    path("health/", include("apps.core.health.urls")),
    path("version/", version_info, name="version-info"),
    path("schema/", SpectacularAPIView.as_view(), name="schema"),
    path(
        "schema/swagger-ui/",
        SpectacularSwaggerView.as_view(url_name="schema"),
        name="schema-swagger-ui",
    ),
    path("schema/redoc/", SpectacularRedocView.as_view(url_name="schema"), name="schema-redoc"),
    # --- Autenticación (login, refresh, sesiones, restablecimiento propio) ---
    path("auth/", include("apps.authentication.urls")),
    # --- Auto-servicio de usuario: usuarios asignables + tema propio
    # (Fase 26 de la migración de stack) — distinto de la administración
    # de usuarios (`admin/users/`, permisos `usuarios.*`), ver
    # docs/AUDIT_LOG.md § 2026-08-20 ---
    path("users/", include("apps.users.self_service_urls")),
    # --- Gamificación de perfil (Fase 27 de la migración de stack) —
    # calcula y persiste insignias sobre datos ya portados, ver
    # docs/AUDIT_LOG.md § 2026-08-20 ---
    path("profile/badges/", BadgesView.as_view(), name="profile-badges"),
    # --- Administración de usuarios ---
    path("admin/users/", include("apps.users.urls")),
    # --- Administración de roles ---
    path("admin/roles/", include("apps.roles.urls")),
    # --- Catálogo de permisos (solo lectura) ---
    path("admin/permissions/", include("apps.permissions.urls")),
    # --- Auditoría (solo lectura) ---
    path("admin/audit-logs/", include("apps.core.audit_urls")),
    # --- Tareas (Fase 3a/3b de la migración de stack) ---
    path("tasks/", include("apps.tasks.urls")),
    path("activity-reasons/", ActivityReasonListView.as_view(), name="activity-reasons"),
    # --- Horario del día para validar solapamientos (Fase 26 de la
    # migración de stack), ver docs/AUDIT_LOG.md § 2026-08-20 ---
    path("activities/day-schedule/", DayScheduleView.as_view(), name="activities-day-schedule"),
    # --- KPIs/Analytics (Fase 4b de la migración de stack) ---
    path("kpis/", include("apps.analytics.urls")),
    # --- Bundle completo de Analytics (Fase 4m de la migración de stack) ---
    path("analytics/<int:user_id>/", AnalyticsBundleView.as_view(), name="analytics-bundle"),
    # --- Rutas delgadas de Analytics: Insights/Equilibrio/Riesgo Operativo
    # individuales (Fase 16 de la migración de stack) — componen sobre el
    # motor YA portado (pipeline/health_score/operational_risk/
    # insights_engine), sin cutover de Next.js todavía, ver
    # docs/AUDIT_LOG.md § 2026-08-20 ---
    path("analytics/insights/<int:user_id>/", InsightsView.as_view(), name="analytics-insights"),
    path("analytics/equilibrio/<int:user_id>/", EquilibrioView.as_view(), name="analytics-equilibrio"),
    # --- Motor de Benchmarks Inteligente (Sprint 7, Fase 22 de la
    # migración de stack) — comparación entre pares del mismo cargo o
    # Benchmark Personal, ver docs/AUDIT_LOG.md § 2026-08-20 ---
    path("analytics/benchmarks/<int:user_id>/", BenchmarkView.as_view(), name="analytics-benchmarks"),
    # --- Simulador interactivo de KPIs individuales, 8 escenarios
    # (Fase 23 de la migración de stack) — NUNCA persiste nada, ver
    # docs/AUDIT_LOG.md § 2026-08-20 ---
    path("analytics/simulate/<int:user_id>/", SimulateKpiView.as_view(), name="analytics-simulate"),
    # Fase 20 (ver docs/AUDIT_LOG.md § 2026-08-20): ruta de equipo ANTES de
    # la individual, mismo criterio de legibilidad que kpis/team* — no
    # colisionan (el converter `int` no matchea "team").
    path("analytics/operational-risk/team/", TeamOperationalRiskView.as_view(), name="analytics-operational-risk-team"),
    path("analytics/operational-risk/<int:user_id>/", OperationalRiskView.as_view(), name="analytics-operational-risk"),
    # --- Motor Determinista de Recomendaciones — Matriz de Compatibilidad
    # Operativa (Fase 24 de la migración de stack), ver
    # docs/AUDIT_LOG.md § 2026-08-20 ---
    path("analytics/recommendations/team/", TeamRecommendationsView.as_view(), name="analytics-recommendations-team"),
    # --- Fase 17: history/target-time (por usuario) + data-quality
    # (self/team) — mismo criterio que la Fase 16, ensamblado sobre motor
    # ya portado, sin cutover de Next.js todavía, ver docs/AUDIT_LOG.md §
    # 2026-08-20. `diagnostics` (instrumentación de proceso ausente en
    # Django) queda deferido a una sub-fase futura ---
    path("analytics/history/<int:user_id>/", HistoryView.as_view(), name="analytics-history"),
    path("analytics/target-time/<int:user_id>/", TargetTimePrecisionView.as_view(), name="analytics-target-time"),
    path("analytics/data-quality/", DataQualityView.as_view(), name="analytics-data-quality"),
    # Fase 88 (ver docs/AUDIT_LOG.md § 2026-08-28): panel "Diagnóstico del
    # Motor", admin-only.
    path("analytics/diagnostics/", AnalyticsDiagnosticsView.as_view(), name="analytics-diagnostics"),
    # --- Inteligencia Preventiva: predicciones explicables + Trend Engine +
    # Alertas Preventivas + Simulador (Fases 9a/9b/9c de la migración de
    # stack) — solo lectura/cálculo puro sobre datos ya calculados por
    # Analytics/Capacidad Proyectada, sin cutover de Next.js todavía, ver
    # docs/AUDIT_LOG.md § 2026-08-18. GET/PUT /settings/prediction-window
    # queda deferido a una sub-fase futura (Centro de Configuración) ---
    path("predictive/predictions/<int:user_id>/", PredictionBundleView.as_view(), name="predictive-predictions"),
    path("predictive/trend/<int:user_id>/", TrendEngineView.as_view(), name="predictive-trend"),
    path("predictive/alerts/<int:user_id>/", PreventiveAlertsView.as_view(), name="predictive-alerts"),
    path("predictive/team-alerts/", TeamPreventiveAlertsView.as_view(), name="predictive-team-alerts"),
    path("predictive/team-subutilization/", TeamSubutilizationView.as_view(), name="predictive-team-subutilization"),
    path("predictive/project-delay/<int:project_id>/", ProjectDelayView.as_view(), name="predictive-project-delay"),
    path("predictive/simulate/redistribute/", SimulateRedistributeLoadView.as_view(), name="predictive-simulate-redistribute"),
    path("predictive/simulate/project/<int:project_id>/", SimulateAddParticipantsView.as_view(), name="predictive-simulate-project"),
    path("predictive/simulate/<int:user_id>/", SimulateAdjustTargetTimeView.as_view(), name="predictive-simulate-user"),
    # --- Proyectos, CRUD core (Fase 5a de la migración de stack) — sin
    # cutover de Next.js todavía, ver docs/AUDIT_LOG.md § 2026-08-13 ---
    path("projects/", include("apps.projects.urls")),
    # --- Escritorio Digital: Notas + Recordatorios (Fases 7a-7b de la
    # migración de stack) — sin cutover de Next.js todavía, ver
    # docs/AUDIT_LOG.md § 2026-08-17. `apps.desk.urls` ya define sus 2
    # prefijos propios (`desk-notes/`/`desk-reminders/`), por eso se
    # incluye en la raíz acá ---
    path("", include("apps.desk.urls")),
    # --- Reportes Ejecutivos, solo lectura de snapshots ya generados
    # (Fase 8 de la migración de stack) — sin endpoint de generación
    # todavía, ver docs/AUDIT_LOG.md § 2026-08-18 ---
    path("reports/", include("apps.reports.urls")),
    # --- Reuniones, CRUD completo con integración real de Zoom (Fase 10
    # de la migración de stack) — sin cutover de Next.js todavía, ver
    # docs/AUDIT_LOG.md § 2026-08-19 ---
    path("meetings/", include("apps.meetings.urls")),
    # --- Mejora Continua: ideas + votos + máquina de estados con
    # historial (Fase 11 de la migración de stack) — sin cutover de
    # Next.js todavía, ver docs/AUDIT_LOG.md § 2026-08-19 ---
    path("ideas/", include("apps.ideas.urls")),
    # --- Solicitudes LOPD: cola de solicitudes de titulares + export
    # "mis datos" (Fase 12 de la migración de stack) — sin borrado real
    # automatizado (gestión 100% manual del Administrador, ver
    # docs/AUDIT_LOG.md § 2026-08-19); gate de consentimiento deferido a
    # una sub-fase futura ---
    path("data-requests/", include("apps.data_requests.urls")),
    # --- Centro de Configuración, arranque acotado (Fase 13 de la
    # migración de stack): solo la ventana histórica de predicción,
    # deferida desde la Fase 9c — no el rediseño completo de /settings,
    # ver docs/AUDIT_LOG.md § 2026-08-19 ---
    path("settings/", include("apps.configuration.urls")),
    # --- CRUD de Motivos de Actividad (Fase 30 de la migración de
    # stack) — vive en `apps.tasks` (dueña del modelo `ActivityReason`
    # desde la Fase 3b), montado bajo `settings/` para calzar con
    # `src/app/api/settings/activity-reasons/`, ver docs/AUDIT_LOG.md §
    # 2026-08-21 ---
    path("settings/activity-reasons/", ActivityReasonCreateView.as_view(), name="settings-activity-reasons"),
    path(
        "settings/activity-reasons/<int:pk>/",
        ActivityReasonUpdateView.as_view(),
        name="settings-activity-reason-detail",
    ),
    # --- Depuración de `LoginAttempt` (Fase 33 de la migración de
    # stack) — vive en `apps.authentication` (dueña del modelo),
    # montado bajo `settings/` para calzar con
    # `src/app/api/settings/login-attempts/cleanup/`, ver
    # docs/AUDIT_LOG.md § 2026-08-21 ---
    path("settings/login-attempts/cleanup/", LoginAttemptsCleanupView.as_view(), name="settings-login-attempts-cleanup"),
    # --- Notificaciones in-app: listar + marcar leídas (Fase 15 de la
    # migración de stack) — apps.notifications existe desde la Fase 3f
    # (notify()/notify_many(), ya consumido internamente por Tareas/
    # Proyectos/Escritorio Digital/Reuniones/Ideas/LOPD) pero sin
    # superficie HTTP propia hasta ahora, ver docs/AUDIT_LOG.md §
    # 2026-08-20 ---
    path("notifications/", include("apps.notifications.urls")),
    # --- Equipo: lista de subordinados + tareas de un subordinado puntual
    # (Fase 18 de la migración de stack) — sin cutover de Next.js todavía,
    # ver docs/AUDIT_LOG.md § 2026-08-20 ---
    path("team/", include("apps.team.urls")),
    # --- Comunicados: listar vigentes + publicar/eliminar (liderazgo) —
    # (Fase 25 de la migración de stack), ver docs/AUDIT_LOG.md §
    # 2026-08-20 ---
    path("announcements/", include("apps.announcements.urls")),
    # --- Dashboard: agregación personal (tareas, KPIs, comunicados,
    # reuniones, proyectos, actividad del área) + orden de tarjetas
    # (Fase 25 de la migración de stack) — ensamblado sobre motor YA
    # portado, sin motor nuevo. `nova-message` (Nova/Groq) queda fuera de
    # alcance, ver docs/AUDIT_LOG.md § 2026-08-20 ---
    path("dashboard/", include("apps.dashboard.urls")),
    # --- Base de conocimiento del Asistente LLM/RAG: documentos + chunks
    # con embedding ya calculado (Fase 58 de la migración de stack) — el
    # cálculo de embeddings sigue en Next.js (@xenova/transformers), acá
    # solo se persiste el resultado, ver docs/AUDIT_LOG.md § 2026-08-25 ---
    path("assistant/", include("apps.assistant.urls")),
    # Nota: apps.hierarchy (RoleVisibility/RoleNotificationTarget) no expone
    # rutas HTTP en esta fase — los módulos de negocio que la consuman viven
    # en el mismo proceso Django y la usan vía apps.hierarchy.services,
    # sin necesidad de un endpoint (ver plan de Fase 1).
]
