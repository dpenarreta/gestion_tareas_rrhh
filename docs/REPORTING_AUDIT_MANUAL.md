# Manual de Auditoría — Executive Reporting Engine

> Procedimiento completo para reconstruir, verificar y auditar cualquier
> reporte generado por el Executive Reporting Engine 2.0. Documenta
> mecanismos YA IMPLEMENTADOS (`src/lib/executiveReporting/`) — no describe
> funcionalidad futura (ver `ROADMAP.md` § Planificado, Sprint R, para la
> validación activa aún no implementada).
>
> FPS Parte V, Capítulo 6.

---

## 1. Report ID

**Formato de un reporte generado en vivo:**
```
NXR-YYYYMMDD-HHMMSS-XXXX
```
- `YYYYMMDD-HHMMSS`: timestamp en **huso de negocio** (UTC-5,
  `BUSINESS_TZ_OFFSET_HOURS`, `businessTime.ts`) — no el huso del servidor,
  para que el Report ID coincida con la hora que el usuario reconoce como
  "cuándo lo generé".
- `XXXX`: sufijo de 4 caracteres aleatorios, alfabeto sin `0/O/1/I`
  (`SUFFIX_ALPHABET`, `reportId.ts`) — evita ambigüedad al leer el Report ID
  impreso.

**Formato de un reporte migrado (legacy):**
```
NXR-LEGACY-YYYYMMDD-XXXX
```
Sin componente de hora — el `MonthlyReport` original no registraba la hora
exacta de generación. El prefijo `LEGACY` evita que se confunda con un
Report ID nativo.

**Unicidad:** garantizada por un constraint `@unique` en base de datos sobre
`reportId`, no solo por el generador. `createSnapshot`
(`snapshotStore.ts`) reintenta hasta 5 veces con un Report ID nuevo ante una
colisión (`P2002` en el campo `reportId`); si se agota el límite, la
generación falla y se audita como `generation_failed` — nunca se persiste un
Report ID duplicado.

**Dónde aparece:** Portada, Metadatos, pie de página de las 11 páginas, y
todo registro de `ExecutiveReportAuditLog` asociado — verificable sin
necesidad de abrir el reporte completo.

**Verificación de formato válido:** `isValidReportIdFormat(id)`
(`reportId.ts`) — acepta ambos formatos (nativo y legacy).

## 2. Snapshot

Cada reporte generado es una fila en `ExecutiveReportSnapshot` (Prisma) —
nunca una fila reutilizada. El campo `data` contiene el
`ExecutiveReportSnapshotData` completo, tal cual lo produjo el builder — no
un resumen. Campos clave para auditoría (además de `reportId`):

| Campo | Qué documenta |
|---|---|
| `type` | `MENSUAL` \| `RANGO_MESES` \| `RANGO_PERSONALIZADO` |
| `scope` | `JEFE` \| `COORDINADOR` — etiqueta de visualización derivada del rol del generador, no control de acceso (el roster real es `collaboratorIds`). |
| `origin` | `GENERATED` (motor en vivo) \| `LEGACY_MIGRATION` (backfill, ver § 6). |
| `integrityFlag` | `FULL` \| `PARTIAL` — ver § 2.1. |
| `collaboratorIds` / `collaboratorCount` | Roster congelado — la fuente de verdad del alcance del reporte, independiente de quién lo consulte después. |
| `generatedBy` / `generatedAt` | Quién y cuándo — `generatedAt` es el instante REAL de generación, distinto de `fechaCorte` (ver § 4). |
| `filters` | El `ExecutiveReportFilters` exacto usado (JSON) — permite reconstruir qué parámetros produjeron este reporte. |
| `dataQuality` | Verbatim de `analytics.computeDataQuality` — ver § 5. |
| `generationMs` | Tiempo real que tomó construir el snapshot — insumo del Benchmark de Calidad (`REPORTING_QUALITY_BENCHMARK.md`). |

### 2.1 Snapshot Integrity (`integrityFlag`)

- **`FULL`**: todo reporte construido por los 3 builders en vivo
  (`buildMonthlySnapshotData`/`buildRangeSnapshotData`/
  `buildCustomRangeSnapshotData`) — datos completos, sin reconstrucción.
- **`PARTIAL`**: exclusivo de `origin: LEGACY_MIGRATION`. Ningún
  `MonthlyReport` histórico registró calidad de dato, versiones de
  motor/fórmulas, ni narrativa NOVA estructurada — no puede reconstruirse
  1:1 el esquema nuevo, así que se marca explícitamente en vez de simular
  esos campos.

**Qué garantiza la integridad estructural hoy:** un único Builder canónico
llama a las mismas funciones de `analytics.ts` que Dashboard/Analytics ya
usan — dos superficies no pueden divergir si comparten la misma función y el
mismo objeto de snapshot. **Qué NO existe todavía:** una validación ACTIVA
en tiempo de ejecución que vuelva a consultar Dashboard/Analytics al generar
y compare/registre una discrepancia puntual — decisión explícita, diferida
como Sprint R (`ROADMAP.md` § Planificado; `docs/AUDIT_LOG.md` § Decisión
9).

## 3. Inmutabilidad

`Object.freeze` profundo (`deepFreeze`, `buildSnapshotData.ts`) se aplica al
snapshot completo antes de devolverlo — cualquier intento de mutación desde
código lanza en runtime. A nivel de base de datos, `createSnapshot` **solo
inserta**, nunca actualiza (`prisma.executiveReportSnapshot.create`, nunca
`.update`) — un reporte ya emitido no puede modificarse ni por accidente ni
por diseño. La lectura (`GET /api/reports/executive/[reportId]`) devuelve
`data` tal cual se persistió — nunca recalcula.

## 4. Fecha de Corte

Toda la información de un snapshot se calcula únicamente **hasta** la fecha
de corte — nunca después. Mecánica exacta (`buildSnapshotData.ts`):

1. **Consultas y carga real** (`TaskActivity.createdAt`, `Task.completedAt`
   de tareas FIJA): se acota directamente el límite superior de la consulta
   a base de datos — son campos con marca de tiempo real, sin ambigüedad.
2. **Estado de cumplimiento de una tarea**: NEXO no lleva historial de
   `status` por tarea (solo el status ACTUAL). Se reconstruye vía
   `asOfFechaCorte` — una tarea marcada `COMPLETADA` cuyo `completedAt` es
   **posterior** a la fecha de corte se trata, para este cálculo, como si
   aún no estuviera completada (el status real en ese instante es
   desconocido, así que se asume el más conservador). Es una vista de solo
   lectura — nunca modifica la tarea real.

**Valor por defecto:** si `filters.fechaCorte` no viene informado, el corte
reproduce el comportamiento histórico — el menor entre el fin del período y
"ahora" (`earlier(end, now)`).

**Limitación conocida, documentada explícitamente:** `computeDataQuality` y
`computeTeamMonthlySnapshots` (tendencias) no aceptan un parámetro de corte
hoy — se evalúan sobre el estado actual del sistema, no "a la fecha de
corte". Extenderlas queda fuera de alcance de este motor (no se toca
`analytics.ts`/`reportInsights.ts`) — es una limitación reconocida, no un
olvido.

## 5. Calidad del dato vs. Confiabilidad — dos conceptos distintos

| Concepto | Fuente | Visibilidad | Gobierna |
|---|---|---|---|
| **Calidad del dato** (`dataQuality.pct`/`issues`) | `analytics.computeDataQuality(userIds)` — **siempre** viene de Analytics, nunca se calcula en el módulo de reportes (FPS Parte IV §11). | Siempre visible — Portada (Semáforo Ejecutivo) y Metadatos. | Un porcentaje objetivo sobre problemas detectados: tareas sin tiempo objetivo, fechas inconsistentes, consultas sin actividad registrada, ausencia de configuración de horas efectivas. |
| **Confianza de NOVA** (`Muy Alta`/`Alta`/`Media`/`Baja`) | `computeNovaConfidence` (`nova/confidence.ts`) — determinista, sin IA, combina `dataQualityPct` + tamaño del equipo. | Interna — gobierna la profundidad narrativa, no necesariamente un campo visible en el documento. | Cuánto puede profundizar/extrapolar el texto de NOVA — ver `REPORTING_NOVA_WRITING_GUIDE.md` § Nivel de confianza. |

**Caso centinela — roster vacío:** `computeDataQuality([])` devuelve
`{ pct: 100, issues: [] }` (mismo valor que usa el backfill legacy para
reportes sin forma de calcularlo) — "100% sin observaciones" es el valor
neutro de "no aplica", no una afirmación de calidad real. Ver
`REPORTING_EDGE_CASES.md` § Sin colaboradores.

## 6. Reconstrucción histórica (backfill)

`scripts/backfill-executive-report-snapshots.ts` — script de una sola
corrida, dry-run por defecto, que migró los `MonthlyReport` históricos
(anteriores a v1.22.0) a `ExecutiveReportSnapshot` con `origin:
LEGACY_MIGRATION`. Principios operativos:

- **`MonthlyReport` nunca se modifica ni se borra** — el script solo lee de
  ahí; sigue existiendo, intacto, como tabla legacy.
- **Idempotente**: cada fila migrada guarda `legacyMonthlyReportId` — una
  segunda corrida detecta las ya migradas y las omite, nunca duplica.
- **`generatedAt`** = `MonthlyReport.createdAt` original (preserva la fecha
  real de generación histórica, no la fecha de la migración).
- **`migratedAt`** = instante de la corrida del backfill (fecha distinta,
  registrada aparte).
- **Ejecutado y verificado** el 2026-07-28: 4 `MonthlyReport` encontrados, 4
  migrados, 0 fallidos — re-corrida en `--dry-run` confirmó idempotencia
  (0 pendientes).

## 7. Versiones

Cada snapshot registra 4 versiones (`SnapshotVersions`,
`currentExecutiveReportVersions()`, `version.ts`), visibles en Portada y
Metadatos:

| Versión | Fuente | Cambia cuando... |
|---|---|---|
| `analyticsEngineVersion` | `ANALYTICS_ENGINE_VERSION`, `analytics.ts` | Se modifica el motor de cálculo determinista. |
| `formulaSetVersion` | `FORMULA_SET_VERSION`, `analytics.ts` | Se modifica una fórmula individual. |
| `reportingEngineVersion` | `EXECUTIVE_REPORTING_ENGINE_VERSION`, `version.ts` (hoy `"2.0"`) | Se modifica la estructura del Executive Reporting Engine mismo. |
| `nexoVersion` | `package.json` (vía `version.ts`) | Cualquier release de NEXO — misma fuente que `docs/VERSION.md`. |

Reportes `LEGACY_MIGRATION` registran literales explicativos ("desconocida
— pre Executive Reporting Engine 2.0") en vez de un valor inventado, salvo
`reportingEngineVersion: "legacy"`.

## 8. Procedimiento de auditoría — `ExecutiveReportAuditLog`

Registro append-only, best-effort (`logReportAudit` nunca lanza — un fallo
de auditoría no debe romper la generación o lectura de un reporte real).
Acciones definidas en `ReportAuditAction` (`snapshotStore.ts`):

| Acción | Emitida hoy en... | Estado |
|---|---|---|
| `generated` | `POST /api/reports/executive`, al persistir exitosamente | **Activa** |
| `generation_failed` | `POST /api/reports/executive`, catch — Report ID provisional, paso del proceso, mensaje técnico (nunca expuesto al cliente) | **Activa** |
| `nova_degraded` | `attachNovaNarrative` (`buildSnapshotData.ts`), cuando ≥1 sección de NOVA cae a fallback | **Activa** |
| `viewed` | `GET /api/reports/executive/[reportId]` | **Activa** |
| `exported_pdf` | — | Declarada en el tipo, **no emitida por ningún caller todavía** — `MonthlyReports.tsx`/`ReportWizardModal.tsx` exportan sin auditar la exportación en sí. |
| `exported_excel` | — | Igual que `exported_pdf`. |
| `legacy_migrated` | — | Declarada en el tipo, **no emitida** — el script de backfill inserta el `ExecutiveReportSnapshot` directamente, sin llamar a `logReportAudit`. |

**Nota de auditoría honesta:** las últimas 3 acciones existen en el tipo
como superficie reservada, no como funcionalidad activa — cualquier
verificación de auditoría que asuma que "toda exportación queda registrada"
debe saber que ese registro no ocurre hoy. Cerrar esa brecha (si se decide
necesaria) requiere una llamada explícita a `logReportAudit` desde los
puntos de exportación — no está en el roadmap actual porque no fue
solicitado, no porque se haya evaluado y descartado.

**Procedimiento para reconstruir la historia de un reporte:**
1. Localizar la fila `ExecutiveReportSnapshot` por `reportId`.
2. Leer `filters`, `generatedBy`, `generatedAt`, `fechaCorte`,
   `analyticsEngineVersion`/`formulaSetVersion`/`reportingEngineVersion`/
   `nexoVersion` — reconstruye exactamente qué se pidió y con qué versión
   del motor.
3. Consultar `ExecutiveReportAuditLog` filtrado por `reportId` — reconstruye
   cuándo se generó, si NOVA degradó, si falló algún intento previo, y
   quién lo vio después.
4. Comparar `data.meta.generationMs` contra el Benchmark de Calidad
   (`REPORTING_QUALITY_BENCHMARK.md`) si la auditoría es de rendimiento.
