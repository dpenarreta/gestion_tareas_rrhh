# Decisiones de Arquitectura de Nexo

> Bitácora liviana de decisiones de arquitectura y diseño técnico — un
> índice escaneable de "qué se decidió y por qué", en una línea o un párrafo
> corto por decisión. Para el análisis completo (problema/alternativas/
> justificación/impacto) de las decisiones más significativas, ver
> `docs/AUDIT_LOG.md`, enlazado desde cada fila cuando exista.

| Decisión | Motivo técnico | Detalle completo |
|---|---|---|
| Cambio de "Horas Estimadas" → "Tiempo Objetivo" | Separar la estimación subjetiva del colaborador de un estándar oficial que un líder puede validar, sin migrar la columna física de Prisma. | `AUDIT_LOG.md` § 2026-07-21 |
| Unificación de registro Fija/Seguimiento vía `TaskActivity` | Las tareas Fijas no tenían historial ni auditoría de horas; reutilizar el modelo de Seguimiento evita mantener dos sistemas de registro con reglas distintas. | `AUDIT_LOG.md` § 2026-07-21 |
| Migración de historial de Fijas: perezosa, no un script masivo | La base de datos compartida es producción — una migración bajo demanda evita una escritura global irreversible sin necesidad real de serlo. | `AUDIT_LOG.md` § 2026-07-21 |
| Separación de Performance Score y Operational Risk Score | Un único número mezclaba desempeño y riesgo/capacidad, ocultando cuál de los dos requiere intervención. | `AUDIT_LOG.md` § 2026-07-20 |
| Índice de Riesgo Operativo congelado (Sprint 5 §S5-C) | Estabilidad de un indicador usado en reportes de dirección — cambiar sus pesos/reglas sin una decisión explícita rompería comparabilidad histórica. | `docs/ANALYTICS_FORMULAS.md` |
| Cero IA para cálculos de negocio (Decision Intelligence Engine) | Auditabilidad y disponibilidad — un KPI/alerta no puede depender de una llamada no determinista a un LLM ni de que `GROQ_API_KEY` esté configurada. | `AUDIT_LOG.md` § 2026-07-20 |
| Motor de Benchmarks Inteligente — 3 niveles (cargo/limitado/personal) | Muchos cargos de esta organización son de una sola persona; comparar contra el propio historial evita el mensaje "sin datos" sin inventar comparaciones inválidas. | `AUDIT_LOG.md` § 2026-07-20 |
| Modelo de Analytics diferenciado para roles de dirección | Jefe Nacional/Administrador dirigen equipos, no ejecutan tareas — sus KPIs individuales de ejecución no son representativos y distorsionan promedios/recomendaciones del equipo. | `AUDIT_LOG.md` § 2026-07-21 |
| Invalidación de caché de Analytics: global → granular por usuario | La invalidación global era correcta pero recalculaba Analytics de todo el sistema ante el cambio de un solo usuario, una vez que el patrón de acceso maduró lo suficiente para segmentar por clave. | `AUDIT_LOG.md` § 2026-07-21 |
| NormalizationEngine (curvas configurables por indicador) | Distintos indicadores necesitan distintas curvas de sensibilidad (lineal, por tramos) sin hardcodear umbrales — se centralizó en `getEffectiveCurve()`/`DEFAULT_CURVES`, editable desde Ajustes. | `docs/ANALYTICS_FORMULAS.md` |
| `getOfficialTargetTime()` como único accesor de Tiempo Objetivo | Evitar que cada caller reimplemente el fallback `targetTimeValidated ?? estimatedHours` — encontrado repetido antes de consolidarse. | `AUDIT_LOG.md` § 2026-07-21 |
| Prisma 7 con `@prisma/adapter-pg` (driver adapter obligatorio) | `new PrismaClient()` sin adapter lanza error en runtime desde Prisma 7 — se estandarizó la inicialización en `src/lib/prisma.ts` como singleton. | `CLAUDE.md` |
| JWT firmado (`jose`) + cookie httpOnly en vez de sesiones server-side | Sin estado de sesión que persistir en base de datos; el payload (`userId`/`role`/`name`/`email`) es suficiente para las verificaciones de `proxy.ts` sin una consulta adicional en cada request. | `docs/ARCHITECTURE.md` |
| Sistema de diseño v1 (2026-07-03) → v2 (2026-07-05) | La primera versión (modo claro/oscuro) se reemplazó por un rediseño premium con sidebar, tokens de diseño e iconografía nueva, tras validar la dirección visual con el producto. | — |
| Framework de pruebas: Vitest + Testing Library (no Jest) | Integración nativa con Vite/Next 16 sin configuración adicional de transformadores; `vitest.config.ts` ya replica el setup recomendado por la documentación de Next 16 para este propósito. | `CLAUDE.md` |
| Changelog automático vía hook `post-commit` (no `prepare-commit-msg`) | Un `git add` hecho en `prepare-commit-msg` no queda incluido en el commit que se está creando (comprobado empíricamente); enmendar desde `post-commit` sí funciona. | `.githooks/update-changelog.js` |
| Sistema de documentación en `/docs` leído en vivo, sin base de datos nueva | Los Markdown ya viven en el repositorio versionado por Git — una tabla nueva solo para mostrarlos duplicaría una fuente de verdad que ya existe. | Este sprint (2026-07-22) |
| Módulo Proyectos como dominio independiente de Task (no una extensión) | "No cierra por mes" y "sin registro colectivo único" contradicen invariantes ya asumidos por `Task`/`archivedMonth`; un dominio nuevo evita ramas condicionales en código existente. | `AUDIT_LOG.md` § 2026-07-23 |
| Centro de Recuperación: registro de adaptadores (`entityType` como `String`), no un enum de Prisma | Un enum exigiría una migración de schema por cada módulo nuevo dado de alta; un registro en código logra costo-cero real de integración. | `AUDIT_LOG.md` § 2026-07-23 |
| Eliminación de Proyectos acotada solo al creador (no responsable/liderazgo) | El pedido (Sprint 2.1 §3) fue literal — sin excepción de liderazgo, se implementó tal cual en vez de asumir un atajo administrativo no solicitado. | `AUDIT_LOG.md` § 2026-07-23 |
| "Participante" de un proyecto: por asignación explícita o por registrar actividad (nunca automático al crear) | Responsable y participante son conceptos distintos (Sprint 2.1 §2); auto-alta al registrar evita que la primera actividad de alguien quede huérfana de la pestaña Participantes. | `AUDIT_LOG.md` § 2026-07-23 |
| Escritorio Digital excluye al Administrador (crear/recibir/leer/fijar/archivar) | No es un participante operativo del día a día — el pedido lo excluyó explícitamente, sin excepción. | `src/lib/roles.ts` (`canUseDeskNotes`) |
| Escritorio Digital sin jerarquía de destinatarios (a diferencia de `VISIBLE_ROLES`) | Simula un escritorio físico compartido entre colegas, no un canal de reporte ascendente/descendente — cualquier no-Administrador puede dejarle una nota a cualquier otro no-Administrador. | `src/app/api/desk-notes/recipients/route.ts` |
| Escritorio Digital: segundo módulo integrado al Centro de Recuperación, sin pantalla de papelera dedicada todavía | El código ya anticipaba el módulo por nombre en `ENTITY_REGISTRY`; integrar el adaptador cuesta ~10 líneas y respeta "ningún módulo construye su propia papelera", sin inflar el sprint con UI no pedida. | `AUDIT_LOG.md` § 2026-07-23 |
| `FollowUpReminder` migrado y eliminado (no coexistencia temporal) | El pedido dice "eliminar completamente"; mantener ambos sistemas vivos duplica superficie de mantenimiento sin necesidad real. Datos migrados a `PersonalReminder`, verificados antes de `DROP TABLE`. | `AUDIT_LOG.md` § 2026-07-23 |
| Recordatorios: notificación perezosa (`Notification` reutilizado) reemplaza el popup `ReminderNotifier` | El pedido exige reutilizar el sistema de notificaciones existente (§15); un popup flotante persistente contradice el espíritu de un "centro personal" calmado. | `AUDIT_LOG.md` § 2026-07-23 |
| Adjunto de la nota NO se copia al convertir en tarea (solo se referencia por nombre en la descripción) | `Task` no tiene campo de adjunto y el pedido prohíbe modificar Trabajo salvo la eliminación de recordatorios (§15); la nota original con el adjunto real permanece intacta y accesible. | `AUDIT_LOG.md` § 2026-07-23 |
| `PersonalReminder` no se integra al Centro de Recuperación (borrado físico + `DeskAuditLog`) | Ítem de productividad personal de alta rotación — someterlo a retención/restauración es sobre-ingeniería no pedida, a diferencia de `DeskNote` (comunicación entre personas). | `AUDIT_LOG.md` § 2026-07-23 |
| "Proyectos con actividad reciente" (Bandeja Hoy) usa ventana fija de 7 días, no la última visita real | `User` no guarda timestamp de última visita al Escritorio; agregarlo quedaba fuera de alcance. Documentado para no prometer una medición que no existe. | `AUDIT_LOG.md` § 2026-07-23 |
| Reabrir un recordatorio actualiza la fila existente in-place (nunca crea una nueva) | El pedido es literal: "no se creará un nuevo registro", "se conservará el mismo identificador" — preserva `id` y todo el `DeskAuditLog` acumulado. | `AUDIT_LOG.md` § 2026-07-23 |
| Reabrir con nueva fecha audita `REOPENED` + `POSTPONED` (dos eventos, no uno nuevo) | El pedido ejemplifica el historial como dos líneas separadas; "reabrir con nueva fecha" y "posponer" son el mismo cambio de campo, no ameritan un tercer valor de enum. | `AUDIT_LOG.md` § 2026-07-23 |
| Reabrir un recordatorio archivado lo desarchiva automáticamente (incondicional) | Un recordatorio "archivado pero pendiente" es un estado sin caso de uso pedido; reabrir debe devolverlo a activo en todo sentido. | `AUDIT_LOG.md` § 2026-07-23 |
| "Convertir en Tarea" se retira de las notas — ahora Nota→Recordatorio→Tarea | El pedido reestructura el flujo en dos pasos; se confirmó 0 uso real de la conversión directa antes de eliminar la columna. | `AUDIT_LOG.md` § 2026-07-23 |
| El adjunto se copia (no se referencia) en cada hop de conversión Nota→Recordatorio | La nota original puede purgarse a los 15 días de archivada; una referencia suelta perdería el archivo antes de llegar a Tarea. | `AUDIT_LOG.md` § 2026-07-23 |
| Eliminación definitiva desde Archivadas es un borrado directo, no una segunda papelera | La nota archivada ya tiene su propio reloj de 15 días (§8); envolverla en el Centro de Recuperación además sería una retención duplicada sobre la misma acción. | `AUDIT_LOG.md` § 2026-07-23 |
| Respuestas de nota acotadas a 2, entre remitente y destinatario únicamente | El pedido es explícito: no es un chat. Al límite, la API devuelve el mensaje exacto pedido en vez de una genérica. | `src/app/api/desk-notes/[id]/replies/route.ts` |
| Buscador de Escritorio Digital como overlay, no como pestaña | El pedido exige que buscar no obligue a cambiar de sección; una pestaña "Buscar" contradice eso literalmente. | `src/components/desk/GlobalSearchOverlay.tsx` |

---

## Cómo agregar una decisión nueva

Cuando una implementación futura tome una decisión de arquitectura o diseño
técnico no trivial (una alternativa fue descartada por una razón concreta),
agregar una fila a la tabla de arriba. Si la decisión es lo bastante
significativa como para merecer un análisis completo de alternativas
evaluadas, agregar también una entrada en `docs/AUDIT_LOG.md` y enlazarla
desde la columna "Detalle completo".

_Última actualización: 2026-07-23._
