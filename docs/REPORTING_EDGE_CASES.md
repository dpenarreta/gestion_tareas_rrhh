# Casos Límite — Executive Reporting Engine

> Documenta el comportamiento YA IMPLEMENTADO del motor ante situaciones
> excepcionales — verificado contra el código real de
> `src/lib/executiveReporting/`, no especulado. No introduce lógica nueva
> (FPS explícito: "no implementar nueva lógica, únicamente documentar"). Cuando
> el comportamiento actual es una limitación conocida en vez de un diseño
> deliberado, se marca explícitamente como tal.
>
> FPS Parte V, Capítulo 7.

---

## Sin colaboradores

Un roster vacío (`userIds: []` — por ejemplo, un filtro de rol/colaboradores
que no matchea a nadie visible para el generador) no hace fallar la
generación. `computeDataQuality([])` devuelve el valor centinela `{ pct:
100, issues: [] }` (no una medición real, sino "no aplica"); `members`,
`ranking`, `alerts`, `consultasByReason` quedan como arreglos vacíos;
`avgCumplimiento`/`avgCargaPct` caen a `0` (guardados por `length > 0 ? ... :
0` en todo el builder, nunca una división por cero). El reporte se genera y
persiste igual, con `collaboratorCount: 0` — un Director puede confirmar
"no había nadie visible en este filtro" sin que el sistema devuelva un
error.

## Sin tareas

Un colaborador (o el equipo completo) sin tareas en el período produce
`completedPct`/`score` en sus valores neutros de los mismos guards de
división por cero — no un error. El Estado Operativo
(`deriveEstadoOperativo`) y el Principal Hallazgo se calculan igual sobre
esos valores neutros; no hay una categoría especial de "sin actividad" en el
documento — se lee como cualquier otro colaborador con métricas bajas o en
cero, interpretado por NOVA en Executive Insights si es relevante para el
período.

## Datos incompletos

`computeDataQuality` (`analytics.ts`) detecta y cuenta, sin bloquear la
generación: tareas sin tiempo objetivo definido (`tasksSinEstimar`), fechas
de tarea inconsistentes (`fechasInconsistentes`), tareas SEGUIMIENTO sin
ninguna actividad registrada (`seguimientoSinActividad`), y ausencia total de
configuración de horas efectivas (`sinHorasConfig`). Cada uno reduce
`dataQuality.pct` y aparece como un `issue` con su `label`/`count` —
**visible en Portada/Metadatos**, nunca oculto. El resto del cálculo procede
normalmente sobre los datos disponibles; "datos incompletos" reduce la
confianza declarada del reporte, no impide que se genere.

## Snapshot parcial (`integrityFlag: PARTIAL`)

Exclusivo de reportes `origin: LEGACY_MIGRATION` (ver
`REPORTING_AUDIT_MANUAL.md` § 2.1 y § 6). El documento se genera con las
páginas narrativas de NOVA (Executive Summary/Insights/Assessment) en "No
disponible" y Analytics Predictivo siempre no disponible, en vez de simular
contenido que el `MonthlyReport` original nunca produjo. El sidebar de
`MonthlyReports.tsx` marca estos reportes con la etiqueta visible "Legacy" —
nunca se presentan como indistinguibles de un reporte `FULL`.

## Reportes LEGACY

Ver `REPORTING_REFERENCE_LIBRARY.md` § Reportes LEGACY para el detalle
página por página. En resumen: mismo formato de documento, Report ID con
prefijo `NXR-LEGACY-`, sin componente de hora, `origin`/`integrityFlag`
siempre `LEGACY_MIGRATION`/`PARTIAL`, `reportingEngineVersion: "legacy"`.

## Períodos futuros

**No existe una validación explícita que bloquee generar un reporte MENSUAL
de un mes futuro.** El builder lo procesará: como no hay actividad registrada
aún para ese período, el resultado son indicadores en sus valores neutros
(equivalente a "sin tareas"/"sin colaboradores" activos), sin error.

**Limitación conocida, no un diseño deliberado:** `resolveMonthlyPeriodStatus`
(`periodStatus.ts`) solo distingue entre "es el mes calendario actual"
(→ `EN_CURSO`) y "existe un `MonthClosure` para ese mes" (→ `CERRADO`) —
cualquier otro caso, incluyendo un mes futuro sin cierre (que por definición
nunca puede tenerlo), cae a `HISTORICO`. Un reporte de diciembre generado en
julio se etiquetaría `HISTORICO` pese a no haber ocurrido todavía — la
función no fue diseñada pensando en períodos futuros, solo en
"actual/cerrado/no cerrado". No se corrige aquí (fuera de alcance de esta
Parte V, que no modifica código) — queda documentado como comportamiento
real a tener en cuenta si se genera un reporte de un período que aún no
comenzó.

## Fecha de corte anterior al inicio del período

`filters.fechaCorte` no tiene una validación explícita de "debe ser ≥ inicio
del período". Si se pasa una fecha de corte anterior al inicio, el cálculo
de `dataUpperBound` (`earlier(end, cutoff)`) resulta en un límite superior
menor que el límite inferior de las consultas (`gte: start, lte:
dataUpperBound` con `dataUpperBound < start`) — Prisma devuelve
consistentemente cero filas para ese rango imposible, no un error. El
resultado es un reporte válido con todos los indicadores en cero (equivalente
a "sin tareas" en la sección anterior), reflejando correctamente que "no hay
datos hasta ese corte" — no es un bug, es el comportamiento correcto de una
consulta con rango vacío, aunque no está pensado como una entrada válida
esperada desde la UI (ningún selector de fecha de corte se expone hoy en
`MonthlyReports.tsx`/`ReportWizardModal.tsx` — el parámetro existe en
`ExecutiveReportFilters` pero no tiene interfaz de usuario todavía).

## Datos inconsistentes

Una tarea con `startDate` posterior a `endDate` (el caso que
`computeDataQuality` cuenta como `fechas_inconsistentes`) **no se descarta ni
se corrige** en el resto del pipeline — se cuenta como observación de
Calidad del Dato (reduce `dataQuality.pct`), pero `isTaskOverdue`,
`computeCompletedPctAny` y el resto de los cálculos la procesan igual que
cualquier otra tarea, sin una validación adicional que la excluya. El reporte
señala la inconsistencia (visible en Portada/Metadatos vía Calidad del Dato)
en vez de ocultarla filtrando la tarea silenciosamente.

## Usuario sin permisos

Los 3 endpoints (`POST /api/reports/executive`, `GET .../[reportId]`,
`GET .../list`) aplican el mismo criterio, en el mismo orden:

1. Sin sesión válida (`getSession()` devuelve `null`) → `401 No autenticado`.
2. Con sesión pero `role` fuera de `CAN_ACCESS_REPORTS`
   (`ADMINISTRADOR`/`JEFE_NACIONAL`/`COORDINADOR_NACIONAL`) →
   `403 Sin permisos`.

**Verificación adicional exclusiva de la lectura por Report ID**
(`GET .../[reportId]`): incluso un usuario con permisos de reportes recibe
`403 Sin permisos` si el `scope` del snapshot (`JEFE`/`COORDINADOR`) no
coincide con el `scope` que le correspondería a su propio rol
(`scopeForRole`) — un `COORDINADOR_NACIONAL` no puede leer, por Report ID
directo, un snapshot generado originalmente bajo `scope: JEFE`, aunque
adivine o guarde el identificador. El criterio de acceso es el `scope` del
snapshot en el momento en que se generó, no una recomprobación de
`collaboratorIds` contra la visibilidad actual del visor — un snapshot
representa la autoridad del generador en su momento.
