# Arquitectura de Nexo

Referencia técnica de la arquitectura del sistema. Complementa a `CLAUDE.md` (guía de
onboarding rápido) y a `docs/ANALYTICS_FORMULAS.md` (fórmulas de negocio del motor de
Analytics) — este documento cubre la arquitectura del sistema: cómo están organizadas
las carpetas, el modelo de datos, el flujo de autenticación y el ciclo de vida de una
request.

---

## 1. Resumen del stack

Nexo es una aplicación **Next.js 16.2.9** (App Router) escrita en **TypeScript**, con
**React 19.2.4**. La capa de datos usa **Prisma 7.8.0** contra **PostgreSQL**, obligatoriamente
a través del driver adapter `@prisma/adapter-pg` (`^7.8.0`) — Prisma 7 ya no soporta
instanciar `PrismaClient` sin adapter. La autenticación es JWT (HS256) firmado con
`jose` (`^6.2.3`), almacenado en una cookie httpOnly (`nexo-session`), con contraseñas
hasheadas vía `bcryptjs` (`^3.0.3`). El estilado usa **Tailwind CSS v4** (`@tailwindcss/postcss`).
La IA conversacional (Nova) usa `groq-sdk` (`^1.3.0`) para inferencia y `@xenova/transformers`
(`^2.17.2`) para generar embeddings locales (sin costo de API) usados en el RAG de la
base de conocimiento. Gráficos con `recharts` (`^3.9.0`), drag-and-drop con `@dnd-kit/*`,
generación de PDF con `jspdf` + `html2canvas` (vendorizados, ver nota en §8), animaciones
con `framer-motion`. Testing con **Vitest 4** + **@testing-library/react** + `jsdom`. El
build de producción corre `prisma migrate deploy && next build` (script `build` en
`package.json`) — las migraciones se aplican automáticamente antes de compilar.

Nota importante heredada de `AGENTS.md`: esta es una versión de Next.js con cambios
disruptivos respecto al Next.js "de siempre" (ej. `middleware.ts` renombrado a
`src/proxy.ts`) — cualquier convención dudosa de App Router debe verificarse contra
`node_modules/next/dist/docs/` antes de asumir el comportamiento clásico.

---

## 2. Estructura de carpetas

```
src/
  app/
    login/                        # página pública de login
    (protected)/                  # grupo de rutas que exige sesión (layout.tsx valida)
      layout.tsx                  # getSession() + redirect si no hay sesión; envuelve en ConsentGate + AppShell
      dashboard/                  # página de inicio post-login (tarjetas, orden personalizable)
      kpis/                       # Analytics de equipo/ejecutivo (AnalyticsModule)
      my-kpis/                    # Analytics personal (MyKpisModule) — vista "Mi actividad"
      tasks/                      # Kanban/Tabla/Gantt/Repositorio de tareas
      tiempo-objetivo/            # validación y regularización del Tiempo Objetivo
      team/                       # vista de equipo (solo nivel >= 2, canViewTeam)
      meetings/                   # reuniones + integración Zoom
      mejora-continua/            # ideas de mejora continua (tablero + votos)
      assistant/                  # Nova, el asistente IA
      settings/                   # Ajustes del sistema (Administrador/Coord. Nacional)
      admin/users/                # gestión de usuarios (canManageUsers)
      profile/                    # perfil propio + cambio de contraseña
    api/
      auth/                       # login, logout, me, change-password, forgot-password, consent
      users/                      # CRUD de usuarios + reset-password, assignable
      tasks/                      # CRUD de tareas + close-month, import, template, target-time
      activities/                 # registro de actividad (TaskActivity) + day-schedule
      activity-reasons/           # motivos de actividad (catálogo)
      analytics/                  # bundle por usuario, benchmarks, insights, operational-risk,
                                   #   recommendations, simulate, target-time, data-quality, diagnostics
      kpis/                       # me, [userId], team, team-capacity, executive, nova-insights
      assistant/                  # chat (Groq + RAG) y gestión de documentos de la KB
      meetings/                   # CRUD de reuniones + invitados
      ideas/                      # CRUD de ideas + cambios de estado
      reports/                    # generate, range (informes mensuales)
      settings/                   # activity-reasons, analytics-config, holidays, kpi-start-date,
                                   #   leave-records, login-attempts, normalization-curves,
                                   #   notification-rules, retention-policy, role-targets,
                                   #   special-status, system-info, welcome-message, workload-config
      data-requests/              # solicitudes LOPDP (acceso/rectificación/eliminación) + my-data
      team/                       # datos de equipo por usuario
      dashboard/                  # card-order, nova-message
      notifications/              # notificaciones + marcado de lectura
      desk-notes/                  # notas Post-it de Escritorio Digital + [id]/attachment,
                                   #   [id]/convert-to-reminder, [id]/replies, [id]/history,
                                   #   recipients, unread-count
      desk-reminders/              # recordatorios personales de Escritorio Digital + [id],
                                   #   [id]/convert-to-task, [id]/history
      desk/                        # today (Bandeja Hoy), search — agregados de solo lectura
      repository/                 # repositorio histórico por año (tareas archivadas)
      announcements/              # anuncios fijados en dashboard
      profile/badges/             # insignias del perfil
    layout.tsx, page.tsx, globals.css   # shell raíz de la app
  components/
    shell/                        # AppShell, Sidebar, Topbar, CommandPalette, NovaFab (chrome de la app)
    tasks/                        # Kanban/Table/Gantt views, TaskFormModal, ActivityPanel,
                                   #   RetroactiveActivityModal, ValidateTargetTimeModal, etc.
    kpis/                         # AnalyticsModule, ExecutiveDashboard, AdvancedAnalytics,
                                   #   SmartBenchmark, OperationalRiskCard, InsightCards/Panel, etc.
    settings/                     # una sección (SectionCard) por bloque de configuración
    assistant/                    # AssistantModule (chat UI) + useNovaChat (hook de estado)
    ideas/                        # IdeasBoard, IdeaCard, NewIdeaFormModal, MyIdeasList
    meetings/                     # MeetingsModule, MeetingFormModalDashboard
    dashboard/                    # DashboardModule
    team/                         # TeamModule
    desk/                         # DeskBoard (Escritorio Digital: notas, recordatorios,
                                   #   calendario, búsqueda, Bandeja Hoy)
    ui/                           # Badge, Button, Card, Modal, TimeInput24 — primitivas compartidas
    ConsentGate.tsx, NotificationBell.tsx, ThemeProvider.tsx, ThemeToggle.tsx,
    UsersManager.tsx              # componentes de nivel superior sin carpeta propia
  lib/
    prisma.ts                     # singleton PrismaClient con adapter pg
    session.ts, session-secret.ts # JWT: encrypt/decrypt/createSession/getSession
    roles.ts                      # jerarquía de roles, visibilidad, permisos, liderazgo vs. ejecutor
    analytics.ts                  # motor central de Analytics (v1.5.0) — ver ANALYTICS_FORMULAS.md
    analyticsExplain.ts           # helpers de presentación puros (sin recalcular)
    insightsEngine.ts             # capa de decisión: insights, relaciones, benchmark personal, priorización
    workload.ts, capacityForecast.ts, priorityCompliance.ts, targetTime.ts,
    normalizationEngine.ts, riskAlerts.ts   # motores satélite single-purpose (ver mapa en
                                   #   ANALYTICS_CALCULATION_REGISTRY.md FASE 3)
    systemConfig.ts               # config vigente por fecha (SystemConfigHistory)
    businessTime.ts, dateRanges.ts, holidays.ts   # días hábiles, feriados, rangos de fecha
    activityFormat.ts, activityOverlap.ts, activityReasons.ts, commentViews.ts,
    timeFormat.ts, timeOverlap.ts # utilidades de registro de actividad
    leaves.ts, specialStatus.ts   # permisos/licencias y estado especial (maternidad/lactancia)
    ideas.ts, notificationRules.ts, retentionPolicy.ts   # ideas, reglas de notificación, LOPDP
    embeddings.ts, githubDocuments.ts   # generación de embeddings (Xenova) y KB vía repo privado de GitHub
    zoom.ts                       # integración Zoom para reuniones
    pdfPolyfill.ts                # polyfills necesarios para jsPDF en Node/Vercel
    rate-limit.ts, logger.ts, mask-email.ts, storage.ts, utils.ts, actions.ts,
    featureFlags.ts, navLinks.ts, confetti.ts   # utilidades generales/transversales
  proxy.ts                        # protección de rutas a nivel de request (reemplaza middleware.ts)
  generated/prisma/                # cliente Prisma generado — NO editar; importar tipos desde
                                    #   @/generated/prisma/client
  __tests__/                       # suite Vitest — api/, components/, y tests de lib/ en la raíz
prisma/
  schema.prisma                    # modelo de datos completo (ver §3)
  seed.ts                          # usuarios iniciales
  migrations/                      # historial de migraciones
.githooks/
  post-commit, update-changelog.js # ver §7
```

---

## 3. Modelo de datos

El esquema completo vive en `prisma/schema.prisma`. Agrupado por dominio:

### Auth / Usuarios
- **`User`** — entidad central; `role` (enum `Role`, 11 valores incluyendo `ADMINISTRADOR`
  y `ASISTENTE_NOMINA`), `viewPreferences` (String[], preferencias de vista de tareas),
  `theme`, `badges`, `dataConsentAccepted`/`dataConsentAcceptedAt` (LOPDP), y
  `kpiStartDate` — "ajuste puntual del Administrador: si está definida, los KPIs
  mensuales/semanales de este usuario se calculan desde esta fecha en vez del inicio
  real del período" (comentario del propio schema). Tiene más de 20 relaciones nombradas
  (una por cada rol que juega: autor, asignado, validador, ejecutor de purga, etc.).
- **`LoginAttempt`** — throttling de intentos de login por IP (`ip` único, `blockedUntil`).

### Tareas / Actividades
- **`Task`** — `status`/`priority`/`frequency`/`type` (enum `TaskType`: `FIJA` | `SEGUIMIENTO`).
  Campos de Tiempo Objetivo documentados extensamente en el schema: `estimatedHours` es
  el "Tiempo objetivo inicial... NUNCA se sobrescribe automáticamente con horas reales
  — solo la validación humana (targetTimeValidated) puede reemplazarlo como referencia
  oficial"; `targetTimeValidated`/`targetTimeValidatedAt`/`targetTimeValidatedById` son
  null hasta que "un líder autorizado (Administrador/Jefe Nacional/Coordinador Nacional,
  nunca el responsable de la tarea) lo valide explícitamente" — cada cambio queda en
  `TargetTimeAuditLog`.
- **`TaskActivity`** — registro de trabajo real sobre una tarea (`duration`, `reason`,
  `startTime`/`endTime` opcionales). `isRetroactive` marca "registro retroactivo (horas
  de días laborables anteriores)"; `modifiedByAdmin`/`adminComment` cubren edición
  administrativa (historial completo en `ActivityAuditLog`).
- **`ActivityAuditLog`** — auditoría de ediciones de horas por un Administrador.
  `activityId` es **intencionalmente una referencia suelta (sin FK)** "para que el
  registro de auditoría sobreviva aunque la actividad o la tarea que la contiene se
  elimine más adelante".
- **`ActivityComment`**, **`Comment`**, **`TaskCommentView`** — comentarios sobre
  actividades/tareas y su estado de lectura por usuario.
- **`ActivityReason`** — catálogo de motivos; `isArchived` "se retira del listado
  principal de gestión sin borrarse físicamente — el histórico de TaskActivity sigue
  resolviendo su label original", distinto de `isActive` (solo controla si es
  seleccionable para actividades nuevas).
- **`MonthClosure`** — cierre mensual de tareas (snapshot `summary`/`corrections` en JSON).

### Analytics / Auditoría
- **`AnalyticsAuditLog`** — "un registro por cálculo de un indicador versionado (Score
  de Salud, Índice de Riesgo Operativo) para poder explicar por qué un informe antiguo
  mostraba un valor distinto al de hoy... No se audita cada lectura cacheada, solo cada
  cálculo real." `kind` identifica el indicador, `engineVersion` permite reconstruir el
  contexto de versión.
- **`TargetTimeAuditLog`** — auditoría de validaciones del Tiempo Objetivo. Igual que
  `ActivityAuditLog`, `taskId` es **referencia suelta sin FK** por el mismo motivo de
  supervivencia del histórico; "nunca se elimina ni se sobrescribe un registro — cada
  validación agrega uno nuevo".
- **`Holiday`**, **`LeaveRecord`** — feriados (para cómputo de días hábiles) y
  permisos/licencias (`LeaveType`: MEDICO/PERSONAL/VACACIONES).
- **`SpecialStatus`** — estado especial (maternidad/lactancia): "mientras esté vigente
  para un día, la base/límites de KPI de ese usuario ese día son los configurados aquí
  (no las horas efectivas/límites configurados globalmente)". Separa `dailyHours` (base
  del denominador del %) de `limitBase`/`limitLow`/`limitHigh`/`limitOverload` (umbral
  real del semáforo) — "por defecto son iguales, pero no tienen que serlo". Configurable
  por registro desde 2026-07-18.

### Reuniones
- **`Meeting`** — con integración Zoom (`zoomMeetingId`/`zoomJoinUrl`/`zoomPassword`) y
  Otter.ai opcional (`otterInvited`/`otterSummary`/`otterTranscriptUrl`).
- **`MeetingInvitee`** — asistentes invitados, con `attended` para tracking de asistencia.

### Ideas / Mejora Continua
- **`ImprovementIdea`** — `impact` (ALTO/MEDIO/BAJO), `status` con 7 estados
  (PROPUESTA → ... → IMPLEMENTADA/RECHAZADA), `progress`, adjunto opcional
  (`attachmentUrl`/`attachmentData` como `@db.Text`).
- **`IdeaVote`** — un voto por usuario por idea (`@@unique([ideaId, userId])`).
- **`IdeaStatusHistory`** — historial de transiciones de estado con comentario.

### Cumplimiento / LOPDP
- **`DataSubjectRequest`** — solicitudes de acceso/rectificación/eliminación de datos
  personales, con `resolvedBy`/`resolvedAt`.
- **`DataPurgeLog`** — registro de ejecuciones de purga (conteos de reportes/tareas/docs
  eliminados), asociado al ejecutor.
- Política de retención vive en config (`systemConfig.ts`, `retentionPolicy.ts`), no en
  un modelo dedicado — ver §5 (Cumplimiento).

### Settings / SystemConfig
- **`SystemConfigHistory`** — el patrón central de configuración del sistema: cada fila
  es un valor de una `key` vigente entre `validFrom` y `validUntil` (null = vigente
  hasta hoy). Esto permite que cambios de configuración (horas efectivas, límites de
  carga laboral, política de retención, curvas de normalización, objetivos por cargo)
  no reescriban silenciosamente el pasado — un informe de un mes cerrado sigue
  reflejando la config vigente en ese momento. Consumido vía `getEffectiveConfigValue`/
  `getEffectiveAnalyticsConfig`/`getEffectiveCurve`/`getEffectiveRoleTarget` en
  `src/lib/systemConfig.ts`.
- **`Announcement`** — anuncios fijables en el dashboard con expiración.

### Escritorio Digital
- **`DeskNote`** — nota Post-it entre dos colaboradores (sin destinatarios
  múltiples ni hilos libres — `DeskNoteReply` permite un intercambio corto,
  máx. 2 respuestas, no un chat); `priority` (franja superior) y `color`
  (fondo del Post-it) son dimensiones independientes. `read`/`pinned`/
  `archived` los controla únicamente el destinatario — leer ya no requiere
  un botón, abrir la tarjeta marca `read`/`readAt` automáticamente (ver
  `docs/AUDIT_LOG.md` § 2026-07-23, refinamiento). `attachmentData` sigue
  el mismo patrón base64 que `ImprovementIdea.attachmentData`.
  `convertedToReminderId` es un puente opcional hacia `PersonalReminder`
  (`onDelete: SetNull`) — reemplazó al puente directo hacia `Task` del
  sprint anterior, que nunca llegó a usarse en producción. `deletedAt` es
  la bandera local del Centro de Recuperación (adaptador `DESK_NOTE`,
  exclusiva de la eliminación por el remitente) — el archivado tiene su
  propia retención de 15 días independiente (`archivedAt` +
  `purgeExpiredArchivedNotes()` en `src/lib/deskNoteRetention.ts`), y el
  destinatario puede eliminar definitivamente una nota ya archivada por una
  vía de borrado directo, sin pasar por esa papelera.
- **`DeskNoteReply`** — respuesta corta sobre una nota; el límite de 2 se
  valida en la API (`POST /api/desk-notes/[id]/replies`), no en el schema.
  Autor: remitente o destinatario, los únicos dos participantes.
- **`PersonalReminder`** — recordatorio personal independiente de
  Task/Project; reemplazó por completo a `FollowUpReminder` (ver
  `docs/AUDIT_LOG.md` § 2026-07-23, migración de datos verificada).
  `repeat` (una vez/diario/semanal/mensual) genera automáticamente la
  siguiente ocurrencia al completar (`advanceRepeat()` en
  `src/lib/deskReminders.ts`). `notified` evita notificar el mismo
  vencimiento más de una vez (barrido perezoso, sin cron dedicado).
  `status: COMPLETADO` **no es terminal** — "Reabrir" actualiza la misma
  fila (`id` estable) de vuelta a `PENDIENTE`, nunca crea un registro
  nuevo (ver `docs/AUDIT_LOG.md` § 2026-07-23, refinamiento de ciclo de
  vida). `archived`/`archivedAt` son una dimensión aparte de `status`
  (mismo criterio que `DeskNote.archived`). Desde el refinamiento de notas,
  también tiene `attachmentName`/`attachmentMime`/`attachmentData` (copiados
  desde la nota de origen al convertirse, no referenciados — sobreviven
  aunque la nota se purgue) y `convertedToTaskId`/`convertedToTaskAt`, el
  puente opcional hacia `Task` que reemplazó al que antes tenía `DeskNote`.
- **`DeskAuditLog`** — auditoría central de Escritorio Digital (notas y
  recordatorios en una sola tabla, `entityType`/`entityId` como referencia
  suelta) — mismo criterio que `RecoveryAuditLog`.

### Base de Conocimiento (Nova RAG)
- **`KnowledgeDocument`** — documentos subidos para RAG; `status` (PROCESANDO/LISTO/ERROR)
  y `processingError` reflejan el pipeline asíncrono de ingestión; `githubPath`/`githubSha`
  vinculan al repo privado de GitHub que sirve de almacenamiento (ver
  `src/lib/githubDocuments.ts`).
- **`DocumentChunk`** — fragmentos con `embedding` (Json, vector generado por
  `@xenova/transformers`), `pageNumber`/`chunkIndex` para citar la fuente exacta.

### Reportes
- **`MonthlyReport`** — informe mensual por `scope` (`JEFE` | `COORDINADOR`), único por
  `(month, year, scope)`; `data` (Json) es el snapshot calculado, `aiAnalysis` el texto
  narrado por Nova sobre ese snapshot.

---

## 4. Autenticación y autorización

**Flujo de sesión** (`src/lib/session.ts`):
1. Login exitoso → `createSession({ userId, role, name, email })` firma un JWT HS256 con
   `jose` (payload incluye `expiresAt` explícito además del `exp` del propio JWT) y lo
   guarda en la cookie `nexo-session` (httpOnly, `secure` en producción, `sameSite: strict`,
   7 días por defecto o 30 con "recordarme").
2. Cada request protegida: `getSession()` lee la cookie del store de Next (`cookies()`)
   y verifica/decodifica con `decrypt()`. Server Components y API routes usan esta misma
   función — no hay una capa de sesión distinta para cada uno.
3. **`src/proxy.ts`** (equivalente a `middleware.ts` en este fork de Next 16) corre en el
   edge/runtime de request antes de llegar a cualquier handler: redirige a `/login` si
   no hay cookie válida en rutas protegidas, redirige a `/dashboard` si hay sesión válida
   y se visita una ruta pública (`/login`, `/api/auth/login`, `/api/auth/forgot-password`),
   fuerza HTTPS en producción, y valida el header `Origin` en mutaciones (`hasValidOrigin`)
   como defensa adicional a CSRF complementaria a `sameSite: strict` (no sustituta).
4. `src/app/(protected)/layout.tsx` hace una segunda verificación a nivel de Server
   Component (`getSession()` + `redirect("/login")`) — defensa en profundidad además del
   proxy — y además envuelve el árbol en `ConsentGate` (bloquea la UI si
   `dataConsentAccepted` es falso) y `AppShell` (chrome de navegación).

**Jerarquía y visibilidad** (`src/lib/roles.ts`):
- `ROLE_LEVEL` — 11 roles en 5 niveles (0 usado implícitamente no existe; niveles reales
  1-5): `ADMINISTRADOR` (5), `JEFE_NACIONAL` (4), `COORDINADOR_NACIONAL` (3),
  `COORDINADOR_ZS`/`ANALISTA_CC`/`ANALISTA_SELECCION` (2), el resto incluido
  `ASISTENTE_NOMINA` (1). Nota: esto amplía la tabla de `CLAUDE.md`, que no incluye
  `ADMINISTRADOR` ni `ASISTENTE_NOMINA` — verificar siempre contra `roles.ts`, no contra
  la guía de onboarding, si hay discrepancia.
- `VISIBLE_ROLES` — de qué roles puede ver las tareas cada rol (no es simplemente "todo
  nivel inferior": p.ej. `ANALISTA_SELECCION` ve `ASISTENTE_SELECCION` + `ASISTENTE_GH`
  + `TRABAJO_SOCIAL`, una combinación explícita, no derivada de una regla general).
- `NOTIFICATION_TARGETS` — notificaciones siempre hacia arriba, nunca hacia abajo.
- Permisos por función: `canManageUsers` (ADMINISTRADOR/JEFE_NACIONAL/COORDINADOR_NACIONAL),
  `canCreateMeetings` (+ COORDINADOR_ZS), `canViewTeam` (nivel >= 2), `canAccessReports`,
  `canReviewIdeas`, `canManageKnowledgeBase` (solo ADMINISTRADOR), `canViewKnowledgeBase`,
  `canViewOperationalRisk` — este último **deliberadamente distinto** de `canViewTeam`:
  excluye `ANALISTA_CC`/`ANALISTA_SELECCION` (nivel 2 pero sin este componente según
  el pedido de negocio) e incluye explícitamente `COORDINADOR_ZS`.
- **`isLeadershipRole` / `isExecutorRole`** (Sprint 0A, adición reciente) — distinción
  ortogonal a la visibilidad: decide qué módulos de Analytics son representativos para
  un rol, no quién puede ver a quién. El comentario en `roles.ts` documenta el porqué:
  "el motor de Analytics históricamente trataba a TODO usuario como ejecutor de tareas
  operativas, incluyendo a quienes dirigen equipos... mostrándoles horas comprometidas,
  capacidad futura, tiempo objetivo y recomendaciones de asignación individuales que no
  son representativas de su responsabilidad real". La clasificación depende únicamente
  de `ROLE_LEVEL >= 4` (JEFE_NACIONAL, ADMINISTRADOR) — deliberadamente **no** crea
  categorías nuevas ("Operativo/Táctico/Estratégico") y **no** toca `VISIBLE_ROLES` ni
  `getSubordinateRoles`. `COORDINADOR_NACIONAL` (nivel 3) conserva KPIs personales junto
  con los del equipo; solo nivel 4+ queda sin indicadores individuales de ejecución.

---

## 5. Módulos funcionales

### Trabajo (Tasks)
- **Rutas**: `src/app/(protected)/tasks/`, `src/app/(protected)/tiempo-objetivo/`.
- **API**: `src/app/api/tasks/*` (CRUD, `close-month`, `import`, `template`, `target-time`),
  `src/app/api/activities/*` (registro + `day-schedule`), `src/app/api/activity-reasons/*`.
- **Componentes**: `TasksModule.tsx` orquesta tres vistas intercambiables —
  `KanbanView.tsx`, `TableView.tsx`, `GanttView.tsx` — más `RepositoryView.tsx` (archivo
  histórico), `TaskFormModal.tsx`, `ActivityPanel.tsx`/`ActivityItem.tsx` (registro de
  horas), `RetroactiveActivityModal.tsx` (registro retroactivo), `CloseMonthModal.tsx`,
  `CorrectArchivedTaskModal.tsx`, `ValidateTargetTimeModal.tsx` y
  `RegularizeTargetTimeManager.tsx` (validación/regularización del Tiempo Objetivo).
- Tareas `FIJA` y `SEGUIMIENTO` (enum `TaskType`) comparten el mismo modelo de registro
  basado en `TaskActivity` — ver decisión estructural en §8.
- El **Tiempo Objetivo** (`estimatedHours` inicial + `targetTimeValidated` opcional) es
  un concepto propio de este módulo que alimenta al motor de Capacidad — ver
  `src/lib/targetTime.ts`/`targetTimeServer.ts` y §8.

### Analytics / KPIs
- **Rutas**: `kpis/` (equipo/ejecutivo), `my-kpis/` (personal).
- **API**: todo `src/app/api/analytics/*` y `src/app/api/kpis/*`.
- **Componentes**: `src/components/kpis/*` (AnalyticsModule, ExecutiveDashboard,
  AdvancedAnalytics, SmartBenchmark, OperationalRiskCard, InsightCards/InsightsPanel,
  KpiCharts, MonthlyReports, TeamWorkloadCards, WorkloadCard, TargetTimePrecisionCard).
- El motor determinista vive en `src/lib/analytics.ts` (+ motores satélite
  `workload.ts`/`capacityForecast.ts`/`priorityCompliance.ts`/`targetTime.ts`/
  `normalizationEngine.ts`/`riskAlerts.ts` y la capa de decisión `insightsEngine.ts`).
  **Las fórmulas de negocio, versión del motor, y el mapa completo de dependencias entre
  estos módulos están documentados en `docs/ANALYTICS_FORMULAS.md` y
  `docs/ANALYTICS_CALCULATION_REGISTRY.md` (sección "FASE 3 — Mapa del motor") — no se
  duplican aquí.** Nova nunca calcula un KPI: solo narra el JSON que el motor ya produjo
  (`nova-insights`, ver §5 Nova).

### Dashboard
- **Ruta**: `dashboard/` (home post-login). **API**: `src/app/api/dashboard/*`
  (`card-order` para orden personalizable de tarjetas, `nova-message` para el saludo/
  resumen generado por IA). **Componente**: `DashboardModule.tsx`.

### Equipo (Team)
- **Ruta**: `team/` (oculta a nivel 1, `canViewTeam`). **API**: `src/app/api/team/*`
  y `src/app/api/team/[userId]`. **Componente**: `TeamModule.tsx`.

### Reuniones (Meetings)
- **Ruta**: `meetings/`, creación restringida a `canCreateMeetings` (nivel 2+ con
  COORDINADOR_ZS incluido). **API**: `src/app/api/meetings/*`. **Componentes**:
  `MeetingsModule.tsx`, `MeetingFormModalDashboard.tsx`. Integra Zoom
  (`src/lib/zoom.ts`) para generar la reunión real y opcionalmente Otter.ai para
  transcripción/resumen (campos en el modelo `Meeting`).

### Mejora Continua (Ideas)
- **Ruta**: `mejora-continua/`. **API**: `src/app/api/ideas/*`. **Componentes**:
  `IdeasBoard.tsx` (tablero por estado), `IdeaCard.tsx`, `IdeaDetailModal.tsx`,
  `NewIdeaFormModal.tsx`, `MyIdeasList.tsx`. Revisión de estado restringida a
  `canReviewIdeas`. Votos únicos por usuario/idea (`IdeaVote`), historial de estado en
  `IdeaStatusHistory`.

### Nova (Asistente IA)
- **Ruta**: `assistant/`. **API**: `src/app/api/assistant/chat` (conversación) y
  `src/app/api/assistant/documents` (gestión de la base de conocimiento, solo
  `canManageKnowledgeBase` = ADMINISTRADOR para subir/eliminar). **Componentes**:
  `AssistantModule.tsx` + hook `useNovaChat.ts`. `NovaFab.tsx` (en `shell/`) expone a
  Nova como acceso flotante global.
- Backend Groq (`groq-sdk`) con distintos `Mode` (`general`/`tasks`/`hr`, ver
  `src/app/api/assistant/chat/route.ts`), prompt adaptado al rol del usuario
  (`ROLE_LABEL[userRole]`).
- **RAG**: documentos subidos se trocean (`DocumentChunk`), se embeben localmente con
  `@xenova/transformers` (`src/lib/embeddings.ts`, sin costo de API externa) y se
  recuperan por similitud coseno en tiempo de consulta. Los documentos en sí se
  almacenan en un repositorio privado de GitHub (`src/lib/githubDocuments.ts`,
  `githubPath`/`githubSha` en `KnowledgeDocument`), no en la base de datos ni en disco
  local — decisión operacional para no acoplar el almacenamiento de archivos al deploy.
  Prioridad de fuentes explícita en el prompt: primero los documentos de la KB (citando
  "(Fuente: Nombre del documento, pág. N)"), luego buenas prácticas generales.
- `nova-insights` (bajo `api/kpis/`) es un caso especial: solo redacta texto sobre un
  JSON de Analytics ya calculado (con caché de 4h) — nunca invoca lógica de negocio
  propia, garantía verificada y documentada en `ANALYTICS_CALCULATION_REGISTRY.md`.

### Ajustes / Settings — Centro de Configuración NEXO (Sprint O, 2026-07-28)
- **Ruta**: `settings/` — Administrador-only de forma consistente (route gate, gate
  interno del componente y link de navegación coinciden; antes `page.tsx` también
  dejaba pasar a Coordinador Nacional pero el contenido quedaba oculto igual, ver
  `docs/AUDIT_LOG.md` § 2026-07-28).
- **Shell**: `ConfigCenter.tsx` (reemplaza al extinto `SettingsManager.tsx`) organiza
  las secciones por categoría (Organización/Analytics/Trabajo/Proyectos/Escritorio
  Digital/Reportes/NOVA/Seguridad/Notificaciones/Parámetros Globales/Sistema) vía un
  registro de metadatos puro (`src/components/settings/registry.ts` — id/label/
  keywords/categoría/configKeys/defaults, SIN referencias a componentes, esas se
  colocan directamente en el JSX de `ConfigCenter.tsx`). Capas transversales sobre
  ese registro: búsqueda global (`SearchBox.tsx`/`searchSettings()`), favoritos
  (`FavoritesSection.tsx`, reutiliza `User.viewPreferences` con prefijo
  `CONFIG_FAVORITE:`, mismo patrón que el orden de tarjetas del Dashboard), historial
  navegable (`history/SettingHistoryModal.tsx`, lee `SystemConfigHistory`
  directamente) y restaurar-a-predeterminado (`history/RestoreDefaultButton.tsx`).
  `ConfigSectionCard.tsx` envuelve cada sección existente con esa cromática sin tocar
  su interior (cada sección sigue renderizando su propio `SectionCard.tsx`).
- **API**: 23 endpoints bajo `src/app/api/settings/*` — los 14 preexistentes
  (activity-reasons, analytics-config, holidays, kpi-start-date, leave-records,
  login-attempts, normalization-curves, notification-rules, retention-policy,
  role-targets, system-info, welcome-message, workload-config, documentation) más 9
  nuevos del Sprint O: `config-history` (+`restore-default`), `favorites`,
  `retroactive-window`, `snooze-presets` (alcanzables por cualquier usuario
  autenticado, no solo Administrador — los consumen componentes cliente fuera de
  `/settings`), `trabajo-avanzado`, `escritorio-digital-config`, `nova-cache`,
  `seguridad-config`.
- **Componentes**: `src/components/settings/*` — las secciones preexistentes sin
  cambios internos (`ActivityReasonsSection`, `AnalyticsConfigSection`,
  `EngineDiagnosticsSection`, `HolidaysSection`, `KpiStartDateSection`,
  `LeaveRecordsSection`, `NormalizationCurvesSection`, `NotificationRulesSection`,
  `RoleTargetsSection`, `RoleCompatibilitySection`, `SpecialStatusSection`,
  `WelcomeMessageSection`, `DataQualitySection`, `DocumentationSection`) más las 6
  extraídas 1:1 desde el extinto `SettingsManager.tsx` (`DataConsentSection`,
  `PasswordManagementSection`, `SystemInfoSection`, `WorkloadConfigSection`,
  `DataRequestsSection`, `RetentionPolicySection`, `KnowledgeBaseSection`) y 4
  nuevas agrupadas por categoría (`TrabajoAvanzadoSection`,
  `EscritorioDigitalConfigSection`, `NovaCacheSection`, `SeguridadConfigSection`).
- **9 valores nuevos configurables** (mismo patrón `CONFIG_KEY_*`/`getEffective*`/
  `set*` de `systemConfig.ts`, default = comportamiento anterior exacto): ventana de
  registro retroactivo, hora de corte de jornada de Capacidad Proyectada, retención
  de archivado/tope de respuestas/presets de posposición de Escritorio Digital, TTL
  de caché de NOVA, longitud mínima de contraseña, duración de sesión (default/
  recordarme), retención de intentos de login.
- **Deliberadamente fuera de alcance** (ver `docs/ROADMAP.md`): SLA/riesgo de
  Proyectos, plantillas/programación de Reportes, permisos especiales de Seguridad,
  enums de Trabajo (prioridad/estado/tipo/días laborables) como listas editables,
  idioma/moneda en Parámetros Globales — cada uno con tarjeta "Próximamente" en la UI.
- Todo cambio de configuración se persiste en `SystemConfigHistory` (§3), nunca
  sobrescribe el valor anterior — permite reconstruir "qué configuración estaba vigente"
  para cualquier fecha pasada, y desde este sprint también se puede consultar ese
  historial y restaurar el valor por defecto directamente desde la UI.

### Cumplimiento / LOPDP
- **API**: `src/app/api/data-requests/*` (solicitudes de acceso/rectificación/
  eliminación, `my-data` para autoservicio), `src/app/api/users/reset-consent-all`,
  `src/app/api/auth/consent`.
- **Lógica**: `src/lib/retentionPolicy.ts` (política de retención por tipo de dato —
  informes mensuales, tareas archivadas, documentos de KB — con opción "indefinite"
  para KB), consumida por un flujo de purga que registra cada ejecución en
  `DataPurgeLog`. Consentimiento de datos (`dataConsentAccepted`) forzado por
  `ConsentGate.tsx` en el layout protegido antes de renderizar cualquier módulo.

---

## 6. Flujo de una request típica

Ejemplo: un usuario visita `/kpis`.

1. **`src/proxy.ts`** intercepta la request (matcher excluye `_next/static`, `_next/image`,
   `favicon.ico`). Verifica la cookie `nexo-session` con `jwtVerify` — si falta o es
   inválida, redirige a `/login`. Esta es una verificación *ligera* (solo valida la
   firma del JWT), no consulta la base de datos.
2. Si el JWT es válido, Next.js resuelve el árbol de layouts: primero
   `src/app/(protected)/layout.tsx` (**Server Component**) — vuelve a llamar a
   `getSession()` (defensa en profundidad, redirige a `/login` si por algún motivo no
   hay sesión) y **sí** consulta Prisma (`prisma.user.findUnique` para
   `dataConsentAccepted`). Envuelve el contenido en `ConsentGate` + `AppShell`.
3. Luego se resuelve `src/app/(protected)/kpis/page.tsx` — otro Server Component: repite
   `getSession()`, aplica la regla de autorización específica del módulo
   (`canViewTeam(session.role)`, redirige a `/dashboard` si no cumple), y renderiza
   `<AnalyticsModule currentUserId={...} currentUserRole={...} currentUserName={...} />`
   pasándole solo los datos de sesión — **no** precarga datos de Analytics en el
   servidor en este caso; `AnalyticsModule` es un **Client Component**
   (`"use client"`) que dispara sus propios `fetch()` a las rutas de API.
4. `AnalyticsModule.tsx` (y sus hijos: `AdvancedAnalytics`, `SmartBenchmark`,
   `OperationalRiskCard`, etc.) hacen `fetch("/api/analytics/...")` /
   `fetch("/api/kpis/...")` desde el navegador.
5. La API route (ej. `src/app/api/kpis/me/route.ts`) es un **Route Handler**: vuelve a
   llamar `getSession()` (tercera verificación de la misma request lógica — cada capa
   es independiente y no confía en la anterior), valida parámetros (`month` en query
   string), consulta Prisma (`prisma.task.findMany` con `include: { activities: ... }`),
   invoca los motores puros de `src/lib/*` (`computeCargaTiempo`, `computeRiskAlerts`,
   `computePriorityCompliance`, etc. — todos funciones síncronas/puras sobre los datos
   ya traídos de la BD) y devuelve `NextResponse.json(...)`.
6. El cliente recibe el JSON, actualiza estado de React, y el componente re-renderiza
   con los KPIs calculados.

Puntos específicos de este fork de Next 16 a tener en cuenta: el archivo de protección
de rutas se llama `proxy.ts` (no `middleware.ts`), y las convenciones de Server/Client
Components de App Router siguen aplicando pero **deben verificarse** contra
`node_modules/next/dist/docs/` si hay dudas, por las advertencias de `AGENTS.md` sobre
cambios disruptivos respecto al Next.js conocido.

---

## 7. Convenciones técnicas

- **TypeScript estricto** (`"strict": true` en `tsconfig.json`). Preferir `type` sobre
  `interface` para formas de objetos. Co-locar tipos con el módulo propietario; extraer
  a `types/` compartido solo si se usa en 3+ archivos.
- **Prisma 7 requiere driver adapter**: `new PrismaClient()` sin argumentos lanza en
  runtime. El patrón correcto (`src/lib/prisma.ts`):
  ```ts
  import { PrismaPg } from "@prisma/adapter-pg";
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter });
  ```
  El singleton se cachea en `globalThis` fuera de producción para sobrevivir al hot
  reload de `next dev`.
- **Import de tipos generados**: siempre desde `@/generated/prisma/client`, nunca
  `@/generated/prisma` (el directorio generado por el `generator client` de
  `schema.prisma`, que no se edita a mano).
- **Testing**: Vitest 4 + `@testing-library/react` + `jsdom` (`vitest.config.ts`).
  Alias `server-only` se redirige a un stub (`vitest.server-only-stub.ts`) porque
  varios módulos de `src/lib` importan `"server-only"` para prohibir su uso en Client
  Components. Suite en `src/__tests__/` — `api/` para route handlers,
  `components/` para componentes de UI, y tests de `lib/` sueltos en la raíz de
  `__tests__/`. El mock global de Prisma lanza si un test no lo mockea explícitamente
  (evita tests que golpeen accidentalmente la BD real — ver nota operacional en §8).
- **Hook post-commit** (`.githooks/post-commit` + `.githooks/update-changelog.js`,
  instalado por `scripts/setup-git-hooks.js` en `postinstall`): tras cada commit, inserta
  automáticamente una línea `- YYYY-MM-DD: <asunto>` al inicio de la sección
  `## Changelog` de `README.md` y hace `git commit --amend --no-edit` para incluirla en
  el mismo commit. Se dispara desde `post-commit` (no `prepare-commit-msg`) porque,
  según el comentario del propio script, un `git add` hecho en `prepare-commit-msg` no
  queda incluido en el commit que se está creando — comprobado empíricamente — mientras
  que enmendar desde `post-commit` sí funciona. El amend vuelve a disparar
  `post-commit`, así que la función es **idempotente** (si la entrada ya está presente,
  no hace nada) para no entrar en loop. Tipos de commit `chore`/`docs` se omiten del
  changelog por convención (`SKIPPED_TYPES`). No toca commits en medio de un
  rebase/cherry-pick.

---

## 8. Decisiones estructurales notables

- **FIJA y SEGUIMIENTO comparten el mismo modelo de registro basado en `TaskActivity`**
  (cambio reciente): antes existía una distinción de tratamiento entre ambos tipos de
  tarea; unificar el registro sobre `TaskActivity` simplifica el motor de Analytics (una
  sola fuente de horas reales por tarea, independiente de su tipo) y evita que el
  Workload Engine o el motor de Capacidad necesiten ramas de lógica distintas por
  `TaskType`. `type` en `Task` sigue existiendo para filtrar/presentar, no para cambiar
  el modelo de datos de la actividad.

- **Tiempo Objetivo: `estimatedHours` inicial + `targetTimeValidated` opcional** — el
  diseño separa deliberadamente "lo que se estimó al crear la tarea" de "lo que un líder
  autorizado confirmó como referencia oficial tras revisar el trabajo real", en vez de
  sobrescribir un único campo. Esto permite: (a) que el valor inicial nunca se pierda
  aunque cambie el consenso posterior, (b) que la validación quede como un evento
  auditado y explícito (`TargetTimeAuditLog`, con `TargetTimeAdjustReason` obligando a
  categorizar el motivo del ajuste) en vez de un edit silencioso, y (c) que ni el propio
  responsable de la tarea pueda auto-validar su tiempo objetivo (regla de negocio
  aplicada en la capa de API, reforzada por el comentario del schema). Mientras
  `targetTimeValidated` sea `null`, toda lectura del sistema (Capacity Engine, KPIs,
  reportes) usa `estimatedHours` como referencia — nunca `realHours`.

- **No existe una base de datos de desarrollo separada** — la cadena `DATABASE_URL` en
  el `.env` local apunta a la misma base PostgreSQL que producción, con datos reales de
  personal. Esto es una decisión/estado operacional heredado, no un accidente, pero
  tiene implicancias directas para cualquier trabajo de desarrollo o testing manual:
  cualquier prueba de autenticación, seed, o script exploratorio contra la BD debe
  usar cuentas desechables (convención observada: `*@verify.local`) en vez de usuarios
  reales, y cualquier operación destructiva (purga, migración, seed que resetee datos)
  debe tratarse con la misma cautela que en producción porque *es* producción. El mock
  global de Prisma en la suite de Vitest (§7) es, entre otras cosas, una salvaguarda
  para que la suite de tests no golpee esta base accidentalmente.

- **Referencias sueltas (sin FK) en las tablas de auditoría** (`ActivityAuditLog.activityId`,
  `TargetTimeAuditLog.taskId`) — patrón repetido intencional: una tabla de auditoría
  debe sobrevivir a la eliminación de la entidad auditada (tarea, actividad) para que el
  historial siga siendo consultable/explicable después de un borrado, purga LOPDP, o
  cierre de mes con corrección. El costo es que estas tablas no garantizan
  referencial integrity a nivel de BD sobre esos campos — es una decisión consciente
  documentada en el propio schema, no un descuido.

- **`isLeadershipRole`/`isExecutorRole` como eje ortogonal a `VISIBLE_ROLES`** (Sprint
  0A) — en vez de introducir una taxonomía nueva de roles o modificar la jerarquía de
  visibilidad existente, la distinción "dirige equipos vs. ejecuta tareas" se deriva
  puramente de `ROLE_LEVEL` (umbral en nivel 4) y solo afecta qué se calcula/muestra en
  Analytics, dejando permisos y visibilidad intactos. Mantiene una única fuente de
  verdad para el nivel jerárquico en vez de duplicar la información en una segunda
  estructura de roles.

- **KB de Nova almacenada en GitHub, no en la BD ni en disco del servidor** — evita
  acoplar archivos binarios/grandes al deploy (relevante en Vercel, donde el sistema de
  archivos es efímero) y aprovecha un repo privado ya existente como almacenamiento
  versionado; `KnowledgeDocument` solo guarda metadatos + referencia (`githubPath`/
  `githubSha`), y los embeddings/chunks (que sí son pequeños) se persisten en Postgres
  (`DocumentChunk`) para búsqueda por similitud sin ida y vuelta a GitHub en cada
  consulta del chat.

---

_Última actualización: 2026-07-22._
