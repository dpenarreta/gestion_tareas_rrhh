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

- **Sprint Q — Analytics Engine Performance (variantes batch para
  cálculos masivos).** Limitación conocida documentada en v1.22.3: el
  Executive Reporting Engine, al generar un reporte MENSUAL del mes
  calendario en curso, llama a `computeHealthScore`/`computePerformanceScore`/
  `computeCumplimientoProjection`/`computeSobrecargaProbability` **una vez
  por cada colaborador del equipo** (medido: ~22s con 9 colaboradores, sobre
  el presupuesto de 15s del FPS Parte IV §8) — estas funciones fueron
  diseñadas para uso individual (página de KPIs personal), no para invocarse
  en lote. **No afecta la exactitud de los resultados** — son las mismas
  funciones, mismos valores, solo más lentas al ejecutarse en serie por
  colaborador. Las regeneraciones del mismo reporte dentro de la ventana de
  caché (`cached()`, mismo TTL configurable que ya usa el resto del motor)
  bajan a ~3.3s, dentro de presupuesto — medido y verificado en
  `scripts/bench-executive-report.ts`. El único objetivo de este sprint
  futuro será incorporar variantes batch (mismo patrón que
  `computeTeamCapacityForecast`/`computeSubutilizacionPredictions`, que ya
  existen) a esas 4 funciones — **sin modificar fórmulas, resultados ni
  comportamiento funcional**, solo la forma de invocarlas para un equipo
  completo en una sola tanda de consultas. `predictionEngine.ts`/
  `analytics.ts` se mantienen intactos hasta entonces — decisión explícita
  del usuario. Ver `docs/AUDIT_LOG.md` § 2026-07-28 (Executive Reporting
  Engine 2.0 — Parte IV).
- **Sprint R — Snapshot Integrity Validation** — validación ACTIVA en tiempo
  de ejecución que vuelva a consultar Dashboard/Analytics al momento de
  generar un reporte y compare/registre cualquier discrepancia como
  incidente (FPS Parte IV §15). La integridad ESTRUCTURAL ya se considera
  cumplida en v1.22.3 — el Executive Reporting Engine usa un único Builder
  canónico (`buildSnapshotData.ts`) que llama a las mismas funciones de
  Analytics que Dashboard/Analytics ya usan, y un único objeto
  `ExecutiveReportSnapshotData` del que se derivan todas las vistas — dos
  superficies no pueden divergir si comparten la misma función y el mismo
  objeto. Por eso no se considera necesaria una verificación adicional en
  esta versión; esta validación activa queda como una capa de monitoreo
  futura, no una corrección pendiente. No modifica la integridad estructural
  existente. Ver `docs/AUDIT_LOG.md` § 2026-07-28 (Executive Reporting
  Engine 2.0 — Parte IV).
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
