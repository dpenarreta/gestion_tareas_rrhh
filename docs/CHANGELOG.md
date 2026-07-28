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

## v1.23.4 — 2026-07-28

**Tipo:** FIX
**Módulo:** Executive Reporting Engine — límite cliente/servidor (`src/lib/executiveReporting/indiceEjecutivo.ts` nuevo, `reportInsights.ts`, `estadoGeneral.ts`)

Bug real reportado por el usuario: el fix de v1.23.3 (unificación del Estado
General) NO se veía reflejado en producción — un Informe de Rango
Personalizado seguía mostrando "Sin datos para el período" pese a que el
snapshot tenía colaboradores/indicadores/recomendaciones completos.

- **Causa raíz — no era el algoritmo, era el DEPLOY**: se instrumentó
  `buildCustomRangeSnapshotData` contra la BD real con el período exacto
  reportado (03 jul — 27 jul 2026, 9 colaboradores) y `resolveEstadoGeneral`/
  `buildReportPages` ya calculaban correctamente "Excelente — 87/100" — el
  código de v1.23.3 era correcto. `npx vercel ls` mostró que el deploy de
  producción del commit `fc04525` (v1.23.3) había terminado en **● Error**
  — Vercel seguía sirviendo el deploy anterior (previo al fix), por eso el
  usuario seguía viendo el bug ya corregido.
- **`npx vercel inspect <deploy> --logs`** reveló la causa real del build
  roto: un panic de Rust en Turbopack (`crates/next-code-frame/src/
  highlight.rs:1011` — "end byte index 94 is not a char boundary; it is
  inside 'í'") al intentar renderizar el code frame de un diagnóstico de
  build. Reproducido de forma determinista en local (`npx next build`, con
  y sin `.next` cacheado).
- **Causa raíz del panic**: `estadoGeneral.ts` (v1.23.3) importaba
  `classifyIndiceEjecutivo` de `@/lib/reportInsights` — un archivo que
  empieza con `import "server-only"` (Prisma, `getHolidaySet`, `analytics.ts`
  transitivos). `estadoGeneral.ts` lo usa `documentModel.ts`, que a su vez
  importan DIRECTAMENTE dos Client Components (`ReportWizardModal.tsx`/
  `MonthlyReports.tsx`) para generar el PDF/Excel en el navegador (llaman a
  `buildReportPages`/`buildExecutiveReportHtml` en el cliente). Ese import
  real (no `import type`) arrastraba TODO `reportInsights.ts` al bundle de
  cliente — una violación real que Next.js debe rechazar en build (y lo
  hace, correctamente) — pero el diagnóstico de Turbopack que reporta esa
  violación panickeaba al formatear el code frame de `holidays.ts` (un
  comentario con "días" — la 'í' cae en un límite de byte no válido de
  UTF-8 al truncar el preview), tumbando el build ENTERO en vez de mostrar
  un error de build normal.
- **Por qué solo afectaba a `documentModel.ts`/al reporte visible**: todos
  los demás consumidores de `reportInsights.ts` dentro del motor de reportes
  (`documentModel.ts`, `context.ts`, `snapshotData.ts`, `nova/*.ts`,
  `components/kpis/types.ts`) ya usaban exclusivamente `import type` —
  borrado en compilación, nunca dispara la guardia `"server-only"` (patrón
  ya documentado explícitamente en `kpis/types.ts`). `estadoGeneral.ts` fue
  el primer y único import de VALOR real cruzando esa frontera.
- **Corregido extrayendo el clasificador puro a su propio módulo**:
  `classifyIndiceEjecutivo`/`IndiceEjecutivoNivel`/`IndiceEjecutivoResult`
  (Bloque 11) no tienen ninguna dependencia de I/O — no necesitaban vivir en
  un archivo `"server-only"`. Se movieron a
  `src/lib/executiveReporting/indiceEjecutivo.ts` (sin `"server-only"`,
  cero dependencias); `reportInsights.ts` los reexporta para no romper a
  `buildSnapshotData.ts`/`report-insights.test.ts`; `estadoGeneral.ts` ahora
  importa directamente de `./indiceEjecutivo`, nunca de
  `@/lib/reportInsights`. Cero cambio de fórmula/etiquetas/umbrales.
- **Verificado el fix real**: `npx next build` local (con y sin `.next`
  cacheado) completa sin panic — el error de Turbopack desaparece porque ya
  no hay ninguna violación de frontera cliente/servidor que reportar.
- Verificado: `tsc --noEmit`/`npm run lint` limpios, **1141/1141 tests**
  (sin tests nuevos — el fix es de módulo/bundling, no de lógica; ya cubierto
  por los tests de v1.23.3), `npx next build` de producción exitoso.

## v1.23.3 — 2026-07-28

**Tipo:** FIX
**Módulo:** Executive Reporting Engine — unificación del Estado General (`src/lib/executiveReporting/estadoGeneral.ts` nuevo, `documentModel.ts`, `context.ts`)

Bug real reportado: la Portada de un Informe de Rango Personalizado con
colaboradores, indicadores, hallazgos, insights y recomendaciones completos
mostraba igual "Estado General: Sin datos para el período", mientras que un
Informe Mensual del mes en curso mostraba "Excelente — 89.7/100" con el
mismo motor.

- **Causa raíz**: `buildCoverPage` (`documentModel.ts`) derivaba
  `estadoGeneralLabel`/`color`/`scoreGeneral` EXCLUSIVAMENTE de
  `estadoGeneral.indiceEjecutivo` — `nivel ?? "Sin datos para el período"`.
  El Índice Ejecutivo (Bloque 11, `reportInsights.ts`) es, por diseño
  documentado desde su creación, exclusivo del mes calendario en curso:
  incorpora Equilibrio Operativo → Capacidad Futura, una proyección hacia
  adelante que no es representativa de un período ya cerrado o de un rango.
  `buildRangeSnapshotData`/`buildCustomRangeSnapshotData` nunca lo calculan
  (`indiceEjecutivo: null` fijo), y `buildMonthlySnapshotData` tampoco lo
  calcula fuera del mes en curso — en los 3 casos, correcto y esperado. El
  defecto real era tratar "Índice Ejecutivo ausente" como sinónimo de
  "snapshot sin datos", cuando son dos cosas distintas.
- **No era un problema de los 3 builders**: se comparó explícitamente cómo
  `buildMonthlySnapshotData`/`buildRangeSnapshotData`/
  `buildCustomRangeSnapshotData` construyen `meta`/`estadoGeneral`/
  `teamSummary`/`dataQuality`/`periodStatus` — los tres usan exactamente el
  mismo procedimiento y las mismas funciones compartidas
  (`computeDataQuality`, `generateReportId`, `currentExecutiveReportVersions`,
  `resolveMonthlyPeriodStatus`/`resolveCustomRangePeriodStatus`); la única
  diferencia es el conjunto de datos analizado, como debe ser. El bug vivía
  en la capa de PRESENTACIÓN, no en los builders.
- **Corregido con un constructor único**: `estadoGeneral.ts`
  (`resolveEstadoGeneral`) — la MISMA función para los 6 tipos de reporte
  (Mensual/Rango de Meses/Rango Personalizado × Consolidado/Individual/Por
  Área), sin ninguna rama por tipo:
  1. Snapshot realmente vacío (`members.length === 0` y
     `teamSummary.totalTasks === 0` y `teamSummary.totalConsultas === 0`) →
     "Sin datos para el período" — el ÚNICO caso legítimo para ese mensaje.
  2. `indiceEjecutivo` presente → se usa tal cual (sin cambios de fórmula).
  3. Snapshot con datos pero sin `indiceEjecutivo` → aproximación de
     respaldo, calculada EXCLUSIVAMENTE con `teamSummary.avgCumplimiento` +
     proximidad de `avgCargaPct` al 100% ideal (ambos ya presentes en el
     snapshot congelado — cero consulta a Prisma, cero recálculo de
     Analytics), reutilizando el mismo clasificador `classifyIndiceEjecutivo`
     y sus mismos umbrales/etiquetas (85/70/50 → Excelente/Bueno/Atención/
     Crítico) — nunca una escala paralela.
- **`buildCoverPage`** y **`deriveExecutiveReportContext`** (`context.ts`,
  el resumen que NOVA recibe para generar/degradar su narrativa) ahora
  llaman a `resolveEstadoGeneral` en vez de leer `indiceEjecutivo` cada uno
  por su cuenta — antes divergían por accidente (ambos leían el mismo campo
  `null`, pero de forma independiente); ahora divergir es estructuralmente
  imposible porque comparten la misma función.
- **Sin cambios en `buildSnapshotData.ts`**: los 3 builders siguen
  calculando `estadoGeneral.indiceEjecutivo` exactamente igual que antes (no
  se amplió su alcance a rango/mes cerrado — seguiría siendo una proyección
  no representativa). `ESTADO_GENERAL_COLOR` (mapeo nivel→color redundante
  con `IndiceEjecutivoResult.color`, ya existente) se eliminó de
  `documentModel.ts` por quedar sin uso.
- **Tests de regresión agregados**: `estadoGeneral.test.ts` (nuevo — 5 casos
  sobre `resolveEstadoGeneral`: vacío real, Índice Ejecutivo presente,
  aproximación de respaldo, simetría sobrecarga/subutilización, degradación
  sin lanzar), 2 casos nuevos en `documentModel.test.ts` (Portada de un
  Rango Personalizado con datos completos ya no muestra "Sin datos"; un
  snapshot realmente vacío sí lo muestra, sin importar el tipo), y
  `context.test.ts` (nuevo — NOVA recibe el mismo Estado General resuelto).
- Verificado: `tsc --noEmit`/`npm run lint` limpios, **1141/1141 tests**
  (9 nuevos).

## v1.23.2 — 2026-07-28

**Tipo:** FIX
**Módulo:** Executive Reporting Engine — lectura de reportes LEGACY_MIGRATION (`src/app/api/reports/executive/[reportId]/route.ts`)

Bug real reportado en producción tras el repunte de `MonthlyReports.tsx`
(v1.23.0): `TypeError: Cannot read properties of undefined (reading
'periodLabel')` al abrir la página Informes Mensuales.

- **Causa raíz**: los 4 `ExecutiveReportSnapshot` con `origin:
  LEGACY_MIGRATION` (backfill de Fase D, v1.22.0) se persistieron con la
  columna `data` **sin el campo `meta`** —
  `scripts/backfill-executive-report-snapshots.ts` (`adaptLegacyReportData`)
  devolvía a propósito `Omit<ExecutiveReportSnapshotData, "meta">` (el
  `reportId` solo se conocía dentro del loop de reintento por colisión) y
  nunca lo volvía a adjuntar antes de insertar; los campos equivalentes
  quedaron solo como columnas Prisma sueltas. El defecto era invisible
  porque ningún consumidor anterior leía `data.meta` de un reporte legacy —
  el repunte de `MonthlyReports.tsx` fue el primer código en hacerlo
  (`GET /api/reports/executive/[reportId]` → `body.report.data.meta.periodLabel`),
  y ahí revienta.
- **Corregido en el LÍMITE DE LECTURA, sin escribir en la base compartida**:
  `GET /api/reports/executive/[reportId]/route.ts` gana `ensureSnapshotMeta`
  — si `data.meta` falta, se reconstruye en runtime a partir de las columnas
  propias de la fila (`reportId`, `type`, `scope`, `origin`,
  `integrityFlag`, `periodLabel`, `periodStart/End`, `fechaCorte`,
  `periodStatus`, `collaboratorIds/Count`, `generatedBy` + `generator.name`,
  `generatedAt`, `generationMs`, las 4 versiones) — `rosterKind` se fija en
  `CONSOLIDADO` (valor correcto, no una suposición: `MonthlyReport` nunca
  soportó roster filtrado). Garantiza que `report.data` sea SIEMPRE un
  `ExecutiveReportSnapshotData` completo, para ambos orígenes.
- **Causa raíz también corregida en el origen**:
  `scripts/backfill-executive-report-snapshots.ts` ahora construye `meta`
  completo antes de insertar — no vuelve a reproducir el defecto si se
  ejecuta contra nuevos datos legacy en el futuro (las 4 filas ya migradas
  no se re-escriben — las corrige el fix de arriba en tiempo de lectura).
- **Validaciones defensivas agregadas** (`documentModel.ts` —
  `buildCoverPage`/`buildStrategicIndicatorsPage`/`buildMetadataPage` —, y
  los puntos de exportación en `MonthlyReports.tsx`/`ReportWizardModal.tsx`):
  optional chaining con fallback textual (`"Período no disponible"`, `"—"`)
  en cada acceso a `snap.meta.*` — ningún snapshot incompleto, sea cual sea
  su causa futura, puede volver a tumbar la página.
- **No se restauró el contrato antiguo** ni se agregó una rama de código que
  entienda "el formato viejo" — el fix hace que TODO snapshot que sale de
  este endpoint cumpla el mismo contrato único (`ExecutiveReportSnapshotData`
  completo), consistente con el principio "Analytics calcula una vez,
  Executive Reporting consume una vez" ya establecido.
- **Tests de regresión agregados**: `documentModel.test.ts` (un snapshot con
  `meta: undefined` no lanza y produce los fallbacks esperados) y
  `reports-executive.test.ts` (`GET /[reportId]` reconstruye `data.meta`
  correctamente cuando la fila persistida no lo trae).
- Verificado: `tsc --noEmit`/`npm run lint` limpios, **1132/1132 tests**
  (2 nuevos).

## v1.23.1 — 2026-07-28

**Tipo:** DOCUMENTATION
**Módulo:** Executive Reporting Engine — FPS Parte V (`docs/`)

Cierre documental del FPS del Executive Reporting Engine. La Parte V es
explícitamente no-funcional: "no deberá alterar el comportamiento del
Executive Reporting Engine implementado en las Partes I, II, III y IV" —
esta entrada no toca ningún archivo de `src/`, solo agrega/actualiza
documentación, grounded contra el código real de
`src/lib/executiveReporting/` (no especulada).

- **8 documentos nuevos** en `docs/`: `REPORTING_STANDARDS.md` (filosofía,
  público objetivo, principios de diseño/interpretación/auditoría,
  Definition of Product Excellence — 10 principios), 
  `REPORTING_NOVA_WRITING_GUIDE.md` (reglas obligatorias de redacción de
  NOVA, grounded contra `nova/prompts.ts`/`nova/confidence.ts` reales),
  `REPORTING_DESIGN_SYSTEM.md` (identidad visual del documento, grounded
  contra `EXECUTIVE_REPORT_STYLES` real — distinto de `DESIGN_SYSTEM.md`,
  que cubre la UI general de NEXO), `REPORTING_REFERENCE_LIBRARY.md`
  (ejemplos ilustrativos de las 11 páginas, 3 alcances y reportes LEGACY),
  `REPORTING_USE_CASES.md` (6 casos de uso oficiales, honestos sobre que
  solo 3 roles de NEXO acceden a reportes — los 6 casos son propósitos de
  uso, no 6 roles inventados), `REPORTING_AUDIT_MANUAL.md` (Report ID,
  Snapshot, integridad, fecha de corte, versiones, calidad del
  dato/confiabilidad, reconstrucción histórica, y una tabla honesta de qué
  acciones de `ExecutiveReportAuditLog` están realmente activas hoy vs. cuáles
  existen solo como tipo declarado — `exported_pdf`/`exported_excel`/
  `legacy_migrated` no se emiten desde ningún caller todavía),
  `REPORTING_EDGE_CASES.md` (9 casos límite documentados contra el código
  real — incluye 2 limitaciones conocidas no corregidas en esta entrega:
  `resolveMonthlyPeriodStatus` no distingue un mes futuro de un histórico sin
  cierre, y no hay validación de que `fechaCorte ≥ inicio del período`),
  `REPORTING_QUALITY_BENCHMARK.md` (10 criterios de aceptación con el estado
  real de cada uno, incluyendo las brechas conocidas ya registradas en
  v1.22.3).
- **`docs/ROADMAP.md` § Planificado**: los 2 sprints futuros ya registrados
  en v1.22.3 ganan su nombre oficial del FPS (Sprint Q — Analytics Engine
  Performance; Sprint R — Snapshot Integrity Validation) sin duplicarse.
  3 sprints nuevos registrados como intención, sin diseño técnico: Sprint S
  (Executive Benchmark — comparativos entre meses/áreas/equipos), Sprint T
  (Executive Presentation — PowerPoint/resumen para comité), Sprint U
  (Conversational Executive Reporting — consultas conversacionales sobre
  cualquier Snapshot histórico vía NOVA).
- **`docs/README.md`**: índice actualizado con los 8 documentos nuevos.
- Sin cambios a `docs/AUDIT_LOG.md`/`docs/DECISIONS.md` — esta entrega no
  modifica reglas de negocio ni arquitectura, solo las documenta (regla de
  CLAUDE.md § Documentación: esas bitácoras registran decisiones, no
  documentación descriptiva).

## v1.23.0 — 2026-07-28

**Tipo:** REFACTOR / BREAKING CHANGE (interno)
**Módulo:** Executive Reporting Engine — repunte de `MonthlyReports.tsx`/`ReportWizardModal.tsx` (`src/components/kpis/`)

Cierre del ítem diferido en v1.22.0: `MonthlyReports.tsx` y
`ReportWizardModal.tsx` dejan de tener una ruta de datos propia y pasan a
consumir EXCLUSIVAMENTE el endpoint unificado del Executive Reporting Engine
2.0. Investigación previa (agente de exploración) confirmó que los 7
componentes de presentación legacy y las 4 rutas antiguas no tenían ningún
otro consumidor en el sistema — seguro retirarlos por completo.

- **`MonthlyReports.tsx` reescrito**: ambas vistas (mes individual / rango)
  generan y leen ahora vía `POST /api/reports/executive`,
  `GET /api/reports/executive/[reportId]` y `GET /api/reports/executive/list`
  — el sidebar de "informes guardados" usa el historial real del snapshot
  (incluye entradas `LEGACY_MIGRATION`, marcadas con una etiqueta "Legacy").
  La vista en pantalla deja de tener una implementación de componentes
  propia y reutiliza el MISMO render a HTML que alimenta el PDF
  (`buildReportPages` + `buildExecutiveReportHtml`, inyectado vía
  `dangerouslySetInnerHTML` sobre contenido ya escapado) — pantalla y PDF no
  pueden volver a divergir en contenido.
- **`ReportWizardModal.tsx` reescrito**: el selector de "secciones a
  incluir" pasa de 10 claves ad-hoc a las 9 páginas reales del documento
  unificado (`ReportPage["kind"]`, excluyendo Portada/Metadatos que son
  siempre estructurales); el formato "PDF Ejecutivo" fuerza un subconjunto
  fijo (Resumen/Estado General/Indicadores/Recomendaciones) igual que antes.
  El preset "Rango personalizado"/"Últimos 30 días" del asistente ahora
  llega de verdad a `tipoReporte=RANGO_PERSONALIZADO` del motor unificado
  (antes llegaba a `/api/reports/custom-range`, un endpoint aparte con su
  propia lógica).
- **Retirado por ser código muerto tras el repunte** (verificado con grep de
  cero importadores restantes, no solo por inspección): 4 rutas
  (`/api/reports/generate`, `/api/reports/range`, `/api/reports/custom-range`,
  `/api/reports` list/detail), 7 componentes de presentación
  (`ExecutiveSummarySection`, `FindingsSection`, `RecommendationsSection`,
  `RiskMatrixChart`, `TrendsSection`, `TeamInsightsSection`,
  `IndicatorInterpretation`), `wizardExport.ts` completo (normalizadores +
  builders de PDF/Excel — su lógica ya vivía duplicada en
  `renderReportHtml.ts`/`renderReportExcel.ts`), los 4 `download*` de
  `MonthlyReports.tsx` (`downloadReportPDF`/`downloadReportExcel`/
  `downloadRangePDF`/`downloadRangeExcel`), los tipos `ReportData`/
  `RangeReportData`/`PeriodReportData`/`MonthlyReportSummary`/
  `MonthlyReportFull` de `kpis/types.ts`, y `src/__tests__/api/reports.test.ts`
  (probaba directamente los handlers de las rutas eliminadas). `MonthSnapshot`
  se conservó — lo sigue usando el motor nuevo (`monthlyEvolution`). El
  modelo Prisma `MonthlyReport` NO se tocó — permanece como tabla legacy
  inmutable, ya migrada por completo (ver v1.22.0/v1.22.2).
- **Sin pérdida funcional real, con un ajuste de superficie documentado**:
  el documento fijo de 11 páginas no imprime 3 campos que sí existen en el
  snapshot (tendencias mes/trimestre/semestre, evolución mensual con
  gráfico de línea por colaborador, alertas de gestión/persistentes) — se
  agregaron como paneles complementarios en pantalla (`TrendsPanel`,
  `RangeEvolutionPanel`, `AlertsPanel` en `MonthlyReports.tsx`), leyendo
  directamente del mismo snapshot ya congelado, sin recalcular nada. Los
  botones de exportación PDF/Excel ahora reutilizan el snapshot ya cargado
  en pantalla en vez de generar uno nuevo en cada clic (antes,
  `handleDownloadExecutiveV2Pdf`/`Excel` volvían a llamar a
  `POST /api/reports/executive`, creando un snapshot inmutable adicional
  por cada exportación) — corrige una duplicación de snapshots no
  intencional del sprint anterior, no un cambio de comportamiento visible.
- **Verificado**: `tsc --noEmit` limpio (solo los 2 errores preexistentes y
  no relacionados de siempre), `npm run lint` limpio (0 errores),
  `npx vitest run` en verde (83 archivos / 1130 tests — 14 menos que antes,
  correspondientes exactamente a los tests eliminados de
  `reports.test.ts`, sin ninguna prueba nueva fallando), `npm run build`
  exitoso (el listado de rutas del build ya no incluye las 4 rutas
  retiradas).

## v1.22.3 — 2026-07-28

**Tipo:** FIX / DOCUMENTATION
**Módulo:** Executive Reporting Engine — FPS Parte IV, Arquitectura Técnica/Calidad/Auditoría/Rendimiento (`src/lib/executiveReporting/`)

Última parte del FPS. Auditar el código real de las Fases A-E contra el
texto literal de la Parte IV encontró 3 brechas cerradas con código y 1
hallazgo de rendimiento resuelto mediante 2 decisiones explícitas del
usuario (documentadas en `docs/AUDIT_LOG.md` § Decisiones 8-9).

- **Report ID en pie de página**: el FPS exige que aparezca en Portada,
  Metadatos, pie de página y auditoría — solo estaba en los primeros dos.
  `renderReportHtml.ts` ahora inyecta un footer (`NEXO · Executive
  Reporting Engine · {reportId} · Página X de 11`) en las 11 páginas sin
  tocar los 11 render<X>Page individuales. Se agregó además `@media print
  { @page { size: A4; margin: 14mm } }`.
- **Auditoría de generación incompleta**: `filtersApplied` existía en el
  tipo `ReportAuditEntry` pero nunca se pasaba en la llamada `"generated"`
  de `/api/reports/executive`. Corregido. Se agregó además una entrada
  `generation_failed` en el catch (Report ID provisional generado al inicio
  del intento — para poder auditar incluso si el builder falla antes de
  generar el suyo propio —, paso del proceso, mensaje técnico) — el cliente
  sigue recibiendo el mismo mensaje genérico de siempre, el detalle técnico
  queda solo en el log de auditoría (FPS Parte IV §16).
- **Benchmark real de rendimiento** (`scripts/bench-executive-report.ts`,
  nuevo — llama a los builders directamente contra datos de producción, sin
  necesitar HTTP/sesión, mismo patrón que el backfill): un reporte MENSUAL
  del mes en curso con 9 colaboradores tomó ~22s, sobre el presupuesto de
  15s del FPS §8. Se descartó a NOVA como causa corriendo el mismo
  benchmark sin `GROQ_API_KEY` (cero llamadas de red) — tiempo idéntico. La
  causa real: `computeHealthScore`/`computePerformanceScore`/
  `computeCumplimientoProjection`/`computeSobrecargaProbability` se llaman
  una vez POR COLABORADOR (36 llamadas para 9 personas) — funciones
  diseñadas para uso individual, nunca antes invocadas en lote para un
  equipo completo. Dentro de lo permitido (sin tocar `predictionEngine.ts`/
  `analytics.ts`): se paralelizó el cómputo de Índice Ejecutivo y Analytics
  Predictivo (antes secuenciales sin necesidad real) y se agregó `cached()`
  (mismo patrón/TTL ya usado por el resto del motor) a las 2 llamadas de
  predicción que no lo tenían — una 2ª generación del mismo reporte en el
  mismo proceso bajó de ~22s a ~3.3s, dentro de presupuesto.
- **Decisión explícita del usuario — limitación conocida, no un bug**: la
  generación FRÍA del mes en curso queda documentada como limitación
  conocida de v2.0 — no afecta la exactitud de los resultados (mismas
  funciones, mismos valores, solo más lentas en serie); las regeneraciones
  se benefician del caché ya implementado. `predictionEngine.ts`/
  `analytics.ts` permanecen completamente intactos. Se registra como mejora
  futura un **Sprint de Optimización del Analytics Engine** (único
  objetivo: variantes batch para las 4 funciones, mismo patrón que
  `computeTeamCapacityForecast`/`computeSubutilizacionPredictions` que ya
  existen — cero cambio de fórmulas/resultados/comportamiento funcional).
  Ver `docs/ROADMAP.md` § Planificado.
- **Decisión explícita del usuario — Snapshot Integrity Validation
  diferida**: la validación ACTIVA en tiempo de ejecución (re-consultar
  Dashboard/Analytics al generar y registrar discrepancias como incidente,
  FPS Parte IV §15) queda como mejora futura, no se implementa en esta
  versión. La integridad ESTRUCTURAL ya se considera cumplida: el builder
  canónico único (`buildSnapshotData.ts`) llama a las mismas funciones que
  Dashboard/Analytics, y un único `ExecutiveReportSnapshotData` alimenta
  todas las vistas — dos superficies no pueden divergir si comparten la
  misma función y el mismo objeto.
- Tests: +2 (`reports-executive.test.ts` — `filtersApplied` presente en la
  auditoría, `generation_failed` auditado con mensaje técnico nunca
  expuesto al cliente). Suite completa: 1144/1144 en verde, `tsc`/`lint`
  limpios, `npm run build` exitoso.

Con esta versión se completa la implementación funcional de las 4 partes
del FPS Executive Reporting Engine 2.0 (Fases A-E de arquitectura +
materialización de Partes I-IV), con 2 mejoras futuras registradas y
documentadas en `docs/ROADMAP.md` § Planificado.

## v1.22.2 — 2026-07-28

**Tipo:** FIX
**Módulo:** Executive Reporting Engine — FPS Parte III, NOVA Intelligence Framework (`src/lib/executiveReporting/nova/`)

Con la Parte II aprobada (v1.22.1), se auditó el código real de NOVA (Fase
C) contra el texto literal de la FPS Parte III — no la memoria de lo
construido, sino los prompts/tipos/fallbacks tal como están hoy. La mayor
parte de la Parte III ya estaba correctamente implementada desde la Fase C
(persona de Consultor Senior, cadena de razonamiento obligatoria,
prohibición de muletillas, antialucinación, cruce inteligente de
indicadores, nivel de confianza interno, topes de longitud, enriquecimiento
de recomendaciones alineado estrictamente por `id`). Se encontraron y
cerraron 3 brechas concretas:

- **Recomendaciones incompletas**: la Parte III exige 5 campos por
  recomendación (Impacto esperado, Área afectada, Beneficio operativo,
  Nivel de prioridad, Complejidad estimada) — `NovaRecommendationEnrichment`
  solo tenía 3 de los 5 (más `tiempoEstimado`/`responsableSugerido`, útiles
  pero no los que pedía el FPS). Se agregaron `areaAfectada` y
  `complejidadEstimada` — tipo, prompt (`buildRecommendationEnrichmentPrompt`),
  fallback determinista (`fallbackRecommendationEnrichment`) y validación
  anti-alucinación (`validateAndAlignRecommendations`) actualizados en
  conjunto, sin romper la garantía de "nunca inventa ni pierde un id".
- **Profundidad de Fortalezas/Riesgos/Oportunidades**: el prompt de
  Executive Assessment pedía las 3 listas sin instruir la estructura
  específica que exige el FPS. Ahora exige explícitamente: fortalezas
  → por qué es fortaleza / qué impacto / cómo aprovecharla; riesgos → qué
  riesgo / por qué existe / qué impacto / qué acción preventiva; oportunidades
  → retorno esperado explícito (mismo ejemplo del FPS: redistribución de
  solicitudes → capacidad disponible sin recursos nuevos). Se agregó además
  instrucción de no repetir Executive Insights (antes solo prohibía repetir
  el Executive Summary).
- **Regla de Lenguaje ausente**: no había instrucción explícita contra
  jerga técnica de RRHH/Analytics o lenguaje emocional/de venta. Agregada a
  `NOVA_BASE_RULES`, compartida por los 4 prompts.
- **Sin cambios de arquitectura**: misma orquestación de 4 llamadas
  paralelas, mismo timeout por `Promise.race`, mismo fallback determinista
  garantizado, misma realineación estricta por `id`. Cero cambios a
  `analytics.ts`/`predictionEngine.ts`/Scores/Equilibrio Operativo — solo
  contenido de prompt y 2 campos de datos en un tipo ya existente.
- Tests: fixtures de `nova.test.ts`/`documentModel.test.ts` actualizados a
  la forma de datos ampliada. Suite completa: 1143/1143 en verde,
  `tsc`/`lint` limpios, `npm run build` exitoso.

## v1.22.1 — 2026-07-28

**Tipo:** FIX
**Módulo:** Executive Reporting Engine — FPS Parte II (`src/lib/executiveReporting/`)

Al cerrar la Fase E (v1.22.0), el usuario aprobó formalmente la arquitectura
y pidió materializar la FPS Parte II completa sobre la infraestructura ya
existente. Auditar la Fase E contra el checklist explícito de la Parte II
encontró 2 brechas reales entre lo construido y lo especificado — el resto
de la Parte II (Portada, Executive Summary, Estado General, Indicadores
Estratégicos, Detalle por Colaborador, Executive Insights, Recomendaciones,
Metadatos, Report ID/Snapshot/Fecha de Corte/Estado del período) ya estaba
completo desde la Fase E.

- **Distribución Operativa sin gráfico**: la página mostraba solo tarjetas
  numéricas. Se agregó un gráfico de barras horizontal minimalista (SVG
  inline, reutiliza las variables de color ya definidas en
  `EXECUTIVE_REPORT_STYLES`) — sin librería de gráficos nueva.
- **Analytics Predictivo era un placeholder**: mostraba "no disponible" sin
  excepción. `SnapshotPredictivo` pasa de `null` fijo a un tipo real
  (`buildMonthlySnapshotData` lo popula llamando a
  `computeCumplimientoProjection`/`computeSobrecargaProbability`/
  `computeSubutilizacionPredictions` de `predictionEngine.ts` — el motor
  YA EXISTENTE, por colaborador, sin ninguna fórmula nueva). Gateado a
  `isCurrentMonth`, mismo criterio ya usado por el Índice Ejecutivo (una
  proyección hacia adelante no es representativa de un mes ya cerrado). La
  página muestra tarjetas resumen (horizonte, cumplimiento esperado al
  cierre, colaboradores en riesgo de sobrecarga Alto) + detalle por
  colaborador; degrada con un mensaje explicativo cuando no aplica (rango,
  mes pasado), nunca falla.
- **Sin cambios de arquitectura**: cero nuevas consultas a Analytics desde
  la capa de render (`documentModel.ts`/`renderReportHtml.ts`/
  `renderReportExcel.ts` siguen consumiendo exclusivamente
  `ExecutiveReportSnapshotData`, tal como exige el FPS) — los únicos
  llamados nuevos a `predictionEngine.ts` viven en el builder
  (`buildSnapshotData.ts`), la única capa con mandato de tocar Analytics.
  Cero cambios a `analytics.ts`/`predictionEngine.ts`/Scores/Equilibrio
  Operativo.
- **Pendiente, no confundir con lo anterior**: los 3 escenarios de equipo
  (Esperado/Preventivo/Optimista) de la FPS Parte III siguen sin
  implementar — no existe un motor de síntesis a nivel de EQUIPO, solo por
  colaborador. Ver `docs/ROADMAP.md` § En desarrollo.
- Tests: +1 (`documentModel.test.ts`, escenario con datos predictivos
  reales, valida HTML + Excel). Suite completa: 1143/1143 en verde,
  `tsc`/`lint` limpios, `npm run build` exitoso (confirmadas las 3 rutas
  `/api/reports/executive/*` en el output).

## v1.22.0 — 2026-07-28

**Tipo:** FEATURE
**Módulo:** Executive Reporting Engine 2.0 (`src/lib/executiveReporting/`)

El Informe Mensual/de Rango pasa de "exportación de tablas con un bloque de
IA pegado" a un motor de reportes ejecutivos propio, independiente de
Analytics, construido en 5 fases (A-E) sobre una especificación funcional de
4 partes entregada por el usuario. Cero cambios al Analytics Engine ni a sus
fórmulas — el motor nuevo consume `analytics.ts`/`reportInsights.ts` tal
como están, nunca los modifica.

- **Fase A — Fundación** (`prisma/schema.prisma`, `src/lib/executiveReporting/{reportId,version,snapshotStore}.ts`):
  modelos `ExecutiveReportSnapshot`/`ExecutiveReportAuditLog` (migración
  100% aditiva), generador de Report ID (`NXR-YYYYMMDD-HHMMSS-XXXX`, huso de
  negocio, alfabeto sin caracteres ambiguos), auditoría best-effort.
- **Fase B — Builder unificado** (`buildSnapshotData.ts`, `snapshotData.ts`,
  `context.ts`, `filters.ts`, `resolveRoster.ts`, `periodStatus.ts`):
  `ExecutiveReportSnapshotData` como objeto de dominio único — se calcula
  UNA vez y alimenta Portada/Estado General/Detalle/Distribución/Insights/
  Assessment/Recomendaciones/Metadatos sin que ningún consumidor vuelva a
  tocar Prisma/Analytics. Las 3 rutas existentes (`generate`/`range`/
  `custom-range`) se reescriben para delegar en este builder — mismas
  fórmulas exactas, reubicadas, más `computeDataQuality` (antes ausente del
  reporte de equipo) y estado de período (`EN_CURSO`/`CERRADO`/`HISTORICO`).
  Fecha de corte real: acota consultas/carga por fecha y reconstruye el
  estado de cumplimiento "a la fecha de corte" vía `completedAt` (NEXO no
  lleva historial de `status` por tarea). `ExecutiveReportFilters` unificado
  (período/tipo/fecha de corte/roles/áreas/colaboradores) y `resolveReportRoster`
  reemplazan el filtro de roles duplicado en los 3 endpoints. Snapshot
  congelado (`Object.freeze` profundo) antes de devolverse — inmutabilidad
  real, no solo de tipo. `Recommendation`/`TeamRecommendation` ganan un
  `id` estable (para el enriquecimiento de NOVA).
- **Fase C — NOVA estructurado** (`nova/{types,confidence,prompts,fallbacks,generateNarrative,renderMarkdown}.ts`):
  reemplaza `buildAiAnalysis`/`buildRangeAiAnalysis` (1 llamada de texto
  libre a Groq, sin caché, en cada endpoint) por 4 llamadas paralelas
  estructuradas (Executive Summary/Insights/Assessment/Enriquecimiento de
  Recomendaciones), timeout por llamada (`Promise.race`, nunca bloquea la
  generación), fallback determinista garantizado por sección (nunca en
  blanco), y realineación estricta por `id` real en recomendaciones (Groq
  nunca puede inventar ni perder una). `renderNovaAsMarkdown` adapta las 4
  secciones al mismo bloque de texto que la UI actual ya sabe mostrar — cero
  regresión visible, mismo aviso de "configura GROQ_API_KEY" de siempre.
  Escenarios predictivos (5ª sección del FPS) quedan deliberadamente sin
  implementar — no existe aún un motor de predicción de equipo sobre el que
  narrar sin alucinar.
- **Fase D — Persistencia inmutable** (`api/reports/executive/{route,[reportId]/route,list/route}.ts`,
  `scripts/backfill-executive-report-snapshots.ts`): endpoint unificado de
  generación (`POST /api/reports/executive`), lectura inmutable por Report
  ID, historial paginado. Backfill de una sola corrida (dry-run por
  defecto, `--execute` con confirmación interactiva) migró los 4
  `MonthlyReport` históricos a `ExecutiveReportSnapshot`
  (`origin=LEGACY_MIGRATION`, `integrityFlag=PARTIAL` siempre — ningún
  reporte histórico registró calidad de dato/versiones/NOVA estructurado) —
  `MonthlyReport` no se modificó ni se borró.
- **Fase E — Documento de 11 páginas** (`documentModel.ts`,
  `renderReportHtml.ts`, `renderReportExcel.ts`): Portada, Executive
  Summary, Estado General del Equipo, Indicadores Estratégicos, Detalle por
  Colaborador, Distribución Operativa, Executive Insights, Executive
  Assessment by NOVA, Recomendaciones, Analytics Predictivo, Metadatos —
  orden fijo en un único lugar. Vista en pantalla y PDF comparten el mismo
  render a HTML (simplificación deliberada sobre el diseño original de dos
  sistemas de presentación paralelos). Integrado a `MonthlyReports.tsx` de
  forma ADITIVA — botones "PDF Ejecutivo 2.0"/"Excel Ejecutivo 2.0" nuevos,
  junto a los existentes, sin retirar ni modificar el flujo actual.
- **Pendiente, explícitamente diferido** (ver `docs/ROADMAP.md` § En
  desarrollo): repuntar `MonthlyReports.tsx`/`ReportWizardModal.tsx`/
  `wizardExport.ts` al endpoint unificado y retirar los renderers antiguos;
  escenarios predictivos de equipo.
- Tests: 82 tests nuevos a través de las 5 fases (`src/__tests__/executiveReporting/`,
  `src/__tests__/api/reports-executive.test.ts`) — Report ID, inmutabilidad,
  fecha de corte, roster/filtros, fallback de NOVA nunca en blanco,
  degradación por timeout/error/JSON malformado, no-alucinación de
  recomendaciones, orden fijo de páginas, escape anti-inyección en HTML.
  Suite completa: 1142/1142 en verde, `tsc`/`lint` limpios.

## v1.21.0 — 2026-07-28

**Tipo:** FEATURE
**Módulo:** Centro de Configuración NEXO (Sprint O)

Reemplaza el acordeón plano de `/settings` (`SettingsManager.tsx`, ~21
secciones + 6 bloques inline sin categorías, sin búsqueda, sin favoritos, sin
historial navegable ni restaurar-a-predeterminado) por un módulo organizado
(`ConfigCenter.tsx`) — sin cambiar la lógica de ninguna sección existente.

- **Arquitectura:** `src/lib/systemConfig.ts` (el almacén genérico
  `SystemConfigHistory` con auditoría por diseño, ya reutilizado por ~10
  dominios) sigue siendo la única fuente de verdad; este sprint construye la
  capa transversal que faltaba encima, no un nuevo mecanismo de storage.
- **Categorías:** Organización, Analytics, Trabajo, Proyectos, Escritorio
  Digital, Reportes, NOVA, Seguridad, Notificaciones, Parámetros Globales,
  Sistema — cada una de las ~21+6 secciones existentes se re-hospedó en su
  categoría vía `src/components/settings/registry.ts` (metadatos, no
  referencias a componentes) sin tocar su interior.
- **Extracciones:** los 6 bloques que vivían inline en `SettingsManager.tsx`
  (Consentimiento de datos, Gestión de contraseñas, Información del sistema,
  Configuración de Carga Laboral, Solicitudes de titulares, Política de
  retención) pasan a componentes propios (`DataConsentSection.tsx`,
  `PasswordManagementSection.tsx`, `SystemInfoSection.tsx`,
  `WorkloadConfigSection.tsx`, `DataRequestsSection.tsx`,
  `RetentionPolicySection.tsx`) — copy-paste 1:1, cero cambio de lógica.
  `SettingsManager.tsx` se elimina (no queda código muerto en paralelo).
- **Búsqueda global:** `searchSettings()` filtra el registro por
  label/description/keywords, insensible a mayúsculas/acentos (normalización
  extraída de `SectionCard.tsx` a `src/lib/textSearch.ts`, reutilizada por
  ambos). Sin API nueva — es filtrado client-side sobre un array estático.
- **Favoritos:** `src/lib/configFavorites.ts` reutiliza `User.viewPreferences`
  con prefijo `CONFIG_FAVORITE:`, el mismo patrón ya usado por el orden de
  tarjetas del Dashboard (`/api/dashboard/card-order`) — sin columna nueva.
- **Historial navegable:** `GET /api/settings/config-history?keys=...` lee
  `SystemConfigHistory` directamente — el dato ya existía (usuario, fecha,
  valor anterior por `setConfigValue`), solo faltaba una UI para verlo
  (`SettingHistoryModal.tsx`).
- **Restaurar predeterminado:** `POST /api/settings/config-history/restore-default`
  toma los valores de las constantes `DEFAULT_*`/`ANALYTICS_CONFIG_DEFAULTS`
  ya exportadas por `systemConfig.ts` (no se hardcodean dos veces).
- **9 valores nuevos configurables** (todos con default = comportamiento
  anterior exacto, mismo patrón `CONFIG_KEY_*`/`getEffective*`/`set*` que ya
  usan los ~10 dominios existentes, sin cambios de esquema):
  - Trabajo: ventana de registro retroactivo (`retroactive_window_business_days`,
    antes literal `2` en 4 sitios), hora de corte de jornada de Capacidad
    Proyectada (`capacity_workday_end_hour_local`, antes literal `17`).
  - Escritorio Digital: retención de archivado (`desk_archive_retention_days`,
    antes `15`), tope de respuestas (`desk_note_max_replies`, antes `2`),
    presets de posposición (`desk_reminder_snooze_presets_minutes`, antes
    array fijo `[15,30,60,1440]`).
  - NOVA: TTL de caché de mensajes generados (`nova_cache_ttl_minutes`, antes
    `4h` duplicado en `nova-message`/`nova-insights`).
  - Seguridad: longitud mínima de contraseña (`password_min_length`, antes
    `6` duplicado cliente/servidor — se eliminó el chequeo duplicado del
    cliente en `profile/page.tsx`, el servidor ya valida y muestra el error),
    duración de sesión (`session_duration_default_hours`/`_remember_hours`,
    antes `7d`/`30d` fijos — solo afecta sesiones nuevas), retención de
    intentos de login (`retention_login_attempts`, antes `30` fijo, hermano
    de las 3 claves de retención ya existentes).
- **Fix de bug real:** `src/app/(protected)/settings/page.tsx` permitía
  `ADMINISTRADOR` y `COORDINADOR_NACIONAL`, pero `SettingsManager.tsx`
  escondía todo detrás de un gate más estricto (`isAdmin`) — Coordinador
  Nacional veía una página vacía. El link de navegación (`navLinks.ts`) ya
  era Administrador-only: 2 de 3 fuentes ya coincidían, se corrigió la
  tercera.
- **Fuera de alcance (documentado, no construido a medias):** SLA/nivel de
  riesgo en Proyectos ("Sprint K"), plantillas/logo/portada/firmas y
  programación automática de Reportes ("Sprint F"), permisos especiales por
  usuario en Seguridad, prioridades/estados/tipos de tarea y días laborables
  como listas editables (enums de Prisma + riesgo de regresión en Analytics),
  idioma/moneda en Parámetros Globales (sin consumidor real en un sistema de
  RRHH sin i18n) — cada uno con su propia tarjeta "Próximamente" en la UI y
  entrada en `docs/ROADMAP.md`.
- **Archivos:** `src/lib/systemConfig.ts` (9 pares nuevos),
  `src/lib/configFavorites.ts`, `src/lib/textSearch.ts`,
  `src/lib/settingsCategories.ts`, `src/lib/retroactiveWindow.ts`,
  `src/components/settings/{ConfigCenter,CategoryNav,SearchBox,
  FavoritesSection,ConfigSectionCard,registry,ProximamenteCard,
  GlobalParamsSection}.tsx`, `src/components/settings/history/*`,
  7 secciones extraídas + 4 secciones nuevas agrupadas
  (`TrabajoAvanzadoSection`, `EscritorioDigitalConfigSection`,
  `NovaCacheSection`, `SeguridadConfigSection`), 9 rutas API nuevas bajo
  `/api/settings/*`, `src/lib/capacityForecast.ts`/`deskNoteRetention.ts`/
  `session.ts`/`rate-limit.ts`/businessTime call sites (switch a los nuevos
  getters), `src/app/(protected)/settings/page.tsx`,
  `src/components/desk/ReminderCard.tsx`/`RemindersPanel.tsx`,
  `src/components/tasks/RetroactiveActivityModal.tsx`,
  `src/components/projects/ProjectActivitiesTab.tsx`.
- **Impacto:** el Administrador puede adaptar 9 comportamientos más de la
  plataforma sin tocar código, con auditoría e historial ya visibles; sin
  configurar nada, el sistema se comporta exactamente igual que antes (todos
  los defaults igualan el literal que reemplazan). Sin migración de datos.
- **Autor:** Claude Code

---

## v1.20.1 — 2026-07-28

**Tipo:** FIX
**Módulo:** Analytics/KPIs — indicador "Carga Laboral"

Corrige el indicador "Carga Laboral" mostrado en `/api/kpis/[userId]` y
`/api/kpis/me` (consumido por `KpisModule.tsx`/`MyKpisModule.tsx`: SummaryCard,
DonutChart y exportables PDF/Excel) — usaba una fuente de datos completamente
distinta a la del resto de Analytics para el mismo período, mostrando dos
números de "Carga laboral" incompatibles en la misma pantalla (reportado por
el usuario 2026-07-28: 113.28h/206.18h/55% en el indicador vs. 135.49h/
140-165h/Moderado en WorkloadCard, ya validado).

- **Causa raíz:** `cargaLaboral.{estimatedHours,realHours,ratio}` se calculaba
  sumando `Task.estimatedHours`/`Task.realHours` crudos de las tareas con
  `endDate` en el período (`computeEstimatedVsRealRatio`) — un ratio de
  precisión de estimación, sin relación con la Base Horaria Efectiva (días
  hábiles × horas efectivas configuradas, Sprint Analytics 2.1) que
  `computeCargaTiempo`/`cargaTiempo.mensual` ya calcula y que WorkloadCard
  (misma pantalla) y el resto de Analytics usan como fuente validada.
- **FIX:** `cargaLaboral` ahora lee directamente de `cargaTiempo.mensual`
  (mismo objeto ya calculado y enviado al frontend como `cargaTiempo`) —
  `estimatedHours` pasa a contener `mensual.baseHours`, `realHours` a
  `mensual.realHours`, `ratio` a `mensual.pct`; el color se deriva de
  `mensual.color` (5 zonas `WorkloadColor`) con `orange` colapsado a
  `yellow` (único mapeo posible a `KpiColor`, 3 zonas).
- **Delta mes anterior (`prevMonth.cargaRatio`):** recalculado con el mismo
  criterio (`businessBaseForRange` + horas reales FIJA/`TaskActivity` del mes
  anterior, mismo patrón que `reports/custom-range/route.ts`) para que el
  badge de tendencia compare el mismo tipo de dato mes a mes — antes de este
  fix habría quedado comparando el nuevo % (Base Horaria Efectiva) contra el
  ratio antiguo (estimado-vs-real) de un mes distinto.
- **Fuera de alcance (a propósito):** el ratio estimado-vs-real
  (`computeEstimatedVsRealRatio`) se conserva sin cambios como único input del
  Score básico (`computeSimpleScore`) — no es el indicador reportado, y
  tocar su fórmula queda fuera de este fix (ver inconsistencia ya documentada
  en `docs/ROADMAP.md` sobre `computeEstimatedVsRealRatio` vs
  `computeTargetTimePrecision`). Cero cambios a `src/lib/analytics.ts`
  (Analytics Engine), Equilibrio Operativo, Analytics Predictivo, Reportes ni
  Dashboard.
- **Archivos:** `src/app/api/kpis/[userId]/route.ts`,
  `src/app/api/kpis/me/route.ts` (fuente de datos + delta mes anterior),
  `src/components/kpis/KpisModule.tsx`, `src/components/kpis/MyKpisModule.tsx`
  (etiquetas "Tiempo objetivo"/"est." → "Horas base", ahora coherentes con el
  dato que muestran), `src/__tests__/api/kpis-me-userid.test.ts` (fixture
  `CargaTiempo` tipado completo, 2 tests actualizados a la nueva fuente, 1
  test nuevo de regresión).
- **Impacto:** el número de "Carga Laboral" que ve cualquier colaborador o su
  jerarquía en Analytics/KPIs ahora coincide con el de WorkloadCard/Equilibrio
  Operativo para el mismo período — elimina la contradicción visible en la
  misma pantalla. Sin migración de datos (cálculo en tiempo real, no
  persistido).
- **Autor:** Claude Code

---

## v1.20.0 — 2026-07-26

**Tipo:** FIX / ANALYTICS
**Módulo:** Motor Determinista de Recomendaciones — Compatibilidad Organizacional

Corrige `computeTeamRecommendations` (motor determinista de redistribución
de carga, §S3-A) para que respete la estructura organizacional de NEXO —
antes optimizaba solo por disponibilidad/carga, pudiendo sugerir
redistribuciones entre cargos jerárquicamente incompatibles (ej. Asistente →
Coordinador). Sin cambios a cálculos de carga laboral, KPIs, ni al resto del
Analytics Engine — ver `docs/AUDIT_LOG.md` § 2026-07-26.

- **FIX — Regla 1 (redistribución horizontal):** el mismo cargo siempre se
  prioriza como destino, aunque exista un cargo compatible con más capacidad
  disponible.
- **FEATURE — Matriz de Compatibilidad Operativa (Regla 2/3):** nueva
  configuración en Ajustes → Analytics → Compatibilidad Operativa (solo
  roles con gestión de usuarios) — qué cargos ADICIONALES del mismo nivel
  jerárquico pueden recibir redistribución cuando no hay nadie disponible del
  mismo cargo. `getEffectiveRoleCompatibility`/`setRoleCompatibility`
  (`src/lib/systemConfig.ts`), `GET/PATCH /api/settings/role-compatibility`.
  Vacía por defecto — sin configurar, solo el mismo cargo redistribuye.
- **FIX — Regla 4 (prohibición vertical), filtro absoluto:** nunca se
  sugiere redistribución entre niveles jerárquicos distintos —
  `ROLE_LEVEL` (`roles.ts`) filtra los candidatos ANTES de consultar la
  matriz, y `PATCH /api/settings/role-compatibility` rechaza con 400 (400,
  no solo advertencia) cualquier intento de configurar un par de niveles
  distintos. Defensa en profundidad, no una sola capa de protección.
- **FIX — Regla 5 (sin candidato):** cuando no existe un colaborador
  compatible con capacidad disponible, el motor devuelve el mensaje "No
  existe actualmente un colaborador compatible para redistribuir esta carga
  operativa (nombre)" en vez de omitir silenciosamente o sugerir algo
  incorrecto (`TeamRecommendation.hasCandidate: false`).
- **UI:** `TeamWorkloadCards.tsx` (`RecommendationItem`) muestra el mensaje
  de Regla 5 sin la línea de "impacto esperado" (no aplica cuando no hay
  redistribución real); nueva sección `RoleCompatibilitySection.tsx`.

**Archivos:** `src/lib/analytics.ts` (`computeTeamRecommendations`,
`TeamRecommendation`), `src/lib/systemConfig.ts`,
`src/app/api/settings/role-compatibility/route.ts`,
`src/app/api/analytics/recommendations/team/route.ts`,
`src/components/settings/RoleCompatibilitySection.tsx`,
`src/components/SettingsManager.tsx`, `src/components/kpis/TeamWorkloadCards.tsx`,
`src/__tests__/team-recommendations-compatibility.test.ts`,
`src/__tests__/api/role-compatibility.test.ts`.

**Impacto:** las recomendaciones de redistribución que ya se mostraban en
`/team` (Recomendaciones — motor determinista) ahora solo sugieren
movimientos operativamente viables; en equipos donde nadie es compatible con
un colaborador sobrecargado, se informa en vez de sugerir algo incorrecto.
`npx tsc --noEmit` (2 errores preexistentes no relacionados), `npm run lint`
(0 errores), `npx vitest run` (1039/1039), `npm run build` limpio.

**Autor:** Claude Code

---

## v1.19.0 — 2026-07-26

**Tipo:** FEATURE / ANALYTICS
**Módulo:** Sprint E — Analytics Predictivo e Inteligencia Preventiva

Nuevo motor predictivo, 100% determinístico (sin IA generativa), construido
como capa aislada sobre el Analytics Engine existente — **cero cambios** a
`analytics.ts`/`capacityForecast.ts`/`workload.ts`/`computeAlerts`/
`riskAlerts.ts` ni a ninguna UI de Dashboard/Analytics(KPIs)/Reportes/
Proyectos/Equipo. Vive en un módulo nuevo y autónomo,
`/inteligencia-preventiva` — la integración profunda en esas pantallas
queda para un sprint futuro (ver `docs/ROADMAP.md`). Decisiones completas en
`docs/AUDIT_LOG.md` § 2026-07-26 (Sprint E).

- **FEATURE — Trend Engine (`src/lib/trendEngine.ts`):** detecta dirección
  (positiva/negativa/estable/variable/cambio brusco) de 8 indicadores
  (Cumplimiento, Productividad, Horas registradas, Consistencia Operativa,
  Capacidad Disponible, Equilibrio Operativo, Proyectos, Actividades) sobre
  la ventana histórica configurada — regresión OLS + CV de residuos
  (variabilidad neta de tendencia, no dispersión cruda). "Consultas" queda
  fuera de alcance (sin fuente de datos — ver `docs/ROADMAP.md`).
- **FEATURE — Ventana Histórica de Predicción configurable (Bloque 2):**
  nuevo parámetro global en Ajustes → Configuración Predictiva (3/4/6/8/12
  semanas, default 3, solo Administrador) — `src/lib/predictiveConfig.ts`,
  `GET/PUT /api/settings/prediction-window`.
- **FEATURE — 4 predicciones explicables (`src/lib/predictionEngine.ts`):**
  Proyección de Cumplimiento (variación esperada vs. promedio de la
  ventana), Predicción de Sobrecarga (probabilidad + nivel), Predicción de
  Subutilización (vista de equipo, batch), Predicción de Retrasos (tareas y
  proyectos, 3 factores: Sobrecarga/Baja consistencia/Retrasos recientes).
  Cada una expone horizonte fijo (7/15/30/90 días), nivel de confianza y
  confiabilidad del histórico como ejes explícitamente distintos, y
  explicación de 4 partes (qué ocurrirá, por qué, qué datos, qué acciones).
- **FEATURE — Estabilidad Operativa (Bloque 10):** nuevo indicador,
  exclusivamente predictivo — clasifica la variabilidad conjunta de los 8
  indicadores del Trend Engine (Muy Alta/Alta/Media/Baja/Muy Baja). No
  modifica ningún KPI existente.
- **FEATURE — Inteligencia Preventiva (`src/lib/preventiveIntelligence.ts`):**
  alertas priorizadas 🔴 Acción inmediata / 🟠 Atención / 🟡 Seguimiento /
  🟢 Sin riesgo, individuales y de equipo — separada de `computeAlerts` (motor
  de 8 reglas) y de `riskAlerts.ts` (vestigial), ninguno de los dos tocado.
- **FEATURE — Simulador de Escenarios (Bloque 8):** 5 escenarios (agregar
  horas, cerrar tareas, redistribuir carga, modificar tiempo objetivo,
  agregar participantes) — nunca persiste nada. Los 2 primeros reutilizan
  `/api/analytics/simulate/[userId]` tal cual (sin modificarlo); los otros 3
  son rutas nuevas (`/api/predictive/simulate/**`) porque no encajan en el
  contrato de usuario único de esa ruta protegida, reutilizando sus mismas
  funciones puras exportadas.
- **FEATURE — Tendencias Históricas (Bloque 9):** gráficos de evolución con
  ventanas independientes de la configuración global (3/4/8 semanas, 3/6
  meses, 1 año) para 8 indicadores — reutiliza `recharts`/`useChartTheme`
  ya usados en KPIs, sin nueva dependencia.
- **UI — módulo nuevo:** `/inteligencia-preventiva`
  (`src/components/inteligencia-preventiva/`), entrada de navegación en la
  sección "Inteligencia" existente (junto a Nova). Visibilidad
  individual/equipo compuesta con los mismos predicados que ya separan
  `/my-kpis` de `/kpis` (`isExecutorRole`/`canViewTeam`) — sin gate de
  navegación nuevo.

**Fix incidental descubierto durante el propio desarrollo (no en
producción):** el clasificador de "cambio brusco" del Trend Engine
originalmente comparaba el último punto contra la media plana de los
anteriores, generando un falso positivo en cualquier tendencia fuerte y
perfectamente lineal; corregido para comparar contra el residuo de la recta
de regresión (ver `docs/ANALYTICS_FORMULAS.md` §16).

**Archivos:** `src/lib/{trendEngine,predictionEngine,preventiveIntelligence,predictiveConfig}.ts`,
`src/lib/systemConfig.ts` (nueva clave `prediction_window_weeks`),
`src/app/api/predictive/**` (9 rutas nuevas), `src/app/api/settings/prediction-window/route.ts`,
`src/components/settings/PredictionWindowSection.tsx`, `src/components/SettingsManager.tsx`,
`src/app/(protected)/inteligencia-preventiva/page.tsx`,
`src/components/inteligencia-preventiva/**` (9 archivos), `src/lib/navLinks.ts`,
`src/__tests__/{trendEngine,predictionEngine,predictiveConfig}.test.ts`,
`src/__tests__/api/predictive-{settings,auth,simulate}.test.ts`, `src/__tests__/navLinks.test.ts` (extendido).

**Impacto:** ningún cambio de comportamiento para usuarios existentes de
Dashboard/KPIs/Reportes/Proyectos/Equipo. Usuarios autenticados ganan acceso
a un nuevo módulo de predicción/prevención, con visibilidad individual/equipo
compuesta por rol. `npx tsc --noEmit` (2 errores preexistentes no
relacionados), `npm run lint` (0 errores), `npx vitest run` (1026/1026),
`npm run build` limpio.

**Autor:** Claude Code

---

## v1.18.1 — 2026-07-26

**Tipo:** FIX
**Módulo:** Registro retroactivo de actividades (Seguimiento y Proyectos)

Amplía la ventana de registro retroactivo para incluir el fin de semana
inmediato anterior, sin tocar la regla base de 2 días laborables (48 horas
hábiles). Antes, el sábado y domingo previos quedaban fuera de la ventana
retroactiva de forma permanente; ahora están disponibles hasta el martes
siguiente (inclusive) y desaparecen automáticamente a partir del miércoles.

- **FIX — motor único de validación (`src/lib/businessTime.ts`):** nuevas
  funciones `weekendGraceDays(today)` (devuelve sábado/domingo del fin de
  semana inmediato anterior, solo si `today` es lunes o martes) y
  `retroactiveValidDates(today, count)` (combina `previousBusinessDays` +
  `weekendGraceDays`, orden más reciente primero). `previousBusinessDays`
  no se modificó — la regla de 2 días hábiles queda intacta.
- Los 4 puntos de la plataforma que calculaban la ventana retroactiva de
  forma independiente ahora llaman a `retroactiveValidDates` en vez de
  `previousBusinessDays` directamente: `RetroactiveActivityModal.tsx`
  (tareas de Seguimiento), `ProjectActivitiesTab.tsx` (Proyectos), y sus
  dos rutas de API correspondientes (`POST /api/tasks/[id]/activities/
  retroactive`, `POST /api/projects/[id]/activities`) — sin duplicar
  lógica de fechas entre cliente y servidor.
- **Alcance deliberado — Tareas Fijas quedan fuera:** el pedido original
  mencionaba Tareas Fijas como parte del alcance, pero Fija nunca tuvo
  registro retroactivo (decisión explícita del sprint de unificación del
  2026-07-21, ver `docs/DECISIONS.md`) — solo registra "hoy" vía
  `ActivityPanel`. Confirmado con el usuario antes de implementar: no se
  agrega retroactivo a Fija en este cambio: ver `docs/AUDIT_LOG.md` §
  2026-07-26.
- No se tocó Analytics, KPIs, Auditoría, historial de actividades, ni el
  cálculo de horas — la única superficie de cambio es qué fechas son
  seleccionables/aceptadas para un registro retroactivo.

**Archivos:** `src/lib/businessTime.ts`,
`src/components/tasks/RetroactiveActivityModal.tsx`,
`src/components/projects/ProjectActivitiesTab.tsx`,
`src/app/api/tasks/[id]/activities/retroactive/route.ts`,
`src/app/api/projects/[id]/activities/route.ts`,
`src/__tests__/businessTime.test.ts` (tests nuevos para
`weekendGraceDays`/`retroactiveValidDates`, cubriendo los 7 días de la
semana según la tabla del pedido).

**Impacto:** colaboradores pueden registrar horas del sábado/domingo
inmediato anterior hasta el martes siguiente; miércoles en adelante la
ventana vuelve a ser exactamente la de antes (2 días hábiles). Sin cambios
para tareas Fijas.

**Autor:** Claude Code

---

## v1.18.0 — 2026-07-24

**Tipo:** FEATURE / ANALYTICS
**Módulo:** Sprint Analytics 2.1 — Mejora del Reporte Ejecutivo y Calidad de la Comparabilidad

Fortalece el Informe Consolidado (`/kpis` → Informes) construido en Sprint
Reportes Ejecutivos 2.0: comparabilidad correcta entre colaboradores
(Base Horaria Efectiva), un asistente de configuración antes de generar
(Generador Inteligente de Reportes), y dos columnas nuevas por colaborador
(Estado Operativo, Principal Hallazgo). **No modifica el Analytics Engine**
(`src/lib/analytics.ts`) ni ninguna fórmula/peso/KPI existente — todo lo
nuevo reutiliza cálculos ya hechos por `analytics.ts`/`workload.ts` o los
compone en `reportInsights.ts`. Ver `docs/AUDIT_LOG.md` § Sprint Analytics
2.1 para el detalle de decisiones y `docs/DECISIONS.md` para el índice.

- **FEATURE — Base Horaria Efectiva (Bloque 1):** la base horaria de cada
  colaborador en el informe ya no asume el período completo — se recorta al
  tramo `[max(inicio del período, inicio efectivo del colaborador),
  fin del período]`, reutilizando `computeEffectiveHistoryStart`
  (`analytics.ts`, ya usado por Consistencia desde el Analytics Engine
  v1.3.1: cruza `kpiStartDate`/primera actividad/primera tarea completada/
  primera imputación de horas/`createdAt`, la señal más reciente gana).
  Nueva función `computeEffectiveMemberBases` (`reportInsights.ts`) y
  `businessBaseForRange` (`workload.ts`, generalización de
  `monthlyBusinessBase` a fechas arbitrarias). Para informes de rango
  (trimestre/semestre/año/personalizado) se usa la tarifa vigente al inicio
  del rango completo, no mes a mes — simplificación deliberada, ver
  `docs/AUDIT_LOG.md`.
- **UX — nota informativa de Base Horaria Efectiva (Bloque 2):**
  `BaseEfectivaNote` en `MonthlyReports.tsx`, visible solo cuando algún
  colaborador del informe tiene su base recortada; cada fila afectada se
  marca con `*` en la tabla y en las exportaciones PDF/Excel.
- **UX — nueva visualización de horas (Bloque 3):** la columna "Horas
  (real/base)" pasa de `126.0h/149.3h` a `126.0h / 149.3h` + `84%` en dos
  líneas (`HorasCell`), tanto en pantalla como en PDF/Excel.
- **FEATURE — Generador Inteligente de Reportes (Bloques 4-8):** nuevo
  asistente (`ReportWizardModal.tsx`) antes de exportar — selección de
  colaboradores (checkboxes + 6 filtros rápidos: todos/mi equipo/con
  actividad/con riesgo operativo/destacados/activos), selección de período
  (7 presets: mes actual, mes anterior, últimos 30 días, trimestre,
  semestre, año, rango personalizado), selección de secciones (10
  bloques activables) y formato de exportación (PDF Ejecutivo — versión
  condensada fija para dirección; PDF Completo; Excel). Nuevo endpoint
  `GET /api/reports/custom-range` para los presets de fecha arbitraria
  (últimos 30 días/rango personalizado, día-granularidad, no calzan con
  límites de mes calendario); los presets de mes completo reutilizan
  `/api/reports/generate` y `/api/reports/range` ya existentes (ambos ahora
  aceptan `userIds` opcional). Nuevo módulo `src/components/kpis/reports/
  wizardExport.ts` normaliza las 3 formas de datos (mes/rango de
  meses/rango de fechas) y arma la exportación sin recalcular ningún KPI.
- **FEATURE — Estado del Colaborador (Bloque 9):** columna nueva en la
  tabla de detalle (🟢 Equilibrio Óptimo / 🔵 Equilibrio Estable / 🟡
  Requiere Atención / 🟠 Riesgo Operativo / 🔴 Desequilibrio Crítico).
  Reutiliza literalmente `classifyEstadoOperativo` (`analytics.ts`): con el
  Equilibrio Operativo real cuando el informe es del mes calendario en
  curso, o una aproximación derivada de cumplimiento/carga/vencidas para
  cualquier otro período (mismo criterio que el Índice Ejecutivo — Capacidad
  Futura no es representativa para un período ya cerrado, ver
  `docs/DECISIONS.md` § Sprint Reportes Ejecutivos 2.0). Nueva función
  `deriveEstadoOperativo` en `reportInsights.ts`.
- **FEATURE — Principal Hallazgo (Bloque 10):** columna nueva, reglas fijas
  sin IA (`computePrincipalHallazgo`, `reportInsights.ts`) sobre carga,
  cumplimiento, vencidas y consistencia (esta última solo cuando está
  disponible, mes en curso): Sobrecarga → Subutilización → Retrasos
  recurrentes → Consistencia baja → Sin tareas vencidas → Carga equilibrada.
- **FEATURE — Interpretación de Consultas en informes de rango (Bloque
  11):** los informes de rango (`/api/reports/range`,
  `/api/reports/custom-range`) ahora calculan tendencia por motivo vs. un
  "período anterior equivalente" (misma duración en días, terminando el día
  previo al inicio del rango) — nueva función `previousEquivalentPeriod`
  (`reportInsights.ts`). Antes solo el informe de un mes tenía tendencia
  (cierra el ítem pendiente de `docs/ROADMAP.md` § Sprint Reportes
  Ejecutivos 2.0, Bloque 6).
- **FEATURE — preparación de arquitectura para Comparación de Equipos
  (Bloque 12):** `src/lib/teamComparison.ts` — tipos y función placeholder
  (`computeTeamComparison`, no implementada). Sin cambios de schema (NEXO no
  tiene hoy un campo de área/equipo/zona en `User`) y sin UI — solo deja
  preparada la forma de los datos para un sprint futuro.
- **PERFORMANCE — paridad Excel/PDF:** `downloadReportExcel`/
  `downloadRangeExcel` (`MonthlyReports.tsx`) ganan las hojas que solo
  existían en PDF desde Sprint Reportes Ejecutivos 2.0 (Índice Ejecutivo,
  Hallazgos y Recomendaciones, Mapa de Riesgo, Tendencias e Insights) y las
  columnas Estado/Principal Hallazgo/Base prorrateada; el PDF de rango gana
  una tabla "Detalle por Colaborador" que antes solo existía en Excel.

**Archivos afectados:** `src/lib/workload.ts` (`businessBaseForRange`,
`sumWeightedLimit` exportado), `src/lib/reportInsights.ts`
(`computeEffectiveMemberBases`, `deriveEstadoOperativo`,
`computePrincipalHallazgo`, `previousEquivalentPeriod`), `src/lib/
teamComparison.ts` (nuevo), `src/app/api/reports/generate/route.ts`,
`src/app/api/reports/range/route.ts`, `src/app/api/reports/custom-range/
route.ts` (nuevo), `src/components/kpis/types.ts`, `src/components/kpis/
MonthlyReports.tsx`, `src/components/kpis/reports/ReportWizardModal.tsx`
(nuevo), `src/components/kpis/reports/wizardExport.ts` (nuevo),
`src/__tests__/api/reports.test.ts` (mocks ampliados para las nuevas
dependencias de Prisma).

**Impacto:** los informes ejecutivos comparan colaboradores de forma justa
sin importar cuándo empezaron a usar NEXO, permiten generar exactamente el
informe que Coordinadores/Jefe Nacional/Gerencia necesitan (colaboradores,
período y secciones a medida) en 3 formatos, y cada colaborador muestra un
estado operativo y un hallazgo principal identificables de un vistazo —
mejora directa de interpretación y toma de decisiones sin tocar ningún
cálculo del Analytics Engine.

**Autor:** Claude Code

---

## v1.17.0 — 2026-07-24

**Tipo:** FEATURE / ANALYTICS
**Módulo:** Sprint Reportes Ejecutivos 2.0 — Inteligencia Organizacional en el Informe Consolidado

Transforma el Informe Mensual Consolidado (`/kpis` → Informes) de una
exportación de tablas a un informe ejecutivo: primera página de resumen,
hallazgos y recomendaciones generados por reglas (nunca IA), interpretación
por indicador, visualizaciones (recharts), mapa de riesgo, tendencias
automáticas e Índice Ejecutivo del Equipo. **No modifica el Analytics
Engine** (`src/lib/analytics.ts`) ni ninguna fórmula/peso existente — todo
lo nuevo es una capa de composición sobre datos que el motor ya calcula.
Ver `docs/AUDIT_LOG.md` § Sprint Reportes Ejecutivos 2.0 para el detalle de
decisiones y `docs/DECISIONS.md` para el índice.

- **FEATURE — nuevo módulo `src/lib/reportInsights.ts`:** motor de
  interpretación de reportes, 100% determinístico (mismo principio que
  `insightsEngine.ts`, a nivel de equipo en vez de individuo):
  `classifyIndiceEjecutivo`, `computeTeamMonthlySnapshots`,
  `computeTrendComparisons`, `computeRiskQuadrant`,
  `explainMotivoDistribution`, `computeFindings`, `computeRecommendations`,
  `computeTeamInsights`, `explainCumplimientoIndicator`/
  `explainCargaIndicator`/`explainConsultasIndicator`.
- **FEATURE — Resumen Ejecutivo (Bloque 1):** primera sección del informe —
  score y estado del Índice Ejecutivo, variación vs. informe anterior,
  riesgos críticos, alertas, personas destacadas y en riesgo, todo en una
  sola pantalla (`ExecutiveSummarySection.tsx`).
- **FEATURE — Índice Ejecutivo del Equipo (Bloque 11):** promedio de
  Performance Score + Equilibrio Operativo por miembro, clasificado en 4
  niveles (Excelente/Bueno/Atención/Crítico). Disponible **solo cuando el
  informe es del mes calendario en curso** — Capacidad Futura (parte de
  Equilibrio Operativo) es una proyección hacia adelante, no representativa
  para un mes pasado; en informes de meses históricos se muestra una nota
  explicativa en su lugar.
- **FEATURE — Hallazgos Automáticos y Recomendaciones Ejecutivas (Bloques
  2 y 3):** reglas fijas sobre datos ya calculados (variación de
  cumplimiento, colaboradores subutilizados/sobrecargados, tareas
  vencidas, motivo dominante) — explícitamente sin IA, coexistiendo con el
  bloque "Análisis IA" (Groq) ya existente, que se mantiene intacto como
  lectura complementaria.
- **FEATURE — Mapa de Riesgo (Bloque 8):** matriz Cumplimiento×Carga
  (`RiskMatrixChart.tsx`, `ScatterChart` de recharts), un punto por
  colaborador, 4 cuadrantes.
- **FEATURE — Tendencias automáticas (Bloque 9):** comparación del
  cumplimiento del equipo vs. mes anterior/trimestre/semestre
  (`TrendsSection.tsx`), vía `computeTeamMonthlySnapshots` — seguro para
  cualquier mes (sin Capacidad Futura).
- **FEATURE — Insights (Bloque 10):** observaciones automáticas tipo
  "X concentró el N% del tiempo ejecutado" (`TeamInsightsSection.tsx`).
- **ANALYTICS — Distribución por Motivo enriquecida (Bloque 6):** cada
  motivo ahora muestra % del total, tendencia vs. período anterior (solo
  en el informe de un mes) e interpretación generada por reglas.
- **UI — Interpretación por indicador (Bloque 5):** Cumplimiento/Carga/
  Consultas del equipo ahora responden qué significa/por qué/impacto/
  acción (`IndicatorInterpretation.tsx`).
- **UI — Ranking visual y exportación PDF:** el ranking ya usaba tarjetas
  con barra de progreso (no tabla); la exportación PDF/impresión
  (`downloadReportPDF`/`downloadRangePDF`) se amplió con las mismas
  secciones nuevas en formato texto/tabla.
- **Archivos nuevos:** `src/lib/reportInsights.ts`,
  `src/components/kpis/reports/{ExecutiveSummarySection,FindingsSection,
  RecommendationsSection,RiskMatrixChart,TrendsSection,
  TeamInsightsSection,IndicatorInterpretation}.tsx`.
- **No modifica** `src/lib/analytics.ts`, ningún peso/fórmula/rol/permiso
  existente. Verificación: `tsc --noEmit` (2 errores preexistentes sin
  relación), `eslint .` limpio (3 warnings preexistentes sin relación),
  `vitest run` 962/962 (936 previos + 26 nuevos), `next build` exitoso.

---

## v1.16.0 — 2026-07-24

**Tipo:** ANALYTICS / FEATURE
**Módulo:** Sprint Analytics 2.0 — Inteligencia Explicable e Interpretación Ejecutiva

Revive `computeHealthScore` (congelado desde Sprint 5 §S5-A) como indicador
estrella bajo el nombre **Equilibrio Operativo** y le agrega una capa
completa de explicabilidad automática — cada resultado ahora responde
automáticamente 4 preguntas: ¿qué significa?/¿por qué?/¿qué impacto
tiene?/¿qué puedo hacer? Ver `docs/AUDIT_LOG.md` § Sprint Analytics 2.0 para
el detalle completo de decisiones y `docs/ANALYTICS_FORMULAS.md` §3 para la
referencia técnica.

- **ANALYTICS — rename de marca "Score de Salud Laboral" → "Equilibrio
  Operativo":** todo texto visible al usuario (tarjetas, tooltips,
  `ExplainModal`, narrativas de Nova, Ajustes) y la prosa de documentación
  técnica. **Deliberadamente no renombrado:** los símbolos de código
  (`computeHealthScore`/`HealthScoreResult`/`HealthFactor`) ni el valor
  persistido `AnalyticsAuditLog.kind = "health_score"` (miles de filas
  históricas) — ver `docs/DECISIONS.md`.
- **FEATURE — nueva identidad visual:** la tarjeta ahora siempre muestra
  score + Estado Operativo (5 niveles: 🟢 Equilibrio Óptimo / 🔵 Equilibrio
  Estable / 🟡 Requiere Atención / 🟠 Riesgo Operativo / 🔴 Desequilibrio
  Crítico) + tendencia + variación vs. hace 30 días, con la escala completa
  de interpretación siempre visible (no en un modal).
- **FEATURE — motor de interpretación automática, 100% determinístico (sin
  IA):** nuevas funciones en `insightsEngine.ts`
  (`computeEquilibrioInsights`/`explainEquilibrioFactor`/
  `explainEquilibrioMeaning`/`explainEquilibrioImpact`) generan, sobre las 5
  dimensiones ya calculadas: párrafo de significado, explicación por
  dimensión, fortalezas reales, aspectos a mejorar (con motivo),
  narrativa de impacto operativo y recomendaciones basadas en reglas fijas
  por dimensión — nunca texto generado por IA.
- **ANALYTICS (único cambio de fórmula) — normalización progresiva de
  Capacidad Futura:** `capacityToScore` reemplaza el salto abrupto anterior
  (cualquier sobrecarga proyectada caía a 0) por una curva lineal
  (`score = 100 + 2×disponiblePct`, acotada a [0,100]) activada por
  `estado === "sobrecarga"`. `FORMULA_VERSIONS.capacidadDisponible`/
  `equilibrioOperativo` → `"1.1"`; `FORMULA_SET_VERSION` `4.3` → `4.4`.
  Afecta solo a usuarios con capacidad futura negativa proyectada.
- **ANALYTICS — auto-explicación de Consistencia "Variable"/"Muy variable":**
  nuevo campo `ConsistencyResult.explain.impactNote` con la frase de impacto
  cualitativo ("...reduciendo la estabilidad operativa" / "...afectando
  significativamente la previsibilidad operativa").
- **ANALYTICS — calidad del cálculo ampliada:** el detalle de cálculo de
  Equilibrio Operativo (`GET /api/analytics/equilibrio/[userId]`, nuevo)
  ahora expone también tiempo de procesamiento, registros utilizados/
  descartados y advertencias, además de calidad del dato/confiabilidad/
  versión/fecha/origen que ya existían.
- **Archivos nuevos:** `src/app/api/analytics/equilibrio/[userId]/route.ts`,
  `src/components/kpis/EquilibrioOperativoCard.tsx`.
- **No modifica** ningún otro KPI, peso, rol ni permiso existente — la única
  fórmula tocada es la descrita arriba (autorizada explícitamente por el
  alcance del sprint). Verificación: `tsc --noEmit` (2 errores preexistentes
  sin relación), `eslint .` limpio (3 warnings preexistentes sin relación),
  `vitest run` 936/936 (919 previos + 17 nuevos), `next build` exitoso.

---

## v1.15.1 — 2026-07-24

**Tipo:** UX / ANALYTICS (calidad del dato) / DOCUMENTATION
**Módulo:** Sprint D (continuación) — UX, Calidad del Dato ampliada, validación de efectos secundarios

Versión más detallada del mismo Sprint D (v1.15.0, entrada siguiente) —
cubre Bloque 7 (UX, con hallazgos reales de una auditoría dedicada),
Bloque 5 ampliado (2 verificaciones nuevas), y un Bloque 11 nuevo
(validación de efectos secundarios). Ver `docs/AUDIT_LOG.md` § Sprint D
(continuación) para el detalle completo.

- **UX (10 fixes, solo markup, cero cambio de comportamiento):** `Spinner`
  compartido en 18 archivos (Reuniones/Perfil/Nova/KPIs/Desk/Ajustes);
  `aria-label` en ~19 modales sin `Modal`/`ModalHeader`; `EmptyState`
  deduplicado en Proyectos y Nova (copias idénticas ya existentes en otros
  archivos); tabla LOPDP de Perfil envuelta en `overflow-x-auto`; `Button`
  compartido migrado en Ideas/Reuniones/Proyectos (17 botones); radio de
  banners de error normalizado a `rounded-lg`; ícono de cierre normalizado
  a `w-4 h-4`; padding de tarjeta normalizado a `p-4` en Ideas/Reuniones.
- **Calidad del Dato — 2 verificaciones nuevas:** actividades con
  `TaskActivity.reason` que no existe en el catálogo de `ActivityReason`
  (motivo huérfano — `reason` es un String libre, no una FK real);
  registros con `isRetroactive`/`activityDate` internamente inconsistentes.
  Se extendió también el chequeo "sin propietario" a
  `ProjectParticipant.userId`.
- **Validación de efectos secundarios (nuevo, informe en AUDIT_LOG):**
  confirmado por `git diff` que ningún cambio de v1.15.0 ni de esta
  versión tocó `analytics.ts`/`capacityForecast.ts`/`workload.ts`/
  `priorityCompliance.ts`/`normalizationEngine.ts`/`prisma/schema.prisma`
  ni `projectHistory.ts`; los 22 call sites de `invalidateAnalyticsCache()`
  previos siguen intactos (+2 nuevos, cero remociones); las funciones de
  recálculo de horas son extracciones literales, sin cambio de fórmula.
- **No modifica** ninguna fórmula, KPI, permiso existente ni regla de
  negocio — 3 hallazgos UX que sí tocaban comportamiento (primitivo
  `Input`/`FormField`, color de banner info/confirmación, tecla Espacio en
  `IdeaCard`) quedaron documentados en `docs/ROADMAP.md`, sin implementar.

**Pruebas:** 919/919 pasando (+6 nuevas para las 2 verificaciones de
Calidad del Dato). `tsc`/`eslint` en la misma baseline previa. `next build`
exitoso.

**Archivos:** ~40 archivos de UI en `src/components/{ideas,meetings,projects,tasks,desk,kpis,assistant,settings}/**`
y `src/app/login/page.tsx`/`src/app/(protected)/profile/page.tsx` (solo
markup); `src/app/api/settings/data-quality/route.ts` (2 chequeos nuevos).

---

## v1.15.0 — 2026-07-24

**Tipo:** SECURITY / REFACTOR / PERFORMANCE / FEATURE / DOCUMENTATION
**Módulo:** Sprint D — Optimización y Refinamiento (auditoría integral de los 10 módulos, sin nuevos módulos, sin tocar fórmulas del Analytics Engine)

**Contexto:** Bloque 1 exigía una auditoría funcional previa a cualquier cambio.
Se ejecutó vía 3 agentes de investigación de solo lectura (Trabajo/Seguimiento/
Proyectos; Escritorio Digital/Reuniones/Equipo/Usuarios/Ajustes; Analytics/
Dashboard/Seguridad/Calidad del dato), con ~40 hallazgos concretos citados por
archivo:línea. De esos hallazgos, un subconjunto cambiaba comportamiento de
negocio existente (ej. notificar a invitados al reprogramar una reunión) —
el propio Sprint D exige aprobación para ese tipo de cambio, así que se
consultó el alcance con el usuario, que eligió explícitamente **"Solo lo
seguro"**: implementar todo lo que es bug/seguridad/deuda técnica/performance
sin tocar comportamiento de negocio, y documentar el resto como backlog. Ver
`docs/AUDIT_LOG.md` § Sprint D para el detalle completo de la auditoría, la
decisión de alcance y el informe final (Bloque 12).

- **SECURITY — cierra un IDOR real**: 5 rutas de subrecursos de tareas
  (`tasks/[id]/comments`, `tasks/[id]/activities`, `tasks/[id]/activities/[activityId]/comments`,
  `tasks/[id]/activities/retroactive`) no verificaban que la tarea fuera
  visible/propia del solicitante — cualquier usuario autenticado podía leer y
  escribir comentarios/horas de cualquier tarea del sistema, corrompiendo
  `realHours`/carga laboral de otra persona. Nuevo `src/lib/taskAccess.ts`
  (`canAccessTask`, mismo patrón que `projectAccess.ts`), aplicado en los 5
  archivos y reutilizado también en `tasks/[id]/route.ts` (dedup). Además,
  `DELETE /api/users/[id]` lanzaba un 500 crudo (violación de FK no
  controlada) al eliminar cualquier usuario con historial — ahora responde
  409 con un mensaje claro.
- **REFACTOR — consolida duplicación segura**: `recalcRealHours` (4 copias →
  `src/lib/recalcHours.ts`), `parseDateOnly` (2 copias → `businessTime.ts`),
  `formatRelative` (2 copias → `utils.ts`), `formatDuration` (4 copias con
  formato inconsistente → `utils.ts`, estandarizado a la variante que omite
  unidades en cero), `taskSelect` (2 copias idénticas → uno solo, importado),
  el chequeo de jerarquía de Usuarios repetido 4 veces (→
  `canManageTargetUser` en `roles.ts`). Corrige además: `ideas/route.ts`
  usaba un array de roles hardcodeado en vez de `CAN_REVIEW_IDEAS`;
  `operational-risk/team` notificaba con la tabla estática
  `NOTIFICATION_TARGETS` en vez de `getNotificationRules()` (no honraba
  reconfiguraciones desde Ajustes); `activity-reasons` no invalidaba la
  caché de Analytics al cambiar `assignedRoles`; `ProjectCard.tsx` nunca
  migró al sistema de Chips de Sprint B; `CommentPanel.tsx` (Tareas)
  todavía tenía el fallo silencioso que Sprint C §7 ya había corregido en
  Proyectos (ahora usa el mismo `useToast()` + "Reintentar"); `meetings/[id]/route.ts`
  no tenía ningún manejo de errores.
- **PERFORMANCE**: `dashboard/route.ts` agrupó ~9 consultas independientes
  en un solo `Promise.all` (antes secuenciales); gráficos de KPIs
  (`KpiCharts.tsx`, `ScoreHistoryChart.tsx`, `ExecutiveDashboard.tsx`)
  memoizan sus transformaciones de datos con `useMemo`; `UsersManager.tsx`
  ganó un buscador (nombre/correo/rol) sobre la lista ya cargada.
- **FEATURE — Calidad del Dato**: nuevo panel de diagnóstico de solo
  lectura dentro de Ajustes (no un módulo nuevo), `GET /api/settings/data-quality`
  (solo Administrador, bajo demanda, sin cron): fechas inválidas, progreso/
  horas fuera de rango, registros sin propietario, horas duplicadas (mismo
  autor, horario solapado, cruzando Tarea↔Proyecto — evidencia el hueco de
  `findOverlappingActivity` documentado en el backlog sin corregirlo),
  registros huérfanos (confirmación estructural vía llaves foráneas).
- **No modifica** ninguna fórmula del Analytics Engine, permisos existentes
  fuera del propio hallazgo de seguridad, ni ninguna regla de negocio — los
  ~8 hallazgos que sí la cambiaban quedaron documentados como backlog
  (`docs/DECISIONS.md`, `docs/ROADMAP.md`), no implementados.

**Pruebas:** 913/913 pasando (7 nuevas, cubriendo el IDOR cerrado, el 409 de
`DELETE /api/users/[id]` y el nuevo endpoint de calidad del dato). `tsc`/
`eslint` en la misma baseline previa (2 errores/3 warnings preexistentes, sin
relación). `next build` exitoso.

**Archivos:** `src/lib/taskAccess.ts` (nuevo), `src/lib/recalcHours.ts`
(nuevo), `src/app/api/settings/data-quality/route.ts` (nuevo),
`src/components/settings/DataQualitySection.tsx` (nuevo), más ~25 archivos
modificados en `src/app/api/tasks/**`, `src/app/api/users/**`,
`src/app/api/meetings/**`, `src/app/api/ideas/route.ts`,
`src/app/api/analytics/operational-risk/team/route.ts`,
`src/app/api/settings/activity-reasons/**`, `src/app/api/dashboard/route.ts`,
`src/lib/roles.ts`, `src/lib/businessTime.ts`, `src/lib/utils.ts`,
`src/components/kpis/**`, `src/components/tasks/CommentPanel.tsx`,
`src/components/projects/{ProjectCard,ProjectCommentsTab,ProjectPhasesTab,ProjectActivitiesTab,PhaseDetailModal}.tsx`,
`src/components/UsersManager.tsx`.

---

## v1.14.3 — 2026-07-24

**Tipo:** FIX
**Módulo:** Migración perezosa de historial — `migrateFijaHistoryIfNeeded` (`src/app/api/tasks/[id]/activities/route.ts`)

**Implementado:** cierra una ventana teórica de condición de carrera en la
migración automática de historial de tareas Fijas (crea una `TaskActivity`
sintética la primera vez que se listan las actividades de una tarea Fija
con `realHours > 0` y cero actividades). El `count()` seguido de `create()`
original no tenía ninguna garantía transaccional entre ambas llamadas —
dos peticiones `GET /activities` concurrentes para la misma tarea podían,
en teoría, crear cada una su propia actividad migrada, duplicando esas
horas. Nunca se observó en los datos de producción auditados (ver
`docs/AUDIT_LOG.md` § de este mismo día), pero se cierra el hueco.

- **Cambio:** `count()` → `upsert()` (motivo de migración) → `create()`
  ahora corren dentro de una única `prisma.$transaction(...)` con nivel de
  aislamiento `Serializable`. Si dos transacciones concurrentes chocan,
  Postgres falla una de las dos por conflicto de serialización — la
  perdedora se captura y se ignora (la otra ya completó la migración), sin
  propagar el error al handler `GET`.
- **Sin cambio de comportamiento observable** en el caso normal (sin
  condición de carrera): mismo resultado, misma actividad creada.
- **No modifica** ninguna fórmula, el Analytics Engine, KPIs, permisos ni
  reglas de negocio — es una corrección de robustez/concurrencia sobre una
  migración de datos ya existente.
- **Pruebas:** `src/__tests__/api/tasks-activities-comments.test.ts`
  actualizado — el mock de Prisma ahora simula `$transaction` invocando el
  callback con el mismo cliente mockeado. Suite completa: 900/900 pasando.

**Impacto:** ninguno en el comportamiento normal observado por los
usuarios; cierra un riesgo teórico de duplicación de horas en un escenario
de concurrencia poco común.

**Archivos:** `src/app/api/tasks/[id]/activities/route.ts`,
`src/__tests__/api/tasks-activities-comments.test.ts`.

---

## v1.14.2 — 2026-07-24

**Tipo:** DATABASE / FIX
**Módulo:** Migración histórica única de datos — `Task.completedAt`

**Implementado:** backfill histórico de ejecución única, no una regla
permanente. Regulariza exclusivamente las **33 tareas** identificadas en la
auditoría de `isCompletedOnTime` (v1.14.1) con `status = COMPLETADA` y
`completedAt = NULL` — limitación del modelo de datos anterior a que NEXO
empezara a registrar automáticamente esa fecha (migración
`20260707004617`, sin backfill en su momento), no un error del usuario.

- **Alcance:** exactamente 33 tareas, verificadas por consulta directa
  antes de escribir (no reutilizado ciegamente el número de la auditoría
  previa) — coincidió. Ninguna tarea adicional, de ningún otro estado, fue
  tocada. Ningún otro campo de esas 33 tareas se modificó.
- **Actualización:** `completedAt = endDate` para cada una, dentro de una
  única transacción (todo o nada).
- **Validación post-migración:** 33 actualizadas · 0 tareas `COMPLETADA`
  con `completedAt` nulo restantes · total de tareas `COMPLETADA` sin
  cambios (121 → 121, confirma que no se creó/eliminó ninguna) ·
  "completadas a tiempo" (Definición B) 57/121 → 90/121 (+33, exactamente
  las regularizadas).
- **Prevención futura (§7):** se verificó que `PATCH /api/tasks/[id]` y
  `POST /api/tasks/import` ya no podían reproducir este problema; se
  encontró y corrigió un tercer camino con el mismo gap —
  `POST /api/tasks` (crear una tarea ya con estado inicial `COMPLETADA`) no
  fijaba `completedAt`. Corregido en el mismo cambio
  (`src/app/api/tasks/route.ts`).
- **No modifica** la fórmula de Cumplimiento, el Analytics Engine, el
  NormalizationEngine, Performance Score, Riesgo Operativo, pesos, curvas
  ni benchmarks — es exclusivamente una regularización de datos históricos
  más el cierre de un gap de comportamiento (no de fórmula) hacia adelante.
- **No se repetirá:** migración de una sola vez, sin mecanismo para
  reejecutarse.

**Impacto:** el indicador "Cumplimiento" (Definición B, vista personal)
sube para los colaboradores dueños de esas 33 tareas, reflejando ahora que
sí se completaron (aproximado a su fecha objetivo, único dato disponible).
No afecta la Definición A ni ningún otro indicador.

**Archivos:** `src/app/api/tasks/route.ts` (prevención futura); migración
de datos ejecutada vía script de una sola vez, no versionado en el
repositorio (no es una migración de schema de Prisma — no cambia
estructura, solo regulariza valores existentes).

**Autor:** Claude Code

---

## v1.14.1 — 2026-07-24

**Tipo:** FIX / ANALYTICS
**Módulo:** Analytics — Cumplimiento por prioridad / personal (`isCompletedOnTime`)

**Implementado:** corrección de un bug real de clasificación en "completado
A TIEMPO" (Definición B de Cumplimiento, `src/lib/priorityCompliance.ts`,
usada en `/api/kpis/[userId]` y `/api/kpis/me` — la vista personal). Se
ejecutó primero una auditoría de solo lectura (sin tocar fórmulas) que
confirmó el diagnóstico con datos reales de producción antes de corregir
nada, a pedido explícito.

- **Bug:** la comparación `completedAt.getTime() <= endDate.getTime()`
  (instante UTC crudo) clasificaba como tardía cualquier tarea cerrada
  durante el horario laboral real del propio día de vencimiento, porque
  medianoche UTC del día de vencimiento equivale a las 7pm del día ANTERIOR
  en huso de negocio (Ecuador/Colombia, UTC-5).
- **Verificación empírica:** de 65 tareas clasificadas como "fuera de
  tiempo" en producción, 33 (51%) se habían completado el mismo día
  calendario — mal clasificadas por el bug, no genuinamente tardías. El
  cumplimiento a tiempo real pasaba de 26% a 64% sobre esas tareas con la
  clasificación correcta.
- **Corrección:** `isCompletedOnTime` ahora compara por día calendario en
  huso de negocio (`businessCalendarDay(completedAt) <= utcCalendarDay(endDate)`),
  reutilizando el mismo patrón que ya usa `isTaskOverdue` para "vencida".
  `utcCalendarDay` (`src/lib/utils.ts`) se exportó (antes era privada) en
  vez de reimplementarse.
- **Versionado:** `FORMULA_VERSIONS.completadoATiempo = "1.0"` (nueva
  entrada — primera vez que esta fórmula se versiona formalmente).
  `FORMULA_SET_VERSION` 4.2 → 4.3.
- **Tests:** 3 casos nuevos en `src/__tests__/analytics-formulas.test.ts`
  cubren explícitamente el escenario del bug (mismo día calendario con
  timestamp posterior a medianoche UTC) para prevenir una regresión.
- **Hallazgo aparte, documentado pero no corregido:** 33 tareas
  `COMPLETADA` adicionales tienen `completedAt = NULL` (anteriores a la
  migración que agregó la columna, sin backfill) — es un problema de datos
  históricos faltantes, no de fórmula; backfillear un timestamp que nunca
  se registró requeriría inventar un valor.

**Impacto:** el "Cumplimiento" (Definición B) en `/api/kpis/[userId]`/`/api/kpis/me`
sube para la mayoría de los colaboradores, reflejando correctamente las
tareas cerradas el mismo día de vencimiento. **No afecta** la Definición A
(Health Score, Performance Score, panel ejecutivo/equipo, informes) — nunca
usó `completedAt`/`endDate`. No se modificó ningún otro cálculo, permiso,
regla de negocio ajena a esta fórmula, ni el schema de base de datos.

**Archivos:** `src/lib/priorityCompliance.ts`, `src/lib/utils.ts`,
`src/lib/analytics.ts` (versionado), `src/__tests__/analytics-formulas.test.ts`.

**Autor:** Claude Code

---

## v1.14.0 — 2026-07-24

**Tipo:** UX / FEATURE
**Módulo:** Sprint C — NEXO Experience (Product Excellence)

**Implementado:** refinamiento de interacción y fricción anclado en un
informe de hallazgos previo (3 agentes de investigación sobre flujos de
clics, contenido del Dashboard, y calidad de mensajes de error/éxito) — sin
tocar Analytics Engine, KPIs, base de datos, permisos, autenticación ni
reglas de negocio. Ver `docs/PRODUCT_REVIEW.md` para la auditoría de
producto completa (fortalezas/debilidades/deuda técnica y de UX/
recomendaciones futuras).

- **Fase 1 — Reducción de clics:** "+ Nueva nota" en el header de
  Escritorio Digital (visible desde cualquier pestaña, antes 4 clics);
  enlace "Ver mi desempeño" en Analytics para roles con KPIs individuales de
  ejecución (`isLeadershipRole`, sin lógica nueva); búsqueda de tareas
  ahora también compara descripción y responsable asignado.
- **Fase 2 — Consistencia de navegación:** `BackLink` compartido (antes 3
  implementaciones distintas de "volver"); selector de estado en Kanban
  como complemento del drag-and-drop existente (el único de los 4
  mecanismos de cambio de estado detectados que no tenía alternativa de
  clic).
- **Fase 3 — Error y éxito:** acción "Reintentar" en `Toast`; 3 fallos
  genuinamente silenciosos corregidos (`ProjectCommentsTab`,
  `ProjectHistoryTab`, `PhaseDetailModal`); fuga técnica cerrada en
  `AssistantModule`/`assistant/chat/route.ts`; nueva clase `RecoveryError`
  para que las rutas de Proyectos/Escritorio Digital/Papelera solo reenvíen
  `err.message` cuando es un error curado, no cualquier excepción
  inesperada; `useToast()` extendido a Ideas, Reuniones y el resto de
  Proyectos; `profile/page.tsx` migrado a `useToast()`.
- **Fase 4 — Dashboard:** nueva card "Mis proyectos" (reutiliza la regla de
  acceso ya existente de `GET /api/projects`, sin cálculo nuevo) — cierra el
  hueco más claro del audit; `jornada` rebalanceada (resumen de urgencia en
  el espacio más prominente en vez de un saludo decorativo); mensaje de
  bienvenida ahora descartable.
- **Fase 5 — Ayuda contextual y acciones inteligentes:** `InfoTooltip`
  (versión liviana del `HelpPopover` de Analytics) en 3 puntos de fricción
  real; búsquedas recientes en el buscador de Escritorio Digital
  (localStorage, sin IA — única instancia de "acciones inteligentes" de
  este sprint).
- **Fase 6 — Documentación:** `docs/PRODUCT_REVIEW.md` (nuevo).

**Impacto:** puramente de interacción/UX — todos los commits pasan
`npx tsc --noEmit`, `npx eslint` y `npm test` (897 tests) limpios. Cero
diff en `prisma/schema.prisma`, `src/lib/analytics.ts`, `src/lib/roles.ts`
(solo se **consumen** funciones existentes como `isLeadershipRole`, nunca se
modifican), `src/lib/session.ts`, `src/proxy.ts`, `src/lib/workload.ts` ni
`src/lib/capacityForecast.ts`.

**Deliberadamente fuera de alcance** (documentado como recomendación futura
en `docs/PRODUCT_REVIEW.md` §10): relajar `targetTimeHours` en Crear
Proyecto (requiere migración de schema), un buscador global unificado
tareas+proyectos+notas (feature nueva, no una unificación de UI), sistema de
onboarding/tour completo, y unificar el cambio de estado de Ideas (quedó
como el único de los 4 mecanismos detectados sin resolver).

**Autor:** Claude Code

---

## v1.13.0 — 2026-07-24

**Tipo:** UI / UX
**Módulo:** Design System — Sprint B (UX Consistente + Design System Foundation)

**Implementado:** unificación de la experiencia visual de la plataforma sin
tocar lógica de negocio, Analytics Engine, KPIs, permisos, autenticación ni
el esquema de base de datos. Ver `docs/DESIGN_SYSTEM.md` para la referencia
completa de cada primitivo y el informe de Design Review (§25 del sprint).

- **Fase 0 — Primitivos:** `Button` ampliado de 4 a 6 variantes
  (`tertiary`/`success` nuevas, más `size`/`loading`); `PriorityChip`/
  `StatusChip` (un único componente visual sobre `Badge`, parametrizado por
  `src/lib/chipConfig.ts` — un `ChipConfig` por enum real de
  `prisma/schema.prisma`, nunca valores inventados); `Table`/`TableHead`/
  `TableBody`/`TableRow`/`Th`/`Td` (chrome compartido, sin lógica de
  orden/filtro propia); `ToastProvider`/`useToast` (mensajes estandarizados,
  montado en `src/app/layout.tsx`); `Skeleton`/`SkeletonText`/`SkeletonRow`/
  `Spinner`; `EmptyState`; `SearchInput`; `formatTime()` en `src/lib/utils.ts`.
- **Fase 1 — Botones:** 102 `<button>` ad-hoc → `Button` en 45 archivos
  (Tareas, Dashboard, Escritorio Digital, Equipo, KPIs, Ajustes, Usuarios).
- **Fase 2 — Chips:** mapas locales de color/label de prioridad y estado
  duplicados (`PRIORITY_VARIANT`, `STATUS_STYLES`, `REMINDER_PRIORITY_COLOR`,
  etc.) → `PriorityChip`/`StatusChip` en 10 archivos.
- **Fase 3 — Tablas, loading, empty states:** 15 `<table>` hand-rolled →
  `Table`; texto suelto "Cargando..."/spinners ad-hoc → `Skeleton`/`Spinner`;
  mensajes "sin resultados" sueltos → `EmptyState`, en 28 archivos.
- **Fase 4 — Toasts:** banners inline de guardado/error por componente
  ("Guardado correctamente", "Error al guardar") → `useToast()`, en 14
  archivos. Se preservaron inline los errores de validación de formulario
  que deben permanecer visibles mientras el formulario sigue abierto.
- **Fase 5 — Modales e iconografía:** 5 overlays hand-rolled (`TaskFormModal`,
  `CorrectArchivedTaskModal`, `NewReminderModal`, `NoteToReminderModal`,
  `CreateProjectModal`) → `Modal`/`ModalHeader`; `<svg>` inline ad-hoc →
  `lucide-react` en 8 archivos.
- **Fase 6 — Documentación:** `docs/DESIGN_SYSTEM.md` oficial (nuevo),
  incluyendo el informe de Design Review con backlog explícito para
  Sprint C — NEXO Experience (Ideas, Reuniones, Proyectos parcial,
  Repositorio, Nova, Login, Perfil quedan sin tocar).

**Impacto:** puramente visual/estructural — 100% de los commits de este
sprint pasan `npx tsc --noEmit` y `npx eslint` limpios (solo persisten 2
errores preexistentes no relacionados en `src/__tests__/**`). No se modificó
`src/lib/analytics.ts`, `src/lib/roles.ts`, `src/lib/session.ts`,
`src/proxy.ts` ni `prisma/schema.prisma` en ningún commit de este sprint.

**Archivos:** ver los 6 commits de este sprint (`feat(design-system):
primitivos...` y 5 `refactor(ui): ...`) para el detalle archivo por archivo
de cada fase — no se repiten aquí para no duplicar `git log`.

**Autor:** Claude Code

---

## v1.12.0 — 2026-07-23

**Tipo:** FEATURE / ANALYTICS
**Módulo:** Analytics — capa de explicabilidad (Sprint A: Analytics Explicativo)

**Implementado:** capa de interpretación/visualización ENCIMA del Analytics
Engine existente — **cero cambios de fórmula, peso, curva o umbral**;
`analytics.ts`, `capacityForecast.ts`, `workload.ts`, `targetTime.ts` y
`normalizationEngine.ts` permanecen intactos.

- **Insights de Performance Score (fortalezas/oportunidades):**
  `computePerformanceInsights` (nuevo, `insightsEngine.ts`) traduce
  `PerformanceScoreResult.factors[]` YA calculados a `Insight[]` en ambas
  direcciones — factor con `normalizedValue` Alto/Muy alto → fortaleza
  (`tone: "positive"`); Bajo → oportunidad con acción concreta e impacto
  (`weight - points`, nunca inventado). Antes `insightsEngine.ts` solo
  traducía factores de Riesgo Operativo (siempre negativos por diseño).
- **Bloques "Fortalezas detectadas" / "Oportunidades de mejora"**
  (`InsightsPanel.tsx`): subconjuntos del mismo `insights[]` ya calculado,
  filtrados por `tone` — oportunidades ordenadas por impacto, máx. 5.
- **Explicación de tendencias:** `explainScoreTrend`/`getScoreTrendExplanation`
  (nuevo, `insightsEngine.ts`) comparan `factors[]` actuales vs. un snapshot
  histórico de `AnalyticsAuditLog` y narran qué factor subió/bajó más — nunca
  recalcula el score. Se muestra junto al Performance Score
  (`InsightsPanel`) y al Riesgo Operativo (`OperationalRiskCard`), donde el
  ▲/▼/= ya existente ahora viene acompañado de texto, no solo el número.
- **Ayuda contextual de 4 partes:** `INDICATOR_HELP` (nuevo,
  `analyticsExplain.ts`) + componente `HelpPopover` (click, no solo hover)
  para 6 indicadores principales (Performance Score, Score de Salud, Riesgo
  Operativo, Consistencia, Trazabilidad, Tiempo Objetivo) — qué significa/
  cómo se calcula/por qué importa/buenas prácticas, redactado desde
  `docs/ANALYTICS_FORMULAS.md`.
- **Histórico de evolución con selector de período:** nuevo endpoint
  `GET /api/analytics/history/[userId]?kind=&months=1|3|6|12` sobre
  `src/lib/analyticsAuditHistory.ts` (capa de solo lectura NUEVA sobre
  `AnalyticsAuditLog`, no forma parte del motor) + componente
  `ScoreHistoryChart.tsx` (recharts), montado en `MyKpisModule`,
  `KpisModule` y `OperationalRiskCard`.
- **Simulador "¿Qué pasaría si...?" personal:** `simulate/[userId]/route.ts`
  gana 4 escenarios nuevos (completar tareas, reducir vencidas, subir
  consistencia, registrar horas adicionales) que recalculan UN factor de
  Performance Score o Carga/Score de Salud con las MISMAS funciones puras
  del motor (`normalize`, `weightedPoints`, `classifyPerformanceScore`,
  `cargaHealthScore`) — nunca persiste nada. Nuevo componente standalone
  `WhatIfSimulator.tsx`, montado en `MyKpisModule` (el simulador de equipo
  existente en `TeamWorkloadCards.tsx` no se tocó). Respuesta incluye
  `diff` explícito (actual → simulado → diferencia).

**Archivos creados:** `src/lib/analyticsAuditHistory.ts`,
`src/app/api/analytics/history/[userId]/route.ts`,
`src/components/kpis/ScoreHistoryChart.tsx`,
`src/components/kpis/WhatIfSimulator.tsx`.

**Archivos modificados:** `src/lib/insightsEngine.ts` (+insights de
Performance Score, +explicación de tendencia),
`src/lib/analyticsExplain.ts` (+`INDICATOR_HELP`),
`src/components/kpis/AdvancedAnalytics.tsx` (+`HelpPopover`),
`src/components/kpis/InsightsPanel.tsx`,
`src/components/kpis/OperationalRiskCard.tsx`,
`src/components/kpis/TargetTimePrecisionCard.tsx`,
`src/components/kpis/KpiCharts.tsx` (`useChartTheme` exportado, sin cambio
de comportamiento), `src/components/kpis/MyKpisModule.tsx`,
`src/components/kpis/KpisModule.tsx`,
`src/app/api/analytics/insights/[userId]/route.ts`,
`src/app/api/analytics/operational-risk/[userId]/route.ts`,
`src/app/api/analytics/simulate/[userId]/route.ts`.

**Impacto:** ningún cambio en `ANALYTICS_ENGINE_VERSION` (1.5.0) ni
`FORMULA_SET_VERSION` (4.2) — se confirmó explícitamente que ningún archivo
del motor central (`analytics.ts`, `capacityForecast.ts`, `workload.ts`,
`targetTime.ts`, `normalizationEngine.ts`) fue modificado; los KPIs, scores y
clasificaciones existentes no cambian de valor para ningún usuario. Todo el
código nuevo es de solo lectura/composición sobre resultados ya calculados
(`PerformanceScoreResult.factors`, `AnalyticsAuditLog`) o recombinación con
las mismas funciones puras ya exportadas por el motor. Verificado con
`npm run build`, `npx tsc --noEmit` y `npx vitest run` (897 tests, sin
regresiones) tras cada bloque. `TeamWorkloadCards.tsx` (simulador de equipo
existente) no se modificó, por decisión explícita de minimizar riesgo sobre
un flujo ya en producción.

**Autor:** Claude Code (dirigido por Anthony Jácome).

---

## v1.11.0 — 2026-07-23

**Tipo:** FEATURE / BREAKING CHANGE / DATABASE
**Módulo:** Escritorio Digital (refinamiento — notas rápidas y recordatorios)

**Implementado:**
- **Lectura automática (§1):** se eliminó el botón "Marcar como leída" — abrir
  la tarjeta de la nota (nuevo `NoteDetailModal`) es lo único que la marca
  como leída, sin acción adicional. Sigue registrando usuario/fecha/hora
  (`readAt`, ya existía).
- **Confirmación de lectura (§2):** al leerse, el remitente recibe una
  notificación in-app ("Fulano leyó tu Nota Rápida.") — únicamente en la
  Campana, sin correos ni notas nuevas. Idempotente: reabrir una nota ya
  leída no vuelve a notificar.
- **Indicador visual (§3):** sin cambios de comportamiento — el punto rojo
  del sidebar (Sprint anterior) ya desaparecía solo cuando no quedan notas
  sin leer, que es exactamente lo que ahora dispara la lectura automática.
- **Respuestas cortas (§4):** nuevo modelo `DeskNoteReply` — máximo 2
  respuestas por nota entre remitente y destinatario, gestionadas desde
  `NoteDetailModal`. Al llegar al límite, la API responde 409 con el
  mensaje exacto pedido ("Esta conversación alcanzó el límite permitido.")
  y la interfaz sugiere convertir la nota en Recordatorio o Tarea. Cada
  respuesta notifica a la otra parte y queda auditada (`REPLIED`).
- **Convertir en Recordatorio reemplaza a Convertir en Tarea (§5, BREAKING):**
  el puente directo Nota→Tarea del sprint anterior se retiró por completo.
  Ahora una nota se convierte en `PersonalReminder` (`convertedToReminderId`
  en `DeskNote`, reemplaza a `convertedToTaskId`) — la nota permanece
  intacta y visible, nunca se elimina.
- **Crear tarea desde un Recordatorio (§6, nuevo):** `PersonalReminder` gana
  `convertedToTaskId`/`convertedToTaskAt` — acción opcional "Crear tarea" en
  cualquier recordatorio (completado o no), copia título/descripción/
  prioridad y referencia el adjunto por nombre (Trabajo sigue sin campo de
  adjunto). El recordatorio permanece disponible para auditoría.
- **Adjunto copiado en cada conversión, no referenciado:** `PersonalReminder`
  gana sus propios `attachmentName`/`attachmentMime`/`attachmentData` — al
  convertir una nota con adjunto, el archivo se copia al recordatorio para
  que sobreviva aunque la nota original se archive y se purgue a los 15
  días (§8).
- **Archivado con retención de 15 días (§7/§8):** nueva `purgeExpiredArchivedNotes()`
  (barrido perezoso, sin cron dedicado) elimina en duro las notas archivadas
  hace más de 15 días calendario. Desde Archivadas, el destinatario también
  puede eliminar definitivamente antes de tiempo (vía directa, sin pasar
  por el Centro de Recuperación — esa papelera sigue siendo exclusiva del
  remitente al eliminar una nota que envió).
- **Buscador único, sin cambiar de sección (§9):** se retiró la pestaña
  "Buscar" — ahora es un overlay (`GlobalSearchOverlay`) accesible desde
  cualquier pestaña del Escritorio. Extendido para localizar también el
  contenido de las respuestas de notas, no solo el mensaje original.
- **Auditoría ampliada (§10):** nuevas acciones `REPLIED` y
  `CONVERTED_TO_REMINDER`; `DELETED` distingue origen manual/automático en
  `metadata`. Nuevo endpoint `GET /api/desk-notes/[id]/history` (paralelo al
  ya existente de recordatorios) y modal de historial compartido
  (`DeskHistoryModal`) entre notas y recordatorios.

**Archivos afectados:** `prisma/schema.prisma` (+`DeskNoteReply`,
+adjunto/`convertedToTaskId` en `PersonalReminder`,
`DeskNote.convertedToTaskId` → `convertedToReminderId`, +`REPLIED`/
`CONVERTED_TO_REMINDER` en `DeskAuditAction`),
`prisma/migrations/20260723151707_desk_replies_and_reminder_task_bridge/`,
`src/lib/deskNotes.ts` (nuevo, select/serialize compartido),
`src/lib/personalReminders.ts` (nuevo, ídem para recordatorios),
`src/lib/deskNoteRetention.ts` (nuevo), `src/app/api/desk-notes/[id]/route.ts`
(+GET detalle, notificación de lectura, DELETE con dos vías),
`src/app/api/desk-notes/[id]/replies/` (nuevo),
`src/app/api/desk-notes/[id]/convert-to-reminder/` (nuevo, reemplaza a
`convert-to-task`), `src/app/api/desk-notes/[id]/history/` (nuevo),
`src/app/api/desk-reminders/[id]/convert-to-task/` (nuevo),
`src/app/api/desk-reminders/[id]/history` (sin cambios, reutilizado),
`src/app/api/desk/search/route.ts` (busca también respuestas),
`src/components/desk/NoteDetailModal.tsx`,
`NoteToReminderModal.tsx`, `ConvertReminderToTaskModal.tsx`,
`DeskHistoryModal.tsx` (nuevos, reemplazan a `ConvertToTaskModal.tsx` y
`ReminderHistoryModal.tsx`), `GlobalSearchOverlay.tsx` (reemplaza a
`SearchPanel.tsx`), `DeskNotePostIt.tsx`, `NotesPanel.tsx`,
`ReminderCard.tsx`, `RemindersPanel.tsx`, `DeskBoard.tsx`, `types.ts`.

**Impacto:** `BREAKING CHANGE` sobre la conversión directa Nota→Tarea del
sprint anterior (nunca llegó a usarse en producción — verificado antes de
migrar: 0 notas con `convertedToTaskId`). Sin cambios en Analytics, KPIs ni
el módulo Trabajo salvo la creación de tareas ya existente (§11
Consistencia). Verificado en vivo con cuentas descartables sobre la base de
datos compartida con producción (11 notas y 21 recordatorios reales
verificados intactos antes y después): lectura automática + notificación
idempotente, hilo de respuestas con bloqueo exacto al llegar a 2, pipeline
completo Nota→Recordatorio→Tarea (ambas notas y recordatorios permanecen
disponibles y marcados, nunca eliminados), archivado con bloqueo de
eliminación definitiva hasta archivar, y búsqueda unificada encontrando una
nota por el contenido de una respuesta. Un bug real se encontró y corrigió
durante esta verificación: `convertedToTaskId`/adjunto faltaban en el
`select` de listado de recordatorios (`/api/desk-reminders`), ver
`docs/AUDIT_LOG.md`.

**Autor:** Claude Code (dirigido por Anthony Jácome).

---

## v1.10.0 — 2026-07-23

**Tipo:** FEATURE / DATABASE
**Módulo:** Escritorio Digital — recordatorios (refinamiento de ciclo de vida)

**Implementado:**
- **"Completado" deja de ser un estado definitivo:** todo recordatorio
  completado ahora muestra la acción **↩ Reabrir**. Al usarla, el estado
  vuelve a `PENDIENTE` sobre la **misma fila** (mismo `id`) — nunca se crea
  un registro nuevo, nunca se pierde el historial previo.
- **Diálogo de reapertura con dos opciones:** (A) mantener la fecha/hora
  original, o (B) elegir una nueva — sin cerrar el diálogo con una tercera
  vía que cree un recordatorio duplicado.
- **Historial de completados independiente del archivo:** `PersonalReminder`
  gana `archived`/`archivedAt` (mismo patrón que `DeskNote`) — un
  recordatorio completado puede archivarse para salir del historial visible
  sin eliminarse ni perder auditoría. Nueva pestaña "Archivados" en
  Recordatorios, junto a Pendientes/Completados.
- **Eliminar sigue siendo una acción independiente del estado** — nunca
  ocurre automáticamente al completar (ya era así; se mantiene explícito
  como requisito de este refinamiento).
- **Auditoría visible:** nuevo endpoint `GET
  /api/desk-reminders/[id]/history` (lee `DeskAuditLog`, no duplica datos)
  y un modal de "Historial" en cada recordatorio con la línea de tiempo
  completa (creación, completado, reapertura, reprogramación, archivado…)
  en el mismo tono narrativo del pedido ("Recordatorio creado.",
  "Reabierto.", "Nueva fecha programada: …").
- Nueva acción de auditoría `REOPENED`; reabrir con una nueva fecha registra
  **dos** eventos (`REOPENED` + `POSTPONED`), igual que el ejemplo del
  pedido muestra como dos líneas separadas.

**Archivos afectados:** `prisma/schema.prisma` (+`archived`/`archivedAt` en
`PersonalReminder`, +`REOPENED` en `DeskAuditAction`),
`prisma/migrations/20260723125944_reminder_reopen_archive/`,
`src/app/api/desk-reminders/route.ts` (filtro `archived`, default
`false`), `src/app/api/desk-reminders/[id]/route.ts` (acciones `reopen`,
`archive`, `unarchive`), `src/app/api/desk-reminders/[id]/history/route.ts`
(nuevo), `src/components/desk/ReopenReminderModal.tsx` (nuevo),
`src/components/desk/ReminderHistoryModal.tsx` (nuevo),
`src/components/desk/ReminderCard.tsx`, `RemindersPanel.tsx`, `types.ts`.

**Impacto:** sin cambios en notificaciones, recordatorios recurrentes,
conversión de notas, Analytics ni KPIs (§7 Compatibilidad) — reabrir un
recordatorio que generó automáticamente su siguiente ocurrencia al
completarse no afecta ni elimina esa ocurrencia ya creada (documentado en
`docs/AUDIT_LOG.md`). Verificado en vivo con una cuenta descartable
(`*@verify.local`, eliminada al finalizar): ciclo completo
creado→completado→reabierto (opción A)→completado→reabierto con nueva
fecha (opción B)→completado→archivado→reabierto (des-archiva
automáticamente), con el historial de auditoría completo y en orden
mostrando las 9 transiciones sin perder ninguna.

**Autor:** Claude Code (dirigido por Anthony Jácome).

---

## v1.9.0 — 2026-07-23

**Tipo:** FEATURE / BREAKING CHANGE / DATABASE
**Módulo:** Escritorio Digital (evolución — "centro personal de trabajo")

**Implementado:**
- **Notas — nuevos atributos:** color del Post-it independiente de la
  prioridad (`DeskNoteColor`: Amarillo/Rosado/Celeste/Verde/Naranja/Lila —
  la prioridad sigue viviendo solo en la franja superior), adjunto opcional
  (mismo patrón base64 que `ImprovementIdea`, descarga bajo demanda vía
  `GET /api/desk-notes/[id]/attachment`, nunca incluido en el listado para
  no inflar el payload).
- **Alerta visual de notas nuevas:** punto rojo sobre el ícono "Escritorio
  Digital" del sidebar (`GET /api/desk-notes/unread-count`, sondeado cada
  30s) — desaparece únicamente cuando ya no quedan notas sin leer, nunca
  solo por entrar al módulo.
- **Confirmación de lectura:** el remitente ve ✓ Entregada / ✓✓ Leída (con
  fecha/hora de lectura) en la pestaña "Enviadas" — reutiliza `readAt`
  (ya existía desde el Sprint 1), sin tabla nueva.
- **Convertir nota en tarea (opcional):** botón en cada nota recibida que
  abre un formulario mínimo (título editable, Fija/Seguimiento, frecuencia,
  fechas, tiempo objetivo) y crea la tarea reutilizando `POST /api/tasks`
  tal cual. La nota original **nunca se edita ni se elimina** — solo queda
  marcada `convertedToTaskId`/`convertedAt`. La prioridad de la nota se
  traduce a la escala de Trabajo (Urgente/Importante → Alta, Recordatorio →
  Media, Información → Baja).
- **Recordatorios personales — reemplazo completo de `FollowUpReminder`:**
  nuevo modelo `PersonalReminder`, independiente de Task/Project (título,
  descripción, fecha/hora, prioridad, repetición, estado). Los 18
  `FollowUpReminder` activos en producción se migraron automáticamente sin
  pérdida de historial (ver `docs/AUDIT_LOG.md`) y la sección "Seguimiento
  planificado" se retiró por completo del panel de actividades de Trabajo.
- **Repetición** (una vez/diario/semanal/mensual): al completar un
  recordatorio repetitivo se genera automáticamente la siguiente ocurrencia
  (`advanceRepeat()`), auditada como una fila `CREATED` nueva.
- **Recordatorios vencidos:** banda roja "Recordatorio pendiente" dentro de
  Escritorio Digital; acciones Completar/Posponer (15min/30min/1h/mañana/
  fecha elegida)/Editar/Eliminar.
- **Widget del Dashboard reemplazado:** ahora muestra únicamente "Mis
  próximos recordatorios" (máx. 5, ordenados por fecha, sin completados) —
  las notas dejaron de tener preview en el Dashboard, se surfacean vía el
  punto rojo del sidebar en su lugar (ver Decisiones).
- **Calendario personal** (`CalendarPanel.tsx`): recordatorios + notas
  pendientes propias en una grilla mensual — no lee ni modifica Reuniones.
- **Búsqueda unificada** (`GET /api/desk/search`): texto, prioridad, fecha,
  remitente/destinatario (solo notas), estado — combina notas y
  recordatorios propios.
- **"Bandeja Hoy"** (mejora adoptada, no pedida explícitamente): pestaña
  por defecto al entrar al módulo con 4 bloques — notas pendientes,
  recordatorios de hoy, tareas próximas a vencer (Trabajo, solo lectura) y
  proyectos con actividad reciente (Proyectos, solo lectura, ventana fija
  de 7 días — ver Decisiones).
- **Auditoría central** (`DeskAuditLog`, un solo modelo para notas y
  recordatorios, mismo criterio que `RecoveryAuditLog`): creación, edición,
  lectura, fijado/desfijado, archivado, eliminación, conversión en tarea,
  cambio de prioridad, posposición, completado — todas con usuario y fecha.

**Archivos afectados:** `prisma/schema.prisma` (+`DeskNoteColor`,
+adjunto/`convertedToTaskId` en `DeskNote`, +`PersonalReminder`,
+`DeskAuditLog`, −`FollowUpReminder`),
`prisma/migrations/20260723054447_desk_center_evolution_additive/`,
`prisma/migrations/20260723054842_remove_followup_reminder/`,
`src/lib/deskAudit.ts` (nuevo), `src/lib/deskReminders.ts` (nuevo),
`src/lib/storage.ts` (`saveIdeaAttachment` → `saveAttachment`, ahora
compartido con notas), `src/app/api/desk-notes/**` (color/adjunto,
`[id]/attachment`, `[id]/convert-to-task`, `unread-count`),
`src/app/api/desk-reminders/**` (nuevo), `src/app/api/desk/today` y
`src/app/api/desk/search` (nuevos), `src/components/desk/**`
(`ConvertToTaskModal`, `ReminderCard`, `NewReminderModal`, `NotesPanel`,
`RemindersPanel`, `CalendarPanel`, `SearchPanel`, `TodayInbox`, `DeskBoard`
reestructurado en pestañas), `src/components/dashboard/RemindersWidget.tsx`
(reemplaza a `DeskNotesWidget.tsx`), `src/components/shell/Sidebar.tsx`
(punto rojo), `src/components/tasks/ActivityPanel.tsx` (se retira
"Seguimiento planificado"), `src/components/reminders/` (eliminado —
`ReminderNotifier.tsx`), `src/app/api/reminders/**` (eliminado).

**Impacto:** cambio de comportamiento intencional (`BREAKING CHANGE`) sobre
el sistema de recordatorios anterior — quien esperaba "Seguimiento
planificado" dentro de una tarea ahora encuentra sus recordatorios en
Escritorio Digital. Sin cambios en Analytics/KPIs/carga laboral (§Reglas).
Verificado en vivo con cuentas descartables (`*@verify.local`, eliminadas
al finalizar): nota con color+adjunto, descarga, confirmación de lectura,
conversión a tarea (bloquea doble conversión, preserva la nota), creación/
completado/generación automática de la siguiente ocurrencia/posposición de
recordatorios, Bandeja Hoy, punto rojo, búsqueda, y confirmación de que las
rutas antiguas de `/api/reminders` ya no existen (404).

**Autor:** Claude Code (dirigido por Anthony Jácome).

---

## v1.8.0 — 2026-07-23

**Tipo:** FEATURE / DATABASE
**Módulo:** Escritorio Digital (nuevo, Sprint 1)

**Implementado:**
- Nuevo módulo **Escritorio Digital**: notas rápidas informales entre
  colaboradores, equivalente digital de un Post-it dejado sobre el
  escritorio físico de alguien cuando no está disponible — deliberadamente
  NO es correo/chat (sin asunto, sin hilos, sin destinatarios múltiples) y
  no participa en Analytics/KPIs/carga laboral.
- Nuevo modelo `DeskNote` (`prisma/schema.prisma`): remitente, destinatario,
  mensaje (máx. 500 caracteres), prioridad (`DeskNotePriority`:
  Información/Recordatorio/Importante/Urgente), estados `read`/`pinned`/
  `archived` controlados únicamente por el destinatario, y `deletedAt` como
  bandera local del Centro de Recuperación.
- **Diseño tipo Post-it ejecutivo** (`DeskNotePostIt.tsx`): rotación sutil
  determinística (1°-3°, no aleatoria por render), franja superior pastel
  según prioridad (el resto de la nota permanece neutro/limpio, según el
  pedido), elevación + enderezado al pasar el mouse (framer-motion),
  acciones (✓ marcar leída, 📌 fijar, 🗃 archivar) ocultas hasta hover.
  Compatible con modo claro/oscuro vía tokens de diseño existentes
  (`--surface`/`--border`/`--shadow`), sin tablas ni listas tradicionales.
- **Widget del Dashboard** (`DeskNotesWidget.tsx`): últimas 4 notas
  recibidas activas + botón "Ver todas" hacia la página completa (no modal).
- **Página completa** `/desk` (`DeskBoard.tsx`): tablero en grilla
  responsiva con pestañas Escritorio/Fijadas/Archivo/Enviadas (esta última
  para que el remitente pueda ver el estado de lectura y eliminar sus
  propias notas).
- **Permisos:** todos los roles excepto Administrador pueden crear/recibir/
  leer/fijar/archivar notas (`canUseDeskNotes()` en `src/lib/roles.ts`), sin
  restricción de jerarquía entre colaboradores no-Administrador (a
  diferencia de `VISIBLE_ROLES`, que sí es jerárquico). El destinatario
  controla el estado de su copia; solo el remitente puede eliminarla.
- **Eliminación vía Centro de Recuperación:** `DELETE
  /api/desk-notes/[id]` llama a `recoveryCenter.moveToTrash()` (adaptador
  `DESK_NOTE` nuevo en `ENTITY_REGISTRY`) en vez de un borrado directo —
  Escritorio Digital es el segundo módulo integrado, después de Proyectos.
- Notificación in-app (no de desempeño) al destinatario cuando recibe una
  nota nueva, reutilizando el modelo `Notification` existente.

**Archivos afectados:** `prisma/schema.prisma`,
`prisma/migrations/20260723045035_add_desk_notes/`, `src/lib/roles.ts`
(`canUseDeskNotes`), `src/lib/recoveryCenter.ts` (adaptador `DESK_NOTE`),
`src/lib/navLinks.ts`, `src/app/api/desk-notes/**` (route.ts, `[id]`,
`recipients`), `src/app/(protected)/desk/page.tsx`,
`src/components/desk/**` (types.ts, DeskNotePostIt.tsx, NewNoteModal.tsx,
DeskBoard.tsx), `src/components/dashboard/DeskNotesWidget.tsx`,
`src/components/dashboard/DashboardModule.tsx` (card `escritorio`),
`src/app/(protected)/dashboard/page.tsx`.

**Impacto:** módulo nuevo, sin cambios de comportamiento en Trabajo,
Proyectos ni Analytics. Verificado en vivo con cuentas descartables
(`*@verify.local`, eliminadas al finalizar la verificación): creación,
lectura/fijado/archivado por el destinatario, exclusión del Administrador
(nav, widget y página), y eliminación por el remitente vía la papelera del
Centro de Recuperación.

**Autor:** Claude Code (dirigido por Anthony Jácome).

---

## v1.7.0 — 2026-07-23

**Tipo:** UX / UI / BREAKING CHANGE / DATABASE
**Módulo:** Proyectos (Sprint 2.1 — refinamiento)

**Implementado:**
- **Historial consolidado (§1):** ya no se registra un evento genérico
  "ACTUALIZADO" por cada edición de campo, ni un evento por cada comentario
  o por cada actividad registrada individualmente — el Historial solo
  guarda eventos relevantes de negocio (creación, cambio de estado/
  responsable, alta/baja de fase o participante, documento, papelera/
  restauración). El cambio de estado de una fase sigue auditándose; los
  ajustes de progreso/notas/fechas de una fase ya NO generan una fila por
  cada edición (antes se disparaba en cada tick del slider de progreso).
- **Responsable ≠ Participante (§2):** al crear un proyecto, el responsable
  principal y el creador ya NO se agregan automáticamente como
  participantes. Se es participante únicamente por asignación explícita o
  por registrar una actividad (que ahora enrola automáticamente al autor si
  todavía no figuraba, dejando constancia en el historial).
- **Eliminación restringida al creador (§3):** mover a la papelera,
  restaurar y eliminar definitivamente ahora requieren ser el creador del
  proyecto — antes cualquier responsable o liderazgo (nivel ≥ 3) también
  podía. La retención automática de 48h no cambió. La Papelera sigue
  visible para liderazgo (supervisión) pero sin acciones si no son también
  el creador.
- **Fases en tarjetas (§4):** el listado de fases pasó de filas a una
  grilla de tarjetas independientes, cada una con nombre, estado,
  responsable, participantes (derivados de quién registró actividad ahí),
  tiempo objetivo, tiempo registrado, % de avance, fecha objetivo y una
  acción "Ver detalle" (nuevo modal con el desglose completo de la fase y
  sus actividades).
- **Fases visibles acotadas (§5):** el selector de fase al registrar una
  actividad ahora solo muestra fases donde el usuario es responsable, ya
  participó, o la fase no tiene responsable asignado (abierta) — el resto
  se oculta.
- **Registro de tiempo por rango horario (§6, BREAKING):** se eliminó el
  campo de duración manual (horas/minutos) — se registra únicamente hora
  inicio/hora fin y la duración se calcula siempre desde ese rango.
  `ProjectActivity.time` (String suelto) se reemplazó por `startTime`/
  `endTime`.
- **Descripción obligatoria (§7):** mínimo 15 caracteres, validado en
  cliente y servidor.
- **Timeline cronológico por día (§8):** las actividades ahora se agrupan
  por día calendario con encabezado, y cada registro muestra usuario, rango
  horario, duración calculada, descripción, comentarios y archivos
  adjuntos (con descarga inline).
- **Tarjeta de tiempo acumulado (§9):** reemplaza el indicador simple —
  ahora muestra horas registradas, tiempo objetivo, horas restantes, barra
  de progreso y % ejecutado.
- **Resumen como dashboard ejecutivo (§10):** la pestaña Resumen ahora
  abre con 8 tarjetas KPI (Estado, Avance, Participantes, Tiempo objetivo,
  Tiempo registrado, Fases, Última actividad, Próximo vencimiento) antes
  del detalle/observaciones existentes. "Avance" es el promedio de
  progreso de fases (o % de tiempo ejecutado si no hay fases) — cálculo
  puramente derivado en el cliente, sin leer ni modificar el Analytics
  Engine (preparado para la integración del Sprint 3, sin adelantarla).

**Archivos afectados:** `prisma/schema.prisma`,
`prisma/migrations/20260723041452_project_activity_start_end_time/`,
`src/lib/projectAccess.ts` (`isProjectCreator`),
`src/lib/projectPhaseStats.ts` (nuevo),
`src/app/api/projects/**` (route.ts, activities, comments, phases,
phases/[phaseId], restore, permanent, trash),
`src/components/projects/ProjectSummaryTab.tsx`,
`ProjectPhasesTab.tsx`, `PhaseDetailModal.tsx` (nuevo),
`ProjectActivitiesTab.tsx`, `ProjectDetailView.tsx`, `ProjectTrashPanel.tsx`,
`types.ts`.

**Impacto:** Cambio de comportamiento intencional en 3 frentes (historial,
membresía de participantes, permisos de eliminación) pedido explícitamente
por el sprint — no afecta Task/TaskActivity ni el Analytics Engine.
Verificado de punta a punta contra la base de datos compartida con
usuarios `@verify.local` desechables: participantes vacíos al crear,
auto-alta al registrar actividad, bloqueo de papelera/restaurar/eliminar
para quien no es el creador (incluido un responsable con permisos previos),
validación de descripción/hora inicio-fin, y ausencia de eventos de
historial para comentarios, actividades individuales y ediciones de
progreso repetidas. Datos de prueba eliminados al finalizar. Solo existía
un proyecto real en producción al momento del cambio (creado hoy mismo,
sin actividades registradas) — riesgo de migración nulo.

**Autor:** Claude Code
**Estado:** Implementado

---

## v1.6.0 — 2026-07-23

**Tipo:** FEATURE / DATABASE / SECURITY
**Módulo:** Centro de Recuperación (arquitectura corporativa, interno) / Proyectos

**Implementado:**
- Servicio corporativo centralizado `src/lib/recoveryCenter.ts` (**Centro de
  Recuperación**, nombre puramente arquitectónico — el usuario solo ve
  "Papelera" en cada módulo) que administra el ciclo de vida de CUALQUIER
  entidad eliminada temporalmente en NEXO: `moveToTrash`, `restore`,
  `deletePermanently`, `purgeExpiredItems`, `getRemainingRetentionTime`,
  `registerAuditEvent`.
- Diseño abierto/cerrado: agregar un módulo nuevo (Trabajo, Escritorio
  Digital, Documentos, Repositorios, Plantillas, Comunicados) requiere
  únicamente una entrada de datos en `ENTITY_REGISTRY` — cero cambios de
  lógica en el servicio central y cero migraciones de schema (`entityType`
  es un `String` libre, no un enum de Prisma).
- Modelos Prisma nuevos: `RecoveryItem` (estado/retención de cada elemento
  en papelera) y `RecoveryAuditLog` (auditoría central única de TODA
  operación, para cualquier módulo — nunca una tabla de auditoría por
  módulo), más los enums `RecoveryStatus`, `RecoveryOperation`,
  `RecoveryOrigin`.
- **Proyectos** es el primer (y único, por ahora) módulo integrado:
  `Project.deletedAt` (bandera local mantenida por el adaptador del
  registro, para filtrar sin join), nuevas rutas
  `DELETE /api/projects/[id]` (mover a la papelera),
  `POST /api/projects/[id]/restore`, `DELETE /api/projects/[id]/permanent`
  (irreversible) y `GET /api/projects/trash` (listado con cuenta regresiva
  de retención, visibilidad acotada a responsable/creador/liderazgo).
  Eventos `ELIMINADO`/`RESTAURADO` agregados al historial propio del
  proyecto (`ProjectHistory`), sin duplicar la auditoría central.
- Período de retención (48 horas por defecto) configurable vía el mismo
  mecanismo genérico de `SystemConfigHistory` que ya usan
  horas efectivas/límites de carga/política de retención LOPDP — sin
  valores hardcodeados en la lógica de negocio (`CONFIG_KEY_RECOVERY_RETENTION_HOURS`
  en `src/lib/systemConfig.ts`).
- Purga automática de elementos expirados implementada como barrido
  perezoso e idempotente disparado al abrir la Papelera (mismo criterio que
  la migración perezosa de historial de tareas Fijas, ver
  `docs/AUDIT_LOG.md` § 2026-07-21) — no se implementó un cron dedicado
  este sprint.
- Interfaz de "Papelera" para Proyectos: panel deslizante con lista,
  cuenta regresiva de vencimiento, restaurar y "eliminar definitivamente";
  botón "Mover a la papelera" en el resumen del proyecto (Zona de peligro).
- **No implementado a propósito, según el pedido:** consola administrativa
  unificada que liste elementos eliminados de todos los módulos a la vez —
  la arquitectura queda preparada (`RecoveryItem`/`RecoveryAuditLog` ya
  son transversales a cualquier `entityType`), pero la pantalla en sí queda
  para un sprint futuro.

**Archivos afectados:** `prisma/schema.prisma`,
`prisma/migrations/20260723033102_add_recovery_center/`,
`src/lib/recoveryCenter.ts`, `src/lib/systemConfig.ts`,
`src/app/api/projects/[id]/route.ts` (DELETE),
`src/app/api/projects/[id]/restore/route.ts`,
`src/app/api/projects/[id]/permanent/route.ts`,
`src/app/api/projects/trash/route.ts`, `src/app/api/projects/route.ts`
(filtro `deletedAt`), `src/app/(protected)/projects/page.tsx`,
`src/components/projects/ProjectTrashPanel.tsx`,
`src/components/projects/ProjectSummaryTab.tsx`,
`src/components/projects/ProjectsModule.tsx`.

**Impacto:** Nuevo mecanismo de plataforma, sin cambios en el
comportamiento de ningún módulo existente salvo Proyectos (que gana
capacidad de eliminación/restauración que antes no existía en absoluto).
Verificado de punta a punta contra la base de datos compartida con
usuarios `@verify.local` desechables: mover a papelera, listar papelera,
bloqueo de acceso para quien no es responsable/creador/liderazgo,
restaurar, eliminar definitivamente (con cascada real sobre fases/
participantes/actividades/comentarios/documentos/historial del proyecto),
y purga automática de un elemento con retención vencida — auditoría
central (`RecoveryAuditLog`) e historial propio del proyecto verificados
en cada paso. Datos de prueba eliminados al finalizar.

**Autor:** Claude Code
**Estado:** Implementado

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
