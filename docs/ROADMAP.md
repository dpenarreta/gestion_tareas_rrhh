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
  módulo integrado (v1.6.0 — este sprint).

## En desarrollo

_(vacío al 2026-07-22 — no hay ninguna funcionalidad a medio implementar al
cierre de este sprint)._

## Planificado

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
  Escritorio Digital, Documentos, Repositorios, Plantillas, Comunicados) —
  cada uno requiere solo una entrada nueva en `ENTITY_REGISTRY`
  (`src/lib/recoveryCenter.ts`) más su propia bandera `deletedAt` local.

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

_Última actualización: 2026-07-23._
