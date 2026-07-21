# Analytics Calculation Registry

**Sprint: Consolidación del Analytics Engine — Auditoría técnica**
Fecha: 2026-07-21
Alcance: solo lectura/documentación. No se modificó Prisma, APIs públicas, componentes visuales, KPIs existentes ni fórmulas validadas.

---

## FASE 1 — Inventario de cálculos

### 1.1 Motor central (`src/lib/analytics.ts`, v1.5.0 / `FORMULA_SET_VERSION` 4.2)

| Indicador | Función | Dependencias | Origen de datos |
|---|---|---|---|
| Score simple (legacy, 0-100) | `computeSimpleScore` | — (pura) | `completedPct`, `cargaRatio`/`cargaPct`, `avgProgress`, `totalComments` (todos calculados por el caller) |
| Ratio horas estimadas/reales | `computeEstimatedVsRealRatio` | — (pura) | `Task.estimatedHours`, `Task.realHours` |
| Histórico mensual (base de tendencias/anomalías) | `computeMonthlyHistory` | `businessCalendarDay`, `businessDayRealRange`, `isBusinessDay`, `monthlyBusinessBase`, `isTaskOverdue` | `Task`, `TaskActivity` |
| Histórico semanal (consistencia/predicción/alertas) | `computeWeeklyHistory` | `businessCalendarDay`, `businessDayRealRange`, `getHolidaySet`, `getEffectiveHorasEfectivas`, `isWorkingDay`, `countBusinessDays` | `Task`, `TaskActivity` |
| Tendencias (cumplimiento/carga vs. semana/mes/6 meses) | `computeTrends` (+ `computeTrendGeneric`, `computeCargaTrend`) | `computeMonthlyHistory`, `computeWeeklyHistory` | resultado de las dos funciones anteriores |
| Fecha efectiva de inicio de historial | `computeEffectiveHistoryStart` | — | `User.kpiStartDate`, `User.createdAt`, primer `TaskActivity`, primera tarea completada, primera imputación de horas |
| Consistencia (CV semanal) | `computeConsistency` (+ `consistencyLevelFromCv`, `consistencyPctFromCv`, `consistencyReliabilityFromWeeks`) | `computeWeeklyHistory`, `computeEffectiveHistoryStart`, `getLeaveMinutesByDay`, `getHolidaySet`, `isWorkingDay` | `Task`, `TaskActivity`, `LeaveRecord` |
| Detección de anomalías | `detectAnomalies` | `computeMonthlyHistory`, `getEffectiveAnalyticsConfig` | histórico mensual |
| Predicción (próxima semana / cierre de mes) | `computePrediction` (+ `computePredictionConfidencePct`, `computeMonthlyCompliancePace`) | `computeWeeklyHistory`, `computeCargaTiempo`, `computeConsistency`, `getEffectiveAnalyticsConfig` | `Task` (regresión lineal simple sobre horas semanales), `computeCargaTiempo` |
| Score de Salud Laboral (LEGACY) | `computeHealthScore` (+ `cargaHealthScore`, `consistencyToScore`, `capacityToScore`) | `computeCargaTiempo`, `computeCapacityForecast`, `computeConsistency`, `monthlyBusinessBase`, `getEffectiveAnalyticsConfig` | `Task` del mes en curso + los 3 anteriores |
| Performance Score | `computePerformanceScore` (+ `computeTrazabilidadRaw`) | `computeConsistency`, `computeWeeklyHistory`, `normalize` (NormalizationEngine), `getEffectiveCurve`, `getEffectiveAnalyticsConfig` | `Task`, `Comment`, `TaskActivity` del mes en curso |
| Índice de Riesgo Operativo | `computeOperationalRisk` (+ `computeSeguimientoConcentration`, `classifyOperationalRisk`) | `computeCapacityForecast`, `computeTrends`, `computeConsistency`, `computeCargaTiempo`, `getEffectiveAnalyticsConfig` | `Task` abiertas, `TaskActivity` de tipo SEGUIMIENTO |
| Tendencia de score (semana/mes/6m) | `getScoreTrendHistory` (+ `getScoredAuditHistory`, `closestScoredPoint`) | `AnalyticsAuditLog` (kind `performance_score`/`operational_risk`) | tabla de auditoría, no recalcula |
| Calidad de los datos | `computeDataQuality` | — | `Task` (sin estimar, fechas inconsistentes), `SystemConfigHistory` |
| Precisión del Tiempo Objetivo | `computeTargetTimePrecision` | `getOfficialTargetTime`, `isTargetTimeValidated`, `computePrecisionPct`, `precisionClassification` (todas de `targetTime.ts`) | `Task` completadas del mes con horas reales > 0 |
| Motor de alertas automáticas | `computeAlerts` | `computeCapacityForecast`, `computeCargaHistory`, `computeTrends`, `computeMonthlyHistory`, `computeWeeklyHistory`, `getEffectiveAnalyticsConfig` | agregación de los cálculos anteriores + `Task` abiertas |
| Historial de alertas resueltas | `getResolvedAlertsHistory` | `AnalyticsAuditLog` (kind `alerts`) | tabla de auditoría |
| Recomendaciones de redistribución (equipo) | `computeTeamRecommendations` | `computeTeamCapacityForecast`, `capacityToScore`, `classifyCapacity`, `getEffectiveAnalyticsConfig` | `capacityForecast.ts` por miembro |
| Validación de consistencia matemática | `validateAnalyticsConsistency`, `validateCumplimientoConsistency` | — | resultados ya calculados de otros KPIs (doble-check, no recalcula) |
| Pipeline único del motor | `runAnalyticsPipeline` | orquesta: `computeDataQuality`, `computeConsistency`, `computeHealthScore`, `computePerformanceScore`, `computeTrends`, `computePrediction`, `computeCapacityForecast`, `validateAnalyticsConsistency`, `detectAnomalies`, `computeAlerts`, `getResolvedAlertsHistory` | — |
| Motor de Benchmarks Inteligente (3 niveles) | `computeSmartBenchmark` (+ `buildCargoBenchmark`, `buildCargoBenchmarkCarga`, `buildCargoLimitadoBenchmark`, `buildPersonalFromAuditHistory`, `buildPersonalFromWorkHistory`, `buildPersonalCapacidadFutura`) | `computePerformanceScore`, `computeOperationalRisk`, `computeMonthlyHistory`, `computeCapacityForecast`, `getEffectiveRoleTarget`, `getScoredAuditHistory` | pares del mismo `Role`, `AnalyticsAuditLog`, `computeMonthlyHistory`/`computeWeeklyHistory` |
| Evolución Personal | `computePersonalEvolution` | `getScoredAuditHistory`, `closestScoredPoint` | `AnalyticsAuditLog` (kind `performance_score`) |

### 1.2 Motores satélite (single-purpose, importados por analytics.ts)

| Indicador | Archivo / función | Dependencias | Origen de datos |
|---|---|---|---|
| Carga laboral (diaria/semanal/mensual) | `src/lib/workload.ts` → `computeCargaTiempo`, `computeCargaHistory` (+ `computeWorkloadRange`, `computeWorkloadPct`, `sumWeightedBaseHours`, `monthlyBusinessBase`, `monthlyBusinessBaseForUsers`) | `businessTime.ts`, `holidays.ts`, `leaves.ts`, `specialStatus.ts`, `systemConfig.ts` | `Task` (FIJA), `TaskActivity`, `LeaveRecord`, `SpecialStatus`, `SystemConfigHistory`, `Holiday` |
| Capacidad disponible/proyectada | `src/lib/capacityForecast.ts` → `computeTeamCapacityForecast`, `computeCapacityForecast` (+ `classifyCapacity`) | `businessTime.ts`, `holidays.ts`, `leaves.ts`, `specialStatus.ts`, `workload.ts` (`isWorkingDay`, `countBusinessDays`, `sumWeightedBaseHours`), `targetTime.ts` (`getOfficialTargetTime`) | `Task` (PENDIENTE/EN_PROGRESO), `LeaveRecord`, `SpecialStatus`, `Holiday` |
| Cumplimiento por prioridad | `src/lib/priorityCompliance.ts` → `computePriorityCompliance` (+ `isCompletedOnTime`) | — (pura) | tareas del período con `priority`/`status`/`completedAt`/`endDate` |
| Normalización 0-100 (curvas) | `src/lib/normalizationEngine.ts` → `normalize`, `interpolateCurve` | `getEffectiveCurve` (systemConfig.ts) | puntos de control configurables (`SystemConfigHistory`) o `DEFAULT_CURVES` |
| Tiempo Objetivo / desviación / precisión | `src/lib/targetTime.ts` → `getOfficialTargetTime`, `computeDeviation`, `computePrecisionPct`, `precisionClassification`, `buildHistoricalDeviationInsight` | — (puras) | `Task.estimatedHours`/`targetTimeValidated`/`realHours` |
| Configuración efectiva del motor | `src/lib/systemConfig.ts` → `getEffectiveAnalyticsConfig`, `getEffectiveCurve`, `getEffectiveRoleTarget`, `getEffectiveHorasEfectivas`, `getEffectiveWorkloadLimit{Low,High,Overload}` | — | `SystemConfigHistory` (con vigencia temporal) |
| Alertas de riesgo (legado, panel "Mis KPIs") | `src/lib/riskAlerts.ts` → `computeRiskAlerts` | `isTaskOverdue`, `businessCalendarDay`, `isBusinessDay` | `Task` abiertas, último `TaskActivity`, `WorkloadLabel`/`cargaPct` recibidos como parámetro |

### 1.3 Capa de decisión / narrativa (Sprint 6, sin recalcular KPIs)

| Indicador | Archivo / función | Dependencias | Origen de datos |
|---|---|---|---|
| Insights de 4 bloques | `src/lib/insightsEngine.ts` → `computeInsights` | factores de `computeOperationalRisk` (ya calculados), `computeMonthlyHistory` | `OperationalRiskResult.factors`, histórico mensual |
| Relaciones entre indicadores | `computeIndicatorRelations` | — (pura, recibe todo ya calculado) | histórico mensual, consistencia, riesgo, capacidad |
| Benchmark personal (Performance Score) | `computePersonalBenchmark` | `AnalyticsAuditLog` (kind `performance_score`) | tabla de auditoría |
| Reevaluación de recomendaciones | `computeRecommendationReevaluation` | `AnalyticsAuditLog` (kind `alerts`/`operational_risk`) | tabla de auditoría |
| Priorización (S6-H) | `prioritizeRecommendations`, `prioritizeInsights` | — (pura) | listas ya calculadas de recomendaciones/insights |
| Confianza (★) de Insights | `computeConfidence` | — (pura) | observaciones, calidad de datos, consistencia (ya calculados) |
| Capa de explicabilidad (Sprint 6.5) | `src/lib/analyticsExplain.ts` → `scoreLevel`, `reliabilityPctFromStars`, `reliabilityPctFromObservations`, `confidenceLabel` | — (puras, sin BD) | valores ya calculados por el motor |

### 1.4 Capas de UI que consumen todo lo anterior (verificado, con matices)

`AdvancedAnalytics.tsx`, `AnalyticsModule.tsx`, `InsightCards.tsx`, `InsightsPanel.tsx`, `OperationalRiskCard.tsx`, `SmartBenchmark.tsx` — se revisaron los ~2.100 líneas combinadas. Ninguno recalcula un KPI de negocio (score, riesgo, carga, capacidad) a partir de datos crudos — son presentación sobre props ya calculadas por `/api/analytics/*` y `/api/kpis/*`. Sí se detectaron, en una segunda pasada de verificación (agente de exploración independiente), pequeñas heurísticas de presentación reimplementadas en más de un componente — ver **D9** y **D10** en Fase 2.

---

## FASE 2 — Duplicaciones detectadas

### 🔴 D1 — "Cumplimiento" (% completado) tiene DOS definiciones distintas, reimplementadas en 8 lugares

**Duplicación encontrada:** dos fórmulas de "cumplimiento" coexisten bajo el mismo nombre de campo (`completedPct`), sin una función compartida:

- **Definición A — "completado en cualquier momento"**: `tasks.filter(t => t.status === "COMPLETADA").length / total`. Reimplementada inline (no vía función compartida) en:
  - `src/lib/analytics.ts` — `computeMonthlyHistory` (L317), `computeHealthScore` (L905), `computePerformanceScore` (L1020), `computeMonthlyCompliancePace` (L778) — **4 copias dentro del propio motor central**.
  - `src/app/api/kpis/team/route.ts` (L95-97)
  - `src/app/api/kpis/executive/route.ts` (L141-142)
  - `src/app/api/kpis/me/range/route.ts` (L123-124)
  - `src/app/api/reports/generate/route.ts` (L250-252)
  - `src/app/api/reports/range/route.ts` (L253-254, y de nuevo para `totalCompletedTasks` en L305/L516)
  - `src/app/api/dashboard/route.ts` (L82-83) — ver también **D6**.
- **Definición B — "completado A TIEMPO"**: `isCompletedOnTime` (`src/lib/priorityCompliance.ts`), usada en `src/app/api/kpis/[userId]/route.ts` y `src/app/api/kpis/me/route.ts` (con comentario explícito reconociendo el cambio de definición — "Analytics § Sprint 1").

**Archivos involucrados:** `analytics.ts` (×4), `kpis/team`, `kpis/executive`, `kpis/me/range`, `reports/generate`, `reports/range`, `dashboard/route.ts` (Definición A — **9 implementaciones inline** en total) vs. `kpis/[userId]`, `kpis/me` (Definición B).

**Riesgo:** Alto. Un mismo colaborador puede ver un % de "Cumplimiento" distinto en su página personal (`/kpis` → Definición B, a tiempo) que en el ranking ejecutivo, el reporte mensual o el panel de equipo (Definición A, cualquier momento) — para el mismo mes, sin que ninguna UI aclare la diferencia. `validateCumplimientoConsistency` solo compara cumplimiento general vs. por prioridad (ambos Definición B) — no detecta el desacuerdo entre A y B porque nunca los cruza.

**Recomendación:** No unificar en este sprint (fuera de alcance). Registrar como candidato a fusión futura: extraer una función única `computeCompletedPct(tasks, mode: "any" | "onTime")` en `priorityCompliance.ts` o `analytics.ts`, y hacer que las 8 reimplementaciones inline la llamen. Decidir primero, con el negocio, cuál definición es la oficial (o si ambas deben coexistir con nombres de campo distintos, p. ej. `completedAnyPct` vs. `completedOnTimePct`, para que dejen de compartir el nombre `completedPct`).

### 🟠 D2 — Dos motores de alertas de riesgo independientes y paralelos

**Duplicación encontrada:** `computeRiskAlerts` (`src/lib/riskAlerts.ts`) y `computeAlerts` (`src/lib/analytics.ts` §1, "Motor de alertas automáticas") cubren superficies solapadas (tareas vencidas, carga laboral fuera de rango óptimo) con reglas, severidades y redacción de mensaje completamente independientes.

**Archivos involucrados:**
- `computeRiskAlerts` (`riskAlerts.ts`) — consumida por `src/app/api/kpis/[userId]/route.ts` y `src/app/api/kpis/me/route.ts` (panel básico "Mis KPIs").
- `computeAlerts` (`analytics.ts`) — consumida por `runAnalyticsPipeline` → `src/app/api/analytics/[userId]/route.ts` y `src/app/api/kpis/nova-insights/[userId]/route.ts` (panel avanzado de Analytics + Nova).

**Riesgo:** Medio. No hay contradicción de datos (cada uno lee `Task`/`TaskActivity` en vivo), pero sí de **criterio**: `computeRiskAlerts` marca "tareas vencidas" con cualquier cantidad > 0 y "carga fuera de rango" con cualquier desviación; `computeAlerts` usa umbrales configurables (`alertOverdueTaskThreshold`, `alertConsecutiveOverloadDays`) y produce severidades escalonadas (red/orange/yellow). Un cambio en la configuración del motor (Ajustes) solo afecta a `computeAlerts`, dejando a `computeRiskAlerts` con umbrales fijos hardcodeados — un Administrador que sube el umbral de tareas vencidas en Ajustes verá el panel avanzado calmarse pero el básico seguir alertando igual.

**Recomendación:** Documentar (hecho) y evaluar en un sprint futuro si `riskAlerts.ts` debe retirarse en favor de `computeAlerts`, o si de verdad sirve un propósito distinto (alerta inmediata simple vs. motor configurable) que justifique mantener ambos con nombres que dejen clara la diferencia.

### 🟠 D3 — `computeSimpleScore` consolidado, pero alimentado con inputs semánticamente distintos según el caller

**Duplicación encontrada:** `computeSimpleScore(completedPct, cargaRatio, avgProgress, totalComments)` ya es una única función (consolidada en Sprint 4 §S4-B, ver comentario en `analytics.ts` L108-116) — el código en sí NO está duplicado. Pero el segundo parámetro (`cargaRatio`) recibe dos magnitudes distintas según quién llama:

- `kpis/[userId]`, `kpis/team`, `kpis/me`, `kpis/me/range` → pasan `computeEstimatedVsRealRatio(totalReal, totalEstimated)` (horas reales vs. estimadas de las tareas del período).
- `reports/generate`, `reports/range`, `kpis/executive` → pasan `cargaPct` (horas reales vs. base laboral del mes, de `computeWorkloadRange`/`computeWorkloadPct`).

**Archivos involucrados:** `kpis/[userId]`, `kpis/team`, `kpis/me`, `kpis/me/range` (ratio estimado/real) vs. `reports/generate`, `reports/range`, `kpis/executive` (% de carga vs. base).

**Riesgo:** Medio. El "Score" de un mismo colaborador para el mismo mes puede diferir entre su vista personal y el ranking ejecutivo/reporte porque el segundo factor de la fórmula mide cosas distintas, aunque la función y el nombre del resultado (`score`) sean idénticos.

**Recomendación:** Documentar (hecho). Si se retoma este KPI en un sprint futuro, renombrar el parámetro de `computeSimpleScore` para dejar explícito cuál de las dos magnitudes espera, o exponer dos variantes con nombre distinto.

### 🟡 D4 — `computeMonthlyCompliancePace` es una tercera variante de "cumplimiento", con proyección propia

`computeMonthlyCompliancePace` (`analytics.ts` L769-782, usada solo dentro de `computePrediction`) proyecta el cumplimiento de cierre de mes extrapolando el % actual por los días hábiles transcurridos vs. totales del mes. Usa la misma Definición A (`status === "COMPLETADA"`, no on-time) que el resto del motor central, así que es consistente con D1-Definición A, pero es una tercera fórmula (con proyección lineal) que nadie más reutiliza. Riesgo bajo — está correctamente encapsulada y usada en un solo lugar — se documenta por completitud de inventario, no requiere acción.

### 🔴 D6 — `/api/dashboard` (widget principal) reimplementa desde cero tres conceptos ya resueltos por el motor, sin importar `analytics.ts`/`workload.ts` en absoluto

**Duplicación encontrada:** `src/app/api/dashboard/route.ts` no importa ninguna función de `analytics.ts`, `capacityForecast.ts` ni `workload.ts` para sus tres métricas principales — las recalcula todas desde cero, con nombres que colisionan con los conceptos oficiales:

- **`workloadPct`** (L75-79): `totalReal / totalEstimated × 100` (horas estimadas vs. reales de las tareas del mes) — una **tercera variante** del ratio estimado/real (ya son dos: `computeEstimatedVsRealRatio` con centinela 200%, y la reimplementación sin centinela de D1). Esta tercera copia tampoco tiene el centinela de `computeEstimatedVsRealRatio`, y además **su nombre colisiona conceptualmente** con `computeWorkloadPct` (`workload.ts`), que mide algo totalmente distinto: horas reales vs. base laboral por días hábiles, no horas estimadas de tareas.
- **`completedPct`** (L82-83): `status === "COMPLETADA"` crudo — misma Definición A de D1, reimplementada una vez más.
- **`teamAlerts`** (L176-191): para cada subordinado visible, si `Σreal / Σestimated > 1` ese mes, se cuenta como "en alerta" — es una detección de sobrecarga **completamente paralela** a `computeWorkloadRange`/`cargaHealthScore`/`computeCapacityForecast`, sin usar ningún límite configurado (`workload_limit_high`/`overload`) ni el semáforo de 5 zonas.

**Archivos involucrados:** `src/app/api/dashboard/route.ts` (líneas 75-79, 82-83, 176-191).

**Riesgo:** Alto. Es el endpoint del **dashboard de inicio** (la primera pantalla que ve cualquier usuario) — su noción de "% de carga" y de "quién está sobrecargado" puede no coincidir con lo que la misma persona ve un clic después en `/kpis` o en Analytics, porque no comparte ni una sola función con esos módulos.

**Recomendación:** Documentar (hecho). Candidato prioritario a refactor en un sprint de unificación: reemplazar `workloadPct`/`teamAlerts` por `computeCargaTiempo`/`computeWorkloadRange` y `completedPct` por la función única que resulte de resolver D1.

### 🟠 D7 — Clasificación del Performance Score reimplementada en `kpis/executive` para el promedio del equipo

**Duplicación encontrada:** `src/app/api/kpis/executive/route.ts` (L230-231) recalcula inline los umbrales de clasificación (`>=90 Excelente / >=75 Bueno / >=60 Riesgo / <60 Crítico`, y el color `>=75 green / >=60 yellow / red`) para clasificar el **promedio del equipo** de Performance Score — exactamente los mismos umbrales que `computePerformanceScore` aplica al score individual (`analytics.ts` L1052-1053). No existe una función exportada `classifyPerformanceScore()` (a diferencia de `classifyOperationalRisk`, que sí existe y sí se reutiliza aquí mismo para el Riesgo Operativo del equipo, L232).

**Archivos involucrados:** `kpis/executive/route.ts` (L230-231) vs. `analytics.ts` (L1052-1053, dentro de `computePerformanceScore`).

**Riesgo:** Medio — hoy los umbrales coinciden porque se copiaron a mano, pero si `computePerformanceScore` cambia sus bandas de clasificación (p. ej. vía un ajuste de negocio), el bloque CEO del dashboard ejecutivo quedará desalineado silenciosamente porque no hay una función compartida que ambos consuman.

**Recomendación:** Extraer `classifyPerformanceScore(score)` en `analytics.ts` (mismo patrón que `classifyOperationalRisk`) y que ambos sitios la usen.

### 🟡 D8 — Simulador de escenarios reimplementa la aritmética de ponderación de puntos

**Duplicación encontrada:** `src/app/api/analytics/simulate/[userId]/route.ts` define localmente `pointsFor(score, weight)` (L110-112: `Math.round(((score * weight) / 100) * 100) / 100`) — aritméticamente idéntica a la que usa `mk()` dentro de `computeHealthScore` (`analytics.ts` L918) para convertir un sub-score en puntos ponderados. No existe una función exportada `weightedPoints()` en el motor, así que el simulador (que sí reutiliza correctamente `computeWorkloadRange`/`computeWorkloadPct`/`classifyCapacity`/`capacityToScore`/`cargaHealthScore`) tuvo que reescribir esta única línea de aritmética.

**Archivos involucrados:** `analytics/simulate/[userId]/route.ts` (L110-112) vs. `analytics.ts` (`mk()`, L918, interno a `computeHealthScore`).

**Riesgo:** Bajo — es una operación de una sola línea (`× peso / 100`), sin lógica de negocio propia; el simulador ya documenta explícitamente que reutiliza "las MISMAS fórmulas del motor" para todo lo demás.

**Recomendación:** Sin acción requerida en este sprint; si se extraen helpers compartidos en el futuro, incluir `weightedPoints()` en la lista.

### 🟡 D9 — `riskAlerts.ts` reimplementa "días hábiles entre fechas" sin excluir feriados

**Duplicación encontrada:** `businessDaysBetween` (`src/lib/riskAlerts.ts` L23-31) cuenta días hábiles usando solo `isBusinessDay` (lunes-viernes) — **no consulta el set de feriados configurados**, a diferencia de `countBusinessDays` (`workload.ts` L35-41), que sí excluye feriados. Se usa para la alerta "sin registro de actividades en los últimos N días laborables".

**Archivos involucrados:** `riskAlerts.ts` (L23-31) vs. `workload.ts` (`countBusinessDays`, L35-41).

**Riesgo:** Bajo-Medio — en semanas con feriado, esta alerta puede sobreestimar en 1 los "días laborables sin registro" (cuenta el feriado como día hábil exigible). Consistente con que `riskAlerts.ts` es, en general, un motor más simple y no configurable (ver D2).

**Recomendación:** Si se decide mantener `riskAlerts.ts` (en vez de retirarlo a favor de `computeAlerts`, ver D2), hacer que `businessDaysBetween` reciba el set de feriados y reutilice `countBusinessDays` de `workload.ts`.

### 🟡 D10 — Heurísticas de "confianza/madurez" (★) reimplementadas 3 veces con escalas distintas, y umbral de color 80/60 repetido en 4 sitios

**Duplicación encontrada:**
- Confianza por cantidad de historial: `consistencyReliabilityFromWeeks` (`analytics.ts` L584-589, semanas ≤4→baja/2★ … >12→muy-alta/5★), `computeConfidence` (`insightsEngine.ts` L44-51, compuesto de observaciones+calidad+consistencia con umbrales 0.85/0.65/0.45/0.25), y `maturityFromCount`/`maturityFromWeeks` (`AdvancedAnalytics.tsx` L89-105, con umbrales propios `[1,3,6,10]` y `1/2/4/6` semanas) — tres implementaciones del mismo concepto ("¿cuánto confiar en este número según su historial?"), cada una con su propia escala, sin una función compartida.
- Umbral de color 80/60 para "bueno/regular/malo": `cumplimientoColor` (repetido en `kpis/[userId]`, `kpis/me`, `kpis/executive`) y `resultBarClass` (`InsightCards.tsx` L61-65) — mismo criterio visual reimplementado 4 veces.
- Re-derivación de `normalizedValue = f.points / f.weight × 100` para el modal "¿Cómo se obtuvo?", duplicada entre `AdvancedAnalytics.tsx` (L820) y `OperationalRiskCard.tsx` (L133) — es una inversión de un cálculo ya hecho (no una fórmula de negocio nueva), pero vive en dos componentes en vez de un helper compartido.

**Riesgo:** Bajo — son heurísticas de presentación (colores, estrellas), no alteran ningún KPI numérico expuesto en `AnalyticsBundle`/`KpiData`. El riesgo es de mantenimiento (4-5 lugares a actualizar si cambia el criterio) y de coherencia visual (dos tarjetas de confianza podrían mostrar un número distinto de estrellas para la "misma" confianza si sus escalas divergen).

**Recomendación:** Sin acción requerida en este sprint. Candidato a un pequeño refactor de "helpers de presentación compartidos" (p. ej. mover a `analyticsExplain.ts`, que ya cumple ese rol para otras traducciones).

### 🟢 D5 — Confirmado: sin duplicación en Carga Laboral / Capacidad / Riesgo / Consistencia / Benchmark

Se verificó explícitamente que **no** existen reimplementaciones de estas fórmulas fuera de su módulo fuente:
- `computeWorkloadRange`/`computeWorkloadPct` (única fuente para toda clasificación de carga en 5 zonas) — usadas consistentemente por `workload.ts`, `analytics.ts` (`cargaHealthScore` es un cálculo *distinto* y así se documenta en su propio comentario), `capacityForecast.ts`, `kpis/executive`, `reports/generate`, `reports/range`, `analytics/simulate`.
- `classifyCapacity` (única fuente del semáforo de capacidad) — reutilizada explícitamente por `computeTeamCapacityForecast`, `computeTeamRecommendations` y `analytics/simulate` (el comentario en `simulate/[userId]/route.ts` L102-104 documenta que antes había copias locales que se eliminaron).
- `classifyOperationalRisk` — reutilizada por `computeOperationalRisk` y `kpis/executive` (bloque CEO).
- Los componentes de UI de Analytics (`AdvancedAnalytics.tsx`, `SmartBenchmark.tsx`, `OperationalRiskCard.tsx`, `InsightCards.tsx`, `InsightsPanel.tsx`) no recalculan nada — grep dirigido a patrones de fórmula (`Math.round(...*100)`, `filter+reduce`, `Math.min/max` de negocio) no arrojó coincidencias.
- Todas las rutas nuevas de `/api/analytics/*` (bundle, benchmarks, insights, operational-risk, operational-risk/team, simulate, target-time, recommendations/team, data-quality, diagnostics) y `/api/kpis/team-capacity` son consumidoras puras del motor — se leyeron íntegramente y ninguna reimplementa una fórmula.

---

## FASE 3 — Mapa del motor

```mermaid
flowchart TB
  subgraph Config["Config centralizada — systemConfig.ts"]
    SC["getEffectiveAnalyticsConfig / getEffectiveCurve / getEffectiveRoleTarget<br/>(SystemConfigHistory, vigencia temporal)"]
  end

  subgraph Satellite["Motores satélite (single-purpose)"]
    WL["Workload Engine<br/>workload.ts<br/>consume: Task, TaskActivity, LeaveRecord, SpecialStatus, Holiday<br/>devuelve: CargaTiempo (diaria/semanal/mensual), semáforo 5 zonas"]
    CAP["Capacity Engine<br/>capacityForecast.ts<br/>consume: Task abiertas, LeaveRecord, SpecialStatus, TargetTime<br/>devuelve: CapacityForecast (disponible/comprometido, estado)"]
    PRI["Priority Compliance<br/>priorityCompliance.ts<br/>consume: Task (priority/status/completedAt/endDate)<br/>devuelve: cumplimiento a-tiempo por prioridad"]
    TT["Target Time<br/>targetTime.ts<br/>consume: Task.estimatedHours/targetTimeValidated/realHours<br/>devuelve: referencia oficial, desviación, precisión"]
    NORM["Normalization Engine<br/>normalizationEngine.ts<br/>consume: curvas configurables<br/>devuelve: normalize(raw) → 0-100"]
    RA["Risk Alerts (legado)<br/>riskAlerts.ts<br/>consume: Task abiertas, último TaskActivity<br/>devuelve: alertas simples (vencidas/carga/inactividad)"]
  end

  subgraph Core["Analytics Engine central — analytics.ts v1.5.0"]
    HIST["Histórico mensual/semanal<br/>computeMonthlyHistory / computeWeeklyHistory"]
    TREND["Tendencias<br/>computeTrends"]
    CONS["Consistencia (CV semanal)<br/>computeConsistency"]
    ANOM["Anomalías<br/>detectAnomalies"]
    PRED["Predicción<br/>computePrediction"]
    HEALTH["Score de Salud (legacy)<br/>computeHealthScore"]
    PERF["Performance Score<br/>computePerformanceScore"]
    RISK["Índice de Riesgo Operativo<br/>computeOperationalRisk"]
    DQ["Calidad de datos<br/>computeDataQuality"]
    TTP["Precisión Tiempo Objetivo<br/>computeTargetTimePrecision"]
    ALERTS["Motor de alertas<br/>computeAlerts"]
    BENCH["Benchmark Inteligente (3 niveles)<br/>computeSmartBenchmark"]
    PIPE["Pipeline único<br/>runAnalyticsPipeline"]
  end

  subgraph Decision["Capa de decisión — insightsEngine.ts (Sprint 6)"]
    INS["Insights 4 bloques<br/>computeInsights"]
    REL["Relaciones entre indicadores<br/>computeIndicatorRelations"]
    PBENCH["Benchmark personal (historial propio)<br/>computePersonalBenchmark"]
    REEVAL["Reevaluación de recomendaciones<br/>computeRecommendationReevaluation"]
    PRIO["Priorización<br/>prioritizeRecommendations / prioritizeInsights"]
  end

  subgraph Explain["Explicabilidad — analyticsExplain.ts (Sprint 6.5)"]
    EXP["scoreLevel / reliabilityPct* / confidenceLabel<br/>(pura, sin BD, sin recalcular)"]
  end

  subgraph Audit["Auditoría — AnalyticsAuditLog"]
    AUDITLOG["kind: health_score / performance_score /<br/>operational_risk / alerts / smart_benchmark / validation_failure"]
  end

  subgraph Nova["Narrativa IA — Groq (nova-insights)"]
    NOVA["Solo redacta texto sobre JSON ya calculado.<br/>Nunca calcula un KPI."]
  end

  subgraph UI["UI — componentes de presentación"]
    COMP["AdvancedAnalytics / SmartBenchmark / OperationalRiskCard /<br/>InsightCards / InsightsPanel / AnalyticsModule<br/>(sin fórmulas inline, verificado)"]
  end

  Config --> WL & CAP & NORM & ALERTS & HEALTH & PERF & RISK & BENCH
  WL --> HIST
  WL --> HEALTH
  WL --> RISK
  WL --> RA
  CAP --> HEALTH
  CAP --> RISK
  CAP --> ALERTS
  CAP --> BENCH
  TT --> CAP
  TT --> TTP
  HIST --> TREND
  HIST --> ANOM
  HIST --> BENCH
  HIST --> PRED
  CONS --> HEALTH
  CONS --> PERF
  CONS --> PRED
  CONS --> RISK
  NORM --> PERF
  TREND --> RISK
  TREND --> ALERTS
  HEALTH --> PIPE
  PERF --> PIPE
  PERF --> BENCH
  CONS --> PIPE
  TREND --> PIPE
  PRED --> PIPE
  DQ --> PIPE
  ALERTS --> PIPE
  RISK --> AUDITLOG
  PERF --> AUDITLOG
  HEALTH --> AUDITLOG
  BENCH --> AUDITLOG
  ALERTS --> AUDITLOG
  AUDITLOG --> BENCH
  AUDITLOG --> Decision
  PIPE --> Decision
  RISK --> Decision
  CAP --> Decision
  PIPE --> NOVA
  RISK --> NOVA
  Decision --> Explain
  PIPE --> Explain
  RISK --> Explain
  BENCH --> Explain
  PIPE --> COMP
  RISK --> COMP
  BENCH --> COMP
  Decision --> COMP
  NOVA --> COMP
  PRI -.->|"usado solo por kpis/[userId] y kpis/me,<br/>NO por el motor central"| COMP
  RA -.->|"usado solo por kpis/[userId] y kpis/me,<br/>NO por el motor central"| COMP
```

**Qué calcula / consume / devuelve cada módulo** (resumen, ver tablas de la Fase 1 para el detalle función a función):

- **Config centralizada** — calcula: nada (solo lee vigencia temporal). Consume: `SystemConfigHistory`. Devuelve: pesos, umbrales, curvas y objetivos de cargo vigentes en una fecha dada.
- **Workload Engine** — calcula: carga laboral diaria/semanal/mensual, semáforo de 5 zonas. Consume: `Task` (FIJA), `TaskActivity`, permisos, estado especial, feriados. Devuelve: `CargaTiempo`.
- **Capacity Engine** — calcula: capacidad disponible proyectada hacia adelante. Consume: `Task` abiertas, permisos, estado especial, Tiempo Objetivo. Devuelve: `CapacityForecast` por usuario.
- **Priority Compliance** — calcula: cumplimiento a-tiempo por prioridad. Consume: tareas del período. Devuelve: `PriorityCompliance[]`. **No es consumido por el motor central** (analytics.ts) — solo por `kpis/[userId]`/`kpis/me`.
- **Target Time** — calcula: referencia oficial, desviación, precisión. Consume: campos de `Task`. Devuelve: valores puros reutilizados por Capacity Engine y por `computeTargetTimePrecision`.
- **Normalization Engine** — calcula: interpolación lineal por tramos. Consume: curvas configurables. Devuelve: score 0-100 normalizado. Usado solo por Performance Score.
- **Risk Alerts (legado)** — calcula: alertas simples de riesgo. Consume: tareas abiertas + último registro de actividad. Devuelve: `RiskAlert[]`. **Paralelo e independiente** del Motor de alertas del core (ver D2).
- **Analytics Engine central** — orquesta histórico → tendencias/consistencia/anomalías/predicción → Score de Salud/Performance/Riesgo → alertas → Benchmark. Devuelve el `AnalyticsBundle` que consume `/api/analytics/[userId]`.
- **Capa de decisión (insightsEngine.ts)** — calcula: interpretación y priorización ENCIMA de KPIs ya calculados. No accede a fórmulas de negocio nuevas, solo relaciona/prioriza/compara con historial (`AnalyticsAuditLog`).
- **Explicabilidad (analyticsExplain.ts)** — pura presentación: traduce valores ya calculados a niveles/etiquetas ejecutivas. Nunca recalcula.
- **Auditoría** — persiste snapshots de `health_score`/`performance_score`/`operational_risk`/`alerts`/`smart_benchmark`/`validation_failure`; es la fuente de todo "historial personal" (Benchmark Personal, Evolución Personal, tendencias de score).
- **Nova (Groq)** — solo redacta lenguaje natural sobre JSON ya calculado; nunca calcula un KPI (garantía verificada: `nova-insights/route.ts` solo llama a `computeAlerts`/pipeline y pasa los resultados a Groq como contexto).
- **UI** — solo presentación, verificado sin fórmulas inline.

---

## FASE 4 — Verificación de Single Source of Truth

| KPI | ¿Fuente única? | Fuente oficial | Otras implementaciones detectadas |
|---|---|---|---|
| Score de Salud Laboral (legacy) | ✅ Sí | `computeHealthScore` (analytics.ts) | ninguna — `analytics/simulate` reutiliza sus factores, no los recalcula |
| Performance Score | ✅ Sí | `computePerformanceScore` (analytics.ts) | ninguna |
| Índice de Riesgo Operativo | ✅ Sí | `computeOperationalRisk` (analytics.ts) | ninguna — `kpis/executive` lo reutiliza vía caché compartida (`risk-bench:`) |
| Capacidad Disponible / Comprometido futuro | ✅ Sí | `computeTeamCapacityForecast`/`computeCapacityForecast` (capacityForecast.ts) | ninguna — `analytics/simulate` recompone solo los factores afectados con las mismas funciones (`classifyCapacity`), no reimplementa |
| Carga Laboral (semáforo 5 zonas, % con techo 100) | ✅ Sí | `computeWorkloadRange`/`computeWorkloadPct` (workload.ts) | ninguna |
| Consistencia (CV semanal) | ✅ Sí | `computeConsistency` (analytics.ts) | ninguna |
| Predicción | ✅ Sí | `computePrediction` (analytics.ts) | ninguna |
| Benchmark Inteligente (3 niveles) | ✅ Sí | `computeSmartBenchmark` (analytics.ts) | ninguna |
| Cumplimiento por prioridad | ✅ Sí | `computePriorityCompliance` (priorityCompliance.ts) | ninguna |
| Score simple (0-100, legacy rankings/reportes) | ✅ Código único, ⚠️ inputs no uniformes | `computeSimpleScore` (analytics.ts) | ver **D3** — mismo código, pero el 2º parámetro recibe `cargaRatio` (estimado/real) en 4 rutas y `cargaPct` (carga vs. base) en 3 rutas |
| Ratio horas estimadas/reales | ✅ Sí | `computeEstimatedVsRealRatio` (analytics.ts) | ninguna |
| **Cumplimiento (% completado)** | ❌ **No** | *(no existe una única fuente)* | ver **D1** — 8 implementaciones inline en 6 archivos + 4 dentro del propio motor, con 2 definiciones (con/sin "a tiempo") que comparten el nombre de campo `completedPct` |
| Alertas de riesgo / recomendaciones automáticas | ❌ **No** | *(dos motores paralelos)* | ver **D2** — `computeAlerts` (analytics.ts, configurable) vs. `computeRiskAlerts` (riskAlerts.ts, legado, umbrales fijos) |
| Clasificación de capacidad (semáforo) | ✅ Sí | `classifyCapacity` (capacityForecast.ts) | ninguna |
| Clasificación de riesgo operativo (Bajo/Medio/Alto/Crítico) | ✅ Sí | `classifyOperationalRisk` (analytics.ts) | ninguna |

---

## FASE 5 — Analytics Calculation Registry (registro técnico completo)

> Formato por indicador: Nombre · Motor responsable · Función · Entradas · Salidas · Dependencias · Versión de fórmula · Complejidad · Riesgo de regresión.

### Performance Score
- **Motor:** Analytics Engine central
- **Función:** `computePerformanceScore` (`src/lib/analytics.ts`)
- **Entradas:** tareas del mes (status/priority/endDate), `ConsistencyResult` (precomputado o recalculado), Índice de Trazabilidad (comentarios + actividades documentadas + % días con registro), curvas de normalización (`cumplimiento`/`vencidas`/`consistencia`/`trazabilidad`), pesos configurables
- **Salidas:** `PerformanceScoreResult` (score 0-100, clasificación, 4 factores con detalle, `explain`)
- **Dependencias:** `computeConsistency`, `computeWeeklyHistory`, `normalize` (NormalizationEngine), `getEffectiveCurve`, `getEffectiveAnalyticsConfig`
- **Versión de fórmula:** `performanceScore: "4.0"` (`FORMULA_VERSIONS`)
- **Complejidad:** Alta (4 sub-cálculos + normalización por curva + auditoría)
- **Riesgo de regresión:** Medio — depende de curvas configurables en Ajustes; un cambio de curva altera el score sin tocar código (por diseño, pero requiere pruebas de regresión al modificar `DEFAULT_CURVES`)

### Índice de Riesgo Operativo
- **Motor:** Analytics Engine central
- **Función:** `computeOperationalRisk` (`src/lib/analytics.ts`)
- **Entradas:** `CapacityForecast`, `KpiTrends`, `ConsistencyResult`, `CargaTiempo`, tareas abiertas, concentración de Seguimiento, 8 pesos configurables + 3 umbrales de clasificación
- **Salidas:** `OperationalRiskResult` (score, clasificación 4 niveles, 8 factores, tendencia vs. mes anterior, acciones sugeridas)
- **Dependencias:** `computeCapacityForecast`, `computeTrends`, `computeConsistency`, `computeCargaTiempo`, `computeSeguimientoConcentration`, `classifyOperationalRisk`
- **Versión de fórmula:** `riesgoOperativo: "1.0"` (congelada — "Sprint 5 § S5-C prohíbe modificar reglas/pesos/alertas")
- **Complejidad:** Alta (8 factores independientes + notificación automática a superiores cuando es Alto/Crítico)
- **Riesgo de regresión:** Bajo (fórmula congelada por decisión de producto) — riesgo real está en D2 (motor paralelo `riskAlerts.ts`)

### Capacidad Disponible
- **Motor:** Capacity Engine
- **Función:** `computeTeamCapacityForecast` / `computeCapacityForecast` (`src/lib/capacityForecast.ts`)
- **Entradas:** tareas PENDIENTE/EN_PROGRESO, Tiempo Objetivo oficial (validado ?? inicial), permisos, estado especial, feriados, horas efectivas configuradas, hora de corte de jornada fija (17:00 local)
- **Salidas:** `CapacityForecast` (horas restantes hoy, días laborables restantes, base futura, comprometido en progreso/pendiente, disponible, %, estado/color/label, confiabilidad)
- **Dependencias:** `businessTime.ts`, `holidays.ts`, `leaves.ts`, `specialStatus.ts`, `workload.ts` (`isWorkingDay`, `countBusinessDays`, `sumWeightedBaseHours`), `targetTime.ts` (`getOfficialTargetTime`), `classifyCapacity`
- **Versión de fórmula:** `capacidadDisponible: "1.0"` (`FORMULA_VERSIONS`)
- **Complejidad:** Alta (proyección hacia adelante, día parcial, permisos ponderados, estado especial por día)
- **Riesgo de regresión:** Medio — la hora de corte de jornada (17:00) está hardcodeada, no configurable; un cambio de horario de oficina requeriría tocar código

### Horas Comprometidas (futuro)
- **Motor:** Capacity Engine
- **Función:** interno a `computeTeamCapacityForecast` (campos `comprometidoEnProgreso`/`comprometidoPendiente`/`comprometidoFuturo`) — no tiene función propia exportada, vive embebido en el cálculo de capacidad
- **Entradas:** Tiempo Objetivo oficial de tareas EN_PROGRESO (menos horas ya reales) y PENDIENTE (completo)
- **Salidas:** horas comprometidas futuras (componente de `CapacityForecast`)
- **Dependencias:** `getOfficialTargetTime` (targetTime.ts)
- **Versión de fórmula:** parte de `capacidadDisponible: "1.0"` (no versionada por separado)
- **Complejidad:** Media
- **Riesgo de regresión:** Bajo — única fuente, sin duplicación detectada

### Carga Laboral
- **Motor:** Workload Engine
- **Función:** `computeCargaTiempo` / `computeCargaHistory` (`src/lib/workload.ts`), semáforo vía `computeWorkloadRange`/`computeWorkloadPct`
- **Entradas:** horas reales (tareas FIJA completadas + `TaskActivity.duration`), horas efectivas/límites configurados (4 límites independientes: low/base/high/overload), permisos, estado especial, feriados
- **Salidas:** `CargaTiempo` (diaria/semanal/mensual, cada una con semáforo de 5 zonas, %, rangos)
- **Dependencias:** `businessTime.ts`, `holidays.ts`, `leaves.ts`, `specialStatus.ts`, `systemConfig.ts`
- **Versión de fórmula:** `cargaLaboral: "1.0"` (`FORMULA_VERSIONS`)
- **Complejidad:** Alta (múltiples periodos, dos "bases" paralelas — exhibición vs. clasificación — para soportar estado especial)
- **Riesgo de regresión:** Medio — la existencia de `baseHours` vs. `classificationBase` como dos denominadores distintos (documentado en el código) es fácil de confundir en cambios futuros

### Cumplimiento
- **Motor:** ❌ Sin motor único — ver **D1**
- **Función:** múltiples (`computeMonthlyHistory`/`computeHealthScore`/`computePerformanceScore`/`computeMonthlyCompliancePace` en analytics.ts; inline en `kpis/team`, `kpis/executive`, `kpis/me/range`, `reports/generate`, `reports/range`; `isCompletedOnTime` en `kpis/[userId]`/`kpis/me`)
- **Entradas:** `Task.status` (+ `completedAt`/`endDate` solo en la variante "a tiempo")
- **Salidas:** `completedPct` (0-100) — **semántica ambigua entre implementaciones**
- **Dependencias:** ninguna función compartida
- **Versión de fórmula:** `cumplimiento: "2.0"` (`FORMULA_VERSIONS`, aplica solo a la Definición A dentro del motor central)
- **Complejidad:** Baja individualmente, alta a nivel sistema (8 copias que divergen)
- **Riesgo de regresión:** **Alto** — cualquier cambio a una definición no se propaga a las demás; ver recomendación en D1

### Consistencia
- **Motor:** Analytics Engine central
- **Función:** `computeConsistency` (+ `consistencyLevelFromCv`, `consistencyPctFromCv`, `consistencyReliabilityFromWeeks`) (`src/lib/analytics.ts`)
- **Entradas:** histórico semanal (16 semanas hacia atrás), fecha efectiva de inicio de historial, permisos (semanas con permiso de día completo se excluyen)
- **Salidas:** `ConsistencyResult` (CV, nivel categórico, % 0-100, confiabilidad ★, semanas/días analizados, períodos excluidos con motivo)
- **Dependencias:** `computeWeeklyHistory`, `computeEffectiveHistoryStart`, `getLeaveMinutesByDay`, `getHolidaySet`
- **Versión de fórmula:** `consistencia: "2.1"` (corregida en Analytics Engine v1.3.1 — excluye semanas sin historial válido)
- **Complejidad:** Media-Alta (CV compuesto de 3 series + exclusión de semanas por 3 motivos distintos)
- **Riesgo de regresión:** Bajo — bien cubierta por tests puros (`consistencyLevelFromCv`, `consistencyPctFromCv` son funciones puras testeables)

### Benchmark (Inteligente, 3 niveles)
- **Motor:** Analytics Engine central
- **Función:** `computeSmartBenchmark` (+ constructores por nivel) (`src/lib/analytics.ts`)
- **Entradas:** Performance Score, Riesgo Operativo, cumplimiento, carga, capacidad del usuario y de pares del mismo `Role`; objetivo de cargo configurado (opcional); historial vía `AnalyticsAuditLog`
- **Salidas:** `SmartBenchmarkResult` (modo cargo/cargo-limitado/personal, 5 métricas, explicación de por qué se eligió ese modo)
- **Dependencias:** `computePerformanceScore`, `computeOperationalRisk`, `computeMonthlyHistory`, `computeCapacityForecast`, `getEffectiveRoleTarget`, `getScoredAuditHistory`, `closestScoredPoint`
- **Versión de fórmula:** `benchmarkInteligente: "1.0"` (Sprint 7, reemplaza el benchmark de pares de Sprint 5)
- **Complejidad:** Alta (motor de decisión de 3 niveles × 5 métricas × 2 direcciones "mejor" distintas — carga usa cercanía a 100%, el resto usa magnitud)
- **Riesgo de regresión:** Medio — la lógica de "cuál dirección es mejor" está distribuida entre `buildCargoBenchmark` (mayor=mejor) y `buildCargoBenchmarkCarga` (cercano a 100=mejor); un nuevo indicador que olvide esta distinción produciría un benchmark invertido

### Predicciones
- **Motor:** Analytics Engine central
- **Función:** `computePrediction` (+ `computePredictionConfidencePct`, `computeMonthlyCompliancePace`) (`src/lib/analytics.ts`)
- **Entradas:** histórico semanal (regresión lineal simple sobre horas), consistencia, ritmo de cumplimiento del mes en curso, días restantes del mes (tope `PREDICTION_MAX_DAYS=30`)
- **Salidas:** `Prediction` (carga próxima semana, cumplimiento estimado de cierre + rango, confianza nunca 100%)
- **Dependencias:** `computeWeeklyHistory`, `computeCargaTiempo`, `computeConsistency`, `getEffectiveAnalyticsConfig`
- **Versión de fórmula:** `prediccion: "2.0"` (`FORMULA_VERSIONS`)
- **Complejidad:** Media (regresión lineal + confianza compuesta de 3 factores)
- **Riesgo de regresión:** Bajo — acotada y con techo de confianza fijo (92%) que evita falsa certeza

---

## Resumen ejecutivo de hallazgos

| # | Hallazgo | Severidad | Acción en este sprint |
|---|---|---|---|
| D1 | "Cumplimiento" con 2 definiciones y 9 implementaciones inline sin función compartida | 🔴 Alta | Documentado — no unificado (fuera de alcance) |
| D6 | `/api/dashboard` (pantalla de inicio) reimplementa carga/cumplimiento/sobrecarga desde cero, sin importar el motor | 🔴 Alta | Documentado — no unificado (fuera de alcance) |
| D2 | Dos motores de alertas de riesgo paralelos (`computeAlerts` vs. `computeRiskAlerts`) | 🟠 Media | Documentado — no unificado (fuera de alcance) |
| D3 | `computeSimpleScore` consolidado pero alimentado con magnitudes distintas (`cargaRatio` vs. `cargaPct`) según el caller | 🟠 Media | Documentado — no unificado (fuera de alcance) |
| D7 | Clasificación del Performance Score reimplementada en `kpis/executive` para el promedio del equipo | 🟠 Media | Documentado — no unificado (fuera de alcance) |
| D4 | `computeMonthlyCompliancePace` es una 3ª variante de cumplimiento, pero bien encapsulada | 🟡 Baja | Documentado, sin acción requerida |
| D8 | `analytics/simulate` reimplementa una línea de aritmética de ponderación (`pointsFor`) ya existente en `mk()` | 🟡 Baja | Documentado, sin acción requerida |
| D9 | `riskAlerts.ts` cuenta "días hábiles" sin excluir feriados, a diferencia de `countBusinessDays` | 🟡 Baja-Media | Documentado, sin acción requerida |
| D10 | Heurísticas de confianza/★ y umbral de color 80/60 reimplementados en 3-4 componentes de UI | 🟡 Baja | Documentado, sin acción requerida |
| D5 | Carga/Capacidad/Riesgo/Consistencia/Benchmark/Normalización: sin duplicación — Single Source of Truth confirmado | ✅ — | Ninguna |

**Nota de proceso:** los hallazgos D6-D10 surgieron de un segundo agente de exploración lanzado en paralelo como verificación cruzada sobre las mismas rutas/componentes; sus citas de línea más específicas (`dashboard/route.ts`, `kpis/executive` L230-231, `analytics/simulate` L110-112, `riskAlerts.ts` L23-31, componentes de UI) fueron releídas y confirmadas directamente antes de incorporarlas aquí.

Ningún cálculo, API pública, componente visual o fórmula validada fue modificado durante esta auditoría.
