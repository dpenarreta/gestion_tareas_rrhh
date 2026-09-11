# Versionado de Nexo

> Fuente oficial de verdad del versionado del sistema. Se actualiza en cada
> implementación relevante — ver la sección "Mantenimiento" al final de este
> documento y `docs/CHANGELOG.md` para el detalle de cada cambio.

## Estado actual

| Componente | Versión | Notas |
|---|---|---|
| **NEXO** (producto) | **v1.155.2** | Ver `docs/CHANGELOG.md` para el detalle de qué introdujo cada versión |
| **Analytics Engine** | v1.5.0 | `ANALYTICS_ENGINE_VERSION` en `src/lib/analytics.ts` — sin cambios (Validación de Fecha Fin es gobierno/trazabilidad sobre `Task.endDate`, no una fórmula de Analytics) |
| **Formulas Set** | v4.4 | `FORMULA_SET_VERSION` en `src/lib/analytics.ts` — sin cambios desde Sprint Analytics 2.0 (2026-07-24, `FORMULA_VERSIONS.capacidadDisponible`/`equilibrioOperativo` → `"1.1"`) |
| **Executive Reporting Engine** | v2.0 | `EXECUTIVE_REPORTING_ENGINE_VERSION` en `src/lib/executiveReporting/version.ts` — sin cambios |
| **API** | Sin versionado explícito (rutas internas de Next.js, no una API pública versionada) | Ver `docs/ARCHITECTURE.md` |
| **Backend Django (migración de stack)** | Fase 3 (Tareas) y Fase 4 (KPIs/Analytics) COMPLETAS; Fase 5 (Proyectos) COMPLETA incluida Papelera; Fase 6 (decommission de PostgreSQL) **COMPLETA a nivel de código desde la Fase 90 (2026-08-28) — ver más abajo**; Fase 7 (Escritorio Digital) COMPLETA incluida Papelera de Notas; Fase 8 (Reportes Ejecutivos) EN CURSO — solo lectura de snapshots ya generados; Fase 9 (Inteligencia Preventiva) CASI COMPLETA — Trend/Prediction Engine + Alertas Preventivas + wiring de equipo + Simulador; Fase 10 (Reuniones) COMPLETA; Fase 11 (Mejora Continua) COMPLETA; Fase 12 (Solicitudes LOPD) COMPLETA; Fase 13 (Centro de Configuración) EN CURSO — arranque acotado; Fase 14 (Papelera transversal / Centro de Recuperación) COMPLETA; Fase 15 (Notificaciones, superficie HTTP) COMPLETA; Fase 16 (Analytics, 3 rutas delgadas) EN CURSO; Fase 17 (Analytics, 3 rutas delgadas más) EN CURSO; Fase 18 (Equipo) COMPLETA; Fase 19 (Analytics, `kpis/team`+`kpis/team-capacity`) EN CURSO; Fase 20 (Analytics, `operational-risk/team`) EN CURSO; Fase 21 (Analytics, `kpis/executive`) EN CURSO; Fase 22 (Analytics, Benchmarks Inteligente) EN CURSO; Fase 23 (Analytics, simulador KPI-level) EN CURSO; Fase 24 (Analytics, `recommendations/team`) EN CURSO — 13 de ~16 rutas; Fase 25 (Dashboard + Comunicados) COMPLETA; Fase 26 (cabos sueltos de auto-servicio) COMPLETA; Fase 27 (Gamificación de perfil) COMPLETA; Fase 28 (Centro de Configuración, 6 endpoints) COMPLETA; Fase 29 (Centro de Configuración, CRUD Feriados/Permisos/Estados Especiales) COMPLETA; Fase 30 (Centro de Configuración, CRUD Motivos de Actividad) COMPLETA; Fase 31 (Centro de Configuración, 5 endpoints más) COMPLETA; Fase 32 (Centro de Configuración, 4 endpoints más) COMPLETA; Fase 33 (Centro de Configuración, 4 endpoints más — catálogo esencialmente cerrado) COMPLETA; Fase 34 (Centro de Configuración, informe de calidad del dato + 2 rutas más — catálogo 100% cerrado) COMPLETA; **Fase 35 (Centro de Configuración, `notification-rules` — catálogo cerrado en su totalidad) COMPLETA** | `backend/`, núcleo de seguridad + admin de usuarios + módulo Tareas COMPLETO + KPIs/Analytics COMPLETO (bundle + Insights/Equilibrio/Riesgo Operativo/History/Target-Time/Data-Quality/Team/Team-Capacity/Operational-Risk-Team/Executive/Benchmarks/Simulate/Recommendations-Team) + Proyectos COMPLETO (incluida Papelera: `trash`/`restore`/`permanent`) + módulo Auth completo (incluido `reset-password`) + Escritorio Digital COMPLETO (incluida Papelera de Notas) sirviendo tráfico real desde Next.js salvo `DELETE /api/desk-notes/[id]` + Reportes Ejecutivos — lectura de snapshots ya generados (`apps.reports`, sin cutover, sin endpoint de generación) + Inteligencia Preventiva — Trend/Prediction Engine + Alertas Preventivas + Simulador (`trend_engine.py`/`prediction_engine.py`/`preventive_intelligence.py`/`simulate_engine.py`, sin cutover, config de ventana ya con endpoint admin) + Reuniones (`apps.meetings`, integración real de Zoom con fallback simulado, sin cutover) + Mejora Continua (`apps.ideas`, votos + máquina de estados con historial, sin cutover, gap documentado: badge "innovador" no asignado) + Solicitudes LOPD (`apps.data_requests`, cola de solicitudes + export "mis datos", sin cutover) + Centro de Configuración (`prediction-window` + gate de consentimiento en `User`, sin cutover) + Papelera transversal / Centro de Recuperación (`apps.recovery`, `ENTITY_REGISTRY` con adaptadores Proyectos/Notas, asimetría fiel al TS, sin cutover) + Notificaciones (`apps.notifications`, `GET/PATCH /notifications/` + `PATCH /notifications/<id>/`, `dedup_key` nuevo, sin cutover deliberado) + Equipo (`apps.team`, nueva app sin modelos propios — `GET /team/` + `GET /team/<id>/tasks/`, `mask_email` nuevo en `apps.core`, sin cutover) + Analytics — 13 rutas delgadas (`GET /analytics/insights/<id>/` + `/equilibrio/<id>/` + `/operational-risk/<id>/` + `/operational-risk/team/` + `/history/<id>/` + `/target-time/<id>/` + `/data-quality/` + `/kpis/team/` + `/kpis/team-capacity/` + `/kpis/executive/` + `/analytics/benchmarks/<id>/` + `POST /analytics/simulate/<id>/` + `/analytics/recommendations/team/`, sin cutover) + Dashboard + Comunicados (`apps.dashboard`/`apps.announcements`, nuevas — `GET /dashboard/` + `PATCH /dashboard/card-order/` + `GET`/`POST /announcements/` + `DELETE /announcements/<id>/`, sin cutover; `nova-message` fuera de alcance) + Auto-servicio de usuario (`apps.users.self_service_views` — `GET /users/assignable/` + `PATCH /users/<id>/theme/` + `GET /profile/badges/`, `User.theme` nuevo) + `GET /activities/day-schedule/` (`apps.tasks`, validación de solapamiento de horario) + **Centro de Configuración — 31 endpoints, catálogo `settings/*` cerrado en su totalidad** (`GET/PUT /settings/prediction-window/` desde la Fase 13; `GET /settings/retroactive-window/` + `GET /settings/snooze-presets/` + `GET/PATCH /settings/favorites/` + `GET/PUT /settings/welcome-message/` + `GET/PATCH /settings/role-targets/` + `GET/PATCH /settings/role-compatibility/` desde la Fase 28; `GET/POST /settings/holidays/` + `DELETE .../<id>/` + `GET/POST /settings/leave-records/` + `DELETE .../<id>/` + `GET/POST /settings/special-status/` + `PATCH/DELETE .../<id>/` desde la Fase 29; `POST /settings/activity-reasons/` + `PATCH .../<id>/` desde la Fase 30; `GET/PUT /settings/workload-config/` + `GET/PATCH /settings/kpi-start-date/` + `GET/PUT /settings/retention-policy/` + `GET/PUT /settings/escritorio-digital-config/` + `GET/PATCH /settings/analytics-config/` desde la Fase 31; `GET/PATCH /settings/normalization-curves/` + `GET/PUT /settings/seguridad-config/` + `GET/PUT /settings/trabajo-avanzado/` + `GET /settings/system-info/` desde la Fase 32; `GET /settings/config-history/` + `POST /settings/config-history/restore-default/` + `GET /settings/documentation/` + `GET/POST /settings/login-attempts/cleanup/` desde la Fase 33; `GET /settings/data-quality/` + `GET/PUT /settings/nova-cache/` desde la Fase 34 (más `GET /reports/executive/closure-status/`, fuera de `settings/*`); `GET/PUT /settings/notification-rules/` desde la Fase 35, solo configuración — gap documentado, `CommentService.create_comment`/`RETROACTIVE_NOTIFY_ROLES` sin reconectar) — `GET/POST /settings/retention-policy/purge/` se agrega recién en la Fase 83, ver más abajo; **Fase 36 (primer cutover de `route.ts` en `settings/*`) COMPLETA — 9 de 24 endpoints con `route.ts` ya redirigido a Django** (`activity-reasons` POST/PATCH, `login-attempts/cleanup`, `escritorio-digital-config`, `snooze-presets`, `retroactive-window`, `data-quality` completos; `seguridad-config`/`trabajo-avanzado` parciales campo por campo — `passwordMinLength`/`workdayEndHour` siguen en Postgres por consumidor real todavía TS). Los 15 restantes (`prediction-window`, `welcome-message`, `role-targets`, `role-compatibility`, `holidays`, `leave-records`, `special-status`, `workload-config`, `kpi-start-date`, `analytics-config`, `normalization-curves`, `retention-policy`, `nova-cache`, `system-info`, `config-history`+`restore-default`, `documentation`, `favorites`) quedan deliberadamente sin cutover — su consumidor real sigue en Analytics/Predictive/Dashboard (sin cutover) o comparten almacenamiento con otro módulo sin cortar; **Fase 37 (cutover de `profile/badges` + `activities/day-schedule`) COMPLETA** — ambos endpoints "yo mismo" redirigidos a Django (reenvío directo, ya en camelCase); **Fase 38 (cutover de `users/[id]/theme` + tema inicial de `layout.tsx`) COMPLETA** — se agregó `theme` a `UserPublicSerializer` (Django) y el `route.ts` resuelve el id numérico de Django vía `GET /auth/me/`; `layout.tsx` se cortó en el mismo cambio para no introducir un bug de staleness. `users/assignable`/`view-preferences` siguen diferidos (comparten `viewPreferences` con otros módulos sin cortar, o tienen consumidores con expectativas de id incompatibles); **Fase 39 (cutover de la Papelera de Proyectos) COMPLETA** — `DELETE /projects/[id]/` + `GET /projects/trash/` + `POST /projects/[id]/restore/` + `DELETE /projects/[id]/permanent/` redirigidos a `ProjectViewSet` (backend ya completo desde la Fase 14, sin cambios); cierra un bug activo documentado desde la Fase 5f (proyectos creados después de ese cutover no podían enviarse a la papelera). Lado Notas de la Papelera transversal (`DELETE /desk-notes/[id]`) sigue sin cutover; **Fase 40 (reconciliación de ids Postgres↔Django) COMPLETA** — `SessionPayload.djangoUserId` + `resolveDjangoUserId` (infraestructura, sin cutover de módulo nuevo), desbloquea Reuniones/Ideas/Comunicados/Notificaciones/`users/assignable`; **Fase 41 (cutover de Notificaciones) COMPLETA** — primer cutover apoyado en ese puente: `GET/PATCH /notifications/` + `PATCH /notifications/<id>/` (Django, Fase 15 del backend), cierra staleness (Django ya escribía notificaciones que la campana en Postgres nunca mostraba); `taskAssignedToId` ahora numérico, `session.djangoUserId` propagado hasta `NotificationBell`; **Fase 42 (cutover de `users/assignable` + Reuniones) COMPLETA** — cerrados juntos por interdependencia (selector de invitados de Reuniones consume `users/assignable`); cierra 3 bugs activos preexistentes (2 en Tareas, 1 en invitación a Reuniones) por el mismo motivo de tipo de id; Reuniones 100% en Django (`GET/POST /meetings/` + `GET/PATCH/DELETE /meetings/<id>/`, Zoom real + notificación ya visible en la campana desde la Fase 41). Quedan Ideas y Comunicados como candidatos del puente de la Fase 40; **Fase 43 (cutover de Mejora Continua / Ideas) COMPLETA** — sin interdependencia con otro módulo, `GET/POST /ideas/` + detalle + voto + estado + historial redirigidos a Django (Fase 11 del backend, completo), `mejora-continua/page.tsx` (SSR) cortada también. Queda Comunicados como último candidato; **Fase 44 (cutover de Comunicados + corrige staleness de Comunicados/Reuniones en `GET /api/dashboard`) COMPLETA** — cierra la lista completa del puente de ids de la Fase 40. `AnnouncementListView._serialize` ganó `author: {name, role}` (aditivo). Resto del bundle de Dashboard (Tareas/Comentarios/Actividades/Proyectos) documentado como staleness conocida, fuera de alcance (depende de Analytics/Workload); **Fase 45 (cutover de Solicitudes LOPD) COMPLETA** — `GET/POST /data-requests/` + detalle + `my-data` (exportación LOPD/GDPR) redirigidos a Django (Fase 12 del backend, completo); `my-data` era el cutover de mayor severidad de compliance hasta ahora (agregaba 6 modelos ya solo-Django); gap heredado del backend en `usuario` (5 campos sin equivalente en Django) preservado, no fabricado. **Fase 46 (cutover de Equipo) COMPLETA** — `GET /team/` + `GET /team/<id>/tasks/` redirigidos a Django (Fase 18 del backend, completo), cortados juntos por interdependencia (mismo patrón que Fase 42); **Fase 47 (cutover de Analytics + KPIs, 13 rutas granulares) COMPLETA — cierra el cutover de `route.ts` de Analytics/KPIs en su totalidad** salvo `kpis/nova-insights`/`analytics/diagnostics` (sin backend). `GET /analytics/insights/<id>/` + `/equilibrio/<id>/` + `/benchmarks/<id>/` + `/operational-risk/<id>/` + `/operational-risk/team/` + `/recommendations/team/` + `/history/<id>/` + `/target-time/<id>/` + `/data-quality/` + `POST /analytics/simulate/<id>/` + `GET /kpis/team/` + `/kpis/team-capacity/` + `/kpis/executive/` redirigidos a Django (backend completo desde las Fases 16-24, sin cambios); **Fase 48 (cutover de Inteligencia Preventiva, 9 rutas) COMPLETA.** `GET /predictive/predictions/<id>/` + `/trend/<id>/` + `/alerts/<id>/` + `/team-alerts/` + `/team-subutilization/` + `/project-delay/<id>/` + `POST /predictive/simulate/<id>/` + `/predictive/simulate/project/<id>/` + `/predictive/simulate/redistribute/` redirigidos a Django (backend completo desde la Fase 9, sin cambios) — requirió el puente de ids de la Fase 40 (`inteligencia-preventiva/page.tsx`); **Fase 49 (cutover de `role-targets`/`role-compatibility`/`system-info`) COMPLETA.** Re-auditó los 15 endpoints de `settings/*` deferidos desde la Fase 36 tras el cutover de Analytics/Predictive — solo estos 3 estaban desbloqueados (`role-targets`/`role-compatibility`: su único caller TS es código muerto desde la Fase 47; `system-info`: cerraba staleness, contaba Usuarios/Tareas/Reuniones/Ideas en Postgres). Los 12 restantes de esa lista siguen bloqueados, ahora por Dashboard/Nova Insights/Reportes Ejecutivos; **Fase 50 (cutover de `DELETE /api/desk-notes/[id]`) COMPLETA — cierra Escritorio Digital al 100% en Django.** El bloqueo original (Centro de Recuperación sin portar) se había resuelto silenciosamente desde la Fase 14 — solo faltaba conectar el `route.ts`; sin interdependencia que coordinar (la papelera de Notas nunca tuvo UI de restauración); **Fase 51 (cutover de `GET /api/dashboard` + `settings/welcome-message`) COMPLETA.** `build_dashboard_payload` (backend, Fase 25) ya era réplica campo por campo completa — cierra la staleness de Tareas/Comentarios/Actividades/Proyectos deferida desde la Fase 44, y de paso un bug activo (`myProjects` daba 404 en proyectos creados tras la Fase 39). `welcome-message` se cortó en el mismo cambio para no introducir divergencia nueva. Hallazgo sin corregir: `workload-config`/`holidays`/`leave-records`/`special-status`/`kpi-start-date` ya divergen desde la Fase 4m — cerrado en la Fase 52; **Fase 52 (cutover de esos 5 endpoints) COMPLETA.** Bug activo cerrado, más severo de lo esperado: `leave-records`/`special-status` recibían `userId` numérico (Django, desde `/api/users`) que nunca coincidía con el `cuid` de Postgres — crear un permiso o estado especial para cualquier usuario devolvía 404 desde la Fase 2. También corrige un bug de permisos en el backend (`GET /settings/holidays/` exigía ADMINISTRADOR por error, único cambio de backend de esta fase); **Fase 53 (cutover de `settings/config-history` + `restore-default`) COMPLETA — reconecta los 2 últimos endpoints de auditoría de configuración, backend ya completo desde la Fase 33 sin cambios.** **Fase 54 (cutover de Nova Insights/Message) COMPLETA — cierra Centro de Configuración/Nova como bloqueo circular: `kpis/nova-insights/[userId]` + `dashboard/nova-message` recomponen sus datos desde 3 endpoints Django ya existentes (`analytics/<id>/`, `kpis/<id>|me/`, `analytics/operational-risk/<id>/`, `tasks/`) en vez de Prisma/`analytics.ts`, sin backend nuevo. Bug activo cerrado: `MyKpisModule.tsx` pasaba el cuid de Postgres a 6 sub-paneles que ya esperaban el id numérico de Django — Nova Insights viendo a un compañero de equipo devolvía 404 desde que Analytics/KPIs se cortó (Fase 47).** **Fase 57 (Reportes Ejecutivos — primer recorte de CÁLCULO recompuesto sobre Django) — Índice Ejecutivo (Performance Score + Equilibrio Operativo por colaborador, mes en curso) deja de calcularse localmente contra Prisma y pasa a leer el bundle de Analytics de Django (`/analytics/<id>/`, mismo patrón que Nova Insights, Fase 54) — sin portar ninguna fórmula nueva. Requirió una vista Django nueva (`GET /reports/user-lookup/`) para resolver el id numérico de cada colaborador del roster a partir de su cuid — el resto del builder (Tareas/Actividades/agregados de equipo) sigue contra Prisma. Colaboradores sin id de Django resuelto se excluyen del promedio, no bloquean la generación.** **Fase 56 (Reportes Ejecutivos — cutover de PERSISTENCIA + lectura, cálculo sigue en Next.js) — hallazgo activo cerrado: desde la Fase 8 (2026-08-18), los endpoints de lectura de Django nunca veían un reporte generado después de esa fecha, porque la generación seguía escribiendo en Postgres. 2 vistas Django nuevas (`ExecutiveReportCreateView`/`ExecutiveReportAuditCreateView`) persisten el snapshot ya calculado por Next.js (`buildSnapshotForFilters`, ~1183 líneas, SIN cambios); `list`/`[reportId]` cortados a los endpoints de lectura ya existentes (Fase 8). `generated_by`/`user` se resuelven del JWT en Django, nunca del body.** **Fase 55 (cutover COMPLETO de Consentimiento/Preferencias — 6 de 6 rutas) — `auth/consent`, `dashboard/card-order`, `users/[id]/reset-consent`, `users/reset-consent-all`, `users/[id]/view-preferences` y la porción `activityFormat` de `auth/me` cortados a Django. Las primeras 4 sin backend nuevo; las últimas 2 requirieron 2 vistas Django nuevas (`UserViewPreferencesView`/`ActivityFormatView`) — bloqueadas inicialmente por falta de acceso a SQL Server (`localhost:14330` resultó ser el contenedor Docker correcto de este proyecto, mal diagnosticado al principio como instancia SQLEXPRESS nativa en otro puerto), resuelto en la misma sesión. Cierra además el gap explícito de la Fase 3a en `tasks/page.tsx` (ahora usa el id numérico de Django).** **Fase 58 (Asistente LLM/RAG — cutover de la base de conocimiento, cálculo de embeddings sigue en TypeScript) COMPLETA** — nueva app Django `apps.assistant` (`KnowledgeDocument`/`DocumentChunk`, réplica de `prisma/schema.prisma`) persiste metadatos de documentos y chunks con su embedding ya calculado por `@xenova/transformers` (sin portar a Python); `src/lib/githubDocuments.ts` (descarga/extracción/chunking) y la llamada a Groq en `assistant/chat/route.ts` quedan sin cambios. `buildTeamContext`/`buildTaskContext` (contexto de Nova para el modo "hr"/"tasks") recompuestos sobre `GET /tasks/`, `GET /team/` y `GET /team/<id>/tasks/`, ya cortados desde las Fases 3a/46. **Fase 59 (cutover del TTL de caché de Nova, primer valor reconectado de Centro de Configuración) COMPLETA** — `settings/nova-cache/route.ts` redirigido a `NovaCacheView` (backend completo desde la Fase 34, sin cambios); cierra staleness activa (el TTL editado desde Ajustes no tenía efecto real en `dashboard/nova-message`/`kpis/nova-insights` desde que ambos se cortaron a Django en la Fase 54). `getEffectiveNovaCacheTtlMinutes`/`setNovaCacheTtlMinutes` eliminados de `systemConfig.ts` (código muerto confirmado). **Fase 60 (cutover completo de `settings/trabajo-avanzado`, hora de corte de jornada) COMPLETA** — `TrabajoAvanzadoView` (Django, Fase 32) ya devolvía `workday_end_hour` en la misma respuesta que `retroactive_window_days`; el bloqueo documentado en la Fase 36 (único consumidor real `capacityForecast.ts`) quedó obsoleto desde el cutover de Inteligencia Preventiva (Fase 48), sin que nadie lo notara. **Fase 61 (cutover de `passwordMinLength`, `settings/seguridad-config` + hallazgo de seguridad) COMPLETA** — `SeguridadConfigView` (Django, Fase 32) ya devolvía `password_min_length`; nuevo `src/lib/djangoPasswordPolicyConfig.ts`. Hallazgo de seguridad documentado (no corregido): Django enforcea un `MinimumLengthValidator` hardcodeado en `min_length=10`, desconectado del valor configurable en Ajustes — el mínimo editable solo tiene efecto real por encima de 10. **Fase 62 (cutover de la duración de sesión, `session.ts`) COMPLETA** — cierra el backlog de Centro de Configuración con consumidor real confirmado: `auth/login/route.ts` ya resolvía la duración vía Django desde la Fase 6a; `auth/me/route.ts` ahora hace lo mismo antes de re-emitir la sesión al editar el perfil. `session.ts` queda sin ninguna dependencia de Prisma/Django (fallback hardcodeado, sin consulta). **Fase 63 (corrección de hallazgo — la Fase 60 estaba equivocada — + limpieza de código muerto confirmado) COMPLETA** — corrige la afirmación "`capacityForecast.ts` sin importadores reales" (Fase 60): tiene una cadena viva completa hacia `POST /api/reports/executive` vía `predictionEngine.ts`/`buildSnapshotData.ts`, igual que `workload.ts`/`trendEngine.ts` y partes de `analytics.ts`. Hallazgo nuevo, no corregido: `workday_end_hour` quedó desincronizado entre Django (Ajustes) y Postgres (`capacityForecast.ts`) como consecuencia directa del error de la Fase 60 — divergencia real pero de bajo impacto práctico, documentada para la futura fase del motor de cálculo de Reportes Ejecutivos. Solo 3 de 10 archivos candidatos resultaron genuinamente código muerto (`recoveryCenter.ts`/`deskNoteRetention.ts`/`rate-limit.ts`) — eliminados junto con sus tests y 20 símbolos huérfanos en `systemConfig.ts`. **Fase 64 (Sub-fase 1 del motor de cálculo de Reportes Ejecutivos, `ReportMemberKpi`, solo builder mensual, sin cutover de TS) COMPLETA** — hallazgo mayor: de las ~10 primitivas necesarias, 8 ya existían en Django desde fases tempranas (4a-4d, antes de esta sesión) — `compute_simple_score`/`compute_completed_pct_any`/`compute_estimated_vs_real_ratio` (`apps/analytics/scoring.py`), `compute_workload_range`/`compute_workload_pct`/`sum_weighted_base_hours`/`sum_weighted_limit` (`apps/analytics/workload.py`), `compute_effective_history_start` (`apps/analytics/history.py`), `is_task_overdue`, `business_day_real_range`. Nuevo `backend/apps/reports/member_kpis.py` (`as_of_fecha_corte`/`compute_effective_member_bases`/`compute_monthly_member_kpis`, 16 tests), deliberadamente sin wiring HTTP todavía. **Fase 65 (Sub-fase 2, builder de rango personalizado) COMPLETA** — `compute_custom_range_member_kpis` nuevo, reutilizando las primitivas de la Sub-fase 1 + `derive_estado_operativo`/`compute_principal_hallazgo` (de `reportInsights.ts`, también portadas) + `business_base_for_range` (otra primitiva ya existente, sin conectar). 14 tests más (30 en total). **Fase 66 (Sub-fase 3, builder de rango de meses — solo `ReportMemberKpi`/`MonthSnapshot`) COMPLETA** — `compute_range_member_kpis` nuevo, con desglose mes a mes del que depende la agregación por colaborador; reutilizó otra primitiva más ya portada sin conectar (`monthlyBusinessBaseForUsers` → `monthly_business_base_for_users`, en uso real desde la Fase 4c). Deliberadamente NO incluye los rollups de equipo de `buildRangeSnapshotData` (cuadrante de riesgo/hallazgos/recomendaciones/insights/alertas), que dependen de `src/lib/reportInsights.ts` (538 líneas, sin portar) — quedan para una sub-fase futura. 6 tests más (36 en total), los 6 en verde en el primer intento. Con esto, el port de `ReportMemberKpi` queda completo para los 3 builders. **Fase 67 (port completo de `src/lib/reportInsights.ts`, agregados de EQUIPO, sin cutover HTTP) COMPLETA** — nuevo `backend/apps/reports/insights.py` (16 funciones: `compute_risk_quadrant`/`previous_equivalent_period`/`explain_motivo_distribution`/`explain_cumplimiento_indicator`/`explain_carga_indicator`/`explain_consultas_indicator`/`get_activity_reason_label_map`/`resolve_monthly_period_status`/`resolve_range_period_status`/`resolve_custom_range_period_status`/`compute_findings`/`compute_recommendations`/`compute_team_insights`/`compute_team_monthly_snapshots`/`compute_trend_comparisons`), 47 tests, todos en verde en el primer intento — con esto, el motor de CÁLCULO completo de Reportes Ejecutivos (`ReportMemberKpi` + agregados de equipo) ya existe en Django. **Fase 68 (primer endpoint HTTP del motor de cálculo — `POST /reports/executive/monthly-team-kpis/`, builder MENSUAL, sin cutover de `buildSnapshotData.ts`) COMPLETA** — nuevo `backend/apps/reports/team_report.py` (capa de ENSAMBLADO: `member_kpis` calcula, `insights` interpreta, `team_report` ensambla), con `assemble_monthly_team_report` + 3 funciones genuinamente nuevas (`compute_team_alerts`/`compute_monthly_ranking`/`compute_consultas_by_reason`, la única primitiva del builder MENSUAL sin ningún equivalente portado todavía); nueva vista `MonthlyTeamReportView` gateada por `CanAccessReports`. El bundle deliberadamente NO incluye Índice Ejecutivo/Predictivo/NOVA/`estadoOperativo`-`principalHallazgo` por miembro (motores aparte, sin cambios en TS). 21 tests nuevos, todos en verde en el primer intento — con esto, `buildSnapshotData.ts` sigue sin ningún cambio (nada en Next.js llama a este endpoint todavía). **Fase 69 (endpoints HTTP de RANGO PERSONALIZADO/RANGO DE MESES — `POST /reports/executive/custom-range-team-kpis/` y `.../range-team-kpis/`) COMPLETA** — `assemble_custom_range_team_report` reutiliza el `ranking`/`alerts` de la Fase 68 sin duplicarlos (el TS usa exactamente la misma lógica ahí); `assemble_range_team_report` agrega `compute_range_ranking`/`compute_range_alerts` propios (orden y umbral de alerta genuinamente distintos del builder mensual, verificado línea por línea contra el TS) más `monthlyEvolution`/`rangeTrend`/`problematicMonths`. 14 tests más (35 en total). Con esto, los 3 builders del motor de cálculo tienen su endpoint HTTP equivalente construido y probado en Django, ninguno con wiring desde `buildSnapshotData.ts` todavía. **Fase 70 (verificación con datos sintéticos de los 3 endpoints contra `buildSnapshotData.ts` real, más fix del bug de redondeo activo en producción) COMPLETA** — Postgres descartable + BD de Django, mismo escenario sintético en ambos lados, 283 verificaciones campo por campo, 261 exactas. 2 causas raíz para las 22 discrepancias: (A) `round()` de Python (banker's rounding) vs. `Math.round()` de JS (siempre hacia +Infinity) — corregido en TODO el backend (`apps/core/rounding.py::round_half_up`, 217 call sites, 32 archivos, no solo `apps.reports` — ya afectaba Analytics/KPIs en producción desde la Fase 47), suite completa 1799/1799 en verde; (B) quirk de conteo de días hábiles en rangos multi-mes (`sumWeightedBaseHours` de TS, dependiente de zona horaria) — el port Python no lo reproduce, decisión pendiente del usuario, solo afecta RANGO_MESES. **Fase 71 (fix de la Causa raíz B) COMPLETA** — confirmado con el usuario que producción corre en `America/Guayaquil` (UTC-5), el quirk es real. Corregida la hipótesis inicial: no es el día de la semana en hora local (TS usa `getUTCDay()`), es que `monthBounds()` construye sus límites en hora LOCAL del proceso. Una segunda verificación sintética dirigida al borde de mes reveló alcance mayor al medido — afecta también qué tareas/actividades se cuentan en cada mes del desglose, no solo `cargaBaseHours`. Nuevo `_local_month_bounds` (réplica de `monthBounds()`, desplazada por `BUSINESS_TZ_OFFSET_HOURS`) reemplaza a `_month_bounds` en todo lo que `compute_range_member_kpis`/`assemble_range_team_report` derivan de `monthBounds()`; nuevo `_ts_local_period_end_date` replica con exactitud aritmética el límite final del loop de 24h de TS por colaborador. 7 tests nuevos (162 en total en `apps/reports/`), 2 reproduciendo exactamente los escenarios reales verificados contra TS. Con esto, los 3 builders del motor de cálculo quedan verificados campo por campo contra `buildSnapshotData.ts`. **Fase 72 (primer cutover HTTP real — builder MENSUAL) COMPLETA** — `buildMonthlySnapshotData` deja de calcular `ReportMemberKpi`/agregados de equipo localmente contra Prisma y pasa a leerlos de `POST /reports/executive/monthly-team-kpis/` (Fase 68) vía el nuevo `djangoReportKpisBridge.ts`. 2 decisiones de comportamiento en producción confirmadas explícitamente con el usuario antes de implementar: si Django falla, la generación FALLA (no degrada, a diferencia del Índice Ejecutivo); un colaborador sin id de Django resuelto se excluye de la tabla. `insights`/`estadoOperativo`/`principalHallazgo` siguen en TS (dependen del Índice Ejecutivo). Se eliminaron 3 tests que probaban lógica ya movida a Django (esa cobertura ya existe del lado Django, verificada con datos sintéticos reales en las Fases 70/71). `tsc`/`eslint` limpios, Vitest 1231/1231 en verde. Quedan RANGO_PERSONALIZADO/RANGO_MESES sin cutover (trabajo mecánico, mismo patrón) y la parte (3), `workday_end_hour` (Fase 63). Ver `docs/AUDIT_LOG.md` § 2026-08-26 (Fase 72). **Fase 73 (cutover HTTP real de RANGO_PERSONALIZADO/RANGO_MESES + fix de `workday_end_hour`) COMPLETA — cierra Reportes Ejecutivos al 100% en Django para los 3 tipos de reporte.** **Fase 74 (elimina `insightsEngine.ts`/`riskAlerts.ts`, código muerto confirmado desde la Fase 63) COMPLETA.** **Fase 75 (clampea `password_min_length` a un piso de 10, cierra el hallazgo de seguridad de la Fase 61) COMPLETA.** **Fase 76 (cutover de favoritos del Centro de Configuración, cierra un riesgo de divergencia de datos activo con `dashboard/card-order`) COMPLETA — cierra Centro de Configuración al 100%.** **Con esto, los 14 puntos del ROADMAP de la migración de stack quedan COMPLETO/CUTOVER 100% en términos de RUTA/CÓDIGO — todo `route.ts` ya cortado habla con Django, no con Prisma. CORRECCIÓN (2026-08-27, ver docs/AUDIT_LOG.md § 2026-08-27): esta frase, repetida en varias entradas anteriores, conflacionaba "cutover de ruta" con "migración de datos reales completa" — son cosas DISTINTAS. `migrate_users_from_postgres` (probado, nunca ejecutado contra datos reales, bloqueado por falta de `LEGACY_POSTGRES_URL` real) es el ÚNICO comando de migración de datos que existe en todo el backend, y solo migra la tabla `User`. Un relevamiento completo (2026-08-27) confirmó que NINGUNA otra entidad de negocio (Tareas, Actividades, Comentarios, Proyectos y sus 6 sub-entidades, Notificaciones, Notas/Recordatorios del Escritorio, Reuniones/Invitados, Ideas/Votos, Solicitudes LOPD, Feriados/Permisos/Estados Especiales, Historial de Configuración, Base de Conocimiento/Chunks, Comunicados, Papelera/Recovery — ~40 entidades) tiene un comando de migración de datos, ni siquiera sin ejecutar: no existe el código. De los 44 modelos de Prisma, 42 ya tienen su modelo Django equivalente listo para recibir datos (el trabajo de esquema está hecho) — falta escribir ~40 comandos de importación (mismo patrón ya probado de `migrate_users_from_postgres`) y decidir qué hacer con los 2 modelos sin equivalente Django (`MonthlyReport`, `DataPurgeLog`). Sin mecanismo de escritura dual — Django nunca acumuló datos reales en paralelo. Ver `docs/AUDIT_LOG.md` § 2026-08-27 para el inventario completo y la entrada original del hallazgo de la Fase 3a (2026-08-07) que ya lo advertía sin que se generalizara a una lista de seguimiento.** **Fase 80 (prerrequisitos de migración de DATOS reales + Wave 0) COMPLETA** — `legacy_postgres_id` agregado a los 40 modelos Django en alcance; módulo compartido `apps/core/legacy_migration.py` (idempotencia vía prefiltrado, no `ignore_conflicts` — no soportado por `mssql-django`; corrección de `created_at`/`updated_at` vía `bulk_create`+`bulk_update`, ya que `bulk_create` SÍ dispara `auto_now`/`auto_now_add`, hallazgo verificado empíricamente); 2 comandos nuevos (`migrate_activity_reasons_from_postgres`/`migrate_holidays_from_postgres`), Wave 0 de 5, verificados con datos sintéticos. **Fase 81 (Waves 1-4, 38 comandos más) COMPLETA — código de migración de datos reales 100% escrito y verificado.** Las 40 entidades de negocio (Usuarios + las 39 del hallazgo original) tienen su comando de importación listo, idempotente y probado end-to-end (cadena completa Usuarios→Wave0→Wave1→Wave2→Wave3→Wave4 contra datos sintéticos). `MonthlyReport`/`DataPurgeLog` quedan fuera deliberadamente — resultaron ser una feature con consumidor activo real, no datos históricos, documentada aparte en `docs/ROADMAP.md`. **El bloqueante identificado en la Fase 81 (ejecutar los 40 comandos contra el Postgres real) queda DESCARTADO en la Fase 82 (2026-08-27) — decisión explícita del usuario de NO migrar ningún dato histórico real; las pruebas de funcionalidad siguen exclusivamente con datos sintéticos, mismo método de las Fases 70/77/80/81. El código de los 40 comandos se conserva intacto, sin ejecutar contra producción.** **Fase 83 (port de `MonthlyReport`/`DataPurgeLog`, retención/purga LOPDP) COMPLETA — cierra el catálogo `settings/*` al 100%.** 2 modelos Django nuevos (sin `legacy_postgres_id` ni comando de importación, decisión de la Fase 82) + `find_purge_candidates`/`execute_purge` (`apps/configuration/services.py`, réplica exacta de `retentionPolicy.ts`) + `RetentionPolicyPurgeView` nueva; cutover de `retention-policy/route.ts` (config, nunca antes cortado pese a existir desde la Fase 31) + `retention-policy/purge/route.ts`; `src/lib/retentionPolicy.ts` eliminado. **Fase 84 (reconexión del motor interno a Django) COMPLETA — cierra 3 bugs activos de divergencia de datos.** `holidays.ts`/`workload.ts` (vía `systemConfig.ts`)/`closurePeriod.ts`+`periodStatus.ts` dejan de leer Postgres directo pese a que sus rutas de administración ya escriben en Django desde las Fases 52/34; `ClosureStatusView` extendida con 4 campos para cubrir también `buildSnapshotData.ts`; cutover de 3 route.ts nunca antes conectados (`analytics-config`/`normalization-curves`/`prediction-window`, vista Django lista desde las Fases 31/32); limpieza de código muerto (12 archivos + 39 funciones, >3700 líneas). **Fase 85 (reconexión del bloque "Predictivo" a Django, reuso no construcción nueva) COMPLETA.** `predictionEngine.ts`/`capacityForecast.ts`/`trendEngine.ts` resultaron réplicas exactas de código Django ya vivo desde la Fase 48 — se reconecta en vez de portar. `PredictionBundleView` gana `?as_of=`; nueva `TeamSubutilizationReportView` (roster explícito, `apps.reports`). Cascada de código muerto verificada función por función: `capacityForecast.ts`/`trendEngine.ts`/`analyticsAuditHistory.ts` eliminados completos, más `leaves.ts`/`specialStatus.ts` completos (sin ningún consumidor tras cortar `workload.ts::sumWeightedBaseHours`) — cierra sin endpoint nuevo un backlog que la Fase 84 había dejado pendiente. Ver `docs/AUDIT_LOG.md` § 2026-08-27 (Fases 73-76, 80, 81, 82, 83, 84, 85). **Fase 86 (cutover de los últimos 6 archivos sin explorar de `src/lib/*`/páginas SSR) COMPLETA** — `notification-rules` (Django completo desde la Fase 35) reconectado vía `djangoNotificationRulesAdapter.ts`; `projects/page.tsx` y `projects/[id]/page.tsx` reconectados a `GET /projects/`/`GET /projects/<id>/` (Django completo desde la Fase 5f); `dashboard/page.tsx` reconectado a `GET /users/<id>/view-preferences/` (mismo patrón que `tasks/page.tsx`); `layout.tsx` reconectado a `GET /auth/me/` tras agregar `data_consent_accepted` a `UserPublicSerializer`. `resolveRoster.ts` queda fuera de alcance (lógica propia de Reportes Ejecutivos sin equivalente Django). Cascada de código muerto: `notificationRules.ts`/`projectPhaseStats.ts` eliminados (previstos) + `projectAccess.ts` eliminado (hallazgo durante la implementación — sin otro consumidor tras cortar la página de detalle, Django ya hace ese control de acceso server-side). Ver `docs/AUDIT_LOG.md` § 2026-08-28 (Fase 86). **Fases 87-90 (cierre COMPLETO del punto 14 — decommission total de Prisma/PostgreSQL del código) COMPLETO.** Fase 87: `resolveRoster.ts` reconectado a `GET /reports/roster/` (Django, nueva `RosterView`, composición sobre primitivas de jerarquía ya probadas). Fase 88: `computeDataQuality`/`recordEngineVersionIfChanged` reconectados a `GET /analytics/diagnostics/` (nueva `AnalyticsDiagnosticsView`, reusa `compute_data_quality` ya vivo con 3 consumidores Django). Fase 89: comparación mes-anterior del Índice Ejecutivo reconectada a `GET /reports/monthly-report/` (nueva `MonthlyReportView` mínima, mismo comportamiento exacto — `MonthlyReport` nunca recibió escrituras). Fase 90: eliminación completa — `package.json` (4 dependencias + 1 devDependency), `prisma.config.ts`, `prisma/` (schema + 48 migraciones + seed), `src/lib/prisma.ts`, `src/generated/prisma/`, 2 scripts de backfill, mock global de Prisma en Vitest, `.env.example`/`.gitignore`, `CLAUDE.md`/`docs/ARCHITECTURE.md`; 79 archivos con imports de tipo puro desde el cliente Prisma migrados a definiciones locales en su módulo dueño de dominio (`Role` → `src/lib/roles.ts`, 74 de los 79). `pytest apps/` sin regresiones, `npx tsc --noEmit`/`npx eslint src` limpios, `npx vitest run` 1099/1099, `npm install` (97 paquetes retirados), `npx next build` verificado sin `prisma generate`/`prisma migrate deploy`. Fuera de alcance, confirmado con el usuario: el servicio de Windows `postgresql-x64-16`/hosting Neon no se tocan (posibles datos reales de personal, decisión legal/de producto aparte). Ver `docs/AUDIT_LOG.md` § 2026-08-28 (Fases 87-90) |

**Última actualización:** 2026-09-02 (v1.147.2 — corrección de los 7
hallazgos de la re-auditoría de IA y datos personales: 4 fixes de
documentación/exportación/auditoría sobre el informe original (H-1 a H-4),
un gate de permisos endurecido para datos de salud (H-5, `is_superuser`
real en vez de solo grupo ADMINISTRADOR), su regresión operacional cerrada
con sincronización automática + migración de backfill (H-6), y un bypass
de autorización real corregido en la caché de Nova Insights — la clave no
identificaba al viewer, permitiendo que un usuario sin visibilidad
jerárquica real recibiera texto generado para otro (H-7). `pytest` backend
1870/1872 (2 fallos preexistentes no relacionados), Vitest 1129/1129. Ver
`docs/CHANGELOG.md` y `docs/AUDIT_LOG.md`.)

**Actualización anterior:** 2026-09-02 (v1.147.1 — corrige el login roto de
cualquier cuenta ADMINISTRADOR: `session.permissions` embebía el catálogo
COMPLETO de Django para un superusuario (~246 codenames, ~8KB), por
encima del límite práctico de ~4KB por cookie — el navegador descartaba
el `Set-Cookie` en silencio. `sessionPermissionsFor` colapsa esa lista a
un sentinel `"*"` para `ADMINISTRADOR`; `hasPermission`/`hasAnyPermission`
lo tratan como "todos los permisos". Hallado y corregido en la misma
sesión en la que se pidió loguear con la cuenta admin. Ver
`docs/CHANGELOG.md` y `docs/AUDIT_LOG.md` § 2026-09-02.)

**Actualización anterior:** 2026-09-01 (v1.147.0 — corrección de los
hallazgos de la auditoría de seguridad de Nexo: control de acceso roto en
asignación de tareas (NEXO-01, el único con impacto real de integridad de
datos — cerrado en `TaskService`/`TaskImportService`, 3 tests de
regresión nuevos), CSP con `unsafe-eval` condicionado a desarrollo
únicamente (NEXO-02, investigado en vivo: React lo necesita solo en dev,
producción no), sanitización con DOMPurify del visor de Documentación
(NEXO-03, nueva dependencia justificada), y Next.js actualizado a 16.3.4
más `npm audit fix` no disruptivo (NEXO-04). `pytest` backend 1864/1864
relevantes, Vitest 1123/1123, `tsc`/`eslint` limpios, `npm run build`
exitoso. Ver `docs/CHANGELOG.md` y `docs/AUDIT_LOG.md`.)

**Actualización anterior:** 2026-09-01 (v1.146.2 — reemplazo de `confirm()`/
`window.confirm()` nativo por `ConfirmDialog` propio en los 13 archivos que
lo usaban — hallazgo real de la prueba integral de la plataforma: el
diálogo nativo bloqueaba la pestaña completa del navegador. `tsc`/`eslint`
limpios, Vitest 1122/1122. Ver `docs/CHANGELOG.md`.)

**Actualización anterior:** 2026-09-01 (v1.146.1 — "SuperUsuario" =
`ADMINISTRADOR` con TODO el catálogo de permisos sembrado explícito en la
base, no un rol nuevo. Pedido explícito del usuario tras v1.146.0 ("crea
un rol de SuperUsuario que tenga control de todos los permisos, tenga
asignado todo por defecto"); `AskUserQuestion` confirmó que no se trata de
un 12° rol (`Role` sigue fijo en 11 valores) sino de hacer explícito en la
base lo que la pantalla `/admin/roles` ya mostraba cosméticamente para
Administrador. Nueva migración `0004_seed_all_permissions_to_administrador.py`
(aditiva sobre `0003`) asigna los 26 codenames completos del catálogo,
incluidos los 5 módulos administrativos originales (nunca antes sembrados
a ningún rol) y 3 codenames que `0003` excluía a propósito
(`tareas.regularizar`/`tareas.cerrar_mes`/`escritorio_digital.usar`) —
reversión deliberada de esa exclusión, sin efecto para un superusuario
real (`is_superuser` ya bypaseaba todo), solo para el caso
ADMINISTRADOR-por-grupo-sin-superusuario. `pytest` backend en verde. Ver
`docs/CHANGELOG.md` y `docs/AUDIT_LOG.md` § 2026-09-01.)

**Actualización anterior:** 2026-09-01 (v1.146.0 — catálogo dinámico de
permisos extendido a todo el sistema, 19 módulos, más la pantalla
"Roles y Permisos" (`/admin/roles`) que lo administra. El usuario pidió
construir una pantalla de gestión de permisos; al presentarle el trade-off
(catálogo administrativo acotado vs. controlar de verdad la autorización
real del sistema), eligió explícitamente el alcance grande. Backend: 10
módulos nuevos en `PERMISSION_CATALOG` (`tareas`/`reportes`/`equipo`/
`reuniones`/`mejora_continua`/`base_conocimiento`/`inteligencia_preventiva`/
`proyectos`/`escritorio_digital`/`announcements`), migración de datos que
reproduce byte-exacto el comportamiento previo (verificado contra
`src/lib/roles.ts` y cada `permission_classes` real); 9 apps migradas de
checks de rol hardcodeados (`role_name()`/`role_level()`) al catálogo
dinámico (`user_has_permission`) — `tasks`/`reports`/`meetings`/`ideas`/
`desk`/`announcements`/`assistant`/`projects`, más un gate nuevo en `team`
(antes sin `permission_classes` propio). Hallazgo crítico corregido durante
la implementación: `role_name()`/`role_level()` tratan la pertenencia al
grupo `ADMINISTRADOR` como equivalente a `is_superuser=True` — el catálogo
dinámico NO replica ese bypass por defecto, así que la migración de datos
sí siembra los codenames nuevos a `ADMINISTRADOR` explícitamente (excepto
donde el comportamiento original tampoco lo incluía). Frontend:
`session.permissions: string[]` (JWT, mismo trade-off de staleness ya
aceptado para `role`/`djangoUserId`); `src/lib/roles.ts` deliberadamente
SIN tocar — sigue siendo la fuente de autorización real de la UI, migrarlo
módulo por módulo queda en `docs/ROADMAP.md`. Pantalla nueva
`/admin/roles`: matriz de 19 módulos × 11 roles, fila de Administrador no
editable (bypass real es `is_superuser`), guardado con confirmación y
advertencia de autobloqueo si el usuario edita permisos de su propio rol.
No crea/elimina roles pese a que el backend lo soporta (`Role` es un union
type TS fijo de 11 valores). Verificado manualmente en browser con los 3
roles representativos (Jefe Nacional, Administrador, Trabajo Social) más el
flujo completo de guardado/persistencia y la advertencia de autobloqueo.
`pytest` backend en verde, `tsc`/ESLint limpios, Vitest 1122/1122. Ver
`docs/CHANGELOG.md` y `docs/AUDIT_LOG.md` § 2026-09-01.)

**Actualización anterior:** 2026-08-31 (v1.145.3 — retiro completo de
`legacy_postgres_id` y del puente de id cuid↔Django. Cierra el punto que
v1.145.2 había dejado deliberadamente pendiente: el usuario reconfirmó
explícitamente que quiere retirarlo también ("no voy a utilizar nada de lo
antiguo, nunca más volveré a topar la información antigua"). Backend: 14
migraciones (`RemoveField`, una por app), `UserLegacyIdLookupView`/`GET
/reports/user-lookup/` eliminados, `RosterView` expone el id numérico de
Django directo. Frontend: `SessionPayload.userId` (cuid) eliminado,
`djangoUserId: number` pasa a obligatorio; gate de login que bloqueaba a
usuarios sin `legacy_postgres_id` retirado; colapso del espacio cuid
interno de Reportes Ejecutivos (`buildSnapshotData.ts`/
`djangoAnalyticsBridge.ts`/`djangoReportKpisBridge.ts`) a id numérico de
punta a punta. 2 bugs activos cerrados como consecuencia directa: el guard
de autoeliminación de usuarios estaba inerte (comparaba cuid contra id
numérico), y `PATCH /api/users/[id]/view-preferences` siempre fallaba
internamente (404) porque llamaba a Django con el cuid crudo contra una
ruta `<int:pk>/`. `pytest` backend en verde, `tsc`/ESLint limpios, Vitest
1095/1095. Ver `docs/CHANGELOG.md` y `docs/AUDIT_LOG.md` § 2026-08-31.)

**Actualización anterior:** 2026-08-31 (v1.145.2 — decommission de la conexión
al Postgres legacy: eliminados los 41 comandos de management
`migrate_*_from_postgres` (nunca ejecutados contra datos reales, decisión de
la Fase 82 de no migrar histórico), el helper compartido
`apps/core/legacy_migration.py` y su test; retirados `LEGACY_POSTGRES_URL`
(settings + `.env`/`.env.example`), `PASSWORD_HASHERS` vuelve a 3 hashers
(sin `BCryptPasswordHasher`), `bcrypt`/`psycopg2-binary` fuera de
`requirements/base.txt`. Simplificados 3 comentarios sobrevivientes con
framing de "coexistencia"/Vercel ya obsoleto (`docker-compose.yml`,
`pdfPolyfill.ts`, `assistant/documents/route.ts` — incluido
`maxDuration = 300`, config exclusiva de Vercel, inerte en este proyecto).
**Deliberadamente NO tocado:** `legacy_postgres_id` (~40 modelos Django) —
confirmado activo por consulta directa a la base (poblado para usuarios de
prueba reales, usado por `RosterView`/Reportes Ejecutivos como puente de id
cuid↔Django) — es infraestructura de bridging vigente, no código muerto de
la conexión anterior; su eventual retiro requeriría coordinar también
`session.userId`/`resolveRoster.ts` del lado Next.js, decisión aparte
pendiente del usuario. `pytest` 1853/1853, `tsc`/ESLint limpios, Vitest
1100/1100 en verde. Ver `docs/CHANGELOG.md` y `docs/AUDIT_LOG.md` §
2026-08-31.)

**Actualización anterior:** 2026-08-31 (v1.145.1 — depuración de código muerto
en todo el repositorio, con `knip` (frontend) y `vulture` (backend) más
verificación manual de cada candidato — ambas herramientas dieron falsos
positivos reales (scripts standalone, assets vendorizados, convenciones de
Django). Eliminados: `frontend/` completo (prototipo Vite abandonado, 25
archivos), 7 archivos huérfanos de `src/lib/` tras la migración de stack,
`scripts/stub-server-only.cjs` (nunca invocado), `src/generated/` (vacío,
remanente de Prisma), 5 dependencias npm sin uso real
(`@anthropic-ai/sdk`/`bcryptjs`/`html2canvas`/`jspdf`/`@types/bcryptjs`/
`@types/pdf-parse`). Backend: auditoría de módulos huérfanos sin
candidatos — ya está limpio de las pasadas previas (Fases 63/74/85/86/90).
`tsc`/Vitest (1100/1100) en verde. Ver `docs/CHANGELOG.md`.)

**Actualización anterior:** 2026-08-31 (v1.145.0 — reemplazo completo del
proveedor de IA de Nova: Groq → Google Gemini (`@google/genai`), pedido
explícito del usuario con su propia API key. 4 puntos de integración
migrados (chat con RAG, saludo del dashboard, Insights de Analytics ×2,
narrativa de Reportes Ejecutivos ×4). 2 hallazgos determinaron la config
final, verificados en vivo contra la API real (no solo documentación):
`gemini-2.5-flash` ya no está disponible para cuentas nuevas (404) — se usa
`gemini-3.6-flash`; este modelo tiene "thinking" obligatorio que no puede
desactivarse (`thinkingBudget: 0` rechazado con 400) y consume tokens del
mismo presupuesto que la respuesta final — `maxOutputTokens` subido en los
6 call sites para evitar truncamiento (`finishReason: "MAX_TOKENS"`).
Textos de cumplimiento LOPDP actualizados (`ConsentGate.tsx`, `docs/RAT.md`,
`docs/PENDIENTES_LEGALES.md`, `README.md`) — Groq documentado como
proveedor retirado, mismo patrón que Neon/Vercel (2026-08-28). Ver
`docs/AUDIT_LOG.md` § 2026-08-31.)

**Actualización anterior:** 2026-08-31 (v1.144.6 — segunda mitad de la QA en
vivo del módulo de Inteligencia: Inteligencia Preventiva. El Simulador de
Escenarios (`ScenarioSimulatorPanel.tsx`) tenía "Redistribuir carga"
completamente roto — el selector de destinatario leía `members[].id`
cuando la API (`team-subutilization`) devuelve `members[].userId`, así que
el campo siempre quedaba `undefined` y el simulador fallaba con "Escenario
inválido" en cuanto había un compañero de equipo real. También filtraba un
campo interno de estilo (`cargaColor`) como si fuera un indicador visible
en la tabla de resultados. Resto de Inteligencia Preventiva (9 rutas
`/api/predictive/*`, predicciones/tendencias/alertas individuales y de
equipo) verificado sin hallazgos. Ver `docs/CHANGELOG.md`.)

**Actualización anterior:** 2026-08-31 (v1.144.5 — QA en vivo del módulo de
Inteligencia (Nova + Inteligencia Preventiva): Nova Insights nunca
aplicaba el adaptador snake_case→camelCase sobre el bundle de Django,
rompiendo con `TypeError` en cualquier request real desde el cutover a
Django (Fase 54) — nunca detectado porque los tests mockean con fixtures
ya en camelCase. Además, el timeout genérico de `djangoApiFetch` (3s) era
insuficiente para `GET /analytics/<id>/` (sin caché con TTL, ~2.8s de
cómputo puro) — fallaba con un 500 de body vacío de forma intermitente en
Nova Insights, la pantalla de Analytics, el Motor de Insights, el Riesgo
Operativo (individual y de equipo) y el resumen ejecutivo. Nuevo
`ANALYTICS_BUNDLE_TIMEOUT_MS` (12s) dedicado a esos 7 call sites, con
manejo explícito de timeout (504 legible) en cada ruta. Ver
`docs/AUDIT_LOG.md` § 2026-08-31.)

**Actualización anterior:** 2026-08-31 (v1.144.4 — pruebas integrales end-to-end
en Chrome real de todo el sistema, post-migración: 3 fixes reales
encontrados y corregidos en la misma sesión. v1.144.3: `groq-sdk` lanzaba
una excepción síncrona en el constructor cuando falta `GROQ_API_KEY`,
construido a nivel de módulo en `dashboard/nova-message` y
`kpis/nova-insights/[userId]` — rompía esas 2 rutas con 500 en TODAS las
requests, saltándose el guard de degradación que ya tenían más abajo;
corregido con construcción perezosa (mismo patrón que
`generateNarrative.ts`). v1.144.4: 6 páginas (`projects`, `projects/[id]`,
`meetings`, `team`, `tiempo-objetivo`, `dashboard`) pasaban el cuid de
Postgres (`session.userId`) donde sus componentes ya esperaban el id
numérico de Django — roto desde que esos componentes se cortaron a Django
(Fases 3a/42/55), nunca detectado porque son componentes server sin test
directo. Caso más visible: crear un proyecto con "Responsable principal:
Yo mismo" fallaba con 400. Ver `docs/CHANGELOG.md` para el detalle
completo de ambas versiones.)

**Actualización anterior:** 2026-08-28 (v1.144.2 — fix: `/admin/users` mostraba
"Pendiente" de consentimiento para todos los usuarios pese a que el backend
Django ya exponía `data_consent_accepted` desde la Fase 86 — el adaptador
`djangoUsersAdapter.ts` de la Fase 2 nunca lo mapeaba al shape del frontend.
Hallazgo de una verificación funcional end-to-end en Chrome real, no de
lectura de código. Ver `docs/CHANGELOG.md` para el detalle completo.)

**Actualización anterior 2:** 2026-08-28 (v1.144.1 — cierre del gap
`notification_rules` → `apps/tasks/services.py`. Con la migración de stack
recién cerrada al 100% (Fases 87-90, mismo día), el usuario eligió este
pendiente entre 2 presentados vía `AskUserQuestion`.
`CommentService.create_comment`/`ActivityService.create_retroactive_activity`
dejan de usar la jerarquía fija (`RoleNotificationTarget`) y la constante
`RETROACTIVE_NOTIFY_ROLES` (retirada) — ahora leen
`get_effective_notification_rules()["comment_targets"/"first_comment_role"/"retroactive_notify_roles"]`,
configurable desde Ajustes desde la Fase 35 sin ningún efecto real hasta
hoy. Bajo la config DEFAULT el comportamiento es idéntico al anterior.
`first_comment_role` tiene consumidor por primera vez (gap total antes,
ni siquiera en el legacy TS). **2 riesgos identificados y resueltos en el
diseño** (consecuencia directa de pasar de fijo a editable, no negocio
nuevo): notificación duplicada (resuelto reemplazando, no sumando, la
fuente de roles) y auto-notificación nueva nunca antes posible (resuelto
con `.exclude(id=author.id)` — salvaguarda agregada explícitamente solo
en comentarios, NO en retroactivo, donde el actor deliberadamente nunca se
excluía ya antes de este cambio, comportamiento preservado tal cual).
Fuera de alcance: `apps/analytics/services.py::notify_if_high_risk`
(mismo patrón de jerarquía hardcodeada, consumidor distinto sin campo
propio en la config). **Verificación:** `pytest apps/tasks
apps/configuration apps/analytics` 1034/1034 (5 tests nuevos), `pytest
apps/` completo sin regresiones. Ver `docs/AUDIT_LOG.md` § 2026-08-28)
**Autor:** Claude Code

---

**Actualización anterior:** 2026-08-28 (v1.144.0 — Fases 87-90: cierre
COMPLETO del punto 14 del roadmap — decommission total de Prisma/
PostgreSQL del código. El usuario pidió terminar por completo ese punto
("continua para acaba toda la parte 14, avanza con los puntos A y B"),
confirmando primero vía `AskUserQuestion` que el alcance era solo código
— el servicio de Windows `postgresql-x64-16`/hosting Neon quedan fuera,
posible presencia de datos reales de personal. **3 agentes Explore en
paralelo antes de planificar corrigieron 2 de 3 supuestos del plan
ingenuo:** `resolveRoster.ts` (que la Fase 86 había dejado fuera por "sin
equivalente Django") resultó portable sin diseño de negocio nuevo — sus 3
piezas de lógica (roles visibles, exclusión de liderazgo, `scope`) ya
eran primitivas Python probadas en `apps.hierarchy.services`/
`apps.reports.permissions`; `computeDataQuality` ya tenía réplica EXACTA
en Django (`apps.analytics.scoring.compute_data_quality`, 3 consumidores
reales previos) — solo faltaba conectar su único consumidor TS
(`diagnostics/route.ts`, admin-only). **4 sub-fases:** Fase 87
(`GET /reports/roster/`, nueva `RosterView`), Fase 88
(`GET /analytics/diagnostics/`, nueva `AnalyticsDiagnosticsView`, reusa
`compute_data_quality` + `get_effective_config_string`/`set_config_value`
genéricos con una key nueva), Fase 89 (`GET /reports/monthly-report/`,
nueva `MonthlyReportView` — réplica exacta de un `findUnique` que siempre
devolvía `null`, confirmado que nada escribe esa tabla en ningún lado del
sistema desde el inicio de esta migración), Fase 90 (eliminación completa
del código: `package.json`, `prisma.config.ts`, `prisma/` — schema + 48
migraciones + seed —, `src/lib/prisma.ts`, `src/generated/prisma/`, 2
scripts de backfill inservibles sin Postgres, mock global de Prisma en
Vitest, `.env.example`/`.gitignore`, `CLAUDE.md`/`docs/ARCHITECTURE.md`).
**Hallazgo no trivial de la Fase 90:** 79 archivos importaban TIPOS
(no el cliente runtime) desde `@/generated/prisma/client` — cada uno se
redefinió como union type local en su módulo dueño de dominio en vez de
crear un archivo de tipos centralizado nuevo (`Role`, 74 de los 79
imports, se movió a `src/lib/roles.ts`, que ya era su hub natural con
`ALL_ROLES`/`ROLE_LABEL`; el resto a los adaptadores/componentes que ya
eran dueños de ese dominio — `ReportScope`/`ExecutiveReport*` →
`snapshotData.ts`, `MonthClosureType` → `djangoClosurePeriodAdapter.ts`,
`DataRequestType`/`Status` → `DataRequestsSection.tsx`, `Reminder*` →
`personalReminders.ts`, `DeskNote*` → `deskNotes.ts`, `EndDate*` →
`endDate.ts`, ya reexportados desde ahí). Valores exactos tomados de
`prisma/schema.prisma` antes de borrarlo — mismos que sus `choices`
equivalentes en Django, ya verificados idénticos en fases previas.
**Verificación:** `pytest apps/` (subset `reports`/`analytics` 826/826 +
suite completa sin regresiones), `npx tsc --noEmit`/`npx eslint src`
limpios (4 errores/2 warnings preexistentes en `ValidateActivityModal.tsx`/
`ReportWizardModal.tsx`, confirmados NO relacionados — `setState` síncrono
en efectos, ya existían antes de este cambio), `npx vitest run` 1099/1099
sin regresiones, `npm install` (97 paquetes retirados), `npx next build`
verificado — compila TypeScript limpio sin `prisma generate`/`prisma
migrate deploy` en el pipeline (falla después, en recolección de datos de
página, por `SESSION_SECRET` no configurado en este sandbox — limitación
ambiental preexistente sin relación con este cambio). **Con esto, los 14
puntos del roadmap de migración de stack quedan COMPLETO/CUTOVER 100% a
nivel de código.** Ver `docs/AUDIT_LOG.md` § 2026-08-28 (Fases 87-90))
**Autor:** Claude Code

---

**Actualización anterior:** 2026-08-28 (v1.143.0 — Fase 86: cutover de los
últimos 6 archivos sin explorar de `src/lib/*`/páginas SSR de esta
sesión. El usuario pidió continuar con "la siguiente fase" tras la Fase
85 — investigados con 3 agentes Explore en paralelo (2 fallaron por
límite de sesión, reintentados con éxito al día siguiente):
`notificationRules.ts`, `projectPhaseStats.ts` + `resolveRoster.ts`, y 4
`page.tsx`/`layout.tsx`. **5 de 6 resultaron reconexión simple, 1 fuera
de alcance:** `NotificationRulesView` (Django, Fase 35) ya exponía
`GET/PUT /settings/notification-rules/` completo — nuevo
`src/lib/djangoNotificationRulesAdapter.ts`, `notificationRules.ts`
eliminado. `projects/page.tsx` reconectado a `GET /projects/`
(Django completo desde la Fase 5f, filtro de visibilidad ya replicado
server-side en `ProjectViewSet.get_queryset`) + `fetchAllDjangoUsers()`
para `candidateUsers` (mismo patrón que `tasks/page.tsx`).
`dashboard/page.tsx` reconectado a `GET /users/<id>/view-preferences/`
llamado directo desde la página — **reusa el precedente exacto que ya
existía en `tasks/page.tsx`**, sin necesidad de un nuevo endpoint.
`projects/[id]/page.tsx` reconectado a `GET /projects/<id>/`
(`mapDjangoProjectDetailToNexoShape` ya incluía `phases[].registeredMinutes`/
`participants`/`lastActivity`, resueltos a mano hasta ahora por
`projectPhaseStats.ts`, eliminado tras el cutover). **Hallazgo durante
la implementación, no anticipado en el plan:** `projectAccess.ts`
(`isProjectManager`/`isProjectCreator`/`canViewProject`) comparaba
`session.userId` (cuid de Postgres) contra ids que, en la forma Django,
pasan a ser el id NUMÉRICO — una comparación que nunca hubiera
coincidido. Como Django ya hace ese control de acceso server-side
(`CanAccessProject`/`CanManageProject`/`CanDeleteProject`, verificado
línea por línea contra `projectAccess.ts` — misma fórmula exacta), la
página delega el 403/404 a la respuesta de Django (colapsa a
`notFound()`, mismo criterio que antes) y solo recalcula
`canManage`/`canDelete` localmente comparando el id numérico resuelto
vía `resolveDjangoUserId`; `projectAccess.ts` quedó sin ningún otro
consumidor y se eliminó completo. `layout.tsx` reconectado a
`GET /auth/me/` para el `ConsentGate` — requirió agregar
`data_consent_accepted` a `UserPublicSerializer` (Django, aditivo,
mismo criterio que `theme` en la Fase 38); llamada INDEPENDIENTE de
`resolveDjangoUserId` a propósito (su fast-path evita tocar Django si
`session.djangoUserId` ya está cacheado, pero el consentimiento
necesita dato siempre fresco). **Fuera de alcance:** `resolveRoster.ts`
— lógica de negocio propia de Reportes Ejecutivos (exclusión de roles
de liderazgo, narrowing por filtros, `scope`/`rosterKind`), sin
equivalente en ningún endpoint Django genérico de usuarios. **Gap
heredado, no cerrado a propósito:** `apps/tasks/services.py` sigue sin
leer `notification_rules` (documentado desde la Fase 35, sin
consumidor real conectado). **Verificación:** `pytest apps/` 461/461
(subset `authentication`/`users`/`configuration`/`projects`),
`npx tsc --noEmit`/`npx eslint` limpios, `npx vitest run` 1101/1101 (88
archivos). Ver `docs/AUDIT_LOG.md` § 2026-08-28 (Fase 86))
**Autor:** Claude Code

---

**Actualización anterior:** 2026-08-27 (v1.142.0 — Fase 85: reconexión del
bloque "Predictivo" de Reportes Ejecutivos a Django (reuso, no
construcción nueva). El usuario pidió continuar con el bloque
"Predictivo" tras la Fase 84 — la hipótesis original (documentada ahí)
era que hacía falta construir 3 endpoints Django nuevos exponiendo
datos crudos (permisos por rango, estados especiales con solape,
historial de auditoría). **Se investigó esa hipótesis con 3 agentes
Explore en paralelo antes de planificar — y resultó ser incorrecta:**
`predictionEngine.ts`/`capacityForecast.ts`/`trendEngine.ts` ya eran
réplicas exactas de código que Django sirve en vivo desde la Fase 48
(`/inteligencia-preventiva`). Se reconecta en vez de portar, mismo
patrón que el Índice Ejecutivo (Fase 57)/Nova Insights (Fase 54).
**2 gaps reales:** `PredictionBundleView` gana `?as_of=` (antes solo
"ahora"); nueva `TeamSubutilizationReportView`
(`POST /reports/executive/team-subutilization/`, `apps.reports`) con
roster explícito — la vista GET existente deriva la lista del equipo
jerárquico del ACTOR de la sesión, incompatible con el roster de un
reporte que puede pertenecer a otro jefe. **Cascada de código muerto
verificada función por función** (no archivo por archivo, mismo
cuidado de tipos que la Fase 84 — `CapacityForecast`/`CapacityEstado`
reubicados como declaraciones locales en `kpis/types.ts`, siguen vivos
para `GET /kpis/team-capacity`): `capacityForecast.ts`/`trendEngine.ts`/
`analyticsAuditHistory.ts` eliminados completos;
`analytics.ts::computeWeeklyHistory/computeConsistency/
computeEffectiveHistoryStart` retiradas (tipos `ConsistencyResult`/etc.
conservados); `workload.ts::sumWeightedBaseHours` retirada, lo que
reveló que **`leaves.ts`/`specialStatus.ts` quedaban completos sin
ningún consumidor real** — se eliminaron enteros, cerrando sin
necesitar ningún endpoint nuevo el backlog que la Fase 84 había dejado
para "una fase futura". **Fuera de alcance, documentado:** la rama
`isCurrentMonth` de `buildMonthlySnapshotData` sigue sin test de
integración end-to-end propio (gap preexistente desde la Fase 79, no
cerrado acá tampoco). **Verificación:** `pytest apps/` 1831/1831 (+10
tests nuevos), `npx tsc --noEmit`/`npx eslint` limpios, `npx vitest run`
1105/1105 (88 archivos). Ver `docs/AUDIT_LOG.md` § 2026-08-27 (Fase 85))
**Autor:** Claude Code

---

**Actualización anterior:** 2026-08-27 (v1.141.0 — Fase 84: reconexión del
motor interno a Django — cierra 3 bugs activos de divergencia de datos
(mismo patrón que las Fases 52/60) + limpieza masiva de código muerto.
El usuario pidió "continuar con la reconexión del TS" tras la Fase 83;
investigar el alcance real (3 agentes Explore en paralelo) reveló algo
más urgente que prolijidad: `holidays.ts::getHolidaySet()` seguía
leyendo Postgres pese a que `settings/holidays` ya escribe en Django
desde la Fase 52 — un feriado agregado desde Ajustes era invisible para
todo el motor de KPIs. Mismo patrón confirmado y cerrado en `workload.ts`
(vía `systemConfig.ts`, límites de carga laboral) y `closurePeriod.ts` +
`executiveReporting/periodStatus.ts` (Motor de Cierre Inteligente, este
último un hallazgo NUEVO durante la implementación, no anticipado en la
investigación). `ClosureStatusView` (Django) se extendió con 4 campos
que le faltaban. Se cortan también `analytics-config`/
`normalization-curves`/`prediction-window` (nunca antes conectados pese
a tener vista Django lista desde las Fases 31/32), simplificados para
confiar en la validación que Django ya hace (mismo patrón de
`workload-config`, Fase 52). **Limitación deliberada:** los 4 endpoints
Django reconectados solo exponen el valor efectivo AHORA, no vigente en
una fecha pasada — mismo trade-off ya aceptado en la Fase 73 para
`workday_end_hour`. **Limpieza:** 12 archivos `src/lib/*` completos sin
importadores reales (mismo patrón que la Fase 74) + 39 funciones muertas
dentro de `analytics.ts` (2430→~600 líneas)/`workload.ts`
(852→~120)/`predictionEngine.ts`/`reportInsights.ts`
(539→~185)/`systemConfig.ts` — regla aplicada en todo momento: nunca
asumir que el TIPO de retorno de una función muerta también está
muerto (varios tipos siguen vivos como contrato de la respuesta
ya-Django, re-exportados en `kpis/types.ts`; se encontró y corrigió un
caso real, `RoleTarget`, que casi se borra por error). **Verificación:**
`pytest apps/` 1821/1821, `npx tsc --noEmit`/`npx eslint` limpios,
`npx vitest run` 1128/1128 (90 archivos). **Fuera de alcance,
documentado para una Fase 85 futura:** el resto del bloque "Predictivo"
de Reportes Ejecutivos (`capacityForecast.ts`/`predictionEngine.ts`/
`trendEngine.ts` vivos + `leaves.ts`/`specialStatus.ts`/
`analyticsAuditHistory.ts`, que requieren construir endpoints Django
nuevos) y varios archivos sin investigar todavía
(`notificationRules.ts`/`projectPhaseStats.ts`/`resolveRoster.ts`, 4
`page.tsx`/`layout.tsx`). Ver `docs/AUDIT_LOG.md` § 2026-08-27 (Fase 84))
**Autor:** Claude Code

---

**Actualización anterior:** 2026-08-27 (v1.140.0 — Fase 83: port de
`MonthlyReport`/`DataPurgeLog` (retención/purga LOPDP) a Django. Con el
backlog de la Fase 81 (código de migración de datos reales completo,
pero ejecución descartada por decisión de producto en la Fase 82), el
usuario pidió continuar con "la siguiente fase" — el ítem más concreto
que quedaba en `docs/ROADMAP.md` § Planificado. Corrige la premisa
original de la Fase 8 ("`MonthlyReport` sin consumidor propio"):
`src/lib/retentionPolicy.ts` lo depura activamente y
`buildSnapshotData.ts` lo lee para el Índice Ejecutivo. **Alcance
simplificado por la Fase 82:** modelos Django vacíos, sin
`legacy_postgres_id` ni comando de importación (confirmado
explícitamente con el usuario vía `AskUserQuestion` antes de
implementar). **Trabajo:** `MonthlyReport` (`apps.reports`) +
`DataPurgeLog` (`apps.configuration`, sin `BaseModel`) nuevos;
`find_purge_candidates`/`execute_purge` en
`apps/configuration/services.py` (réplica exacta del TS, incluida
`_retention_cutoff_date` — mismo criterio de clampeo ya usado en
`advance_repeat`, Fase 7b, para no depender de `dateutil`); vista
`RetentionPolicyPurgeView` nueva — **cierra el catálogo `settings/*` al
100%** (era el único endpoint pendiente, documentado desde la Fase 31).
**Hallazgo corregido antes de escribir código:** el plan asumía que el
`GET` de la purga no exigía rol especial — releer el TS original (y su
test) confirmó que SÍ, igual que el `POST`; corregido en la vista y su
test antes de continuar. **Diseño no trivial:** la limpieza de GitHub
de documentos purgados se invierte de orden (Django borra en la base
primero, `route.ts` limpia GitHub después) — ya era best-effort en
ambos extremos, mismo resultado final, una llamada HTTP menos.
**Cutover:** `retention-policy/route.ts` (que en realidad NUNCA se
había cortado a Django pese a existir desde la Fase 31 — bloqueado por
la purga, la otra mitad de la misma pantalla) y
`retention-policy/purge/route.ts`, vía el nuevo
`src/lib/djangoRetentionAdapter.ts`; `src/lib/retentionPolicy.ts`
eliminado (sin consumidores tras el cutover). **Fuera de alcance,
explícito:** `buildSnapshotData.ts:381` (lectura de `MonthlyReport`
para el Índice Ejecutivo) queda intacta sobre Prisma — ya es
vestigial hoy, portarla habría ampliado el alcance sin necesidad real.
**Verificación:** `pytest apps/` 1820/1820 (1813 + 7 nuevos, todos en
verde salvo el hallazgo de permisos ya descrito), `npx tsc --noEmit`/
`npx eslint` limpios, `npx vitest run` 1228/1228 (96 archivos — 97
menos el archivo eliminado). Sin prueba manual en navegador (mismo
motivo que el resto de esta migración). Ver `docs/AUDIT_LOG.md` §
2026-08-27 (Fase 83))
**Autor:** Claude Code

---

**Actualización anterior:** 2026-08-27 (v1.139.1 — Fase 82: decisión de
producto de NO migrar datos históricos reales desde Postgres. El
usuario pidió avanzar con la ejecución real de los 40 comandos
escritos en la Fase 81 ("vamos con la parte 1"). Al investigar el
bloqueo documentado (ninguna `LEGACY_POSTGRES_URL` real configurada en
ningún entorno de esta migración, pese a que sí existe un PostgreSQL
16 real corriendo localmente como servicio de Windows en
`localhost:5432`) y preguntar por las credenciales/destino concretos,
el usuario aclaró explícitamente que no quiere recuperar ningún dato
histórico real: las pruebas de funcionalidad deben seguir usando
siempre datos ficticios, igual que en las Fases 70/77/80/81. **Decisión:**
la ejecución real de los 40 comandos de importación contra Postgres
queda descartada — deja de ser un bloqueante pendiente y pasa a ser
alcance explícitamente fuera de esta migración. El CÓDIGO de los 40
comandos (Fases 80-81) se conserva intacto y probado contra datos
sintéticos; simplemente no se ejecuta contra producción. Sin cambios
de código en este cambio — decisión de producto + corrección
documental de `docs/VERSION.md`/`docs/ROADMAP.md`. Ver
`docs/AUDIT_LOG.md` § 2026-08-27 (Fase 82))
**Autor:** Claude Code

---

**Actualización anterior:** 2026-08-27 (v1.139.0 — Fase 81: Waves 1-4
completas (38 comandos) — código de migración de datos reales 100%
escrito y verificado. El usuario pidió finalizar toda la "Fase A" tras
la Fase 80 (cimiento + Wave 0). Antes de escribir los 38 comandos
restantes se resolvieron 2 puntos abiertos con el usuario: investigar
`MonthlyReport`/`DataPurgeLog` reveló que NO son datos históricos
congelados — `src/lib/retentionPolicy.ts` los usa activamente hoy
(purga + registro de auditoría) y `buildSnapshotData.ts` lee
`MonthlyReport` para comparar contra el mes anterior; es un port de
FEATURE completo, no una migración de datos, así que el usuario eligió
dejarlo fuera de esta fase (backlog aparte en `docs/ROADMAP.md`). Sobre
el bloqueo de `migrate_users_from_postgres` contra datos reales (sin
`LEGACY_POSTGRES_URL`), el usuario eligió seguir con todo lo ejecutable
y dejar la ejecución real documentada como pendiente. **Trabajo:** los
38 comandos de las Waves 1-4, todos sobre el módulo compartido de la
Fase 80, sin cambios de diseño salvo un hallazgo nuevo: un modelo sin
timestamp legacy real para algún campo `auto_now` (`MeetingInvitee`,
sin `createdAt`/`updatedAt` en Prisma) reveló que `bulk_import_rows`
pisaba con `NULL` el valor "ahora" correcto que `bulk_create` ya había
generado — reproducido con datos sintéticos (`IntegrityError` real en
SQL Server), corregido para solo aplicar corrección cuando hay un valor
legacy real; de paso se envolvió la operación en `transaction.atomic()`.
Casos de FK no triviales resueltos: referencias sueltas numéricas con
resolución dinámica según tipo (`DeskAuditLog.entity_id`: `"NOTE"` →
`DeskNote`, `"REMINDER"` → `PersonalReminder`) y un campo
autorreferencial resuelto en 2 fases (`ProjectDocument.previous_version_id`).
**Verificación:** mismo método que las Fases 70/77/80 (Postgres
descartable + `.env` temporal + seed sintético vía Prisma Client
cubriendo las 38 entidades) — cadena completa Usuarios→Wave0→Wave1→
Wave2→Wave3→Wave4 corrida contra la BD de Django real de este entorno,
timestamps/FKs verificados caso por caso, re-ejecución de las 40
corridas 100% idempotente. Limpieza total al terminar.
`pytest apps/` 1813/1813, sin regresiones (solo comandos nuevos, sin
tocar modelos/vistas existentes). **Alcance NO cubierto, documentado
como backlog:** ejecución real contra producción (bloqueada por
credenciales) y el port de la feature de retención/purga. Ver
`docs/AUDIT_LOG.md` § 2026-08-27 (Fase 81))
**Autor:** Claude Code

---

**Actualización anterior:** 2026-08-27 (v1.138.0 — Fase 80: prerrequisitos
de migración de datos reales + patrón compartido + Wave 0. El usuario
pidió iniciar toda la "Fase A" identificada en el hallazgo del mismo
día — escribir los ~40 comandos de migración de datos, ejecutar
`migrate_users_from_postgres` contra datos reales, decidir el destino
de `MonthlyReport`/`DataPurgeLog`. Se propuso (y el usuario aprobó vía
Plan Mode) un enfoque por fases en vez de las 40 de una sola pasada:
construir el cimiento reutilizable y probarlo con las 2 entidades más
simples (Wave 0) antes de replicarlo 38 veces más — mismo criterio que
ya evitó bugs reales en esta migración (Fase 52, Fase 70). **Trabajo de
esquema:** `legacy_postgres_id` agregado a los 40 modelos Django en
alcance (13 apps, 13 migraciones nuevas, `pytest apps/` 1813/1813 sin
regresiones). **Módulo compartido** `backend/apps/core/legacy_migration.py`
con 2 hallazgos de corrección, el segundo descubierto DURANTE la
verificación con datos sintéticos, no anticipado en el plan original:
(1) `mssql-django` no soporta `bulk_create(ignore_conflicts=True)`
(`supports_ignore_conflicts = False`) — idempotencia resuelta
prefiltrando `legacy_postgres_id` ya importados antes de insertar; (2)
**`bulk_create` SÍ dispara `auto_now`/`auto_now_add`** — la premisa
inicial (que `bulk_create` "esquivaba" esos campos por no llamar a
`Model.save()`) resultó incorrecta, reproducida contra
`ActivityReason`/`Holiday` sintéticos: los timestamps legacy quedaban
pisados con la hora de la corrida. Causa real: Django llama a
`field.pre_save(obj, add=True)` durante el INSERT sin importar el
camino (`SQLInsertCompiler.pre_save_val`). Corregido con
`bulk_create()` + `bulk_update()` de corrección inmediato (`.update()`
nunca pasa por `pre_save()`), releyendo las filas por
`legacy_postgres_id` porque SQL Server tampoco devuelve las filas
insertadas (`can_return_rows_from_bulk_insert = False`). **Wave 0** — 2
comandos (`migrate_activity_reasons_from_postgres`/
`migrate_holidays_from_postgres`), verificados con el mismo método de
las Fases 70/77 (Postgres descartable vía Docker + `.env` temporal, sin
dejar infraestructura permanente): filas creadas con
`legacy_postgres_id` correcto, timestamps legacy preservados,
re-ejecución 100% idempotente, una fila nueva se importa sola sin
tocar las existentes. **Alcance NO cubierto, documentado como backlog
trackeable en `docs/ROADMAP.md`:** Waves 1-4 (36 comandos más, grafo de
dependencias completo ya documentado); `migrate_users_from_postgres`
contra datos reales (bloqueado por falta de `LEGACY_POSTGRES_URL`
real); decisión de producto sobre `MonthlyReport`/`DataPurgeLog`. Ver
`docs/AUDIT_LOG.md` § 2026-08-27 (Fase 80))
**Autor:** Claude Code

---

**Actualización anterior:** 2026-08-27 (v1.137.1 — Corrección: "migración
de stack 100% completa" conflacionaba cutover de ruta con migración
de datos reales. El usuario preguntó qué falta para levantar el
sistema con exactamente los mismos datos y comportamiento que el
sistema anterior — una pregunta de disponibilidad operativa real, no
de completitud de código. La investigación (agente Explore) reveló
que `migrate_users_from_postgres` es el ÚNICO comando de migración de
datos que existe en TODO el backend (grep exhaustivo de
`management/commands/` en las 18 apps Django) — y solo migra la tabla
`User`. **No existe, ni sin ejecutar, ningún comando equivalente para
~40 entidades de negocio más**: Tareas/TaskActivity/Comentarios,
Proyectos + 6 sub-entidades, Notificaciones, Notas/Recordatorios del
Escritorio, Reuniones/Invitados, Ideas/Votos, Solicitudes LOPD,
Feriados/Permisos/Estados Especiales, Historial de Configuración, Base
de Conocimiento/Chunks, Comunicados, Papelera/Recovery. De los 44
modelos de `prisma/schema.prisma`, 42 ya tienen modelo Django
equivalente construido (el esquema está listo para recibir datos) —
solo 2 (`MonthlyReport`/`DataPurgeLog`) no tienen equivalente y
requieren una decisión de producto. **Sin mecanismo de escritura
dual** — de 150 `route.ts`, solo 3 siguen tocando Prisma; todo el
resto habla exclusivamente con Django desde su cutover, así que Django
nunca acumuló datos reales en paralelo (confirmado en este mismo
entorno: 0 Tareas/0 Usuarios reales en la BD de Django antes de la
siembra sintética de la Fase 77). **El hallazgo ya estaba documentado
una vez, aislado, sin generalizarse**: al cortar `/api/tasks` (Fase
3a, 2026-08-07) se registró que Django quedaría con la lista de
tareas vacía para todo usuario real hasta una fase de importación
posterior que nunca se escribió — ese aviso nunca se generalizó a una
lista de seguimiento de "qué falta para un go-live real". **Corrección
aplicada:** esta fila y `docs/ROADMAP.md` (§ Planificado, punto 14)
corregidas para distinguir explícitamente cutover de ruta (100%
completo) de migración de datos reales (pendiente en su totalidad
salvo Usuarios) — más un ítem de backlog nuevo, trackeable, más
urgente que Sprint S/T/U. **Sin código escrito** — escribir los ~40
comandos de migración queda pendiente de decisión con el usuario, no
se emprendió en este cambio. Cambio puramente documental. Ver
`docs/AUDIT_LOG.md` § 2026-08-27 (hallazgo de migración de datos))
**Autor:** Claude Code

---

**Actualización anterior:** 2026-08-27 (v1.137.0 — Fase 79: Sprint R —
Snapshot Integrity Validation. Con Sprint Q cerrado (Fases 77/78), el
usuario pidió avanzar con "Sprint R", diferido desde 2026-07-28
(Decisión 9): el FPS Parte IV §15 exige que los valores de un reporte
ejecutivo coincidan con Dashboard/Analytics para la misma fecha de
corte, y que una discrepancia se registre como incidente — en ese
momento se consideró suficiente la integridad ESTRUCTURAL (Builder
canónico + objeto congelado) y se difirió la validación ACTIVA como
mejora futura. **El texto original del FPS §15 no existe en el
repo** — se trabajó con la paráfrasis ya documentada (consistente en 4
lugares). **Investigación previa (agente Explore) reveló 2 gaps del
FPS, resueltos con el usuario:** `GET /api/dashboard` no tiene ningún
KPI para comparar — "Dashboard/Analytics" se interpretó como las
pantallas de KPIs/Analytics reales (`GET /kpis/team/`+
`GET /analytics/<id>/`); `TeamKpiView` no es consciente de la fecha de
corte de un reporte — comparar contra reportes históricos/con corte
explícito habría generado discrepancias falsas por diseño, así que
**la validación solo corre para reportes MENSUAL del mes calendario en
curso SIN `fechaCorte` explícita**, el único caso donde ambas
superficies miran el mismo momento. No existía ningún modelo de
"incidente" en el proyecto — **se creó un modelo Django nuevo
dedicado** (`ExecutiveReportIntegrityIncident`), no una extensión de
`ExecutiveReportAuditLog` (log append-only sin campos estructurados
para expected/actual). Con la migración de stack 100% completa (Fase
76), toda funcionalidad nueva se construyó directamente en Django, sin
agregar ningún modelo Prisma. **Implementación:** modelo nuevo (mismo
patrón que `ExecutiveReportAuditLog` — campos sueltos sin FK,
append-only) + endpoint nuevo `POST /reports/executive/integrity-incidents/`
(solo creación, sin listado — sin UI que lo necesite todavía). Nuevo
`src/lib/executiveReporting/verifySnapshotIntegrity.ts`, llamado desde
`buildMonthlySnapshotData` en paralelo con Índice Ejecutivo/Predictivo
(nunca agrega latencia secuencial), compara `completedPct`/`cargaPct`
contra `GET /kpis/team/` (código Python genuinamente distinto del
motor de reportes — a diferencia del Índice Ejecutivo, deliberadamente
NO comparado por ser casi tautológico) con tolerancia de ±0.5 puntos
porcentuales, best-effort, nunca lanza (mismo principio que NOVA, FPS
§8). Nuevo campo `integrityCheck` en el snapshot, mismo espíritu que
`novaDegraded`. **Verificación:** `pytest apps/reports` 166/166,
backend completo 1813/1813 en verde. `npx tsc --noEmit`/`npx eslint`
limpios, suite completa de Vitest **1233/1233 en verde** (97 archivos,
+7 tests: 6 nuevos en `verifySnapshotIntegrity.test.ts` + 1 en
`buildSnapshotData.test.ts`). **Nota de cobertura honesta:** la rama
`isCurrentMonth` de `buildMonthlySnapshotData` no tenía, y sigue sin
tener, un test de integración end-to-end propio — se probó
`verifySnapshotIntegrity.ts` exhaustivamente en aislamiento, su
llamado real queda verificado por tipos y revisión de código, no por
un nuevo arnés de integración (mejora de cobertura preexistente y más
amplia que esta fase). **Impacto:** cierra Sprint R sin cambio de
comportamiento visible para el usuario final — los incidentes se
registran en Django, sin UI todavía (alcance explícitamente diferido,
junto con RANGO_MESES/RANGO_PERSONALIZADO/reportes con corte
explícito y el Índice Ejecutivo). Ver `docs/AUDIT_LOG.md` § 2026-08-27
(Fase 79))
**Autor:** Claude Code

---

**Actualización anterior:** 2026-08-27 (v1.136.0 — Fase 78: gunicorn pasa
a `gthread` (workers × threads) — fix del hallazgo de severidad alta
de la Fase 77 (`POST /api/reports/executive?tipoReporte=MENSUAL` podía
fallar con 500 para el mes en curso). Con el hallazgo confirmado, el
usuario pidió seguir; antes de escribir código se investigó (solo
lectura, sin infraestructura) si la causa era de aplicación o de
despliegue — resultó ser lo segundo. **Hallazgo:**
`backend/entrypoint.sh` arranca gunicorn con `--workers 3` sin
`--threads` — el worker `sync` por defecto atiende 1 request a la vez
por worker, así que producción real solo puede procesar 3 requests
HTTP simultáneas en total. `buildMonthlySnapshotData` dispara N
llamadas paralelas a `GET /analytics/<id>/` (una por colaborador); con
9-11 colaboradores (el escenario medido en la Fase 77), 6-8 de esas
llamadas quedan haciendo cola detrás de los 3 workers. La aritmética
de esa cola (⌈11/3⌉ rondas × ~1.2-1.8s/request, medido en la Fase 77)
da ~6-7.2s — coincide con precisión con el rango medido (5-9s), y
**reproduciría igual en producción real**, no es un artefacto de
`manage.py runserver` (la config de `--workers 3` es la misma en
ambos casos). **Se presentaron 3 opciones al usuario** (subir
workers/threads directamente; construir un endpoint batch en Django;
verificar primero contra gunicorn real antes de decidir) — eligió la
primera, sin bloquear en una re-verificación. **Implementación:**
`backend/entrypoint.sh` agrega `--worker-class gthread --threads
"${GUNICORN_THREADS:-4}"` (nuevo; `--workers` se mantiene configurable
como antes). Se elige subir threads en vez de workers porque la carga
es de I/O (espera de red hacia SQL Server, no CPU — el cómputo puro
mide ~0.28s combinadas, medido en la Fase 77) — un worker `gthread`
atiende varios requests I/O-bound concurrentes DENTRO del mismo
proceso, mucho más barato en memoria que clonar el proceso completo de
Django por cada unidad de concurrencia adicional. Capacidad total: de
3 a 12 requests simultáneas con los defaults. **Sin re-verificar
contra gunicorn real** — decisión explícita del usuario, documentada
como tal en el propio comentario de `entrypoint.sh` para que quede
claro que es un ajuste razonado a partir de la aritmética de cola, no
un número confirmado con una medición nueva; gunicorn ni siquiera está
instalado en el entorno de desarrollo (solo en
`requirements/prod.txt`), así que no se pudo levantar el contenedor
real para confirmarlo en esta sesión. **Verificación:** `bash -n
entrypoint.sh` (sintaxis válida). Sin cambios de código de aplicación
Python/TypeScript — cambio puramente de configuración de arranque del
contenedor. **Impacto:** si la hipótesis es correcta (alta confianza,
sin confirmación empírica nueva), este cambio debería resolver o
mitigar sustancialmente el 500 activo de la Fase 77 sin tocar código
de aplicación. Queda pendiente, sin urgencia, una re-medición con
`scripts/bench-executive-report.ts` contra un despliegue real. Ver
`docs/AUDIT_LOG.md` § 2026-08-27 (Fase 78))
**Autor:** Claude Code

---

**Actualización anterior:** 2026-08-26 (v1.135.0 — Fase 77: re-medición
de Sprint Q — **hallazgo de severidad alta, sin corregir todavía.**
El usuario pidió avanzar con "Sprint Q — Analytics Engine
Performance" (backlog fechado 2026-07-28, ~22s/9 colaboradores sobre
un presupuesto de 15s). Antes de planificar una optimización, se
investigó si esa descripción seguía vigente tras el cierre completo de
la migración de stack — resultó **parcialmente desactualizada**: 2 de
las 4 funciones originales (`computeHealthScore`/`computePerformanceScore`)
ya no corren localmente desde la Fase 57 (reemplazadas por N llamadas
HTTP paralelas a Django, `fetchPerformanceAndHealth`); las otras 2
(`computeCumplimientoProjection`/`computeSobrecargaProbability`,
`predictionEngine.ts`) siguen igual. Nadie había vuelto a medir el
tiempo real desde ese cutover. **El usuario eligió explícitamente
reconstruir el escenario sintético completo** (Postgres + Django, en
vez de una medición parcial) y remedir de punta a punta. **Metodología**
(misma ya usada y documentada en la Fase 70): Postgres descartable vía
Docker + `.env` temporal + `prisma migrate deploy`; seed de 9
colaboradores sintéticos con tareas del mes en curso; **importados a
Django con el comando REAL de producción**
(`migrate_users_from_postgres`, apuntado temporalmente al Postgres
descartable — 13/13 sin fallos, validación incidental de ese comando,
el único paso operativo pendiente de toda la migración de stack);
`next dev` + `manage.py runserver` reales, login real para obtener
cookies válidas. **`scripts/bench-executive-report.ts` reescrito**
(permanece en el repo): el patrón anterior (builders directos, sin
HTTP/sesión) dejó de ser viable — desde la Fase 57,
`buildMonthlySnapshotData` depende de `cookies()` de `next/headers`,
que lanza fuera de un request real de Next.js; el script nuevo hace
login real y llama al endpoint de producción real
(`POST /api/reports/executive`), leyendo `generationMs` de la
respuesta. **Resultado — MENSUAL (mes en curso) FALLA con 500, no solo
excede presupuesto:** RANGO_MESES (3.64s) y RANGO_PERSONALIZADO
(2.58s) midieron cómodos dentro de los 15s con 11 colaboradores —
nunca llaman a la ruta de Índice Ejecutivo. **Causa raíz, aislada con
3 mediciones independientes** (cálculo puro Django ~0.28s; 1 llamada
HTTP aislada ~1.2-1.8s; **N llamadas HTTP concurrentes reales
5.0-9.0s cada una**) — el timeout de cliente de `djangoApiFetch` es de
solo 3 segundos, insuficiente incluso para 1 llamada aislada con poco
margen, y claramente insuficiente bajo la concurrencia real que usa
`buildMonthlySnapshotData`. **Salvedad metodológica documentada:** la
medición usó `manage.py runserver` (dev, un proceso), no
necesariamente representativo de un despliegue de producción real —
la magnitud exacta podría diferir, pero el margen de seguridad del
timeout es estructuralmente mínimo bajo cualquier servidor. **No se
investigó la causa exacta de la degradación bajo concurrencia ni se
implementó ninguna corrección** — el alcance acordado fue
deliberadamente solo medición; queda pendiente una fase de
optimización separada (aumentar el timeout, batch-ificar
`predictionEngine.ts`, construir un endpoint batch en Django, y/o
investigar la causa raíz). **Limpieza:** toda la infraestructura
descartable de la medición (Postgres, usuarios sintéticos en Django,
`.env` temporal, script de seed) fue eliminada — el repo queda igual
que antes salvo el script fijo y esta documentación. `npx tsc
--noEmit`/`npx eslint` limpios. Ver `docs/AUDIT_LOG.md` § 2026-08-26
(Fase 77))
**Autor:** Claude Code

---

**Actualización anterior:** 2026-08-26 (v1.134.1 — Migración de stack
hacia skelleton_base, cierre formal: con Centro de Configuración
cerrado (Fase 76), se re-auditó `docs/ROADMAP.md` completo — los 14
puntos numerados quedan todos COMPLETO/CUTOVER 100%, salvo un único
paso operativo, no de código: ejecutar `migrate_users_from_postgres`
contra la base Postgres legacy real, bloqueado por falta de
credenciales reales de `LEGACY_POSTGRES_URL` en este entorno (el
comando ya está implementado y completamente probado —
`test_migrate_users_from_postgres.py`, nunca requiere una conexión
real — listo para el día del corte). Se consolidó además la fila
"Backend Django (migración de stack)" de la tabla "Estado actual"
(abajo), que no reflejaba las Fases 73-76 en su propio texto
narrativo. Cambio puramente documental, sin código tocado. Ver
`docs/AUDIT_LOG.md` § 2026-08-26 (Fase 76) para el detalle técnico del
último cutover real.)
**Autor:** Claude Code

---

**Actualización anterior:** 2026-08-26 (v1.134.0 — Migración de stack hacia
skelleton_base, Fase 76: cutover de favoritos del Centro de
Configuración (Prisma→Django) — cierra un riesgo de divergencia de
datos activo y **completa Centro de Configuración al 100% dentro de
la migración de stack**. Con el hallazgo de seguridad cerrado (Fase
75), el usuario pidió avanzar con el punto restante: el "rediseño
completo de `/settings`" que `docs/ROADMAP.md` describía como
pendiente. **Investigación — la premisa del ROADMAP estaba
desactualizada, no el código:** 2 agentes de exploración en paralelo
(mapeo de la UI actual de `/settings`, investigación de la
infraestructura de favoritos/historial de auditoría/búsqueda)
confirmaron independientemente que ese rediseño ya se había
implementado por completo en **Sprint O** (2026-07-28, v1.21.0),
antes incluso de que empezara esta lista de fases de la migración de
stack — `SettingsManager.tsx` (acordeón plano) ya no existe en el
repo, reemplazado por `ConfigCenter.tsx` con categorías/búsqueda/
favoritos/historial de auditoría, todo funcionando end-to-end. Las 2
menciones del texto desactualizado en `ROADMAP.md` predataban la
ejecución real de Sprint O y quedaron sin corregir por más de 20
fases. **Hallazgo real dentro de ese shell ya completo:** el endpoint
de favoritos (`GET/PATCH /api/settings/favorites`) nunca se cortó a
Django — seguía leyendo/escribiendo `User.viewPreferences` vía Prisma
(`configFavorites.ts`), pese a que su réplica Django (`FavoritesView`,
completa desde la Fase 28) existía sin usar. **No era solo código sin
cortar:** `PATCH /dashboard/card-order` (mismo campo
`User.viewPreferences`, mismo truco de prefijo) ya escribía en Django
desde la Fase 55 — ambos endpoints leían/escribían 2 copias distintas
del mismo array desde bases de datos distintas, riesgo de divergencia
activo (mismo patrón de bug real que el cerrado en la Fase 52) para
cualquier usuario que usara ambas funciones. El propio comentario de
`dashboard/card-order/route.ts` afirmaba, incorrectamente, que
`favorites` "ya cortado desde antes" — corregido en el mismo cambio.
**Se presentaron 3 opciones al usuario** (cortar favoritos y cerrar
Centro de Configuración; solo corregir la documentación; ambas cosas)
— eligió la primera, que en la práctica incluye corregir el ROADMAP.
**Implementación:** `route.ts` reescrito, mismo patrón que
`dashboard/card-order/route.ts` (401 con mensaje de re-login si
Django no responde) y `seguridad-config/route.ts` (traducción
`settingId`→`setting_id`) — sin remapeo de campos en la respuesta, la
forma de Django ya coincidía exactamente. **Sin cambios de backend**
— `FavoritesView`/`FavoriteUpdateSerializer` ya existían completos,
con su propia suite de tests (`test_favorites_view.py`, 6/6 en verde,
confirmado sin tocar). `configFavorites.ts` eliminado (único
importador era este `route.ts`) junto con su test dedicado (5 tests
que probaban lógica Prisma ya eliminada — cobertura equivalente ya
existe, exhaustiva, del lado Django). `settings-config-center.test.ts`
reescrito, mismo patrón que el describe de `config-history` ya
existente en ese archivo. `ROADMAP.md` corregido — "Centro de
Configuración" pasa de "EN CURSO" a "COMPLETO Y CUTOVER 100%".
**Verificación:** `npx tsc --noEmit` limpio, `npx eslint` limpio,
suite completa de Vitest **1226/1226 en verde** (96 archivos, bajó de
97 por la eliminación de `configFavorites.test.ts`). Sin cambios de
backend — `pytest test_favorites_view.py` 6/6 en verde como
confirmación. **Impacto:** cierra Centro de Configuración al 100%
dentro del alcance de la migración de stack, y un riesgo de
divergencia de datos activo de paso. Dentro de la migración de stack
solo queda pendiente `migrate_users_from_postgres` contra datos
reales (Decommission de PostgreSQL, postergada a propósito por falta
de `LEGACY_POSTGRES_URL`). Ver `docs/AUDIT_LOG.md` § 2026-08-26 (Fase
76))
**Autor:** Claude Code

---

**Actualización anterior:** 2026-08-26 (v1.133.0 — Migración de stack hacia
skelleton_base, Fase 75: clampea `password_min_length` a un piso de
10 — cierra el hallazgo de seguridad de la Fase 61. Segundo
incremento del Centro de Configuración: el usuario eligió
explícitamente este hallazgo (documentado desde la Fase 61, sin
corregir) antes que el rediseño de `/settings`. **Investigación —
precisando el alcance real antes de proponer una política:**
confirmado con `grep`/lectura de código que Django SÍ enforcea
`AUTH_PASSWORD_VALIDATORS.MinimumLengthValidator(min_length=10)` en 5
puntos reales de validación de contraseña (`apps/authentication/
serializers.py` ×3, `apps/users/serializers.py` ×1, creación
administrativa) — no era una vulnerabilidad (Django nunca permite
algo más débil que 10, pase lo que pase en Ajustes), sino una
**configuración engañosa por debajo de 10**: el valor configurable
(`password_min_length`, default histórico 6) solo se usaba como
pre-validación de UX en un único flujo
(`POST /api/auth/change-password`). Efecto colateral documentado, sin
tocar: la creación admin de usuarios ya usa un password fijo de 18
caracteres, y el reseteo admin ya no define contraseñas desde la Fase
2 (el "123456" de `CLAUDE.md` es dato del seed, no del flujo de
reseteo real). **Se presentaron 3 opciones al usuario** (clampear el
piso a 10; hacer que Django respete el valor dinámicamente; solo
documentar) — eligió la primera. **Implementación:**
`password_min_length` clampeado a un piso de 10 en los 3 puntos que
replican el mismo rango (`SeguridadConfigUpdateSerializer` en Django,
`PUT /api/settings/seguridad-config`, input de
`SeguridadConfigSection.tsx` + texto de ayuda nuevo); default subido
de 6 a 10 en los 3 lugares que lo duplican. **Decisión tomada durante
la implementación, no parte de la pregunta original:** el clamp se
aplica también en LECTURA (`get_effective_password_min_length` →
`max(10, ...)`), no solo en la validación del `PUT` — sin esto, una
fila de `SystemConfigHistory` guardada antes de esta fase con un
valor menor seguiría mostrándose como vigente hasta que alguien la
sobrescribiera; el clamp en lectura corrige cualquier instalación ya
configurada de inmediato, sin migrar datos históricos de auditoría.
**Tests nuevos:** rechazo por debajo del piso en el `PUT` (Django y
TS) y clamp en lectura de una fila histórica ya guardada
(`test_effective_config.py`, nuevo). **2 tests de `auth.test.ts`
rotos como efecto colateral del cambio de default** (usaban una
contraseña de prueba de 8 caracteres, ahora insuficiente contra el
nuevo default de 10, en tests que mockean a Django en blanco) —
corregidos subiendo la contraseña de prueba a 16 caracteres; no es un
bug de producción, es acoplamiento incidental de un fixture con el
default global. **Verificación:** `npx tsc --noEmit` limpio, `npx
eslint` limpio, suite completa de Vitest **1230/1230 en verde** (97
archivos). `pytest apps/configuration` 8/8 en
`test_seguridad_config_view.py` (verificado en aislamiento — una
corrida paralela con la suite completa de `pytest` produjo un
deadlock transitorio de SQL Server por contención entre 2 procesos
simultáneos, no una regresión real). **Impacto:** Ajustes ya no puede
prometer, ni mostrar, un mínimo de contraseña más permisivo del que
Django realmente aplica, para ninguna instalación. Del Centro de
Configuración queda 1 pieza: el rediseño completo de `/settings`. Ver
`docs/AUDIT_LOG.md` § 2026-08-26 (Fase 75))
**Autor:** Claude Code

---

**Actualización anterior:** 2026-08-26 (v1.132.0 — Migración de stack hacia
skelleton_base, Fase 74: elimina `insightsEngine.ts`/`riskAlerts.ts` —
primer incremento del Centro de Configuración. Con Reportes
Ejecutivos cerrado al 100% (Fase 73), el usuario preguntó qué faltaba
y luego pidió avanzar con el ítem "Centro de Configuración — EN
CURSO", que agrupa 4 piezas de naturaleza muy distinta (limpieza de
código muerto, un hallazgo de seguridad que requiere decisión de
producto, un rediseño completo de `/settings`, y
`retention-policy/purge` fuera de alcance). **Se le preguntó
explícitamente al usuario por cuál empezar** (no era un incremento
obvio como en fases anteriores, donde el orden lo dictaba una
dependencia técnica) — eligió la opción de menor riesgo: la limpieza
de `insightsEngine.ts`/`riskAlerts.ts`, código muerto identificado
desde la Fase 63 pero dejado fuera de esa fase por tener "ataduras
que requieren trabajo adicional antes de poder eliminarlos con
seguridad". **Investigación — confirmando que las 2 ataduras
documentadas seguían siendo las únicas:** `grep` de ambos módulos en
todo `src/` (código y tests) confirmó exactamente las 2 ataduras ya
documentadas por la Fase 63, sin ningún caller nuevo aparecido desde
entonces — `riskAlerts.ts` expone el tipo `RiskAlert` (`import type`
en `components/kpis/types.ts`) e `insightsEngine.ts` comparte
`analytics-formulas.test.ts` con tests de `analytics.ts` (que SÍ
sigue vivo). Confirmado además que ambas lógicas están portadas con
consumidor HTTP real en Django antes de borrar: `riskAlerts.ts` vía
`GET /kpis/<id>/` (Fase 4b) e `insightsEngine.ts` vía `GET
/analytics/insights/<id>/` (`insights_engine.py`, Fases 4j/4k,
consumido por `InsightsPanel.tsx` desde el cutover de la Fase 47);
`test_insights_engine.py` (backend) confirmado como cobertura
equivalente exhaustiva. **Implementación:** `RiskAlert`/
`RiskAlertSeverity` movidos a `components/kpis/types.ts` (su único
consumidor real) antes de borrar `riskAlerts.ts`; los 2 describe de
`analytics-formulas.test.ts` que probaban funciones de
`insightsEngine.ts` (`computeEquilibrioInsights`/
`explainEquilibrioFactor`/`explainEquilibrioMeaning`/
`explainEquilibrioImpact`, ~80 líneas, 8 tests) se eliminaron sin
reemplazo — mismo criterio que la Fase 72 al eliminar tests de
lógica ya migrada a Django. Ambos archivos borrados
(`riskAlerts.ts`, `insightsEngine.ts`, 999 líneas). 5 comentarios
corregidos en archivos que mencionaban estos 2 módulos por nombre y
quedaron desactualizados (`preventiveIntelligence.ts`,
`GlobalParamsSection.tsx`, `reportInsights.ts`, `analytics.ts`,
`InsightsPanel.tsx`) — sin cambio de comportamiento, solo precisión
documental. **Verificación:** `npx tsc --noEmit` limpio, `npx eslint`
limpio en los 9 archivos tocados, suite completa de Vitest —
**1229/1229 en verde** (97 archivos, 8 tests menos que la Fase 73 —
exactamente los eliminados sin reemplazo). Sin cambios de backend.
**Impacto:** de los "10 motores legacy" re-auditados en la Fase 63,
quedan 8 resueltos (6 eliminados en total entre ambas fases, más
`analytics.ts`/`workload.ts`/`predictionEngine.ts`/`trendEngine.ts`/
`capacityForecast.ts` confirmados genuinamente vivos) — ninguno queda
pendiente de re-evaluación. Del Centro de Configuración quedan 2
piezas: el hallazgo de seguridad de `password_min_length` (Fase 61,
requiere decisión de producto) y el rediseño completo de `/settings`
(proyecto de UI de tamaño propio, sin planificar en detalle
todavía). Ver `docs/AUDIT_LOG.md` § 2026-08-26 (Fase 74))
**Autor:** Claude Code

---

**Actualización anterior:** 2026-08-26 (v1.131.0 — Migración de stack hacia
skelleton_base, Fase 73: cutover HTTP real de RANGO_PERSONALIZADO y
RANGO_MESES en `buildSnapshotData.ts` + fix de la divergencia de
`workday_end_hour` — **cierra Reportes Ejecutivos al 100% en Django**.
El usuario pidió explícitamente terminar las 3 piezas pendientes del
motor de cálculo de Reportes Ejecutivos en una sola fase ("finaliza
con los reportes ejecutivos... en 1 sola fase"). **Alcance —
mecánico y más simple que el cutover MENSUAL de la Fase 72:**
`buildCustomRangeSnapshotData` (RANGO_PERSONALIZADO) cortado a `POST
/reports/executive/custom-range-team-kpis/` y `buildRangeSnapshotData`
(RANGO_MESES) a `POST /reports/executive/range-team-kpis/` (ambos
endpoints ya construidos y verificados campo por campo desde las
Fases 69/70/71) vía `fetchCustomRangeTeamReport`/`fetchRangeTeamReport`
(`djangoReportKpisBridge.ts`, ya existían sin usar desde la Fase 72).
A diferencia de MENSUAL, ninguno de los 2 builders tuvo nunca
integración con el Índice Ejecutivo — confirmado releyendo el TS
original — así que `insights`/`estadoOperativo`/`principalHallazgo`
vienen del bundle de Django sin ninguna glue code. Mismas 2
decisiones de comportamiento en producción ya confirmadas en la Fase
72 (Django falla → la generación falla; sin id de Django resuelto →
se excluye de la tabla) aplicadas sin volver a preguntar, por ser ya
el criterio establecido del motor completo. **Única pieza con lógica
propia:** `monthlyEvolution` (RANGO_MESES) — Django devuelve
`member_snapshots` por mes como diccionario indexado por id numérico
sin campos de identidad (decisión deliberada de las Fases 66/71,
documentada en su propio docstring Python), reconstruido en TS como
array usando el `members` ya remapeado para resolver la identidad,
aplicando el mismo recorte de campos que el TS original
(`overdueCount`/`cargaRealHours`/`cargaBaseHours` no viajan al
snapshot final). Con MENSUAL ya cortado, ambos builders eliminan
también su computación local de agregados de equipo, sin ningún
caller vivo restante en `buildSnapshotData.ts`
(`computeRiskQuadrant`/`computeFindings`/`computeRecommendations`/
`explainCumplimientoIndicator`/`explainCargaIndicator`/
`explainConsultasIndicator`/`explainMotivoDistribution`/
`getActivityReasonLabelMap`/`computeTeamInsights`/
`computeEffectiveMemberBases`/`previousEquivalentPeriod`), más 2
funciones locales ya muertas (`getMonthsInRange`/`asOfFechaCorte`).
**Fix de `workday_end_hour` (hallazgo de la Fase 63, parte 3):**
`capacityForecast.ts` seguía leyendo la hora de corte de jornada de
Postgres (`getEffectiveWorkdayEndHour`, `systemConfig.ts`) pese a que
Ajustes → Trabajo Avanzado ya escribe ese valor en Django desde la
Fase 60 — staleness activa, editar el valor desde Ajustes no tenía
efecto real en Capacidad Proyectada. Nuevo
`src/lib/djangoWorkdayEndHourConfig.ts`, mismo patrón de degradación
que `djangoNovaCacheConfig.ts` (Fase 59): si Django no responde,
devuelve el default hardcodeado (17, idéntico al default de Django)
en vez de fallar — es un insumo heurístico, no el corazón visible del
reporte, criterio deliberadamente distinto del de `ReportMemberKpi`
(Fase 72). `CONFIG_KEY_WORKDAY_END_HOUR`/`DEFAULT_WORKDAY_END_HOUR`/
`getEffectiveWorkdayEndHour`/`setWorkdayEndHour` eliminados de
`systemConfig.ts` (código muerto confirmado por `grep` — cero
callers). El duplicado homónimo en
`src/components/settings/registry.ts` (metadata de UI, ya documentado
como deliberado en su propio comentario) no se toca. **Cobertura —
hallazgo real durante la verificación:** la suite pasó en verde de
inmediato tras el rewrite inicial, algo sospechoso dado que el
cutover de MENSUAL sí había requerido actualizar mocks
extensivamente; investigado con `grep`, ningún test previo invocaba
estos 2 builders de punta a punta — la "suite en verde" era ausencia
de cobertura, no verificación. Se agregaron 7 tests nuevos (3 para
RANGO_PERSONALIZADO, 4 para RANGO_MESES, incluida la reconstrucción
de `monthlyEvolution`), mismo rigor que la Fase 72. **Verificación:**
`npx tsc --noEmit` limpio (1 error real corregido — `WorkloadColor`/
`WorkloadLabel` tipados como `string` genérico en el tipo crudo de
`monthlyEvolution` en vez de las uniones estrictas de
`@/components/kpis/types`). `npx eslint` limpio en los 6 archivos
tocados. Suite completa de Vitest — **1237/1237 en verde** (97
archivos). Sin cambios de backend — los 2 endpoints HTTP y
`TrabajoAvanzadoView` ya existían, no requirió `pytest`. **Impacto:**
cierra el motor de cálculo de Reportes Ejecutivos al 100% en Django
para los 3 tipos de reporte — `buildSnapshotData.ts` ya no depende
de Prisma para `ReportMemberKpi`/agregados de equipo en ningún
builder, solo para roster/Índice Ejecutivo/Predictivo (mes en curso,
solo MENSUAL)/NOVA/metadatos. Del ítem "Decommission de PostgreSQL"
solo queda pendiente la migración de usuarios reales
(`migrate_users_from_postgres`, postergada a propósito por falta de
`LEGACY_POSTGRES_URL` en este entorno). `renderReportHtml.ts`/
`renderReportExcel.ts` (exportación) y la narrativa NOVA (Groq) no
necesitan portarse — presentación/lenguaje natural, no cálculo de
negocio, mismo criterio que Nova Insights (Fase 54). Ver
`docs/AUDIT_LOG.md` § 2026-08-26 (Fase 73))
**Autor:** Claude Code

---

**Actualización anterior:** 2026-08-26 (v1.130.0 — Migración de stack hacia
skelleton_base, Fase 72: primer cutover HTTP real del motor de
CÁLCULO de Reportes Ejecutivos — builder MENSUAL. Con las Fases 70/71
cerradas (los 3 builders verificados campo por campo contra
`buildSnapshotData.ts`), el usuario pidió continuar ("sigue a la
siguiente parte") con el paso que esas 2 fases existían para
des-riesgar: el cutover HTTP real. **Decisiones de comportamiento en
producción, preguntadas explícitamente antes de escribir código:** (1)
si Django falla al generar un reporte, ¿debe fallar o degradar? — el
usuario eligió que FALLE explícitamente (a diferencia del Índice
Ejecutivo, que degrada excluyendo colaboradores — `ReportMemberKpi` es
el corazón visible del reporte, no un agregado secundario); (2) un
colaborador sin id de Django resuelto, ¿se excluye o bloquea la
generación completa? — el usuario eligió excluirlo, mismo criterio que
el Índice Ejecutivo. **Alcance — solo el builder MENSUAL en esta
fase** (el de mayor tráfico real), mismo criterio de incremento mínimo
que las Sub-fases 1/2/3 y los 3 endpoints HTTP. **Implementación:**
nuevo `src/lib/executiveReporting/djangoReportKpisBridge.ts` (mismo
patrón que `djangoAnalyticsBridge.ts`, Fase 57) — `deepCamelCase`
(mecanismo ya establecido) + `remapDjangoIdentity` (reescribe cada
`id`/`userId` numérico de Django al cuid de Postgres correspondiente,
usando el mapa inverso de `resolveDjangoIdsForRoster`). Ese resolver
se llama UNA sola vez ahora (antes se duplicaba entre este cutover y
la rama del Índice Ejecutivo). Eliminadas del builder MENSUAL: 4
consultas Prisma de Tareas/Actividades, `computeEffectiveMemberBases`/
`asOfFechaCorte`, el `.map()` de ~60 líneas por colaborador, y las
llamadas a `computeRiskQuadrant`/`computeTeamMonthlySnapshots`/
`computeTrendComparisons`/`computeFindings`/`computeRecommendations`/
`explainCumplimientoIndicator`/`explainCargaIndicator`/
`explainConsultasIndicator`/`explainMotivoDistribution`/
`getActivityReasonLabelMap` (siguen usándose en RANGO_PERSONALIZADO/
RANGO_MESES, sin cutover todavía — no se eliminan de
`reportInsights.ts`/`activityReasons.ts`). `insights`/
`estadoOperativo`/`principalHallazgo` NO vienen del bundle de Django,
siguen en TS — dependen de `healthByMember`/
`variableConsistencyMembers`/`equilibrioScore` del Índice Ejecutivo,
frontera ya establecida desde la Fase 68. **Tests actualizados:**
`buildSnapshotData.test.ts` — se eliminó el describe `"fecha de
corte"` (3 tests que probaban `asOfFechaCorte`/prorrateo, lógica que
ya no vive en esta función — esa cobertura ya existe, exhaustiva, del
lado Django, verificada con datos sintéticos reales en las Fases
70/71); se agregaron 3 tests nuevos (resolución de ids una sola vez,
datos del bundle fluyendo tal cual al snapshot, fallo explícito si
Django no responde). Tests de metadatos/inmutabilidad/Motor de Cierre
Inteligente (que SÍ siguen en TS) intactos, con mocks nuevos para no
crashear contra la llamada real a `cookies()` de Next.js.
`reports-executive.test.ts` también actualizado (mock de
`djangoApiFetch` extendido para las 2 rutas nuevas). **Verificación:**
`npx tsc --noEmit` limpio (1 error real encontrado y corregido en el
propio desarrollo — un predicado de tipo demasiado estricto en
`remapDjangoIdentity`). `npx eslint` limpio en los 4 archivos tocados
(164 errores/1865 warnings preexistentes en componentes React ajenos a
este cambio, mismo patrón ya documentado en la Fase 63). Suite completa
de Vitest — **1231/1231 en verde** (97 archivos), incluida una segunda
corrida completa tras el fix del mock de `reports-executive.test.ts`.
Sin cambios de backend. **Impacto:** primer cutover real de un builder
completo del motor de cálculo — `buildMonthlySnapshotData` ya no
depende de Prisma para `ReportMemberKpi`/agregados de equipo, solo para
roster/Índice Ejecutivo/Predictivo/NOVA/metadatos (sin cambios). Cierra
la mayor parte de la parte (2) de las "3 partes que faltan". Quedan:
RANGO_PERSONALIZADO y RANGO_MESES sin cutover (trabajo mecánico, mismo
patrón, endpoints ya construidos y verificados) y la parte (3), la
divergencia de `workday_end_hour` (Fase 63). Ver `docs/AUDIT_LOG.md` §
2026-08-26 (Fase 72))
**Autor:** Claude Code

---

**Actualización anterior:** 2026-08-26 (v1.129.2 — Migración de stack hacia
skelleton_base, Fase 71: fix de la Causa raíz B de la Fase 70 —
réplica fiel del desplazamiento de hora LOCAL del negocio en los
límites de mes de RANGO_MESES. Con la Causa raíz A (redondeo) cerrada
en la Fase 70, el usuario confirmó querer replicar fielmente la Causa
raíz B (no "arreglar" el TS ni posponer la decisión), condicionado a
confirmar primero que producción corre en una zona horaria con offset
— confirmado: `America/Guayaquil` (UTC-5). **Corrección de la
hipótesis inicial antes de tocar código:** al intentar implementar, la
primera hipótesis (día de la semana en hora local) no explicaba los
números observados — se leyó el código TS directamente:
`isBusinessDay` usa `calDay.getUTCDay()`, el día de la semana SIEMPRE
se calcula en UTC. La causa real es más específica: `monthBounds()`
(`buildSnapshotData.ts`) construye sus límites con `new Date(year,
month, day, ...)`, que interpreta esos componentes en la hora LOCAL
DEL PROCESO de Next.js — confirmado con una llamada real al builder:
`periodStart: "2025-09-01T05:00:00.000Z"`, `periodEnd:
"2025-11-01T04:59:59.999Z"` para septiembre-octubre. **Segunda
verificación sintética, dirigida específicamente al alcance real
(pedida por el usuario antes de decidir el fix):** con una tarea justo
antes del inicio del rango en calendario UTC y otra justo después del
fin, TS excluyó la primera e incluyó la segunda (bucketeada como el
mes anterior); el port Python (antes del fix) hacía lo contrario — los
totales coincidían por pura coincidencia, pero el desglose mes a mes
(`monthlyEvolution`) estaba mal. Confirma que el alcance real excede
el síntoma original (`cargaBaseHours`). **Decisión confirmada por el
usuario tras ver el alcance real:** replicar fielmente el
desplazamiento en TODO RANGO_MESES, acotado exclusivamente a
`compute_range_member_kpis`/`assemble_range_team_report` — el único
builder que en TS pasa `monthBounds()` directamente a consultas de
tareas/actividades y al prorrateo de base horaria; MENSUAL/
RANGO_PERSONALIZADO no se tocan (derivan sus límites de otras fuentes
ya en UTC explícito, verificados sin esta divergencia en la Fase 70).
**Implementación:** nuevo `_local_month_bounds(year, month)`
(`member_kpis.py`) — réplica de `monthBounds()`, desplazada por
`BUSINESS_TZ_OFFSET_HOURS` (constante ya existente en
`apps.tasks.business_time`, Fase 3b, mismo criterio que
`business_day_real_range`) — reemplaza a `_month_bounds` en
`range_start`/`range_end`, el bucketing por mes de `monthSnapshots`,
y el recálculo independiente de `effective_bases` que hace
`assemble_range_team_report`. Nuevo
`_ts_local_period_end_date(clamped_start_dt, period_end_instant)` —
réplica EXACTA (división entera de `timedelta`, no aproximada) del
límite final del loop de pasos de 24h de `sumWeightedBaseHours`/
`sumWeightedLimit` (TS) por colaborador — depende de la hora del día
exacta del `clamped_start` de cada uno (dato real), no es un ajuste
uniforme. `compute_effective_member_bases` gana 2 parámetros
opcionales (`period_start_instant`/`period_end_instant`, default
`None`) — con `None` (MENSUAL/RANGO_PERSONALIZADO), comportamiento
idéntico al existente desde la Fase 64. **Bug encontrado y corregido
durante la propia implementación, antes de shippear:** el chequeo de
"rango vacío" debe comparar los INSTANTES originales, nunca la fecha
ya ajustada por `_ts_local_period_end_date` (de otro modo esa rama
nunca se dispara para un colaborador cuyo `clamped_start` cae después
de `period_end`). 7 tests nuevos (162 en total en `apps/reports/`), 2
reproduciendo EXACTAMENTE los 2 escenarios reales verificados contra
TS con la infraestructura de la Fase 70 — no casos inventados. `ruff
check apps/reports/` limpio, `pytest apps/reports/` 162/162, `pytest
apps/` (suite COMPLETA del backend) 1806/1806 en verde (1799 previos +
7). Sin cambios de TypeScript. **Impacto:** cierra la Causa raíz B de
la Fase 70 — con esto, los 3 builders del motor de cálculo de
Reportes Ejecutivos quedan verificados campo por campo contra
`buildSnapshotData.ts`, incluidos los casos de borde de mes. Cierra la
parte (2) de las "3 partes que faltan" a nivel de motor de cálculo —
queda el cutover real del `route.ts`/`buildSnapshotData.ts` (sin
ningún hallazgo de datos pendiente que lo bloquee) y la parte (3), la
divergencia de `workday_end_hour` (Fase 63). Ver `docs/AUDIT_LOG.md` §
2026-08-26 (Fase 71))
**Autor:** Claude Code

---

**Actualización anterior:** 2026-08-26 (v1.129.1 — Migración de stack hacia
skelleton_base, Fase 70: verificación con datos sintéticos de los 3
endpoints de Reportes Ejecutivos (Fases 68/69) contra
`buildSnapshotData.ts` real, más fix de un bug de redondeo activo en
producción. Con las Fases 68/69 cerradas (los 3 builders con su
endpoint HTTP construido y probado en aislamiento), tocaba el paso de
mayor riesgo: el cutover real de `buildSnapshotData.ts`. Antes de
tocar producción, se preguntó al usuario cómo proceder — eligió
verificación con datos reales primero. **Investigación del entorno:**
sin `.env` en la raíz (Postgres/Prisma sin configurar), sin contenedor
de Postgres corriendo, BD SQL Server de Django completamente vacía (0
usuarios/tareas/actividades) — no hay datos reales disponibles en este
entorno. Se preguntó de nuevo — el usuario eligió verificación con
datos SINTÉTICOS equivalentes en ambos lados. **Metodología:**
contenedor Postgres descartable (Docker) + `.env` temporal + `npx
prisma migrate deploy`; script de seed sembrando el MISMO escenario
sintético (2 colaboradores, 5 tareas, 2 actividades) en Postgres y en
la BD de Django (comando de management temporal); ruta HTTP temporal
en Next.js (`server-only` impide invocar `buildSnapshotData.ts` fuera
del runtime de Next — se corrió `next dev` real en vez de hackear
`node_modules`) llamando a los 3 builders directamente; script de
comparación campo por campo. **Hallazgo lateral corregido en el
camino:** la BD SQL Server de desarrollo tenía 10 migraciones de
Django pendientes sin aplicar — aplicadas, fix legítimo no
destructivo. **Resultado — 283 verificaciones, 261 exactas, 22
discrepancias por 2 causas raíz:** **(A) bug de redondeo, corregido en
esta misma fase:** `round()` de Python usa banker's rounding
(`round(66.5) == 66`), `Math.round()` de JS siempre redondea .5 hacia
+Infinity (`Math.round(66.5) === 67`) — caso real que expuso el bug:
`(33+100)/2 = 66.5` → TS 67, Django 66. **Confirmado con `grep` que NO
es exclusivo de las Fases 64-69:** 157 usos de `round(` en
`apps/analytics/*.py`, varios ya en producción desde el cutover de
Analytics/KPIs (Fase 47) — este bug probablemente ya afectaba números
reales en producción antes de esta fase. Nuevo
`backend/apps/core/rounding.py::round_half_up(value, ndigits=0)` —
réplica exacta de `Math.round()` vía `math.floor(value * factor +
0.5) / factor` (aritmética IEEE 754 idéntica bit a bit entre Python y
JS) — reemplazado mecánicamente en 217 call sites de 32 archivos
(`apps/analytics/*` 23 archivos, `apps/configuration/*`,
`apps/dashboard`, `apps/projects`, `apps/recovery`, `apps/reports/*`,
`apps/tasks/services.py`+`task_import.py`); excluido deliberadamente
`apps/core/middleware.py` (mide latencia de request, sin espejo en
TS). 6 tests nuevos para `round_half_up`. **(B) quirk de fecha límite
en rangos multi-mes, NO corregido, decisión pendiente del usuario:**
`sumWeightedBaseHours`/`countBusinessDays` (TS, `workload.ts`,
preexistente) avanzan en incrementos de 24h exactas desde un instante
que puede no estar alineado a medianoche UTC; combinado con que
`monthBounds().end` se construye en hora LOCAL (este entorno corre en
`America/Guayaquil`, UTC-5), el fin de noviembre en hora local cae más
de 4 horas DESPUÉS de la medianoche UTC del 1 de diciembre — el loop
puede terminar contando el 1 de diciembre (día hábil) de más, 6.5
horas extra (1 día a la tasa default) en
`cargaBaseHours`/`cargaPct`/`cargaRangeMin`/`cargaRangeMax`, tanto por
colaborador como a nivel de equipo. El port Python (`date` puro, sin
componente horario) no reproduce este quirk. No se decide
unilateralmente cuál comportamiento es el "correcto" — el TS es la
producción real actual, el Python es más limpio pero constituye un
CAMBIO de comportamiento si se usa tal cual; se documenta como
hallazgo pendiente. Solo afecta RANGO_MESES — MENSUAL y
RANGO_PERSONALIZADO coincidieron exactamente. **Limpieza:** toda la
infraestructura temporal se eliminó (contenedor Postgres, `.env`
temporal, ruta de Next.js, línea temporal en `proxy.ts`, comando de
management, datos de prueba en ambas BDs, scripts) — el repo quedó
igual que antes de la verificación, salvo las 10 migraciones aplicadas
y el fix de redondeo (ambos intencionales, documentados). `ruff check`
limpio en los 32 archivos tocados por el fix, `pytest
apps/core/tests/test_rounding.py` 6/6, `pytest apps/` (suite COMPLETA
del backend) 1799/1799 en verde. Sin cambios de TypeScript. **Impacto:**
corrige un bug de redondeo con impacto potencial en producción, activo
probablemente desde la Fase 4b/47 — exactamente el tipo de hallazgo
que la verificación estaba diseñada para detectar antes de arriesgar
un cutover. Quedan pendientes: el cutover real de
`buildSnapshotData.ts` (bloqueado para RANGO_MESES por la causa B) y
la divergencia de `workday_end_hour` (Fase 63). Ver `docs/AUDIT_LOG.md`
§ 2026-08-26 (Fase 70))
**Autor:** Claude Code

---

**Actualización anterior:** 2026-08-26 (v1.129.0 — Migración de stack hacia
skelleton_base, Fase 69: 2 endpoints HTTP más del motor de CÁLCULO de
Reportes Ejecutivos (`POST /reports/executive/custom-range-team-kpis/`
y `.../range-team-kpis/`, builders RANGO PERSONALIZADO/RANGO DE MESES),
sin cutover de `buildSnapshotData.ts` todavía. Con la Fase 68 cerrada
(endpoint MENSUAL), el usuario confirmó continuar ("si, continua") con
los 2 builders restantes. **Investigación:** se releyeron las secciones
de `buildSnapshotData.ts` ya leídas en la Fase 68 para confirmar qué de
sus rollups de equipo ya cubre `insights.py` y qué es genuinamente
nuevo. Confirmó que `buildCustomRangeSnapshotData` es estructuralmente
casi idéntico al builder MENSUAL ya resuelto en la Fase 68 (mismo
`ranking`/`alerts`, verificado línea por línea) — la diferencia real es
la fecha de corte (sin `MonthClosure`) y que la tendencia de consultas
compara contra un período anterior de igual DURACIÓN
(`previousEquivalentPeriod`, Fase 67), no el mes calendario anterior.
`buildRangeSnapshotData`, en cambio, tiene lógica de `ranking`/`alerts`
genuinamente distinta: el ranking prioriza `completedPct` sobre `score`
(orden INVERTIDO respecto al builder mensual) y las alertas se activan
cuando el problema se repite en al menos la mitad de los meses ACTIVOS
del colaborador dentro del rango (`monthsAffected`), no por un umbral
de un solo período — ninguna de las 2 tenía primitiva portada todavía.
**Decisión — mismo perfil de riesgo mínimo que la Fase 68:** ambos
endpoints se acotan a lo que `member_kpis.py`/`insights.py` ya cubren
más las piezas genuinamente nuevas (`compute_range_ranking`/
`compute_range_alerts`), reutilizando `compute_monthly_ranking`/
`compute_team_alerts` de la Fase 68 donde el TS efectivamente comparte
la misma lógica (RANGO PERSONALIZADO) — sin duplicarlas. Las mismas 4
piezas fuera de alcance de la Fase 68 (Índice Ejecutivo/Predictivo/
NOVA/metadatos de reporte) siguen fuera acá. **Nuevas funciones en
`team_report.py`:** `assemble_custom_range_team_report`,
`assemble_range_team_report`, `compute_range_ranking`,
`compute_range_alerts`. Nuevas vistas `CustomRangeTeamReportView`
(`POST /reports/executive/custom-range-team-kpis/`) y
`RangeTeamReportView` (`POST /reports/executive/range-team-kpis/`),
ambas gateadas por `CanAccessReports`. 14 tests nuevos (35 en total en
`test_team_report.py`), todos en verde en el primer intento. `ruff
check apps/reports/` limpio, `pytest
apps/reports/tests/test_team_report.py` 35/35, `pytest apps/reports
apps/analytics apps/users apps/team apps/tasks` 1010/1010 en verde (996
previos + 14, corrida conjunta para descartar contaminación cruzada).
Sin cambios de TypeScript — no requirió `npx tsc --noEmit`/`npm run
lint`/Vitest. **Impacto:** ningún riesgo para producción — ambos
endpoints existen y están probados en aislamiento,
`buildSnapshotData.ts` sigue calculando localmente contra Prisma sin
ningún cambio. Con esto, los 3 builders del motor de cálculo (MENSUAL,
RANGO PERSONALIZADO, RANGO DE MESES) tienen su endpoint HTTP
equivalente construido y probado en Django. Queda un único paso para
cerrar la parte (2) de las "3 partes que faltan": el cutover real del
`route.ts`/`buildSnapshotData.ts`, el de mayor riesgo de toda esta
sub-iniciativa — requiere verificación campo por campo contra datos
reales, y solo después tiene sentido abordar la parte (3) (divergencia
de `workday_end_hour`, Fase 63). Ver `docs/AUDIT_LOG.md` § 2026-08-26
(Fase 69))
**Autor:** Claude Code

---

**Actualización anterior:** 2026-08-26 (v1.128.0 — Migración de stack hacia
skelleton_base, Fase 68: primer endpoint HTTP del motor de CÁLCULO de
Reportes Ejecutivos (`POST /reports/executive/monthly-team-kpis/`,
builder MENSUAL), sin cutover de `buildSnapshotData.ts` todavía. Con la
Fase 67 cerrada (port completo de `reportInsights.ts`), el usuario
confirmó continuar con la parte (2) de las "3 partes que faltan del
motor de cálculo de reportes ejecutivo": el cutover HTTP real de
`buildSnapshotData.ts`. Ese cutover no podía ejecutarse directamente —
no existía ningún endpoint Django que expusiera
`member_kpis.py`/`insights.py` por HTTP (deliberado desde la Fase 64:
"primitivas primero, HTTP después"). **Investigación:** se leyó
`buildSnapshotData.ts` completo (1204 líneas) para mapear con
precisión qué necesita cada uno de los 3 builders más allá de lo que
`member_kpis.py`/`insights.py` ya cubren. Confirmó que el bloque
`ReportMemberKpi` y los rollups de equipo ya están cubiertos casi en
su totalidad, pero identificó 3 piezas del builder MENSUAL sin ninguna
primitiva portada: alertas de equipo, ranking, y
`consultasByReason` (agrupación cruda de `TaskActivity` por motivo con
%/tendencia — distinto de `explainMotivoDistribution`, que solo
interpreta un ítem YA agrupado). También confirmó 4 piezas
estructuralmente inalcanzables sin traer otro motor entero: Índice
Ejecutivo (Fase 57, llamada aparte por colaborador), Analytics
Predictivo (`predictionEngine.ts`, motor independiente), narrativa NOVA
y `estadoOperativo`/`principalHallazgo` por miembro (dependen del
`equilibrioScore` del Índice Ejecutivo). **Decisión — el bundle del
endpoint se acota a lo que `member_kpis.py`/`insights.py`/
`compute_data_quality` (ya portada) pueden calcular de forma
autocontenida, documentado en el docstring del módulo nuevo:** las 4
piezas inalcanzables siguen resolviéndose en Next.js exactamente como
hoy, sin eliminar ninguna función TS. **Nuevo
`backend/apps/reports/team_report.py`** — capa de ENSAMBLADO
(`member_kpis` calcula, `insights` interpreta, `team_report` ensambla)
con `assemble_monthly_team_report`, más `compute_team_alerts`/
`compute_monthly_ranking`/`compute_consultas_by_reason`. **Decisión —
identidad de roster (`id`/`name`/`role`) SÍ se incluye acá, a
diferencia de `member_kpis.py`:** `compute_findings`/
`compute_recommendations`/`compute_team_insights` necesitan el nombre
del colaborador en el texto de sus reglas; se resuelve directamente
desde el propio `User` de Django (`first_name or username`/primer
`Group.name`), sin depender del roster de Prisma. **Decisión — `POST`
en vez de `GET` con query params:** un roster de 50+ colaboradores
supera el límite práctico de un query string — mismo criterio que
`POST /analytics/simulate/<id>/`. Nueva vista `MonthlyTeamReportView`
(`POST /reports/executive/monthly-team-kpis/`, gateada por
`CanAccessReports`), nuevo `MonthlyTeamReportRequestSerializer`. 21
tests nuevos (`backend/apps/reports/tests/test_team_report.py`), todos
en verde en el primer intento — funciones puras + el ensamblador con
datos reales de fixture + la capa HTTP completa (401/403/400/200,
incluida `fecha_corte` explícita). `ruff check apps/reports/` limpio,
`pytest apps/reports/tests/test_team_report.py` 21/21, `pytest
apps/reports apps/analytics apps/users apps/team apps/tasks` 996/996
en verde (975 previos + 21, corrida conjunta para descartar
contaminación cruzada). Sin cambios de TypeScript — no requirió `npx
tsc --noEmit`/`npm run lint`/Vitest (ningún archivo `.ts` tocado; nada
en Next.js llama a este endpoint todavía). **Impacto:** ningún riesgo
para producción — el endpoint existe y está probado en aislamiento,
pero `buildSnapshotData.ts` sigue calculando localmente contra Prisma
sin ningún cambio. Queda mapeado con precisión lo que falta para el
cutover real: los mismos endpoints para RANGO_MESES/
RANGO_PERSONALIZADO (sin construir todavía), el cutover del
`route.ts`/`buildSnapshotData.ts` propiamente dicho (requiere
verificación campo por campo contra datos reales — el paso de mayor
riesgo de toda esta sub-iniciativa) y la divergencia de
`workday_end_hour` (Fase 63). Ver `docs/AUDIT_LOG.md` § 2026-08-26
(Fase 68))
**Autor:** Claude Code

---

**Actualización anterior:** 2026-08-26 (v1.127.0 — Migración de stack hacia
skelleton_base, Fase 67: port completo de `src/lib/reportInsights.ts`
(538 líneas) — los agregados de EQUIPO de Reportes Ejecutivos, sin
cutover HTTP. El usuario pidió explícitamente continuar con "las 3
partes que faltan del motor de cálculo de reportes ejecutivo": (1)
`reportInsights.ts`, (2) el cutover HTTP real de `buildSnapshotData.ts`
y (3) la divergencia de `workday_end_hour` (hallazgo de la Fase 63).
Esta fase resuelve la parte (1). **Investigación delegada a un fork
con instrucción explícita de "SOLO investigar, NO tocar ningún
archivo"** (a diferencia de la ambigüedad de la Fase 64), luego
verificada leyendo `reportInsights.ts` completo línea por línea, más
`activityReasons.ts`/`executiveReporting/periodStatus.ts` completos, y
confirmando con `grep` directo que `ActivityReason`/
`ExecutiveReportSnapshot.PeriodStatus` (Django) ya existían con los
mismos campos que sus equivalentes TS. **Nuevo
`backend/apps/reports/insights.py`, 16 funciones en 4 lotes por
dependencia:** Lote 1 puras standalone (`compute_risk_quadrant`,
`previous_equivalent_period`, `explain_motivo_distribution`,
`explain_cumplimiento_indicator`, `explain_carga_indicator`,
`explain_consultas_indicator`); Lote 2 I/O sobre modelos ya existentes
sin cambios (`get_activity_reason_label_map` vía `ActivityReason`,
`resolve_monthly_period_status`/`resolve_range_period_status`/
`resolve_custom_range_period_status` vía `MonthClosure`); Lote 3
reglas de negocio puras sin IA (`compute_findings`/
`compute_recommendations`/`compute_team_insights`); Lote 4 el único
con I/O pesado — `compute_team_monthly_snapshots` (4 queries en una
sola tanda, réplica de la estrategia de batching del TS) +
`compute_trend_comparisons`. `deriveEstadoOperativo`/
`computeEffectiveMemberBases`/`computePrincipalHallazgo` NO se
duplican — ya portadas en `member_kpis.py` desde las Fases 64/65,
documentado en el docstring del módulo nuevo. **Hallazgo documentado,
no corregido:** `computeEffectiveMemberBases` (TS) usa `periodEnd`
como reserva de `computeEffectiveHistoryStart` cuando un colaborador
no tiene ningún historial; el port ya existente (Fase 64) usa `now` en
ese mismo lugar — divergencia menor, en la práctica inalcanzable
porque `User.created_at` (`auto_now_add`) siempre está poblado en
Django; no se reabren 3 sub-fases ya verificadas por un caso sin
impacto real. **Hallazgo — asimetría real del TS preservada, no un bug
de este port:** dentro de `compute_team_monthly_snapshots`,
`avg_cumplimiento` promedia solo los miembros "activos" del mes
(`total_tasks > 0`), pero `avg_carga_pct` promedia TODO el roster —
verificado línea por línea contra el TS (líneas 132-134), preservado y
documentado con un test dedicado para que no se "corrija" por
accidente. **Hallazgo menor:** el diseño inicial de
`compute_team_monthly_snapshots` calculaba `completed_pct` inline; se
reemplazó por `compute_completed_pct_any` (ya portada, usada por
`member_kpis.py`) antes de correr los tests, encontrado durante la
verificación cruzada contra el TS. 47 tests nuevos
(`backend/apps/reports/tests/test_insights.py`), los 47 en verde en el
primer intento. `ruff check apps/reports/` limpio, `pytest
apps/reports/tests/test_insights.py` 47/47, `pytest apps/reports
apps/analytics apps/users apps/team apps/tasks` 975/975 en verde (928
previos + 47, corrida conjunta para descartar contaminación cruzada).
Sin cambios de TypeScript — no requirió `npx tsc --noEmit`/`npm run
lint`/Vitest. **Impacto:** junto con `member_kpis.py` (Fases 64-66), el
motor de CÁLCULO completo de Reportes Ejecutivos (`ReportMemberKpi` +
agregados de equipo) ya existe en Django — sin ningún wiring HTTP
todavía y sin ningún riesgo para producción. Quedan las partes (2) y
(3) pedidas por el usuario. Ver `docs/AUDIT_LOG.md` § 2026-08-26 (Fase
67))
**Autor:** Claude Code

---

**Actualización anterior:** 2026-08-26 (v1.126.0 — Migración de stack hacia
skelleton_base, Fase 66: Sub-fase 3 del motor de CÁLCULO de Reportes
Ejecutivos (`ReportMemberKpi`/`MonthSnapshot`, builder de rango de
meses — solo lo que NO depende de `reportInsights.ts`). Continuando
"siguiente fase" tras la Fase 65, quedaba el tercer y último builder:
`buildRangeSnapshotData` (RANGO_MESES). **Investigación:** resultó ser
considerablemente más grande que los 2 ya portados — no solo arma un
`ReportMemberKpi` agregado por colaborador, sino un desglose mes a mes
(`MonthSnapshot[]`) del que la agregación depende (el score/cumplimiento
final de cada colaborador es el PROMEDIO de sus valores en los meses
"activos" del rango, no un cálculo directo). Más allá de eso, la
función completa también arma cuadrante de riesgo
(`computeRiskQuadrant`), hallazgos/recomendaciones/insights
(`computeFindings`/`computeRecommendations`/`computeTeamInsights`),
tendencia de consultas por motivo, alertas de equipo y el estado del
período — todo dependiente de `src/lib/reportInsights.ts` (538
líneas), que sigue sin portar. **Decisión — acotar el alcance a lo que
NO depende de `reportInsights.ts`, mismo criterio que las Sub-fases
1/2:** se portó solo el bloque que produce `monthSnapshots`/
`aggregatedMembers`, dejando el resto (rollups de equipo) para una
sub-fase futura junto con el resto de `reportInsights.ts` — mantiene
el mismo perfil de riesgo mínimo en vez de portar de una sola vez una
porción bastante más grande y heterogénea. **Hallazgo — tercera
primitiva consecutiva ya portada sin conectar:**
`monthlyBusinessBaseForUsers` (variante multi-usuario de la base
horaria, que respeta estados especiales por colaborador) ya tenía su
equivalente Django, `monthly_business_base_for_users`
(`apps/analytics/workload.py`), portado y en uso real por
`/kpis/me/range` desde la Fase 4c — meses antes de esta sesión, sin
que nadie lo hubiera conectado a Reportes Ejecutivos (mismo patrón que
la Fase 64: 8 de 10 primitivas ya existían; Fase 65:
`business_base_for_range` ya existía). **Decisión — simplificación
deliberada y documentada del contrato de salida:** el TS arma
`memberSnapshots` como un array con `id`/`name`/`role` incluidos, y
los "aligera" (quita `overdueCount`/`cargaRealHours`/`cargaBaseHours`)
antes de devolverlos en la respuesta HTTP. El port Python devuelve
`month_snapshots[i]["member_snapshots"]` como un dict `{user_id:
{...}}` sin identidad (mismo criterio que las Sub-fases 1/2) y SIN el
"strip" de campos — no hay ningún payload HTTP todavía que aligerar.
**Nuevas funciones:** `compute_range_member_kpis` (assembler
principal, en `backend/apps/reports/member_kpis.py`), más
`_months_in_range` (réplica de `getMonthsInRange`) y `_month_label`
(formato "{mes} de {año}", duplicado deliberado de una función privada
equivalente que ya existe en `apps.analytics.services`, mismo criterio
que `_month_bounds`). `ruff check apps/reports/` limpio, `pytest
apps/reports/tests/test_member_kpis.py` 36/36 en verde (30 previos + 6
nuevas — las 6 pasaron en verde en el primer intento, a diferencia de
las Sub-fases 1/2 que encontraron bugs de test reales, atribuible a
que estos tests ya estaban informados por esos 2 patrones de bug
previos), `pytest apps/reports apps/analytics apps/users apps/team
apps/tasks` 928/928 en verde (922 previos + 6). Sin cambios de
TypeScript — no requirió `npx tsc`/`npm run lint`/Vitest. Cierra el
port de `ReportMemberKpi` para los 3 builders de Reportes Ejecutivos
(mensual, rango personalizado, rango de meses) — sin ningún riesgo
para producción. Lo que queda del motor de cálculo completo: los
rollups de equipo (`reportInsights.ts`, todavía sin tocar) y el
cutover HTTP real de `buildSnapshotData.ts`. Ver `docs/AUDIT_LOG.md` §
2026-08-26 (Fase 66))
**Autor:** Claude Code

---

**Actualización anterior:** 2026-08-26 (v1.125.0 — Migración de stack hacia
skelleton_base, Fase 65: Sub-fase 2 del motor de CÁLCULO de Reportes
Ejecutivos (`ReportMemberKpi`, builder de rango personalizado, sin
cutover de TS). Continuando "siguiente fase" tras la Fase 64, había que
elegir entre los 2 builders restantes de `buildSnapshotData.ts`:
`buildRangeSnapshotData` (RANGO_MESES, arma un `MonthSnapshot[]` con
agregación mes a mes — promedios de `completedPct`/`score` entre
meses "activos") o `buildCustomRangeSnapshotData` (RANGO_PERSONALIZADO).
Se investigó y se eligió el segundo por ser estructuralmente casi
idéntico al builder mensual ya portado — mismo bloque plano de
`ReportMemberKpi` por colaborador, sin desglose por sub-período; la
única diferencia real es la resolución de fecha de corte (sin
`MonthClosure`, mecanismo exclusivo de meses calendario — acá es
`fechaCorte` explícita o `periodEnd`, lo que sea anterior a `now`).
**Hallazgo — otra primitiva de bajo nivel ya portada sin conectar:**
`businessBaseForRange` (TS) es literal `return businessBaseCore(start, end)`,
1 línea — su equivalente Django, `business_base_for_range`
(`apps/configuration/services.py`), ya existía, reutilizada
internamente por `monthly_business_base` desde antes de esta sesión.
**Se portaron también `deriveEstadoOperativo`/`computePrincipalHallazgo`
(`src/lib/reportInsights.ts`) en esta misma sub-fase** — el builder de
rango personalizado sí los necesita (a diferencia del mensual);
evaluados y resultaron triviales (`deriveEstadoOperativo` reutiliza
`classifyEstadoOperativo`, ya portado desde la Fase 4e/4g;
`computePrincipalHallazgo` es una cascada fija de comparaciones sin
estado), verificados línea por línea contra el TS incluida la tabla
`CARGA_LABEL_SCORE`. Nueva función `compute_custom_range_member_kpis`
en `backend/apps/reports/member_kpis.py`, reutilizando
`as_of_fecha_corte`/`compute_effective_member_bases` de la Sub-fase 1
sin duplicarlas. **Nota operativa:** la implementación se delegó a un
fork con autorización explícita para escribir código — completó el
módulo y sus 14 tests, pero se cortó por un límite de sesión de la API
justo antes de la verificación final y la documentación. Se verificó
manualmente que el código tenía sintaxis válida y estaba completo (sin
ninguna escritura a mitad de camino), se corrió la verificación
completa de cero (sin confiar en ningún resultado no verificado del
fork), y se completó la documentación que había quedado pendiente.
`ruff check apps/reports/` limpio, `pytest
apps/reports/tests/test_member_kpis.py` 30/30 en verde (16 + 14),
`pytest apps/reports apps/analytics apps/users apps/team apps/tasks`
922/922 en verde (908 + 14). Sin cambios de TypeScript — no requirió
`npx tsc`/`npm run lint`/Vitest. Confirma que la estimación original de
~13 sub-fases sigue sobrestimando el trabajo pendiente — 2 de 3
builders de `ReportMemberKpi` ya están portados. Queda pendiente el
builder RANGO_MESES (agregación mes a mes, más complejo), los
agregados de EQUIPO (`reportInsights.ts`, cuadrante de riesgo/
tendencias) y la exposición HTTP (cutover real de
`buildSnapshotData.ts`). Ver `docs/AUDIT_LOG.md` § 2026-08-26 (Fase
65))
**Autor:** Claude Code

---

**Actualización anterior:** 2026-08-25 (v1.124.0 — Migración de stack hacia
skelleton_base, Fase 64: Sub-fase 1 del motor de CÁLCULO de Reportes
Ejecutivos (`ReportMemberKpi`, solo builder mensual, sin cutover de
TS). Con el backlog de Centro de Configuración cerrado (Fases 59-63),
quedaba un único trabajo grande: el motor de cálculo completo de
Reportes Ejecutivos, estimado en ~13 sub-fases (mismo tamaño que el
port original de KPIs/Analytics). Dado el tamaño, se preguntó
explícitamente al usuario cómo continuar antes de invertir tiempo —
confirmó "Arrancar sub-fase 1 ahora (recomendado)". **Investigación
delegada a un fork, luego verificada línea por línea antes de escribir
código** (un dato incorrecto acá tiene impacto de auditoría/compliance,
no solo de UI): la premisa de que "hay que portar todo desde cero" era
incorrecta — Django YA tiene la gran mayoría de las primitivas
necesarias, portadas mucho antes de esta sesión (Fase 4b/4d,
2026-08-11): `compute_simple_score`/`compute_completed_pct_any`/
`compute_estimated_vs_real_ratio` (`apps/analytics/scoring.py`,
verificadas réplicas exactas de las mismas fórmulas "compartidas" que
usa Dashboard/`/kpis/*`, no propias del reporte como parecía sugerir
el nombre `computeSimpleScore`), `compute_workload_range`/
`compute_workload_pct`/`sum_weighted_base_hours`/`sum_weighted_limit`
(`apps/analytics/workload.py`), `compute_effective_history_start`
(`apps/analytics/history.py`, réplica exacta de los mismos 5
candidatos: primera actividad, primera tarea completada, primera
imputación de horas, `kpi_start_date`, `created_at`, MAX de todos),
`is_task_overdue` (`apps/analytics/utils.py`, ya usada en 10+
lugares), `business_day_real_range` (`apps/tasks/business_time.py`) —
ninguna conectada todavía a un caso de uso de Reportes Ejecutivos. Lo
genuinamente NUEVO se redujo a 3 funciones en el nuevo
`backend/apps/reports/member_kpis.py`: `as_of_fecha_corte` (2 líneas
puras, réplica de `asOfFechaCorte` — mucho más simple de lo que
sugería su nombre), `compute_effective_member_bases` (wiring de
primitivas ya existentes, réplica de `computeEffectiveMemberBases`) y
`compute_monthly_member_kpis` (assembler, réplica del bloque
`ReportMemberKpi` de `buildMonthlySnapshotData`, solo builder
MENSUAL). **Decisión — deliberadamente SIN wiring a ningún endpoint
HTTP todavía:** mismo criterio que usó el port original de
KPIs/Analytics (primitivas primero, HTTP después, cutover del
`route.ts` real mucho más tarde — recién en la Fase 47) — construir y
probar el cálculo en aislamiento, sin tocar ningún camino de
producción, es la forma más segura de avanzar en un motor con impacto
de auditoría. Los builders de RANGO/RANGO-CUSTOM y los agregados de
EQUIPO (`reportInsights.ts`) quedan para sub-fases futuras. 16 tests
nuevos — **3 bugs de TEST genuinos encontrados y corregidos al
correrlos por primera vez, ninguno en el código de producción:**
`compute_completed_pct_any`/`is_task_overdue` (funciones YA portadas,
reutilizadas tal cual) esperan objetos con atributos (`t.status`), no
dicts (`t["status"]`) — el diseño inicial usaba `.values()` por
costumbre del patrón "select" de Prisma, corregido a `.only()`
(instancias de modelo) para respetar el contrato real; `User.created_at`/
`TaskActivity.created_at` son `auto_now_add`, así que los tests contra
un período fijo en el pasado (2026-03) necesitan backdatearlos
explícitamente vía `.update()` o el "ahora" real de ejecución los deja
fuera de rango silenciosamente; el instante real de fin de "día de
negocio" cruza la medianoche UTC por el huso desplazado
(`BUSINESS_TZ_OFFSET_HOURS=5`) — una aserción de test que no
contemplaba este corrimiento estaba mal, no la implementación. `ruff
check apps/reports/` limpio, `pytest apps/reports apps/analytics
apps/users apps/team apps/tasks` 908/908 en verde — corrida conjunta
para descartar contaminación cruzada con los módulos de los que
`member_kpis.py` importa primitivas. Sin cambios de TypeScript — no
requirió `npx tsc --noEmit`/`npm run lint`/Vitest (ningún archivo `.ts`
tocado). Reduce sustancialmente la estimación de esfuerzo restante
frente a los ~13 sub-fases originales — gran parte de la base ya
estaba construida. Ver `docs/AUDIT_LOG.md` § 2026-08-25 (Fase 64))
**Autor:** Claude Code

---

**Actualización anterior:** 2026-08-25 (v1.123.0 — Migración de stack hacia
skelleton_base, Fase 63: corrección de hallazgo (la Fase 60 estaba
equivocada) + limpieza de código muerto confirmado. Continuando
"siguiente fase" tras la Fase 62 sin especificar cuál de las 2
alternativas presentadas, se eligió investigar la limpieza de los
"motores legacy" que las Fases 47-62 fueron etiquetando como "sin
importadores reales" (`analytics.ts`, `insightsEngine.ts`,
`predictionEngine.ts`, `trendEngine.ts`, `riskAlerts.ts`,
`workload.ts`, `capacityForecast.ts`, `recoveryCenter.ts`,
`deskNoteRetention.ts`, `rate-limit.ts`) — alternativa más chica y
contenida frente al motor de cálculo completo de Reportes Ejecutivos
(~13 sub-fases). **Investigación delegada a un fork, luego verificada
manualmente línea por línea antes de actuar** (por tratarse de
eliminación de archivos): el mapeo de dependencias reveló que la
caracterización de "código muerto" para 5 de los 10 archivos era
INCORRECTA. Las verificaciones anteriores (Fases 58/60) solo
comprobaron importadores DIRECTOS desde `src/app` con `grep` de una
sola capa — nunca siguieron la cadena transitiva completa. **Cadena
real, verificada leyendo el código fuente:** `POST
/api/reports/executive` (ruta viva desde la Fase 56) →
`buildMonthlySnapshotData` (`buildSnapshotData.ts`, línea 70 importa
de `workload.ts`, línea 100 de `predictionEngine.ts`) →
`computeSobrecargaProbability`/`computeSubutilizacionPredictions`
(`predictionEngine.ts`, líneas 186/246) llaman directamente a
`computeCapacityForecast`/`computeTeamCapacityForecast`
(`capacityForecast.ts`) y `computeTrendEngine` (`trendEngine.ts`).
**Corrección formal de la Fase 60:** esa fase decidió RETENER
`getEffectiveWorkdayEndHour`/`setWorkdayEndHour` en `systemConfig.ts`
"porque `capacityForecast.ts` (código muerto en runtime) sigue
importándolas" — la decisión de retener fue correcta, pero por el
motivo equivocado: `capacityForecast.ts` está genuinamente vivo, no
solo compilado. **Hallazgo nuevo, NO corregido en esta fase —
divergencia de datos activa, consecuencia directa del error de la
Fase 60:** `capacityForecast.ts` línea 127 llama a
`getEffectiveWorkdayEndHour()` (Postgres, sin cambios), pero
`settings/trabajo-avanzado/route.ts` ya escribe este mismo valor en
Django desde la Fase 60 — 2 almacenes desincronizados para el mismo
dato. Severidad acotada (la rama que lo usa,
`buildPredictivoForCurrentMonth`, está gateada a "reporte del mes en
curso", mismo patrón de bajo impacto práctico que el hallazgo de la
Fase 57) pero real. **Decisión — NO se corrige acá:** el consumidor
real es parte del motor de cálculo de Reportes Ejecutivos, que ya
requiere un análisis dedicado de "fecha de corte" antes de recomponer
cualquier pieza (ver Fase 57, donde `ReportMemberKpi` quedó
explícitamente sin recompose por esta misma razón) — un parche
aislado ahora podría generar su propia inconsistencia con ese trabajo
futuro dedicado. **Limpieza real ejecutada — solo 3 de 10 candidatos
genuinamente muertos** (confirmado con `grep` transitivo en todo
`src/`, no solo `src/app`, más verificación manual de cada mención,
incluidas coincidencias de nombre engañosas como `restoreItem` en
`ProjectTrashPanel.tsx`, sin relación real): `recoveryCenter.ts`
(Centro de Recuperación en TypeScript, superado por `apps.recovery`
en Django desde las Fases 39/50), `deskNoteRetention.ts` (purga de
notas archivadas, sin consumidor desde el cutover de Escritorio
Digital, Fase 50) y `rate-limit.ts` (rate-limiting de login por IP,
superado por el rate-limiting real de Django desde la Fase 6a) —
eliminados junto con sus tests dedicados (`rate-limit.test.ts`,
`deskNoteRetention.test.ts`) y 20 símbolos huérfanos
(`getEffective*`/`set*`/`CONFIG_KEY_*`/`DEFAULT_*`) en
`systemConfig.ts`. **`insightsEngine.ts`/`riskAlerts.ts` (también sin
consumidores reales) quedan FUERA de esta fase:** tienen ataduras que
requieren trabajo adicional — `riskAlerts.ts` expone el tipo
`RiskAlert`, importado como `import type` por
`components/kpis/types.ts`; `insightsEngine.ts` comparte el archivo
de test `analytics-formulas.test.ts` con `analytics.ts` (parcialmente
vivo) — separar ambos sin dejar cobertura huérfana o rota amerita su
propia fase. Sin cambios de backend — no requirió corrida de
`pytest`. `npx tsc --noEmit` limpio (confirma que ningún archivo vivo
quedó roto), `npm run lint` corrido COMPLETO (no solo archivos
tocados, dado que se eliminaron archivos) — todos los hallazgos
preexistentes en `frontend/` y componentes React ajenos a este
cambio. Suite completa de Vitest 97 archivos / 1231 tests en verde
(baja de 99/1259 por los 2 archivos de test eliminados junto con su
código, no por una regresión). Ver `docs/AUDIT_LOG.md` § 2026-08-25
(Fase 63))
**Autor:** Claude Code

---

**Actualización anterior:** 2026-08-25 (v1.122.0 — Migración de stack hacia
skelleton_base, Fase 62: cutover de la duración de sesión (`session.ts`),
último valor con consumidor real de Centro de Configuración.
Continuando "siguiente fase" tras la Fase 61, quedaba un único
candidato con consumidor real confirmado:
`session_duration_default_hours`/`session_duration_remember_hours`
(`session.ts`) — señalado en fases anteriores como el de mayor riesgo
por tratarse de la ruta crítica de login/sesión. **El riesgo real
resultó menor al estimado:** `createSession(data, rememberMe,
durationHoursOverride)` solo consulta su fallback (antes Postgres)
cuando NO recibe `durationHoursOverride`. De sus 2 únicos callers
reales, `auth/login/route.ts` YA pasaba la duración resuelta por
Django desde la Fase 6a (2026-08-14) — el login real trae
`session_policy.default_hours`/`remember_hours` en la misma respuesta
de autenticación, el fallback de `session.ts` NUNCA se ejecutaba en el
camino de login. El único caller que sí lo ejercitaba era
`auth/me/route.ts` (re-emisión de sesión al editar nombre/email en el
perfil), sin override. **Decisión — se resuelve en el caller
(`auth/me/route.ts`), no dentro de `session.ts`:** en vez de hacer que
el módulo de sesión núcleo (importado por prácticamente toda la app)
llame a Django directamente, se extendió el patrón que ya usaba
`login/route.ts`: `auth/me/route.ts` resuelve
`session_duration_default_hours` contra Django (`GET
/settings/seguridad-config/`, mismo endpoint que las Fases 59-61)
ANTES de llamar a `createSession`, y lo pasa como
`durationHoursOverride`. Con ambos callers reales resolviendo de
antemano, el fallback interno de `session.ts` pasa a ser un piso
hardcodeado (168h/720h, mismos defaults que Django) en vez de una
consulta — el módulo queda sin ninguna dependencia de
Prisma/Django en su código, resultado más limpio que el estado
anterior. **Comportamiento preexistente preservado, no corregido:** la
re-emisión de sesión en `auth/me/route.ts` sigue usando siempre la
duración "default", nunca "recordarme", incluso si la sesión original
se creó con "recordarme" activo — quirk heredado, documentado, fuera
de alcance de este cutover. `getEffectiveSessionDurationDefaultHours`/
`getEffectiveSessionDurationRememberHours`/
`setSessionDurationDefaultHours`/`setSessionDurationRememberHours` + 2
constantes eliminados de `systemConfig.ts` (sin consumidores reales
restantes, confirmado con `grep`). Sin cambios de backend — no
requirió corrida de `pytest`. `npx tsc --noEmit` limpio, `npm run
lint` sin hallazgos nuevos, suite completa de Vitest 99 archivos /
1259 tests en verde, incluida la suite completa de `auth.test.ts`
(login/logout/me/change-password/forgot-password/reset-password/consent)
para descartar cualquier regresión en el flujo de autenticación. Con
esto se cierra el backlog de "Centro de Configuración" con consumidor
real confirmado (Fases 59-62) — queda pendiente el rediseño de
`/settings` (Sprint O, UI) y la limpieza de motores legacy sin
importadores reales. Ver `docs/AUDIT_LOG.md` § 2026-08-25 (Fase 62))
**Autor:** Claude Code

---

**Actualización anterior:** 2026-08-25 (v1.121.0 — Migración de stack hacia
skelleton_base, Fase 61: cutover de `passwordMinLength`
(`settings/seguridad-config`) + hallazgo de seguridad documentado.
Continuando "siguiente fase" tras la Fase 60, se investigó cuál de los
2 candidatos restantes con consumidor real confirmado
(`password_min_length`, `session_duration_default/remember_hours`) era
el de menor riesgo — `password_min_length` no está en la ruta crítica
de login (solo se evalúa al cambiar la propia contraseña), a diferencia
de `session_duration_*` (`session.ts`, evaluado en cada emisión de
sesión). **Cutover mecánico, idéntico en forma al de la Fase 60:**
`SeguridadConfigView` (Django, Fase 32) ya devolvía `password_min_length`
en la misma respuesta `_payload` que los otros 3 campos de
`seguridad-config` (ya cortados desde la Fase 36) — el `route.ts`
ignoraba ese campo y hacía una llamada paralela innecesaria a Postgres.
Se cortaron `settings/seguridad-config/route.ts` (ambos lados) y el
único consumidor externo, `auth/change-password/route.ts`, vía nuevo
`src/lib/djangoPasswordPolicyConfig.ts` (`fetchDjangoPasswordMinLength`,
degrada al mismo default 6 si Django no está disponible). **Hallazgo —
a diferencia de `workday_end_hour` (Fase 60), este SÍ es un hallazgo de
seguridad real, no solo un gap arquitectónico:** al investigar cómo
Django enforcea `password_min_length` en su propio flujo de cambio de
contraseña (para confirmar que el cutover no introducía una regresión),
se encontró que NO lo enforcea — `ChangeOwnPasswordSerializer.
validate_new_password` llama a `django.contrib.auth.password_validation.
validate_password`, que valida contra `AUTH_PASSWORD_VALIDATORS`
(`backend/config/settings/base.py`), una lista ESTÁTICA sin ninguna
lectura de `SystemConfigHistory`. `MinimumLengthValidator` ahí está
hardcodeado en `min_length=10`, un valor completamente desconectado del
`password_min_length` configurable (default 6, editable 4-128 desde
Ajustes). **Efecto práctico documentado, no corregido:** un
Administrador que configure un mínimo MENOR a 10 (ej. el default, 6)
tiene una falsa sensación de control — Django sigue exigiendo 10 sin
importar la configuración; solo un valor MAYOR a 10 (ej. 12) tiene
efecto real, porque la pre-validación de Next.js bloquea antes de
llegar a Django. **Decisión — NO se corrige el validador hardcodeado
en esta fase:** cambiarlo (¿validador dinámico que lea
`SystemConfigHistory` en cada request, o subir el hardcodeado a 10 como
piso documentado y quitar la ilusión de configurabilidad?) es una
decisión de producto/seguridad real, fuera de alcance de un cutover de
lectura/escritura — se documenta como hallazgo pendiente de decisión,
no se resuelve unilateralmente. `getEffectivePasswordMinLength`/
`setPasswordMinLength`/`CONFIG_KEY_PASSWORD_MIN_LENGTH`/
`DEFAULT_PASSWORD_MIN_LENGTH` eliminados de `systemConfig.ts` — a
diferencia de `workdayEndHour` en la Fase 60, ningún archivo (ni
siquiera código muerto) seguía importándolas, confirmado con `grep`
antes de borrar. Sin cambios de backend — no requirió corrida de
`pytest`. `npx tsc --noEmit` limpio, `npm run lint` sin hallazgos
nuevos, suite completa de Vitest 99 archivos / 1260 tests en verde. Ver
`docs/AUDIT_LOG.md` § 2026-08-25 (Fase 61))
**Autor:** Claude Code

---

**Actualización anterior:** 2026-08-25 (v1.120.0 — Migración de stack hacia
skelleton_base, Fase 60: cutover completo de `settings/trabajo-avanzado`
(hora de corte de jornada), segundo valor reconectado de Centro de
Configuración. Continuando el patrón de la Fase 59 tras "siguiente
fase", se investigó cuál de los candidatos restantes era el más
aislado. `workday_end_hour` resultó tener el perfil más favorable: su
`route.ts` documentaba explícitamente desde la Fase 36 por qué NO se
había cortado — "su único consumidor real hoy es
`src/lib/capacityForecast.ts` (Predictive sigue 100% en Prisma)". Se
verificó esa premisa contra el código y ya no era cierta:
`capacityForecast.ts` solo lo importan `analytics.ts`/
`insightsEngine.ts`/`predictionEngine.ts`, los 3 sin ningún importador
real desde `src/app` desde el cutover de Analytics/KPIs e Inteligencia
Preventiva (Fases 47/48) — el comentario quedó desactualizado 1 fase
antes sin que nadie lo corrigiera, mismo patrón de "razón de bloqueo
obsoleta" ya visto en la Fase 49 y la Fase 51. **Cutover más simple
que el de Nova Cache:** `TrabajoAvanzadoView` (Django, Fase 32) ya
devolvía `workday_end_hour` en la MISMA respuesta que
`retroactive_window_days` — la única llamada a Django que el `route.ts`
ya hacía. No hizo falta ningún adaptador nuevo: solo dejar de ignorar
un campo que Django ya enviaba y de hacer la llamada paralela
innecesaria a Postgres. **Decisión — `getEffectiveWorkdayEndHour`/
`setWorkdayEndHour` NO se eliminan de `systemConfig.ts`, a diferencia
de la Fase 59:** `capacityForecast.ts` sigue importando ambas
funciones — aunque ese archivo es código muerto en tiempo de
ejecución, sigue siendo parte del grafo de compilación de TypeScript;
eliminarlas rompería `tsc` sin también tocar ese archivo, fuera de
alcance de esta fase. Queda documentado como candidato de una fase de
limpieza futura dedicada a los motores legacy sin importadores reales
(`analytics.ts`, `insightsEngine.ts`, `predictionEngine.ts`,
`trendEngine.ts`, `riskAlerts.ts`, `workload.ts`,
`capacityForecast.ts`, `recoveryCenter.ts`, `deskNoteRetention.ts`,
`rate-limit.ts`, todos confirmados con 0 importadores reales durante
esta misma investigación). **Hallazgo adicional que reduce el backlog
real de Centro de Configuración:** `desk_archive_retention_days`/
`desk_note_max_replies`/`snooze_presets_minutes` (Escritorio Digital) y
`analytics_config`/`normalization_curves`/`role_target`/
`role_compatibility`/`recovery_center_retention_hours` YA NO tienen
ningún consumidor real en Postgres — no necesitan cutover, ya están
efectivamente migrados, solo código muerto pendiente de limpieza.
Quedan genuinamente pendientes, con consumidor real confirmado:
`password_min_length` (sin divergencia activa, gap arquitectónico no
un bug) y `session_duration_default/remember_hours` (`session.ts` —
ruta crítica de login, mayor riesgo del grupo). Sin cambios de
backend — no requirió corrida de `pytest`. `npx tsc --noEmit` limpio
(confirma que `capacityForecast.ts` sigue compilando con las funciones
retenidas), `npm run lint` sin hallazgos nuevos, suite completa de
Vitest 99 archivos / 1261 tests en verde. Ver `docs/AUDIT_LOG.md` §
2026-08-25 (Fase 60))
**Autor:** Claude Code

---

**Actualización anterior:** 2026-08-25 (v1.119.0 — Migración de stack hacia
skelleton_base, Fase 59: cutover del TTL de caché de Nova
(`settings/nova-cache`), primer valor reconectado del lado consumidor
dentro de Centro de Configuración. Tras cerrar el Asistente/RAG (Fase
58), el usuario pidió continuar con "el más fácil" entre 2 alternativas:
el motor de cálculo completo de Reportes Ejecutivos (grande, ~13
sub-fases) o investigar Centro de Configuración. Investigando este
último contra el código real (no solo la narrativa de este documento),
se encontró que el CRUD Django de los ~9-12 valores del Sprint O ya
estaba completo desde las Fases 31/32/34 — lo que realmente falta no es
el CRUD sino el CONSUMIDOR de runtime: `src/lib/systemConfig.ts` (11
importadores activos verificados con `grep`) sigue leyendo
`SystemConfigHistory` de Postgres para calcular el valor EFECTIVO que
usa cada feature, aunque la UI de Ajustes ya escriba en Django — 2
almacenes desincronizados. Se eligió `nova_cache_ttl_minutes` para
arrancar por ser el más aislado (2 consumidores reales:
`dashboard/nova-message`, `kpis/nova-insights/[userId]`) y no necesitar
backend nuevo (`NovaCacheView` ya completa). **Hallazgo — staleness
activa, no solo un gap teórico:** editar el TTL desde Ajustes no tenía
ningún efecto real desde que esos 2 endpoints se cortaron a Django
(Fase 54, 2026-08-24) — leen la tabla homónima en SQL Server, un
almacén distinto al que escribía la UI. Nuevo
`src/lib/djangoNovaCacheConfig.ts` (`fetchDjangoNovaCacheTtlMinutes`)
para los 2 consumidores, con degradación al mismo default (240 min)
que el backend si Django no está disponible — es solo la duración de
una caché en memoria, nunca un dato que deba romper la generación del
mensaje. `getEffectiveNovaCacheTtlMinutes`/`setNovaCacheTtlMinutes`/
`CONFIG_KEY_NOVA_CACHE_TTL_MINUTES`/`DEFAULT_NOVA_CACHE_TTL_MINUTES`
eliminados de `systemConfig.ts` tras confirmar con `grep` que no
quedaba ningún consumidor real (no comentados, no retenidos "por si
acaso"). Sin cambios de backend — no requirió corrida de `pytest`.
`npx tsc --noEmit` limpio, `npm run lint` sin hallazgos nuevos, suite
completa de Vitest 99 archivos / 1260 tests en verde. Quedan
pendientes, mismo patrón, candidatos para próximas fases:
`password_min_length`, `session_duration_default/remember_hours`
(ruta crítica de login, mayor riesgo del grupo), `workday_end_hour`/
`retroactive_window_days`, `analytics_config`/`normalization_curves`/
`role_target`/`role_compatibility` (posible dead code en TS desde la
Fase 47, a confirmar), `retention_policy`,
`recovery_center_retention_hours`, `desk_archive_retention_days`/
`desk_note_max_replies`/`snooze_presets_minutes` — cada uno requiere su
propio análisis de consumidores reales antes de cortar. Ver
`docs/AUDIT_LOG.md` § 2026-08-25 (Fase 59))
**Autor:** Claude Code

---

**Actualización anterior:** 2026-08-25 (v1.118.0 — Migración de stack hacia
skelleton_base, Fase 58: Asistente LLM/RAG — cutover de la base de
conocimiento a Django, cálculo de embeddings sigue en TypeScript.
Investigando qué módulo seguía tras Reportes Ejecutivos, se identificó el
Asistente (Nova) como el único candidato grande restante — con un riesgo
técnico marcado desde antes en `docs/ROADMAP.md`: `getEmbedding()`
(`src/lib/embeddings.ts`) usa `@xenova/transformers`, que corre el modelo
de sentence-transformers (`Xenova/all-MiniLM-L6-v2`) EN PROCESO dentro de
Node.js — no es una llamada a una API externa. **Hallazgo que de-riesgó
la fase por completo:** no hacía falta portar el cálculo de embeddings a
Python (el riesgo que el ROADMAP marcaba como el mayor de la migración)
— alcanza con mover la PERSISTENCIA, mismo patrón que Reportes Ejecutivos
(Fase 56). **App Django nueva `apps.assistant`:** `KnowledgeDocument`
(título, nombre de archivo, contenido extraído, ruta/sha de GitHub,
estado PROCESANDO/LISTO/ERROR, autor) + `DocumentChunk` (contenido,
`embedding` como `JSONField` — el vector ya calculado en TS, Django
nunca lo toca) — réplica exacta de `prisma/schema.prisma`. 4 vistas
(`KnowledgeDocumentListCreateView`/`KnowledgeDocumentDetailView`/
`DocumentChunkBulkCreateView`/`DocumentChunkListView`), gateadas por
`CanViewKnowledgeBase`/`CanManageKnowledgeBase` (réplica de
`canViewKnowledgeBase`/`canManageKnowledgeBase` de `src/lib/roles.ts`) —
`DocumentChunkListView` es la única sin ese gate (cualquier autenticado,
mismo criterio que el chat en modo "hr" del TS original). 24 tests
nuevos (`pytest apps/assistant/` 24/24), `ruff check apps/assistant/`
limpio. **Lado TypeScript:** nuevo `djangoAssistantAdapter.ts`;
`src/lib/githubDocuments.ts::processGithubDocument` reemplaza sus 5
llamadas a `prisma.knowledgeDocument.update`/`prisma.documentChunk.deleteMany`
por las funciones del adaptador, sin cambios en la lógica de
descarga/extracción/chunking/embeddings; `assistant/documents/route.ts`
(GET/POST) y `assistant/documents/[id]/route.ts` (DELETE) cortados
igual. **`assistant/chat/route.ts` recompuesto, no solo cortado:**
`buildTaskContext` ahora usa `fetchOwnDjangoTasks()` (ya existente desde
la Fase 3a); `buildTeamContext` usa `GET /team/` + `GET /team/<id>/tasks/`
(Fase 18/46) en vez de 1+N consultas Prisma; `findRelevantChunks` usa
`GET /assistant/chunks/` en vez de `prisma.documentChunk.findMany` — la
búsqueda por similitud coseno (`cosineSimilarity`) sigue calculándose en
TypeScript sin cambios. **Hallazgo aditivo de API:** `github_sha` no
estaba en `KnowledgeDocumentSerializer` (el TS original leía el registro
Prisma completo sin `select`) — se agregó porque `DELETE .../[id]/route.ts`
lo necesita para borrar el archivo de GitHub antes de eliminar el
registro. Reescritos `assistant-documents.test.ts`/`assistant-chat.test.ts`
(mockeaban Prisma) y el bloque `DELETE /api/assistant/documents/[id]`
dentro de `nova-badges-documents.test.ts`, todos mockeando
`djangoApiFetch` en vez de `prisma`, mismo patrón que `team.test.ts`
(Fase 46). `npx tsc --noEmit` limpio, `npm run lint` sin hallazgos
nuevos, suite completa de Vitest 99 archivos / 1260 tests en verde.
`pytest apps/assistant/ apps/reports/ apps/users/ apps/team/ apps/tasks/`
285/285 en verde, `ruff check` limpio en los módulos tocados (los 28
hallazgos del `ruff check .` global son deuda preexistente en
`apps/tasks/tests/`, no relacionada con esta fase). Ver
`docs/AUDIT_LOG.md` § 2026-08-25 (Fase 58))
**Autor:** Claude Code

---

**Actualización anterior:** 2026-08-25 (v1.117.0 — Migración de stack hacia
skelleton_base, Fase 57: Reportes Ejecutivos — primer recorte del motor
de CÁLCULO recompuesto sobre Django (el resto del motor sigue en
Next.js/Prisma). Tras cerrar la persistencia (Fase 56), se investigó
cómo continuar con el cálculo en sí: dentro de
`buildMonthlySnapshotData` hay 2 cómputos por colaborador distintos —
el **Índice Ejecutivo** (`computePerformanceScore`/`computeHealthScore`,
ya portados a Django desde la Fase 4e/4g) y el **KPI del miembro del
reporte** (`ReportMemberKpi` — score/cumplimiento/carga/horas por
persona, lógica propia calculada en lote sobre Task/TaskActivity, SIN
equivalente en Django). Solo el primero recompone limpio; el segundo
queda documentado como investigación pendiente (comparar campo por
campo contra `/kpis/<id>/`, sin decidir todavía). **Bloqueador
encontrado a mitad de camino:** ni siquiera el Índice Ejecutivo podía
recomponerse directo — el roster se resuelve con cuids de Postgres
(`resolveReportRoster`, necesarios para las queries Prisma de
Tareas/Actividades que siguen sin cambios) y no existía ningún
endpoint de Django para traducir un LOTE de cuids a ids numéricos
(`/auth/me/` solo resuelve "a mí mismo"; `GET /admin/users/` exige el
permiso de administración, distinto del que usa Reportes Ejecutivos —
un Coordinador Nacional puede generar reportes sin `usuarios.ver`).
**Vista Django nueva:** `GET /reports/user-lookup/?legacy_ids=...`
(`backend/apps/reports/`, gateada por `CanAccessReports`) resuelve el
lote. Con eso, `buildSnapshotData.ts` reemplaza las 2 llamadas locales
por 1 sola llamada por colaborador a `/analytics/<id>/` (bundle ya
existente desde la Fase 4m/47, trae Performance Score + Equilibrio
Operativo juntos — mejor que el original, que hacía 2 llamadas
separadas). Nuevo módulo `djangoAnalyticsBridge.ts` con el puente de
ids + el fetch del bundle, cacheado igual que antes
(`cached()`, mismo TTL). Colaboradores sin id de Django resuelto se
excluyen del promedio (hallazgo documentado, no bloqueante — depende
de que `migrate_users_from_postgres` haya corrido). Gap documentado:
`/analytics/<id>/` siempre calcula contra `now()` real, sin parámetro
de corte — sin efecto en el caso común (esta rama solo corre para el
mes EN CURSO), salvo un `fechaCorte` manual explícito (uso
excepcional). `pytest apps/reports/ apps/users/` 100/100 en verde,
`ruff check` limpio. `npx tsc --noEmit` limpio, `npm run lint` sin
hallazgos nuevos, suite completa de Vitest 99 archivos / 1259 tests en
verde (7 tests nuevos para `djangoAnalyticsBridge.ts`, que nunca tuvo
cobertura). El grueso del motor (`ReportMemberKpi`, agregados de
equipo en `reportInsights.ts`) sigue sin portar — ver
`docs/ROADMAP.md`. Ver `docs/AUDIT_LOG.md` § 2026-08-25 (Fase 57))
**Autor:** Claude Code

---

**Actualización anterior:** 2026-08-25 (v1.116.0 — Migración de stack hacia
skelleton_base, Fase 56: Reportes Ejecutivos — cutover de PERSISTENCIA +
lectura, el cálculo sigue en Next.js. Investigando cómo continuar tras
cerrar Consentimiento/Preferencias, se auditó a fondo
`src/lib/executiveReporting/` (19 archivos, 3866 líneas) — el motor de
cálculo (`buildSnapshotData.ts`, roster/KPIs por colaborador/agregados
de equipo/narrativa NOVA) es demasiado grande para portar en una sola
fase (mismo orden que KPIs/Analytics, ~13 sub-fases). **Hallazgo
crítico que redefinió el alcance de esta fase:** `POST /api/reports/
executive` (generación) seguía escribiendo en `ExecutiveReportSnapshot`
de Postgres, mientras que `ExecutiveReportListView`/
`ExecutiveReportDetailView` (Django, Fase 8, 2026-08-18) ya leían de
SQL Server — **cualquier reporte generado desde la Fase 8 nunca fue
visible** para esos endpoints de lectura (que servían solo los 4
registros migrados en el backfill original). No era necesario portar
el motor de cálculo para cerrar esto: **2 vistas Django nuevas**
(`ExecutiveReportCreateView`/`ExecutiveReportAuditCreateView`,
`backend/apps/reports/`) solo PERSISTEN el snapshot que Next.js ya
calculó — `buildSnapshotForFilters` (~1183 líneas) sigue sin ningún
cambio, contra Prisma. `generated_by`/`user` se resuelven desde
`request.user` (JWT), nunca desde el body — más simple que el resto de
la migración (sin necesidad de `resolveDjangoUserId`). Colisión de
`report_id` devuelve 409 (sin `UniqueValidator` automático de DRF,
desactivado a propósito); el reintento con un id nuevo sigue viviendo
en `snapshotStore.ts` (TS), como antes. `GET /api/reports/executive/
list` y `/[reportId]` cortados como reenvío directo a las vistas de
lectura ya existentes de la Fase 8 (sin cambios de backend ahí).
Verificado con `pytest apps/reports/ apps/users/` (95/95) y `ruff
check` limpio — primera fase de esta sesión con SQL Server plenamente
operativo desde el arranque. `npx tsc --noEmit` limpio, `npm run lint`
sin hallazgos nuevos, suite completa de Vitest 98 archivos / 1252
tests en verde. Motor de cálculo, exportación Excel/HTML y narrativa
NOVA quedan explícitamente fuera de esta fase — ver `docs/ROADMAP.md`
para el desglose de lo que falta. Ver `docs/AUDIT_LOG.md` § 2026-08-25
(Fase 56))
**Autor:** Claude Code

---

**Actualización anterior:** 2026-08-25 (v1.115.0 — Migración de stack hacia
skelleton_base, Fase 55 completa: cutover de las 6 rutas de
Consentimiento/Preferencias de usuario, incluidas las 2 que habían
quedado bloqueadas por falta de acceso a SQL Server más temprano en la
misma sesión. **Diagnóstico corregido:** el bloqueo real no era falta
de acceso — era que `localhost:14330` (el valor original de
`backend/.env`) apunta al contenedor Docker `gestion_tareas_rrhh-mssql-1`
de este proyecto, y se había diagnosticado por error como una instancia
SQL Server Express nativa en otro puerto (Docker no aparecía activo al
chequearlo la primera vez). Una vez identificado el contenedor correcto,
la contraseña de `.env` funcionó sin cambios. **2 vistas Django
nuevas** (`UserViewPreferencesView`, `ActivityFormatView` en
`apps/users/self_service_views.py`) verificadas con `pytest apps/users/`
(63/63 en verde, aislado de la contención transitoria del full-suite
compartido) y `ruff check` limpio. `UserViewPreferencesView` replica
fielmente el bug preexistente del TS legacy (reemplaza `view_preferences`
completo, sin fusionar otras claves de prefijo) — documentado, no
corregido. `ActivityFormatView` reutiliza el mismo truco de prefijo
(`ACTIVITY_FORMAT:`) que `FavoritesView`/`DashboardCardOrderView`.
**Cierra además el gap explícito de la Fase 3a en `tasks/page.tsx`:**
ahora resuelve `fetchDjangoCurrentUserId()` antes de pasarlo a
`TasksModule` (antes usaba el cuid de Postgres porque `view-preferences`
seguía en Prisma). `npx tsc --noEmit` limpio, `npm run lint` sin
hallazgos nuevos, suite completa de Vitest 98 archivos / 1248 tests en
verde. Ver `docs/AUDIT_LOG.md` § 2026-08-25 (Fase 55) y
`docs/ROADMAP.md` para el resto del roadmap de la migración de stack)
**Autor:** Claude Code

---

**Actualización anterior:** 2026-08-25 (v1.114.0 — Migración de stack hacia
skelleton_base, Fase 55: cutover PARCIAL de Consentimiento/Preferencias
de usuario (4 de 6 rutas). Investigando el punto 2 de "Decommission de
Postgres" (`docs/ROADMAP.md`), se encontró que su premisa también
estaba desactualizada — decía que el modelo `User` de Django no tenía
`theme`/`viewPreferences`/`badges`/`dataConsentAccepted`/
`dataConsentAcceptedAt`, pero los 5 campos ya existen desde las Fases
12/25/26, y 3 de los 4 endpoints que los necesitan (`AcceptConsentView`,
`DashboardCardOrderView`, `UserAdminViewSet.reset_consent`/
`reset_consent_all`) ya estaban completos, solo sin reconectar.
**4 rutas redirigidas, sin backend nuevo:** `PATCH /api/auth/consent`,
`PATCH /api/dashboard/card-order`, `PATCH /api/users/[id]/reset-consent`,
`PATCH /api/users/reset-consent-all` (estas 2 últimas conservan
`canManageUsers`/`canManageTargetUser` en TS, mismo criterio que
`reset-password/route.ts` de la Fase 2). **2 rutas BLOQUEADAS en esta
sesión, no por falta de trabajo sino por falta de acceso a SQL
Server:** `PATCH /api/users/[id]/view-preferences` y la porción
`activityFormat` de `auth/me` necesitan una vista Django nueva
(`view_preferences` existe en el modelo pero no tiene endpoint de
escritura genérico todavía) — sin poder correr `pytest` contra
`localhost:14330` (sin listener TCP en esta sesión) no se escribió ese
código sin verificar. Hallazgo documentado, no corregido: el
comportamiento legacy de `view-preferences/route.ts` REEMPLAZA el
array completo (sin fusionar `ACTIVITY_FORMAT:`/`DASHBOARD_CARDS:`/
`CONFIG_FAVORITE:`) — un bug preexistente del TS original, a replicar
fielmente cuando se corte, no a corregir de paso. `npx tsc --noEmit`
limpio, `npm run lint` sin hallazgos nuevos, suite completa de Vitest
98 archivos / 1247 tests en verde. Sin cambios de backend en esta
fase (las 2 vistas nuevas quedan pendientes). Ver `docs/AUDIT_LOG.md`
§ 2026-08-25 (Fase 55) y `docs/ROADMAP.md` para el resto del roadmap
de la migración de stack)
**Autor:** Claude Code

---

**Actualización anterior:** 2026-08-24 (v1.113.0 — Migración de stack hacia
skelleton_base, Fase 54: cutover de Nova Insights/Message
(`kpis/nova-insights/[userId]` + `dashboard/nova-message`) + fix de un
bug activo de ids en `MyKpisModule.tsx`. Ninguno de los 2 endpoints
necesitaba backend nuevo: recomponen sus datos desde `GET
/analytics/<id>/` (bundle Health Score/alertas/tendencias/
consistencia/anomalías/predicción/calidad del dato, Fase 4m), `GET
/kpis/<id>/`/`GET /kpis/me/` (nombre/rol + estado especial vigente +
carga del día) y `GET /analytics/operational-risk/<id>/` (Fase 47),
más `fetchOwnDjangoTasks` (`GET /tasks/`, Fase 3a) para las tareas
propias de `nova-message` — todos ya cortados y probados en fases
previas. **Bug activo encontrado y cerrado, misma familia que las
Fases 42/52:** `MyKpisModule.tsx` (pestaña "Mis KPIs") pasaba
`currentUserId` (el cuid de Postgres, `session.userId`) a 6 usos que
en realidad esperan el id NUMÉRICO de Django (`NovaInsightsCard`,
`WhatIfSimulator`, `AdvancedAnalyticsPanel`, `InsightsPanel`,
`ScoreHistoryChart`, `downloadKpisPDF`) — la vista de equipo
(`KpisModule.tsx`) ya usaba el id correcto (`kpi.user.id`) desde la
Fase 47 y funcionaba bien; la vista propia, no. Efecto concreto: Nova
Insights (y el resto de esos 5 paneles) devolvía 404 al ver a un
compañero de equipo desde que Analytics/KPIs se cortó a Django (Fase
47) — nadie lo notó porque cada fase probó su propio endpoint de forma
aislada, no la cadena completa desde el componente. Corregido pasando
`kpi.user.id` (ya disponible en el bundle propio, `/api/kpis/me`) en
los 6 lugares — la prop `currentUserId` quedó sin uso en
`MyKpisModule`/`AnalyticsModule`/`my-kpis/page.tsx` y se eliminó.
Nueva cobertura de test para `nova-insights` (nunca la tuvo, gap
preexistente) — 10 tests cubriendo los 3 modos (motivacional/insights-
only/completo), propagación de 401/403/404 de Django, caché y
fallback sin `GROQ_API_KEY`. `nova-message` reescribe su describe
block para mockear `fetchOwnDjangoTasks`/`djangoApiFetch` en vez de
Prisma, con 2 tests nuevos para el caso "Django no disponible"
(degrada al saludo genérico con 200, no 401 — única ruta de esta
migración con ese criterio, por ser puramente cosmética). `npx tsc
--noEmit` limpio, `npm run lint` sin hallazgos nuevos en los archivos
tocados, suite completa de Vitest 98 archivos / 1243 tests en verde.
Sin cambios de backend. Ver `docs/AUDIT_LOG.md` § 2026-08-24 (Fase 54)
y `docs/ROADMAP.md` para el resto del roadmap de la migración de
stack)
**Autor:** Claude Code

---

**Actualización anterior:** 2026-08-24 (v1.112.0 — Migración de stack hacia
skelleton_base, Fase 53: cutover de `settings/config-history` +
`settings/config-history/restore-default`. Continúa "Cutovers
pendientes" tras corregir la documentación desactualizada de
`docs/ROADMAP.md` § Planificado (punto 14, "Decommission de
PostgreSQL") — su lista original de candidatos (Notificaciones,
Reuniones, `users/assignable`, Ideas, Comunicados) ya estaba cerrada
desde las Fases 41-44 (2026-08-21), pero el párrafo nunca se
actualizó para reflejarlo. **2 rutas redirigidas:** `GET
/api/settings/config-history` + `POST /api/settings/config-history/
restore-default` — ambas vistas (`ConfigHistoryView`/
`ConfigHistoryRestoreDefaultView`) ya estaban completas y probadas en
el backend desde la Fase 33, réplica exacta del `route.ts` original
(mismo criterio que la Fase 51: solo reconectar, sin trabajo de
backend nuevo). Mocks de Prisma huérfanos removidos del test
compartido (`settings-config-center.test.ts`), agregada cobertura
para el caso "sesión sin acceso a Django todavía" en ambas rutas.
`npx tsc --noEmit` limpio, `npm run lint` sin hallazgos nuevos en los
archivos tocados, suite completa de Vitest 97 archivos / 1231 tests en
verde. Sin cambios de backend. Ver `docs/AUDIT_LOG.md` § 2026-08-24
(Fase 53) y `docs/ROADMAP.md` para el resto del roadmap de la
migración de stack)
**Autor:** Claude Code

---

**Actualización anterior:** 2026-08-24 (v1.111.0 — Migración de stack hacia
skelleton_base, Fase 52: cutover de `holidays`/`leave-records`/
`special-status`/`workload-config`/`kpi-start-date`. Cierra el
hallazgo documentado (no corregido) en la Fase 51: estos 5 endpoints
de `settings/*` ya divergían del bundle de Analytics/Dashboard desde
la Fase 4a/4m, meses antes de esta sesión — editarlos desde Ajustes
no tenía ningún efecto real en Django. **8 rutas redirigidas:**
`GET/POST /settings/holidays/` + `DELETE .../<id>/`, `GET/POST
/settings/leave-records/` + `DELETE .../<id>/`, `GET/POST
/settings/special-status/` + `PATCH/DELETE .../<id>/`, `GET/PUT
/settings/workload-config/`, `GET/PATCH /settings/kpi-start-date/` —
las 8 vistas ya estaban completas en el backend desde la Fase 29/31.
**Bug activo cerrado, más severo de lo esperado:** `leave-records`/
`special-status` reciben `userId` desde un selector poblado por `GET
/api/users` (Django, id numérico desde la Fase 2) — como esas 2
rutas seguían en Prisma, ese id nunca coincidía con ningún `cuid` de
Postgres; crear un permiso o estado especial para CUALQUIER usuario
devolvía 404 "Usuario no encontrado" en la práctica, desde la Fase 2.
**Hallazgo y corrección de backend:** `HolidayListView.get` exigía
ADMINISTRADOR por error — el docstring de la Fase 29 afirmaba
"réplica exacta, igual que el TS", pero el `route.ts` real (fuente de
verdad) nunca restringió `GET`, solo `POST`/`DELETE`. Se corrigió en
`apps/configuration/views.py` y se actualizó
`test_holidays_view.py` en el mismo cambio — único cambio de backend
de esta fase, verificado con `ruff check` limpio y `pytest
apps/configuration/` 228/228 en verde. Traducción camelCase↔snake_case
a mano por endpoint (mismo criterio que `meetings`, Fase 42), mensajes
de error preservados vía `extractDjangoFlatErrorMessage` donde el
contenido real varía. Nueva cobertura de test para `special-status` y
`GET /api/settings/leave-records` (nunca la tuvieron, gap
preexistente). Ningún modelo ni migración nueva. `npx tsc --noEmit`
limpio, `npm run lint` sin hallazgos nuevos, suite completa de Vitest
97 archivos / 1229 tests en verde. Ver `docs/AUDIT_LOG.md` §
2026-08-24 (Fase 52) y `docs/ROADMAP.md` para el resto del roadmap de
la migración de stack)
**Autor:** Claude Code

---

**Actualización anterior:** 2026-08-24 (v1.110.0 — Migración de stack hacia
skelleton_base, Fase 51: cutover de `GET /api/dashboard` +
`settings/welcome-message`. Cierra la staleness de Tareas/
Comentarios/Actividades/Proyectos en el bundle del Dashboard,
documentada como fuera de alcance desde la Fase 44 (que ya había
corregido Comunicados/Reuniones en el mismo bundle) — el bloqueo
original ("depende de Analytics/Workload sin cutover") ya no aplicaba:
`build_dashboard_payload` (backend, Fase 25) era una réplica campo
por campo completa desde hace tiempo, con las mismas claves camelCase
que el contrato TS. `route.ts` queda como reenvío directo, solo
convirtiendo a `string` los 4 arrays con `id` numérico
(`priorityTasks`/`announcements`/`upcomingMeetings`/`myProjects`).
**Hallazgo — bug activo cerrado:** `myProjects[].id` alimentaba
`href="/projects/${p.id}"` con el `cuid` de Postgres — cualquier
proyecto creado después de la Fase 39 (Proyectos ya Django) daba 404
al hacer clic desde el Dashboard. **`GET/PUT /api/settings/
welcome-message` se cortó en el MISMO cambio:** el Dashboard ya leía
este mensaje de Django — dejar la escritura en Prisma habría
introducido una divergencia NUEVA (no preexistente), mismo criterio
que la Fase 38. **Hallazgo documentado, deliberadamente NO corregido
en esta fase:** `workload-config`/`holidays`/`leave-records`/
`special-status`/`kpi-start-date` alimentan `compute_carga_tiempo`
(Django), ya consumida por el bundle de Analytics desde la Fase 4m
(2026-08-12) — meses antes de esta sesión; esos 5 endpoints de
`settings/*` ya estaban divergentes desde entonces, el cutover de
Dashboard solo agrega un consumidor más al mismo problema
preexistente — candidato a una fase dedicada futura. `PATCH
/api/dashboard/card-order` NO se corta — comparte
`User.viewPreferences` con `favorites` (sin cutover), mismo riesgo ya
documentado desde la Fase 36. Ningún modelo ni migración nueva. `npx
tsc --noEmit` limpio, `npm run lint` sin hallazgos nuevos, suite
completa de Vitest 96 archivos / 1216 tests en verde. Sin cambios de
backend — no requirió corrida de pytest. Ver `docs/AUDIT_LOG.md` §
2026-08-24 (Fase 51) y `docs/ROADMAP.md` para el resto del roadmap de
la migración de stack)
**Autor:** Claude Code

---

**Actualización anterior:** 2026-08-24 (v1.109.0 — Migración de stack hacia
skelleton_base, Fase 50: cutover de `DELETE /api/desk-notes/[id]`
(Papelera de Notas). Cierra el último gap documentado desde la Fase
7g/14: `GET`/`PATCH /api/desk-notes/[id]` ya eran Django desde la
Fase 7g, pero `DELETE` seguía en Prisma porque, en su momento, el
Centro de Recuperación (`RecoveryItem`, transversal) todavía no
estaba portado. Ese bloqueo se resolvió silenciosamente en la Fase 14
del backend (`apps.recovery` + `DeskNoteViewSet.destroy`, réplica
exacta de las 2 vías de eliminación del TS — remitente→papelera,
destinatario→borrado definitivo de una nota archivada) — solo faltaba
conectar el `route.ts`. Mensajes de error exactos (`RecoveryError`)
preservados vía `extractDjangoFlatErrorMessage`, mismo criterio que
`restore`/`permanent` de Proyectos (Fase 39). **Hallazgo que
simplificó el riesgo:** a diferencia de Proyectos, la papelera de
Notas nunca tuvo UI de restauración — `listActiveTrash("DESK_NOTE")`
nunca tuvo caller, ni en el TS legacy ni en Django — sin
interdependencia lista-vs-detalle que coordinar. **Observación sin
acción:** `src/lib/recoveryCenter.ts` queda sin ningún importador en
Next.js tras este cutover (no se eliminó, fuera de alcance);
`purge_expired_archived_notes()` sigue sin activarse en ningún lado
(gap preexistente, ya documentado desde la Fase 31). Ningún modelo ni
migración nueva. `npx tsc --noEmit` limpio, `npm run lint` sin
hallazgos nuevos, suite completa de Vitest 96 archivos / 1217 tests
en verde. Sin cambios de backend — no requirió corrida de pytest. Ver
`docs/AUDIT_LOG.md` § 2026-08-24 (Fase 50) y `docs/ROADMAP.md` para
el resto del roadmap de la migración de stack)
**Autor:** Claude Code

---

**Actualización anterior:** 2026-08-24 (v1.108.0 — Migración de stack hacia
skelleton_base, Fase 49: cutover de `settings/role-targets`,
`settings/role-compatibility` y `settings/system-info`. A diferencia
de las Fases 47/48 (desbloqueadas por el cutover de un módulo
completo), esta fase nace de re-auditar los 15 endpoints de
`settings/*` deferidos desde la Fase 36 ahora que Analytics/KPIs
(Fase 47) y Predictive Intelligence (Fase 48) están 100% en Django.
Resultado: solo 3 de los 15 estaban realmente desbloqueados — los
otros 12 (`holidays`, `leave-records`, `special-status`,
`workload-config`, `kpi-start-date`, `analytics-config`,
`normalization-curves`, `prediction-window`, `welcome-message`,
`nova-cache`, `favorites`, `retention-policy`) siguen bloqueados por
Dashboard/Nova Insights/Reportes Ejecutivos (todavía 100% Prisma), no
por Analytics/Predictive. **`GET/PATCH /api/settings/role-targets/`**
y **`GET/PATCH /api/settings/role-compatibility/`** redirigidos a
Django (`RoleTargetsView`/`RoleCompatibilityView`, Fase 28 del
backend, completo) — su único consumidor real hoy es Analytics
(`benchmarks`/`recommendations/team`, ya en Django); el caller TS que
les quedaba (`analytics.ts::runAnalyticsPipeline`/
`computeTeamRecommendations`) es código muerto desde el cutover de
Analytics (verificado: cero callers reales). Validación client-side
(rango 0-100, Regla 4 de niveles jerárquicos) conservada como defensa
en profundidad. **`GET /api/settings/system-info/`** redirigido a
Django (`SystemInfoView`, Fase 32 del backend, completo) — cerraba
staleness activa: contaba Usuarios/Tareas/Reuniones/Ideas
directamente en Postgres, los 4 modelos ya 100% Django desde sus
respectivos cutovers. `version`/`commitSha` ahora reflejan el backend
Django (`APP_VERSION`/`GIT_COMMIT_SHA`), no `package.json` de
Next.js — 2 apps distintas en esta migración, cada una con su propio
versionado. Nueva cobertura de test para `role-targets`/`system-info`
(nunca la tuvieron, gap preexistente); `role-compatibility.test.ts`
reescrito (mockeaba Prisma) — el bloque `system-info` duplicado
dentro de `settings.test.ts` se eliminó al migrar su cobertura al
archivo dedicado. Ningún modelo ni migración nueva. `npx tsc --noEmit`
limpio, `npm run lint` sin hallazgos nuevos, suite completa de Vitest
96 archivos / 1213 tests en verde. Sin cambios de backend — no
requirió corrida de pytest. Ver `docs/AUDIT_LOG.md` § 2026-08-24
(Fase 49) y `docs/ROADMAP.md` para el resto del roadmap de la
migración de stack)
**Autor:** Claude Code

---

**Actualización anterior:** 2026-08-24 (v1.107.0 — Migración de stack hacia
skelleton_base, Fase 48: cutover de Inteligencia Preventiva. Cierra
staleness activa en las 9 rutas de `predictive/**`, que seguían
calculando en Next.js/Prisma (`predictionEngine.ts`/`trendEngine.ts`/
`preventiveIntelligence.ts`/`capacityForecast.ts`) sobre Tareas/
Proyectos, ambos 100% Django desde las Fases 3/39. **6 rutas GET
redirigidas a Django:** `predictions/[userId]`, `trend/[userId]`
(reenvía `weeksBack` como `weeks_back`), `alerts/[userId]`,
`team-alerts`, `team-subutilization`, `project-delay/[projectId]`.
**3 simuladores POST** (nunca persisten nada): `simulate/[userId]`
(traduce `taskId`/`newTargetTimeHours` a `task_id`/
`new_target_time_hours`), `simulate/project/[projectId]`
(`additionalParticipants` → `additional_participants`),
`simulate/redistribute` (`fromUserId`/`toUserId`/`hours` →
`from_user_id`/`to_user_id`/`hours`) — traducción de body camelCase→
snake_case a mano, mismo criterio que `meetings/route.ts` (Fase 42).
Mismo patrón mínimo que `analytics/[userId]/route.ts` (Fase 4m/47):
`getSession()` solo para el 401, 404/403 con mensaje genérico, mapeo
genérico recursivo snake_case→camelCase (nuevo
`djangoPredictiveAdapter.ts`). **Puente de ids de la Fase 40
requerido:** `inteligencia-preventiva/page.tsx` pasaba
`session.userId` (`cuid` de Postgres) como `currentUserId` — 4 rutas
por-usuario más el body de `redistribute` ya esperan el id numérico
de Django; se cambió a `resolveDjangoUserId(session)`, mismo patrón
que Notificaciones/Reuniones/Ideas/Equipo. `project-delay`/
`simulate/project` no lo necesitaron — `projectId` ya llega numérico
desde `GET /api/projects`, cutover desde la Fase 39. Backend
(`apps.analytics`, Fase 9) ya estaba 100% completo — sin cambios.
**Hallazgo sin acción:** `ScenarioSimulatorPanel.tsx` filtra el
selector de "redistribuir hacia" con `m.id !== userId`, pero
`team-subutilization` siempre devolvió el campo como `userId`, nunca
`id` — bug preexistente, anterior a esta migración, fuera de alcance
de un cutover que preserva el contrato exacto de la ruta original.
Nueva cobertura de test para `predictions/[userId]`/`team-alerts`
(nunca la tuvieron, gap preexistente). Ningún modelo ni migración
nueva. `npx tsc --noEmit` limpio, `npm run lint` sin hallazgos
nuevos, suite completa de Vitest 94 archivos / 1202 tests en verde.
Sin cambios de backend — no requirió corrida de pytest. Ver
`docs/AUDIT_LOG.md` § 2026-08-24 (Fase 48) y `docs/ROADMAP.md` para
el resto del roadmap de la migración de stack)
**Autor:** Claude Code

---

**Actualización anterior:** 2026-08-24 (v1.106.0 — Migración de stack hacia
skelleton_base, Fase 47: cutover de Analytics + KPIs, rutas
granulares. Cierra staleness activa en las 13 rutas restantes de
Analytics/KPIs que seguían componiendo el motor central
(`src/lib/analytics.ts`) sobre datos de Prisma/Postgres, pese a que
Tareas (su único insumo real) es 100% Django desde la Fase 3. **10
rutas nuevas bajo `analytics/`:** `GET insights/[userId]`,
`equilibrio/[userId]`, `benchmarks/[userId]`, `operational-risk/[userId]`,
`operational-risk/team`, `recommendations/team`, `history/[userId]`
(reenvía `kind`/`months`), `target-time/[userId]`, `data-quality`
(reenvía `scope`, default `"self"`); **`POST simulate/[userId]`**
(reenvía el body tal cual, sin re-validar). **3 rutas nuevas bajo
`kpis/`:** `team` (reenvía `month`), `team-capacity`, `executive`.
Las 13 siguen el mismo template mínimo ya probado en las 2 rutas
plantilla de la Fase 4m (`analytics/[userId]`, `kpis/[userId]`):
`getSession()` solo para el 401, 404/403 propagados con mensaje
genérico (sin extraer el mensaje real de Django), mapeo genérico
recursivo snake_case→camelCase. Backend (`apps.analytics`) ya estaba
100% completo desde las Fases 16-24 — sin cambios. Excluidas por no
tener backend: `kpis/nova-insights`, `analytics/diagnostics`. **Con
esta entrega, el cutover de `route.ts` de Analytics/KPIs queda
cerrado en su totalidad**, salvo esas 2 rutas sin backend y el resto
del bundle de `GET /api/dashboard` (staleness conocida desde la Fase
44). Nueva cobertura de test para las 10 rutas `analytics/*`
granulares (nunca la tuvieron — mismo criterio que la Fase 39 para
Proyectos): `analytics-granular.test.ts`. `kpis-executive.test.ts`
reescrito por completo; `kpis-team-range.test.ts` reescrito solo en
su mitad `GET /api/kpis/team` (la mitad `GET /api/kpis/me/range`,
cortada en la Fase 4c, queda sin tocar). Ningún modelo ni migración
nueva. `npx tsc --noEmit` limpio, `npm run lint` sin hallazgos
nuevos, suite completa de Vitest 94 archivos / 1192 tests en verde.
Sin cambios de backend — no requirió corrida de pytest. Ver
`docs/AUDIT_LOG.md` § 2026-08-24 (Fase 47) y `docs/ROADMAP.md` para
el resto del roadmap de la migración de stack)
**Autor:** Claude Code

---

**Actualización anterior:** 2026-08-24 (v1.105.0 — Migración de stack hacia
skelleton_base, Fase 46: cutover de Equipo. Continúa "Cutovers
pendientes". `GET /api/team/` + `GET /api/team/[userId]/tasks/`
redirigidos a Django (`TeamListView`/`TeamMemberTasksView`, Fase 18
del backend, completo) — cierra staleness (ambos leían Postgres,
desactualizado desde el cutover de Tareas). **Interdependencia
identificada y resuelta cortando ambos juntos, mismo patrón que la
Fase 42** (`users/assignable`+Reuniones): `TeamModule.tsx` encadena
el `id` de cada fila de `/api/team` como parámetro de
`/api/team/${id}/tasks` — cortar uno solo rompía esa llamada.
`team/[userId]/tasks` es un caso especial heredado de la Fase 3a
(Django solo exponía las tareas del propio usuario autenticado, no
las de un tercero, así que este endpoint nunca se migró en el cutover
de Tareas) — `TeamMemberTasksView` (backend) ya tenía ese mismo caso
resuelto, solo faltaba conectar el `route.ts`. Nuevo
`djangoTeamAdapter.ts`. Los 2 mensajes 403 distintos de
`team/[userId]/tasks` (permiso general vs. objetivo fuera de la
jerarquía) se preservaron con `extractDjangoFlatErrorMessage`. Ningún
modelo ni migración nueva. `npx tsc --noEmit` limpio, suite completa
de Vitest 1155/1155 en verde. Ver `docs/AUDIT_LOG.md` § 2026-08-24
(Fase 46) y `docs/ROADMAP.md` para el resto del roadmap de la
migración de stack)
**Autor:** Claude Code

---

**Actualización anterior:** 2026-08-24 (v1.104.0 — Migración de stack hacia
skelleton_base, Fase 45: cutover de Solicitudes LOPD. Continúa
"Cutovers pendientes" más allá de la lista original de la Fase 40 —
`apps.data_requests` (Fase 12 del backend) sin ninguna dependencia de
selector de usuarios, cutover autocontenido. `GET/POST
/api/data-requests/` + `PATCH /api/data-requests/[id]/` + `GET
/api/data-requests/my-data/` redirigidos a Django. **Hallazgo
clave:** `my-data` (exportación "acceso a mis datos" LOPD/GDPR) es
cualitativamente distinto de cualquier cutover anterior — es una
obligación legal, no un widget de UI. Agregaba Tareas/TaskActivity/
Comment/Meeting/ImprovementIdea/IdeaVote, los 6 YA escritos
exclusivamente en Django desde sus respectivos cutovers — la versión
Prisma exportaba, para una solicitud con valor legal real, datos cada
vez más incompletos. **Gap heredado del backend, preservado y
documentado, NO fabricado:** `apps.data_requests.services.export_my_data`
ya documentaba que `usuario` no incluye `theme`/`viewPreferences`/
`badges`/`dataConsentAccepted`/`dataConsentAcceptedAt` (sin
equivalente en el `User` de Django, gaps ya aceptados en las Fases
6b/11) — se decidió explícitamente NO complementar con una consulta a
Prisma aparte (introduciría su propia inconsistencia), prefiriendo
Tareas/Reuniones/Ideas completas y actuales sobre 5 campos
cosméticos. Nuevo `djangoDataRequestsAdapter.ts` con mapeo recursivo
completo del payload de exportación. Ningún modelo ni migración
nueva — el backend ya estaba completo. `npx tsc --noEmit` limpio,
suite completa de Vitest 1155/1155 en verde. Ver `docs/AUDIT_LOG.md`
§ 2026-08-24 (Fase 45) y `docs/ROADMAP.md` para el resto del roadmap
de la migración de stack)
**Autor:** Claude Code

---

**Actualización anterior:** 2026-08-21 (v1.103.0 — Migración de stack hacia
skelleton_base, Fase 44: cutover de Comunicados + corrige staleness de
Comunicados/Reuniones en `GET /api/dashboard`. Quinto y último
cutover apoyado en el puente de ids de la Fase 40, cerrando la lista
completa de esa fase (Notificaciones, `users/assignable`+Reuniones,
Ideas, Comunicados). `GET/POST /api/announcements/` + `DELETE
/api/announcements/[id]/` redirigidos a Django (Fase 25 del backend).
**Hallazgo clave al investigar el único consumidor real
(`DashboardModule.tsx`):** el widget de Comunicados nunca llama a
`GET /api/announcements` — lee el listado desde el BUNDLE agregado de
`GET /api/dashboard` (todavía en Postgres); `POST`/`DELETE` sí van a
Django pero el refresco posterior (`fetchData()`) vuelve a pedir ese
mismo bundle desactualizado. Cortar solo el CRUD sin arreglar el
bundle habría hecho que publicar/eliminar pareciera fallar
silenciosamente. Se corrigió esa sección del bundle, y de paso se
encontró (mismo archivo) la misma staleness en `upcomingMeetings`
(Reuniones cutover desde la Fase 42, nunca reflejado en el Dashboard)
— corregida en el mismo cambio. `AnnouncementListView._serialize`
(backend) ganó `author: {name, role}` (aditivo, con
`prefetch_related` nuevo para evitar un N+1). **El resto del bundle
de Dashboard (Tareas/Comentarios/Actividades/Proyectos) queda
explícitamente fuera de alcance** — combina datos crudos con motores
de cálculo (`computeCargaTiempo`/Analytics/Workload) todavía 100% TS,
un problema mucho más grande con su propia decisión de arquitectura
pendiente. `ruff check` limpio, suite de Django 1624/1624 en verde (1
test nuevo), `npx tsc --noEmit` limpio, suite de Vitest 1159/1159 en
verde. Ver `docs/AUDIT_LOG.md` § 2026-08-21 (Fase 44) y
`docs/ROADMAP.md` para el resto del roadmap de la migración de stack)
**Autor:** Claude Code

---

**Actualización anterior:** 2026-08-21 (v1.102.0 — Migración de stack hacia
skelleton_base, Fase 43: cutover de Mejora Continua / Ideas. Cuarto
cutover apoyado en el puente de ids de la Fase 40 — a diferencia de
Reuniones/`users/assignable` (Fase 42), Ideas no tiene ningún selector
manual de usuarios (autor siempre "yo mismo", revisores computados
por rol), así que no hubo interdependencia que coordinar. `GET/POST
/api/ideas/` + `GET/PATCH /api/ideas/[id]/` + `POST .../vote/` +
`PATCH .../status/` + `GET .../history/` redirigidos a Django
(`IdeaListCreateView`/`IdeaDetailView`/`IdeaVoteView`/`IdeaStatusView`/
`IdeaHistoryView`, completo desde la Fase 11 del backend — máquina de
estados, badge "innovador" (Fase 27) y notificación al autor (visible
en la campana desde la Fase 41) ya resueltos ahí). También se cortó
`mejora-continua/page.tsx`, que consultaba Prisma directamente para
el listado inicial (SSR) en vez de pasar por `/api/ideas` — mismo
patrón ya visto en `tasks/page.tsx` (Fase 3a); `currentUserId` pasa a
`session.djangoUserId` porque `IdeaCard`/`IdeasModule` comparan
`idea.author.id` (ahora numérico) para la vista "¿es mía?". Nuevo
`djangoIdeasAdapter.ts`. **Observación sin acción:**
`saveAttachment`/`AttachmentError` (`src/lib/storage.ts`) quedan sin
ningún caller — Ideas era su último consumidor, no se eliminó el
archivo (fuera de alcance). Ningún modelo ni migración nueva — el
backend ya estaba completo. `npx tsc --noEmit` limpio, suite completa
de Vitest 1160/1160 en verde. Queda **Comunicados (Announcements)**
como último candidato del puente de ids. Ver `docs/AUDIT_LOG.md` §
2026-08-21 (Fase 43) y `docs/ROADMAP.md` para el resto del roadmap de
la migración de stack)
**Autor:** Claude Code

---

**Actualización anterior:** 2026-08-21 (v1.101.0 — Migración de stack hacia
skelleton_base, Fase 42: cutover de `users/assignable` + Reuniones.
Cierra el bloqueo ORIGINAL que motivó la reconciliación de ids (Fase
37) — se cortó junto con Reuniones porque son interdependientes: el
selector de invitados de Reuniones consume `users/assignable`, así
que cortar uno sin el otro rompía el flujo de invitación en un
sentido u otro. Investigando los 4 consumidores reales de
`users/assignable` se encontraron **3 bugs activos preexistentes**,
todos por el mismo motivo (la lista devolvía el `cuid` de Postgres
donde el destino ya esperaba el id numérico de Django):
`RegularizeTargetTimeManager` (filtro de Tareas por colaborador),
`DashboardModule`→`TaskFormModal` (creación rápida de tarea desde el
Dashboard) e invitación a Reuniones — ninguno reportado como bug,
descubiertos leyendo el código de cada consumidor antes de decidir el
alcance. `GET/POST /api/meetings/` + `GET/PATCH/DELETE
/api/meetings/[id]/` redirigidos a `MeetingListCreateView`/
`MeetingDetailView` (Django, completo desde la Fase 10 del backend —
integración real de Zoom con fallback simulado, notificación a
invitados ya visible en la campana desde el cutover de la Fase 41).
Nuevo `djangoMeetingsAdapter.ts`. Ningún modelo ni migración nueva —
ambas superficies ya estaban completas. `npx tsc --noEmit` limpio,
suite completa de Vitest 1193/1193 en verde. Quedan Ideas y
Comunicados como candidatos del puente de ids de la Fase 40. Ver
`docs/AUDIT_LOG.md` § 2026-08-21 (Fase 42) y `docs/ROADMAP.md` para
el resto del roadmap de la migración de stack)
**Autor:** Claude Code

---

**Actualización anterior:** 2026-08-21 (v1.100.0 — Migración de stack hacia
skelleton_base, Fase 41: cutover de Notificaciones. Primer cutover
apoyado en el puente de ids de la Fase 40. `GET/PATCH
/api/notifications/` + `PATCH /api/notifications/[id]/` redirigidos a
Django (`NotificationListView`/`NotificationDetailView`, completos
desde la Fase 15) — cierra un bug de staleness activo: `notify()`/
`notify_many()` ya las escriben internamente Tareas (comentarios/
validaciones), Proyectos, Escritorio Digital, Reuniones, Ideas y
Solicitudes LOPD desde sus respectivos cutovers, pero la campana leía
Postgres y nunca mostraba ninguna. **Gap preexistente NO cerrado,
documentado para no sobre-prometer:** `TaskService.create_task`
(Django) todavía no notifica al asignar una tarea — gap heredado de
la Fase 3a, en `apps.tasks`, sin relación con este cutover de lectura.
`taskAssignedToId` pasa a ser el id numérico de Django —
`NotificationBell.tsx` necesitaba `session.djangoUserId` (no el
`cuid`) para su comparación "¿es mi tarea?"; se propagó un nuevo prop
`djangoUserId` por `(protected)/layout.tsx` → `AppShell` → `Topbar`.
`ThemeToggle`, en el mismo `Topbar`, sigue con el `cuid` sin cambios.
Ningún modelo ni migración nueva. `npx tsc --noEmit` limpio, suite
completa de Vitest 1193/1193 en verde. Ver `docs/AUDIT_LOG.md` §
2026-08-21 (Fase 41) y `docs/ROADMAP.md` para el resto del roadmap de
la migración de stack)
**Autor:** Claude Code

---

**Actualización anterior:** 2026-08-21 (v1.99.0 — Migración de stack hacia
skelleton_base, Fase 40: reconciliación de ids Postgres↔Django. El
usuario pidió arrancar explícitamente este trabajo tras una pregunta
exploratoria sobre qué falta para completar la migración — 3 fases
seguidas (`users/assignable`, `theme`, y los candidatos Reuniones/
Ideas/Comunicados) habían chocado con el mismo límite: `session.userId`
(Next.js) es el `cuid` de Postgres, Django identifica por su propio id
numérico. Se agregó `SessionPayload.djangoUserId?: number` (ADICIONAL
a `userId`, que sigue sin tocarse — reemplazarlo rompería todo módulo
todavía no cutover contra Prisma), poblado en login
(`auth/login/route.ts`) y en la renovación de perfil (`auth/me/route.ts`
`PATCH`) — ambos ya tenían `me.id` de Django sin usarlo. Nuevo
`resolveDjangoUserId(session)` (`djangoSession.ts`) con fallback a
`GET /auth/me/` para sesiones emitidas antes de esta fase (sin forzar
re-login). `users/[id]/theme/route.ts` (Fase 38) refactorizado para
usar el helper en vez de su workaround inline. **Es infraestructura
pura — no cutover de ningún módulo nuevo todavía**, pero desbloquea
Reuniones/Ideas/Comunicados/Notificaciones/`users/assignable`, los 5
candidatos frenados por este mismo motivo. Sin cambios de backend.
`npx tsc --noEmit` limpio, suite completa de Vitest 1192/1192 en
verde. Ver `docs/AUDIT_LOG.md` § 2026-08-21 (Fase 40) y
`docs/ROADMAP.md` para el resto del roadmap de la migración de stack)
**Autor:** Claude Code

---

**Actualización anterior:** 2026-08-21 (v1.98.0 — Migración de stack hacia
skelleton_base, Fase 39: cutover de la Papelera de Proyectos. Cierra
un bug ACTIVO, REAL, en producción desde el 2026-08-14 (Fase 5f) — el
propio comentario del código ya advertía que `DELETE
/api/projects/[id]/` (mover a la papelera) seguiría en Postgres
mientras el resto de Proyectos ya era Django, y que cualquier
proyecto creado después recibiría 404 al intentar enviarlo a la
papelera. `ProjectViewSet.destroy`/`trash`/`restore`/`permanent`
(Django, completo desde la Fase 14) ya existían — se redirigieron los
4 `route.ts` (`[id]/route.ts` DELETE, `trash/route.ts`,
`[id]/restore/route.ts`, `[id]/permanent/route.ts`), sin ningún
cambio de backend. Contrato de error mixto identificado: `destroy`
usa 403/404 automáticos de DRF (mensajes estáticos, sin extracción);
`restore`/`permanent` construyen su error a mano (contrato plano) —
se usó `extractDjangoFlatErrorMessage` (Fase 36), no
`extractDjangoProjectErrorMessage` (contrato anidado, habría perdido
el mensaje real). Nuevo `projects-trash.test.ts` (18 tests) — primera
cobertura de test para cualquier ruta de Proyectos (el resto del
módulo, cutover en sesiones previas, no tenía ninguna). Ningún modelo
ni migración nueva. `npx tsc --noEmit` limpio, suite completa de
Vitest 1191/1191 en verde. Ver `docs/AUDIT_LOG.md` § 2026-08-21 (Fase
39) y `docs/ROADMAP.md` para el resto del roadmap de la migración de
stack)
**Autor:** Claude Code

---

**Actualización anterior:** 2026-08-21 (v1.97.0 — Migración de stack hacia
skelleton_base, Fase 38: cutover de `PATCH /api/users/[id]/theme` +
tema inicial de `layout.tsx`. Cierra el gap dejado explícitamente por
la Fase 37: `UserThemeView` (Django) exige `pk == request.user.id`
(numérico), mientras `session.userId` (Next.js) sigue siendo el
`cuid` de Postgres (Fase 6a) — se agregó `theme` (nuevo) a
`UserPublicSerializer` (que ya incluía `id` sin usarlo del lado
Next.js) y el `route.ts` de `theme` ahora resuelve el id numérico vía
`GET /auth/me/` antes de llamar a Django. **A diferencia de toda fase
anterior de este cutover, acá NO había un bug preexistente que
cerrar** — lectura (`layout.tsx`) y escritura estaban ambas en
Postgres y coincidían; se cortaron JUNTAS en el mismo cambio
precisamente para no introducir un bug de staleness nuevo. Ningún
modelo ni migración nueva — 1 campo agregado a un serializer
existente. `ruff check` limpio, suite de Django 1623/1623 en verde
(1 test nuevo), `npx tsc --noEmit` limpio, suite de Vitest 1173/1173
en verde. **Diferido:** `users/assignable`/`view-preferences` (mismos
motivos que la Fase 37/36). Ver `docs/AUDIT_LOG.md` § 2026-08-21
(Fase 38) y `docs/ROADMAP.md` para el resto del roadmap de la
migración de stack)
**Autor:** Claude Code

---

**Actualización anterior:** 2026-08-21 (v1.96.0 — Migración de stack hacia
skelleton_base, Fase 37: cutover de `profile/badges` y
`activities/day-schedule`. Ambos endpoints de auto-servicio "yo
mismo" (identificados por JWT, sin id de otro usuario ni campo
compartido con otro módulo) redirigidos a Django — sus 3 insumos
(Tareas/Comentarios/Actividades) ya eran 100% Django desde el
cutover de Tareas, así que la versión Prisma calculaba insignias y
validaba solapamientos de horario sobre datos desactualizados
(**2 bugs activos preexistentes cerrados**). `compute_and_persist_badges`
(Fase 27)/`DayScheduleView` (Fase 26) ya devuelven JSON en camelCase
idéntico al contrato TS — el `route.ts` queda como reenvío directo,
sin mapeo de campos. **Diferido explícitamente:**
`users/assignable`/`users/[id]/theme`/`view-preferences` — requieren
reconciliar el `cuid` de Postgres (`session.userId`) con el id
numérico de Django (`request.user.id`) antes de poder cortarse sin
romper comparaciones de identidad en otros módulos — gap ya
documentado desde la Fase 3a en `tasks/page.tsx`, sin programar
todavía. Ningún modelo ni migración nueva. `npx tsc --noEmit`
limpio, suite completa de Vitest 1171/1171 en verde. Ver
`docs/AUDIT_LOG.md` § 2026-08-21 (Fase 37) y `docs/ROADMAP.md` para
el resto del roadmap de la migración de stack)
**Autor:** Claude Code

---

**Actualización anterior:** 2026-08-21 (v1.95.0 — Migración de stack hacia
skelleton_base, Fase 36: primer cutover de `route.ts` del catálogo
`settings/*`. Tras el descubrimiento de 57 archivos ya cutover de
sesiones previas (sin commitear), se auditó consumidor real por
CAMPO (no por endpoint) antes de cortar cualquiera — cortar el lado
admin de una config cuyo consumidor real sigue en Prisma la dejaría
sin ningún efecto pese a devolver 200. **9 de 24 endpoints
redirigidos a Django:** `activity-reasons` POST/PATCH,
`login-attempts/cleanup`, `escritorio-digital-config`,
`snooze-presets`, `retroactive-window`, `data-quality` (completos);
`seguridad-config`/`trabajo-avanzado` (**parciales campo por
campo** — `passwordMinLength`/`workdayEndHour` siguen en Postgres,
su consumidor real todavía es TS). Cierra 2 bugs activos
preexistentes (alta/edición de motivos de actividad y configuración
de Escritorio Digital sin efecto real desde Ajustes). Nuevo
`extractDjangoFlatErrorMessage` en `djangoSession.ts` (contrato de
error plano `{"error": "mensaje"}` de `apps.configuration`, distinto
del anidado de `apps.core.exceptions`). 15 endpoints restantes
diferidos deliberadamente (consumidor real en Analytics/Predictive/
Dashboard sin cutover, o almacenamiento compartido con otro módulo
sin cortar — `favorites`/`documentation`/`config-history`/
`system-info`). Ningún modelo ni migración nueva. Tests reescritos
para mockear `djangoApiFetch` en vez de Prisma — `npx tsc --noEmit`
limpio, suite completa de Vitest 1172/1172 en verde. Ver
`docs/AUDIT_LOG.md` § 2026-08-21 (Fase 36) y `docs/ROADMAP.md` para
el resto del roadmap de la migración de stack)
**Autor:** Claude Code

---

**Actualización anterior:** 2026-08-21 (v1.94.0 — Migración de stack hacia
skelleton_base, Fase 35: Centro de Configuración, `notification-rules`.
`GET/PUT /api/v1/settings/notification-rules/` — reglas de
notificación configurables (`comment_targets`/`first_comment_role`/
`retroactive_notify_roles`), los 3 campos siempre obligatorios en el
`PUT`. Los defaults coinciden exactamente con el comportamiento
hardcodeado actual (`RoleNotificationTarget`/`RETROACTIVE_NOTIFY_ROLES`)
— **GAP DOCUMENTADO: solo se porta la configuración**,
`CommentService.create_comment`/`RETROACTIVE_NOTIFY_ROLES`
(`apps/tasks/services.py`) siguen sin reconectarse, mismo criterio
que `password_min_length` (Fase 32). `get_effective_notification_rules`
no recibe `as_of` (única excepción del catálogo, réplica fiel del
TS). **Con esta entrega, el catálogo `settings/*` queda cerrado en su
totalidad** salvo `retention-policy/purge`. **Sin cutover de
`route.ts`.** Sin migraciones nuevas. 12 tests nuevos — 1622 pasando
en total. Ver `docs/AUDIT_LOG.md` § 2026-08-21 (Fase 35) y
`docs/ROADMAP.md` para el resto del roadmap de la migración de stack)
**Autor:** Claude Code

---

**Actualización anterior:** 2026-08-21 (v1.93.0 — Migración de stack hacia
skelleton_base, Fase 34: Centro de Configuración, informe de calidad
del dato + 2 rutas más. `GET /api/v1/settings/data-quality/`
(`build_data_quality_report`, nuevo `apps/configuration/data_quality.py`,
7 chequeos de consistencia — cero modelo nuevo pese a las ~256 líneas
TS), `GET/PUT /api/v1/settings/nova-cache/` (solo configuración),
`GET /api/v1/reports/executive/closure-status/` (en `apps.reports`,
descubierto en un barrido completo fuera de `settings/*`;
`users/[id]/reset-password` revisado en el mismo barrido y confirmado
ya cortado a Django desde la Fase 2). **Con esta entrega, el catálogo
`settings/*` queda 100% cerrado** salvo `notification-rules`/
`retention-policy/purge`. **Sin cutover de `route.ts`.** Sin
migraciones nuevas. 27 tests nuevos — 1610 pasando en total. Ver
`docs/AUDIT_LOG.md` § 2026-08-21 (Fase 34) y `docs/ROADMAP.md` para
el resto del roadmap de la migración de stack)
**Autor:** Claude Code

---

**Actualización anterior:** 2026-08-21 (v1.92.0 — Migración de stack hacia
skelleton_base, Fase 33: Centro de Configuración, 4 endpoints más.
`GET /api/v1/settings/config-history/` + `POST
/api/v1/settings/config-history/restore-default/` (sobre
`SystemConfigHistory`, Fase 3d), `GET /api/v1/settings/documentation/`
(lee Markdown de `docs/`, whitelist fija), `GET/POST
/api/v1/settings/login-attempts/cleanup/` (en `apps.authentication`,
dueña de `LoginAttempt` — réplica ADAPTADA: el modelo Django es un
log por evento sin estado de bloqueo propio, a diferencia del
contador agregado por IP del TS; el criterio de purga se simplifica a
"más antiguo que la retención configurada"). **Con esta entrega, el
catálogo `settings/*` queda esencialmente cerrado** — solo restan
`data-quality`/`notification-rules`/`retention-policy/purge`, ya
evaluados y descartados en fases previas. **Sin cutover de
`route.ts`.** Sin migraciones nuevas. 18 tests nuevos — 1583 pasando
en total. Ver `docs/AUDIT_LOG.md` § 2026-08-21 (Fase 33) y
`docs/ROADMAP.md` para el resto del roadmap de la migración de stack)
**Autor:** Claude Code

---

**Actualización anterior:** 2026-08-21 (v1.91.0 — Migración de stack hacia
skelleton_base, Fase 32: Centro de Configuración, 4 endpoints más.
`GET/PATCH /api/v1/settings/normalization-curves/` (6 curvas del
motor de Analytics, nuevo `set_curve_config`, backing ya existente
desde la Fase 4d), `GET/PUT /api/v1/settings/seguridad-config/`
(longitud mínima de contraseña + retención de intentos de login,
claves nuevas; duración de sesión ya existente desde la Fase 6a — gap
documentado: `password_min_length` no se enforce todavía en el cambio
de contraseña de Django), `GET/PUT /api/v1/settings/trabajo-avanzado/`
(ventana retroactiva + hora de corte de jornada, backing 100%
preexistente), `GET /api/v1/settings/system-info/` (versión +
conteos). `notification-rules` queda fuera — requiere un cambio de
comportamiento real (`RETROACTIVE_NOTIFY_ROLES` hardcodeado), no solo
una superficie de configuración. **Sin cutover de `route.ts`.** Sin
migraciones nuevas. 22 tests nuevos — 1565 pasando en total. Ver
`docs/AUDIT_LOG.md` § 2026-08-21 (Fase 32) y `docs/ROADMAP.md` para
el resto del roadmap de la migración de stack)
**Autor:** Claude Code

---

**Actualización anterior:** 2026-08-21 (v1.90.0 — Migración de stack hacia
skelleton_base, Fase 31: Centro de Configuración, 5 endpoints más.
`GET/PUT /api/v1/settings/workload-config/` (horas efectivas + 3
límites de carga, validado manualmente por depender de valores YA
vigentes), `GET/PATCH /api/v1/settings/kpi-start-date/`
(`User.kpi_start_date`, ya existente desde la Fase 4a), `GET/PUT
/api/v1/settings/retention-policy/` (solo la política — la purga real
requiere modelos no portados y queda deferida), `GET/PUT
/api/v1/settings/escritorio-digital-config/` (nuevo
`set_snooze_presets_minutes` — la Fase 28 lo había dejado sin
escritura por falta de consumidor real; esta ruta sí lo expone),
`GET/PATCH /api/v1/settings/analytics-config/` (26 claves, nuevo
`set_analytics_config_value`, validado manualmente: 3 sumas de
ponderación + orden de umbrales). Backing 100% preexistente en 4 de
las 5 rutas. Todas ADMINISTRADOR salvo `analytics-config` (whitelist
de 3 roles). **Sin cutover de `route.ts`.** Sin migraciones nuevas. 39
tests nuevos — 1543 pasando en total. Ver `docs/AUDIT_LOG.md` §
2026-08-21 (Fase 31) y `docs/ROADMAP.md` para el resto del roadmap de
la migración de stack)
**Autor:** Claude Code

---

**Actualización anterior:** 2026-08-21 (v1.89.0 — Migración de stack hacia
skelleton_base, Fase 30: Centro de Configuración, CRUD de Motivos de
Actividad. Cierra `activity-reasons`, deferido de la Fase 29. `POST
/api/v1/settings/activity-reasons/` (`ActivityReasonCreateView`) —
genera `key` única vía `_slugify_activity_reason_key` (réplica exacta
de `slugifyKey`: NFD sin diacríticos, mayúsculas, no-alfanumérico→`_`,
`"MOTIVO"` si vacío, sufijo numérico en colisión). `PATCH
/api/v1/settings/activity-reasons/<id>/` (`ActivityReasonUpdateView`)
— actualización parcial; archivar fuerza `is_active=False`, restaurar
NO reactiva automáticamente (asimetría fiel del TS). Ambas solo
ADMINISTRADOR. `description` se persiste como cadena vacía, no `None`
(el campo Django nunca fue nullable, a diferencia del `String?` de
Prisma). `ActivityReason` ya existía completo desde la Fase 3b — cero
motor nuevo, cero migraciones. **Sin cutover de `route.ts`.** 17
tests nuevos — 1504 pasando en total. Ver `docs/AUDIT_LOG.md` §
2026-08-21 (Fase 30) y `docs/ROADMAP.md` para el resto del roadmap de
la migración de stack)
**Autor:** Claude Code

---

**Actualización anterior:** 2026-08-20 (v1.88.0 — Migración de stack hacia
skelleton_base, Fase 29: Centro de Configuración, CRUD de Feriados/
Permisos/Estados Especiales. Cierra la superficie HTTP de
`Holiday`/`LeaveRecord`/`SpecialStatus` (modelos ya existentes desde
la Fase 4a, "tabla interna sin endpoint HTTP, gestionada vía Django
Admin"). `GET/POST /api/v1/settings/holidays/` + `DELETE .../<id>/`;
`GET/POST /api/v1/settings/leave-records/` + `DELETE .../<id>/` (crea
UN registro por cada día laborable del rango, nunca uno por todo el
período, reutilizando `is_working_day`/`get_holiday_set` ya
portados); `GET/POST /api/v1/settings/special-status/` +
`PATCH/DELETE .../<id>/` (`PATCH` finaliza el estado hoy, nunca lo
extiende) — las 3 rutas 100% ADMINISTRADOR. `activity-reasons`
(mismo perfil, prefijo distinto) queda para una fase futura. **Sin
cutover de `route.ts`.** Sin migraciones nuevas. 44 tests nuevos —
1487 pasando en total. Ver `docs/AUDIT_LOG.md` § 2026-08-20 (Fase 29)
y `docs/ROADMAP.md` para el resto del roadmap de la migración de
stack)
**Autor:** Claude Code

---

**Actualización anterior:** 2026-08-20 (v1.87.0 — Migración de stack hacia
skelleton_base, Fase 28: Centro de Configuración, 6 endpoints de bajo
riesgo. Continúa el "arranque acotado" de la Fase 13: `GET
/api/v1/settings/retroactive-window/` (reutiliza
`get_effective_retroactive_window_days`, Fase 3f), `GET
/api/v1/settings/snooze-presets/` (nuevo `get_effective_snooze_presets_minutes`,
solo lectura — el TS no expone el setter en ningún `route.ts`),
`GET/PATCH /api/v1/settings/favorites/` (reutiliza
`User.view_preferences` con el prefijo `CONFIG_FAVORITE:`, mismo
truco que `card-order` de la Fase 25), `GET/PUT /api/v1/settings/
welcome-message/` (el `GET` ya tenía backing desde la Fase 25),
`GET/PATCH /api/v1/settings/role-targets/` y `GET/PATCH
/api/v1/settings/role-compatibility/` (bulk sobre
`get_effective_role_target`/`get_effective_role_compatibility` de las
Fases 22/24, con la Regla 4 dura validada en la vista).
`ROLE_LABEL`/`ALL_ROLES` centralizados en `apps.hierarchy.services`
(mismo criterio que `ROLE_LEVEL`, Fase 9b) — `apps.tasks.services`
tenía la única copia hasta ahora. **Sin cutover de `route.ts`.** Sin
migraciones nuevas. 36 tests nuevos — 1443 pasando en total. Ver
`docs/AUDIT_LOG.md` § 2026-08-20 (Fase 28) y `docs/ROADMAP.md` para el
resto del roadmap de la migración de stack)
**Autor:** Claude Code

---

**Actualización anterior:** 2026-08-20 (v1.86.0 — Migración de stack hacia
skelleton_base, Fase 27: Gamificación de perfil. `GET /api/v1/profile/
badges/` (`BadgesView` + `compute_and_persist_badges`, nuevo
`apps/users/badges.py`) — calcula 6 insignias
(Cumplidor/Confiable/Colaborador/Innovador/Constante/Mentor) sobre
Tareas/Comentarios/Actividades ya portados, persiste en `User.badges`
las recién ganadas. Cierra de paso el gap del badge "innovador" en
`apps.ideas` documentado desde la Fase 11 (`change_idea_status` ahora
lo asigna al autor cuando una idea llega a IMPLEMENTADA — el campo
`User.badges` recién existe desde la Fase 25). Cero motor nuevo. **Sin
cutover de `route.ts`.** Sin migraciones nuevas. 25 tests nuevos —
1407 pasando en total. Ver `docs/AUDIT_LOG.md` § 2026-08-20 (Fase 27)
y `docs/ROADMAP.md` para el resto del roadmap de la migración de
stack)
**Autor:** Claude Code

---

**Actualización anterior:** 2026-08-20 (v1.85.0 — Migración de stack hacia
skelleton_base, Fase 26: cabos sueltos de auto-servicio. Barrido
completo de `src/app/api/**/route.ts` confirmó que `repository`/
`repository/<year>/<month>` y `auth/reset-password` YA estaban
cortados a Django (Fases 3d/6c) — se excluyen del alcance. Portó las 3
rutas pequeñas restantes sin motor propio: `GET /api/v1/users/
assignable/` (usuarios visibles, incluye al propio actor), `PATCH
/api/v1/users/<id>/theme/` (nuevo `User.theme`, mismo gap documentado
desde la Fase 12 que `badges`/`view_preferences` de la Fase 25) —
ambas en `apps/users/self_service_views.py` nuevo, deliberadamente
separado de `UserAdminViewSet` (`admin/users/`, administración vs.
auto-servicio) — y `GET /api/v1/activities/day-schedule/`
(`DayScheduleView`, en `apps.tasks`, reutiliza `business_time.py` ya
portado desde la Fase 3b). **Sin cutover de `route.ts`.** 1 migración
nueva (`users.0006_user_theme`). 15 tests nuevos — 1382 pasando en
total. Ver `docs/AUDIT_LOG.md` § 2026-08-20 (Fase 26) y
`docs/ROADMAP.md` para el resto del roadmap de la migración de stack)
**Autor:** Claude Code

---

**Actualización anterior:** 2026-08-20 (v1.84.0 — Migración de stack hacia
skelleton_base, Fase 25: Dashboard. Primer módulo de negocio nuevo
desde Equipo (Fase 18) que no es una ruta delgada de Analytics. `GET
/api/v1/dashboard/` (`DashboardView` + `build_dashboard_payload`) —
réplica exacta de `src/app/api/dashboard/route.ts` (~320 líneas):
tareas prioritarias, estadísticas por período, % de carga/cumplimiento
(motor central), feed de actividad del área, alertas de equipo,
comunicados, próximas reuniones, proyectos propios, mensaje de
bienvenida — 100% ensamblado sobre motor ya portado. `PATCH
/api/v1/dashboard/card-order/` — orden de tarjetas. Gap real
descubierto: `Announcement` (Prisma) no tenía equivalente Django — se
portó completo como `apps.announcements` nuevo (modelo + GET/POST/
DELETE). `User.badges`/`User.view_preferences` (campos nuevos) cierran
gaps documentados desde la Fase 12; `User.lastLoginAt` se replica
reutilizando `last_login` nativo de `AbstractUser` (nunca escrito en
ninguno de los 2 sistemas). `nova-message` (Nova/Groq) queda
explícitamente fuera de alcance. **Sin cutover de `route.ts`.** 2
migraciones nuevas. 34 tests nuevos — 1367 pasando en total. Ver
`docs/AUDIT_LOG.md` § 2026-08-20 (Fase 25) y `docs/ROADMAP.md` para el
resto del roadmap de la migración de stack)
**Autor:** Claude Code

---

**Actualización anterior:** 2026-08-20 (v1.83.0 — Migración de stack hacia
skelleton_base, Fase 24: Analytics, `recommendations/team`. Cierra el
Motor Determinista de Recomendaciones (Compatibilidad Organizacional).
`GET /api/v1/analytics/recommendations/team/` (`TeamRecommendationsView`
+ `compute_team_recommendations`) — redistribución de carga con
impacto cuantificado entre subordinados ejecutores, 5 reglas de
negocio (mismo cargo primero, Matriz de Compatibilidad Operativa como
respaldo, nunca redistribución vertical — filtro absoluto por
`ROLE_LEVEL`, tope de 5 sobrecargados evaluados, mensaje explícito sin
candidato). Nuevo `get_effective_role_compatibility`
(`apps/configuration/services.py`, mismo mecanismo JSON que
`get_effective_role_target`, Fase 22). Reutiliza
`compute_team_capacity_forecast` (Fase 9b),
`classify_capacity`/`capacity_to_score` (Fase 4f/4g) y
`prioritize_recommendations` (Fase 4k, `insights_engine.py` — sin
consumidor HTTP hasta ahora, su forma ya coincidía exactamente con
`TeamRecommendation`). Con esta entrega, 13 de las ~16 rutas delgadas
de Analytics quedan cerradas — resta únicamente `diagnostics`. **Sin
cutover de `route.ts`.** Sin migraciones nuevas. 23 tests nuevos —
1337 pasando en total. Ver `docs/AUDIT_LOG.md` § 2026-08-20 (Fase 24)
y `docs/ROADMAP.md` para el resto del roadmap de la migración de
stack)
**Autor:** Claude Code

---

**Actualización anterior:** 2026-08-20 (v1.82.0 — Migración de stack hacia
skelleton_base, Fase 23: Analytics, simulador KPI-level. Cierra
`analytics/simulate/[userId]`, el simulador interactivo MÁS ANTIGUO de
Analytics (§9, ampliado en Sprint A) — 8 escenarios que nunca
persisten nada. `POST /api/v1/analytics/simulate/<user_id>/`
(`SimulateKpiView` + `simulate_kpi_scenario`, nuevo módulo
`apps.analytics.kpi_simulate` — separado de `simulate_engine.py`,
Fase 9c, un simulador DISTINTO sobre predicciones, para no confundir
dos dominios con el mismo nombre coloquial). Cero lógica de negocio
nueva — reutiliza `compute_health_score`/`compute_performance_score`/
`compute_capacity_forecast`/`classify_capacity` (que ya anticipaba
este puerto en su propio docstring desde la Fase 4f)/
`capacity_to_score`/`carga_health_score`/`weighted_points`/`normalize`/
`compute_workload_range`/`compute_carga_tiempo`/`monthly_business_base`.
Validación de escenario manual (`is_valid_scenario`, unión
discriminada por `type` con 8 formas de cuerpo), primer caso de este
patrón en el proyecto — no un `Serializer` DRF. Con esta entrega, 12
de las ~16 rutas delgadas de Analytics quedan cerradas — restan
`diagnostics` y `recommendations/team`. **Sin cutover de `route.ts`.**
Sin migraciones nuevas. 44 tests nuevos — 1314 pasando en total. Ver
`docs/AUDIT_LOG.md` § 2026-08-20 (Fase 23) y `docs/ROADMAP.md` para el
resto del roadmap de la migración de stack)

---

**Actualización anterior:** 2026-08-20 (v1.81.0 — Migración de stack hacia
skelleton_base, Fase 22: Analytics, Benchmarks Inteligente. Cierra el
mayor de los 4 casos de Analytics que requerían motor nuevo (Sprint
7). `GET /api/v1/analytics/benchmarks/<user_id>/` (`BenchmarkView`) —
3 modos automáticos por indicador (`cargo` ≥3 pares, `cargo-limitado`
2, `personal` 0-1 contra el propio historial + objetivo del cargo).
Nuevo módulo `apps.analytics.benchmark` — `compute_smart_benchmark`/
`compute_personal_evolution`, reutilizando `get_factor_audit_history`/
`closest_factor_point` (Fase 4j/9) y `compute_monthly_history`/
`compute_weekly_history` (Fase 4a-4b) ya portadas — investigación
previa confirmó cero gap de motor real pese al tamaño (~350 líneas
TS). Nuevo `get_effective_role_target` (`apps/configuration/services.py`,
JSON en `SystemConfigHistory`, mismo mecanismo que curvas de
normalización — solo lectura, sin endpoint HTTP) y
`reliability_pct_from_observations` (`explain.py`, deferida desde la
Fase 16). Nunca cruza cargos distintos aunque compartan `ROLE_LEVEL`.
Con esta entrega, 11 de las ~16 rutas delgadas de Analytics quedan
cerradas — restan `simulate` KPI-level, `diagnostics` y
`recommendations/team`. **Sin cutover de `route.ts`.** Sin migraciones
nuevas. 32 tests nuevos — 1270 pasando en total. Ver
`docs/AUDIT_LOG.md` § 2026-08-20 (Fase 22) y `docs/ROADMAP.md` para el
resto del roadmap de la migración de stack)

---

**Actualización anterior:** 2026-08-20 (v1.80.0 — Migración de stack hacia
skelleton_base, Fase 21: Analytics, `kpis/executive`. Cierra el
dashboard ejecutivo, la ruta delgada de Analytics deferida más grande
(~326 líneas TS), confirmando que no requería motor nuevo. `GET
/api/v1/kpis/executive/` (`ExecutiveDashboardView` +
`build_executive_dashboard_payload`) — snapshot de 6 meses de los
subordinados ejecutores, ranking con tendencia mes a mes, alertas de
cumplimiento/sobrecarga, ideas pendientes (`apps.ideas`) y bloque
"CEO" (Performance Score/Riesgo Operativo promedio, nunca mezclados —
Sprint 5 § S5-K; estado global; heurísticas de "cambios"/"atender").
Cero lógica de negocio nueva — 100% ensamblado sobre motor ya portado
en las Fases 4a-4h/9b/19. Gateado por `is_leadership`
(`ROLE_LEVEL>=3`), distinto del filtro `isExecutorRole`
(`ROLE_LEVEL>=4`) aplicado a los sujetos del dashboard. Imports de
`operational_risk`/`performance_score` diferidos dentro de la función
para evitar un ciclo circular real con `history.py`. Con esta entrega,
10 de las ~16 rutas delgadas de Analytics quedan cerradas — restan
Benchmarks, `simulate` KPI-level, `diagnostics` y
`recommendations/team` (motor nuevo o instrumentación ausente en los 4
casos). **Sin cutover de `route.ts`.** Sin migraciones nuevas. 6 tests
nuevos — 1238 pasando en total. Ver `docs/AUDIT_LOG.md` § 2026-08-20
(Fase 21) y `docs/ROADMAP.md` para el resto del roadmap de la
migración de stack)

---

**Actualización anterior:** 2026-08-20 (v1.79.0 — Migración de stack hacia
skelleton_base, Fase 20: Analytics, `operational-risk/team`. Cierra la
ruta de Riesgo Operativo de equipo deferida desde la Fase 17/19 por su
efecto lateral de notificación automática. `GET /api/v1/analytics/
operational-risk/team/` (`TeamOperationalRiskView`), reutiliza
`compute_operational_risk` por subordinado ejecutor. Nuevo
`notify_if_high_risk` (`apps/analytics/services.py`) — notifica una
vez por persona/mes al superior directo cuando el riesgo es Alto/
Crítico, usando `get_notification_target_groups` (ya portado desde la
Fase 1). Nuevo campo `Notification.dedup_key` (migración, primer campo
agregado a `Notification` desde su creación en la Fase 3f) — el
marcador de texto libre que el TS mete en `taskId` no es portable al
`task_id` entero real de Django. Usa el conjunto de destinos POR
DEFECTO — el override configurable de Ajustes → Reglas de
Notificación queda como gap documentado. `recommendations/team` fuera
de alcance (requiere `computeTeamRecommendations`, motor de ~100
líneas + Matriz de Compatibilidad Operativa, no portado). **Sin
cutover de `route.ts`.** 13 tests nuevos — 1232 pasando en total. Ver
`docs/AUDIT_LOG.md` § 2026-08-20 (Fase 20) y `docs/ROADMAP.md` para el
resto del roadmap de la migración de stack)

---

**Actualización anterior:** 2026-08-20 (v1.78.0 — Migración de stack hacia
skelleton_base, Fase 19: Analytics, `kpis/team` + `kpis/team-capacity`.
Cierra 2 de las 3 rutas de Analytics de equipo deferidas en la Fase
18. Nuevo `is_executor_group`/`get_subordinate_executor_groups`
(`apps/hierarchy/services.py`, `ROLE_LEVEL>=4`) — réplica de
`isLeadershipRole`/`isExecutorRole` (Sprint 0A), concepto
DELIBERADAMENTE distinto de `is_leadership` ya existente
(`ROLE_LEVEL>=3`, usado para visibilidad de proyectos): mismo nombre
conceptual, umbral y uso diferentes, verificado con un test dedicado
que confirma que JEFE_NACIONAL aparece en uno pero no en el otro para
el mismo actor. `GET /api/v1/kpis/team-capacity/` (`TeamCapacityView`,
reutiliza `compute_team_capacity_forecast`) y `GET /api/v1/kpis/team/
?month=YYYY-MM` (`TeamKpiView`, snapshot mensual de score/
cumplimiento/carga/capacidad por subordinado ejecutor) — ambas 100%
ensamblado sobre motor ya portado. `kpis/executive` queda deferida
(~326 líneas TS, tendencia de 6 meses + bloque "CEO" — motor de
síntesis propio sustancialmente mayor). **Sin cutover de `route.ts`.**
Sin migraciones nuevas. 14 tests nuevos — 1219 pasando en total. Ver
`docs/AUDIT_LOG.md` § 2026-08-20 (Fase 19) y `docs/ROADMAP.md` para el
resto del roadmap de la migración de stack)

---

**Actualización anterior:** 2026-08-20 (v1.77.0 — Migración de stack hacia
skelleton_base, Fase 18: Equipo. Primer módulo de negocio nuevo desde
Notificaciones (Fase 15), sin dependencia del motor de Analytics —
nueva app `apps.team` sin modelos propios (consultas puras sobre
`Task`/`User`, mismo patrón que `apps.roles`): `GET /api/v1/team/`
(`TeamListView`, lista de subordinados + conteo de tareas por estado +
email enmascarado) y `GET /api/v1/team/<user_id>/tasks/`
(`TeamMemberTasksView`, tareas activas de un subordinado puntual —
nunca migrada en el cutover de Tareas Fase 3a porque Django solo
expone tareas del propio usuario autenticado). Nuevo `mask_email`
(`apps/core/mask_email.py`, puerto de `maskEmail`). Asimetría de
enmascarado entre las 2 rutas replicada fiel al TS (`GET /team/`
enmascara, `GET /team/<id>/tasks/` no). Hallazgo documentado, fuera de
alcance: `apps.projects` (ya en producción desde la Fase 5) nunca
enmascara emails pese a que el TS lo hace ahí — gap real detectado,
no corregido en esta fase. `kpis/team`/`kpis/team-capacity`/`kpis/
executive` quedan deferidas — requieren un concepto de permiso nuevo
(`isExecutorRole`, `ROLE_LEVEL>=4`, distinto de `is_leadership`
existente en Django, `ROLE_LEVEL>=3`). **Sin cutover de `route.ts`.**
Sin migraciones nuevas. 17 tests nuevos — 1205 pasando en total. Ver
`docs/AUDIT_LOG.md` § 2026-08-20 (Fase 18) y `docs/ROADMAP.md` para el
resto del roadmap de la migración de stack)

---

**Actualización anterior:** 2026-08-20 (v1.76.0 — Migración de stack hacia
skelleton_base, Fase 17: Analytics, 3 rutas delgadas más. Continúa el
cierre de rutas delgadas de la Fase 16: `GET /api/v1/analytics/
history/<user_id>/` (`HistoryView`, histórico de evolución vía
`get_score_series`, ya portada desde Fase 4j/9), `GET /api/v1/
analytics/target-time/<user_id>/` (`TargetTimePrecisionView`,
`compute_target_time_precision`, ya portada desde Fase 4d) y `GET
/api/v1/analytics/data-quality/?scope=self|team` (`DataQualityView`,
reutiliza `get_team_members`/`can_view_team` ya usados por
Inteligencia Preventiva) — las 3 son 100% ensamblado sobre motor YA
portado, cero lógica de negocio nueva. Deferidos con motivo
documentado: `diagnostics` (depende de instrumentación de proceso —
contadores de caché/validaciones — nunca portada a Django) y
`simulate/<user_id>` KPI-level (simulador de 8 escenarios, motor
sustancial nuevo, no una ruta delgada — mismo criterio que separó
Benchmarks en la Fase 16). **Sin cutover de `route.ts`.** Sin
migraciones nuevas. 14 tests nuevos — 1188 pasando en total. Ver
`docs/AUDIT_LOG.md` § 2026-08-20 (Fase 17) y `docs/ROADMAP.md` para el
resto del roadmap de la migración de stack)

---

**Actualización anterior:** 2026-08-20 (v1.75.0 — Migración de stack hacia
skelleton_base, Fase 16: Analytics, 3 rutas delgadas individuales.
Primeras 3 de las 16 rutas delgadas de Analytics identificadas
(revisado hacia arriba de la estimación original "~10"):
`GET /api/v1/analytics/insights/<user_id>/` (`InsightsView`, Motor de
Insights/Decision Intelligence Engine completo), `GET /api/v1/
analytics/equilibrio/<user_id>/` (`EquilibrioView`, interpretación de
Equilibrio Operativo) y `GET /api/v1/analytics/operational-risk/
<user_id>/` (`OperationalRiskView`, Riesgo Operativo + confianza/
tendencia). Las 3 son 100% ensamblado HTTP sobre motor YA portado
(`insights_engine.py` completo desde Fase 4j/4k, `health_score.py`/
`operational_risk.py`/`history.py`/`pipeline.py` desde Fase 4) — cero
lógica de negocio nueva. Nuevo `can_view_operational_risk`
(`apps/analytics/permissions.py`, whitelist de roles puntual —
gerencia, nunca nivel 1 — mismo criterio que `can_create_meetings` de
Reuniones) chequeado ANTES de buscar al usuario objetivo, réplica
exacta del orden del `route.ts`. Nuevo `reliability_pct_from_stars`
(`explain.py`). Benchmarks Inteligente (requiere portar
`computeSmartBenchmark`/`computePersonalEvolution`, motor nuevo) y las
12 rutas restantes quedan deferidas a sub-fases futuras. **Sin cutover
de `route.ts`.** Sin migraciones nuevas. 32 tests nuevos — 1174
pasando en total. Ver `docs/AUDIT_LOG.md` § 2026-08-20 (Fase 16) y
`docs/ROADMAP.md` para el resto del roadmap de la migración de stack)

---

**Actualización anterior:** 2026-08-20 (v1.74.0 — Migración de stack hacia
skelleton_base, Fase 15: Notificaciones, superficie HTTP. Cierra un gap
documentado desde la Fase 3f (2026-08-11): `apps.notifications` ya
tenía modelo + `notify()`/`notify_many()` portados, consumidos
internamente por Tareas/Proyectos/Escritorio Digital/Reuniones/Ideas/
LOPD, pero sin endpoints HTTP. `GET/PATCH /api/v1/notifications/`
(`NotificationListView` — lista 20 más recientes + `unread_count` +
`task_assigned_to_id` resuelto aparte ya que `task_id` no es FK /
marca todas leídas) + `PATCH /api/v1/notifications/<id>/`
(`NotificationDetailView` — marca una sola, réplica fiel del
`updateMany` silencioso del TS: sin 404/403 para id ajeno o
inexistente). **Sin cutover de `route.ts`, deliberadamente** — a
diferencia de otros módulos ya completos, el TS se alimenta también de
módulos que todavía no migraron a Django (Nova/Dashboard); cortar el
endpoint mostraría una lista incompleta a usuarios reales. Sin
migraciones nuevas (el modelo no cambió). 13 tests nuevos — 1142
pasando en total. Ver `docs/AUDIT_LOG.md` § 2026-08-20 (Fase 15) y
`docs/ROADMAP.md` para el resto del roadmap de la migración de stack)

---

**Actualización anterior:** 2026-08-20 (v1.73.0 — Migración de stack hacia
skelleton_base, Fase 14: Papelera transversal / Centro de Recuperación.
Nueva app `apps.recovery` — `RecoveryItem`/`RecoveryAuditLog` +
`ENTITY_REGISTRY` (patrón abierto/cerrado de adaptadores, réplica de
`recoveryCenter.ts`). Asimetría fiel al TS, decisión explícita del
usuario: Proyectos gana el flujo completo (`GET /projects/trash/`,
`POST /projects/<id>/restore/`, `DELETE /projects/<id>/permanent/`),
Notas de Escritorio Digital solo `DELETE /desk-notes/<id>/` (mover a
la papelera) — no existen rutas de restaurar/listar/eliminar-
definitivo para notas ni en el TS ni en su frontend. Se incluye
también `purge_expired_archived_notes()` (mecanismo independiente,
cierra el gap documentado desde la Fase 7g). Orden manual de códigos
404→409→403 en `restore`/`permanent`/`destroy` (mismo patrón de
Reuniones/Ideas/LOPD). `RecoveryItem.deleted_at` sin `auto_now_add`
(evita desfase de milisegundos con `expires_at`). Sin cutover de
`route.ts`. 38 tests nuevos — 1129 pasando en total. Ver
`docs/AUDIT_LOG.md` § 2026-08-20 (Fase 14) y `docs/ROADMAP.md` para el
resto del roadmap de la migración de stack)

---

**Actualización anterior:** 2026-08-19 (v1.72.0 — Migración de stack hacia
skelleton_base, Fase 13: Centro de Configuración, arranque acotado.
Cierra 2 cabos sueltos deferidos: `GET/PUT
/settings/prediction-window/` (`PredictionWindowSettingsView`, primera
superficie HTTP de `apps.configuration`, deferido de la Fase 9c) y el
gate de consentimiento (`data_consent_accepted`/
`data_consent_accepted_at` agregados a `apps.users.models.User`,
deferido de la Fase 12): `PATCH /api/v1/auth/consent/` +
`POST /api/v1/admin/users/<id>/reset-consent/` +
`POST /api/v1/admin/users/reset-consent-all/` (nuevas `@action` de
`UserAdminViewSet`). `reset-consent` reutiliza el catálogo de permisos
ya establecido; `reset-consent-all` (masivo, irreversible) replica el
chequeo estricto y literal del TS (`IsAdministrator`, solo
ADMINISTRADOR) — única acción del viewset que exige el rol en vez de
un permiso del catálogo. Bug real encontrado y corregido:
`AuditLog.previous_values`/`new_values` (`JSONField` sin
`DjangoJSONEncoder`) no soportaban un `datetime` crudo. Sin cutover de
`route.ts`. 13 tests nuevos — 1091 pasando en total. Ver
`docs/AUDIT_LOG.md` § 2026-08-19 (Fase 13) y `docs/ROADMAP.md` para el
resto del roadmap de la migración de stack)

---

**Actualización anterior:** 2026-08-19 (v1.71.0 — Migración de stack hacia
skelleton_base, Fase 12: Solicitudes LOPD. Nueva app
`apps.data_requests` — `DataSubjectRequest` (réplica exacta de
`prisma/schema.prisma`): cola de solicitudes de titulares
(ACCESO/RECTIFICACION/ELIMINACION) gestionada 100% manualmente por un
Administrador — investigado antes de portar y confirmado que NO hay
borrado/anonimización real de datos automatizada (`docs/RAT.md` ya lo
documentaba). `export_my_data` reúne los datos operativos del titular
ya portados en fases previas (Tareas/Actividades/Comentarios/
Reuniones/Ideas/Votos/solicitudes previas) en un JSON descargable, y
registra la exportación como una solicitud ACCESO ya resuelta. Se
agregan `GET/POST /data-requests/`,
`PATCH /data-requests/<request_id>/` (solo Administrador) y
`GET /data-requests/my-data/`. Sin cutover de `route.ts`. 27 tests
nuevos — 1078 pasando en total. Ver `docs/AUDIT_LOG.md` § 2026-08-19
(Fase 12))

---

**Actualización anterior:** 2026-08-19 (v1.70.0 — Migración de stack hacia
skelleton_base, Fase 11: Mejora Continua. Nueva app `apps.ideas` —
`ImprovementIdea`/`IdeaVote`/`IdeaStatusHistory` (réplica exacta de
`prisma/schema.prisma`) — voto binario con toggle (conteo siempre
on-the-fly, nunca desnormalizado) y máquina de estados lineal de 6
pasos + Rechazada como estado lateral, con historial completo de
transiciones. `get_visible_idea_author_ids` replica la excepción de
jerarquía documentada del TS (Jefe/Coordinador Nacional ven todas las
ideas). Adjunto con ciclo de vida ligado al estado (enmascarado en
lectura + purgado en escritura al salir de Propuesta). Se agregan
`GET/POST /ideas/`, `GET/PATCH /ideas/<idea_id>/`,
`POST /ideas/<idea_id>/vote/`, `PATCH /ideas/<idea_id>/status/` (única
ruta que no filtra por visibilidad del autor, asimetría real del TS
replicada fiel) y `GET /ideas/<idea_id>/history/`. Gap documentado: el
badge "innovador" (`User.badges`) no se porta. Sin cutover de
`route.ts`. 57 tests nuevos — 1051 pasando en total. Ver
`docs/AUDIT_LOG.md` § 2026-08-19 (Fase 11))

---

**Actualización anterior:** 2026-08-19 (v1.69.0 — Migración de stack hacia
skelleton_base, Fase 10: Reuniones. Nueva app `apps.meetings` —
`Meeting`/`MeetingInvitee` (réplica exacta de `prisma/schema.prisma`)
+ `apps/meetings/zoom.py` (integración real OAuth Server-to-Server,
primera llamada HTTP saliente del backend — se agrega `requests`) con
fallback simulado si Zoom falla, igual que el TS. Otter.ai no requiere
ninguna integración de API (100% edición manual, confirmado
exhaustivamente). Se agregan `GET/POST /meetings/` y
`GET/PATCH/DELETE /meetings/<meeting_id>/`, con `can_create_meetings`
como whitelist puntual de roles (no un umbral de `role_level`) y
permisos ver/editar/eliminar sin excepción de Administrador (solo
anfitrión/invitado, réplica fiel). Sin cutover de `route.ts`. 43 tests
nuevos — 994 pasando en total. Ver `docs/AUDIT_LOG.md` § 2026-08-19
(Fase 10))

---

**Actualización anterior:** 2026-08-18 (v1.68.0 — Migración de stack hacia
skelleton_base, Fase 9c: Inteligencia Preventiva — Simulador. Nuevos
`apps/analytics/simulate_engine.py`/`serializers.py` — 3 escenarios
"qué pasaría si" que nunca persisten: `simulate_adjust_target_time`
(nivel tarea), `simulate_add_participants` (nivel proyecto) y
`simulate_redistribute_load` (bi-usuario), reutilizando por completo
funciones puras ya portadas. Se agregan
`POST /predictive/simulate/<user_id>/`,
`POST /predictive/simulate/project/<project_id>/` y
`POST /predictive/simulate/redistribute/`. Primeros serializers de
entrada de `apps.analytics` (antes 100% de solo lectura).
Inteligencia Preventiva queda funcionalmente completa en Django salvo
`prediction-window` (deferido al futuro Centro de Configuración). Sin
cutover de `route.ts`. 24 tests nuevos — 951 pasando en total. Ver
`docs/AUDIT_LOG.md` § 2026-08-18 (Fase 9c))

---

**Actualización anterior:** 2026-08-18 (v1.67.0 — Migración de stack hacia
skelleton_base, Fase 9b: Inteligencia Preventiva — Alertas Preventivas
+ wiring de equipo. Nuevo `apps/analytics/preventive_intelligence.py`
— réplica exacta de `preventiveIntelligence.ts`:
`compute_preventive_alerts` (individual) y
`compute_team_preventive_alerts` (equipo), componiendo las
predicciones ya calculadas en la Fase 9a en alertas priorizadas
(`roja/naranja/amarilla/verde`). Se agregan
`GET /predictive/alerts/<user_id>/`, `GET /predictive/team-alerts/`,
`GET /predictive/team-subutilization/` y `GET /predictive/
project-delay/<project_id>/` — las 2 últimas reutilizan funciones ya
portadas en la Fase 9a, sin lógica de cálculo nueva.
`ROLE_LEVEL`/`role_level`/`is_leadership`/`can_view_team`/
`get_subordinate_groups` se centralizan en `apps/hierarchy/services.py`
(antes copia local en `apps.projects.permissions`, que se convirtió en
el segundo consumidor real que su propio docstring anticipaba). Sin
cutover de `route.ts`. 31 tests nuevos — 927 pasando en total. Ver
`docs/AUDIT_LOG.md` § 2026-08-18 (Fase 9b))

---

**Actualización anterior:** 2026-08-18 (v1.66.0 — Migración de stack hacia
skelleton_base, Fase 9a: Inteligencia Preventiva — Trend Engine +
predicciones explicables individuales. Nuevos `apps/analytics/
trend_engine.py`/`prediction_engine.py` — réplica exacta de
`trendEngine.ts`/`predictionEngine.ts`: 8 indicadores de dirección/
estabilidad (OLS + coeficiente de variación de residuos, sin IA) +
predicciones de Cumplimiento/Sobrecarga/Estabilidad Operativa/Retraso
de tarea/Retraso de proyecto/Subutilización de equipo. Reutiliza por
completo el motor de Analytics/Capacidad Proyectada ya portado (Fases
4/4f). Se agregan `GET /predictive/predictions/<user_id>/` (bundle:
Cumplimiento + Sobrecarga + Estabilidad + hasta 10 predicciones de
retraso de tareas abiertas) y `GET /predictive/trend/<user_id>/
?weeks_back=<n>` (Trend Engine con override de ventana). Sin cutover
de `route.ts`. 44 tests nuevos — 896 pasando en total. Ver
`docs/AUDIT_LOG.md` § 2026-08-18 (Fase 9a))

---

**Actualización anterior:** 2026-08-18 (v1.65.0 — Migración de stack hacia
skelleton_base, Fase 8: Reportes Ejecutivos, solo lectura de snapshots
ya generados. Nueva app `apps.reports` — `ExecutiveReportSnapshot`/
`ExecutiveReportAuditLog` (réplica de `prisma/schema.prisma`) +
`GET /reports/executive/list/` (paginado, filtrado por `scope`) +
`GET /reports/executive/<report_id>/` (lectura inmutable, audita
`viewed`, réplica exacta de `ensureSnapshotMeta`). El motor de
generación (~3200 líneas en `src/lib/executiveReporting/`, incluye
narrativa IA vía NOVA/Groq) NO se porta — riesgo equivalente al
Asistente LLM/RAG, confirmando el alcance que el propio ROADMAP ya
anticipaba ("snapshots ya generados, nunca recalculados").
`MonthlyReport` (modelo legacy) tampoco se porta, sin consumidor
propio. Sin cutover de `route.ts`. 15 tests nuevos en `apps.reports` —
852 pasando en total. Ver `docs/AUDIT_LOG.md` § 2026-08-18 (Fase 8) y
`docs/ROADMAP.md` para el resto del roadmap de la migración de stack)

---

**Actualización anterior:** 2026-08-18 (v1.64.0 — Migración de stack hacia
skelleton_base, Fase 7g: Escritorio Digital — cutover de `route.ts`. 13
de 14 rutas pasan de Prisma/Postgres a Django/SQL Server (nuevo
`src/lib/djangoDeskAdapter.ts`) — `DELETE /api/desk-notes/[id]` se
queda en Prisma (Papelera, mismo gap que Proyectos Fase 5f). Incluye un
fix independiente del mismo día: 13 archivos de test de Vitest (150
casos) rotos por cutovers previos, reescritos, más 2 bugs de tipos
reales corregidos. `tsc --noEmit`/`eslint` limpios, 1181 tests de
Vitest en verde. Ver `docs/AUDIT_LOG.md` § 2026-08-18 (Fase 7g))

**Actualización anterior:** 2026-08-17 (v1.63.0 — Migración de stack hacia
skelleton_base, Fase 7f: Escritorio Digital — Bandeja Hoy + Buscador.
`GET /desk/today/` (4 bloques de solo lectura, reutiliza
`business_calendar_day`/`business_day_real_range` de
`apps.tasks.business_time`) + `GET /desk/search/` (buscador único,
notas y recordatorios). Sin bloqueos de alcance — `Task`/`Project` ya
completos en Django. Ambas vistas son `APIView` simples, no
`ViewSet` (agregaciones de solo lectura, sin recurso propio). 38 tests
nuevos en `apps.desk` — 837 pasando en total. Ver `docs/AUDIT_LOG.md`
§ 2026-08-17 (Fase 7f) y `docs/ROADMAP.md` para el resto del roadmap
de la migración de stack)
**Autor:** Claude Code

---

## Por qué "v1.4.0" y no "v0.1.0" (el valor de `package.json`)

`package.json` nunca se incrementó durante el desarrollo de Nexo — quedó en
`0.1.0` desde el commit inicial. Este documento reconstruye retroactivamente
un versionado semántico coherente a partir del historial real de Git (154
commits al 2026-07-21), agrupando commits por sprint/día de trabajo en hitos
de versión. A partir de esta implementación (Sprint de Documentación,
2026-07-22), `package.json` se sincroniza con la versión de NEXO declarada
aquí, y cada sprint futuro relevante debe incrementarla.

**Regla de incremento** (semver simplificado, aplicado retroactivamente y
hacia adelante):
- **MAJOR**: cambio de arquitectura o de modelo de negocio que rompe
  compatibilidad conceptual con el estado anterior (ej. la introducción del
  motor de Analytics como plataforma propia se consideró el salto a v1.0.0).
- **MINOR**: nueva funcionalidad o módulo completo.
- **PATCH**: correcciones, refactors, ajustes de UX/UI que no agregan un
  módulo nuevo.

## Historial de versiones (reconstruido desde Git)

| Versión | Fecha | Hito principal |
|---|---|---|
| v0.1.0 | 2026-06-28 | Proyecto renombrado a Nexo, sistema de autenticación completo |
| v0.2.0 | 2026-06-28/29 | Módulo Trabajo: Kanban, Tabla, Gantt; tipos FIJA/SEGUIMIENTO; Equipo; comentarios; perfil |
| v0.3.0 | 2026-06-29 | Módulo de KPIs (Analytics inicial) |
| v0.4.0 | 2026-06-29/30 | Informes mensuales y de rango con análisis de IA; "Mis KPIs" personal |
| v0.5.0 | 2026-06-30 | Nova — asistente IA con 3 modos y base de conocimiento RAG |
| v0.6.0 | 2026-07-01 | Dashboard de inicio rediseñado; Reuniones (Zoom + notas Otter.ai) |
| v0.7.0 | 2026-07-02 | Mejora Continua (ideas); auditoría de seguridad inicial; acciones masivas en tareas |
| v0.8.0 | 2026-07-03/05 | Sistema de diseño v1 → v2 (rediseño premium); formato de fechas centralizado |
| v0.9.0 | 2026-07-04/05 | Cumplimiento LOPDP inicial: enmascarado de correos, consentimiento |
| v0.10.0 | 2026-07-05/06 | Motor de carga laboral: base dinámica de días hábiles, huso horario de negocio |
| v0.11.0 | 2026-07-06/07 | Rol Administrador; limpieza total de ESLint; módulo de Ajustes |
| v0.12.0 | 2026-07-08/09 | Base de conocimiento de Nova (Google Drive → repositorio GitHub); correcciones de despliegue en Vercel |
| v0.13.0 | 2026-07-10/11 | Endurecimiento de seguridad; changelog automático (hook post-commit); formato HH.MM |
| v0.14.0 | 2026-07-11/12 | Carga laboral de 5 zonas con 4 límites configurables independientes |
| v0.15.0 | 2026-07-13/14 | Informes pulidos (fechas, PDF); formato de actividad por horas/minutos |
| v0.16.0 | 2026-07-14/15 | Solicitudes de titulares de datos (LOPDP); framework de pruebas Vitest (cobertura inicial ~271 tests) |
| v0.17.0 | 2026-07-15/16 | Preferencia de formato de actividad; registro retroactivo; edición de horas por Administrador |
| v0.18.0 | 2026-07-17 | Notificaciones configurables; motivos dinámicos; estado especial (maternidad/lactancia) |
| v0.19.0 | 2026-07-18 | Dashboard ejecutivo ampliado; Nova Insights con IA; alertas de riesgo |
| **v1.0.0** | 2026-07-19/20 | **Analytics Engine v1** — People Analytics, capacidad proyectada, motor centralizado determinista (salto de arquitectura: Analytics pasa de tarjetas sueltas a plataforma con motor propio, auditoría y versionado) |
| v1.1.0 | 2026-07-20 | Performance Score separado del Riesgo Operativo; Decision Intelligence Engine; Motor de Benchmarks Inteligente (3 niveles) |
| v1.2.0 | 2026-07-21 | Evolución de "Horas estimadas" a "Tiempo Objetivo"; consolidación y auditoría del motor Analytics (10 duplicaciones resueltas); Sprint 0A — modelo de Analytics diferenciado para roles de dirección |
| v1.3.0 | 2026-07-21 | Unificación del registro de actividades entre tareas Fijas y Seguimiento |
| v1.4.0 | 2026-07-22 | Sistema de documentación, bitácora y auditoría (`/docs`, panel de Documentación en Administración) |
| v1.5.0 | 2026-07-23 | Módulo Proyectos — iniciativas transversales con fases, participantes y ciclo de vida propio, dominio completamente independiente del módulo Trabajo |
| v1.6.0 | 2026-07-23 | Centro de Recuperación — servicio corporativo central de papelera/restauración (registro de adaptadores, sin enum de Prisma), Proyectos como primer módulo integrado |
| v1.7.0 | 2026-07-23 | Sprint 2.1 — refinamiento UX/UI de Proyectos: historial consolidado, responsable/participante distintos, eliminación acotada al creador, fases en tarjetas, registro de tiempo por hora inicio/fin, timeline cronológico, dashboard ejecutivo en Resumen |
| v1.8.0 | 2026-07-23 | Escritorio Digital — notas rápidas tipo Post-it entre colaboradores (excluye Administrador), widget en Dashboard + tablero completo, segundo módulo integrado al Centro de Recuperación |
| v1.9.0 | 2026-07-23 | Escritorio Digital — centro personal de trabajo: color de Post-it, adjuntos, confirmación de lectura, convertir nota en tarea, recordatorios personales (reemplazan `FollowUpReminder`, migración de datos verificada), repetición/posposición, calendario, búsqueda unificada, Bandeja Hoy |
| v1.10.0 | 2026-07-23 | Recordatorios — refinamiento de ciclo de vida: "Completado" ya no es definitivo, reabrir (misma fila, sin crear registro nuevo) con opción de mantener o reprogramar fecha/hora, historial de auditoría visible, pestaña "Archivados" |
| v1.11.0 | 2026-07-23 | Escritorio Digital — refinamiento notas/recordatorios: lectura automática con confirmación al remitente, respuestas cortas (máx. 2), pipeline Nota→Recordatorio→Tarea (reemplaza la conversión directa del sprint anterior), archivado de notas con retención de 15 días, buscador único como overlay |
| v1.12.0 | 2026-07-23 | **Sprint A — Analytics Explicativo**: capa de interpretación sobre el Analytics Engine existente (insights de Performance Score en ambas direcciones, fortalezas/oportunidades, explicación de tendencias, ayuda contextual de 4 partes, histórico con selector de período, simulador "¿qué pasaría si...?" personal) — cero cambios de fórmula/peso/curva/umbral |
| v1.13.0 | 2026-07-24 | **Sprint B — UX Consistente + Design System Foundation**: Design System oficial (`docs/DESIGN_SYSTEM.md`), primitivos compartidos (Button de 6 variantes, PriorityChip/StatusChip, Table, Toast, Skeleton, EmptyState, SearchInput) adoptados en Tareas/Dashboard/Escritorio Digital/Equipo/KPIs/Ajustes/Usuarios — puramente visual/estructural, cero cambios de lógica de negocio |
| v1.14.0 | 2026-07-24 | **Sprint C — NEXO Experience**: reducción de clics en flujos frecuentes, navegación "volver" unificada, acción Reintentar en toasts, useToast() extendido a Ideas/Reuniones/Proyectos, nueva card "Mis proyectos" en Dashboard + jerarquía visual rebalanceada, InfoTooltip y búsquedas recientes — auditoría completa en `docs/PRODUCT_REVIEW.md`, cero cambios de lógica de negocio |
| v1.14.1 | 2026-07-24 | **Fix — `isCompletedOnTime` compara por día calendario**: corrige la clasificación "completada a tiempo" (Definición B de Cumplimiento, `/api/kpis/[userId]`/`/api/kpis/me`), que marcaba como tardía cualquier tarea cerrada durante el horario laboral real de su día de vencimiento (instante UTC crudo vs. día calendario en huso de negocio) — auditoría empírica previa confirmó 51% de falsos "fuera de tiempo"; ver `docs/AUDIT_LOG.md` § 2026-07-24 |
| v1.14.2 | 2026-07-24 | **Migración histórica única — backfill `Task.completedAt`**: regulariza 33 tareas `COMPLETADA` con `completedAt = NULL` (limitación del modelo de datos anterior a 2026-07-07) asignando `completedAt = endDate`; "completadas a tiempo" pasa de 57/121 a 90/121. Cierra además un gap de prevención en `POST /api/tasks` (crear una tarea ya Completada no fijaba `completedAt`). Migración de datos de una sola ejecución, no un cambio de fórmula; ver `docs/AUDIT_LOG.md` § 2026-07-24 |
| **v1.23.0** | 2026-07-28 | **Executive Reporting Engine — repunte completo de la UI**: `MonthlyReports.tsx`/`ReportWizardModal.tsx` pasan a consumir EXCLUSIVAMENTE el endpoint unificado (`/api/reports/executive` + `/[reportId]` + `/list`), reemplazando los botones aditivos de v1.22.0. Retirados por quedar sin ningún consumidor (verificado, no solo inspeccionado): 4 rutas legacy (`generate`/`range`/`custom-range`/`route` de `/api/reports`), 7 componentes de presentación, `wizardExport.ts` completo, los 4 `download*` de `MonthlyReports.tsx`, 5 tipos de `kpis/types.ts` y su archivo de test. `MonthlyReport` (modelo Prisma) permanece intacto. La vista en pantalla reutiliza el mismo render HTML que el PDF; 3 campos del snapshot sin página fija en el documento (tendencias, evolución mensual del rango, alertas) se conservan como paneles complementarios. Sin rutas duplicadas, sin feature flags. Ver `docs/CHANGELOG.md` |
| **v1.23.2** | 2026-07-28 | **Fix — reportes LEGACY_MIGRATION persistidos sin `data.meta`**: el backfill de Fase D (v1.22.0) guardó los 4 `ExecutiveReportSnapshot` migrados sin el campo `meta` dentro del JSON `data` (solo como columnas Prisma sueltas) — invisible hasta que el repunte de `MonthlyReports.tsx` (v1.23.0) fue el primer código en leer `data.meta.periodLabel`, causando `TypeError: Cannot read properties of undefined`. Corregido en el límite de lectura (`GET /api/reports/executive/[reportId]`, `ensureSnapshotMeta` — reconstruye `meta` desde las columnas de la fila, sin escribir en la BD compartida) y en el origen (`scripts/backfill-executive-report-snapshots.ts`, para no repetirse en una corrida futura). Validaciones defensivas (optional chaining con fallback) agregadas en `documentModel.ts` y en los puntos de exportación de `MonthlyReports.tsx`/`ReportWizardModal.tsx`. Ver `docs/AUDIT_LOG.md` § 2026-07-28 (Fix — Snapshot Meta) |
| v1.23.1 | 2026-07-28 | **Executive Reporting Engine — FPS Parte V (documentación)**: 8 documentos oficiales nuevos en `docs/` — `REPORTING_STANDARDS.md`, `REPORTING_NOVA_WRITING_GUIDE.md`, `REPORTING_DESIGN_SYSTEM.md`, `REPORTING_REFERENCE_LIBRARY.md`, `REPORTING_USE_CASES.md`, `REPORTING_AUDIT_MANUAL.md`, `REPORTING_EDGE_CASES.md`, `REPORTING_QUALITY_BENCHMARK.md` — todos grounded contra el código real del motor (Partes I-IV), sin especular funcionalidad. `ROADMAP.md` § Planificado gana nombres oficiales (Sprint Q/R) para los 2 sprints ya registrados en v1.22.3 y 3 sprints nuevos sin diseño técnico (S/T/U). Cero cambios a `src/` — esta entrega es puramente documental por mandato explícito del FPS Parte V. Ver `docs/CHANGELOG.md` |
| v1.22.3 | 2026-07-28 | **Executive Reporting Engine — FPS Parte IV**: cierra 3 brechas de auditoría/rendimiento/impresión y documenta 2 decisiones explícitas del usuario. Report ID en el pie de las 11 páginas (antes solo Portada/Metadatos); auditoría de generación completa (`filtersApplied` antes ausente pese a existir el campo; nueva entrada `generation_failed` con Report ID provisional/paso/mensaje técnico, nunca expuesto al cliente); `@page{size:A4}` para impresión. Benchmark real (`scripts/bench-executive-report.ts`, datos de producción) midió ~22s en el mes en curso (9 colaboradores) — sobre el presupuesto de 15s del FPS §8; descartado NOVA como causa (mismo tiempo sin `GROQ_API_KEY`); causa raíz: 4 funciones de Analytics/Predicción de uso individual invocadas por colaborador (36 llamadas). Paralelización de Índice Ejecutivo + Analytics Predictivo y `cached()` en las 2 llamadas de predicción que no lo tenían bajan la REGENERACIÓN a ~3.3s (dentro de presupuesto) sin tocar `predictionEngine.ts`/`analytics.ts`. **Decisión explícita del usuario**: la generación fría del mes en curso queda como limitación conocida de v2.0 (no afecta exactitud), con un Sprint de Optimización del Analytics Engine (variantes batch, cero cambio de fórmulas) registrado como mejora futura; Snapshot Integrity Validation (verificación activa en tiempo de ejecución) también queda como mejora futura — la integridad estructural ya se considera cumplida por el Builder canónico único. Ver `docs/AUDIT_LOG.md` § 2026-07-28 (Decisiones 8-9) |
| v1.22.2 | 2026-07-28 | **Executive Reporting Engine — FPS Parte III (NOVA)**: cierra 3 brechas encontradas al auditar la Fase C contra el texto literal de la Parte III. `NovaRecommendationEnrichment` gana `areaAfectada`/`complejidadEstimada` (la Parte III exige 5 campos por recomendación; solo 3 estaban implementados) — tipo, prompt, fallback determinista y validación anti-alucinación actualizados en conjunto. El prompt de Executive Assessment ahora exige explícitamente la profundidad que pide el FPS: fortalezas deben explicar por qué/impacto/cómo aprovechar, riesgos deben responder qué/por qué/impacto/acción preventiva, oportunidades deben indicar retorno esperado — y agrega instrucción de no repetir Executive Insights (antes solo prohibía repetir el Summary). Nueva "Regla de Lenguaje" (anti-jerga/anti-emocional/anti-comercial) en las reglas base compartidas por los 4 prompts. Cero cambios a Analytics Engine/`predictionEngine.ts`/arquitectura del motor NOVA (mismas 4 llamadas paralelas, mismo timeout, mismo fallback, misma realineación estricta por `id`) — solo contenido de prompt + 2 campos de datos. Ver `docs/CHANGELOG.md` |
| v1.22.1 | 2026-07-28 | **Executive Reporting Engine — FPS Parte II**: cierra las 2 brechas encontradas al auditar la Fase E contra el checklist explícito de la Parte II. Distribución Operativa gana un gráfico de barras real (SVG inline, sin librería nueva); Analytics Predictivo deja de ser un placeholder y muestra proyección de cumplimiento/probabilidad de sobrecarga/subutilización por colaborador usando el motor YA EXISTENTE (`predictionEngine.ts`, sin fórmulas nuevas), gateado al mes calendario en curso (mismo criterio que el Índice Ejecutivo). Los 3 escenarios de equipo (Esperado/Preventivo/Optimista, FPS Parte III) siguen pendientes — no existe motor de síntesis a nivel de equipo. Cero cambios a Analytics Engine/`predictionEngine.ts`; cero nuevas consultas desde la capa de render (`documentModel.ts`/`renderReportHtml.ts` siguen consumiendo solo `ExecutiveReportSnapshotData`). Ver `docs/CHANGELOG.md` |
| v1.22.0 | 2026-07-28 | **Executive Reporting Engine 2.0**: motor de reportes ejecutivos independiente de Analytics, construido en 5 fases (A-E). `ExecutiveReportSnapshotData` como objeto de dominio único (calculado una vez, consumido por NOVA/documento/auditoría sin recalcular); `ExecutiveReportSnapshot`/`ExecutiveReportAuditLog` (Prisma, snapshot inmutable congelado en runtime); Report ID propio (`NXR-YYYYMMDD-HHMMSS-XXXX`); fecha de corte real (filtra actividad/cumplimiento, no solo etiqueta, vía reconstrucción "a la fecha" con `completedAt`); `ExecutiveReportFilters` unificado (período/rol/área/colaboradores); NOVA reescrito de 1 llamada de texto libre sin caché a 4 secciones estructuradas con fallback determinista garantizado (`src/lib/executiveReporting/nova/`); documento de 11 páginas (`documentModel.ts`/`renderReportHtml.ts`/`renderReportExcel.ts`) integrado de forma ADITIVA a `MonthlyReports.tsx` (botones "PDF/Excel Ejecutivo 2.0", sin retirar el flujo existente); backfill certificado de los 4 `MonthlyReport` históricos (`origin=LEGACY_MIGRATION`, `integrityFlag=PARTIAL`, ejecutado con confirmación explícita). Cero cambios a Analytics Engine/fórmulas. Ver `docs/AUDIT_LOG.md` § 2026-07-28 (Executive Reporting Engine 2.0) |
| v1.14.3 | 2026-07-24 | **Fix — cierra condición de carrera en `migrateFijaHistoryIfNeeded`**: la migración perezosa de historial de tareas Fijas ahora corre `count()`/`upsert()`/`create()` dentro de una transacción `Serializable`, evitando que dos peticiones concurrentes dupliquen la actividad migrada (riesgo teórico, nunca observado en producción); ver `docs/AUDIT_LOG.md` § 2026-07-24 |
| v1.15.0 | 2026-07-24 | **Sprint D — Optimización y Refinamiento**: auditoría integral de los 10 módulos (~40 hallazgos), cierra un IDOR real en 5 subrecursos de tareas + crash al eliminar usuarios, consolida ~10 duplicaciones de código, agrupa consultas del Dashboard en `Promise.all`, memoiza gráficos de KPIs, agrega buscador a Usuarios, y suma un panel de Calidad del Dato en Ajustes (fechas inválidas, horas duplicadas, registros sin propietario) — cero módulos nuevos, cero cambios de fórmula, alcance acotado a "solo lo seguro" (hallazgos de negocio quedaron en backlog); ver `docs/AUDIT_LOG.md` § Sprint D |
| v1.15.1 | 2026-07-24 | **Sprint D (continuación) — UX, Calidad del Dato ampliada, validación de efectos secundarios**: 10 fixes de UX (spinners/aria-labels/EmptyState/tabla responsive/botones compartidos/normalización visual) de una auditoría dedicada; 2 verificaciones nuevas de Calidad del Dato (motivo huérfano, retroactivo inconsistente); informe de validación de efectos secundarios (Bloque 11) confirmando por `git diff` que Sprint D no tocó Analytics/KPIs/Timeline ni perdió invalidación de caché — ver `docs/AUDIT_LOG.md` § Sprint D (continuación) |
| v1.16.0 | 2026-07-24 | **Sprint Analytics 2.0 — Inteligencia Explicable e Interpretación Ejecutiva**: revive `computeHealthScore` (congelado desde Sprint 5) como "Equilibrio Operativo" con capa de explicabilidad automática (qué significa/por qué/impacto/qué hacer, 100% determinística sin IA), Estado Operativo de 5 niveles con escala siempre visible, normalización progresiva de Capacidad Futura (único cambio de fórmula, elimina el salto abrupto de sobrecarga), auto-explicación de Consistencia "Variable" — rename de marca sin tocar símbolos de código ni `AnalyticsAuditLog.kind` persistido; ver `docs/AUDIT_LOG.md` § Sprint Analytics 2.0 |
| v1.17.0 | 2026-07-24 | **Sprint Reportes Ejecutivos 2.0 — Inteligencia Organizacional en el Informe Consolidado**: el Informe Mensual Consolidado pasa de exportación de tablas a informe ejecutivo — Resumen Ejecutivo, Hallazgos y Recomendaciones por reglas fijas (sin IA, coexistiendo con el Análisis IA de Groq ya existente), interpretación de 4 partes por indicador, Mapa de Riesgo Cumplimiento×Carga, tendencias automáticas mes/trimestre/semestre, Índice Ejecutivo del Equipo (promedio Performance Score + Equilibrio Operativo, disponible solo para el mes en curso por la naturaleza forward-looking de Capacidad Futura) — cero cambios al Analytics Engine; ver `docs/AUDIT_LOG.md` § Sprint Reportes Ejecutivos 2.0 |
| v1.18.0 | 2026-07-24 | **Sprint Analytics 2.1 — Mejora del Reporte Ejecutivo y Calidad de la Comparabilidad**: Base Horaria Efectiva (compara colaboradores contra la base del tramo en que realmente tuvieron disponibilidad, no el período completo), Generador Inteligente de Reportes (asistente de colaboradores/período/secciones/formato, nuevo endpoint de rango por fechas arbitrarias), Estado Operativo y Principal Hallazgo por colaborador, interpretación de consultas extendida a informes de rango, paridad Excel/PDF, arquitectura preparada (sin UI) para Comparación de Equipos — cero cambios al Analytics Engine; ver `docs/AUDIT_LOG.md` § Sprint Analytics 2.1 |
| v1.18.1 | 2026-07-26 | **Fix — ventana de registro retroactivo incluye el fin de semana inmediato anterior**: el sábado/domingo previo ahora es registrable hasta el martes siguiente (desaparece automáticamente desde el miércoles), sin modificar la regla base de 2 días laborables; motor único `retroactiveValidDates()` reutilizado por Seguimiento y Proyectos (Fija queda fuera de alcance — nunca tuvo registro retroactivo); ver `docs/AUDIT_LOG.md` § 2026-07-26 |
| v1.19.0 | 2026-07-26 | **Sprint E — Analytics Predictivo e Inteligencia Preventiva**: Trend Engine (8 indicadores, dirección/estabilidad, sin IA), 4 predicciones explicables (Cumplimiento/Sobrecarga/Subutilización/Retrasos) con confianza/confiabilidad/horizonte, Estabilidad Operativa, alertas preventivas priorizadas, simulador de 5 escenarios (nunca persiste), Tendencias Históricas con ventanas independientes, ventana histórica configurable por el Administrador — módulo nuevo y autónomo `/inteligencia-preventiva`, cero cambios al Analytics Engine central ni a Dashboard/KPIs/Reportes/Proyectos/Equipo; ver `docs/AUDIT_LOG.md` § 2026-07-26 (Sprint E) |
| v1.20.0 | 2026-07-26 | **Motor Determinista de Recomendaciones — Compatibilidad Organizacional**: `computeTeamRecommendations` respeta la estructura jerárquica de NEXO — prioriza el mismo cargo, usa una Matriz de Compatibilidad Operativa configurable (Ajustes → Analytics) como respaldo entre cargos del mismo nivel, nunca sugiere redistribución vertical (filtro absoluto, no solo de configuración), y muestra un mensaje explícito cuando no hay candidato compatible en vez de una sugerencia incorrecta — cero cambios a carga laboral/KPIs/Analytics Engine; ver `docs/AUDIT_LOG.md` § 2026-07-26 (Compatibilidad Organizacional) |
| v1.20.1 | 2026-07-28 | **Fix — indicador "Carga Laboral" con fuente de datos distinta al resto de Analytics**: `/api/kpis/[userId]` y `/api/kpis/me` calculaban `cargaLaboral` (SummaryCard + Donut + exportables) sumando `estimatedHours`/`realHours` crudos de las tareas del período (`computeEstimatedVsRealRatio`), un cálculo sin relación con la Base Horaria Efectiva (`cargaTiempo.mensual`) que ya usa WorkloadCard/Equilibrio Operativo en la misma pantalla — mismo período, dos números de "Carga Laboral" distintos. Ahora `cargaLaboral` lee de `cargaTiempo.mensual`; el ratio estimado-vs-real se conserva solo como input del Score básico (`computeSimpleScore`), que no cambió — cero cambios al Analytics Engine, Equilibrio Operativo, Analytics Predictivo, Reportes ni Dashboard; ver `docs/AUDIT_LOG.md` § 2026-07-28 |
| **v1.26.0** | 2026-08-03 | **Aprobación masiva de Fecha Fin con edición por fila**: el modal de regularización masiva (`BulkApproveEndDateModal` en `RegularizeTargetTimeManager.tsx`) muestra una tabla con Actividad/Colaborador/Fecha Inicio/Fecha Fin actual/Nueva Fecha Fin editable por cada tarea seleccionada — antes solo aprobaba en bloque la fecha ya propuesta. `POST /api/tasks/end-date/bulk-approve` cambia su contrato a `{ items: [{ taskId, newEndDate? }] }`: si `newEndDate` coincide con el valor vigente se aplica como APROBAR, si difiere como MODIFICAR (decidido del lado del servidor, no del cliente); valida `newEndDate >= startDate` (omite y reporta aparte las inválidas, `skippedInvalidDate`); confirmación con el detalle de cada cambio antes de ejecutar, solo si hay cambios reales. Cero cambio a `applyEndDateAction`/permisos/auditoría. Ver `docs/AUDIT_LOG.md` § 2026-08-03 (Aprobación masiva con edición) |
| **v1.25.1** | 2026-08-03 | **Consolidación de la validación de líder en Tiempo Objetivo**: corrige la ubicación de la Fecha Fin (v1.25.0) — de pestaña/tabla/modal separados a integrarse en la MISMA pantalla que Tiempo Objetivo (`RegularizeTargetTimeManager.tsx` gana columna Fecha Fin; `ValidateActivityModal.tsx`, nuevo, reemplaza los 2 modales separados con 2 secciones independientes en uno solo). `GET /api/tasks/validations/pending` (nuevo, `src/lib/taskValidationServer.ts`) reemplaza los 2 endpoints `/pending` separados con un listado por UNIÓN (aparece si Tiempo Objetivo O Fecha Fin necesitan atención). Se retiran `RegularizeEndDateManager.tsx`/`RegularizeValidationsTabs.tsx`/`ValidateTargetTimeModal.tsx`/`ValidateEndDateModal.tsx`. Cero cambio a `applyTargetTimeValidation`/`applyEndDateAction`/permisos/auditoría/notificaciones — solo presentación. Ver `docs/AUDIT_LOG.md` § 2026-08-03 (Consolidación) |
| **v1.25.0** | 2026-08-03 | **Validación de Fecha Fin de Subordinados**: extiende el flujo de validación por líderes de Tiempo Objetivo (Sprint 6) a `Task.endDate` — `EndDateApprovalStatus` (PENDIENTE/APROBADA/MODIFICADA/RECHAZADA) + `EndDateAuditLog`, 3 acciones del líder (Aprobar/Modificar/Rechazar, `POST /api/tasks/[id]/end-date`), notificación al colaborador en Modificada/Rechazada, reinicio automático a Pendiente al reeditar `endDate` tras una decisión terminal (sin UI/endpoint nuevo — el PATCH normal de tarea ya lo resuelve). Reutiliza `CAN_VALIDATE_TARGET_TIME_ROLES` (mismos 3 roles: Administrador/Jefe Nacional/Coordinador Nacional) en vez de duplicar la lógica de "quién valida" — NEXO no tiene un campo "jefe directo" explícito. Nunca bloquea el uso de `endDate` en KPIs/overdue/cierre de mes. Segunda pestaña "Fecha Fin" en `/tiempo-objetivo` con regularización masiva (solo aprobación en bloque, no fijar un valor nuevo). Ver `docs/AUDIT_LOG.md` § 2026-08-03 |
| **v1.24.0** | 2026-08-02 | **Motor de Cierre Inteligente con Fecha de Corte**: "Cerrar Mes" acepta una Fecha de Corte editable (por defecto el último día del mes) con `closureType` NORMAL/EARLY/MANUAL persistido de forma inmutable en `MonthClosure`; `monthlyBusinessBase` la aplica de forma transparente (sin cambiar su firma) a los ~15 consumidores de Analytics/KPIs/Executive Reporting/dashboard; corrige una asimetría numerador/denominador en `computeMonthlyHistory` y en el Executive Reporting Engine (el corte ya truncaba la actividad real pero nunca la base de horas). Portada/Metadatos del Informe Ejecutivo muestran cobertura/días hábiles/nota metodológica solo cuando el cierre no fue normal — cero cambio visual/de cálculo para el resto de los reportes. `ANALYTICS_ENGINE_VERSION`/`FORMULA_SET_VERSION` sin cambios (mismo criterio que Base Horaria Efectiva, §15). Ver `docs/AUDIT_LOG.md` § 2026-08-02 |
| **v1.21.0** | 2026-07-28 | **Sprint O — Centro de Configuración NEXO**: `/settings` pasa de un acordeón plano de ~21 secciones (`SettingsManager.tsx`) a un módulo organizado por categoría (`ConfigCenter.tsx`) — Organización/Analytics/Trabajo/Proyectos/Escritorio Digital/Reportes/NOVA/Seguridad/Notificaciones/Parámetros Globales/Sistema — con búsqueda global, favoritos (reutiliza `User.viewPreferences`), historial de auditoría navegable sobre `SystemConfigHistory` (que ya existía) y restaurar-a-predeterminado. Agrega 9 valores nuevos configurables que antes eran literales hardcodeados (ventana de registro retroactivo, hora de corte de jornada, retención/tope de respuestas/presets de posposición de Escritorio Digital, TTL de caché de NOVA, longitud mínima de contraseña, duración de sesión, retención de intentos de login), todos con default = valor anterior (cero cambio de comportamiento sin configurar nada). Corrige un bug real: Coordinador Nacional pasaba el gate de `/settings` pero veía una página vacía — ahora la ruta es consistentemente Administrador-only. SLA/riesgo de Proyectos, plantillas/programación de Reportes, permisos especiales de Seguridad, enums de Trabajo e idioma/moneda quedan deliberadamente fuera de alcance (documentado en `docs/ROADMAP.md`) — cero cambios al Analytics Engine; ver `docs/AUDIT_LOG.md` § 2026-07-28 (Sprint O) |

| **v1.44.0** | 2026-08-11 | **Migración de stack hacia skelleton_base — Fase 4i: motor de alertas automáticas**: `compute_alerts`/`get_resolved_alerts_history` (`apps.analytics.alerts_engine`) — 8 reglas independientes, cierra el núcleo de scoring completo. Distinto de `compute_risk_alerts` (Fase 4b). Sin endpoint HTTP. 32 tests nuevos (496 en total). Ver `docs/AUDIT_LOG.md` § 2026-08-11 (Fase 4i) |
| **v1.43.0** | 2026-08-11 | **Migración de stack hacia skelleton_base — Fase 4h: Riesgo Operativo**: `compute_operational_risk` (`apps.analytics.operational_risk`) — 8 factores de severidad ponderados + tendencia vs. mes anterior + acciones sugeridas. Fidelidad exacta requerida por el propio legacy (Sprint 5 § S5-C). Sin endpoint HTTP. 26 tests nuevos (464 en total). Ver `docs/AUDIT_LOG.md` § 2026-08-11 (Fase 4h) |
| **v1.42.0** | 2026-08-11 | **Migración de stack hacia skelleton_base — Fase 4g: Equilibrio Operativo**: `compute_health_score` (`apps.analytics.health_score`) — 5 factores ponderados (Cumplimiento/Carga laboral/Tareas vencidas/Consistencia/Capacidad futura), sin NormalizationEngine/curvas (a diferencia de Performance Score). `classify_estado_operativo` (escala de 5 niveles). Sin endpoint HTTP. 23 tests nuevos (438 en total). Ver `docs/AUDIT_LOG.md` § 2026-08-11 (Fase 4g) |
| **v1.41.0** | 2026-08-11 | **Migración de stack hacia skelleton_base — Fase 4f: Capacidad Proyectada**: `compute_capacity_forecast`/`compute_team_capacity_forecast` (`apps.analytics.capacity_forecast`) — proyección hacia adelante de horas disponibles vs. comprometidas, la dependencia común de Equilibrio Operativo/Riesgo Operativo (sub-fases futuras). Nuevo `get_effective_workday_end_hour` en `configuration/services.py`. Sin endpoint HTTP. 21 tests nuevos (415 en total). Ver `docs/AUDIT_LOG.md` § 2026-08-11 (Fase 4f) |
| **v1.40.0** | 2026-08-11 | **Migración de stack hacia skelleton_base — Fase 4e: Performance Score**: `compute_performance_score` (`apps.analytics.performance_score`) — 4 factores ponderados (Cumplimiento/Tareas vencidas/Consistencia/Índice de Trazabilidad) vía NormalizationEngine, deliberadamente sin carga/capacidad/riesgo. Nuevos `weighted_points`/`audit_calculation` en `scoring.py`, `FORMULA_VERSIONS`/`AUDIT_KIND_FORMULAS` en `models.py`. Sin endpoint HTTP — no hay ruta legacy aislada de solo Performance Score. 16 tests nuevos (394 en total). Ver `docs/AUDIT_LOG.md` § 2026-08-11 (Fase 4e) |
| **v1.39.0** | 2026-08-11 | **Migración de stack hacia skelleton_base — Fase 4d: infraestructura común del núcleo de scoring (Tanda A)**: `getEffectiveAnalyticsConfig`/curvas de normalización, histórico mensual/semanal, tendencias, inicio efectivo del historial, consistencia, `compute_data_quality`/`compute_target_time_precision`. Sin endpoint HTTP — ninguna de las 4 piezas grandes (Health Score/Performance Score/Riesgo Operativo/Alertas del motor) es portable sin esta base. 62 tests nuevos (378 en total). Ver `docs/AUDIT_LOG.md` § 2026-08-11 (Fase 4d) |
| **v1.38.0** | 2026-08-11 | **Migración de stack hacia skelleton_base — Fase 4c: `GET /api/kpis/me/range`**: cierra los 3 endpoints personales de KPIs (junto con `/kpis/me` y `/kpis/[userId]` de 4b). Usa la Definición A de "cumplimiento" (`compute_completed_pct_any`), deliberadamente distinta de la Definición B de 4b — mismo gap legacy aceptado. Nuevo `monthly_business_base_for_users` (variante multi-usuario de la base horaria de 4a, sensible a `SpecialStatus` por usuario). 17 tests nuevos (316 en total). Ver `docs/AUDIT_LOG.md` § 2026-08-11 (Fase 4c) |
| **v1.37.0** | 2026-08-11 | **Migración de stack hacia skelleton_base — Fase 4b: primer endpoint real de KPIs/Analytics**: `GET /api/kpis/me` y `/api/kpis/[userId]` cortados a Django (`KpiMeView`/`KpiUserView`, `apps.analytics.services.build_kpi_payload`) — visibilidad jerárquica (`is_visible_to`) y redacción de detalle sensible (permisos médicos/estado especial, Art. 26 LOPDP) para viewers que no son el titular ni Administrador. Completa `compute_carga_tiempo`/`compute_carga_history`/`redact_sensitive_workload_detail`; porta `risk_alerts.py`/`priority_compliance.py` completos y 3 funciones puntuales de `analytics.ts` (`compute_simple_score`/`compute_estimated_vs_real_ratio`/`validate_cumplimiento_consistency`, con `AnalyticsAuditLog`). `djangoKpisAdapter.ts` (transformación recursiva snake_case→camelCase, primer adaptador de este tipo en la migración — el resto usa mapeo campo por campo). 54 tests nuevos (299 en total). Ver `docs/AUDIT_LOG.md` § 2026-08-11 (Fase 4b) |
| **v1.36.0** | 2026-08-11 | **Migración de stack hacia skelleton_base — Fase 4a: base horaria del motor de KPIs/Analytics**: `apps.analytics.workload` (sin endpoint HTTP todavía) + 3 dependencias de datos nuevas (`LeaveRecord`/`SpecialStatus`/`User.kpi_start_date`), primera sub-fase de KPIs/Analytics. Ver `docs/AUDIT_LOG.md` § 2026-08-11 (Fase 4a) |
| **v1.31.0** | 2026-08-07 | **Migración de stack hacia skelleton_base — Fase 3c: validación de Tiempo Objetivo y Fecha Fin**: `TargetTimeAuditLog`/`EndDateAuditLog` en Django, autorización simplificada a `usuarios.editar` (equivalencia verificada), reinicio a Pendiente al reeditar `end_date`, desviación histórica portada 1:1. 118 tests pasando. Ver `docs/AUDIT_LOG.md` § 2026-08-07 (Fase 3c) |
| **v1.30.0** | 2026-08-07 | **Migración de stack hacia skelleton_base — Fase 3b: registro de horas**: `ActivityReason`/`TaskActivity` en Django, catálogo de motivos por rol, límite de 2 registros en tareas Fija, solapamiento horario (`business_time.py`, portado 1:1), recálculo de `real_hours`. 105 tests pasando. Ver `docs/AUDIT_LOG.md` § 2026-08-07 (Fase 3b) |
| **v1.29.0** | 2026-08-07 | **Migración de stack hacia skelleton_base — Fase 3a: módulo Tareas, CRUD core + comentarios**: `Task`/`Comment`/`TaskCommentView` en Django (`backend/apps/tasks/`); `/api/tasks`, `/api/tasks/[id]`, `/api/tasks/[id]/comments` cortados sin tocar componentes React; permiso de eliminar más estrecho que ver/editar (replica asimetría legacy). 93 tests pasando. Ver `docs/AUDIT_LOG.md` § 2026-08-07 (Fase 3a) |
| **v1.28.0** | 2026-08-07 | **Migración de stack hacia skelleton_base — Fase 2: Cutover de Usuarios/Roles/Permisos**: login real de Next.js sin cambios (100% Postgres/bcrypt); login paralelo no bloqueante a Django (`src/lib/djangoSession.ts`); `/api/users`/`/api/users/[id]`/`/api/users/[id]/reset-password` cortados a Django sin tocar `UsersManager.tsx`/`admin/users/page.tsx`. 3 cambios de comportamiento explícitos heredados del diseño de skelleton_base (password inicial, DELETE→baja lógica, reset sin password conocido). Ver `docs/AUDIT_LOG.md` § 2026-08-07 (Fase 2) |
| **v1.27.0** | 2026-08-07 | **Migración de stack hacia skelleton_base — Fase 1: núcleo de seguridad**: backend Django+DRF+SQL Server (`backend/`) y frontend React+Vite (`frontend/`) nuevos, en paralelo al Next.js/Prisma/PostgreSQL actual (que sigue sirviendo el 100% del tráfico real, sin cambios). Sesión revocable, catálogo de permisos granular, Argon2, protección de fuerza bruta; jerarquía de roles de Nexo modelada como datos (`apps.hierarchy`, copia exacta de `roles.ts`); importación de usuarios legacy con fallback bcrypt→Argon2; fix de causa raíz de un bug real en `skelleton_base` (orden de `post_migrate`). 81 tests pasando. Ver `docs/AUDIT_LOG.md` § 2026-08-07 |

Ver `docs/CHANGELOG.md` para el detalle completo de cada versión (tipo de
cambio, módulo, archivos afectados, impacto).

## Mantenimiento

Este archivo debe actualizarse cuando:
- Se agrega un módulo o funcionalidad nueva → incrementar MINOR.
- Se corrige un bug o se refactoriza sin agregar funcionalidad → incrementar PATCH.
- Cambia el modelo de negocio o la arquitectura de forma incompatible con el
  estado anterior → incrementar MAJOR.
- Cambia `ANALYTICS_ENGINE_VERSION` o `FORMULA_SET_VERSION` en
  `src/lib/analytics.ts` → reflejar el nuevo valor aquí.

El campo `version` de `package.json` debe mantenerse sincronizado con la
versión de NEXO declarada en la tabla de arriba.
