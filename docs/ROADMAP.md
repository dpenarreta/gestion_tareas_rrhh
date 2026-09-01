# Roadmap de Nexo

> Roadmap vivo — cada funcionalidad cambia de estado a medida que avanza.
> Cuando una funcionalidad planificada se implementa, se mueve de
> "Planificado" a "Implementado" en el mismo cambio que la entrega (ver
> `CLAUDE.md` § Documentación) y gana una entrada correspondiente en
> `docs/CHANGELOG.md`.

## Implementado

- Módulo Trabajo: Kanban, Tabla, Gantt, tipos FIJA/SEGUIMIENTO unificados
  bajo un mismo modelo de registro de actividades (v1.3.0).
- Tiempo Objetivo: valor inicial + validación oficial por un líder,
  auditoría de cambios, regularización asistida (v1.2.0).
- Analytics Engine v1: Score de Salud, Índice de Riesgo Operativo, alertas,
  tendencias, consistencia, predicción, calidad de datos (v1.0.0).
- Performance Score separado del Operational Risk Score (v1.1.0).
- Decision Intelligence Engine — insights explicables, relaciones entre
  indicadores, priorización, sin IA para ningún cálculo (v1.1.0).
- Motor de Benchmarks Inteligente — 3 niveles (cargo/limitado/personal)
  (v1.1.0).
- Modelo de Analytics diferenciado por jerarquía organizacional — roles de
  dirección ven KPIs de equipo, no individuales (v1.2.0).
- Dashboard ejecutivo (Administrador/Jefe Nacional/Coordinador Nacional).
- Nova: asistente IA con 3 modos, base de conocimiento RAG (GitHub),
  mensajes contextuales en Dashboard.
- Módulo de Reuniones con integración real de Zoom y notas Otter.ai.
- Mejora Continua: ideas con votos, estados e historial.
- Cumplimiento LOPDP: consentimiento, enmascarado de datos, solicitudes de
  titulares, política de retención, RAT documentado.
- Framework de pruebas automatizadas (Vitest + Testing Library).
- Sistema de diseño v2 (sidebar, tokens, modo claro/oscuro).
- Sistema de documentación, bitácora y auditoría (v1.4.0).
- Módulo Proyectos: iniciativas transversales con fases, participantes y
  ciclo de vida propio, independiente del módulo Trabajo (v1.5.0).
- Centro de Recuperación: servicio corporativo central de papelera/
  restauración (el usuario ve "Papelera"), con Proyectos como primer
  módulo integrado (v1.6.0).
- Sprint 2.1 — refinamiento UX/UI de Proyectos: historial consolidado,
  responsable/participante como conceptos distintos, eliminación acotada
  al creador, fases en tarjetas con "Ver detalle", registro de tiempo por
  hora inicio/fin, timeline cronológico con archivos, tarjeta de tiempo
  acumulado y dashboard ejecutivo en Resumen (v1.7.0).
- Escritorio Digital: notas rápidas tipo Post-it entre colaboradores
  (excluye Administrador), widget en Dashboard + página de tablero
  completo, segundo módulo integrado al Centro de Recuperación (v1.8.0).
- Escritorio Digital — evolución a "centro personal de trabajo": color de
  Post-it independiente de prioridad, adjuntos, confirmación de lectura,
  convertir nota en tarea, recordatorios personales (reemplazan por
  completo a `FollowUpReminder`, con migración de datos verificada) con
  repetición y posposición, widget del Dashboard limitado a recordatorios,
  calendario personal, búsqueda unificada y Bandeja Hoy (v1.9.0).
- Recordatorios — refinamiento de ciclo de vida: "Completado" deja de ser
  definitivo, reabrir (con opción de mantener o reprogramar fecha/hora)
  actualiza la misma fila sin crear un registro nuevo, historial de
  auditoría visible por recordatorio, y pestaña "Archivados" separada de
  "Completados" (v1.10.0).
- Escritorio Digital — refinamiento notas/recordatorios: lectura automática
  al abrir la nota (sin botón) con confirmación al remitente, respuestas
  cortas acotadas a 2, pipeline Nota→Recordatorio→Tarea (reemplaza la
  conversión directa Nota→Tarea del sprint anterior, que nunca se usó en
  producción), archivado de notas con retención de 15 días y eliminación
  definitiva desde Archivadas, buscador único como overlay accesible desde
  cualquier pestaña (v1.11.0).
- Sprint Analytics 2.0 — revive el Score de Salud Laboral (congelado desde
  Sprint 5) como "Equilibrio Operativo", con capa de explicabilidad
  automática 100% determinística (qué significa/por qué/impacto/qué
  hacer), Estado Operativo de 5 niveles con escala siempre visible,
  normalización progresiva de Capacidad Futura (único cambio de fórmula
  de este sprint) y auto-explicación de Consistencia "Variable" (v1.16.0).
- Sprint Reportes Ejecutivos 2.0 — el Informe Mensual Consolidado pasa de
  exportación de tablas a informe ejecutivo: Resumen Ejecutivo, Hallazgos
  y Recomendaciones por reglas (sin IA, coexistiendo con el Análisis IA de
  Groq ya existente), interpretación de 4 partes por indicador, Mapa de
  Riesgo (Cumplimiento×Carga), tendencias automáticas mes/trimestre/
  semestre, e Índice Ejecutivo del Equipo (Performance Score + Equilibrio
  Operativo promediados, disponible solo para el mes en curso) — cero
  cambios al Analytics Engine (v1.17.0).
- Sprint Analytics 2.1 — Base Horaria Efectiva (compara a cada colaborador
  contra la base laboral del tramo en que realmente tuvo disponibilidad en
  NEXO, no el período completo), Generador Inteligente de Reportes (asistente
  de configuración: colaboradores, período de 7 presets, secciones, formato
  PDF Ejecutivo/Completo/Excel), Estado Operativo y Principal Hallazgo por
  colaborador en la tabla de detalle, interpretación de consultas extendida a
  informes de rango — cero cambios al Analytics Engine, cero cambios de
  fórmulas/pesos/KPIs existentes (v1.18.0).
- Sprint E — Analytics Predictivo e Inteligencia Preventiva: Trend Engine
  (8 indicadores, dirección/estabilidad, sin IA), 4 predicciones explicables
  (Cumplimiento/Sobrecarga/Subutilización/Retrasos) con confianza/
  confiabilidad/horizonte, Estabilidad Operativa, alertas preventivas
  priorizadas, simulador de escenarios (3 nuevos + 2 reutilizados de
  `/api/analytics/simulate`), gráficos de Tendencias Históricas, ventana
  histórica configurable por el Administrador (3/4/6/8/12 semanas,
  `/inteligencia-preventiva`, módulo nuevo y autónomo — cero cambios a
  Dashboard/Analytics/Reportes/Proyectos/Equipo, cero cambios al Analytics
  Engine central (v1.19.0 — este sprint).
- Sprint O — Centro de Configuración NEXO: `/settings` pasa de un acordeón
  plano de ~21 secciones a un módulo organizado por categoría (Organización,
  Analytics, Trabajo, Proyectos, Escritorio Digital, Reportes, NOVA,
  Seguridad, Notificaciones, Parámetros Globales, Sistema), con búsqueda
  global, favoritos (reutiliza `User.viewPreferences`, mismo patrón que el
  orden de tarjetas del Dashboard), historial de auditoría navegable (nueva
  UI sobre `SystemConfigHistory`, que ya existía) y restaurar-a-valor-
  predeterminado — Single Source of Truth para 9 valores que antes estaban
  hardcodeados (ventana de registro retroactivo, hora de corte de jornada,
  retención de archivado/tope de respuestas/presets de posposición de
  Escritorio Digital, TTL de caché de NOVA, longitud mínima de contraseña,
  duración de sesión, retención de intentos de login). Corrige además un
  bug real: Coordinador Nacional pasaba el gate de `/settings` pero
  `SettingsManager.tsx` escondía todo detrás de un gate más estricto —
  ahora la ruta es consistentemente Administrador-only. Cero cambios al
  Analytics Engine (v1.21.0 — este sprint).
- Executive Reporting Engine 2.0 — el Informe Mensual/de Rango pasa de
  "exportación de tablas" a documento ejecutivo de 11 páginas (Portada,
  Executive Summary, Estado General, Indicadores Estratégicos, Detalle por
  Colaborador, Distribución Operativa, Executive Insights, Executive
  Assessment by NOVA, Recomendaciones, Analytics Predictivo, Metadatos).
  Snapshot inmutable con Report ID propio (`NXR-YYYYMMDD-HHMMSS-XXXX`),
  fecha de corte real (filtra actividad/cumplimiento hasta esa fecha, no
  solo etiqueta), filtros de dominio unificados (período/rol/área/
  colaboradores), auditoría de generación/vista/degradación de NOVA, y
  backfill certificado del histórico previo (`MonthlyReport` →
  `ExecutiveReportSnapshot`, `origin=LEGACY_MIGRATION`). NOVA pasa de un
  único bloque de texto libre sin caché a 4 secciones estructuradas
  (Resumen/Insights/Assessment/Recomendaciones) con fallback determinista
  garantizado (nunca bloquea ni queda en blanco) — los escenarios
  predictivos de equipo quedan pendientes de una fase posterior (no existe
  aún el motor de predicción a nivel de equipo). Cero cambios al Analytics
  Engine ni a sus fórmulas; el flujo/UI existente (`MonthlyReports.tsx`,
  `/api/reports/generate|range|custom-range`) se conserva intacto — el motor
  nuevo se integró de forma aditiva (botones "PDF/Excel Ejecutivo 2.0"), no
  reemplaza todavía la experiencia actual (v1.22.0).
- Executive Reporting Engine 2.0 — repunte completo: `MonthlyReports.tsx` y
  `ReportWizardModal.tsx` consumen EXCLUSIVAMENTE el endpoint unificado
  (`POST /api/reports/executive` + `GET .../[reportId]` + `GET .../list`).
  Retirados por ser código muerto tras el repunte: 4 rutas antiguas
  (`/api/reports/generate|range|custom-range|route`), 7 componentes de
  presentación (`ExecutiveSummarySection`/`FindingsSection`/
  `RecommendationsSection`/`RiskMatrixChart`/`TrendsSection`/
  `TeamInsightsSection`/`IndicatorInterpretation`), `wizardExport.ts`
  completo, y los tipos `ReportData`/`RangeReportData`/`PeriodReportData`/
  `MonthlyReportSummary`/`MonthlyReportFull` (`MonthlyReport`, el modelo
  Prisma legacy, permanece intacto — ver `docs/DECISIONS.md`). La vista en
  pantalla pasa a reutilizar el mismo render HTML del PDF (`buildReportPages`
  + `buildExecutiveReportHtml`) en vez de una segunda implementación de
  componentes; 3 campos del snapshot que el documento de 11 páginas fijas no
  imprime (tendencias mes/trimestre/semestre, evolución mensual del rango,
  alertas de gestión) se conservan como paneles complementarios en pantalla,
  alimentados por el mismo snapshot congelado (v1.23.0).
- Migración de stack hacia skelleton_base — **Fase 1: núcleo de seguridad**
  (`backend/` Django+DRF+SQL Server, `frontend/` React+Vite): sesión
  revocable, catálogo de permisos granular, Argon2, protección de fuerza
  bruta, jerarquía de roles de Nexo modelada como datos (`apps.hierarchy`),
  comando de importación de usuarios legacy con fallback bcrypt→Argon2.
  Next.js/Prisma/PostgreSQL siguen sirviendo el 100% del tráfico real — el
  cutover es una fase futura (v1.27.0, ver `docs/AUDIT_LOG.md` §
  2026-08-07).
- Migración de stack hacia skelleton_base — **Fase 2: Cutover de
  Usuarios/Roles/Permisos**: login real de Next.js sin cambios (sigue
  100% contra Postgres/bcrypt); se agrega un login paralelo no bloqueante
  a Django y se corta `/admin/users` a Django (sin tocar `UsersManager.tsx`
  ni `admin/users/page.tsx`) — solo afecta a los 3 roles con `usuarios.*`.
  Cada endpoint de Django verificado directamente (login, listado, roles,
  crear, editar, cambiar rol, deshabilitar, resetear contraseña); la
  prueba end-to-end con Next.js real corriendo contra Postgres queda
  pendiente, sin bloquear (v1.28.0, ver `docs/AUDIT_LOG.md` § 2026-08-07).
- Migración de stack hacia skelleton_base — **Fase 3a: módulo Tareas, CRUD
  core + comentarios** (`backend/apps/tasks/`): ver/crear/editar/eliminar
  tareas y comentar, servido por Django (`Task`/`Comment`/
  `TaskCommentView`), sin tocar ningún componente React de
  `src/components/tasks/`. Permiso de eliminar más estrecho que ver/editar
  (replica la asimetría legacy: el asignado no puede borrar). Decisión
  explícita del usuario, con la consecuencia aceptada: la lista de tareas
  queda vacía para el 100% de los usuarios reales hasta que una fase
  posterior importe los datos de Postgres. Validación de Tiempo Objetivo/
  Fecha Fin, Cierre Inteligente, import/export e integración de
  notificaciones quedan en la hoja de ruta (sub-fases 3c-3f, ver
  "Planificado") — 93 tests pasando (v1.29.0, ver `docs/AUDIT_LOG.md` §
  2026-08-07).
- Migración de stack hacia skelleton_base — **Fase 3b: registro de horas**
  (`ActivityReason`/`TaskActivity` en `backend/apps/tasks/`): catálogo de
  motivos por rol, límite de 2 registros en tareas Fija, detección de
  solapamiento horario entre tareas Seguimiento (portada 1:1 vía
  `business_time.py`), recálculo de `Task.real_hours`. Sin registro
  retroactivo, comentarios de actividad, ni edición por Admin (sub-fases
  futuras) — 105 tests pasando (v1.30.0, ver `docs/AUDIT_LOG.md` §
  2026-08-07).
- Migración de stack hacia skelleton_base — **Fase 3c: validación
  individual de Tiempo Objetivo y Fecha Fin** (`TargetTimeAuditLog`/
  `EndDateAuditLog` en `backend/apps/tasks/`): autorización simplificada a
  `usuarios.editar` + "no soy el responsable" (equivalente verificado al
  legacy); reinicio automático a Pendiente al reeditar `end_date` tras una
  decisión; desviación histórica del proceso portada 1:1. Sin operaciones
  en bloque ni notificación al colaborador (sub-fases futuras) — 118 tests
  pasando (v1.31.0, ver `docs/AUDIT_LOG.md` § 2026-08-07).
- Migración de stack hacia skelleton_base — **Fase 3c-bulk: operaciones en
  bloque de Tiempo Objetivo/Fecha Fin + listado combinado de pendientes**
  (`CanRegularize`/`TaskValidationService` en `backend/apps/tasks/`):
  gate `CAN_REGULARIZE` (ADMINISTRADOR/JEFE_NACIONAL, más estrecho que
  `usuarios.editar`) para las 3 rutas; `bulk_validate`/`bulk_approve`
  reutilizan los servicios de validación individual de 3c por tarea;
  `GET /tasks/validations/pending` combina ambas dimensiones con % de
  calidad del dato. Sin notificación al colaborador (depende de
  `Notification`, todavía no migrado) — 138 tests pasando (v1.32.0, ver
  `docs/AUDIT_LOG.md` § 2026-08-07).
- Migración de stack hacia skelleton_base — **Fase 3d: Motor de Cierre
  Inteligente** (`MonthClosure`/`MonthClosureService` en
  `backend/apps/tasks/`; app nueva `backend/apps/configuration/` —
  `Holiday`/`SystemConfigHistory`, sin endpoints HTTP, alcance ampliado
  deliberadamente por decisión explícita del usuario): archivado mensual
  (FIJA cualquier estado, SEGUIMIENTO solo COMPLETADA), duplicación de
  tareas recurrentes con `shiftToNextMonth`, corrección de Admin sobre
  archivadas con auditoría en `MonthClosure.corrections`, Repositorio de
  solo lectura. `calendar_days_considered`/`working_days_considered`/
  `working_hours_considered` calculados con valores reales (no
  aproximados) — `/api/settings/holidays`/`workload-config` reales NO se
  cortan (evita split-brain con Postgres, ver `docs/AUDIT_LOG.md`). Gap de
  visibilidad en Repositorio (acotado a tareas propias, mismo patrón de
  3a) — 166 tests pasando (v1.33.0, ver `docs/AUDIT_LOG.md` §
  2026-08-07).
- Migración de stack hacia skelleton_base — **Fase 3e: import/export
  Excel de Tareas** (`task_import.py`/`TaskImportService` en
  `backend/apps/tasks/`): plantilla descargable y el importador masivo
  (`.xlsx`, `openpyxl`) cortados a Django — mismo orden de validaciones/
  mensajes que el legacy, cada fila independiente (sin transacción
  global), solo CREATE, auto-asignación si no hay email. El "export de
  seleccionadas" no requirió cambios: es 100% client-side y ya opera
  sobre datos de Django desde la Fase 3a. Ajuste compatible hacia atrás
  en `callDjango` para soportar `multipart/form-data` — 186 tests
  pasando (v1.34.0, ver `docs/AUDIT_LOG.md` § 2026-08-07).
- Migración de stack hacia skelleton_base — **Fase 3f: Notification,
  registro retroactivo, comentarios de actividad, edición por Admin de
  horas** (app nueva `backend/apps/notifications/`; `ActivityComment`/
  `ActivityAuditLog` en `backend/apps/tasks/`): cierra el módulo Tareas
  por completo. `Notification` sin endpoints HTTP (mismo patrón que
  Holidays en 3d) — se usa para cerrar 2 gaps ya documentados
  (comentarios de tarea desde 3a, cambio de Fecha Fin desde 3c) además de
  las 3 funcionalidades nuevas. Reglas de notificación con su valor
  DEFAULT hardcodeado, no configurable vía Django. **Con esta entrega,
  todas las sub-fases de Tareas (3a-3f) quedan migradas** — 219 tests
  pasando (v1.35.0, ver `docs/AUDIT_LOG.md` § 2026-08-11).
- Migración de stack hacia skelleton_base — **Fase 4a: KPIs/Analytics,
  base horaria + dependencias de datos nuevas** (app nueva
  `backend/apps/analytics/` — `workload.py`; `LeaveRecord`/
  `SpecialStatus` en `backend/apps/configuration/`; `User.kpi_start_date`):
  primera sub-fase del motor de KPIs/Analytics — porta la base horaria
  (conteo de días hábiles, sumas ponderadas por permisos/estado especial,
  semáforo de 5 zonas, Motor de Cierre Inteligente aplicado a la base
  mensual) y las 3 piezas de datos de las que depende casi todo el resto
  del motor. Sin endpoint HTTP todavía (mismo patrón que 3d/3f) —
  `compute_carga_tiempo`/`compute_carga_history` quedan para la sub-fase
  siguiente. Comparación en paralelo Next.js↔Django diferida hasta la
  importación real de datos — 245 tests pasando (v1.36.0, ver
  `docs/AUDIT_LOG.md` § 2026-08-11).
- Migración de stack hacia skelleton_base — **Fase 4b: KPIs/Analytics,
  primer endpoint real con corte de tráfico** (`GET /api/kpis/me` y
  `/api/kpis/[userId]` cortados a Django): completa
  `compute_carga_tiempo`/`compute_carga_history`/
  `redact_sensitive_workload_detail`; porta `risk_alerts.py`/
  `priority_compliance.py` completos y 3 funciones puntuales de
  `analytics.ts` (`compute_simple_score`/`compute_estimated_vs_real_ratio`/
  `validate_cumplimiento_consistency`, con `AnalyticsAuditLog`) — alcance
  ampliado a pedido explícito del usuario (opción agresiva sobre la
  recomendada). Visibilidad jerárquica y redacción de detalle sensible
  gateadas en la vista Django; `djangoKpisAdapter.ts` (nuevo, primer
  adaptador con transformación recursiva snake_case→camelCase en vez de
  mapeo campo por campo). `GET /api/kpis/me/range` (Definición A de
  cumplimiento) y el resto de `analytics.ts` quedan fuera de alcance —
  299 tests pasando (v1.37.0, ver `docs/AUDIT_LOG.md` § 2026-08-11).
- Migración de stack hacia skelleton_base — **Fase 4c: KPIs/Analytics,
  `GET /api/kpis/me/range`** (nuevos `compute_completed_pct_any`/
  `monthly_business_base_for_users`; `KpiMeRangeView`): cierra los 3
  endpoints personales de KPIs (junto con `/kpis/me`/`/kpis/[userId]`
  de 4b) — sub-fase elegida sobre el núcleo de scoring de `analytics.ts`
  por su tamaño acotado y alta reutilización de piezas ya portadas.
  Usa la Definición A de "cumplimiento", deliberadamente distinta de la
  Definición B de 4b. `djangoKpisAdapter.ts` reusado sin cambios — 316
  tests pasando (v1.38.0, ver `docs/AUDIT_LOG.md` § 2026-08-11).
- Migración de stack hacia skelleton_base — **Fase 4d: KPIs/Analytics,
  infraestructura común del núcleo de scoring ("Tanda A")**
  (`apps.analytics.normalization`/`target_time`/`history`;
  `get_effective_analytics_config` en `apps.configuration.services`):
  ninguna de las 4 piezas grandes (Health Score/Performance Score/
  Riesgo Operativo/Alertas del motor) es portable de forma aislada —
  se presentó la disyuntiva al usuario, eligió portar esta
  infraestructura común primero (curvas de normalización, histórico
  mensual/semanal, tendencias, consistencia) en vez de ir directo por
  Performance Score. Cierra de paso `compute_data_quality`/
  `compute_target_time_precision` (KPIs aditivos de bajo costo). Sin
  endpoint HTTP nuevo — 378 tests pasando (v1.39.0, ver
  `docs/AUDIT_LOG.md` § 2026-08-11).
- Migración de stack hacia skelleton_base — **Fase 4e: KPIs/Analytics,
  Performance Score** (`apps.analytics.performance_score.compute_performance_score`;
  `weighted_points`/`audit_calculation` en `scoring.py`): primera de
  las 4 piezas grandes del núcleo de scoring — la única aislable de
  Capacidad Proyectada (`capacityForecast.ts`, sin portar) por diseño
  explícito del legacy. 4 factores ponderados (Cumplimiento/Tareas
  vencidas/Consistencia/Índice de Trazabilidad) vía NormalizationEngine,
  auditados en `AnalyticsAuditLog`. Sin endpoint HTTP — no existe una
  ruta legacy aislada de solo Performance Score — 394 tests pasando
  (v1.40.0, ver `docs/AUDIT_LOG.md` § 2026-08-11).
- Migración de stack hacia skelleton_base — **Fase 4f: KPIs/Analytics,
  Capacidad Proyectada** (`apps.analytics.capacity_forecast`;
  `get_effective_workday_end_hour` en `configuration/services.py`): la
  dependencia común que faltaba para Equilibrio Operativo/Riesgo
  Operativo — proyección hacia adelante de horas disponibles vs.
  comprometidas en tareas EN_PROGRESO/PENDIENTE, confiabilidad basada
  solo en señales verificables. Sin endpoint HTTP — 415 tests pasando
  (v1.41.0, ver `docs/AUDIT_LOG.md` § 2026-08-11).
- Migración de stack hacia skelleton_base — **Fase 4g: KPIs/Analytics,
  Equilibrio Operativo** (`apps.analytics.health_score.compute_health_score`):
  2da pieza grande del núcleo de scoring — 5 factores ponderados
  (Cumplimiento/Carga laboral/Tareas vencidas/Consistencia/Capacidad
  futura), sin NormalizationEngine/curvas (a diferencia de Performance
  Score). Incluye `classify_estado_operativo` (escala de 5 niveles).
  Elegida sobre Riesgo Operativo por elección explícita del usuario.
  Sin endpoint HTTP — 438 tests pasando (v1.42.0, ver
  `docs/AUDIT_LOG.md` § 2026-08-11).
- Migración de stack hacia skelleton_base — **Fase 4h: KPIs/Analytics,
  Riesgo Operativo** (`apps.analytics.operational_risk.compute_operational_risk`):
  última pieza grande del núcleo de scoring (salvo Alertas del motor)
  — 8 factores de severidad ponderados (Sobrecarga/Vencidas críticas/
  Tendencia negativa/Horas extra/Baja capacidad/Variabilidad/
  Concentración/Sin planificación), tendencia vs. mes anterior y
  acciones sugeridas. Fidelidad exacta requerida por el propio legacy
  (Sprint 5 § S5-C). Sin endpoint HTTP — 464 tests pasando (v1.43.0,
  ver `docs/AUDIT_LOG.md` § 2026-08-11).
- Migración de stack hacia skelleton_base — **Fase 4i: KPIs/Analytics,
  motor de alertas automáticas** (`apps.analytics.alerts_engine.compute_alerts`/
  `get_resolved_alerts_history`): la función de mayor fan-in de todo
  `analytics.ts` — 8 reglas independientes (sobrecarga/capacidad
  crítica, subutilización prolongada, tareas vencidas ×2 umbrales,
  cumplimiento a la baja, horas extra inusuales, días consecutivos de
  sobrecarga, caída de registros, crecimiento de seguimiento).
  Distinto de `compute_risk_alerts` (Fase 4b) — 2 motores
  independientes. **Con esta entrega, el núcleo de scoring de
  `analytics.ts` queda completo en Django** (Performance Score/
  Equilibrio Operativo/Riesgo Operativo/Capacidad Proyectada/Alertas).
  Sin endpoint HTTP — 496 tests pasando (v1.44.0, ver
  `docs/AUDIT_LOG.md` § 2026-08-11).
- Migración de stack hacia skelleton_base — **Fase 4j: KPIs/Analytics,
  núcleo de la capa explicativa** (`apps.analytics.insights_engine` +
  `apps.analytics.audit_history`, nuevo): arranca el puerto de
  `insightsEngine.ts` (999 líneas) — confianza (★1-5), insights de
  Performance/Equilibrio Operativo (fortalezas/oportunidades
  bidireccionales), plantillas de significado/impacto por nivel de
  Estado Operativo, el orquestador `computeInsights` y la explicación
  de tendencia de score. Sin endpoint HTTP, sin auditoría propia — 551
  tests pasando (v1.45.0, ver `docs/AUDIT_LOG.md` § 2026-08-12).
- Migración de stack hacia skelleton_base — **Fase 4k: KPIs/Analytics,
  cierre de la capa explicativa** (`apps.analytics.insights_engine`
  extendido): relaciones entre indicadores (4 reglas deterministas sin
  ML), benchmark personal (historial propio vía `AnalyticsAuditLog`),
  reevaluación automática de recomendaciones (ventana de 14 días) y
  priorización (orden fijo de 4 criterios, top 3 + resto agrupado).
  **Con esta entrega, `insightsEngine.ts` queda 100% portado a
  Django.** 578 tests pasando (v1.46.0, ver `docs/AUDIT_LOG.md` §
  2026-08-12).
- Migración de stack hacia skelleton_base — **Fase 4l: KPIs/Analytics,
  Trend/Predictive Engine + Pipeline orquestador**
  (`apps.analytics.prediction`/`apps.analytics.pipeline`, nuevos):
  detección de anomalías, predicción simple (regresión lineal sobre
  horas semanales, confianza siempre <100%), validación de consistencia
  matemática entre KPIs y `run_analytics_pipeline` (el bundle
  orquestador que ensambla los 10 KPIs individuales). **Con esta
  entrega, el motor entero de `analytics.ts` queda portado a Django.**
  600 tests pasando (v1.47.0, ver `docs/AUDIT_LOG.md` § 2026-08-12).
- Migración de stack hacia skelleton_base — **Fase 4m: primer endpoint
  HTTP real de Analytics, `GET /api/analytics/[userId]`** (cutover
  completo Django↔Next.js, mismo patrón que Tareas/KPIs):
  `AnalyticsBundleView`/`build_analytics_bundle_payload` del lado
  Django, `djangoAnalyticsAdapter.ts` + reescritura de `route.ts` del
  lado Next.js. **Cierra por completo la migración de KPIs/Analytics
  (4a-4m).** 610 tests pasando (v1.48.0, ver `docs/AUDIT_LOG.md` §
  2026-08-12).
- Migración de stack hacia skelleton_base — **Fase 5a: módulo
  Proyectos, CRUD core** (nueva app `backend/apps/projects/`):
  `Project`/`ProjectParticipant`/`ProjectHistory`, permisos (réplica de
  `projectAccess.ts`, incluido el primer `ROLE_LEVEL` numérico de
  Django) y `ProjectViewSet` (`GET/POST /api/v1/projects/`,
  `GET/PATCH/DELETE /api/v1/projects/<id>/`) — mismo patrón que
  `TaskViewSet`. **Sin cutover de `route.ts` todavía** (decisión
  explícita: Django/Postgres son bases separadas, cortar ahora rompería
  las pestañas de Participantes/Fases/Actividades de un proyecto nuevo
  — ver `docs/AUDIT_LOG.md` § 2026-08-13). Fuera de alcance:
  ProjectPhase/ProjectActivity/ProjectComment/ProjectDocument,
  Participantes por endpoint propio, Papelera/Centro de Recuperación.
  644 tests pasando (v1.49.0, ver `docs/AUDIT_LOG.md` § 2026-08-13).
- Migración de stack hacia skelleton_base — **Fase 5b: Proyectos —
  Participantes, Comentarios e Historial** (extiende `apps.projects`):
  `ProjectComment` (nuevo) + `CommentService`
  (`GET/POST /comments`, sin evento de historial — Sprint 2.1 §1),
  `ParticipantService` (`POST /participants`,
  `DELETE /participants/<id>/` vía `ParticipantDetailView`, preserva
  los 2 `409 Conflict` del TS explícitos) y lectura de
  `GET /history`. Sigue **sin cutover de `route.ts`**. Fuera de
  alcance: Fases/Actividades (arrastran `businessTime.ts`/
  `systemConfig.ts`/`timeOverlap.ts`, sin portar), Documentos,
  Papelera. 660 tests pasando (v1.50.0, ver `docs/AUDIT_LOG.md` §
  2026-08-13).
- Migración de stack hacia skelleton_base — **Fase 5c: Proyectos —
  Fases** (extiende `apps.projects`): `ProjectPhase` (nuevo) +
  `PhaseService` — `POST /phases` (`order` autoincremental) y
  `PATCH|DELETE /phases/<id>/` vía `PhaseDetailView`, solo cambio de
  `status` genera historial FASE_ACTUALIZADA, eliminación es hard
  delete. `ProjectDetailSerializer` ahora incluye `phases`
  (`registered_minutes`/`participants` fijos en `0`/`[]` — dependen de
  `ProjectActivity`, sin portar). Sigue **sin cutover de `route.ts`**.
  Fuera de alcance: Actividades, Documentos, Papelera. 672 tests
  pasando (v1.51.0, ver `docs/AUDIT_LOG.md` § 2026-08-13).
- Migración de stack hacia skelleton_base — **Fase 5d: Proyectos —
  Documentos** (extiende `apps.projects`): `ProjectDocument` (nuevo) +
  `DocumentService` — `GET/POST /documents` y
  `GET /documents/<id>/` vía `DocumentDetailView`, versionado con
  `previous_version_id` (referencia suelta, sin FK, igual que el
  schema Prisma original), 413 explícito para archivos > ~4.5MB.
  `activity_id` no se porta (`ProjectActivity` sin portar). Sigue
  **sin cutover de `route.ts`**. Fuera de alcance: Actividades,
  Papelera. 684 tests pasando (v1.52.0, ver `docs/AUDIT_LOG.md` §
  2026-08-13).
- Migración de stack hacia skelleton_base — **Fase 5e: Proyectos —
  Actividades** (extiende `apps.projects`): `ProjectActivity` (nuevo) +
  `ActivityService.create_activity` — `GET/POST /activities` (acción de
  `ProjectViewSet`), sin validación de solapamiento de horarios (a
  diferencia de Tareas) ni endpoint separado para retroactivas (un solo
  método cubre ambos casos, según el TS). Corrección de una suposición
  desactualizada del ROADMAP: `businessTime.ts`/`systemConfig.ts`/
  `timeOverlap.ts` ya estaban portados vía Tareas 3b/3f. Cierra 3 huecos
  pendientes: `ProjectDocument.activity`, `registered_minutes`/
  `participants` reales por fase, `last_activity` en el detalle del
  proyecto. **Con esta entrega, Proyectos queda completo salvo
  Papelera/Centro de Recuperación y el cutover de `route.ts`.** Sigue
  **sin cutover de `route.ts`**. 703 tests pasando (v1.53.0, ver
  `docs/AUDIT_LOG.md` § 2026-08-14).
- Migración de stack hacia skelleton_base — **Fase 5f: Proyectos —
  cutover de `route.ts`** (`src/app/api/projects/**` +
  `src/lib/djangoProjectsAdapter.ts` nuevo): 10 rutas pasan de Prisma a
  Django (`GET/POST /projects`, `GET/PATCH /projects/[id]`,
  participantes, comentarios, historial, fases, documentos,
  actividades). `DELETE /projects/[id]` (enviar a la papelera) queda en
  Prisma sin cortar, mezclado con `GET`/`PATCH` (Django) en el mismo
  archivo — la Papelera de Proyectos sigue leyendo solo Postgres.
  `trash/route.ts`/`[id]/restore/route.ts`/`[id]/permanent/route.ts`
  sin tocar. Cierra 2 gaps de serializer (`roles`, 4 conteos) antes del
  corte. **Con esta entrega, Proyectos sirve tráfico real desde
  Next.js — completo salvo Papelera/Centro de Recuperación.** 706
  tests de Django pasando (v1.54.0, ver `docs/AUDIT_LOG.md` §
  2026-08-14). Sin prueba manual en navegador (entorno sin `.env` de
  Next.js con credenciales reales) — pendiente en un entorno real.
- Migración de stack hacia skelleton_base — **Fase 6a: Auth — cutover
  de Login** (`src/app/api/auth/login/route.ts` +
  `src/lib/djangoSession.ts`): primer paso del decommission completo
  de PostgreSQL (decisión explícita del usuario). El login real ya no
  decide contra Prisma/bcrypt — autentica contra
  `backend/apps/authentication/` (sistema ya maduro, sin necesidad de
  construir nada nuevo). **Modelo híbrido de IDs** (decisión explícita
  del usuario): Django valida la contraseña, pero `nexo-session` sigue
  guardando el `cuid` de Postgres vía `legacy_postgres_id` — los 19
  módulos que todavía dependen de
  `prisma.*(where: { id: session.userId })` no cambian. `src/lib/rate-
  limit.ts` se retira de esta ruta (Django ya cubre IP + `identifier`).
  Gaps aceptados: `must_change_password`/`lastLoginAt` sin portar.
  **Sin correr el import real de usuarios ni prueba en navegador**
  (sin `DATABASE_URL`/`LEGACY_POSTGRES_URL` reales en este entorno).
  711 tests de Django + 28 de Vitest (`auth.test.ts` reescrito)
  pasando (v1.55.0, ver `docs/AUDIT_LOG.md` § 2026-08-14). Hallazgo no
  relacionado y verificado como preexistente: 173 tests de Vitest ya
  fallaban en módulos cortados en fases previas (`cookies()` fuera de
  contexto de request en tests que no mockean `djangoSession`) —
  documentado, fuera de alcance de esta sub-fase.
- Migración de stack hacia skelleton_base — **Fase 6b: Auth — cutover
  de logout/me/change-password** (`src/app/api/auth/{logout,me,
  change-password}/route.ts`): cierra el resto del módulo Auth salvo
  `forgot-password` (requiere una pantalla nueva de confirmación por
  token, sin UI hoy — candidata a Fase 6c). `logout` ahora revoca la
  sesión real de Django y limpia sus cookies (antes quedaban vivas
  hasta expirar). `GET`/`PATCH /auth/me` pasan identidad a Django;
  `activityFormat`/`viewPreferences` queda como **excepción híbrida
  documentada** (sin campo equivalente en Django, `session.userId`
  sigue siendo el `cuid` de Postgres). `MeView` gana un `patch()` —
  antes no existía auto-servicio de perfil en Django (`PATCH
  /admin/users/{id}/` exige permiso administrativo). `change-password`
  adopta el comportamiento más rico de Django (revoca otras sesiones +
  email real) sin objeción. 715 tests de Django + 32 de Vitest
  pasando (v1.56.0, ver `docs/AUDIT_LOG.md` § 2026-08-17). Sin prueba
  manual en navegador (mismo motivo que fases anteriores).
- Migración de stack hacia skelleton_base — **Fase 6c: Auth — cutover
  de forgot-password** (`src/app/api/auth/forgot-password/route.ts` +
  nuevo `src/app/api/auth/reset-password/route.ts` + nueva pantalla
  `src/app/reset-password/page.tsx`): **cierra el módulo Auth por
  completo**, salvo la excepción híbrida de `activityFormat` (6b). Sin
  cambios de backend — `PasswordResetRequestView`/
  `PasswordResetConfirmView` de Django ya estaban completos. **Fix de
  seguridad incluido**: el stub anterior filtraba la existencia de una
  cuenta por email (mensaje distinto según el resultado) — Django
  responde siempre el mismo mensaje genérico. La pantalla nueva vive
  en `/reset-password` (URL fija, la arma
  `send_password_reset_email` del lado Django) y no autologuea tras el
  éxito (Django revoca todas las sesiones al confirmar el reset). 34
  tests de Vitest pasando, sin cambios de backend (v1.57.0, ver
  `docs/AUDIT_LOG.md` § 2026-08-17). **Sin prueba manual en
  navegador** — primera pantalla nueva de esta migración construida
  sin verificación visual, riesgo aceptado explícitamente por el
  usuario.
- Migración de stack hacia skelleton_base — **Fase 7a: Escritorio
  Digital — Notas, CRUD core** (nueva app `backend/apps/desk/`):
  primer módulo de negocio nuevo portado a Django desde cero tras
  completar Auth. `DeskNote`/`DeskNoteReply`/`DeskAuditLog` +
  `DeskNoteService`/`DeskNoteReplyService` — listado (`desk`/
  `archive`/`sent`), creación, acciones (`read`/`pin`/`unpin`/
  `archive`/`unarchive`, exclusivas del destinatario), respuestas
  cortas (límite configurable, 409), destinatarios válidos, contador
  de no leídas, historial de auditoría. Reusa
  `apps.notifications.services.notify()` (ya portado desde 3f) sin
  extenderlo. Hallazgo: el ROADMAP subestimaba las dependencias
  reales — `desk/today`/`convert-to-task`/`DELETE` (papelera) cruzan
  hacia Tarea/Proyecto/Centro de Recuperación, quedan fuera de esta
  sub-fase. Fuera de alcance también: adjuntos, `PersonalReminder`
  (Fase 7b). **Sin cutover de `route.ts`** — mismo criterio que
  Proyectos 5a-5e. 745 tests de Django pasando (v1.58.0, ver
  `docs/AUDIT_LOG.md` § 2026-08-17).
- Migración de stack hacia skelleton_base — **Fase 7b: Escritorio
  Digital — Recordatorios, CRUD core** (extiende `backend/apps/desk/`):
  `PersonalReminder` + `PersonalReminderService` — listado (filtros
  `status`/`from`/`to`/`archived`), creación, `PATCH` con una sola
  acción (`complete`/`postpone`/`reopen`/`archive`/`unarchive` o
  edición directa), `DELETE` (físico, sin Papelera — a diferencia de
  Notas), historial. Completar un recordatorio repetitivo genera
  automáticamente la siguiente ocurrencia. 404 (no 403) para un
  recordatorio de otro usuario, réplica exacta del TS. Fuera de
  alcance: `convert-to-task` (pese a que `Task` ya existe en Django,
  duplica los requisitos de creación — feature propia, Fase 7c),
  adjuntos, `desk/today`/`desk/search`. **Sin cutover de `route.ts`.**
  768 tests de Django pasando (v1.59.0, ver `docs/AUDIT_LOG.md` §
  2026-08-17).
- Migración de stack hacia skelleton_base — **Fase 7c: Escritorio
  Digital — `convert-to-task`** (extiende `backend/apps/desk/`):
  `PersonalReminder.converted_to_task`/`converted_to_task_at` (nuevos
  campos, migración `desk.0003`) + `PersonalReminderService.
  convert_to_task` + `POST /api/v1/desk-reminders/<id>/convert-to-
  task/` — reutiliza `TaskService.create_task` sin modificar Trabajo.
  Prioridad traducida a la escala de Trabajo (URGENTE colapsa en
  ALTA). El recordatorio original nunca se edita ni se elimina, solo
  queda marcado. 403 explícito (no 404) para quien no es el dueño —
  única acción del ViewSet que no filtra por dueño vía queryset,
  réplica de que en el TS es su propio `route.ts` aislado. Sin adjunto
  todavía (`PersonalReminder` no tiene adjuntos en Django). **Sin
  cutover de `route.ts`.** 777 tests de Django pasando (v1.60.0, ver
  `docs/AUDIT_LOG.md` § 2026-08-17).
- Migración de stack hacia skelleton_base — **Fase 7d: Escritorio
  Digital — Adjuntos de Notas** (extiende `backend/apps/desk/`):
  `DeskNote.attachment_name`/`attachment_mime`/`attachment_data`
  (nuevos campos, migración `desk.0004`) + `GET /api/v1/desk-notes/
  <id>/attachment/` (descarga bajo demanda, 404 antes que 403 —
  réplica exacta del orden del TS). Mismos límites que `saveAttachment`
  (8MB, extensiones `png`/`jpg`/`jpeg`/`pdf`/`doc`/`docx`/`xls`/
  `xlsx`), pero el cliente manda el adjunto como data URL en JSON en
  vez de `multipart/form-data` (mismo criterio que `ProjectDocument`,
  Fase 5d). Hallazgo: "Adjuntos (Notas y Recordatorios)" no era una
  sola pieza — Adjuntos de Recordatorios queda diferido junto con
  `convert-to-reminder` (único camino en el TS para que un recordatorio
  tenga adjunto). **Sin cutover de `route.ts`.** 787 tests de Django
  pasando (v1.61.0, ver `docs/AUDIT_LOG.md` § 2026-08-17).
- Migración de stack hacia skelleton_base — **Fase 7e: Escritorio
  Digital — `convert-to-reminder`** (extiende `backend/apps/desk/`):
  `DeskNote.converted_to_reminder`/`converted_at` (migración
  `desk.0005`) + `PersonalReminder.attachment_name`/`attachment_mime`/
  `attachment_data` (sin endpoint propio de subida/descarga, réplica
  exacta del TS) + `POST /api/v1/desk-notes/<id>/convert-to-reminder/`
  — exclusivo del destinatario (no del remitente), prioridad traducida
  1:1 (`NOTE_TO_REMINDER_PRIORITY`), la nota original nunca se edita ni
  se elimina. Gap aceptado: título truncado a 149 (no 150) caracteres
  antes del "…" — el TS permite 151 (cabe en el `String` sin límite de
  Postgres), Django limita a 150 (`CharField`, real en MSSQL). **Sin
  cutover de `route.ts`.** 799 tests de Django pasando (v1.62.0, ver
  `docs/AUDIT_LOG.md` § 2026-08-17).
- Migración de stack hacia skelleton_base — **Fase 7f: Escritorio
  Digital — Bandeja Hoy + Buscador** (extiende `backend/apps/desk/`):
  `GET /api/v1/desk/today/` (4 bloques de solo lectura: notas
  pendientes, recordatorios de hoy/vencidos, tareas próximas 7 días,
  proyectos con actividad reciente 7 días — reutiliza
  `business_calendar_day`/`business_day_real_range` de
  `apps.tasks.business_time`, Fase 3b) + `GET /api/v1/desk/search/`
  (buscador único, filtros `q`/`priority`/`date`/`sender`/`recipient`/
  `status` sobre Notas y Recordatorios). Sin bloqueos de alcance —
  `Task`/`Project` ya completos en Django. Ambas vistas son `APIView`
  simples, no `ViewSet` (agregaciones de solo lectura, sin recurso
  propio). **Sin cutover de `route.ts`.** 837 tests de Django pasando
  (v1.63.0, ver `docs/AUDIT_LOG.md` § 2026-08-17).
- Migración de stack hacia skelleton_base — **Fase 7g: Escritorio
  Digital — cutover de `route.ts`** (`src/lib/djangoDeskAdapter.ts`,
  `src/app/api/desk-notes/**`, `src/app/api/desk-reminders/**`,
  `src/app/api/desk/**`): 13 de 14 rutas pasan de Prisma/Postgres a
  Django/SQL Server — `DELETE /api/desk-notes/[id]` se queda en Prisma
  (Papelera, mismo gap que Proyectos Fase 5f; **cutover en la Fase 50**,
  ver `docs/AUDIT_LOG.md` § 2026-08-24). El adjunto de `POST
  /api/desk-notes` se codifica a base64 del lado del `route.ts` (el
  formulario sigue enviando `multipart/form-data`, sin cambios en
  `NewNoteModal.tsx`). Gap documentado: la purga automática de notas
  archivadas a los 15 días no se replica todavía (transversal). 1181
  tests de Vitest en verde (v1.64.0, ver `docs/AUDIT_LOG.md` §
  2026-08-18).
- Migración de stack hacia skelleton_base — **Fase 8: Reportes
  Ejecutivos, solo lectura de snapshots ya generados** (nueva app
  `backend/apps/reports/`): `ExecutiveReportSnapshot`/
  `ExecutiveReportAuditLog` (réplica de `prisma/schema.prisma`) +
  `GET /api/v1/reports/executive/list/` (paginado, filtrado por
  `scope` según el rol) + `GET /api/v1/reports/executive/<report_id>/`
  (lectura inmutable, audita `viewed`, réplica exacta de
  `ensureSnapshotMeta` para los 4 snapshots `LEGACY_MIGRATION` sin
  `data.meta`). El motor de generación (~3200 líneas, incluye
  narrativa IA vía NOVA/Groq) NO se porta en esta sub-fase — riesgo
  equivalente al Asistente LLM/RAG (punto 6). `MonthlyReport` (modelo
  legacy) tampoco se porta (sin consumidor propio). **Sin cutover de
  `route.ts`.** 852 tests de Django pasando (v1.65.0, ver
  `docs/AUDIT_LOG.md` § 2026-08-18).
- Migración de stack hacia skelleton_base — **Fase 9a: Inteligencia
  Preventiva — Trend Engine + predicciones explicables individuales**
  (`apps/analytics/trend_engine.py`/`prediction_engine.py`, nuevos):
  8 indicadores de dirección/estabilidad (regresión OLS + coeficiente
  de variación de residuos, sin IA) + predicciones de Cumplimiento/
  Sobrecarga/Estabilidad Operativa/Retraso de tarea/Retraso de
  proyecto/Subutilización de equipo, réplica exacta de
  `trendEngine.ts`/`predictionEngine.ts`. Se agregan
  `GET /api/v1/predictive/predictions/<user_id>/` (bundle: Cumplimiento
  + Sobrecarga + Estabilidad + hasta 10 predicciones de retraso de
  tareas abiertas del colaborador) y `GET /api/v1/predictive/trend/
  <user_id>/?weeks_back=<n>` (Trend Engine, con override opcional de
  ventana para Tendencias Históricas). Reutiliza por completo el motor
  de Analytics/Capacidad Proyectada ya portado (Fases 4/4f) — el único
  código nuevo genuino es el clasificador OLS del Trend Engine y las
  reglas determinísticas del Prediction Engine. Sin capa de caché con
  TTL, mismo gap ya aceptado en el bundle de Analytics (Fase 4m).
  Alertas preventivas (`preventiveIntelligence.ts`), `team-alerts`,
  `team-subutilization`, `project-delay`, `simulate/*` y el endpoint de
  configuración de ventana quedan deferidos a una sub-fase futura (ver
  punto 7 de "Planificado") — las funciones que los soportan
  (`compute_subutilizacion_predictions`/`compute_project_delay_prediction`)
  ya están portadas, solo falta su superficie HTTP. **Cutover de
  `route.ts` completado en la Fase 48** (ver `docs/AUDIT_LOG.md` §
  2026-08-24). 896 tests de Django pasando (v1.66.0, ver
  `docs/AUDIT_LOG.md` § 2026-08-18).
- Migración de stack hacia skelleton_base — **Fase 9b: Inteligencia
  Preventiva — Alertas Preventivas + wiring de equipo**
  (`apps/analytics/preventive_intelligence.py`, nuevo): réplica exacta
  de `preventiveIntelligence.ts` — `compute_preventive_alerts`
  (individual: Sobrecarga/Cumplimiento en caída/Subutilización/
  Estabilidad Operativa) y `compute_team_preventive_alerts` (equipo:
  Subutilización + Retrasos de proyecto en lote), ambas con severidad
  `roja/naranja/amarilla/verde` y orden estable descendente. Se agregan
  `GET /api/v1/predictive/alerts/<user_id>/`,
  `GET /api/v1/predictive/team-alerts/`,
  `GET /api/v1/predictive/team-subutilization/` y
  `GET /api/v1/predictive/project-delay/<project_id>/` — las 2 últimas
  reutilizan funciones ya portadas en la Fase 9a, sin lógica de cálculo
  nueva. `ROLE_LEVEL`/`role_level`/`is_leadership`/`can_view_team`/
  `get_subordinate_groups` se centralizan en
  `apps/hierarchy/services.py` (antes copia local en
  `apps.projects.permissions`, que se convirtió en el segundo
  consumidor real que su propio docstring anticipaba). Inteligencia
  Preventiva queda funcionalmente completa en Django salvo
  `simulate/*`/`prediction-window` (ver punto 7 de "Planificado").
  **Cutover de `route.ts` completado en la Fase 48** (ver
  `docs/AUDIT_LOG.md` § 2026-08-24). 927 tests de Django pasando (v1.67.0,
  ver `docs/AUDIT_LOG.md` § 2026-08-18).
- Migración de stack hacia skelleton_base — **Fase 9c: Inteligencia
  Preventiva — Simulador** (`apps/analytics/simulate_engine.py`/
  `serializers.py`, nuevos): 3 escenarios "qué pasaría si" que nunca
  persisten — `simulate_adjust_target_time` (nivel tarea),
  `simulate_add_participants` (nivel proyecto) y
  `simulate_redistribute_load` (bi-usuario), reutilizando por completo
  funciones puras ya portadas (`compute_capacity_forecast`/
  `compute_team_capacity_forecast`/`classify_capacity`/
  `capacity_to_score`/`weighted_points`/`compute_health_score`/
  `get_official_target_time`). Se agregan
  `POST /api/v1/predictive/simulate/<user_id>/`,
  `POST /api/v1/predictive/simulate/project/<project_id>/` y
  `POST /api/v1/predictive/simulate/redistribute/`. Primeros
  serializers de entrada de `apps.analytics` (antes 100% de solo
  lectura). Inteligencia Preventiva queda funcionalmente completa en
  Django salvo `prediction-window` (ver punto 7 de "Planificado").
  **Cutover de `route.ts` completado en la Fase 48** (ver
  `docs/AUDIT_LOG.md` § 2026-08-24). 951 tests de Django pasando (v1.68.0,
  ver `docs/AUDIT_LOG.md` § 2026-08-18).
- Migración de stack hacia skelleton_base — **Fase 10: Reuniones**
  (nueva app `apps.meetings`): `Meeting`/`MeetingInvitee` (réplica
  exacta de `prisma/schema.prisma`, incluyendo `MeetingInvitee.attended`,
  campo sin ningún endpoint/UI que lo lea o escriba en el TS actual —
  se porta fiel al esquema, sin agregar funcionalidad no solicitada) +
  integración real de Zoom (OAuth Server-to-Server, `apps/meetings/
  zoom.py` — primera llamada HTTP saliente del backend, se agrega
  `requests` a `requirements/base.txt`) con el mismo fallback simulado
  del TS si Zoom falla (credenciales ausentes, timeout, error HTTP).
  Otter.ai NO tiene ninguna integración de API que portar — confirmado
  exhaustivamente contra el TS: `otter_invited`/`otter_summary`/
  `otter_transcript_url` son 3 campos editados a mano por el anfitrión,
  sin llamada HTTP a otter.ai en ningún lado. Se agregan
  `GET/POST /api/v1/meetings/` y `GET/PATCH/DELETE /api/v1/meetings/
  <meeting_id>/`, réplica exacta de permisos (`can_create_meetings`
  como whitelist puntual de roles, NO un umbral de `role_level` —
  Coordinador ZS y Analista CC/Selección comparten nivel 2 pero solo
  Coordinador ZS crea reuniones; ver/editar/eliminar sin excepción de
  Administrador, solo anfitrión/invitado) y whitelist de campos
  editables por `PATCH`. **Sin cutover de `route.ts`.** 43 tests
  nuevos — 994 pasando en total (v1.69.0, ver `docs/AUDIT_LOG.md` §
  2026-08-19).
- Migración de stack hacia skelleton_base — **Fase 11: Mejora
  Continua** (nueva app `apps.ideas`): `ImprovementIdea`/`IdeaVote`/
  `IdeaStatusHistory` (réplica exacta de `prisma/schema.prisma`) — voto
  binario tipo "like" con toggle, conteo siempre on-the-fly (nunca
  desnormalizado) y máquina de estados lineal de 6 pasos
  (Propuesta→En revisión→Aprobada→En desarrollo→En pruebas→
  Implementada) con Rechazada como estado lateral + historial completo
  de transiciones. `get_visible_idea_author_ids` replica la excepción
  documentada del TS: Jefe Nacional y Coordinador Nacional ven TODAS
  las ideas (a diferencia de KPIs/Analytics/Informes), excepto las del
  Administrador. Adjunto con ciclo de vida ligado al estado: se
  enmascara en `GET` fuera de Propuesta y se purga de la base al salir
  de ese estado, réplica del doble mecanismo del TS. Se agregan
  `GET/POST /api/v1/ideas/`, `GET/PATCH /api/v1/ideas/<idea_id>/`
  (`PATCH` solo actualiza `progress`, no el `status`),
  `POST /api/v1/ideas/<idea_id>/vote/`,
  `PATCH /api/v1/ideas/<idea_id>/status/` (única ruta que NO filtra por
  visibilidad del autor, solo por `can_review_ideas` — asimetría real
  del TS, replicada fiel) y `GET /api/v1/ideas/<idea_id>/history/`.
  **Sin cutover de `route.ts`.** 57 tests nuevos — 1051 pasando en
  total (v1.70.0, ver `docs/AUDIT_LOG.md` § 2026-08-19). (Gap del badge
  "innovador" cerrado en la Fase 27, ver "Implementado" arriba.)
- Migración de stack hacia skelleton_base — **Fase 12: Solicitudes
  LOPD** (nueva app `apps.data_requests`): `DataSubjectRequest`
  (réplica exacta de `prisma/schema.prisma`) — cola de solicitudes de
  titulares (ACCESO/RECTIFICACION/ELIMINACION) gestionada 100%
  manualmente por un Administrador; investigado antes de portar y
  confirmado que NO existe borrado/anonimización real de datos
  automatizada en este módulo (`docs/RAT.md` ya lo documentaba
  explícitamente). `export_my_data` reúne los datos operativos del
  titular ya portados en fases previas (Tareas/Actividades/
  Comentarios/Reuniones/Ideas/Votos/solicitudes previas) en un JSON
  descargable, y registra la exportación como una solicitud ACCESO ya
  resuelta (trazabilidad). Alcance de esta sub-fase, decisión explícita
  del usuario: solo `DataSubjectRequest` — el gate de consentimiento
  (`User.dataConsentAccepted`, mecanismo distinto que bloquea el
  render de toda la app) queda deferido, sin campos agregados al
  modelo `User`. Se agregan `GET/POST /api/v1/data-requests/`,
  `PATCH /api/v1/data-requests/<request_id>/` (solo Administrador) y
  `GET /api/v1/data-requests/my-data/`. **Sin cutover de `route.ts`.**
  27 tests nuevos — 1078 pasando en total (v1.71.0, ver
  `docs/AUDIT_LOG.md` § 2026-08-19).
- Migración de stack hacia skelleton_base — **Fase 13: Centro de
  Configuración, arranque acotado** — cierra 2 cabos sueltos deferidos
  en fases previas: `GET/PUT /api/v1/settings/prediction-window/`
  (`PredictionWindowSettingsView`, primera superficie HTTP de
  `apps.configuration`, deferido de la Fase 9c) y el gate de
  consentimiento (`data_consent_accepted`/`data_consent_accepted_at`
  agregados a `apps.users.models.User`, deferido de la Fase 12):
  `PATCH /api/v1/auth/consent/` (auto-servicio) +
  `POST /api/v1/admin/users/<id>/reset-consent/` +
  `POST /api/v1/admin/users/reset-consent-all/` (nuevas `@action` de
  `UserAdminViewSet`). `reset-consent` reutiliza el catálogo de
  permisos ya establecido (`usuarios.editar`); `reset-consent-all`
  (masivo, irreversible) replica el chequeo estricto y literal del TS
  (`IsAdministrator`, solo rol ADMINISTRADOR) — única acción del
  viewset que exige el rol en vez de un permiso del catálogo, decisión
  consciente. Bug real encontrado y corregido durante el desarrollo:
  `AuditLog.previous_values`/`new_values` (`JSONField` sin
  `DjangoJSONEncoder`) no soportaban un `datetime` crudo. **Sin
  cutover de `route.ts`.** 13 tests nuevos — 1091 pasando en total
  (v1.72.0, ver `docs/AUDIT_LOG.md` § 2026-08-19).

- Migración de stack hacia skelleton_base — **Fase 14: Papelera
  transversal / Centro de Recuperación** — nueva app `backend/apps/
  recovery/` (`RecoveryItem`/`RecoveryAuditLog` + `ENTITY_REGISTRY`,
  patrón abierto/cerrado de adaptadores por tipo de entidad, réplica de
  `recoveryCenter.ts`). Asimetría fiel al TS, decisión explícita del
  usuario: Proyectos gana el flujo completo (`GET /projects/trash/`,
  `POST /projects/<id>/restore/`, `DELETE /projects/<id>/permanent/`),
  Notas de Escritorio Digital solo `DELETE /desk-notes/<id>/` (mover a
  la papelera) — no existen rutas de restaurar/listar/eliminar-
  definitivo para notas ni en el TS ni en su frontend. Se incluye
  también `purge_expired_archived_notes()` (`apps/desk/services.py`,
  mecanismo independiente de `RecoveryItem`, cierra el gap documentado
  desde la Fase 7g). Orden manual de códigos 404→409→403 en
  `restore`/`permanent`/`destroy` (mismo patrón de Reuniones/Ideas/
  LOPD). **Lado Proyectos cutover en la Fase 39, lado Notas en la
  Fase 50** (ver Fases 39/50). 38 tests nuevos — 1129 pasando
  en total (v1.73.0, ver `docs/AUDIT_LOG.md` § 2026-08-20).

- Migración de stack hacia skelleton_base — **Fase 15: Notificaciones,
  superficie HTTP** (`backend/apps/notifications/views.py`) — cierra un
  gap documentado desde la Fase 3f (2026-08-11): `apps.notifications`
  ya tenía modelo + `notify()`/`notify_many()` portados y consumidos
  internamente por Tareas/Proyectos/Escritorio Digital/Reuniones/
  Ideas/LOPD, pero sin endpoints HTTP propios. `GET/PATCH
  /notifications/` (`NotificationListView`, lista + marcar-todas-
  leídas, resuelve `task_assigned_to_id` actual ya que `task_id` no es
  FK) + `PATCH /notifications/<id>/` (`NotificationDetailView`, marca
  una sola — réplica fiel del `updateMany` silencioso del TS, sin 404/
  403 para id ajeno o inexistente). **Sin cutover de `route.ts`,
  deliberadamente** (a diferencia de otros módulos ya completos): el
  TS se alimenta también de módulos que todavía no migraron a Django
  (Nova/Dashboard) — cortar el endpoint mostraría una lista incompleta
  a usuarios reales. 13 tests nuevos — 1142 pasando en total (v1.74.0,
  ver `docs/AUDIT_LOG.md` § 2026-08-20).

- Migración de stack hacia skelleton_base — **Fase 16: Analytics, 3
  rutas delgadas individuales** (`backend/apps/analytics/views.py`) —
  primeras 3 de las 16 rutas delgadas de Analytics identificadas
  (revisado hacia arriba de la estimación "~10" del ROADMAP): `GET
  /analytics/insights/<user_id>/` (`InsightsView`, Motor de Insights
  completo — Decision Intelligence Engine), `GET /analytics/
  equilibrio/<user_id>/` (`EquilibrioView`, interpretación de
  Equilibrio Operativo) y `GET /analytics/operational-risk/
  <user_id>/` (`OperationalRiskView`, Riesgo Operativo + confianza/
  tendencia). Las 3 son 100% ensamblado HTTP sobre motor YA portado
  (`insights_engine.py` completo desde Fase 4j/4k, `health_score.py`/
  `operational_risk.py`/`history.py`/`pipeline.py` desde Fase 4).
  Nuevo `can_view_operational_risk` (`apps/analytics/permissions.py`,
  whitelist de roles puntual, mismo criterio que `can_create_meetings`
  de Reuniones) y `reliability_pct_from_stars` (`explain.py`).
  Benchmarks Inteligente (requiere portar `computeSmartBenchmark`/
  `computePersonalEvolution`, motor nuevo) y las 12 rutas restantes
  quedan explícitamente deferidas a sub-fases futuras. **Cutover de
  `route.ts` completado en la Fase 47** (ver `docs/AUDIT_LOG.md` §
  2026-08-24). 32 tests nuevos — 1174 pasando en total (v1.75.0,
  ver `docs/AUDIT_LOG.md` § 2026-08-20).

- Migración de stack hacia skelleton_base — **Fase 17: Analytics, 3
  rutas delgadas más** (`backend/apps/analytics/views.py`) — continúa
  el cierre de rutas delgadas de la Fase 16: `GET /analytics/
  history/<user_id>/` (`HistoryView`, histórico de evolución vía
  `get_score_series`), `GET /analytics/target-time/<user_id>/`
  (`TargetTimePrecisionView`, `compute_target_time_precision`) y `GET
  /analytics/data-quality/?scope=self|team` (`DataQualityView`,
  reutiliza `get_team_members`/`can_view_team` ya usados por
  Inteligencia Preventiva). Las 3 son 100% ensamblado sobre motor YA
  portado. Deferidos con motivo documentado: `diagnostics` (depende de
  instrumentación de proceso — contadores de caché/validaciones —
  nunca portada a Django) y `simulate/<user_id>` KPI-level (simulador
  de 8 escenarios, motor sustancial nuevo, no una ruta delgada).
  **Cutover de `route.ts` completado en la Fase 47** (ver
  `docs/AUDIT_LOG.md` § 2026-08-24). 14 tests nuevos — 1188 pasando en
  total (v1.76.0, ver `docs/AUDIT_LOG.md` § 2026-08-20).

- Migración de stack hacia skelleton_base — **Fase 18: Equipo**
  (nueva app `backend/apps/team/`) — primer módulo de negocio nuevo
  desde Notificaciones (Fase 15), sin dependencia del motor de
  Analytics: `GET /team/` (`TeamListView`, lista de subordinados con
  conteo de tareas por estado y email enmascarado) + `GET /team/
  <user_id>/tasks/` (`TeamMemberTasksView`, tareas activas de un
  subordinado puntual, nunca migrada en el cutover de Tareas Fase 3a
  porque Django solo expone tareas del propio usuario autenticado).
  Nuevo `mask_email` (`apps/core/mask_email.py`). Asimetría de
  enmascarado entre las 2 rutas replicada fiel al TS (`GET /team/`
  enmascara, `GET /team/<id>/tasks/` no). Hallazgo documentado, fuera
  de alcance: `apps.projects` (ya en producción) nunca enmascara
  emails pese a que el TS lo hace ahí. `kpis/team`/`kpis/team-
  capacity`/`kpis/executive` quedan deferidas — requieren un concepto
  de permiso nuevo (`isExecutorRole`, distinto de `is_leadership` ya
  existente). **Cutover de `route.ts` (`GET /team/` + `GET
  /team/<id>/tasks/`) completado en la Fase 46** (ver
  `docs/AUDIT_LOG.md` § 2026-08-24). 17 tests nuevos — 1205
  pasando en total (v1.77.0, ver `docs/AUDIT_LOG.md` § 2026-08-20).

- Migración de stack hacia skelleton_base — **Fase 19: Analytics,
  `kpis/team` + `kpis/team-capacity`** (`backend/apps/analytics/views.py`)
  — introduce `is_executor_group`/`get_subordinate_executor_groups`
  (`apps/hierarchy/services.py`, `ROLE_LEVEL>=4`) explícitamente
  DISTINTO de `is_leadership` (`ROLE_LEVEL>=3`, ya existente) — mismo
  nombre conceptual, umbral y uso diferentes, verificado con un test
  dedicado. `GET /kpis/team-capacity/` (`TeamCapacityView`, reutiliza
  `compute_team_capacity_forecast`) + `GET /kpis/team/?month=YYYY-MM`
  (`TeamKpiView`, snapshot mensual de score/cumplimiento/carga/
  capacidad por subordinado ejecutor) — ambas 100% ensamblado sobre
  motor ya portado. `kpis/executive` queda deferida (~326 líneas TS,
  tendencia de 6 meses + bloque "CEO" — motor de síntesis propio
  sustancialmente mayor). **Cutover de `route.ts` completado en la
  Fase 47** (ver `docs/AUDIT_LOG.md` § 2026-08-24). 14 tests
  nuevos — 1219 pasando en total (v1.78.0, ver `docs/AUDIT_LOG.md` §
  2026-08-20).

- Migración de stack hacia skelleton_base — **Fase 20: Analytics,
  `operational-risk/team`** (`backend/apps/analytics/views.py`) — `GET
  /analytics/operational-risk/team/` (`TeamOperationalRiskView`),
  reutiliza `compute_operational_risk` por subordinado ejecutor.
  Efecto lateral portado: `notify_if_high_risk` (notificación
  automática al superior directo cuando el riesgo es Alto/Crítico,
  deduplicada una vez por persona/mes) — nuevo campo `Notification.
  dedup_key` (migración, primer campo agregado a `Notification` desde
  su creación en la Fase 3f), ya que el marcador de texto libre del TS
  (`taskId` como `String`) no es portable al `task_id` entero real de
  Django. Usa el conjunto de destinos de notificación POR DEFECTO
  (`get_notification_target_groups`) — el override configurable de
  Ajustes → Reglas de Notificación queda como gap documentado.
  `recommendations/team` queda fuera de alcance (requiere
  `computeTeamRecommendations`, motor de ~100 líneas + Matriz de
  Compatibilidad Operativa configurable, no portado). **Cutover de
  `route.ts` completado en la Fase 47** (ver `docs/AUDIT_LOG.md` §
  2026-08-24). 13 tests nuevos — 1232 pasando en total (v1.79.0, ver
  `docs/AUDIT_LOG.md` § 2026-08-20).

- Migración de stack hacia skelleton_base — **Fase 21: Analytics,
  `kpis/executive`** (`backend/apps/analytics/services.py`) — cierra
  el dashboard ejecutivo, la ruta delgada de Analytics deferida más
  grande (~326 líneas TS), confirmando que no requería motor nuevo:
  `GET /kpis/executive/` (`ExecutiveDashboardView` +
  `build_executive_dashboard_payload`) — snapshot de 6 meses de los
  subordinados ejecutores, ranking con tendencia, alertas de
  cumplimiento/sobrecarga, ideas pendientes (`apps.ideas`) y un bloque
  "CEO" (Performance Score/Riesgo Operativo promedio, estado global,
  heurísticas de "cambios"/"atender"). 100% ensamblado sobre motor ya
  portado (Fases 4a-4h/9b/19), cero lógica de negocio nueva. Gateado
  por `is_leadership` (`ROLE_LEVEL>=3`) para el actor, distinto del
  filtro `isExecutorRole` (`ROLE_LEVEL>=4`) aplicado a los sujetos del
  dashboard. Con esta entrega, 10 de las ~16 rutas delgadas de
  Analytics quedan cerradas — restan Benchmarks Inteligente,
  `simulate` KPI-level, `diagnostics` y `recommendations/team` (los 4
  casos que requieren motor nuevo o instrumentación ausente).
  **Cutover de `route.ts` completado en la Fase 47** (ver
  `docs/AUDIT_LOG.md` § 2026-08-24). 6 tests nuevos — 1238 pasando en
  total (v1.80.0, ver `docs/AUDIT_LOG.md` § 2026-08-20).

- Migración de stack hacia skelleton_base — **Fase 22: Analytics,
  Benchmarks Inteligente** (nuevo `backend/apps/analytics/benchmark.py`)
  — cierra el mayor de los 4 casos de Analytics que requerían motor
  nuevo (Sprint 7). `GET /analytics/benchmarks/<user_id>/`
  (`BenchmarkView`): 3 modos automáticos por indicador —`cargo`
  (≥3 pares del mismo cargo), `cargo-limitado` (2), `personal`
  (0-1, contra el propio historial + objetivo del cargo si está
  configurado). La investigación previa confirmó cero gap de motor
  real: `get_factor_audit_history`/`closest_factor_point` (Fase 4j/9),
  `compute_monthly_history`/`compute_weekly_history` (Fase 4a-4b) se
  reutilizan directamente. Nuevo `get_effective_role_target`
  (`apps/configuration/services.py`, JSON en `SystemConfigHistory`,
  mismo mecanismo que curvas de normalización — solo lectura, sin
  endpoint HTTP) y `reliability_pct_from_observations`
  (`explain.py`, deferida desde la Fase 16). Nunca cruza cargos
  distintos aunque compartan `ROLE_LEVEL`. Con esta entrega, 11 de las
  ~16 rutas delgadas de Analytics quedan cerradas — restan `simulate`
  KPI-level, `diagnostics` y `recommendations/team`. **Cutover de
  `route.ts` completado en la Fase 47** (ver `docs/AUDIT_LOG.md` §
  2026-08-24). 32 tests nuevos — 1270 pasando en total (v1.81.0, ver
  `docs/AUDIT_LOG.md` § 2026-08-20).

- Migración de stack hacia skelleton_base — **Fase 23: Analytics,
  simulador KPI-level** (nuevo `backend/apps/analytics/kpi_simulate.py`)
  — cierra `analytics/simulate/[userId]`, el simulador interactivo
  MÁS ANTIGUO de Analytics (§9, ampliado en Sprint A), confirmando que
  no requería motor nuevo: `classify_capacity` (Fase 4f) ya anticipaba
  este puerto en su propio docstring. `POST /analytics/simulate/
  <user_id>/` (`SimulateKpiView`) — 8 escenarios que NUNCA persisten
  nada, reutilizando `compute_health_score`/`compute_performance_score`/
  `compute_capacity_forecast`/`capacity_to_score`/`carga_health_score`/
  `weighted_points`/`normalize`/`compute_workload_range`/
  `compute_carga_tiempo`/`monthly_business_base` (todas ya portadas).
  Módulo nuevo separado de `simulate_engine.py` (Fase 9c, simulador
  DISTINTO sobre predicciones) para no confundir dos dominios con el
  mismo nombre coloquial. Validación de escenario manual
  (`is_valid_scenario`, unión discriminada por `type`), primer caso de
  este patrón en el proyecto. Con esta entrega, 12 de las ~16 rutas
  delgadas de Analytics quedan cerradas — restan `diagnostics` y
  `recommendations/team`. **Cutover de `route.ts` completado en la
  Fase 47** (ver `docs/AUDIT_LOG.md` § 2026-08-24). 44 tests
  nuevos — 1314 pasando en total (v1.82.0, ver `docs/AUDIT_LOG.md` §
  2026-08-20).

- Migración de stack hacia skelleton_base — **Fase 24: Analytics,
  `recommendations/team`** (nuevo `backend/apps/analytics/recommendations.py`)
  — cierra el Motor Determinista de Recomendaciones (Compatibilidad
  Organizacional). `GET /analytics/recommendations/team/`
  (`TeamRecommendationsView`) — redistribución de carga con impacto
  cuantificado entre subordinados ejecutores, 5 reglas de negocio
  (mismo cargo primero, Matriz de Compatibilidad Operativa como
  respaldo, nunca redistribución vertical, tope de 5 sobrecargados
  evaluados, mensaje explícito sin candidato). Nuevo
  `get_effective_role_compatibility` (`apps/configuration/services.py`,
  mismo mecanismo JSON que `get_effective_role_target`, Fase 22).
  Reutiliza `compute_team_capacity_forecast` (Fase 9b),
  `classify_capacity`/`capacity_to_score` (Fase 4f/4g) y
  `prioritize_recommendations` (Fase 4k, sin consumidor HTTP hasta
  ahora — su forma ya coincidía exactamente con `TeamRecommendation`).
  Con esta entrega, 13 de las ~16 rutas delgadas de Analytics quedan
  cerradas — resta únicamente `diagnostics` (sin backend, fuera de
  alcance). **Cutover de `route.ts` completado en la Fase 47** (ver
  `docs/AUDIT_LOG.md` § 2026-08-24). 23 tests nuevos — 1337 pasando en
  total (v1.83.0, ver `docs/AUDIT_LOG.md` § 2026-08-20).

- Migración de stack hacia skelleton_base — **Fase 25: Dashboard**
  (nuevas `backend/apps/dashboard/`, `backend/apps/announcements/`) —
  primer módulo de negocio nuevo desde Equipo (Fase 18) que no es una
  ruta delgada de Analytics. `GET /dashboard/` (`build_dashboard_payload`)
  — réplica exacta de `src/app/api/dashboard/route.ts` (~320 líneas):
  tareas prioritarias, estadísticas por período, % de carga/cumplimiento
  (motor central), feed de actividad del área, alertas de equipo,
  comunicados, próximas reuniones, proyectos propios, mensaje de
  bienvenida — 100% ensamblado sobre motor ya portado. `PATCH
  /dashboard/card-order/` — orden de tarjetas. **Gap real descubierto:**
  `Announcement` (Prisma) no tenía equivalente Django — se portó
  completo como `apps.announcements` nuevo (modelo + GET/POST/DELETE).
  `User.badges`/`User.view_preferences` (campos nuevos) cierran gaps
  documentados desde la Fase 12; `User.lastLoginAt` se replica
  reutilizando `last_login` nativo (nunca escrito en ninguno de los 2
  sistemas). `nova-message` (Nova/Groq) queda explícitamente fuera de
  alcance. **`GET /dashboard/` cutover completo en la Fase 51 —
  `PATCH /dashboard/card-order/` sigue sin cutover** (comparte
  `User.viewPreferences` con `favorites`, ver Fase 51). 34 tests
  nuevos — 1367 pasando en total (v1.84.0, ver `docs/AUDIT_LOG.md` §
  2026-08-20).

- Migración de stack hacia skelleton_base — **Fase 26: cabos sueltos
  de auto-servicio** (nuevo `backend/apps/users/self_service_views.py`,
  `DayScheduleView` en `apps/tasks`) — barrido completo de
  `src/app/api/**/route.ts` confirmó que `repository`/`repository/
  <year>/<month>` y `auth/reset-password` YA estaban cortados a Django
  (Fases 3d/6c). Portó las 3 rutas pequeñas restantes sin motor
  propio: `GET /users/assignable/` (usuarios visibles, incluye al
  propio actor), `PATCH /users/<id>/theme/` (nuevo `User.theme`,
  mismo gap documentado desde la Fase 12 que `badges`/
  `view_preferences`) — ambas en un módulo de auto-servicio nuevo,
  separado de `UserAdminViewSet` (`admin/users/`) — y `GET
  /activities/day-schedule/` (validación de solapamiento de horario,
  reutiliza `business_time.py` ya portado). **Sin cutover de
  `route.ts`.** 15 tests nuevos — 1382 pasando en total (v1.85.0, ver
  `docs/AUDIT_LOG.md` § 2026-08-20).

- Migración de stack hacia skelleton_base — **Fase 27: Gamificación
  de perfil** (nuevo `backend/apps/users/badges.py`) — `GET
  /profile/badges/` (`BadgesView` + `compute_and_persist_badges`):
  calcula 6 insignias (Cumplidor/Confiable/Colaborador/Innovador/
  Constante/Mentor) sobre Tareas/Comentarios/Actividades ya portados,
  persiste en `User.badges` las recién ganadas. Cierra de paso el gap
  del badge "innovador" en `apps.ideas` documentado desde la Fase 11
  (`change_idea_status` ahora lo asigna al autor cuando una idea llega
  a IMPLEMENTADA — el campo `User.badges` recién existe desde la Fase
  25). Cero motor nuevo. **Sin cutover de `route.ts`.** 25 tests
  nuevos — 1407 pasando en total (v1.86.0, ver `docs/AUDIT_LOG.md` §
  2026-08-20).

- Migración de stack hacia skelleton_base — **Fase 28: Centro de
  Configuración, 6 endpoints de bajo riesgo** — continúa el "arranque
  acotado" de la Fase 13 con `GET /settings/retroactive-window/` +
  `GET /settings/snooze-presets/` + `GET/PATCH /settings/favorites/`
  (reutiliza `User.view_preferences`, mismo truco que `card-order`) +
  `GET/PUT /settings/welcome-message/` + `GET/PATCH
  /settings/role-targets/` + `GET/PATCH /settings/role-compatibility/`
  (con la Regla 4 dura validada en la vista) — las 6 con backing ya
  portado (Fases 3f/22/24/25) o trivial de agregar. `ROLE_LABEL`/
  `ALL_ROLES` centralizados en `apps.hierarchy.services` (mismo
  criterio que `ROLE_LEVEL`, Fase 9b). El resto del catálogo
  `settings/*` (~25 rutas más) sigue sin planificar en detalle. **De
  estas 6, `retroactive-window`/`snooze-presets` cutover en la Fase 36,
  `role-targets`/`role-compatibility` en la Fase 49 y `welcome-message`
  en la Fase 51 — solo `favorites` sigue sin cutover** (ver Fases
  36/49/51). 36 tests nuevos — 1443 pasando en total (v1.87.0, ver
  `docs/AUDIT_LOG.md` § 2026-08-20).

- Migración de stack hacia skelleton_base — **Fase 29: Centro de
  Configuración, CRUD de Feriados/Permisos/Estados Especiales** —
  cierra la superficie HTTP de `Holiday`/`LeaveRecord`/`SpecialStatus`
  (modelos ya existentes desde la Fase 4a, "tabla interna sin endpoint
  HTTP, gestionada vía Django Admin"). `GET/POST /settings/holidays/`
  + `DELETE /settings/holidays/<id>/`; `GET/POST /settings/leave-records/`
  + `DELETE /settings/leave-records/<id>/` (crea UN registro por cada
  día laborable del rango, nunca uno por todo el período); `GET/POST
  /settings/special-status/` + `PATCH/DELETE
  /settings/special-status/<id>/` (`PATCH` finaliza el estado hoy,
  nunca lo extiende) — las 3 rutas 100% ADMINISTRADOR (lectura y
  escritura), reutilizando `is_working_day`/`get_holiday_set` ya
  portados. `activity-reasons` (mismo perfil, prefijo distinto) queda
  para una fase futura. **Cutover de `route.ts` completado en la Fase
  52** (ver `docs/AUDIT_LOG.md` § 2026-08-24) — que también corrigió
  un bug de permisos introducido acá (`GET /settings/holidays/`
  exigía ADMINISTRADOR por error; el `route.ts` real nunca lo
  restringió). Sin migraciones nuevas (modelos preexistentes). 44
  tests nuevos — 1487 pasando en total (v1.88.0, ver
  `docs/AUDIT_LOG.md` § 2026-08-20).

- Migración de stack hacia skelleton_base — **Fase 30: Centro de
  Configuración, CRUD de Motivos de Actividad** — cierra
  `activity-reasons`, deferido de la Fase 29 por vivir en un prefijo
  de URL distinto. `POST /settings/activity-reasons/` (genera `key`
  única vía `_slugify_activity_reason_key`, réplica exacta de
  `slugifyKey`: NFD, sin diacríticos, mayúsculas, no-alfanumérico→`_`,
  `"MOTIVO"` si vacío, con sufijo numérico en colisión) + `PATCH
  /settings/activity-reasons/<id>/` (archivar fuerza `is_active=False`;
  restaurar NO reactiva automáticamente — asimetría fiel). Ambas solo
  ADMINISTRADOR. `ActivityReason` ya existía completo desde la Fase
  3b — cero motor nuevo, cero migraciones. **Sin cutover de
  `route.ts`.** 17 tests nuevos — 1504 pasando en total (v1.89.0, ver
  `docs/AUDIT_LOG.md` § 2026-08-21).

- Migración de stack hacia skelleton_base — **Fase 31: Centro de
  Configuración, 5 endpoints más** — `GET/PUT /settings/workload-config/`
  + `GET/PATCH /settings/kpi-start-date/` + `GET/PUT
  /settings/retention-policy/` (solo la política; la purga real queda
  fuera, requiere modelos no portados) + `GET/PUT
  /settings/escritorio-digital-config/` (nuevo
  `set_snooze_presets_minutes` — Fase 28 lo había dejado sin
  escritura por falta de consumidor real; esta ruta sí lo tiene) +
  `GET/PATCH /settings/analytics-config/` (26 claves, validado
  manualmente: sumas de ponderación + orden de umbrales contra
  valores vigentes). Backing 100% preexistente en 4 de las 5 (Fases
  4a/4d/7a/14/28). Todas ADMINISTRADOR salvo `analytics-config`
  (whitelist de 3 roles, `can_manage_users`). **De estas 5,
  `escritorio-digital-config` cutover en la Fase 36 y
  `workload-config`/`kpi-start-date` en la Fase 52 — `retention-policy`/
  `analytics-config` siguen sin cutover** (ver Fases 36/52). Sin
  migraciones nuevas. 39 tests nuevos — 1543 pasando en total
  (v1.90.0, ver `docs/AUDIT_LOG.md` § 2026-08-21).

- Migración de stack hacia skelleton_base — **Fase 32: Centro de
  Configuración, 4 endpoints más** — `GET/PATCH
  /settings/normalization-curves/` (6 curvas del motor de Analytics,
  nuevo `set_curve_config`, backing ya existente desde la Fase 4d) +
  `GET/PUT /settings/seguridad-config/` (longitud mínima de
  contraseña + retención de intentos de login, claves nuevas;
  duración de sesión ya existente desde la Fase 6a — gap documentado:
  `password_min_length` no se enforce todavía en el cambio de
  contraseña de Django) + `GET/PUT /settings/trabajo-avanzado/`
  (ventana retroactiva + hora de corte de jornada, backing 100%
  preexistente desde las Fases 3f/4f) + `GET /settings/system-info/`
  (versión + conteos, solo ADMINISTRADOR). `notification-rules` queda
  fuera — requiere hacer configurable `RETROACTIVE_NOTIFY_ROLES`
  (hoy hardcodeado), un cambio de comportamiento real, no solo una
  superficie de configuración. **De estas 4, `seguridad-config`/
  `trabajo-avanzado` cutover PARCIAL en la Fase 36 y `system-info`
  cutover completo en la Fase 49 — `normalization-curves` sigue sin
  cutover** (ver Fases 36/49). Sin migraciones nuevas. 22 tests
  nuevos — 1565 pasando en total (v1.91.0, ver `docs/AUDIT_LOG.md` §
  2026-08-21).

- Migración de stack hacia skelleton_base — **Fase 33: Centro de
  Configuración, 4 endpoints más** — `GET /settings/config-history/`
  + `POST /settings/config-history/restore-default/` (sobre
  `SystemConfigHistory`, Fase 3d) + `GET /settings/documentation/`
  (lee Markdown de `docs/`, whitelist fija de 6 claves) + `GET/POST
  /settings/login-attempts/cleanup/` (en `apps.authentication`, dueña
  de `LoginAttempt` — réplica ADAPTADA: el modelo Django es un log
  por evento sin estado de bloqueo propio, a diferencia del contador
  agregado por IP del TS; el criterio de purga se simplifica a "más
  antiguo que la retención configurada"). **Con esta entrega, el
  catálogo `settings/*` queda esencialmente cerrado** — solo restan
  `data-quality`/`notification-rules`/`retention-policy/purge`, ya
  evaluados y descartados en fases previas (motor propio/cambio de
  comportamiento real/modelos no portados). **Sin cutover de
  `route.ts`.** Sin migraciones nuevas. 18 tests nuevos — 1583
  pasando en total (v1.92.0, ver `docs/AUDIT_LOG.md` § 2026-08-21).

- Migración de stack hacia skelleton_base — **Fase 34: Centro de
  Configuración, informe de calidad del dato + 2 rutas más** — `GET
  /settings/data-quality/` (`build_data_quality_report`, nuevo
  `apps/configuration/data_quality.py`, 7 chequeos de consistencia
  sobre Tareas/Proyectos/Fases/Participantes/Actividades — cero
  modelo nuevo pese a las ~256 líneas TS) + `GET/PUT
  /settings/nova-cache/` (solo configuración, Nova/Groq sigue fuera de
  alcance) + `GET /reports/executive/closure-status/` (en
  `apps.reports`, descubierto en un barrido completo fuera de
  `settings/*`; `users/[id]/reset-password` revisado en el mismo
  barrido y confirmado ya cortado a Django desde la Fase 2). **Con
  esta entrega, el catálogo `settings/*` queda 100% cerrado** salvo
  `notification-rules`/`retention-policy/purge`, ya evaluados y
  descartados. **Sin cutover de `route.ts`.** Sin migraciones nuevas.
  27 tests nuevos — 1610 pasando en total (v1.93.0, ver
  `docs/AUDIT_LOG.md` § 2026-08-21).

- Migración de stack hacia skelleton_base — **Fase 35: Centro de
  Configuración, `notification-rules`** — `GET/PUT
  /settings/notification-rules/`: reglas de notificación
  configurables (`comment_targets`/`first_comment_role`/
  `retroactive_notify_roles`), los 3 campos siempre obligatorios en
  el `PUT` (nunca parciales). Los defaults coinciden exactamente con
  el comportamiento hardcodeado actual (`RoleNotificationTarget`/
  `RETROACTIVE_NOTIFY_ROLES`) — **GAP DOCUMENTADO: solo se porta la
  configuración**, `CommentService.create_comment`/
  `RETROACTIVE_NOTIFY_ROLES` (`apps/tasks/services.py`) siguen sin
  reconectarse a ella, mismo criterio que `password_min_length` (Fase
  32). `get_effective_notification_rules` no recibe `as_of` (única
  excepción del catálogo, réplica fiel del TS). **Con esta entrega,
  el catálogo `settings/*` queda cerrado en su totalidad** salvo
  `retention-policy/purge` (modelos no portados). **Sin cutover de
  `route.ts`.** Sin migraciones nuevas. 12 tests nuevos — 1622
  pasando en total (v1.94.0, ver `docs/AUDIT_LOG.md` § 2026-08-21).
  **GAP CERRADO el 2026-08-28 (v1.144.1):** `CommentService.create_comment`/
  `ActivityService.create_retroactive_activity` ya leen
  `comment_targets`/`first_comment_role`/`retroactive_notify_roles` de
  `get_effective_notification_rules()` — `RETROACTIVE_NOTIFY_ROLES`
  retirada. Ver `docs/AUDIT_LOG.md` § 2026-08-28 ("Cierre del gap
  `notification_rules`").

- Migración de stack hacia skelleton_base — **Fase 36: primer cutover
  de `route.ts` en `settings/*`** — tras descubrir 57 archivos ya
  cutover de sesiones previas (sin commitear), se auditó consumidor
  real por CAMPO (no por endpoint) antes de cortar cualquiera. **9 de
  24 endpoints redirigidos a Django:** `POST/PATCH
  /settings/activity-reasons/` + `.../[id]/`, `GET/POST
  /settings/login-attempts/cleanup/`, `GET/PUT
  /settings/escritorio-digital-config/`, `GET
  /settings/snooze-presets/`, `GET /settings/retroactive-window/`,
  `GET /settings/data-quality/` (completos); `GET/PUT
  /settings/seguridad-config/` + `.../trabajo-avanzado/` (**parciales
  campo por campo** — `passwordMinLength`/`workdayEndHour` siguen en
  Postgres, su consumidor real todavía es TS/Prisma). Cierra 2 bugs
  activos preexistentes (alta/edición de motivos de actividad y
  configuración de Escritorio Digital sin efecto real desde Ajustes,
  porque sus consumidores ya vivían en Django desde fases anteriores).
  Nuevo `extractDjangoFlatErrorMessage` en `djangoSession.ts`. Los 15
  endpoints restantes (`prediction-window`, `welcome-message`,
  `role-targets`, `role-compatibility`, `holidays`, `leave-records`,
  `special-status`, `workload-config`, `kpi-start-date`,
  `analytics-config`, `normalization-curves`, `retention-policy`,
  `nova-cache`, `system-info`, `config-history`+`restore-default`,
  `documentation`, `favorites`) quedan deliberadamente sin cutover —
  su consumidor real sigue en Analytics/Predictive/Dashboard (sin
  cutover) o comparten almacenamiento con un módulo sin cortar. **De
  esos 15, `role-targets`/`role-compatibility`/`system-info` cortados
  en la Fase 49** (re-auditados tras el cutover de Analytics/
  Predictive en las Fases 47/48) — los 12 restantes siguen bloqueados,
  ahora por Dashboard/Nova Insights/Reportes Ejecutivos (ver Fase 49).
  Sin migraciones nuevas. Suite completa de Vitest 1172/1172 en verde
  (v1.95.0, ver `docs/AUDIT_LOG.md` § 2026-08-21).

- Migración de stack hacia skelleton_base — **Fase 37: cutover de
  `profile/badges` y `activities/day-schedule`** — ambos endpoints de
  auto-servicio "yo mismo" (sin id de otro usuario, sin campo
  compartido con otro módulo) redirigidos a Django; sus insumos
  (Tareas/Comentarios/Actividades) ya eran 100% Django, así que la
  versión Prisma calculaba sobre datos desactualizados (**2 bugs
  activos preexistentes cerrados**). `compute_and_persist_badges`/
  `DayScheduleView` ya en camelCase — reenvío directo, sin mapeo.
  **Diferido explícitamente:** `users/assignable`/`users/[id]/theme`/
  `view-preferences` — requieren reconciliar el `cuid` de Postgres con
  el id numérico de Django (gap ya documentado desde la Fase 3a en
  `tasks/page.tsx`), sin programar todavía. Sin migraciones nuevas.
  Suite completa de Vitest 1171/1171 en verde (v1.96.0, ver
  `docs/AUDIT_LOG.md` § 2026-08-21).

- Migración de stack hacia skelleton_base — **Fase 38: cutover de
  `PATCH /api/users/[id]/theme` + tema inicial de `layout.tsx`** —
  cierra el gap dejado por la Fase 37: se agregó `theme` a
  `UserPublicSerializer` (Django) y el `route.ts` de `theme` ahora
  resuelve el id numérico de Django vía `GET /auth/me/` antes de
  llamar a `UserThemeView`. `src/app/layout.tsx` (tema inicial) se
  cortó en el MISMO cambio — a diferencia de otras fases, acá lectura
  y escritura estaban ambas en Postgres y funcionaban bien; cortar
  solo una habría introducido un bug nuevo, no cerrado uno existente.
  `users/assignable`/`view-preferences` siguen diferidos (mismos
  motivos que la Fase 37/36). Ningún modelo ni migración nueva —
  1 campo agregado a un serializer existente. Suite de Django
  1623/1623 y de Vitest 1173/1173 en verde (v1.97.0, ver
  `docs/AUDIT_LOG.md` § 2026-08-21).

- Migración de stack hacia skelleton_base — **Fase 39: cutover de la
  Papelera de Proyectos** — cierra un bug activo documentado desde la
  Fase 5f (2026-08-14): `DELETE /api/projects/[id]/` (mover a la
  papelera), `GET /api/projects/trash/`, `POST
  /api/projects/[id]/restore/` y `DELETE /api/projects/[id]/permanent/`
  se redirigen a `ProjectViewSet` (Django, Fase 14 del backend, ya
  completo). Cualquier proyecto creado después del cutover de
  Proyectos no podía enviarse a la papelera hasta este cambio. Sin
  cambios de backend. Nuevo `projects-trash.test.ts` (18 tests,
  primera cobertura de test para cualquier ruta de Proyectos). Suite
  completa de Vitest 1191/1191 en verde (v1.98.0, ver
  `docs/AUDIT_LOG.md` § 2026-08-21).

- Migración de stack hacia skelleton_base — **Fase 40: reconciliación
  de ids Postgres↔Django** — construye el puente (infraestructura,
  sin cutover de módulo nuevo): `SessionPayload.djangoUserId?: number`
  (adicional a `userId`, que sigue siendo el `cuid` de Postgres),
  poblado en login y en la renovación de perfil; nuevo
  `resolveDjangoUserId(session)` con fallback a `GET /auth/me/` para
  sesiones emitidas antes de esta fase. `users/[id]/theme/route.ts`
  (Fase 38) refactorizado para usar el helper en vez de su workaround
  inline. Desbloquea (sin implementar todavía) el cutover de
  Reuniones/Ideas/Comunicados/Notificaciones/`users/assignable`. Sin
  cambios de backend. Suite completa de Vitest 1192/1192 en verde
  (v1.99.0, ver `docs/AUDIT_LOG.md` § 2026-08-21).

- Migración de stack hacia skelleton_base — **Fase 41: cutover de
  Notificaciones** — primer cutover apoyado en el puente de la Fase
  40. `GET/PATCH /api/notifications/` + `PATCH /api/notifications/[id]/`
  redirigidos a Django (`NotificationListView`/`NotificationDetailView`,
  Fase 15 del backend) — cierra un bug de staleness: `Notification` ya
  la escriben Tareas/Proyectos/Escritorio Digital/Reuniones/Ideas/LOPD
  desde sus respectivos cutovers, pero la campana leía Postgres y
  nunca las mostraba. `taskAssignedToId` pasa a ser el id numérico de
  Django — se propagó `session.djangoUserId` hasta `NotificationBell`
  (`layout.tsx` → `AppShell` → `Topbar`). Gap preexistente NO cerrado
  (documentado, no introducido): `TaskService.create_task` todavía no
  notifica al asignar una tarea (Fase 3a, en `apps.tasks`). Sin
  cambios de backend. Suite completa de Vitest 1193/1193 en verde
  (v1.100.0, ver `docs/AUDIT_LOG.md` § 2026-08-21).

- Migración de stack hacia skelleton_base — **Fase 42: cutover de
  `users/assignable` + Reuniones** — cerrados juntos por ser
  interdependientes (el selector de invitados de Reuniones consume
  `users/assignable`). Investigando los 4 consumidores reales de
  `users/assignable` se encontraron **3 bugs activos preexistentes**
  (`RegularizeTargetTimeManager`, `DashboardModule`→`TaskFormModal`, e
  invitación a Reuniones) — todos por el mismo motivo: la lista
  devolvía `cuid` de Postgres donde el destino ya esperaba id numérico
  de Django. `GET/POST /api/meetings/` + `GET/PATCH/DELETE
  /api/meetings/[id]/` redirigidos a Django (`MeetingListCreateView`/
  `MeetingDetailView`, Fase 10 del backend, completo — Zoom real +
  notificación a invitados, ya visible en la campana desde la Fase
  41). Nuevo `djangoMeetingsAdapter.ts`. Sin cambios de backend. Suite
  completa de Vitest 1193/1193 en verde (v1.101.0, ver
  `docs/AUDIT_LOG.md` § 2026-08-21).

- Migración de stack hacia skelleton_base — **Fase 43: cutover de
  Mejora Continua / Ideas** — a diferencia de Reuniones/`users/assignable`,
  sin interdependencia con otro módulo (autor siempre "yo mismo",
  revisores por rol). `GET/POST /api/ideas/` + `GET/PATCH
  /api/ideas/[id]/` + `POST .../vote/` + `PATCH .../status/` + `GET
  .../history/` redirigidos a Django (Fase 11 del backend, completo —
  máquina de estados, badge "innovador" y notificación al autor ya
  resueltos). `mejora-continua/page.tsx` (SSR) cortada también, mismo
  criterio que `tasks/page.tsx`; `currentUserId` pasa a
  `session.djangoUserId`. Nuevo `djangoIdeasAdapter.ts`. Sin cambios
  de backend. Suite completa de Vitest 1160/1160 en verde (v1.102.0,
  ver `docs/AUDIT_LOG.md` § 2026-08-21).

- Migración de stack hacia skelleton_base — **Fase 44: cutover de
  Comunicados + corrige staleness de Comunicados/Reuniones en `GET
  /api/dashboard`** — cierra el último candidato del puente de ids de
  la Fase 40. `GET/POST /api/announcements/` + `DELETE
  /api/announcements/[id]/` redirigidos a Django (Fase 25 del backend).
  Hallazgo clave: el widget de Comunicados lee el listado del BUNDLE
  de `GET /api/dashboard` (Postgres), no de `/api/announcements` — se
  corrigió esa sección del bundle también, y de paso se encontró (y
  corrigió) la misma staleness en `upcomingMeetings` del mismo bundle
  (Reuniones cutover desde la Fase 42). `AnnouncementListView._serialize`
  (backend) ganó `author: {name, role}` (aditivo). El resto del bundle
  de Dashboard (Tareas/Comentarios/Actividades/Proyectos) queda
  documentado como staleness conocida, fuera de alcance — depende de
  Analytics/Workload sin cutover en ese momento (**cerrado en la Fase
  51**, ver `docs/AUDIT_LOG.md` § 2026-08-24). Suite de Django
  1624/1624 y de Vitest 1159/1159 en verde (v1.103.0, ver
  `docs/AUDIT_LOG.md` § 2026-08-21).

- Migración de stack hacia skelleton_base — **Fase 45: cutover de
  Solicitudes LOPD** — continúa "Cutovers pendientes" más allá de la
  lista original de la Fase 40. `GET/POST /api/data-requests/` +
  `PATCH /api/data-requests/[id]/` + `GET /api/data-requests/my-data/`
  redirigidos a Django (Fase 12 del backend, completo). Hallazgo
  clave: `my-data` (exportación LOPD/GDPR) es una obligación de
  compliance, no un widget — agregaba Tareas/Actividades/Comentarios/
  Reuniones/Ideas/Votos, todos ya escritos exclusivamente en Django,
  así que exportaba datos cada vez más incompletos para una solicitud
  con valor legal real. Gap heredado del backend preservado (no
  fabricado): `usuario` de la exportación no incluye `theme`/
  `viewPreferences`/`badges`/`dataConsentAccepted`/
  `dataConsentAcceptedAt` (sin equivalente en Django todavía, Fases
  6b/11). Nuevo `djangoDataRequestsAdapter.ts` con mapeo recursivo
  completo. Sin cambios de backend. Suite completa de Vitest
  1155/1155 en verde (v1.104.0, ver `docs/AUDIT_LOG.md` §
  2026-08-24).

- Migración de stack hacia skelleton_base — **Fase 46: cutover de
  Equipo** — `GET /api/team/` + `GET /api/team/[userId]/tasks/`
  redirigidos a Django (`TeamListView`/`TeamMemberTasksView`, Fase 18
  del backend, completo). Interdependencia resuelta cortando ambos
  juntos (mismo patrón que Fase 42): `TeamModule.tsx` encadena el `id`
  de uno como parámetro del otro. `team/[userId]/tasks` es un caso
  especial heredado de la Fase 3a (Django solo exponía tareas del
  propio usuario, no de un tercero) — `TeamMemberTasksView` ya
  resolvía ese mismo caso del lado del backend. Nuevo
  `djangoTeamAdapter.ts`. Sin cambios de backend. Suite completa de
  Vitest 1155/1155 en verde (v1.105.0, ver `docs/AUDIT_LOG.md` §
  2026-08-24).

- Migración de stack hacia skelleton_base — **Fase 47: cutover de
  Analytics + KPIs, rutas granulares** — cierra staleness activa en
  las 13 rutas restantes de Analytics/KPIs (Tareas, su único insumo
  real, es 100% Django desde la Fase 3 — estas rutas seguían
  componiendo sobre Prisma). **10 rutas nuevas bajo `analytics/`:**
  `insights/[userId]`, `equilibrio/[userId]`, `benchmarks/[userId]`,
  `operational-risk/[userId]`, `operational-risk/team`,
  `recommendations/team`, `history/[userId]`, `target-time/[userId]`,
  `data-quality`, `POST simulate/[userId]`; **3 rutas nuevas bajo
  `kpis/`:** `team`, `team-capacity`, `executive`. Las 13 son reenvío
  directo, mismo template que `analytics/[userId]`/`kpis/[userId]`
  (Fase 4m) — backend (`apps.analytics`) ya verificado completo desde
  las Fases 16-24, sin cambios. Excluidas por no tener backend:
  `kpis/nova-insights`, `analytics/diagnostics`. Nueva cobertura de
  test para las 10 rutas `analytics/*` (nunca la tuvieron, mismo
  criterio que la Fase 39). Sin cambios de backend. Suite completa de
  Vitest 94 archivos / 1192 tests en verde (v1.106.0, ver
  `docs/AUDIT_LOG.md` § 2026-08-24). **Con esta entrega, el cutover de
  `route.ts` de Analytics/KPIs queda cerrado en su totalidad** salvo
  `kpis/nova-insights`/`analytics/diagnostics` (sin backend, fuera de
  alcance) y el resto del bundle de `GET /api/dashboard`
  (Tareas/Comentarios/Actividades/Proyectos, documentado como
  staleness conocida desde la Fase 44).

- Migración de stack hacia skelleton_base — **Fase 48: cutover de
  Inteligencia Preventiva** — cierra staleness activa en las 9 rutas
  de `predictive/**`, que seguían calculando en Next.js/Prisma sobre
  Tareas/Proyectos (100% Django desde las Fases 3/39). **6 rutas GET:**
  `predictions/[userId]`, `trend/[userId]` (reenvía `weeksBack` como
  `weeks_back`), `alerts/[userId]`, `team-alerts`,
  `team-subutilization`, `project-delay/[projectId]`. **3 simuladores
  POST** (nunca persisten nada): `simulate/[userId]`,
  `simulate/project/[projectId]`, `simulate/redistribute` — body
  traducido a snake_case a mano. Backend (`apps.analytics`, Fase 9) ya
  completo, sin cambios. **Puente de ids de la Fase 40 requerido:**
  `inteligencia-preventiva/page.tsx` pasa a `resolveDjangoUserId(session)`
  en vez de `session.userId` — 4 rutas más el body de `redistribute`
  ya esperan el id numérico de Django. `project-delay`/
  `simulate/project` no lo necesitaron (`projectId` ya numérico desde
  `GET /api/projects`, Fase 39). Nuevo `djangoPredictiveAdapter.ts`.
  Hallazgo sin acción: bug preexistente en `ScenarioSimulatorPanel.tsx`
  (`m.id` vs. el campo real `userId` del selector de redistribución),
  no introducido por esta migración, no corregido (fuera de alcance).
  Nueva cobertura de test para `predictions/[userId]`/`team-alerts`
  (nunca la tuvieron). Sin cambios de backend. Suite completa de
  Vitest 94 archivos / 1202 tests en verde (v1.107.0, ver
  `docs/AUDIT_LOG.md` § 2026-08-24).

- Migración de stack hacia skelleton_base — **Fase 49: cutover de
  `settings/role-targets`, `settings/role-compatibility` y
  `settings/system-info`** — re-audita los 15 endpoints de
  `settings/*` deferidos desde la Fase 36 ahora que Analytics/KPIs
  (Fase 47) y Predictive Intelligence (Fase 48) están 100% en Django.
  Solo 3 de los 15 estaban realmente desbloqueados: `role-targets`/
  `role-compatibility` (`GET/PATCH`, redirigidos a
  `RoleTargetsView`/`RoleCompatibilityView`, backend Fase 28 —
  hallazgo: su único caller TS, `runAnalyticsPipeline`/
  `computeTeamRecommendations`, es código muerto desde el cutover de
  Analytics; se cortan igual porque hasta ahora editarlos desde
  Ajustes no tenía ningún efecto real) y `system-info` (`GET`,
  redirigido a `SystemInfoView`, backend Fase 32 — cierra staleness:
  contaba Usuarios/Tareas/Reuniones/Ideas en Postgres, los 4 ya 100%
  Django; `version`/`commitSha` pasan a reflejar el backend Django,
  no `package.json`). Los 12 restantes (`holidays`, `leave-records`,
  `special-status`, `workload-config`, `kpi-start-date`,
  `analytics-config`, `normalization-curves`, `prediction-window`,
  `welcome-message`, `nova-cache`, `favorites`, `retention-policy`)
  siguen bloqueados — por Dashboard/Nova Insights/Reportes Ejecutivos
  (todavía 100% Prisma), no por Analytics/Predictive. Nueva cobertura
  de test para `role-targets`/`system-info` (nunca la tuvieron);
  `role-compatibility.test.ts` reescrito. Sin cambios de backend.
  Suite completa de Vitest 96 archivos / 1213 tests en verde (v1.108.0,
  ver `docs/AUDIT_LOG.md` § 2026-08-24).

- Migración de stack hacia skelleton_base — **Fase 50: cutover de
  `DELETE /api/desk-notes/[id]`** — cierra el último gap documentado
  desde la Fase 7g/14 (Papelera de Notas). El bloqueo original
  (Centro de Recuperación sin portar) se había resuelto silenciosamente
  desde la Fase 14 — `DeskNoteViewSet.destroy` ya replicaba las 2 vías
  de eliminación (remitente→papelera vía `apps.recovery`, destinatario→
  borrado directo de una nota archivada) con los mismos mensajes de
  error exactos (`RecoveryError`), solo faltaba conectar el `route.ts`.
  **Hallazgo que simplificó el riesgo:** a diferencia de Proyectos
  (Fase 39), la papelera de Notas nunca tuvo UI de restauración —
  `listActiveTrash("DESK_NOTE")` nunca tuvo caller ni en el TS legacy
  ni en Django — así que no había interdependencia de lista-vs-detalle
  que coordinar. `src/lib/recoveryCenter.ts` queda sin ningún
  importador en Next.js tras este cutover (observación sin acción, no
  se eliminó). `npx tsc --noEmit` limpio, `npm run lint` sin hallazgos
  nuevos, suite completa de Vitest 96 archivos / 1217 tests en verde
  (v1.109.0, ver `docs/AUDIT_LOG.md` § 2026-08-24).

- Migración de stack hacia skelleton_base — **Fase 51: cutover de
  `GET /api/dashboard` + `settings/welcome-message`** — cierra la
  staleness de Tareas/Comentarios/Actividades/Proyectos documentada
  como fuera de alcance desde la Fase 44 (Comunicados/Reuniones ya se
  habían corregido ahí). `build_dashboard_payload` (backend, Fase 25)
  ya era una réplica campo por campo completa, con las mismas claves
  camelCase que el contrato TS — el `route.ts` queda como reenvío
  directo, solo convirtiendo a `string` los 4 arrays con `id` numérico
  (`priorityTasks`/`announcements`/`upcomingMeetings`/`myProjects`).
  **Hallazgo:** el enlace `href="/projects/${p.id}"` de `myProjects`
  usaba el `cuid` de Postgres (STALE, Proyectos ya es Django desde la
  Fase 39) — un proyecto creado después de ese cutover daba 404 al
  hacer clic desde el Dashboard; el cutover lo corrige. **`settings/
  welcome-message` se cortó EN EL MISMO CAMBIO** (no solo Dashboard):
  el Dashboard ya leía este mensaje de Django — dejar la escritura en
  Prisma habría introducido una divergencia nueva (Ajustes en
  Postgres, Dashboard en SQL Server), mismo criterio que la Fase 38.
  **Hallazgo documentado, NO corregido en esta fase — divergencia
  preexistente, no introducida acá:** `workload-config`/`holidays`/
  `leave-records`/`special-status`/`kpi-start-date` alimentan
  `compute_carga_tiempo` (Django), que YA es consumida por el bundle
  de Analytics desde la Fase 4m (2026-08-12) — meses antes de esta
  sesión. Es decir, esos 5 endpoints de `settings/*` llevan
  divergentes (Ajustes en Postgres, Analytics/KPIs en SQL Server)
  desde mucho antes de esta fase; el cutover de Dashboard solo agrega
  un consumidor más al mismo problema ya existente, no lo crea.
  **Cerrado en la Fase 52** (ver `docs/AUDIT_LOG.md` § 2026-08-24).
  `PATCH /api/dashboard/
  card-order/` NO se corta — comparte `User.viewPreferences` con
  `favorites` (sin cutover), mismo riesgo ya documentado desde la
  Fase 36. `npx tsc --noEmit` limpio, `npm run lint` sin hallazgos
  nuevos, suite completa de Vitest 96 archivos / 1216 tests en verde.
  Sin cambios de backend (v1.110.0, ver `docs/AUDIT_LOG.md` §
  2026-08-24).

- Migración de stack hacia skelleton_base — **Fase 52: cutover de
  `holidays`/`leave-records`/`special-status`/`workload-config`/
  `kpi-start-date`** — cierra el hallazgo pendiente de la Fase 51 (los
  5 endpoints ya divergían del bundle de Analytics/Dashboard desde la
  Fase 4a/4m). **Bug activo cerrado, más severo de lo esperado:**
  `leave-records`/`special-status` reciben `userId` desde `GET
  /api/users` (Django, id numérico desde la Fase 2) — crear un
  permiso o estado especial para CUALQUIER usuario devolvía 404
  "Usuario no encontrado" en la práctica, desde la Fase 2. **Hallazgo
  y corrección de backend:** `HolidayListView.get` exigía
  ADMINISTRADOR por error (el `route.ts` real nunca lo restringió) —
  corregido en `apps/configuration/views.py`, único cambio de backend
  de esta fase, verificado con `ruff check` + `pytest
  apps/configuration/` 228/228 en verde. Traducción camelCase↔snake_case
  a mano por endpoint (mismo criterio que `meetings`, Fase 42). Nueva
  cobertura de test para `special-status` y `GET
  /api/settings/leave-records` (nunca la tuvieron). `npx tsc --noEmit`
  limpio, `npm run lint` sin hallazgos nuevos, suite completa de
  Vitest 97 archivos / 1229 tests en verde (v1.111.0, ver
  `docs/AUDIT_LOG.md` § 2026-08-24).

- Migración de stack hacia skelleton_base — **Fase 53: cutover de
  `settings/config-history` + `settings/config-history/
  restore-default`** — continúa "Cutovers pendientes". Antes de
  arrancarla se corrigió el párrafo desactualizado de este mismo
  documento (ver más abajo, § Planificado punto 14): describía como
  pendientes 5 cutovers (Notificaciones/Reuniones/`users/assignable`/
  Ideas/Comunicados) ya cerrados desde las Fases 41-44. Auditando qué
  seguía realmente en Prisma (`grep` de `@/lib/prisma` sobre
  `src/app/api`), se eligió `config-history` sobre otros 2 candidatos
  (consentimiento/`viewPreferences`, Nova Insights/Message) por ser el
  de menor riesgo — backend completo desde la Fase 33
  (`ConfigHistoryView`/`ConfigHistoryRestoreDefaultView`), solo
  faltaba reconectar el `route.ts` (mismo patrón que la Fase 51).
  Traducción de respuesta snake_case→camelCase a mano; validación de
  `keys`/`defaults` y chequeo de rol se conservan en el `route.ts`
  como defensa en profundidad. `npx tsc --noEmit` limpio, `npm run
  lint` sin hallazgos nuevos en los archivos tocados, suite completa
  de Vitest 97 archivos / 1231 tests en verde (mocks de Prisma
  huérfanos removidos de `settings-config-center.test.ts`). Sin
  cambios de backend (v1.112.0, ver `docs/AUDIT_LOG.md` §
  2026-08-24).

- Migración de stack hacia skelleton_base — **Fase 54: cutover de
  Nova Insights/Message (`kpis/nova-insights/[userId]` +
  `dashboard/nova-message`) + fix de bug de ids en
  `MyKpisModule.tsx`** — cierra el bloqueo de "Nova, sin cutover"
  documentado desde la Fase 49. Ninguna de las 2 rutas necesitó
  backend nuevo: recomponen sus datos desde `GET /analytics/<id>/`
  (bundle, Fase 4m), `GET /kpis/<id>/`/`GET /kpis/me/` (Fase 4b),
  `GET /analytics/operational-risk/<id>/` (Fase 47) y
  `fetchOwnDjangoTasks` (Fase 3a) — Groq sigue en Next.js sin cambios.
  **Bug activo cerrado, misma familia que las Fases 42/52:**
  `MyKpisModule.tsx` (vista propia de "Mis KPIs") pasaba el cuid de
  Postgres a 6 usos (`NovaInsightsCard`, `WhatIfSimulator`,
  `AdvancedAnalyticsPanel`, `InsightsPanel`, `ScoreHistoryChart`,
  `downloadKpisPDF`) que ya esperaban el id numérico de Django desde
  la Fase 47 — la vista de EQUIPO (`KpisModule.tsx`) ya usaba el id
  correcto y funcionaba bien. Ver Nova Insights (u otro de esos 5
  paneles) de un compañero de equipo devolvía 404 desde la Fase 47,
  sin que nadie lo notara. Corregidos los 6 usos juntos (decisión
  explícita del usuario), `currentUserId` eliminado de
  `MyKpisModule`/`AnalyticsModule`/`my-kpis/page.tsx` por quedar sin
  uso. `nova-insights/route.ts` además elimina su re-implementación
  manual de visibilidad jerárquica, delegada 100% a Django (mismo
  criterio que el resto de `analytics/*`); `nova-message` degrada a
  un saludo genérico (200) si Django no está disponible, en vez del
  401 estándar, por ser la única ruta puramente cosmética de esta
  migración. Nueva cobertura de test para `nova-insights` (nunca la
  tuvo, 10 tests). `npx tsc --noEmit` limpio, `npm run lint` sin
  hallazgos nuevos, suite completa de Vitest 98 archivos / 1243 tests
  en verde. Sin cambios de backend (v1.113.0, ver `docs/AUDIT_LOG.md`
  § 2026-08-24).

- Migración de stack hacia skelleton_base — **Fase 55: cutover PARCIAL
  de Consentimiento/Preferencias de usuario (4 de 6 rutas)** — continúa
  "Decommission de Postgres" (punto 2 de "Planificado", ver más abajo).
  Su premisa también estaba desactualizada: el modelo `User` de Django
  ya tiene `theme`/`view_preferences`/`badges`/`data_consent_accepted`/
  `data_consent_accepted_at` desde las Fases 12/25/26. **4 rutas
  redirigidas, sin backend nuevo:** `PATCH /api/auth/consent` (→
  `AcceptConsentView`), `PATCH /api/dashboard/card-order` (→
  `DashboardCardOrderView`), `PATCH /api/users/[id]/reset-consent` +
  `PATCH /api/users/reset-consent-all` (→ acciones `reset_consent`/
  `reset_consent_all` de `UserAdminViewSet`) — las 4 vistas ya estaban
  completas desde la Fase 13/25, solo faltaba reconectar el
  `route.ts`. Las 2 rutas de `users/[id]` conservan
  `canManageUsers`/`canManageTargetUser` en TS, mismo criterio que
  `reset-password/route.ts` (Fase 2). Cierra además el riesgo de
  divergencia de `view_preferences` documentado desde la Fase 36/51
  entre `card-order` y `favorites` (Django desde la Fase 28). **2
  rutas quedan BLOQUEADAS, no por decisión de producto sino por
  infraestructura de esta sesión:** `view-preferences`/`auth/me`
  (porción `activityFormat`) necesitan una vista Django nueva y SQL
  Server no estaba accesible para verificarla con `pytest`
  (`localhost:14330` sin listener TCP, Docker tampoco disponible) — se
  decidió no escribir ese backend sin poder probarlo. Hallazgo
  documentado, no corregido: `view-preferences/route.ts` legacy
  reemplaza el array `viewPreferences` completo en vez de fusionar
  solo su clave (a diferencia de `card-order`/`favorites`), bug
  preexistente del TS original. `npx tsc --noEmit` limpio, `npm run
  lint` sin hallazgos nuevos, suite completa de Vitest 98 archivos /
  1247 tests en verde. Sin cambios de backend en esta fase (v1.114.0,
  ver `docs/AUDIT_LOG.md` § 2026-08-25).

- Migración de stack hacia skelleton_base — **Fase 55 (cierre):
  cutover de `view-preferences` + `activityFormat` — completa el
  cluster de Consentimiento/Preferencias (6 de 6 rutas)** — el
  bloqueo de v1.114.0 resultó ser un diagnóstico incorrecto, no falta
  real de acceso: `localhost:14330` (valor original de `.env`) es el
  contenedor Docker `gestion_tareas_rrhh-mssql-1` de este proyecto,
  no detectado porque Docker no aparecía activo en el primer chequeo
  de la sesión. Con SQL Server accesible, se agregaron 2 vistas
  Django nuevas (`UserViewPreferencesView`/`ActivityFormatView`,
  `apps/users/self_service_views.py`), verificadas con `pytest
  apps/users/` (63/63) y `ruff check` limpio. `UserViewPreferencesView.PATCH`
  replica fielmente el bug preexistente del TS legacy (reemplaza el
  array completo, sin fusionar otras claves de prefijo) — documentado,
  no corregido; `.GET` es aditivo, sin equivalente en el legacy.
  **Cierra además el gap explícito de la Fase 3a en
  `tasks/page.tsx`** — ya resuelve el id numérico de Django
  (`fetchDjangoCurrentUserId()`) en vez de seguir usando el cuid de
  Postgres, posible recién ahora que `view-preferences` está en
  Django. `npx tsc --noEmit` limpio, `npm run lint` sin hallazgos
  nuevos, suite completa de Vitest 98 archivos / 1248 tests en verde
  (v1.115.0, ver `docs/AUDIT_LOG.md` § 2026-08-25).

- Migración de stack hacia skelleton_base — **Fase 56: Reportes
  Ejecutivos, cutover de PERSISTENCIA + lectura (cálculo sigue en
  Next.js sin cambios)** — auditando el motor completo
  (`src/lib/executiveReporting/`, 19 archivos/3866 líneas) antes de
  decidir el alcance, se encontró que `POST /api/reports/executive`
  seguía escribiendo en Postgres mientras
  `ExecutiveReportListView`/`ExecutiveReportDetailView` (Django, Fase
  8) ya leían de SQL Server — **todo reporte generado desde la Fase 8
  (2026-08-18) era invisible para esos endpoints de lectura**, una
  staleness activa de más de una semana. Cerrada sin portar el motor
  de cálculo: 2 vistas Django nuevas
  (`ExecutiveReportCreateView`/`ExecutiveReportAuditCreateView`,
  `backend/apps/reports/`) solo PERSISTEN el snapshot que
  `buildSnapshotForFilters` ya calculó — `generated_by`/`user` se
  resuelven desde `request.user` (JWT), nunca desde el body; colisión
  de `report_id` responde 409 (`UniqueValidator` automático de DRF
  desactivado a propósito) en vez del 400 por defecto, para que
  Next.js sepa cuándo reintentar con un id nuevo (mismo bucle de
  `snapshotStore.ts`, ahora contra Django). `GET .../list` +
  `GET .../<reportId>` cortados como reenvío directo a las vistas de
  lectura ya existentes de la Fase 8. 9 tests de backend nuevos
  (`TestExecutiveReportCreate`/`TestExecutiveReportAuditCreate`).
  `pytest apps/reports/ apps/users/` 95/95 en verde, `ruff check`
  limpio. `npx tsc --noEmit` limpio, `npm run lint` sin hallazgos
  nuevos, suite completa de Vitest 98 archivos / 1252 tests en verde
  (v1.116.0, ver `docs/AUDIT_LOG.md` § 2026-08-25).

- Migración de stack hacia skelleton_base — **Fase 57: Reportes
  Ejecutivos, primer recorte del motor de CÁLCULO recompuesto sobre
  Django (Índice Ejecutivo)** — dentro de `buildMonthlySnapshotData`
  hay 2 cómputos por colaborador distintos: el Índice Ejecutivo
  (`computePerformanceScore`/`computeHealthScore`, ya portados a
  Django desde la Fase 4e/4g) y `ReportMemberKpi` (la tabla/ranking
  del reporte, lógica propia sin equivalente en Django, calculada en
  lote sobre Task/TaskActivity). Solo el primero recompone limpio —
  el segundo queda pendiente, sin decidir todavía si `/kpis/<id>/`
  alcanza o hace falta backend nuevo. **Bloqueador encontrado a mitad
  de camino:** el roster se resuelve con cuids de Postgres
  (necesarios para las queries Prisma que siguen sin cambios) y no
  existía ningún endpoint Django para traducir un LOTE de cuids a ids
  numéricos (`/auth/me/` solo resuelve "a mí mismo"; `GET
  /admin/users/` exige `usuarios.ver`, permiso distinto al que usa
  Reportes Ejecutivos). Nueva vista `GET /reports/user-lookup/`
  (`backend/apps/reports/`, gateada por `CanAccessReports`) resuelve
  el lote. `buildSnapshotData.ts` reemplaza 2 llamadas locales por 1
  llamada por colaborador a `/analytics/<id>/` (el bundle ya trae
  Performance Score + Equilibrio Operativo juntos, mejor que el
  diseño original). Colaboradores sin id de Django resuelto se
  excluyen del promedio, no bloquean la generación. Gap documentado:
  `/analytics/<id>/` calcula contra `now()` real, sin parámetro de
  corte — sin efecto en el caso común (esta rama solo corre para el
  mes en curso). Nuevo módulo `djangoAnalyticsBridge.ts`, con test
  coverage propia (7 tests, módulo nunca tuvo cobertura). `pytest
  apps/reports/ apps/users/` 100/100 en verde, `ruff check` limpio.
  `npx tsc --noEmit` limpio, `npm run lint` sin hallazgos nuevos,
  suite completa de Vitest 99 archivos / 1259 tests en verde
  (v1.117.0, ver `docs/AUDIT_LOG.md` § 2026-08-25).

- Migración de stack hacia skelleton_base — **Fase 58: Asistente
  LLM/RAG, cutover de la base de conocimiento a Django (cálculo de
  embeddings sigue en TypeScript)** — el mayor riesgo técnico marcado
  en este documento (punto 6 de "Decommission de PostgreSQL", ver
  abajo) resultó ser un riesgo aparente: `getEmbedding()`
  (`src/lib/embeddings.ts`) usa `@xenova/transformers`, que corre el
  modelo de sentence-transformers (`Xenova/all-MiniLM-L6-v2`) EN
  PROCESO dentro de Node.js, no vía una API externa — no hacía falta
  portar ningún modelo de ML a Python. Nueva app Django
  `apps.assistant` (`KnowledgeDocument`/`DocumentChunk`, réplica de
  `prisma/schema.prisma`) persiste metadatos + chunks con su embedding
  ya calculado; el PDF sigue en GitHub y
  `src/lib/githubDocuments.ts` (descarga/extracción/chunking/
  embeddings) queda sin cambios, mismo patrón que Reportes Ejecutivos
  (Fase 56) — Django solo guarda el resultado ya calculado. 4 vistas
  nuevas gateadas por `CanViewKnowledgeBase`/`CanManageKnowledgeBase`
  (réplica de `src/lib/roles.ts`). `assistant/chat/route.ts` se
  recompuso, no solo se cortó: `buildTaskContext`/`buildTeamContext`
  (contexto de Nova en los modos "tasks"/"hr") pasan de Prisma directo
  a `fetchOwnDjangoTasks()` (Fase 3a) + `GET /team/` + `GET
  /team/<id>/tasks/` (Fase 18/46) — cerraba además una staleness ya
  existente en esos datos; `findRelevantChunks` (búsqueda RAG) pasa a
  `GET /assistant/chunks/`, la similitud coseno sigue calculándose en
  TypeScript sin cambios. La llamada a Groq no se toca. 24 tests de
  backend nuevos (`pytest apps/assistant/`), `ruff check` limpio.
  `npx tsc --noEmit` limpio, `npm run lint` sin hallazgos nuevos,
  suite completa de Vitest 99 archivos / 1260 tests en verde
  (v1.118.0, ver `docs/AUDIT_LOG.md` § 2026-08-25).

- Migración de stack hacia skelleton_base — **Fase 59: cutover del TTL
  de caché de Nova (`settings/nova-cache`), primer valor reconectado de
  Centro de Configuración** — investigando el punto 9 (Centro de
  Configuración) contra el código real (no solo la narrativa de este
  documento), se encontró que el CRUD Django de los ~9-12 valores del
  Sprint O ya estaba completo desde las Fases 31/32/34, pero el
  CONSUMIDOR de runtime de esos valores (no la UI de Ajustes) seguía
  leyendo `SystemConfigHistory` de Postgres vía `src/lib/systemConfig.ts`
  — 2 almacenes desincronizados. **Hallazgo — staleness activa:**
  editar el TTL de caché de Nova desde Ajustes no tenía ningún efecto
  real desde que `dashboard/nova-message`/`kpis/nova-insights/[userId]`
  se cortaron a Django (Fase 54) — ambos calculan su TTL contra la
  tabla homónima en SQL Server, no en Postgres. Se eligió este valor
  para arrancar por ser el más aislado (2 consumidores reales) y no
  necesitar backend nuevo (`NovaCacheView`, completa desde la Fase 34).
  `settings/nova-cache/route.ts` redirigido a Django; nuevo
  `src/lib/djangoNovaCacheConfig.ts` para los 2 consumidores, con
  degradación al mismo default (240 min) si Django no está disponible.
  `getEffectiveNovaCacheTtlMinutes`/`setNovaCacheTtlMinutes` eliminados
  de `systemConfig.ts` (código muerto confirmado, no solo comentado).
  Sin cambios de backend. `npx tsc --noEmit` limpio, `npm run lint` sin
  hallazgos nuevos, suite completa de Vitest 99 archivos / 1260 tests
  en verde (v1.119.0, ver `docs/AUDIT_LOG.md` § 2026-08-25).

- Migración de stack hacia skelleton_base — **Fase 60: cutover completo
  de `settings/trabajo-avanzado` (hora de corte de jornada)** —
  segundo valor reconectado de Centro de Configuración, mismo patrón
  que la Fase 59. **Hallazgo: la razón documentada en la Fase 36 para
  NO cortar `workdayEndHour` quedó obsoleta sin que nadie lo
  notara** — el `route.ts` afirmaba que su único consumidor real era
  `src/lib/capacityForecast.ts` con "Predictive sigue 100% en Prisma",
  pero ese archivo quedó sin ningún importador real desde el cutover
  de Inteligencia Preventiva (Fase 48) — motor reemplazado por
  `apps/analytics/capacity_forecast.py`. Cutover más simple que el de
  Nova Cache: `TrabajoAvanzadoView` (Django, Fase 32) ya devolvía
  `workday_end_hour` en la MISMA respuesta que `retroactive_window_days`
  — no hizo falta ningún adaptador nuevo, solo dejar de ignorar el
  campo y de hacer la llamada paralela a Postgres.
  `getEffectiveWorkdayEndHour`/`setWorkdayEndHour` NO se eliminaron de
  `systemConfig.ts` (a diferencia de la Fase 59) — `capacityForecast.ts`
  sigue importándolas y, aunque es código muerto en runtime, sigue
  siendo parte del build de TypeScript. Sin cambios de backend. `npx
  tsc --noEmit` limpio, `npm run lint` sin hallazgos nuevos, suite
  completa de Vitest 99 archivos / 1261 tests en verde (v1.120.0, ver
  `docs/AUDIT_LOG.md` § 2026-08-25).
  **Corrección (2026-08-25, Fase 63): la premisa central de este
  párrafo era incorrecta.** `capacityForecast.ts` NO está muerto en
  runtime — tiene una cadena viva completa hacia
  `POST /api/reports/executive` (vía `predictionEngine.ts` →
  `buildSnapshotData.ts`), nunca detectada porque la verificación de
  esta fase solo siguió importadores directos desde `src/app`, no la
  cadena transitiva. La decisión de RETENER
  `getEffectiveWorkdayEndHour`/`setWorkdayEndHour` fue correcta, pero
  por el motivo equivocado — no es solo un bloqueo de compilación, la
  función tiene efecto real hoy. Consecuencia activa, descubierta en
  la Fase 63: `workday_end_hour` quedó desincronizado entre Django
  (que edita la UI de Ajustes desde esta misma fase) y Postgres (que
  sigue leyendo `capacityForecast.ts` en la generación real de
  Reportes Ejecutivos) — ver "Implementado", Fase 63.

- Migración de stack hacia skelleton_base — **Fase 61: cutover de
  `passwordMinLength` (`settings/seguridad-config`) + hallazgo de
  seguridad documentado** — tercer valor reconectado de Centro de
  Configuración, mismo patrón mecánico que las Fases 59/60:
  `SeguridadConfigView` (Django, Fase 32) ya devolvía
  `password_min_length` en la misma respuesta que los otros 3 campos
  (ya cortados desde la Fase 36) — no hizo falta backend nuevo. Nuevo
  `src/lib/djangoPasswordPolicyConfig.ts` para el único consumidor
  externo (`auth/change-password/route.ts`). **Hallazgo de
  seguridad real, distinto en severidad al resto de hallazgos de esta
  migración:** investigando cómo Django enforcea este valor en su
  propio flujo de cambio de contraseña, se encontró que NO lo hace —
  `AUTH_PASSWORD_VALIDATORS.MinimumLengthValidator` está hardcodeado
  en `min_length=10`, una lista estática configurada al arranque del
  proceso, sin ninguna lectura de `SystemConfigHistory`. Efecto
  práctico: un Administrador que baje el mínimo configurable por
  debajo de 10 desde Ajustes tiene una falsa sensación de control —
  Django sigue exigiendo 10 sin importar la configuración; solo un
  valor configurado por ENCIMA de 10 tiene efecto real (la
  pre-validación de Next.js bloquea antes). Documentado como decisión
  de producto/seguridad pendiente, NO corregido unilateralmente en
  esta fase (fuera de alcance de un cutover de lectura/escritura).
  `getEffectivePasswordMinLength`/`setPasswordMinLength` eliminados de
  `systemConfig.ts` (sin bloqueo de compilación, a diferencia de
  `workdayEndHour` en la Fase 60 — ningún archivo, ni siquiera código
  muerto, seguía importándolas). Sin cambios de backend. `npx tsc
  --noEmit` limpio, `npm run lint` sin hallazgos nuevos, suite completa
  de Vitest 99 archivos / 1260 tests en verde (v1.121.0, ver
  `docs/AUDIT_LOG.md` § 2026-08-25).

- Migración de stack hacia skelleton_base — **Fase 62: cutover de la
  duración de sesión (`session.ts`), último valor con consumidor real
  de Centro de Configuración** — a diferencia de las Fases 59-61
  (cutover de un `route.ts` de Ajustes), el consumidor acá es el
  módulo de sesión núcleo de la app. **El riesgo real resultó menor al
  estimado:** `createSession` solo consulta su fallback (antes
  Postgres) cuando no recibe `durationHoursOverride` — de sus 2
  callers reales, `auth/login/route.ts` YA pasaba la duración resuelta
  por Django desde la Fase 6a (`session_policy` en la respuesta de
  login), el fallback nunca se ejecutaba ahí. El único caller que sí
  lo ejercitaba era `auth/me/route.ts` (re-emisión de sesión al editar
  el perfil), sin override. **Decisión — se resuelve en el caller, no
  dentro de `session.ts`:** para no agregar una dependencia de red a
  un módulo importado por casi toda la app, `auth/me/route.ts` ahora
  resuelve `session_duration_default_hours` contra Django (`GET
  /settings/seguridad-config/`, mismo endpoint que las Fases 59-61)
  antes de llamar a `createSession` — mismo patrón que ya usaba
  `login/route.ts`. El fallback de `session.ts` pasa a ser un piso
  hardcodeado (168h/720h, mismos defaults que Django), sin ninguna
  consulta — el módulo queda sin dependencias de infraestructura de
  datos. Comportamiento preexistente preservado, no corregido: la
  re-emisión de sesión sigue usando siempre la duración "default",
  nunca "recordarme" (quirk heredado). 6 símbolos eliminados de
  `systemConfig.ts` (sin consumidores reales restantes). Sin cambios
  de backend. `npx tsc --noEmit` limpio, `npm run lint` sin hallazgos
  nuevos, suite completa de Vitest 99 archivos / 1259 tests en verde,
  incluida la suite completa de autenticación para descartar
  regresiones (v1.122.0, ver `docs/AUDIT_LOG.md` § 2026-08-25).

- Migración de stack hacia skelleton_base — **Fase 63: corrección de
  hallazgo (la Fase 60 estaba equivocada) + limpieza de código muerto
  confirmado** — investigando la limpieza de "motores legacy" como
  alternativa contenida al motor de cálculo completo de Reportes
  Ejecutivos, se encontró que la caracterización de "código muerto"
  para 5 de 10 archivos candidatos era incorrecta: las verificaciones
  anteriores (Fases 58/60) solo comprobaron importadores DIRECTOS
  desde `src/app`, sin seguir la cadena transitiva completa.
  **Corrección:** `capacityForecast.ts`, `workload.ts`,
  `predictionEngine.ts`, `trendEngine.ts` (y partes de `analytics.ts`)
  SÍ están vivos — `POST /api/reports/executive` →
  `buildMonthlySnapshotData` (`buildSnapshotData.ts`) importa
  directamente de `workload.ts`/`predictionEngine.ts`, que a su vez
  llaman a `capacityForecast.ts`/`trendEngine.ts`. **Hallazgo nuevo,
  no corregido en esta fase:** como consecuencia directa del error de
  la Fase 60, `workday_end_hour` quedó desincronizado entre Django
  (que ya lo edita desde Ajustes) y Postgres (que
  `capacityForecast.ts` sigue leyendo sin cambios) — divergencia de
  datos activa pero de bajo impacto práctico (gateada a "reporte del
  mes en curso", mismo patrón que el hallazgo de la Fase 57);
  documentada, no corregida, porque arreglarla bien requiere el mismo
  análisis de "fecha de corte" ya identificado como pendiente para el
  motor de cálculo completo de Reportes Ejecutivos — un parche
  aislado podría generar su propia inconsistencia con ese trabajo
  futuro. **Limpieza real ejecutada:** solo 3 de los 10 candidatos
  resultaron genuinamente muertos (confirmado con `grep` transitivo en
  todo `src/`, no solo `src/app`) — `recoveryCenter.ts` (superado por
  `apps.recovery`/Django desde las Fases 39/50), `deskNoteRetention.ts`
  (sin consumidor desde el cutover de Escritorio Digital, Fase 50) y
  `rate-limit.ts` (superado por el rate-limiting real de Django desde
  la Fase 6a) — eliminados junto con sus tests dedicados y 20 símbolos
  huérfanos en `systemConfig.ts`. `insightsEngine.ts`/`riskAlerts.ts`
  (también muertos, pero con un `import type` compartido y un test
  compartido con `analytics.ts`) quedan para una fase futura de
  limpieza más delicada. Sin cambios de backend. `npx tsc --noEmit`
  limpio, `npm run lint` completo (no solo archivos tocados, por las
  eliminaciones) sin hallazgos nuevos, suite completa de Vitest 97
  archivos / 1231 tests en verde (baja de 99/1259 por los 2 tests
  eliminados junto con su código, no por una regresión) (v1.123.0, ver
  `docs/AUDIT_LOG.md` § 2026-08-25).

- Migración de stack hacia skelleton_base — **Fase 64: Sub-fase 1 del
  motor de CÁLCULO de Reportes Ejecutivos (`ReportMemberKpi`, solo
  builder mensual, sin cutover de TS)** — primer paso real del último
  trabajo grande pendiente (motor de cálculo completo, punto 5), tras
  confirmación explícita del usuario ("Arrancar sub-fase 1 ahora") ante
  una pregunta directa sobre el alcance (~13 sub-fases estimadas, mismo
  tamaño que el port original de KPIs/Analytics). **Hallazgo mayor,
  verificado línea por línea antes de escribir código:** de las ~10
  primitivas que `ReportMemberKpi` necesita, 8 YA EXISTÍAN en Django,
  portadas en fases muy tempranas de esta migración (4a-4d,
  2026-08-11, semanas antes de que esta sesión empezara) —
  `compute_simple_score`/`compute_completed_pct_any`/
  `compute_estimated_vs_real_ratio` (`apps/analytics/scoring.py`),
  `compute_workload_range`/`compute_workload_pct`/
  `sum_weighted_base_hours`/`sum_weighted_limit`
  (`apps/analytics/workload.py`), `compute_effective_history_start`
  (`apps/analytics/history.py`), `is_task_overdue`
  (`apps/analytics/utils.py`), `business_day_real_range`
  (`apps/tasks/business_time.py`) — ninguna conectada todavía a un
  caso de uso de Reportes Ejecutivos. Lo genuinamente nuevo se redujo
  a 3 funciones en `backend/apps/reports/member_kpis.py`:
  `as_of_fecha_corte` (2 líneas, réplica de `asOfFechaCorte`),
  `compute_effective_member_bases` (wiring de primitivas ya
  existentes, réplica de `computeEffectiveMemberBases`) y
  `compute_monthly_member_kpis` (assembler, réplica del bloque
  `ReportMemberKpi` de `buildMonthlySnapshotData`). **Deliberadamente
  SIN wiring a ningún endpoint HTTP** — mismo criterio que el port
  original de KPIs/Analytics (primitivas primero, HTTP después,
  cutover de `route.ts` mucho más tarde): construir y probar el
  cálculo en aislamiento, sin tocar ningún camino de producción, antes
  de exponerlo. 16 tests nuevos — 3 bugs de TEST genuinos (no de
  producción) encontrados y corregidos al correrlos por primera vez:
  `compute_completed_pct_any`/`is_task_overdue` esperan atributos de
  objeto, no dicts; `created_at` (`auto_now_add`) necesita backdatearse
  a mano en tests contra un período fijo en el pasado; el instante
  real de "fin de día de negocio" cruza la medianoche UTC por el huso
  desplazado. `ruff check apps/reports/` limpio, `pytest apps/reports
  apps/analytics apps/users apps/team apps/tasks` 908/908 en verde. Sin
  cambios de TypeScript — no requirió `npx tsc`/`npm run lint`/Vitest
  (v1.124.0, ver `docs/AUDIT_LOG.md` § 2026-08-25).

- Migración de stack hacia skelleton_base — **Fase 65: Sub-fase 2 del
  motor de CÁLCULO de Reportes Ejecutivos (`ReportMemberKpi`, builder
  de rango personalizado, sin cutover de TS)** — de los 2 builders
  restantes de `buildSnapshotData.ts`, se eligió `buildCustomRangeSnapshotData`
  (RANGO_PERSONALIZADO) por ser estructuralmente casi idéntico al
  builder mensual ya portado (Fase 64), dejando `buildRangeSnapshotData`
  (RANGO_MESES — agregación mes a mes con `MonthSnapshot[]`, bastante
  más complejo) para una sub-fase futura. **Otra primitiva más ya
  portada, sin conectar:** `businessBaseForRange` (1 línea, alias de
  `businessBaseCore`) — su equivalente Django,
  `business_base_for_range` (`apps/configuration/services.py`), ya
  existía, reutilizada internamente por `monthly_business_base` desde
  antes de esta sesión. `deriveEstadoOperativo`/`computePrincipalHallazgo`
  (`src/lib/reportInsights.ts`) también portados en esta sub-fase (el
  builder de rango personalizado sí los necesita, a diferencia del
  mensual) — evaluados y resultaron triviales, reutilizan
  `classify_estado_operativo` ya portado (Fase 4e/4g). Nueva función
  `compute_custom_range_member_kpis` en `backend/apps/reports/member_kpis.py`,
  reutilizando `as_of_fecha_corte`/`compute_effective_member_bases` de
  la Sub-fase 1 sin duplicarlas. 14 tests nuevos, incluido un caso
  específico de rango NO calendario (marzo→abril) verificando el
  prorrateo contra los límites del rango completo. Implementación
  delegada a un fork con autorización explícita para escribir código —
  se cortó por un límite de sesión de la API justo antes de la
  verificación final y la documentación; se completó ambas cosas
  manualmente, verificando desde cero (no se confió en ningún
  resultado no verificado del fork). `ruff check apps/reports/`
  limpio, `pytest apps/reports/tests/test_member_kpis.py` 30/30 en
  verde (16 + 14), `pytest apps/reports apps/analytics apps/users
  apps/team apps/tasks` 922/922 en verde (908 + 14). Sin cambios de
  TypeScript (v1.125.0, ver `docs/AUDIT_LOG.md` § 2026-08-26).

- Migración de stack hacia skelleton_base — **Fase 66: Sub-fase 3 del
  motor de CÁLCULO de Reportes Ejecutivos (`ReportMemberKpi`/
  `MonthSnapshot`, builder de rango de meses — solo lo que NO depende
  de `reportInsights.ts`)** — cierra el port de `ReportMemberKpi` para
  los 3 builders de `buildSnapshotData.ts`. `buildRangeSnapshotData`
  resultó ser el más grande de los 3: además de la agregación por
  colaborador, arma un desglose mes a mes (`MonthSnapshot[]`) del que
  esa agregación depende (el score/cumplimiento final es el promedio
  de los meses "activos" del rango). Más allá de eso, la función
  completa también arma cuadrante de riesgo/hallazgos/recomendaciones/
  insights/tendencia de consultas/alertas — todo dependiente de
  `src/lib/reportInsights.ts` (538 líneas, sin portar). **Se acotó el
  alcance a solo `monthSnapshots`/`aggregatedMembers`, dejando el
  resto para una sub-fase futura junto con el resto de
  `reportInsights.ts`** — mismo criterio de riesgo mínimo que las
  Sub-fases 1/2. **Otra primitiva más ya portada sin conectar (tercera
  vez consecutiva):** `monthlyBusinessBaseForUsers` → `monthly_business_base_for_users`
  (`apps/analytics/workload.py`), en uso real por `/kpis/me/range`
  desde la Fase 4c. Nueva función `compute_range_member_kpis` +
  2 utilitarios triviales (`_months_in_range`, `_month_label`) en
  `backend/apps/reports/member_kpis.py`. **Simplificación deliberada
  del contrato de salida:** `month_snapshots[i]["member_snapshots"]`
  es un dict `{user_id: {...}}` sin identidad (mismo criterio que las
  Sub-fases 1/2), sin el "strip" de campos que hacía el TS antes del
  payload HTTP (no hay payload HTTP todavía). 6 tests nuevos, los 6 en
  verde en el primer intento (a diferencia de las Sub-fases 1/2, que
  encontraron bugs de test reales). `ruff check apps/reports/` limpio,
  `pytest apps/reports/tests/test_member_kpis.py` 36/36 en verde (30 +
  6), `pytest apps/reports apps/analytics apps/users apps/team
  apps/tasks` 928/928 en verde (922 + 6). Sin cambios de TypeScript
  (v1.126.0, ver `docs/AUDIT_LOG.md` § 2026-08-26).
- Migración de stack hacia skelleton_base — **Fase 83: port de
  `MonthlyReport`/`DataPurgeLog` (retención/purga LOPDP) a Django**
  (`backend/apps/reports/models.py`/`backend/apps/configuration/`):
  cierra el backlog de la Fase 81 — corrige la premisa original (Fase
  8) de que eran datos históricos congelados; en realidad
  `retentionPolicy.ts`/`buildSnapshotData.ts` los usan activamente.
  Modelos sin `legacy_postgres_id` ni comando de importación (decisión
  del usuario, Fase 82: nunca migrar datos históricos reales). Nueva
  `RetentionPolicyPurgeView` — con esto, el catálogo `settings/*` queda
  cerrado al 100%. Cutover de `retention-policy/route.ts` (config,
  nunca antes cortado pese a existir desde la Fase 31) +
  `retention-policy/purge/route.ts`; `src/lib/retentionPolicy.ts`
  eliminado. `pytest apps/` 1820/1820, `npx vitest run` 1228/1228
  (v1.140.0, ver `docs/AUDIT_LOG.md` § 2026-08-27).
- Migración de stack hacia skelleton_base — **Fase 84: reconexión del
  motor interno a Django — cierra 3 bugs activos de divergencia de
  datos** (`holidays.ts`/`workload.ts` vía `systemConfig.ts`/
  `closurePeriod.ts`+`executiveReporting/periodStatus.ts`): mismo patrón
  ya visto en las Fases 52/60 — rutas de administración que ya escriben
  en Django desde hace fases, mientras el motor interno de cálculo
  seguía leyendo Postgres. `ClosureStatusView` (Django) extendida con 4
  campos; cutover de `analytics-config`/`normalization-curves`/
  `prediction-window` (nunca antes conectados pese a tener vista Django
  lista desde las Fases 31/32). Limpieza de código muerto: 12 archivos
  `src/lib/*` completos + 39 funciones dentro de
  `analytics.ts`/`workload.ts`/`predictionEngine.ts`/`reportInsights.ts`/
  `systemConfig.ts` (>3700 líneas). `pytest apps/` 1821/1821,
  `npx vitest run` 1128/1128 (v1.141.0, ver `docs/AUDIT_LOG.md` §
  2026-08-27).
- Migración de stack hacia skelleton_base — **Fase 85: reconexión del
  bloque "Predictivo" de Reportes Ejecutivos a Django — reuso, no
  construcción nueva**: investigar con 3 agentes Explore en paralelo si
  `predictionEngine.ts`/`capacityForecast.ts`/`trendEngine.ts`
  requerían endpoints Django nuevos reveló que ya son réplicas exactas
  de código Django ya vivo desde la Fase 48
  (`/predictive/predictions/<id>/`, `/kpis/team-capacity/`) — se
  reconecta en vez de portar. `PredictionBundleView` gana `?as_of=`;
  nueva `TeamSubutilizationReportView` (roster explícito, `apps.reports`,
  `POST /reports/executive/team-subutilization/`). Cascada de código
  muerto verificada función por función: `capacityForecast.ts`/
  `trendEngine.ts`/`analyticsAuditHistory.ts` eliminados completos, más
  `leaves.ts`/`specialStatus.ts` completos (sin consumidor tras cortar
  `workload.ts::sumWeightedBaseHours`) — cierra sin endpoint nuevo el
  backlog que la Fase 84 había dejado pendiente. `pytest apps/`
  1831/1831, `npx vitest run` 1105/1105 (v1.142.0, ver
  `docs/AUDIT_LOG.md` § 2026-08-27).
- Migración de stack hacia skelleton_base — **Fase 86: cutover de los
  últimos 6 archivos sin explorar de `src/lib/*`/páginas SSR**:
  `notification-rules` (Django completo desde la Fase 35, vía nuevo
  `src/lib/djangoNotificationRulesAdapter.ts`), `projects/page.tsx` y
  `projects/[id]/page.tsx` (`GET /projects/`/`GET /projects/<id>/`,
  Django completo desde la Fase 5f), `dashboard/page.tsx`
  (`GET /users/<id>/view-preferences/`, reusando el precedente ya
  existente en `tasks/page.tsx`), `layout.tsx` (`GET /auth/me/`, tras
  agregar `data_consent_accepted` a `UserPublicSerializer`).
  `resolveRoster.ts` queda fuera de alcance (lógica propia de Reportes
  Ejecutivos sin equivalente Django). Cascada de código muerto:
  `notificationRules.ts`/`projectPhaseStats.ts` (previstos) +
  `projectAccess.ts` (hallazgo durante la implementación — Django ya
  aplica la misma fórmula de control de acceso server-side, ver
  `docs/AUDIT_LOG.md`). `pytest apps/` 461/461 (subset relevante),
  `npx vitest run` 1101/1101 (v1.143.0, ver `docs/AUDIT_LOG.md` §
  2026-08-28).
- Migración de stack hacia skelleton_base — **Fases 87-90: cierre
  COMPLETO del punto 14 — decommission total de Prisma/PostgreSQL del
  código.** Fase 87: `resolveRoster.ts` reconectado a
  `GET /reports/roster/` (nueva `RosterView`, composición sobre
  primitivas de jerarquía ya probadas — resultó portable pese a que la
  Fase 86 lo había dejado fuera). Fase 88: `computeDataQuality`/
  `recordEngineVersionIfChanged` reconectados a
  `GET /analytics/diagnostics/` (nueva `AnalyticsDiagnosticsView`, reusa
  `compute_data_quality` ya vivo con 3 consumidores Django reales). Fase
  89: comparación mes-anterior del Índice Ejecutivo reconectada a
  `GET /reports/monthly-report/` (nueva `MonthlyReportView` mínima,
  mismo comportamiento exacto). Fase 90: eliminación completa —
  `package.json`, `prisma/`, `src/lib/prisma.ts`,
  `src/generated/prisma/`, 2 scripts de backfill, mock global de Prisma
  en Vitest, `.env.example`/`.gitignore`, `CLAUDE.md`/
  `docs/ARCHITECTURE.md`; 79 archivos con imports de tipo puro
  redefinidos localmente en su módulo dueño de dominio (`Role` → 74 de
  los 79, movido a `src/lib/roles.ts`). Fuera de alcance, confirmado con
  el usuario: servicio de Windows `postgresql-x64-16`/hosting Neon.
  `pytest apps/` sin regresiones, `npx vitest run` 1099/1099, `npm
  install` (97 paquetes retirados) (v1.144.0, ver `docs/AUDIT_LOG.md` §
  2026-08-28).

## En desarrollo

- Escenarios predictivos DE EQUIPO (Esperado/Preventivo/Optimista, FPS
  Executive Reporting Engine 2.0 Parte III) — no implementados: no existe
  todavía un motor de síntesis a nivel de equipo. La página "Analytics
  Predictivo" del documento SÍ integra visualmente el motor existente por
  colaborador desde v1.22.1 (`predictionEngine.ts` — proyección de
  cumplimiento, probabilidad de sobrecarga, subutilización, gateado al mes
  en curso); lo que falta es la narrativa de 3 escenarios a nivel de equipo
  que el FPS Parte III describe, no la integración del motor en sí.

## Planificado

- **Migrar `src/lib/roles.ts` a `session.permissions` módulo por módulo**
  (ver `docs/AUDIT_LOG.md` § 2026-09-01, "Catálogo dinámico de permisos
  extendido a todo el sistema"). Desde v1.146.0, Django (`permission_classes`)
  ya es la fuente de verdad real de autorización para 9 apps de dominio +
  `apps/team`, gateada por el catálogo dinámico — pero el frontend
  (`roles.ts`, ~40 funciones hardcodeadas: `canViewTeam`/`canCreateMeetings`/
  `canReviewIdeas`/etc.) sigue sin tocar, deliberadamente, para acotar el
  alcance de esa entrega. Migrar cada consumidor a `hasPermission(session.permissions, codename)`
  (`src/lib/permissions.ts`) cierra el desfase de UX (un botón visible que
  Django terminaría rechazando) sin ser un hueco de seguridad — Django ya
  revalida todo server-side. No es urgente ni bloqueante; se puede hacer
  módulo por módulo, sin coordinar un cambio único de gran superficie.
- **Extender el catálogo dinámico a `apps.configuration` (Ajustes) y a las
  partes de `apps.dashboard`/`apps.notifications` que hoy confían 100% en
  el guard de frontend** (ver mismo hallazgo del AUDIT_LOG citado arriba)
  — sin `permission_classes` propio a nivel de vista, análogo al gap que
  tenía `apps.team` antes de esta entrega. Tamaño comparable a la Fase 2
  de esa entrega completa.

- **Migración de stack hacia skelleton_base — Fases 3b en adelante (hoja
  de ruta, cada una se planifica en detalle cuando llegue su turno; Fases 1,
  2 y 3a ya implementadas, ver "Implementado" arriba):**
  1. Importación real de usuarios (Fase 2) y de tareas (Fase 3a) de
     Postgres a Django — no bloqueante, decisión explícita del usuario de
     postergarla en ambos casos.
  2. **Sub-fases de Tareas — todas implementadas (3a, 3b, 3c, 3c-bulk,
     3d, 3e y 3f)**: el módulo Tareas queda completo en Django.
  3. **KPIs/Analytics — COMPLETO (4a-4m).** Reimplementación en Python
     del motor de scoring: **4a (base horaria + `LeaveRecord`/
     `SpecialStatus`/`kpiStartDate`), 4b (`GET /api/kpis/me`/`/[userId]`),
     4c (`GET /api/kpis/me/range`), 4d (infraestructura común del
     núcleo de scoring), 4e (Performance Score), 4f (Capacidad
     Proyectada), 4g (Equilibrio Operativo), 4h (Riesgo Operativo),
     4i (motor de alertas), 4j+4k (capa explicativa completa,
     `insightsEngine.ts`), 4l (Trend/Predictive Engine + Pipeline
     orquestador) y 4m (primer endpoint HTTP real, `GET /api/analytics/
     [userId]`, cutover completo Django↔Next.js) implementadas**. El
     motor entero de `analytics.ts` + `insightsEngine.ts` queda
     portado a `apps.analytics.*` y el bundle completo se sirve en vivo
     desde Django (ver `docs/AUDIT_LOG.md` § 2026-08-12, Fase 4m).
     De las ~16 rutas delgadas de Analytics restantes (revisado hacia
     arriba de la estimación original de "~10"), la **Fase 16 (ver
     "Implementado" arriba) ya cerró 3** (`/insights/[userId]`,
     `/equilibrio/[userId]`, `/operational-risk/[userId]`), **la Fase
     17 otras 3** (`/history/[userId]`, `/target-time/[userId]`,
     `/data-quality`), **la Fase 19 otras 2** (`kpis/team`, `kpis/
     team-capacity`, con el nuevo concepto `isExecutorRole` —
     `apps/hierarchy/services.is_executor_group`), **la Fase 20 una
     más** (`operational-risk/team`, con su efecto lateral de
     notificación automática — `Notification.dedup_key` nuevo) **y la
     Fase 21 `kpis/executive`** (dashboard ejecutivo completo, ~326
     líneas TS, confirmado 100% ensamblado sin motor nuevo) **y la
     Fase 22 `/benchmarks/[userId]`** (Benchmarks Inteligente —
     Sprint 7, confirmado sin gap de motor real: reutiliza
     `get_factor_audit_history`/`compute_monthly_history`/
     `compute_weekly_history` ya portadas + `get_effective_role_target`,
     configuración JSON simple), **la Fase 23 `/simulate/[userId]`**
     (simulador KPI-level de 8 escenarios, `classify_capacity` ya
     anticipaba este puerto desde la Fase 4f, sin gap de motor real)
     **y la Fase 24 `recommendations/team`** (Matriz de Compatibilidad
     Operativa configurable + algoritmo greedy de redistribución, ver
     "Implementado" arriba) — 13 de ~16 cerradas. Queda como trabajo
     futuro NO planificado en detalle todavía (no bloquea nada de lo
     anterior): `/diagnostics` (depende de instrumentación de proceso —
     contadores de caché/validaciones en memoria del proceso Next.js —
     nunca portada a Django; `team/*` sin relación con Analytics ya se
     cerró en la Fase 18 — ver "Implementado" arriba), y portar la
     capa de caché en memoria del TS (`cached()`, TTL por-proceso) si
     el volumen real lo justifica.
  4. **Proyectos — COMPLETO en Django Y cutover 100% (incluida la
     Papelera), desde la Fase 39. Fases 5a (CRUD core), 5b
     (Participantes/Comentarios/Historial), 5c (Fases), 5d
     (Documentos), 5e (Actividades), 5f (cutover de `route.ts` core) y
     14+39 (Papelera: backend + cutover) implementadas** (ver
     "Implementado" arriba y `docs/AUDIT_LOG.md` §
     2026-08-13/2026-08-14/2026-08-20/2026-08-21):
     `Project`/`ProjectParticipant`/`ProjectHistory`/`ProjectComment`/
     `ProjectPhase`/`ProjectDocument`/`ProjectActivity` + permisos +
     `ProjectViewSet` (con `trash`/`restore`/`permanent`) +
     `ParticipantDetailView`/`PhaseDetailView`/`DocumentDetailView` en
     Django, **sirviendo tráfico real desde Next.js**
     (`src/lib/djangoProjectsAdapter.ts`), incluido `DELETE
     /projects/[id]` (enviar a la papelera) y toda la UI de papelera
     (Fase 39, cierra el gap documentado desde la Fase 5f). Sin
     prueba manual en navegador todavía (entorno de esta sesión sin
     `.env` de Next.js con credenciales reales — pendiente en un
     entorno real antes de dar el cutover por probado end-to-end).
  5. **Reportes Ejecutivos — COMPLETO en Django Y cutover 100%, desde
     la Fase 73.** Modelo + lectura de snapshots
     ya generados COMPLETA desde la Fase 8 (ver "Implementado" arriba):
     `ExecutiveReportSnapshot`/`ExecutiveReportAuditLog` +
     `GET .../list/` + `GET .../<report_id>/`, réplica exacta de
     `ensureSnapshotMeta`. **Persistencia de la generación (Fase 56,
     ver "Implementado" arriba) también COMPLETA** — `POST
     /reports/executive/` + `POST /reports/executive/audit/` +
     cutover de `route.ts` de las 2 rutas de lectura. **Índice
     Ejecutivo (Fase 57, ver "Implementado" arriba) recompuesto sobre
     Django** — `computePerformanceScore`/`computeHealthScore`
     locales reemplazados por `GET /analytics/<id>/` (bundle ya
     portado desde la Fase 4m/47) + `GET /reports/user-lookup/`
     (vista Django nueva, puente cuid→id numérico para el roster).
     **Lo que sigue pendiente, sin planificar en detalle todavía —
     riesgo equivalente al punto 6:** `ReportMemberKpi` (la
     tabla/ranking del reporte — score/cumplimiento/carga/horas/
     motivos de consulta por persona) NO usa el motor general de
     Analytics, es lógica propia (`computeSimpleScore`) calculada en
     LOTE sobre Task/TaskActivity vía Prisma. **Investigado y
     descartado recomponer sobre `/kpis/<id>/` (bundle individual,
     Fase 4b) — no es un problema de esfuerzo, es incompatibilidad de
     semántica:** el mapeo de campos es casi 1:1
     (`cumplimiento`/`carga_tiempo`/`seguimiento.by_reason`/
     `calidad.avg_progress` cubren casi todo lo que necesita
     `ReportMemberKpi`), pero `buildMonthlySnapshotData` aplica
     `asOfFechaCorte` ANTES de calcular cumplimiento — reconstruye el
     estado de cada tarea "como era en la fecha de corte" (una tarea
     completada DESPUÉS del corte se trata como si siguiera
     pendiente), el corazón del principio de inmutabilidad del motor
     (un reporte de un mes ya cerrado da siempre los mismos números,
     sin importar cuándo se regenera). `/kpis/<id>/` no tiene ningún
     concepto de fecha de corte — siempre calcula contra el estado
     ACTUAL de las tareas. Sin efecto para el mes EN CURSO (`cutoff`
     ya es ≈ `now()`, mismo caso ya resuelto para el Índice
     Ejecutivo), pero si un reporte de un mes YA CERRADO se
     regenera, Django daría el cumplimiento de HOY en vez del
     cumplimiento congelado del momento del cierre — un bug de datos
     real, no cosmético, para un motor pensado para ejecutivos.
     `computeEffectiveMemberBases` (prorrateo de la base horaria para
     colaboradores nuevos a mitad de período) tampoco tiene
     equivalente en `/kpis/<id>/`. Portar `ReportMemberKpi`
     correctamente requiere llevar la semántica de "fecha de corte" a
     Python. **Sub-fase 1 arrancada y completada en la Fase 64 (ver
     "Implementado" arriba) — hallazgo que redujo sustancialmente el
     trabajo restante frente a la estimación original de ~13
     sub-fases:** de las ~10 primitivas que `ReportMemberKpi` necesita,
     8 YA EXISTÍAN en Django desde fases tempranas de esta migración
     (4a-4d, meses antes de esta sesión) — `compute_simple_score`/
     `compute_completed_pct_any`/`compute_estimated_vs_real_ratio`
     (`apps/analytics/scoring.py`), `compute_workload_range`/
     `compute_workload_pct`/`sum_weighted_base_hours`/
     `sum_weighted_limit` (`apps/analytics/workload.py`),
     `compute_effective_history_start` (`apps/analytics/history.py`),
     `is_task_overdue` (`apps/analytics/utils.py`),
     `business_day_real_range` (`apps/tasks/business_time.py`), todas
     ya reutilizadas por otras piezas del motor sin que nadie las
     hubiera conectado a Reportes Ejecutivos. Lo nuevo se redujo a 2
     funciones + 1 assembler (`backend/apps/reports/member_kpis.py`:
     `as_of_fecha_corte`, `compute_effective_member_bases`,
     `compute_monthly_member_kpis`), con 16 tests, **deliberadamente
     SIN wiring a ningún endpoint HTTP todavía** (mismo criterio que
     el port original de KPIs/Analytics: primitivas primero, HTTP
     después, cutover de `route.ts` mucho más tarde) — solo cubría el
     builder MENSUAL. **Sub-fase 2 (Fase 65, ver "Implementado"
     arriba) agregó el builder RANGO_PERSONALIZADO** —
     `compute_custom_range_member_kpis`, reutilizando las primitivas
     de la Sub-fase 1 + 2 funciones más de `reportInsights.ts`
     (`derive_estado_operativo`/`compute_principal_hallazgo`, también
     triviales de portar) + otra primitiva de fechas ya existente
     (`business_base_for_range`) — 14 tests más. **Sub-fase 3 (Fase
     66, ver "Implementado" arriba) agregó el builder RANGO_MESES** —
     `compute_range_member_kpis`, con desglose mes a mes
     (`MonthSnapshot[]`) del que depende la agregación por
     colaborador; reutilizó otra primitiva más ya portada sin conectar
     (`monthlyBusinessBaseForUsers`) — 6 tests más. **Con esto, el
     port de `ReportMemberKpi` queda completo para los 3 builders.**
     **Fase 67 (ver "Implementado" arriba) completa el port de
     `src/lib/reportInsights.ts` (538 líneas) — los agregados de
     EQUIPO** (`compute_risk_quadrant`, `previous_equivalent_period`,
     `explain_motivo_distribution`/`explain_cumplimiento_indicator`/
     `explain_carga_indicator`/`explain_consultas_indicator`,
     `get_activity_reason_label_map`, `resolve_monthly_period_status`/
     `resolve_range_period_status`/`resolve_custom_range_period_status`,
     `compute_findings`/`compute_recommendations`/`compute_team_insights`,
     `compute_team_monthly_snapshots`/`compute_trend_comparisons`) en
     el nuevo `backend/apps/reports/insights.py` — 16 funciones, 47
     tests, todos en verde en el primer intento. **Con esto, el motor
     de CÁLCULO completo de Reportes Ejecutivos (`ReportMemberKpi` +
     agregados de equipo) ya existe en Django.** **Fase 68 (ver
     "Implementado" arriba) construye el primer endpoint HTTP real
     sobre ese motor:** `POST /reports/executive/monthly-team-kpis/`
     (builder MENSUAL), nueva capa de ensamblado
     `backend/apps/reports/team_report.py` que combina
     `member_kpis.py`/`insights.py` más 3 piezas genuinamente nuevas
     (`compute_team_alerts`/`compute_monthly_ranking`/
     `compute_consultas_by_reason` — la agrupación cruda de
     `TaskActivity` por motivo, la única primitiva del builder MENSUAL
     que no tenía ningún equivalente portado todavía). El bundle
     deliberadamente NO incluye Índice Ejecutivo/Predictivo/NOVA/
     `estadoOperativo`-`principalHallazgo` por miembro (dependen de
     motores aparte) — el caller de Next.js los sigue resolviendo
     igual que hoy, sin cambios. **Deliberadamente SIN wiring desde
     `buildSnapshotData.ts` todavía** — el endpoint se construyó y
     probó en aislamiento (21 tests), nada en Next.js lo llama.
     **Fase 69 (ver "Implementado" arriba) completa el trío con los
     2 builders de rango:** `POST /reports/executive/custom-range-team-kpis/`
     (`assemble_custom_range_team_report`, reutiliza el `ranking`/
     `alerts` de la Fase 68 sin duplicarlos — el TS usa exactamente la
     misma lógica ahí) y `POST /reports/executive/range-team-kpis/`
     (`assemble_range_team_report`, con `compute_range_ranking`/
     `compute_range_alerts` propios — orden y umbral de alerta
     genuinamente distintos del builder mensual, verificado contra el
     TS). 14 tests más (35 en total en `test_team_report.py`). **Con
     esto, los 3 builders del motor de cálculo tienen su endpoint HTTP
     equivalente construido y probado en Django — ninguno con wiring
     desde `buildSnapshotData.ts` todavía.** **Fase 70 (ver
     "Implementado" arriba) ejecutó esa verificación campo por campo**
     — con datos SINTÉTICOS equivalentes en ambos lados (el entorno de
     desarrollo no tiene Postgres configurado ni datos reales en
     ninguna BD), 283 verificaciones sobre los 3 builders, 261
     coincidieron exactamente. **2 discrepancias reales encontradas:**
     (A) bug de redondeo Python `round()` (banker's rounding) vs. JS
     `Math.round()` (siempre hacia +Infinity) — corregido en TODO el
     backend en la misma fase (`round_half_up`, 217 call sites, 32
     archivos — no solo `apps.reports`, ya afectaba Analytics/KPIs en
     producción desde la Fase 47); (B) un quirk de conteo de días
     hábiles en rangos multi-mes (`sumWeightedBaseHours` en TS puede
     contar 1 día hábil de más al cruzar a UTC del día siguiente,
     dependiente de zona horaria) — el port Python no lo reproduce,
     **decisión pendiente del usuario** sobre cuál comportamiento debe
     prevalecer antes de cortar RANGO_MESES. **Fase 71 (ver
     "Implementado" arriba) cierra la causa B — replicada fielmente,
     no corregida en el TS:** confirmado con el usuario que producción
     corre en `America/Guayaquil` (UTC-5), así que el quirk es real, no
     un artefacto del entorno de verificación. Una segunda verificación
     sintética dirigida al borde de mes reveló que el alcance era mayor
     al medido inicialmente — afecta también qué tareas/actividades se
     cuentan en cada mes del desglose (`monthlyEvolution`), no solo
     `cargaBaseHours`. Nuevo `_local_month_bounds` (réplica de
     `monthBounds()` de TS, desplazada por `BUSINESS_TZ_OFFSET_HOURS`)
     reemplaza a `_month_bounds` en TODO lo que `compute_range_member_kpis`/
     `assemble_range_team_report` derivan de `monthBounds()` — nuevo
     `_ts_local_period_end_date` replica con exactitud aritmética el
     límite final del loop de 24h de `sumWeightedBaseHours`/
     `sumWeightedLimit` (TS) por colaborador. 7 tests nuevos, 2 de
     ellos reproduciendo EXACTAMENTE los escenarios reales verificados
     contra TS. **Con esto, los 3 builders del motor de cálculo quedan
     verificados campo por campo contra `buildSnapshotData.ts`.**
     **Fase 72 (ver "Implementado" arriba) ejecuta el primer cutover
     real — builder MENSUAL:** `buildMonthlySnapshotData` deja de
     calcular `ReportMemberKpi`/agregados de equipo localmente contra
     Prisma y pasa a leerlos de `POST /reports/executive/monthly-team-kpis/`
     (Fase 68) vía el nuevo `djangoReportKpisBridge.ts`. 2 decisiones
     de comportamiento en producción confirmadas explícitamente con el
     usuario antes de implementar: si Django falla, la generación
     FALLA (no degrada, a diferencia del Índice Ejecutivo); un
     colaborador sin id de Django resuelto se excluye de la tabla
     (mismo criterio que el Índice Ejecutivo). `insights`/
     `estadoOperativo`/`principalHallazgo` siguen calculándose en TS
     (dependen del Índice Ejecutivo, frontera ya establecida desde la
     Fase 68). Tests actualizados: se eliminaron 3 tests que probaban
     lógica (`asOfFechaCorte`/prorrateo) que ya no vive en esta
     función — esa cobertura ya existe del lado Django, verificada con
     datos sintéticos reales en las Fases 70/71. `tsc`/`eslint`
     limpios, Vitest 1231/1231 en verde. **Cierra la mayor parte de la
     parte (2) de las "3 partes que faltan."** **Sigue pendiente:** el
     mismo cutover mecánico para RANGO_PERSONALIZADO y RANGO_MESES
     (endpoints ya construidos y verificados desde las Fases 69/70/71
     — trabajo de patrón repetido, no de riesgo nuevo) y, después, la
     divergencia de `workday_end_hour` (hallazgo de la Fase 63, parte
     (3)). Mientras tanto, la generación sigue funcionando end-to-end
     sin regresión — el Índice Ejecutivo y ahora MENSUAL ya leen de
     Django, RANGO_PERSONALIZADO/RANGO_MESES siguen en Next.js/Prisma.
     `renderReportHtml.ts`/`renderReportExcel.ts` (~637 líneas,
     exportación) y la narrativa NOVA (`src/lib/executiveReporting/
     nova/`, ~648 líneas, Groq) NO necesitan portarse — son
     presentación/generación de lenguaje natural, no cálculo de
     negocio, mismo criterio que Nova Insights (Fase 54).
     **Fase 73 (ver "Implementado" arriba) cierra los 2 builders
     restantes y el último hallazgo pendiente — Reportes Ejecutivos
     queda COMPLETO al 100%:** `buildCustomRangeSnapshotData`
     (RANGO_PERSONALIZADO) cortado a `POST
     /reports/executive/custom-range-team-kpis/` y
     `buildRangeSnapshotData` (RANGO_MESES) a `POST
     /reports/executive/range-team-kpis/` (ambos de la Fase 69),
     mismo patrón mecánico que MENSUAL — más simple, porque ninguno
     de los 2 tuvo nunca integración con el Índice Ejecutivo, así que
     `insights`/`estadoOperativo`/`principalHallazgo` vienen del
     bundle de Django sin glue code. Única pieza con lógica propia:
     `monthlyEvolution` (RANGO_MESES) se reconstruye en TS desde el
     diccionario `member_snapshots` de Django (indexado por id
     numérico, sin identidad — decisión deliberada de las Fases
     66/71) usando el `members` ya remapeado. También cierra el
     hallazgo de la Fase 63: `capacityForecast.ts` ya lee
     `workday_end_hour` de Django (`fetchDjangoWorkdayEndHour`, nuevo
     `djangoWorkdayEndHourConfig.ts`, degrada al default si Django
     falla) en vez de Postgres — Ajustes → Trabajo Avanzado y
     Capacidad Proyectada ya no divergen. `tsc`/`eslint` limpios,
     Vitest 1237/1237 en verde, 7 tests nuevos cerrando un gap de
     cobertura real (ningún test previo ejercitaba estos 2 builders
     de punta a punta).
  6. **Asistente LLM/RAG — COMPLETO en Django Y cutover 100%, desde la
     Fase 58 (ver "Implementado" arriba).** El riesgo original de este
     punto ("reimplementar en Python los embeddings hoy en
     `@xenova/transformers`") resultó ser un riesgo aparente: el
     paquete corre el modelo en proceso dentro de Node.js, no vía una
     API externa — el cálculo de embeddings queda permanentemente en
     TypeScript, decisión de arquitectura, no una tarea pendiente.
     `apps.assistant` (`KnowledgeDocument`/`DocumentChunk`) +
     `GET/POST /assistant/documents/` + `GET/PATCH/DELETE
     /assistant/documents/<id>/` + `POST
     /assistant/documents/<id>/chunks/` + `GET /assistant/chunks/`,
     **sirviendo tráfico real desde Next.js**
     (`src/lib/djangoAssistantAdapter.ts`). `assistant/chat/route.ts`
     recompuesto contra Django (`buildTaskContext`/`buildTeamContext`/
     `findRelevantChunks`), no solo cortado.
  7. **Inteligencia Preventiva — COMPLETA en Django Y cutover 100%,
     desde la Fase 48.** Trend Engine + predicciones explicables
     individuales (Fase 9a) + Alertas Preventivas + wiring de equipo
     (Fase 9b) + Simulador (Fase 9c) implementadas (ver "Implementado"
     arriba): `trend_engine.py`/`prediction_engine.py`/
     `preventive_intelligence.py`/`simulate_engine.py` +
     `GET .../predictions/<user_id>/` + `GET .../trend/<user_id>/` +
     `GET .../alerts/<user_id>/` + `GET .../team-alerts/` +
     `GET .../team-subutilization/` +
     `GET .../project-delay/<project_id>/` +
     `POST .../simulate/<user_id>/` +
     `POST .../simulate/project/<project_id>/` +
     `POST .../simulate/redistribute/`, **las 9 sirviendo tráfico real
     desde Next.js desde la Fase 48** (`src/lib/djangoPredictiveAdapter.ts`).
     `GET/PUT /settings/prediction-window/` implementado en la Fase 13
     (ver punto 9), sin cutover de `route.ts` todavía (deferido — ver
     "Cutovers pendientes" de `settings/*`).
  8. **Escritorio Digital — COMPLETO en Django Y cutover 100%, desde
     la Fase 50.** Sub-fases 7a (Notas), 7b (Recordatorios), 7c
     (`convert-to-task`), 7d (Adjuntos de Notas), 7e
     (`convert-to-reminder`), 7f (Bandeja Hoy + Buscador), 7g (cutover
     de `route.ts`) y 14 (`DeskNoteViewSet.destroy` +
     `purge_expired_archived_notes`) implementadas — ver "Implementado"
     arriba. **Las 14 rutas sirviendo tráfico real desde Next.js**
     (`src/lib/djangoDeskAdapter.ts`), incluido `DELETE
     /api/desk-notes/[id]` (Fase 50, cierra el último gap de este
     módulo — asimetría fiel al TS: solo mover a la papelera, sin
     restaurar/listar/eliminar-definitivo para notas).
     `purge_expired_archived_notes()` sigue sin activar en ningún lado
     (gap preexistente, ya documentado desde la Fase 31).
  9. **Centro de Configuración — COMPLETO Y CUTOVER 100%, desde la
     Fase 76.** `GET/PUT
     /settings/prediction-window/` (deferido de la Fase 9c) + gate de
     consentimiento (`data_consent_accepted`/`data_consent_accepted_at`
     en `User`, deferido de la Fase 12) COMPLETO (ver "Implementado"
     arriba). **Corrección (2026-08-25, Fase 59): el CRUD de Django
     para los 9 valores del Sprint O (ventana de registro retroactivo,
     hora de corte de jornada, retención de archivado/tope de
     respuestas/presets de Escritorio Digital, TTL de caché de NOVA,
     longitud mínima de contraseña, duración de sesión, retención de
     intentos de login) ya estaba COMPLETO desde las Fases 31/32/34 —
     lo que realmente faltaba no es el CRUD sino el CONSUMIDOR de
     runtime: `src/lib/systemConfig.ts` sigue leyendo
     `SystemConfigHistory` de Postgres para calcular el valor EFECTIVO
     que usa cada feature, aunque la UI de Ajustes ya escriba en
     Django — 2 almacenes desincronizados, staleness activa (editar
     desde Ajustes no tenía efecto real).** **TTL de caché de NOVA
     cortado en la Fase 59** (`src/lib/djangoNovaCacheConfig.ts`) y
     **hora de corte de jornada — `route.ts` cortado en la Fase 60,
     pero el consumidor real (`capacityForecast.ts`) quedó leyendo de
     Postgres hasta la Fase 73** (hallazgo de la Fase 63, cerrado
     recién en la Fase 73 — ver "Implementado" arriba) — 2 valores
     reconectados del lado consumidor. **Hallazgo de la Fase 60, tras re-verificar
     consumidores reales con `grep`:** `desk_archive_retention_days`/
     `desk_note_max_replies`/`snooze_presets_minutes` (Escritorio
     Digital) YA NO tienen ningún consumidor real en Postgres —
     `escritorio-digital-config/route.ts` ya es 100% Django desde la
     Fase 36, y su único otro lector (`src/lib/deskNoteRetention.ts`)
     está sin importadores reales desde el cutover de Escritorio
     Digital (Fase 50) — no necesitan cutover, ya están efectivamente
     migrados, solo código muerto pendiente de limpieza. Mismo
     hallazgo para `analytics_config`/`normalization_curves`/
     `role_target`/`role_compatibility` (motor de Analytics, código
     muerto en TS desde la Fase 47) y `recovery_center_retention_hours`
     (`recoveryCenter.ts`, sin importadores desde la Fase 50).
     **`password_min_length` cortado en la Fase 61** (ver
     "Implementado" arriba, `src/lib/djangoPasswordPolicyConfig.ts`) —
     tercer valor reconectado. **Hallazgo de seguridad real
     descubierto en esa misma fase, documentado y NO corregido:**
     Django no enforcea este valor en su propio flujo de cambio de
     contraseña — `AUTH_PASSWORD_VALIDATORS.MinimumLengthValidator`
     está hardcodeado en `min_length=10`, desconectado del valor
     configurable (default 6). Un Administrador que baje el mínimo por
     debajo de 10 desde Ajustes no tiene ningún efecto real; solo un
     valor por ENCIMA de 10 sí lo tiene (bloquea antes en la
     pre-validación de Next.js). Requiere decisión de producto en una
     fase futura, no un cutover de lectura/escritura. Queda
     genuinamente pendiente, con consumidor real confirmado:
     **`session_duration_default_hours`/`session_duration_remember_hours`
     cortados en la Fase 62** (ver "Implementado" arriba) — cuarto y
     último valor con consumidor real reconectado, cierra el backlog
     de Centro de Configuración con consumidor confirmado. Resultó
     menos riesgoso de lo estimado: `auth/login/route.ts` YA resolvía
     la duración vía Django (`session_policy`) desde la Fase 6a — el
     único caller que realmente ejercitaba el fallback de `session.ts`
     era la re-emisión de sesión en `PATCH /api/auth/me`, ahora
     también resuelta contra Django antes de llamar a `createSession`.
     `session.ts` queda sin ninguna dependencia de Prisma/Django en su
     código (fallback hardcodeado, sin consulta). `retention_policy`
     queda fuera (modelos de purga no portados, Fase 35). **Corrección
     (2026-08-26, Fase 76): el párrafo original de este punto daba por
     pendiente "el rediseño completo de `/settings` (Sprint O del TS —
     de acordeón plano a módulo organizado por categoría, con
     búsqueda/favoritos/historial de auditoría navegable)" — ese texto
     quedó obsoleto sin que nadie lo corrigiera: Sprint O ya se había
     ejecutado por completo el 2026-07-28 (ver "Implementado" arriba,
     § Sprint O — Centro de Configuración NEXO, v1.21.0), antes incluso
     de que empezara esta lista de fases de la migración de stack. El
     texto describía un estado que ya no existía — `SettingsManager.tsx`
     (el acordeón plano) fue eliminado del repo en ese mismo sprint,
     reemplazado por `ConfigCenter.tsx` con categorías/búsqueda/
     favoritos/historial de auditoría, todo funcionando end-to-end.**
     **Corrección (2026-08-25, Fase 63): la limpieza de "motores legacy sin
     importadores reales" mencionada acá se investigó y ejecutó
     PARCIALMENTE — de los 10 archivos, solo 3 (`recoveryCenter.ts`,
     `deskNoteRetention.ts`, `rate-limit.ts`) resultaron genuinamente
     muertos y se eliminaron (ver "Implementado" arriba, Fase 63). Los
     otros 7 (`analytics.ts`, `insightsEngine.ts`, `predictionEngine.ts`,
     `trendEngine.ts`, `riskAlerts.ts`, `workload.ts`,
     `capacityForecast.ts`) NO son código muerto salvo `insightsEngine.ts`/
     `riskAlerts.ts` (muertos pero con ataduras que requieren trabajo
     de separación primero, ver Fase 63) — `workload.ts`/
     `capacityForecast.ts`/`predictionEngine.ts`/`trendEngine.ts` y
     partes de `analytics.ts` tienen una cadena viva real hacia
     `POST /api/reports/executive`, descubierta al investigar esta
     misma limpieza.** **Fase 74 (ver "Implementado" arriba) cierra
     `insightsEngine.ts`/`riskAlerts.ts` — las 2 ataduras identificadas
     en la Fase 63 quedaron resueltas:** el tipo `RiskAlert` se movió a
     `components/kpis/types.ts` (su único consumidor real) antes de
     borrar `riskAlerts.ts`; los 2 describe de
     `analytics-formulas.test.ts` que probaban funciones de
     `insightsEngine.ts` (`computeEquilibrioInsights`/
     `explainEquilibrioFactor`/`explainEquilibrioMeaning`/
     `explainEquilibrioImpact`) se eliminaron sin reemplazo — esa
     cobertura ya existe, exhaustiva, del lado Django
     (`test_insights_engine.py`, portado en las Fases 4j/4k) — antes de
     borrar el archivo (999 líneas). `computeRiskAlerts` no tenía
     ningún test dedicado (confirmado con `grep`, ya "vestigial" desde
     antes de esta migración). Con esto, de los 7 archivos re-evaluados
     en la Fase 63 solo quedan como código muerto sin resolver:
     ninguno — los 5 restantes (`analytics.ts`/`workload.ts`/
     `predictionEngine.ts`/`trendEngine.ts`/`capacityForecast.ts`) están
     genuinamente vivos. **Fase 75 (ver "Implementado" arriba) cierra
     el hallazgo de seguridad de `password_min_length` (Fase 61):**
     confirmado que Django SÍ enforcea `MinimumLengthValidator(min_length=10)`
     en los 5 puntos reales donde valida una contraseña nueva — no era
     una vulnerabilidad (Django nunca permite algo más débil que 10),
     sino una configuración engañosa por debajo de 10 en Ajustes. El
     usuario eligió, entre 3 opciones presentadas, clampear el rango
     configurable a un piso de 10 (en vez de hacer que Django respete
     el valor dinámicamente) — aplicado en Django
     (`SeguridadConfigUpdateSerializer`), en `route.ts` y en la UI, más
     un clamp en LECTURA (`get_effective_password_min_length`) para
     que una instalación ya configurada por debajo de 10 quede
     corregida de inmediato sin migrar datos históricos. **Fase 76
     (ver "Implementado" arriba) cierra el último cabo suelto dentro
     del alcance de la migración de stack — el cutover de favoritos —
     y con él, Centro de Configuración queda 100% completo:**
     `GET/PATCH /api/settings/favorites` seguía leyendo/escribiendo
     `User.viewPreferences` vía Prisma (`src/lib/configFavorites.ts`,
     eliminado en esta fase) pese a que su réplica Django
     (`FavoritesView`, completa desde la Fase 28) existía sin usar —
     no era solo código muerto sin cortar: `PATCH
     /dashboard/card-order` (mismo campo `User.viewPreferences`, Fase
     55) ya escribía en Django, así que ambos endpoints leían/
     escribían 2 copias del mismo array desde bases distintas — riesgo
     de divergencia activo, mismo patrón de bug real que el cerrado en
     la Fase 52. Cutover mecánico (mismo patrón que
     `dashboard/card-order/route.ts`), sin cambios de backend
     (`FavoritesView` ya existía completa, con su propia suite de
     tests). Con esto, Centro de Configuración queda COMPLETO Y
     CUTOVER 100%.
  10. **Reuniones — COMPLETO Y CUTOVER 100%, desde la Fase 42.**
      `apps.meetings` (`Meeting`/`MeetingInvitee`) + integración real
      de Zoom (OAuth Server-to-Server) con fallback simulado +
      `GET/POST /meetings/` + `GET/PATCH/DELETE /meetings/<meeting_id>/`,
      **sirviendo tráfico real desde Next.js**
      (`src/lib/djangoMeetingsAdapter.ts`). Otter.ai no tiene
      integración de API que portar (confirmado: 100% manual en el TS
      legacy).
  11. **Mejora Continua / ideas — COMPLETO Y CUTOVER 100%, desde la
      Fase 43.** `apps.ideas` (`ImprovementIdea`/`IdeaVote`/
      `IdeaStatusHistory`) + `GET/POST /ideas/` + `GET/PATCH
      /ideas/<idea_id>/` + `POST /ideas/<idea_id>/vote/` + `PATCH
      /ideas/<idea_id>/status/` + `GET /ideas/<idea_id>/history/`,
      **sirviendo tráfico real desde Next.js**
      (`src/lib/djangoIdeasAdapter.ts`). Asigna el badge "innovador" al
      autor cuando una idea llega a IMPLEMENTADA (gap cerrado en la
      Fase 27, ver "Implementado" arriba).
  12. **Solicitudes LOPD — COMPLETO Y CUTOVER 100%, desde la Fase 45.**
      `DataSubjectRequest` (crear/listar/resolver + exportar "mis
      datos") COMPLETO (ver "Implementado" arriba): `apps.data_requests`
      + `GET/POST /data-requests/` + `PATCH /data-requests/<request_id>/`
      + `GET /data-requests/my-data/`, **sirviendo tráfico real desde
      Next.js** (`src/lib/djangoDataRequestsAdapter.ts`). Investigado
      antes de portar (ver
      docs/AUDIT_LOG.md): NO hay borrado/anonimización real de datos —
      "eliminación de cuenta" es 100% gestión manual de un
      Administrador, sin automatización que portar con cuidado
      especial. El gate de consentimiento (`data_consent_accepted`/
      `data_consent_accepted_at`, `PATCH /api/auth/consent`, reset
      individual/masivo) — deferido en esta fase por ser un mecanismo
      distinto (bloquea el render de toda la app) — se implementó en
      la Fase 13 (ver punto 9).
  13. **Papelera transversal / Centro de Recuperación — COMPLETO**
      (ver "Implementado" arriba, Fase 14): `apps.recovery`
      (`RecoveryItem`/`RecoveryAuditLog` + `ENTITY_REGISTRY`) + `GET
      /projects/trash/` + `POST /projects/<id>/restore/` + `DELETE
      /projects/<id>/permanent/` + `DELETE /desk-notes/<id>/` +
      `purge_expired_archived_notes()`. Asimetría Proyectos (flujo
      completo) vs. Notas (solo mover a la papelera) fiel al TS,
      decisión explícita del usuario. **Lado Proyectos cutover en la
      Fase 39** (ver "Implementado" arriba) — cerraba un bug activo
      documentado desde la Fase 5f. **Lado Notas (`DELETE
      /desk-notes/[id]`) cutover en la Fase 50** (ver "Implementado"
      arriba) — a diferencia de Proyectos, nunca tuvo UI de
      restauración (`listActiveTrash("DESK_NOTE")` sin caller, ni en
      el TS legacy ni en Django), así que no había interdependencia
      que coordinar. `src/lib/recoveryCenter.ts` (Next.js) queda sin
      ningún importador tras este cutover — no se eliminó (fuera de
      alcance). `purge_expired_archived_notes()` (backend, Fase 14)
      sigue sin activar en ningún lado (gap preexistente, ya
      documentado en la Fase 31 vía `archiveRetentionDays`).
  14. **Decommission de PostgreSQL — COMPLETO EN SU TOTALIDAD desde el
      2026-08-28: código (Fase 90) + servicio físico local
      (`postgresql-x64-16`, detenido y con `StartType: Manual` — ver
      `docs/AUDIT_LOG.md` § 2026-08-28, "Decommission del servicio
      físico de PostgreSQL local"). Único punto sin decisión tomada:
      el hosting externo Neon (`docs/RAT.md`/`docs/PENDIENTES_LEGALES.md`),
      deliberadamente sin tocar.**
      (Ya no "deliberadamente
      última sin fecha": el usuario pidió arrancarla explícitamente,
      ver `docs/AUDIT_LOG.md` § 2026-08-14, Fase 6a). **Módulo Auth
      COMPLETO** — sub-fases 6a (Login, modelo híbrido de IDs), 6b
      (logout/me/change-password) y 6c (forgot-password/reset-password,
      cierra Auth) implementadas — ver "Implementado" arriba. Única
      excepción retenida deliberadamente: `activityFormat`/
      `viewPreferences` sigue en Postgres (Fase 6b, sin campo
      equivalente en Django). **Fase 40 (ver "Implementado" arriba)
      construyó el puente de ids** — `session.djangoUserId` +
      `resolveDjangoUserId`. **Corrección (2026-08-24, Fase 53): este
      párrafo quedó desactualizado por más de 10 fases** — el cutover
      de los 5 módulos originalmente listados como candidatos
      (Notificaciones, `users/assignable`+Reuniones, Ideas,
      Comunicados) se cerró completo en las Fases 41-44 (2026-08-21,
      ver "Implementado" arriba y `docs/AUDIT_LOG.md` § 2026-08-21).
      Desde entonces la migración siguió con más cutovers apoyados en
      el mismo puente (Solicitudes LOPD, Equipo, Analytics/KPIs,
      Inteligencia Preventiva, Dashboard, `settings/*`, Nova
      Insights/Message, Consentimiento/Preferencias) — ver
      "Implementado" arriba, Fases 45-55. Este párrafo se corrigió 2
      veces mientras se auditaba directamente contra el código: (1)
      Nova Insights/Message no necesitó backend nuevo (Fase 54, el
      motor ya estaba 100% portado desde la Fase 4m/47); (2) el
      cluster de Consentimiento/Preferencias **quedó completo en su
      totalidad (6 de 6 rutas) en la Fase 55**, incluidas las 2 que
      sí requerían backend nuevo (`UserViewPreferencesView`/
      `ActivityFormatView`) — un bloqueo inicial por "SQL Server no
      accesible" resultó ser un diagnóstico incorrecto (Docker no
      aparecía activo en el primer chequeo; `localhost:14330` sí era
      el contenedor correcto del proyecto), resuelto en la misma
      sesión. **Corrección (2026-08-25, Fase 58): Asistente LLM/RAG,
      listado abajo como ítem 2, ya está completo** (ver punto 6 más
      abajo en este mismo documento y "Implementado" arriba) — su
      riesgo original (portar embeddings a Python) resultó ser un
      riesgo aparente. **Corrección (2026-08-26, Fase 73): el ítem 2
      de este párrafo (motor de cálculo de Reportes Ejecutivos)
      quedó cerrado** — ver punto 5 más arriba en este mismo
      documento y "Implementado" arriba. **Corrección (2026-08-27):
      el párrafo original de este punto (y varias entradas de
      `docs/VERSION.md`) conflacionaban "cutover de ruta" (¿el
      `route.ts` habla con Django?) con "migración de datos reales
      completa" (¿Django tiene los datos históricos?) — son cosas
      DISTINTAS. Un relevamiento completo confirmó que
      `migrate_users_from_postgres` es el ÚNICO comando de migración
      de datos que existe en todo el backend (solo migra `User`) — no
      existe, ni siquiera sin ejecutar, un comando equivalente para
      NINGUNA otra entidad de negocio (Tareas, Actividades,
      Comentarios, Proyectos + 6 sub-entidades, Notificaciones, Notas/
      Recordatorios del Escritorio, Reuniones/Invitados, Ideas/Votos,
      Solicitudes LOPD, Feriados/Permisos/Estados Especiales,
      Historial de Configuración, Base de Conocimiento/Chunks,
      Comunicados, Papelera/Recovery — ~40 entidades). De los 44
      modelos de Prisma, 42 ya tienen modelo Django equivalente listo
      para recibir datos (el esquema está hecho); 2
      (`MonthlyReport`/`DataPurgeLog`) no tienen equivalente y
      necesitan una decisión de producto. Sin mecanismo de escritura
      dual — Django nunca acumuló datos reales en paralelo desde
      ningún cutover de ruta. Este hallazgo ya estaba parcialmente
      documentado desde la Fase 3a (2026-08-07, ver más abajo en este
      mismo documento) pero nunca se generalizó a una lista de
      seguimiento. Lo que genuinamente falta para un corte real a
      producción, entonces, no es "un único ítem" sino: (a) correr
      `migrate_users_from_postgres` contra datos reales, y (b) escribir
      y correr ~40 comandos de migración de datos más (mismo patrón ya
      probado), más (c) decidir el destino de `MonthlyReport`/
      `DataPurgeLog`. Ver `docs/AUDIT_LOG.md` § 2026-08-27 para el
      inventario completo.**
      Recién con eso cerrado tiene sentido retirar Next.js/Postgres y
      el fallback bcrypt por completo.

      **Corrección (2026-08-28, Fases 87-90):** el párrafo anterior seguía
      describiendo el decommission como pendiente de la migración de
      DATOS reales (deliberadamente descartada en la Fase 82, ver arriba).
      A NIVEL DE CÓDIGO, en cambio, el decommission SÍ se completó en
      esta fecha: los últimos 3 consumidores directos de Prisma que
      quedaban en `src/` (`resolveRoster.ts`, `computeDataQuality`/
      `recordEngineVersionIfChanged` vía `diagnostics/route.ts`, la
      comparación mes-anterior de `buildSnapshotData.ts`) se reconectaron
      a 3 endpoints Django nuevos (Fases 87-89), y todo rastro de
      Prisma/PostgreSQL se retiró del repo (Fase 90) — dependencias en
      `package.json`, `prisma/`, `src/lib/prisma.ts`,
      `src/generated/prisma/`, y los 79 archivos que importaban solo
      TIPOS desde el cliente generado, migrados a definiciones locales en
      su módulo dueño de dominio. Ningún `route.ts` en todo el repo toca
      una base de datos directo. Ver `docs/AUDIT_LOG.md` § 2026-08-28
      (Fases 87-90) para el detalle completo — incluye, explícitamente
      fuera de alcance, la infraestructura física (servicio de Windows
      `postgresql-x64-16`/hosting Neon), que el usuario decidió no tocar
      por la posible presencia de datos reales de personal.

  Ver `docs/AUDIT_LOG.md` § 2026-08-07 para el detalle de las decisiones
  de la Fase 1 ya implementada.

- **Sprint Q — Analytics Engine Performance — RE-MEDIDO EN LA FASE 77
  (2026-08-26), HALLAZGO DE SEVERIDAD ALTA, sin corregir todavía.**
  Descripción original (v1.22.3, ~22s/9 colaboradores, "lento pero
  funciona"): quedó **desactualizada** por 2 cutovers posteriores de la
  migración de stack — `computeHealthScore`/`computePerformanceScore`
  ya no corren localmente (Fase 57, reemplazadas por N llamadas HTTP
  paralelas a Django); `computeCumplimientoProjection`/
  `computeSobrecargaProbability` (`predictionEngine.ts`) siguen igual.
  La Fase 77 reconstruyó el escenario sintético completo (Postgres +
  Django, mismo método de la Fase 70) y remidió de punta a punta contra
  el endpoint real de producción — **resultado: `POST
  /api/reports/executive?tipoReporte=MENSUAL` para el mes en curso
  FALLA con 500, no solo excede presupuesto.** Causa raíz: cada `GET
  /analytics/<id>/` (Django) tarda ~1.2-1.8s aislada pero **5.0-9.0s
  bajo la concurrencia real de N llamadas en paralelo** (una por
  colaborador) — muy por encima del timeout de cliente de 3s de
  `djangoApiFetch` (`src/lib/djangoSession.ts`), que aborta la llamada
  y hace fallar toda la generación. RANGO_MESES/RANGO_PERSONALIZADO no
  están afectados (nunca llaman a esa ruta) — midieron 3.64s/2.58s con
  11 colaboradores, cómodos dentro del presupuesto de 15s.
  `scripts/bench-executive-report.ts` fue reescrito en esta misma fase
  (login real + HTTP real contra el endpoint de producción, en vez de
  llamar builders directamente — ese patrón dejó de ser viable desde
  que `buildMonthlySnapshotData` depende de `cookies()` de
  `next/headers`) y queda como herramienta permanente de re-medición.
  **No se investigó la causa exacta de la degradación bajo
  concurrencia** (contención de SQL Server vía `mssql-django`/pyodbc,
  límites del servidor de desarrollo usado para medir, u otra causa) ni
  se implementó ninguna corrección — el alcance de la Fase 77 fue
  deliberadamente solo medición. **Queda pendiente, con más urgencia
  que antes, una fase de optimización separada** que decida entre:
  aumentar el timeout de `djangoApiFetch`, batch-ificar
  `predictionEngine.ts` (sigue 100% válido y sin tocar —
  `computeTeamCapacityForecast`/`computeSubutilizacionPredictions` como
  plantilla ya existente), construir un endpoint batch nuevo en Django
  para `performance_score`/`health_score` (no existe hoy — confirmado
  al re-medir, ver `docs/AUDIT_LOG.md` § 2026-08-26, Fase 77), y/o
  investigar la causa raíz de la degradación bajo concurrencia. Ver
  también la entrada original, `docs/AUDIT_LOG.md` § 2026-07-28
  (Executive Reporting Engine 2.0 — Parte IV). **Fase 78 (2026-08-27,
  ver "Implementado" arriba) identifica la causa raíz probable —
  configuración de despliegue, no código de aplicación:**
  `backend/entrypoint.sh` arranca gunicorn con `--workers 3` sin
  `--threads` (worker `sync`, 1 request a la vez por worker) — con
  9-11 llamadas paralelas por reporte, la aritmética de cola (⌈11/3⌉
  rondas × ~1.5s/request) coincide con precisión con los 5-9s medidos
  en la Fase 77. Fix aplicado: `--worker-class gthread --threads 4`
  (capacidad de 3 a 12 requests simultáneas) — **sin re-verificar
  contra gunicorn real** (decisión explícita del usuario, entre 3
  opciones presentadas).

  **RE-MEDIDO PARCIALMENTE el 2026-08-28** (ver `docs/AUDIT_LOG.md` §
  2026-08-28, "Re-medición de performance del motor de Analytics"):
  `POST /api/reports/executive` con 10 colaboradores sintéticos ya NO
  falla y corre muy por debajo del presupuesto — MENSUAL (mes en curso)
  754ms, 2ª generación (`cached()`) 507ms, RANGO_MESES 308ms,
  RANGO_PERSONALIZADO 219ms (los 4 contra un presupuesto de 15s). **Con
  una salvedad real:** este número es contra `manage.py runserver`
  (threaded por defecto), NO contra gunicorn con el fix `--threads 4` —
  Docker no pudo descargar la imagen base en el sandbox de esta sesión
  (bloqueo de red/TLS al registry, no resuelto), así que el fix en sí
  sigue sin verificarse contra un gunicorn real. Lo que SÍ confirma esta
  medición: bajo un servidor que atiende las N llamadas paralelas a
  `/analytics/<id>/` sin la cola limitada a 3 slots de gunicorn `sync`,
  el tiempo total es bajo — consistente con el diagnóstico de causa raíz
  de la Fase 78 (cuello de botella de concurrencia del servidor, no de
  cómputo). Sigue pendiente, sin urgencia, la verificación 1:1 contra
  gunicorn real cuando haya un entorno con acceso al registry de Docker.
- **Sprint R — Snapshot Integrity Validation — IMPLEMENTADO EN LA FASE 79
  (2026-08-27).** Validación ACTIVA en tiempo
  de ejecución que vuelve a consultar Dashboard/Analytics al momento de
  generar un reporte y compara/registra cualquier discrepancia como
  incidente (FPS Parte IV §15). La integridad ESTRUCTURAL ya se consideraba
  cumplida en v1.22.3 — el Executive Reporting Engine usa un único Builder
  canónico (`buildSnapshotData.ts`) que llama a las mismas funciones de
  Analytics que Dashboard/Analytics ya usan, y un único objeto
  `ExecutiveReportSnapshotData` del que se derivan todas las vistas — dos
  superficies no pueden divergir si comparten la misma función y el mismo
  objeto. La Fase 79 agrega la capa de monitoreo activo que en ese momento
  se difirió, complementando (no reemplazando) esa integridad estructural.
  **2 gaps del FPS resueltos con el usuario antes de implementar:**
  "Dashboard/Analytics" se interpretó como las pantallas de KPIs/Analytics
  reales (`GET /kpis/team/`+`GET /analytics/<id>/`), no como
  `GET /api/dashboard` literal (que no tiene ningún KPI); la validación
  solo corre para reportes MENSUAL del mes calendario en curso SIN
  `fechaCorte` explícita, porque `TeamKpiView` (la fuente de comparación)
  no es consciente de la fecha de corte de un reporte — compararla contra
  reportes históricos/con corte habría generado discrepancias falsas por
  diseño. Nuevo modelo Django `ExecutiveReportIntegrityIncident`
  (append-only, sin ciclo de vida de resolución todavía, sin UI de
  gestión/listado — se agrega cuando exista un consumidor real). Ver
  `docs/AUDIT_LOG.md` § 2026-08-27 (Fase 79) y § 2026-07-28 (Executive
  Reporting Engine 2.0 — Parte IV, decisión original de diferir esto).
- **Migración de DATOS reales — DESCARTADA por decisión de producto en
  la Fase 82 (2026-08-27, ver `docs/AUDIT_LOG.md` § 2026-08-27).**
  Distinta del cutover de RUTA (ya 100% completo). El CÓDIGO de los 40
  comandos `migrate_*_from_postgres` (Usuarios + Waves 0-4) quedó
  completo y verificado end-to-end contra datos sintéticos desde la
  Fase 81 (Postgres descartable + BD Django real de este entorno,
  cadena completa Usuarios→Wave0→Wave1→Wave2→Wave3→Wave4,
  re-ejecución 100% idempotente) — **ese código se conserva intacto,
  pero no se ejecuta contra producción.** Al pedir avanzar con la
  ejecución real, el usuario aclaró explícitamente que no quiere
  recuperar ningún dato histórico real: las pruebas de funcionalidad
  siguen usando siempre datos ficticios, igual que en las Fases
  70/77/80/81. Ya no es un bloqueante pendiente — es alcance
  explícitamente fuera de esta migración. `MonthlyReport`/
  `DataPurgeLog` quedan también fuera de las 40 (ver ítem aparte más
  abajo — resultó ser un port de FEATURE completo, no una migración de
  datos). Sin mecanismo de escritura dual — Django nunca acumuló datos
  reales en paralelo desde ningún cutover de ruta, y no lo hará por
  esta vía.
  - **Wave 0 (Fase 80):** `ActivityReason`, `Holiday` — sin
    dependencias. `legacy_postgres_id` agregado a los 40 modelos en
    alcance (13 migraciones Django nuevas, una por app). Módulo
    compartido `backend/apps/core/legacy_migration.py`
    (`legacy_postgres_connection`/`fetch_legacy_rows`/
    `filter_not_yet_imported`/`safe_batch_size`/`bulk_import_rows`) —
    reutilizado por las 4 waves siguientes sin cambios de diseño.
  - **Wave 1 (Fase 81, 13):** `Task`, `Announcement`,
    `KnowledgeDocument`, `ImprovementIdea`, `Meeting`,
    `DataSubjectRequest`, `SystemConfigHistory`, `LeaveRecord`,
    `SpecialStatus`, `Project`, `AnalyticsAuditLog`, `MonthClosure`,
    `ExecutiveReportSnapshot` — dependen solo de `User`.
  - **Wave 2 (Fase 81, 16):** `TaskActivity`, `Comment`,
    `TaskCommentView`, `TargetTimeAuditLog`, `EndDateAuditLog`,
    `Notification`, `PersonalReminder`, `IdeaVote`, `IdeaStatusHistory`,
    `MeetingInvitee`, `ProjectParticipant`, `ProjectPhase`,
    `ProjectHistory`, `ProjectComment`, `DocumentChunk`,
    `ExecutiveReportAuditLog` — dependen de una entidad de Wave 1 +
    `User`.
  - **Wave 3 (Fase 81, 4):** `ActivityComment`, `ActivityAuditLog`,
    `DeskNote`, `ProjectActivity` — dependen de una entidad de Wave 2.
  - **Wave 4 (Fase 81, 5):** `DeskNoteReply`, `ProjectDocument`,
    `RecoveryItem`, `RecoveryAuditLog`, `DeskAuditLog` — dependen de
    una entidad de Wave 3.

  Notas de diseño confirmadas durante la implementación de las Waves
  1-4 (Fase 81), útiles si se necesita tocar `legacy_migration.py` o
  algún comando más adelante: `ExecutiveReportSnapshot.collaboratorIds`
  se copia TAL CUAL (cuids de Postgres, nunca se resuelve a ids de
  Django — así lo dejó la Fase 57 a propósito), igual que
  `RecoveryItem.entity_id`/`RecoveryAuditLog.entity_id`. Referencias
  sueltas con tipo NUMÉRICO en Django (a diferencia de la mayoría, que
  son `CharField` con el cuid legacy tal cual) sí necesitan resolución:
  `TargetTimeAuditLog.task_id`/`EndDateAuditLog.task_id`/
  `ActivityAuditLog.activity_id`/`Notification.task_id` (un solo modelo
  destino) y `DeskAuditLog.entity_id` (destino dinámico según
  `entity_type`: `"NOTE"` → `DeskNote`, `"REMINDER"` →
  `PersonalReminder`). `ProjectDocument.previous_version_id` es
  autorreferencial (apunta a otra fila del mismo modelo) — se resuelve
  en una segunda pasada después del `bulk_create`, con un `bulk_update`
  manual (mismo mecanismo de 2 fases que ya usa `bulk_import_rows` para
  `auto_now`, aplicado a mano por ser un campo de negocio). Un modelo
  sin ningún timestamp legacy para alguno de sus campos automáticos
  (`MeetingInvitee`, sin `createdAt`/`updatedAt` en Prisma) reveló un
  bug real en `bulk_import_rows` — corregido, ver
  `docs/AUDIT_LOG.md` § 2026-08-27 (Fase 81). Tablas de alto volumen/
  riesgo (`TaskActivity`, `Comment`, `Notification`, `ProjectActivity`/
  `ProjectHistory`, los 4 audit logs, `RecoveryItem`/`RecoveryAuditLog`/
  `DeskAuditLog`) usan `batch_size` reducido; campos con blobs base64
  grandes (`ProjectDocument.file_data`, `DeskNote`/`PersonalReminder`/
  `ImprovementIdea.attachment_data`, `KnowledgeDocument.content`,
  `DocumentChunk.embedding`/`content`, `ExecutiveReportSnapshot.data`/
  `nova`) usan `batch_size` todavía más chico — ninguno de estos 2
  puntos requirió lectura por cursor del lado de Postgres en la
  verificación con datos sintéticos (volumen bajo), pendiente de
  confirmar si hace falta con el volumen real de producción.
- ~~Port de la feature de retención/purga de `MonthlyReport`/`DataPurgeLog`
  a Django~~ — **IMPLEMENTADO EN LA FASE 83 (2026-08-27, ver sección
  "Implementado" y `docs/AUDIT_LOG.md` § 2026-08-27).**
- **Sprint S — Executive Benchmark**: comparativos automáticos entre meses,
  áreas, equipos y tendencias — un salto desde "un reporte de un período" a
  "comparar varios reportes entre sí" dentro del propio motor (hoy el único
  mecanismo de comparación es la Evolución Mensual dentro de un mismo
  `RANGO_MESES`, no una comparación entre dos reportes independientes o dos
  áreas). Sin diseño técnico todavía — registrado como intención, no como
  plan de implementación.
- **Sprint T — Executive Presentation**: generación automática de
  PowerPoint, presentación ejecutiva y resumen para comité a partir del
  mismo `ExecutiveReportSnapshotData` ya congelado — un tercer formato de
  salida junto a PDF/Excel, reutilizando el mismo principio de "un solo
  snapshot, múltiples renders" que ya separa `renderReportHtml.ts` de
  `renderReportExcel.ts`. Sin diseño técnico todavía.
- **Sprint U — Conversational Executive Reporting**: integración completa
  con NOVA para permitir consultas conversacionales sobre cualquier Snapshot
  histórico ("¿por qué bajó el cumplimiento en marzo?", respondido contra el
  `ExecutiveReportSnapshotData` real de ese Report ID, no contra datos en
  vivo) — distinto de los 3 usos actuales de NOVA en el sistema (KPI
  individual, saludo de Dashboard, narrativa del reporte ejecutivo mismo).
  Sin diseño técnico todavía.
- Integración profunda del motor predictivo (Sprint E, v1.19.0) en Dashboard,
  Analytics/KPIs, Reportes Inteligentes, Proyectos y Equipo — este sprint
  deliberadamente construyó el motor y un módulo autónomo
  (`/inteligencia-preventiva`) sin tocar esas pantallas existentes; conectar
  predicciones/alertas preventivas directamente en ellas queda para un
  sprint futuro. Ver `docs/AUDIT_LOG.md` § 2026-07-26 (Sprint E).
- Indicador "Consultas" del Trend Engine (Sprint E) — no implementado: no
  existe ninguna tabla que registre preguntas hechas a Nova (asistente
  stateless por diseño). Requiere decidir explícitamente si vale la pena
  agregar logging de conversaciones (con las implicaciones de privacidad/
  LOPDP que eso conlleva) antes de construirlo. Ver `docs/AUDIT_LOG.md` §
  2026-07-26 (Sprint E).
- Resolver la inconsistencia documentada entre `computeEstimatedVsRealRatio`
  (usa `estimatedHours` crudo en 7 sitios) y `computeTargetTimePrecision`
  (respeta el Tiempo Objetivo validado) — requiere una decisión de negocio
  explícita antes de tocar el cálculo, ya que afecta el Score básico
  existente. Ver `docs/ANALYTICS_FORMULAS.md`.
- Ampliar el acceso a `/settings` (Configuración de Analytics) a Jefe
  Nacional — actualmente la página completa está gateada a
  Administrador/Coordinador Nacional aunque la API ya lo permitiría; no se
  amplió como efecto secundario de otro sprint por ser una restricción de
  seguridad preexistente que protege también otras secciones (retención,
  purga de datos, base de conocimiento).
- Limpieza de `src/lib/riskAlerts.ts` (motor de alertas vestigial, sigue
  ejecutándose sin que ningún componente lo consuma tras la migración a
  `EngineAlertsCard`).
- Hacer configurable la hora de corte de jornada (17:00 local) usada por
  `computeCapacityForecast` — actualmente hardcodeada, no editable desde
  Ajustes.
- Pantalla de Ajustes para el período de retención del Centro de
  Recuperación (`CONFIG_KEY_RECOVERY_RETENTION_HOURS` en
  `src/lib/systemConfig.ts` ya existe y es funcional vía `setConfigValue`,
  falta únicamente el control de UI en Administración).
- Cron dedicado (ej. Vercel Cron) para `purgeExpiredItems()` — hoy la purga
  automática es un barrido perezoso disparado al abrir la Papelera; un
  elemento expirado no se purga hasta que alguien visite esa pantalla.
- Consola administrativa unificada del Centro de Recuperación (§14) —
  vista de todos los elementos eliminados de cualquier módulo
  (🗑 Trabajo, 🗑 Proyectos, 🗑 Documentos, ...). El modelo
  (`RecoveryItem`/`RecoveryAuditLog`) ya es transversal a cualquier
  `entityType`; falta la pantalla.
- Integrar módulos adicionales al Centro de Recuperación (Trabajo,
  Documentos, Repositorios, Plantillas, Comunicados) — cada uno requiere
  solo una entrada nueva en `ENTITY_REGISTRY` (`src/lib/recoveryCenter.ts`)
  más su propia bandera `deletedAt` local. Proyectos y Escritorio Digital
  ya están integrados.
- Pantalla de papelera/restauración/eliminación definitiva dedicada para
  Escritorio Digital (`entityType: "DESK_NOTE"`) — el adaptador y el
  soft-delete ya existen del lado Django (`DELETE /api/desk-notes/[id]`,
  cutover en la Fase 50, usa `apps.recovery.move_to_trash`), falta la UI
  de restaurar/purgar, igual que para Proyectos (ver el punto de consola
  administrativa unificada más arriba).
- Timestamp real de "última visita a Escritorio Digital" por usuario — la
  Bandeja Hoy usa una ventana fija de 7 días para "proyectos con actividad
  reciente" en su lugar (ver `docs/AUDIT_LOG.md` § 2026-07-23).
- **Este documento no se actualizó entre v1.9.0 y v1.14.3** — reconciliarlo
  por completo con `docs/CHANGELOG.md` es una tarea propia (identificado
  durante el Sprint D, ver `docs/AUDIT_LOG.md` § Sprint D); no se hizo como
  efecto secundario de ese sprint para no inflar su alcance.
- Paridad de edición/eliminación entre `ProjectActivity` y `TaskActivity` —
  hoy una actividad de Proyecto, una vez creada, es permanente e
  inauditable incluso para un Administrador; `TaskActivity` sí tiene
  corrección administrativa y eliminación por el autor (`AUDIT_LOG.md` §
  Sprint D).
- Notificar a los invitados de una reunión al reprogramarla o cancelarla —
  hoy `POST /api/meetings` notifica solo en la creación; `PATCH`/`DELETE`
  en `meetings/[id]/route.ts` no avisan a nadie (`AUDIT_LOG.md` § Sprint D).
- Extender `findOverlappingActivity` para detectar solapamiento de horario
  cruzando Tarea↔Proyecto (hoy solo cubre Tarea↔Tarea) — el panel de
  Calidad del Dato (Sprint D) ya evidencia el hueco sin corregirlo
  (`AUDIT_LOG.md` § Sprint D).
- Unificar la validación de `estimatedHours` entre `POST /api/tasks` (acepta
  0/negativos) y el pipeline de conversión Recordatorio→Tarea (los rechaza)
  — decidir primero cuál dirección es la correcta antes de tocar cualquiera
  de las dos (`AUDIT_LOG.md` § Sprint D).
- UI de restauración/papelera para Notas archivadas de Escritorio Digital —
  el soft-delete ya existe del lado Django (`DELETE /api/desk-notes/[id]`,
  cutover en la Fase 50), falta la pantalla, igual que el punto ya
  existente arriba para "consola administrativa unificada".
- Batched `computeTeamOperationalRisk`/`computeTeamPerformanceScore`,
  mirando el patrón ya existente de `computeTeamCapacityForecast` — diferido
  en Sprint D por el riesgo de tocar funciones de cálculo frágiles fuera del
  apetito de riesgo de ese sprint (`AUDIT_LOG.md` § Sprint D).
- Primitivo `Input`/`FormField` compartido para Login/Perfil — hoy son los
  únicos módulos con inputs 100% hand-styled, sin el sistema de diseño; no
  existe un primitivo así todavía, crearlo es alcance mayor que un ajuste
  de markup (`AUDIT_LOG.md` § Sprint D — continuación, Bloque 7).
- Unificar el color de los banners "info/confirmación" — hoy `login/page.tsx`
  usa `bg-primary-surface` para el mensaje de confirmación de
  recuperar-contraseña mientras el resto de la plataforma usa
  `bg-success/[.13]` para mensajes equivalentes; requiere elegir un color,
  no es un dedup de markup (`AUDIT_LOG.md` § Sprint D — continuación).
- `IdeaCard.tsx`: agregar activación por tecla Espacio (además de Enter) al
  `role="button"` de la tarjeta — toca manejo de teclado, no es un cambio
  de markup puro (`AUDIT_LOG.md` § Sprint D — continuación, Bloque 7).
- Extender el estándar de explicabilidad (Sprint Analytics 2.0 — "qué
  significa/por qué/impacto/qué hacer") de Equilibrio Operativo a las
  tarjetas standalone de Cumplimiento, Carga Laboral, Capacidad
  Disponible, Trazabilidad, Predicción y Smart Benchmark. El patrón
  reutilizable ya existe (`computeEquilibrioInsights`/
  `explainEquilibrioFactor`/`explainEquilibrioMeaning`/
  `explainEquilibrioImpact` en `src/lib/insightsEngine.ts`, más
  `EquilibrioOperativoCard.tsx` como plantilla de composición) — alcance
  confirmado explícitamente con el usuario para no ampliar ese sprint.
- Migrar `capacityToScore` (`src/lib/analytics.ts`) íntegro al
  `NormalizationEngine` (`src/lib/normalizationEngine.ts`) ya existente y
  configurable en Ajustes — hoy la curva `capacidad` de ese motor está
  definida pero es código muerto (ningún cálculo real la usa) y sus
  puntos de control no coinciden con los anclajes agregados por Sprint
  Analytics 2.0 (Bloque 9) para el rango negativo. La migración
  completa tocaría también el lado positivo (`alta`/`limitada`/
  `sin-planificacion` → 100/70/70), fuera del único cambio matemático
  autorizado en ese sprint.
- Unificar `computeTeamMonthlySnapshots` (`src/lib/reportInsights.ts`,
  Sprint Reportes Ejecutivos 2.0) con la lógica de snapshots mensuales ya
  existente en `src/app/api/kpis/executive/route.ts` (líneas 82-190,
  prácticamente equivalente) — no se tocó `kpis/executive` en ese sprint
  para no introducir riesgo de regresión en una ruta estable fuera de su
  alcance declarado (ver `docs/AUDIT_LOG.md`).
- Extender el Índice Ejecutivo del Equipo y las tarjetas de tendencia mes/
  trimestre/semestre (Sprint Reportes Ejecutivos 2.0, Bloques 1/9/11) al
  informe de Rango personalizado (`reports/range`) — hoy solo existen en
  el informe de un mes; el rango ya cubre el mismo propósito de Bloque 9
  vía su evolución mes a mes, pero no tiene un equivalente de Bloque 11
  (un "mes en curso" no aplica limpiamente a un rango de N meses, requiere
  una decisión de producto explícita antes de implementarse).
- Base Horaria Efectiva y Estado Operativo/Principal Hallazgo por
  colaborador (Bloques 1, 9 y 10 de Sprint Analytics 2.1) no se extendieron
  a `computeTeamMonthlySnapshots`/las tarjetas de Tendencias mes-trimestre-
  semestre — esas siguen usando `computeSimpleScore` sobre una base plana,
  sin proration ni Estado Operativo por diseño (son snapshots livianos para
  4 tarjetas comparativas, no el detalle por colaborador). Evaluar si vale
  la pena extenderlo en un sprint futuro.
- Comparación de Equipos (áreas/equipos/coordinaciones/zonas) — arquitectura
  preparada en `src/lib/teamComparison.ts` (Sprint Analytics 2.1, Bloque
  12), sin implementar: falta decidir la dimensión organizacional real
  (NEXO no tiene hoy un campo de área/equipo/zona en `User`, solo `role`) y
  la UI de comparación en sí.
- Centro de Configuración — SLA y nivel de riesgo en Proyectos: no existen
  hoy ni como campo ni como lógica; el pedido original del Sprint O ya los
  nombraba como parte de un "Sprint K" aparte. Ver `docs/AUDIT_LOG.md` §
  2026-07-28 (Sprint O).
- Centro de Configuración — plantillas/logotipo/portada/firmas y
  programación automática de Reportes: no existe ningún motor de plantillas
  ni infraestructura de scheduler/envío de email en el repositorio; el
  pedido original ya los nombraba como parte de un "Sprint F" aparte — es
  el ítem de mayor alcance de los identificados en el Sprint O. Ver
  `docs/AUDIT_LOG.md` § 2026-07-28 (Sprint O).
- Centro de Configuración — permisos especiales por usuario en Seguridad:
  toda la autorización de Nexo es hoy por `Role` (`src/lib/roles.ts`), sin
  ningún mecanismo de excepción individual; agregarlo es una capa de
  autorización nueva, y el pedido del Sprint O pedía explícitamente no
  modificar la seguridad existente, solo centralizar su configuración. Ver
  `docs/AUDIT_LOG.md` § 2026-07-28 (Sprint O).
- Centro de Configuración — tono/idioma/módulos donde participa NOVA: hoy
  hardcodeado en 5 prompts de sistema repartidos en 2 archivos
  (`api/assistant/chat/route.ts`, `api/kpis/nova-insights/[userId]/route.ts`)
  sin ningún interruptor de participación por módulo; el Sprint O solo
  confirmó el TTL de caché como configurable. Ver `docs/AUDIT_LOG.md` §
  2026-07-28 (Sprint O).
- Centro de Configuración — prioridades/estados/tipos de tarea y días
  laborables como listas editables: son enums de Prisma (`TaskPriority`/
  `TaskStatus`/`TaskType`) y una constante síncrona (`isBusinessDay` en
  `businessTime.ts`) usados en decenas de sitios (chips, filtros, fórmulas
  de Analytics) — convertirlos exige migración de esquema y, en el caso de
  días laborables, un cambio de arquitectura sync→async en todo el motor de
  carga laboral. Diferido explícitamente por decisión del usuario en el
  Sprint O. Ver `docs/AUDIT_LOG.md` § 2026-07-28 (Sprint O).
- Centro de Configuración — idioma/moneda en Parámetros Globales: Nexo es
  100% español hardcodeado sin librería de i18n y no existe ningún concepto
  de moneda (sistema de RRHH, sin transacciones monetarias) — agregar estos
  campos sin un consumidor real sería configuración muerta. Descartado
  explícitamente por decisión del usuario en el Sprint O (no un "pendiente",
  una exclusión deliberada). Ver `docs/AUDIT_LOG.md` § 2026-07-28 (Sprint O).

## Ideas futuras

- Habilitar el registro retroactivo de actividades también para tareas
  Fijas (hoy exclusivo de Seguimiento, decisión de alcance del sprint de
  unificación de registro — ver `docs/AUDIT_LOG.md`).
- Panel de auditoría visual para `AnalyticsAuditLog`/`TargetTimeAuditLog`
  (hoy solo consultables vía Prisma Studio o queries directas).
- Versionado explícito de la API (`docs/ARCHITECTURE.md` señala que hoy no
  existe un esquema de versionado para las rutas de `src/app/api`).
- Integrar las horas de `ProjectActivity` al Analytics Engine (carga
  laboral, Performance Score, capacidad, Tiempo Objetivo, consistencia) —
  el modelo del módulo Proyectos (v1.5.0) ya deja `realHours`/
  `targetTimeHours` preparados con la misma convención que `Task`, pero
  ningún cálculo del motor los lee todavía (decisión explícita del sprint,
  ver `docs/AUDIT_LOG.md` § 2026-07-23).

---

_Última actualización: 2026-07-28._
