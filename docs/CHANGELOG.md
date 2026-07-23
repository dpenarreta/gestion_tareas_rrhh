# Changelog de Nexo

> Registro cronológico de todos los cambios del proyecto. Ordenado del más
> reciente al más antiguo. Los tipos permitidos son: `FEATURE`, `FIX`,
> `REFACTOR`, `UX`, `UI`, `ANALYTICS`, `SECURITY`, `PERFORMANCE`, `DATABASE`,
> `DOCUMENTATION`, `BREAKING CHANGE`.
>
> Las entradas desde **v1.4.0** en adelante se registran en tiempo real,
> commit a commit relevante, a medida que se implementan. Las entradas
> **anteriores a v1.4.0** fueron reconstruidas retroactivamente el
> 2026-07-22 a partir del historial de Git (154 commits desde el nacimiento
> del proyecto) y de la memoria de sesiones previas — agrupadas por
> versión/sprint en vez de commit por commit, para que el documento sea
> legible. Ver `git log --oneline` para el detalle línea por línea de
> cualquier período.
>
> Existe además un changelog automático más simple (una línea por commit no
> trivial) en la sección "## Changelog" de `README.md`, mantenido por
> `.githooks/post-commit`. Ese mecanismo NO se reemplaza por este documento
> — siguen ambos: el de `README.md` es el registro mecánico línea-por-commit,
> este es el registro narrativo y clasificado, pensado para lectura humana y
> auditoría.

---

## v1.5.0 — 2026-07-23

**Tipo:** FEATURE / DATABASE
**Módulo:** Proyectos (nuevo)

**Implementado:**
- Nuevo módulo "Proyectos", dominio completamente independiente del módulo
  Trabajo (Task/TaskActivity) — iniciativas transversales de mediana/larga
  duración con fases, participantes propios y ciclo de vida que no se cierra
  por cambio de mes.
- Modelos Prisma nuevos: `Project`, `ProjectParticipant`, `ProjectPhase`,
  `ProjectActivity`, `ProjectComment`, `ProjectDocument`, `ProjectHistory`
  (enums `ProjectStatus`, `ProjectDocumentCategory`, `ProjectHistoryEvent`) —
  reutiliza `TaskStatus`/`TaskPriority` para fases/prioridad en vez de
  duplicar enums.
- Ciclo de vida: Pendiente → Planificación → En ejecución → En revisión →
  Suspendido → Completado/Cancelado, editable solo por el responsable
  principal, el creador o liderazgo (nivel ≥ 3) — ver
  `src/lib/projectAccess.ts`.
- Fases con responsable, progreso, tiempo objetivo y estado propios.
- Registro de actividades por participante (descripción, fecha, hora,
  tiempo invertido, comentarios) con la misma ventana de registro
  retroactivo de 2 días hábiles que Seguimiento — reutiliza
  `src/lib/businessTime.ts` sin modificarlo.
- Comentarios y repositorio de documentos (PDF/Excel/Word/Imagen/Correo/
  Acta, versionado simple) propios del proyecto, sin tocar los del módulo
  Trabajo.
- Bitácora de auditoría (`ProjectHistory`) para todo evento relevante:
  creación, cambio de estado/responsable, alta/baja de participante, fase,
  comentario, actividad, documento.
- `Project.realHours`/`targetTimeHours` preparados con la misma convención
  que `Task` para una futura integración con el Analytics Engine — **no se
  modificó ninguna fórmula ni cálculo existente** (§13 del pedido).
- Nueva entrada "Proyectos" en el menú lateral (`src/lib/navLinks.ts`).

**Archivos afectados:** `prisma/schema.prisma`,
`prisma/migrations/20260723024646_add_projects_module/`,
`src/lib/projectAccess.ts`, `src/lib/projectHistory.ts`, `src/lib/roles.ts`
(`canCreateProject`), `src/lib/mask-email.ts` (`maskEmailUnless`),
`src/lib/navLinks.ts`, `src/app/api/projects/**`,
`src/app/(protected)/projects/**`, `src/components/projects/**`.

**Impacto:** Nuevo dominio funcional, sin cambios en APIs, esquema o
comportamiento del módulo Trabajo ni del motor de Analytics. Verificado de
punta a punta (crear proyecto, fases, participantes, comentarios, actividad
normal y retroactiva, documentos, historial, límites de permisos) contra la
base de datos compartida con usuarios `@verify.local` desechables,
eliminados al finalizar la prueba.

**Autor:** Claude Code
**Estado:** Implementado

---

## v1.4.0 — 2026-07-22

**Tipo:** DOCUMENTATION
**Módulo:** Documentación / Administración

**Implementado:**
- Estructura oficial `/docs` (README, CHANGELOG, AUDIT_LOG, ROADMAP,
  ARCHITECTURE, DECISIONS, ANALYTICS_FORMULAS, VERSION).
- Reconstrucción retroactiva del historial completo de Nexo desde Git.
- Panel de solo lectura "Documentación" dentro de Administración, que lee
  los `.md` directamente (sin base de datos nueva).
- Mecanismo de actualización de documentación como parte del flujo de
  trabajo habitual de Claude Code (ver `CLAUDE.md`).

**Archivos afectados:** `docs/*.md` (nuevos), `package.json` (versión),
`src/app/(protected)/settings/*`, componente de visor de documentación,
`CLAUDE.md`.

**Impacto:** Trazabilidad completa del proyecto para auditorías internas y
continuidad del desarrollo. No modifica ninguna funcionalidad de negocio,
API, Prisma ni Analytics.

**Autor:** Claude Code
**Estado:** Implementado

---

## v1.3.0 — 2026-07-21

**Tipo:** FEATURE / REFACTOR
**Módulo:** Trabajo (Tareas)

**Implementado:**
- Las tareas Fijas ahora usan el mismo componente de registro
  (`ActivityPanel`/`TaskActivity`) que Seguimiento, en vez de un campo
  `realHours` editado a mano sin historial.
- Máximo 2 registros por tarea Fija (uno para el valor original/migrado,
  uno para correcciones), reforzado en servidor y en UI.
- Migración perezosa e idempotente del historial existente (sin script
  masivo contra la base de datos): la primera vez que se abre el panel de
  actividades de una tarea Fija con horas reales y cero actividades, se
  genera automáticamente un registro "Registro migrado automáticamente".
- Corrección del último texto residual que aún decía "estimación" en vez de
  "Tiempo Objetivo" (`insightsEngine.ts`).

**Archivos afectados:** `src/app/api/tasks/[id]/activities/route.ts`,
`src/components/tasks/{ActivityPanel,TableView,TaskCard}.tsx`,
`src/components/team/TeamModule.tsx`, `src/lib/insightsEngine.ts`.

**Impacto:** Analytics consume un único modelo de datos para ambos tipos de
tarea; las tareas Fijas ganan auditoría/historial que nunca tuvieron. Sin
cambios en Prisma Schema, APIs públicas, Operational Risk Score ni
Performance Score (decisión explícita de alcance).

**Autor:** Claude Code
**Estado:** Implementado

---

## v1.2.0 — 2026-07-21

**Tipo:** ANALYTICS / REFACTOR / FEATURE
**Módulo:** Analytics / Trabajo / Dashboard

**Implementado:**
- Evolución de "Horas estimadas" a "Tiempo Objetivo" en todo el sistema:
  el valor inicial (`Task.estimatedHours`) coexiste con un valor validado
  opcional (`Task.targetTimeValidated`), con auditoría propia
  (`TargetTimeAuditLog`) y regularización asistida (`/tiempo-objetivo`).
- Registro de auditoría del Analytics Engine
  (`docs/ANALYTICS_CALCULATION_REGISTRY.md`): inventario completo de
  cálculos, 10 duplicaciones detectadas y 8 resueltas (consolidación de
  "Cumplimiento", clasificación de Performance Score, aritmética de
  ponderación, días hábiles con feriados, heurísticas de confianza/madurez).
- Invalidación granular del caché de Analytics por usuario (antes era
  global).
- **Sprint 0A — modelo de Analytics diferenciado para roles de dirección:**
  Administrador y Jefe Nacional dejan de evaluarse como ejecutores de
  tareas — sin KPIs personales de ejecución, sin aparecer como destino de
  redistribución de carga, Dashboard Home y mensaje diario de Nova sin
  carga laboral individual, pestaña "Mi actividad" inexistente para esos
  roles (no solo oculta su contenido).

**Archivos afectados:** `src/lib/{analytics,roles,targetTime,riskAlerts,
analyticsExplain}.ts`, `src/components/kpis/*`, `src/components/dashboard/
DashboardModule.tsx`, `src/app/api/{kpis,analytics,dashboard,reports}/**`,
`docs/ANALYTICS_CALCULATION_REGISTRY.md` (nuevo).

**Impacto:** Terminología de negocio consistente ("Tiempo Objetivo" en vez
de estimación subjetiva); motor de Analytics con menos duplicación y caché
más preciso; los indicadores de dirección dejan de distorsionar promedios y
recomendaciones del equipo.

**Autor:** Claude Code
**Estado:** Implementado

---

## v1.1.0 — 2026-07-20

**Tipo:** ANALYTICS / FEATURE
**Módulo:** Analytics

**Implementado:**
- **Sprint 5:** Performance Score separado del Índice de Riesgo Operativo
  (antes mezclados en un solo "Score"); NormalizationEngine (curvas
  configurables por indicador); motor v1.3.
- **Sprint 6 — Decision Intelligence Engine:** motor de insights de
  4 bloques (hallazgo/explicación/evidencia/impacto), relaciones entre
  indicadores, benchmarks personales, reevaluación de recomendaciones
  anteriores, priorización — todo determinista, Groq/IA nunca calcula.
- **Sprint 7 — Motor de Benchmarks Inteligente v1.5:** 3 niveles de
  comparación (cargo / cargo-limitado / personal) para no mostrar "sin
  compañeros del mismo rol" cuando un cargo es único en la organización.
- **Sprint 6.5:** explicabilidad, transparencia y confianza — modal
  "Ver cálculo" con desglose completo, estrellas de madurez del dato.

**Archivos afectados:** `src/lib/{analytics,insightsEngine,
capacityForecast}.ts`, `src/components/kpis/{SmartBenchmark,
InsightsPanel,AdvancedAnalytics}.tsx`, `prisma/schema.prisma`
(`AnalyticsAuditLog`).

**Impacto:** Analytics pasa de "tarjetas con números" a un sistema de apoyo
a la decisión que explica el por qué, no solo el qué — con respaldo
matemático auditable, sin depender de IA para ningún cálculo de negocio.

**Autor:** Claude Code
**Estado:** Implementado

---

## v1.0.0 — 2026-07-19/20

**Tipo:** ANALYTICS / BREAKING CHANGE
**Módulo:** Analytics

**Implementado:**
- **Analytics Engine v1** (`src/lib/analytics.ts`, `ANALYTICS_ENGINE_VERSION`
  desde entonces): Score de Salud, Índice de Riesgo Operativo, alertas,
  tendencias, consistencia, anomalías, predicción, calidad de datos —
  centralizados en un único motor con auditoría (`AnalyticsAuditLog`) y
  configuración versionada (21 claves en Ajustes).
- People Analytics v2: balance de carga del equipo, capacidad disponible,
  cumplimiento por prioridad.
- Capacidad proyectada hacia adelante con simulador de asignación
  (`capacityForecast.ts`).
- Dashboard ejecutivo ampliado (antes solo Jefe Nacional; ahora también
  Administrador y Coordinador Nacional), Nova Insights con IA (Groq),
  panel de alertas de riesgo real.

**Impacto:** Salto de arquitectura — Analytics deja de ser un conjunto de
KPIs sueltos calculados ad hoc por ruta y pasa a ser una plataforma con
motor propio, versionado y auditoría, por eso se marca como versión mayor
(v1.0.0) en este historial reconstruido.

**Autor:** Claude Code
**Estado:** Implementado

---

## v0.19.0 — 2026-07-18

**Tipo:** ANALYTICS / FEATURE
**Módulo:** Analytics / Ajustes

**Implementado:** Dashboard ejecutivo ampliado a Administrador/Coordinador
Nacional; Nova Insights generados con Groq (4 bullets deterministas +
recomendación de IA, tiered por nivel de rol); panel de alertas de riesgo
real (`riskAlerts.ts`); desglose de tareas por estado en vez de conteo
plano; filtrado de meses sin datos en tendencias.

**Autor:** Claude Code · **Estado:** Implementado

---

## v0.18.0 — 2026-07-17

**Tipo:** FEATURE
**Módulo:** Ajustes / Trabajo

**Implementado:** Notificaciones configurables, motivos de actividad
dinámicos (antes enum fijo), feriados administrables, permisos por rango,
mensaje de bienvenida configurable, acordeones colapsables en Ajustes,
estado especial de maternidad/lactancia con límites de carga laboral
configurables por registro.

**Autor:** Claude Code · **Estado:** Implementado

---

## v0.17.0 — 2026-07-15/16

**Tipo:** FEATURE
**Módulo:** Trabajo

**Implementado:** Preferencia de formato de registro de actividad
(duración vs. hora inicio/fin), registro retroactivo de horas, edición de
horas por Administrador con comentario obligatorio, comentarios
bidireccionales por actividad, validador de solapamiento horario,
limpieza de `LoginAttempt` expirados.

**Autor:** Claude Code · **Estado:** Implementado

---

## v0.16.0 — 2026-07-14/15

**Tipo:** SECURITY / DATABASE
**Módulo:** Cumplimiento (LOPDP) / Infraestructura

**Implementado:** Solicitudes de titulares de datos (acceso/rectificación/
eliminación), política de retención de datos, rate limiting persistente
contra fuerza bruta de login, logs sanitizados. **Framework de pruebas
automatizadas con Vitest** — desde cero hasta ~271 tests cubriendo la
mayoría de `src/lib/` y las rutas de API principales (auth, usuarios,
tareas, actividades, comentarios, ideas, KPIs, reuniones, ajustes,
dashboard, informes, repositorio).

**Autor:** Claude Code · **Estado:** Implementado

---

## v0.15.0 — 2026-07-13/14

**Tipo:** FIX / FEATURE
**Módulo:** Trabajo / Analytics

**Implementado:** Fecha de generación de informes corregida, PDF sin
autoprint, Analytics responsive en mobile; tarjetas Kanban en grid de 2
columnas; nuevo formulario de actividad por horas/minutos para tareas
SEGUIMIENTO.

**Autor:** Claude Code · **Estado:** Implementado

---

## v0.14.0 — 2026-07-11/12

**Tipo:** ANALYTICS / FIX
**Módulo:** Analytics (Carga laboral)

**Implementado:** Sistema de carga laboral de 5 zonas (Subutilización /
Moderado / Óptimo / Carga elevada / Sobrecarga) con 4 límites
independientes configurables, gráficos de barras y línea, corrección de
superposición de etiquetas en mobile, techo de 100% en el rango óptimo,
semáforo desactivado para el KPI diario en fin de semana.

**Autor:** Claude Code · **Estado:** Implementado

---

## v0.13.0 — 2026-07-10/11

**Tipo:** SECURITY / DOCUMENTATION
**Módulo:** Seguridad / Infraestructura

**Implementado:** Control de acceso reforzado en API, consentimiento
vinculante, subida a la base de conocimiento RAG restringida a
Administrador; README reescrito con changelog automático (nace el hook
`post-commit` + `update-changelog.js`, con guarda de idempotencia contra
el amend); formato HH.MM para horas en toda la aplicación.

**Autor:** Claude Code · **Estado:** Implementado

---

## v0.12.0 — 2026-07-08/09

**Tipo:** FEATURE / FIX
**Módulo:** Nova (Asistente IA) / Infraestructura

**Implementado:** Configuración de carga laboral con historial; base de
conocimiento de Nova migrada de Google Drive a un repositorio GitHub
dedicado. Serie de fixes de despliegue en Vercel: `pdfjs-dist` y
`onnxruntime-node` fallaban silenciosamente en producción (Linux) aunque
funcionaban en desarrollo (Windows) — resuelto incluyendo los binarios
nativos en el bundle serverless (`outputFileTracingIncludes`) y
procesando embeddings en lotes concurrentes.

**Autor:** Claude Code · **Estado:** Implementado

---

## v0.11.0 — 2026-07-06/07

**Tipo:** FEATURE / REFACTOR
**Módulo:** Usuarios / Ajustes

**Implementado:** Rol Administrador (aislado del resto de la jerarquía);
rol Asistente de Nómina; resolución de **todos** los errores/warnings de
ESLint sin cambiar comportamiento; módulo de Ajustes; manuales de usuario
exportables en PDF; 5 mejoras operativas en cierre mensual, repositorio,
usuarios, reuniones y seguimiento.

**Autor:** Claude Code · **Estado:** Implementado

---

## v0.10.0 — 2026-07-05/06

**Tipo:** ANALYTICS / FIX
**Módulo:** Analytics (Carga laboral)

**Implementado:** Carga laboral con base dinámica de días hábiles (en vez
de un valor fijo), cálculo de "hoy" usando el huso horario de negocio
(no el del servidor), carga laboral dinámica reflejada en informes y
recordatorios de seguimiento.

**Autor:** Claude Code · **Estado:** Implementado

---

## v0.9.0 — 2026-07-04/05

**Tipo:** SECURITY
**Módulo:** Cumplimiento (LOPDP)

**Implementado:** Enmascarado de correos electrónicos, consentimiento de
datos personales (LOPDP) y ajustes de privacidad — primera entrega formal
de cumplimiento normativo.

**Autor:** Claude Code · **Estado:** Implementado

---

## v0.8.0 — 2026-07-03/05

**Tipo:** UI / UX
**Módulo:** Sistema de diseño

**Implementado:** Sistema de diseño completo con modo claro/oscuro (v1);
días después, rediseño visual premium con sidebar, tokens de diseño y
nueva iconografía (v2); formato de fechas `YYYY-MM-DD` centralizado en
toda la aplicación; avance en Seguimiento con buscador y cierre mensual.

**Autor:** Claude Code · **Estado:** Implementado

---

## v0.7.0 — 2026-07-02

**Tipo:** FEATURE / SECURITY
**Módulo:** Mejora Continua / Seguridad

**Implementado:** Módulo de ideas de mejora continua; primera auditoría de
seguridad del proyecto; selección múltiple y acciones masivas en la vista
Tabla de tareas.

**Autor:** Claude Code · **Estado:** Implementado

---

## v0.6.0 — 2026-07-01

**Tipo:** FEATURE
**Módulo:** Dashboard / Reuniones

**Implementado:** Nuevo inicio (Dashboard) con tarjetas drag-and-drop y
resumen de Analytics; módulo de Reuniones con integración real de Zoom y
notas automáticas de Otter.ai; Nova ("Asistente" renombrado) accesible
para todos los niveles de rol en su modo RRHH.

**Autor:** Claude Code · **Estado:** Implementado

---

## v0.5.0 — 2026-06-30

**Tipo:** FEATURE
**Módulo:** Nova (Asistente IA)

**Implementado:** Asistente de IA con 3 modos, base de conocimiento RAG y
citación de fuentes; ajustado para no señalar individuos en modo RRHH y
mantener una perspectiva de consultor integral de gestión de personal.

**Autor:** Claude Code · **Estado:** Implementado

---

## v0.4.0 — 2026-06-29/30

**Tipo:** FEATURE
**Módulo:** Analytics / KPIs

**Implementado:** Informes mensuales consolidados con análisis de IA
(Groq); informe de rango con gráfico de evolución y tendencias; "Mis
KPIs" — dashboard personal accesible a todos los roles, con descargas
individuales por mes e informe de rango personal.

**Autor:** Claude Code · **Estado:** Implementado

---

## v0.3.0 — 2026-06-29

**Tipo:** FEATURE
**Módulo:** Analytics / KPIs

**Implementado:** Módulo de KPIs con visualizaciones dinámicas y
visibilidad basada en rol — primera entrega de Analytics como concepto
propio dentro de Nexo (antes de esto, no existía ningún tablero de
indicadores).

**Autor:** Claude Code · **Estado:** Implementado

---

## v0.2.0 — 2026-06-28/29

**Tipo:** FEATURE
**Módulo:** Trabajo / Usuarios / Equipo

**Implementado:** Módulo completo de gestión de tareas (Kanban, Tabla,
Gantt); clasificación de tareas FIJA/SEGUIMIENTO con registro de
actividades (el origen del modelo unificado en v1.3.0); comentarios con
avatares/roles y notificaciones jerárquicas; página de perfil editable;
módulo Equipo con vista de subordinados y asignación de tareas; edición
de usuarios con validación jerárquica en `/admin/users`.

**Autor:** Claude Code · **Estado:** Implementado

---

## v0.1.0 — 2026-06-28

**Tipo:** FEATURE / BREAKING CHANGE
**Módulo:** Núcleo del sistema

**Implementado:** Proyecto renombrado a Nexo; sistema de autenticación
completo (JWT, cookies httpOnly, bcrypt) — punto de partida de todo el
historial documentado en este archivo.

**Autor:** Claude Code · **Estado:** Implementado

---

_Commits totales al 2026-07-22: 155+. Ver `git log --oneline` para el
detalle línea por línea de cualquier período no cubierto explícitamente
arriba. Este documento se actualiza hacia adelante con cada implementación
relevante — ver `CLAUDE.md` § Documentación para el procedimiento._
