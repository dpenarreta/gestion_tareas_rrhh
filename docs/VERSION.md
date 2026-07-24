# Versionado de Nexo

> Fuente oficial de verdad del versionado del sistema. Se actualiza en cada
> implementación relevante — ver la sección "Mantenimiento" al final de este
> documento y `docs/CHANGELOG.md` para el detalle de cada cambio.

## Estado actual

| Componente | Versión | Notas |
|---|---|---|
| **NEXO** (producto) | **v1.15.1** | Ver `docs/CHANGELOG.md` para el detalle de qué introdujo cada versión |
| **Analytics Engine** | v1.5.0 | `ANALYTICS_ENGINE_VERSION` en `src/lib/analytics.ts` — sin cambios (el fix de `isCompletedOnTime` vive en `priorityCompliance.ts`, fuera del motor central) |
| **Formulas Set** | v4.3 | `FORMULA_SET_VERSION` en `src/lib/analytics.ts` — sube por la corrección de `isCompletedOnTime` (2026-07-24, `FORMULA_VERSIONS.completadoATiempo`) |
| **API** | Sin versionado explícito (rutas internas de Next.js, no una API pública versionada) | Ver `docs/ARCHITECTURE.md` |
| **Prisma Schema** | Sin campo de versión propio — el historial de migraciones en `prisma/migrations/` es la fuente de verdad de su evolución | — |

**Última actualización:** 2026-07-24 (v1.15.1 — Sprint D continuación: UX, Calidad del Dato ampliada, validación de efectos secundarios)
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
| v1.14.3 | 2026-07-24 | **Fix — cierra condición de carrera en `migrateFijaHistoryIfNeeded`**: la migración perezosa de historial de tareas Fijas ahora corre `count()`/`upsert()`/`create()` dentro de una transacción `Serializable`, evitando que dos peticiones concurrentes dupliquen la actividad migrada (riesgo teórico, nunca observado en producción); ver `docs/AUDIT_LOG.md` § 2026-07-24 |
| v1.15.0 | 2026-07-24 | **Sprint D — Optimización y Refinamiento**: auditoría integral de los 10 módulos (~40 hallazgos), cierra un IDOR real en 5 subrecursos de tareas + crash al eliminar usuarios, consolida ~10 duplicaciones de código, agrupa consultas del Dashboard en `Promise.all`, memoiza gráficos de KPIs, agrega buscador a Usuarios, y suma un panel de Calidad del Dato en Ajustes (fechas inválidas, horas duplicadas, registros sin propietario) — cero módulos nuevos, cero cambios de fórmula, alcance acotado a "solo lo seguro" (hallazgos de negocio quedaron en backlog); ver `docs/AUDIT_LOG.md` § Sprint D |
| **v1.15.1** | 2026-07-24 | **Sprint D (continuación) — UX, Calidad del Dato ampliada, validación de efectos secundarios**: 10 fixes de UX (spinners/aria-labels/EmptyState/tabla responsive/botones compartidos/normalización visual) de una auditoría dedicada; 2 verificaciones nuevas de Calidad del Dato (motivo huérfano, retroactivo inconsistente); informe de validación de efectos secundarios (Bloque 11) confirmando por `git diff` que Sprint D no tocó Analytics/KPIs/Timeline ni perdió invalidación de caché — ver `docs/AUDIT_LOG.md` § Sprint D (continuación) |

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
