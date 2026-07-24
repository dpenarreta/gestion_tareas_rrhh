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
  cualquier pestaña (v1.11.0 — este sprint).

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
  Documentos, Repositorios, Plantillas, Comunicados) — cada uno requiere
  solo una entrada nueva en `ENTITY_REGISTRY` (`src/lib/recoveryCenter.ts`)
  más su propia bandera `deletedAt` local. Proyectos y Escritorio Digital
  ya están integrados.
- Pantalla de papelera/restauración/eliminación definitiva dedicada para
  Escritorio Digital (`entityType: "DESK_NOTE"`) — el adaptador y el
  soft-delete ya existen (`DELETE /api/desk-notes/[id]` usa
  `recoveryCenter.moveToTrash()`), falta la UI de restaurar/purgar, igual
  que para Proyectos (ver el punto de consola administrativa unificada más
  arriba).
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
  el adaptador de `recoveryCenter` ya existe (`DELETE /api/desk-notes/[id]`
  ya usa `moveToTrash()`), falta la pantalla, igual que el punto ya
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
