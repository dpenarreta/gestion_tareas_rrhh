# Versionado de Nexo

> Fuente oficial de verdad del versionado del sistema. Se actualiza en cada
> implementación relevante — ver la sección "Mantenimiento" al final de este
> documento y `docs/CHANGELOG.md` para el detalle de cada cambio.

## Estado actual

| Componente | Versión | Notas |
|---|---|---|
| **NEXO** (producto) | **v1.7.0** | Ver `docs/CHANGELOG.md` para el detalle de qué introdujo cada versión |
| **Analytics Engine** | v1.5.0 | `ANALYTICS_ENGINE_VERSION` en `src/lib/analytics.ts` |
| **Formulas Set** | v4.2 | `FORMULA_SET_VERSION` en `src/lib/analytics.ts` — paquete de fórmulas vigente dentro del motor |
| **API** | Sin versionado explícito (rutas internas de Next.js, no una API pública versionada) | Ver `docs/ARCHITECTURE.md` |
| **Prisma Schema** | Sin campo de versión propio — el historial de migraciones en `prisma/migrations/` es la fuente de verdad de su evolución | — |

**Última actualización:** 2026-07-23
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
| **v1.7.0** | 2026-07-23 | **Sprint 2.1** — refinamiento UX/UI de Proyectos: historial consolidado, responsable/participante distintos, eliminación acotada al creador, fases en tarjetas, registro de tiempo por hora inicio/fin, timeline cronológico, dashboard ejecutivo en Resumen |

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
