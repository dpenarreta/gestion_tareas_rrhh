# Analytics Formulas — Referencia técnica de fórmulas

Este documento es la **referencia de fórmulas** del motor de Analytics de Nexo: para cada KPI/indicador expone la fórmula matemática exacta, sus variables, sus pesos configurables, su normalización (si aplica) y un ejemplo numérico resuelto paso a paso. Es complementario a `docs/ANALYTICS_CALCULATION_REGISTRY.md` — ese documento es la **auditoría de duplicación** (qué funciones existen, dónde se reimplementan, qué se consolidó); este documento es el **libro de fórmulas** (cómo se calcula cada cosa, con qué números). Mantenerlos sincronizados: cualquier cambio de fórmula que suba una versión en `FORMULA_VERSIONS` (`src/lib/analytics.ts`) debe reflejarse aquí en la sección "Versión" del indicador correspondiente.

Motor central: `src/lib/analytics.ts` — `ANALYTICS_ENGINE_VERSION = "1.5.0"`, `FORMULA_SET_VERSION = "4.4"`.

---

## Índice

1. [Performance Score](#1-performance-score)
2. [Índice de Riesgo Operativo](#2-índice-de-riesgo-operativo)
3. [Equilibrio Operativo](#3-equilibrio-operativo)
4. [Carga Laboral](#4-carga-laboral)
5. [Capacidad Disponible](#5-capacidad-disponible--capacity-forecast)
6. [Cumplimiento](#6-cumplimiento)
7. [Cumplimiento por Prioridad](#7-cumplimiento-por-prioridad)
8. [Consistencia](#8-consistencia)
9. [Predicción](#9-predicción)
10. [Benchmark Inteligente](#10-benchmark-inteligente)
11. [Tiempo Objetivo — Desviación y Precisión](#11-tiempo-objetivo--desviación-y-precisión)
12. [Alertas](#12-alertas)
13. [NormalizationEngine](#13-normalizationengine)
14. [Insights Engine / Decision Intelligence](#14-insights-engine--decision-intelligence)
15. [Base Horaria Efectiva](#15-base-horaria-efectiva-sprint-analytics-21--capa-de-reporte-no-del-analytics-engine)
16. [Trend Engine](#16-trend-engine-sprint-e)
17. [Predicciones Preventivas](#17-predicciones-preventivas-sprint-e)
18. [Estabilidad Operativa](#18-estabilidad-operativa-sprint-e)

---

## 1. Performance Score

**Función:** `computePerformanceScore` (`src/lib/analytics.ts`)

### Objetivo
Responder una sola pregunta: "¿qué tan bien está ejecutando su trabajo un colaborador este mes?". A diferencia de Equilibrio Operativo (§3), **nunca** incluye carga laboral ni capacidad futura — esos son dimensiones propias de Equilibrio Operativo.

### Fórmula
```
score = Σ weightedPoints(normalize(curva_i, rawValue_i), weight_i)   para i en {Cumplimiento, Vencidas, Consistencia, Trazabilidad}

normalize(curva, raw)      = clamp(interpolateCurve(raw, curva), 0, 100)   // NormalizationEngine, ver §13
weightedPoints(v, w)       = round(v × w / 100, 2)
```

Los 4 factores:

| Factor | rawValue | Curva | Peso (config) |
|---|---|---|---|
| Cumplimiento | `completedPct` = `computeCompletedPctAny(tasks, emptyValue=100)` | `cumplimiento` (identidad) | `perfWeightCumplimiento` |
| Tareas vencidas | `weightedOverdue = overdueNormal + overdueAlta × 2` | `vencidas` | `perfWeightVencidas` |
| Consistencia | `consistency.consistencyPct` (o 70 si no disponible) | `consistencia` (identidad) | `perfWeightConsistencia` |
| Índice de Trazabilidad | `computeTrazabilidadRaw(...)` | `trazabilidad` (identidad) | `perfWeightTrazabilidad` |

**Índice de Trazabilidad** (mide evidencia/documentación del trabajo, NO calidad del trabajo en sí):
```
registroPct     = avg( díasConRegistro_semana / díasHábiles_semana ) × 100   sobre semanas con díasHábiles>0 (últimas 4)
commentsScore   = min(100, comentarios_del_mes × 10)
activitiesScore = min(100, actividades_del_mes × 10)
raw = registroPct × 0.5 + commentsScore × 0.25 + activitiesScore × 0.25
```

### Variables
- `tasks`: tareas del colaborador con `endDate` en el mes en curso (`status`, `priority`).
- `overdueNormal` / `overdueAlta`: tareas vencidas (`isTaskOverdue`) sin/con prioridad `ALTA`.
- `consistency`: `ConsistencyResult` (§8), precomputado por el pipeline o recalculado.
- `trazabilidad.raw`: 0-100, ver arriba. Fuentes: `computeWeeklyHistory` (registro), `Comment.count`, `TaskActivity.count`.

### Pesos
`ANALYTICS_CONFIG_DEFAULTS` (`src/lib/systemConfig.ts`), deben sumar 100:
- `perfWeightCumplimiento = 35`
- `perfWeightVencidas = 25`
- `perfWeightConsistencia = 25`
- `perfWeightTrazabilidad = 15`

Configurables desde Ajustes (Administrador/Jefe Nacional/Coordinador Nacional) vía `setAnalyticsConfigValue`, con historial de cambios en `SystemConfigHistory`.

### Normalización
Cada factor pasa por `normalize()` (NormalizationEngine, §13) con su curva propia (`getEffectiveCurve`, configurable desde Ajustes). Por defecto (`DEFAULT_CURVES`):
- `cumplimiento`: identidad `[{0,0},{100,100}]` (el % ya es 0-100).
- `vencidas`: `[{0,100},{10,0}]` — decreciente lineal; a `weightedOverdue = 10` el score cae a 0.
- `consistencia` / `trazabilidad`: identidad.

### Ejemplo de cálculo
Mes en curso, colaborador con 20 tareas (16 `COMPLETADA`), 3 tareas vencidas (1 de prioridad Alta), consistencia disponible al 82.3%, trazabilidad: 90% de días con registro, 5 comentarios, 8 actividades documentadas.

1. **Cumplimiento**: `completedPct = round(16/20×100) = 80` → `normalize("cumplimiento", 80) = 80.0` → `weightedPoints(80, 35) = round(80×35/100×100)/100 = 28.00`
2. **Vencidas**: `overdueNormal=2`, `overdueAlta=1` → `weightedOverdue = 2 + 1×2 = 4` → interpolando `[{0,100},{10,0}]` en x=4: `t=4/10=0.4`, `y=100+0.4×(0-100)=60.0` → `weightedPoints(60, 25) = 15.00`
3. **Consistencia**: `raw=82.3` (identidad) → `normalizedValue=82.3` → `weightedPoints(82.3, 25) = round(82.3×25) / 100 = round(2057.5)/100 = 20.58`
4. **Trazabilidad**: `commentsScore=min(100,5×10)=50`, `activitiesScore=min(100,8×10)=80` → `raw = 90×0.5 + 50×0.25 + 80×0.25 = 45 + 12.5 + 20 = 77.5` → identidad `normalizedValue=77.5` → `weightedPoints(77.5, 15) = round(1162.5)/100 = 11.63`

**Total:** `score = round(28.00 + 15.00 + 20.58 + 11.63, 2) = 75.21`

`classifyPerformanceScore(75.21)`: ≥75 → **"Bueno"**, color `green` (≥75 verde, ≥60 amarillo, si no rojo).

### Casos borde
- Sin tareas asignadas el mes → `computeCompletedPctAny(tasks, 100)` devuelve **100%** (no penaliza a quien no tiene tareas ese mes; distinto del criterio de reportes/rankings, que usan `emptyValue=0`).
- Consistencia no disponible (historial insuficiente) → `consistencyRaw = 70` (neutro), igual criterio que `consistencyToScore` de Equilibrio Operativo.
- Ninguna semana con `businessDays > 0` para Trazabilidad → `registroPct = 0`.

### Reglas de negocio
- Deliberadamente excluye carga/capacidad/riesgo — esos factores viven solo en Operational Risk (separación de responsabilidades explícita en el comentario de cabecera de la función).
- `classifyPerformanceScore()` es la única fuente de los umbrales de clasificación — reutilizada también por `/api/kpis/executive` para el promedio del equipo (fix D7 del registro de auditoría).

### Versión
`FORMULA_VERSIONS.performanceScore = "4.0"` (Sprint 5 §S5-B/S5-G — motor de normalización continuo).

### Notas
- `trazabilidad` también tiene su propia entrada en `FORMULA_VERSIONS` (`"4.0"`) aunque no se expone como KPI independiente — versiona el sub-cálculo dentro de Performance Score.
- Complejidad/riesgo de regresión (registro de auditoría): Alta/Medio — depende de curvas configurables; un cambio de curva en Ajustes altera el score sin tocar código, por diseño, pero exige pruebas de regresión.

---

## 2. Índice de Riesgo Operativo

**Función:** `computeOperationalRisk` (`src/lib/analytics.ts`)

### Objetivo
Cuantificar el riesgo de **seguir asignando trabajo** a un colaborador — combina sobrecarga proyectada, tareas críticas vencidas, tendencia de cumplimiento, horas extra, capacidad futura, variabilidad, concentración de actividades y falta de planificación en un único score 0-100.

### Fórmula
```
score = Σ weightedPoints(rawPct_i, weight_i)   para 8 factores independientes
weightedPoints(v, w) = round(v × w / 100, 2)
```

| # | Factor | rawPct | Peso (config) |
|---|---|---|---|
| 1 | Sobrecarga proyectada | `disponible<0 ? min(100, abs(disponiblePct)) : 0` | `riskWeightSobrecarga` |
| 2 | Tareas críticas vencidas | `min(100, overdueAlta × 33)` | `riskWeightVencidasCriticas` |
| 3 | Tendencia negativa de cumplimiento | `trend.direction==="empeoro" ? min(100, abs(absoluteDiff)×3) : 0` | `riskWeightTendenciaNegativa` |
| 4 | Horas extra recurrentes | `min(100, weekendHours × 10)` | `riskWeightHorasExtra` |
| 5 | Baja capacidad futura (<10%) | `disponiblePct<10 ? (disponible<0 ? 100 : round((1-disponiblePct/10)×100)) : 0` | `riskWeightBajaCapacidad` |
| 6 | Variabilidad excesiva | `muy-variable→100, variable→60, consistente→20, muy-consistente→0` | `riskWeightVariabilidad` |
| 7 | Concentración en un solo tipo de actividad | `topPct>70 ? min(100,(topPct-70)×3) : 0` | `riskWeightConcentracion` |
| 8 | Muchas tareas sin planificación | `min(100, tasksSinEstimar × 25)` | `riskWeightSinPlanificacion` |

### Variables
- `capacity`: `CapacityForecast` (§5) — `disponible`, `disponiblePct`.
- `trends.cumplimiento.mesAnterior`: `TrendResult` (§9/Tendencias).
- `cargaTiempo.mensual.weekendHours`: horas reales trabajadas en fin de semana este mes.
- `consistency.level`: `ConsistencyResult` (§8).
- `concentration`: `computeSeguimientoConcentration` — % del tiempo de tipo `SEGUIMIENTO` concentrado en un solo `reason`.
- `capacity.tasksSinEstimar`: tareas abiertas sin Tiempo Objetivo (`getOfficialTargetTime(t) <= 0`).

### Pesos
`ANALYTICS_CONFIG_DEFAULTS`, suman 100:
`riskWeightSobrecarga=22`, `riskWeightVencidasCriticas=18`, `riskWeightTendenciaNegativa=15`, `riskWeightHorasExtra=12`, `riskWeightBajaCapacidad=11`, `riskWeightVariabilidad=10`, `riskWeightConcentracion=7`, `riskWeightSinPlanificacion=5`.

Umbrales de clasificación (también configurables): `riskThresholdMedio=31`, `riskThresholdAlto=61`, `riskThresholdCritico=81`.

### Normalización
No usa NormalizationEngine (a diferencia de Performance Score) — cada `rawPct` ya viene acotado 0-100 por su propia fórmula ad hoc (ver tabla). `classifyOperationalRisk(score, thresholdMedio, thresholdAlto, thresholdCritico)`: `≥thresholdCritico→Crítico(red)`, `≥thresholdAlto→Alto(orange)`, `≥thresholdMedio→Medio(yellow)`, si no `Bajo(green)`.

### Ejemplo de cálculo
Colaborador con: `disponible=-5h` (sobrecarga), `disponiblePct=-8%`; 1 tarea crítica vencida; cumplimiento empeoró 12pp vs. mes anterior; 2h trabajadas en fin de semana; consistencia "variable"; concentración de Seguimiento sin motivo dominante (`topPct≤70`); 1 tarea sin Tiempo Objetivo.

1. Sobrecarga: `min(100, abs(-8)) = 8` → `weightedPoints(8,22) = round(8×22)/100 = 1.76`
2. Vencidas críticas: `min(100, 1×33) = 33` → `weightedPoints(33,18) = round(594)/100 = 5.94`
3. Tendencia negativa: `min(100, 12×3) = 36` → `weightedPoints(36,15) = round(540)/100 = 5.40`
4. Horas extra: `min(100, 2×10) = 20` → `weightedPoints(20,12) = round(240)/100 = 2.40`
5. Baja capacidad: `disponible<0` → `100` → `weightedPoints(100,11) = 11.00`
6. Variabilidad: "variable" → `60` → `weightedPoints(60,10) = 6.00`
7. Concentración: `0` → `0.00`
8. Sin planificación: `min(100, 1×25) = 25` → `weightedPoints(25,5) = round(125)/100 = 1.25`

**Total:** `score = round(1.76+5.94+5.40+2.40+11.00+6.00+0+1.25, 2) = 33.75`

`classifyOperationalRisk(33.75, 31, 61, 81)`: `33.75 ≥ 31` → **"Medio"**, color `yellow`.

### Casos borde
- `disponiblePct` positivo (≥10) → factor 5 = 0 sin excepciones.
- `concentration.pct = 0` cuando no hay actividades de tipo `SEGUIMIENTO` ese mes (`total===0`).
- `trends.cumplimiento.mesAnterior.available === false` (sin historial) → factor 3 = 0.

### Reglas de negocio
- **Fórmula congelada por decisión de producto** (Sprint 5 §S5-C): "prohíbe modificar reglas/pesos/alertas" sin ese proceso — cualquier cambio de peso/umbral debe pasar por Ajustes (configuración), no por código.
- Dispara notificación automática a superiores cuando la clasificación es Alto/Crítico (jerarquía de notificaciones, `src/lib/roles.ts`).
- `suggestedActions` se generan por regla (no por IA): sobrecarga → redistribuir; críticas vencidas → priorizar; baja capacidad (>50pts) → no asignar; variabilidad (≥60) → revisar semana a semana.

### Versión
`FORMULA_VERSIONS.riesgoOperativo = "1.0"` (nunca ha subido de versión — congelada).

### Notas
- Riesgo de regresión real documentado en el registro de auditoría no está en esta fórmula (congelada, bajo riesgo) sino en **D2**: el motor paralelo `computeRiskAlerts` (`riskAlerts.ts`) cubre una superficie parcialmente solapada con criterios distintos — ver §12.

---

## 3. Equilibrio Operativo

**Función:** `computeHealthScore` (+ `cargaHealthScore`, `consistencyToScore`, `capacityToScore`) (`src/lib/analytics.ts`); capa de interpretación: `classifyEstadoOperativo`, `computeEquilibrioInsights`, `explainEquilibrioFactor`, `explainEquilibrioMeaning`, `explainEquilibrioImpact` (`src/lib/insightsEngine.ts`).

### Objetivo
Score integral de equilibrio operativo combinando 5 dimensiones (cumplimiento, carga, vencidas, consistencia, capacidad futura) en un solo número 0-100. **No representa variables médicas, psicológicas ni psicosociales** — es un indicador puramente operativo (cumplimiento/carga/gestión de tiempos/consistencia/capacidad futura).

**Antes "Score de Salud Laboral (legacy)"** — hasta Sprint Analytics 2.0 (2026-07-24) esta función estaba congelada (Sprint 5 §S5-A) como candidata a retiro en favor de Performance Score + Operational Risk. Ese sprint la revive como indicador estrella bajo el nombre **Equilibrio Operativo** y le agrega una capa completa de explicabilidad automática (qué significa el resultado, por qué se obtuvo, qué impacto tiene, qué hacer para mejorarlo — ver "Interpretación automática" abajo), sin tocar su fórmula salvo por la normalización de Capacidad Futura descrita en "Versión". El rename es **solo de marca** (texto visible al usuario y prosa de documentación): los símbolos de código (`computeHealthScore`/`HealthScoreResult`/`HealthFactor`) y el valor persistido `AnalyticsAuditLog.kind = "health_score"` no cambiaron — ver `docs/DECISIONS.md` § Sprint Analytics 2.0.

### Fórmula
```
score = Σ weightedPoints(rawScore_i, weight_i)   para 5 factores
```

| Factor (dimensión) | rawScore | Peso (config) |
|---|---|---|
| Cumplimiento | `computeCompletedPctAny(tasks, 100)` | `healthWeightCumplimiento` |
| Carga laboral | `cargaHealthScore(realHours, baseHours, limitHigh, limitOverload)` | `healthWeightCarga` |
| Tareas vencidas | `max(0, 100 - overdueNormal×10 - overdueAlta×20)` | `healthWeightVencidas` |
| Consistencia | `consistencyToScore(consistency)` | `healthWeightConsistencia` |
| Capacidad futura | `capacityToScore(capacity.estado, capacity.disponiblePct)` | `healthWeightCapacidad` |

`cargaHealthScore` (mapea horas reales del mes a 0-100 usando los 4 límites REALES, no el % con techo en 100):
```
si baseHours<=0            → 100
si baseHours<=real<=limitHigh → 100                       (Óptimo)
si real<baseHours           → round(clamp(real/baseHours×100, 0, 100))
si no (real>limitHigh)      → overBy=real-limitHigh; span=max((limitOverload-limitHigh)×2, 1)
                               → round(max(0, 100 - overBy/span×100))
```
`consistencyToScore`: muy-consistente→100, consistente→80, variable→55, muy-variable→25, no disponible→70.

`capacityToScore` (Sprint Analytics 2.0, Bloque 9 — normalización progresiva, ver "Versión"):
```
estado="alta"                → 100
estado="limitada"/"sin-planificacion" → 70
estado="sobrecarga"          → clamp(round(100 + 2×disponiblePct), 0, 100)
si no ("no-asignar")          → 40
```
Se activa por `estado === "sobrecarga"` (el que ya calcula `classifyCapacity`, §5, cuando `disponible<0` horas) y no por el signo de `disponiblePct` — una sobrecarga leve puede redondear a `disponiblePct=0` exacto (ej. `-0.4h` sobre una base grande) y aun así debe entrar a la curva progresiva.

### Variables
Igual set que Performance Score (tareas del mes, `CargaTiempo`, `CapacityForecast`, `ConsistencyResult`) más `monthlyBusinessBase` (límites reales en horas del mes: `limitBaseHours`, `limitHighHours`, `limitOverloadHours`).

### Pesos
`healthWeightCumplimiento=25`, `healthWeightCarga=25`, `healthWeightVencidas=20`, `healthWeightConsistencia=15`, `healthWeightCapacidad=15` (suman 100, configurables en Ajustes).

### Normalización
No usa NormalizationEngine — cada `rawScore` es una fórmula propia (ver arriba), ya acotada 0-100. Clasificación interna (`HealthScoreResult.classification`, sin cambios): `≥90 Excelente`, `≥75 Bueno`, `≥60 Riesgo`, si no `Crítico`; color `≥75 green`, `≥60 yellow`, si no `red` (idénticos umbrales a Performance Score, pero **no** comparten función — ver Notas).

**Estado Operativo (presentación, Sprint Analytics 2.0, Bloques 11-12)** — capa adicional sobre el mismo `score`, NO un reemplazo de la clasificación interna de arriba (que otros consumidores como `WhatIfSimulator`/`TeamWorkloadCards`/nova-insights siguen leyendo sin cambios). `classifyEstadoOperativo(score)`:

| Rango | Estado | Color | Explicación ejecutiva |
|---|---|---|---|
| 90–100 | 🟢 Equilibrio Óptimo | green | Puede asumir nuevos desafíos |
| 75–89 | 🔵 Equilibrio Estable | blue | Operación saludable |
| 60–74 | 🟡 Requiere Atención | yellow | Se recomienda seguimiento |
| 40–59 | 🟠 Riesgo Operativo | orange | Es conveniente intervenir |
| 0–39 | 🔴 Desequilibrio Crítico | red | Se recomienda una revisión inmediata |

Se muestra siempre completa (las 5 filas, no solo la vigente) en la UI de Equilibrio Operativo — "escala de interpretación permanente".

### Interpretación automática (Sprint Analytics 2.0)
Capa de explicabilidad sobre el resultado ya calculado, **100% determinística, sin IA** (mismo estándar que `insightsEngine.ts` completo — ver §14):
- **¿Qué significa este resultado?** (`explainEquilibrioMeaning`): párrafo fijo por Estado Operativo, con la frase de tendencia (`getScoreTrendExplanation` contra `kind: "health_score"`, comparando la última auditoría vs. hace 30 días) agregada cuando hay historial disponible.
- **Fortalezas / Aspectos a mejorar** (`computeEquilibrioInsights`): itera las 5 dimensiones, reutiliza `derivedNormalizedValue(points, weight)` y el mismo umbral de ruido que Performance Score (zona "Medio" no genera insight) — Alto/Muy alto → fortaleza (`tone: "positive"`); Bajo → oportunidad (`tone: "risk"`) con una acción sugerida embebida.
- **Explicación por dimensión** (`explainEquilibrioFactor`): a diferencia de lo anterior, cubre las 5 dimensiones siempre (incluida la zona "Medio"), para que cada tarjeta de dimensión muestre explicación sin excepción.
- **¿Qué impacto tiene este resultado?** (`explainEquilibrioImpact`): frase fija por Estado Operativo (ej. "Puede asumir nuevos proyectos" / "No se recomienda incrementar responsabilidades").
- **¿Qué puedo hacer para mejorar?**: las acciones sugeridas de las oportunidades (`Insight.accion`) — reglas fijas por dimensión (`EQUILIBRIO_FACTOR_ACTION`), nunca generadas por IA.

Expuesto en `GET /api/analytics/equilibrio/[userId]` y renderizado por `EquilibrioOperativoCard.tsx`.

### Ejemplo de cálculo
Mes: 20 tareas, 16 completadas (`completedPct=80`). Carga: `realHours=120h`, `baseHours=110h`, `limitHigh=130h`, `limitOverload=145h` → `120` está entre `[110,130]` → `cargaScore=100`. Vencidas: 2 normales + 1 Alta → `overdueScore = max(0, 100-2×10-1×20) = 60`. Consistencia "consistente" → `80`. Capacidad `estado="limitada"`, `disponiblePct=15` → `capacityToScore=70`.

1. Cumplimiento: `weightedPoints(80, 25) = 20.00`
2. Carga: `weightedPoints(100, 25) = 25.00`
3. Vencidas: `weightedPoints(60, 20) = 12.00`
4. Consistencia: `weightedPoints(80, 15) = 12.00`
5. Capacidad: `weightedPoints(70, 15) = 10.50`

**Total:** `score = 20.00+25.00+12.00+12.00+10.50 = 79.50` → clasificación interna **"Bueno"** (green); Estado Operativo (75-89) → **🔵 Equilibrio Estable**, "Operación saludable".

**Antes/después de Capacidad Futura (Bloque 9)**, mismo colaborador con `estado="sobrecarga"` en vez de `"limitada"` y `disponiblePct=-30`:
- **Antes** (fórmula original, cualquier `disponiblePct<0` → 0): `capacityToScore=0` → `weightedPoints(0, 15) = 0.00` → total `20.00+25.00+12.00+12.00+0.00 = 69.00`.
- **Después** (curva progresiva, `-30%` es uno de los 7 anclajes del spec → `100+2×(-30)=40`): `capacityToScore=40` → `weightedPoints(40, 15) = 6.00` → total `20.00+25.00+12.00+12.00+6.00 = 75.00`.

Una sobrecarga de -30% ya no se trata igual que una de -90% (ambas daban 0 antes); el score refleja la gradación real.

### Casos borde
- `baseHours<=0` (mes sin días hábiles) → `cargaHealthScore` devuelve 100 directamente.
- Sin tareas asignadas → `completedPct=100` (mismo criterio que Performance Score, vía `computeCompletedPctAny(tasks, 100)`).
- Consistencia no disponible → `70` (neutro); si el nivel es "Variable"/"Muy variable", `ConsistencyResult.explain.impactNote` agrega una frase de impacto cualitativo (Bloque 10, ver §8).
- `disponiblePct` más allá de `-50%` se acota en `0`, nunca negativo (`Math.max(0, ...)`).
- `estado="sobrecarga"` con `disponiblePct` redondeado a `0` (sobrecarga leve) entra a la curva progresiva (`100+2×0=100`), no al valor plano `40` de `"no-asignar"` — ver Fórmula.

### Reglas de negocio
- El rename a "Equilibrio Operativo" es exclusivamente de marca — ver "Objetivo" arriba y `docs/DECISIONS.md`.
- Comparte el mismo `precomputedConsistency` que Performance Score dentro de `runAnalyticsPipeline` (una sola consulta de Consistencia reutilizada por ambos, no recalculada dos veces).
- La interpretación automática (fortalezas/oportunidades/recomendaciones/significado/impacto) es reglas fijas, nunca texto generado por IA — mismo principio que rige todo `insightsEngine.ts` (§14).

### Versión
`FORMULA_VERSIONS.equilibrioOperativo = "1.1"` (antes `scoreSalud`, clave de código renombrada — no persistida en BD, ver `docs/DECISIONS.md`). `FORMULA_VERSIONS.capacidadDisponible = "1.1"`. Ambas subieron por la normalización progresiva de Capacidad Futura (Sprint Analytics 2.0, Bloque 9, 2026-07-24) — único cambio matemático de ese sprint, afecta únicamente a usuarios con capacidad negativa proyectada (`estado="sobrecarga"`). `FORMULA_SET_VERSION` 4.3 → 4.4.

### Notas
- **D7** (registro de auditoría): su clasificación inline (`≥90/75/60`) **no** se fusionó con `classifyPerformanceScore()` a propósito — son dos scores que el motor mantiene deliberadamente independientes, aunque los umbrales numéricos coincidan hoy.
- `AnalyticsAuditLog.kind = "health_score"` sigue siendo el identificador persistido para este indicador (miles de filas históricas) — no se renombró junto con la marca, ver `docs/DECISIONS.md`.
- El estándar de explicabilidad de este sprint no se extendió a las tarjetas standalone de Cumplimiento/Carga/Capacidad/Trazabilidad/Predicción/Benchmark (que Equilibrio Operativo ya cubre como *dimensiones*, no como tarjetas propias) — backlog documentado en `docs/ROADMAP.md`.

---

## 4. Carga Laboral

**Funciones:** `computeCargaTiempo` (+ `computeCargaHistory`) (`src/lib/workload.ts`); semáforo vía `computeWorkloadRange`/`computeWorkloadPct`.

### Objetivo
Clasificar cuánto trabaja realmente un colaborador (horas reales registradas) frente a su base laboral esperada, en 5 zonas (semáforo), para los periodos diario/semanal/mensual.

### Fórmula
```
Zonas (computeWorkloadRange, 5 zonas por RANGO, no un punto único):
  🔴 Subutilización : realHours <  limitLow
  🟡 Moderado        : limitLow <= realHours < baseHours
  🟢 Óptimo          : baseHours <= realHours <= limitHigh
  🟠 Carga elevada   : limitHigh < realHours <= limitOverload
  🔴 Sobrecarga      : realHours > limitOverload

% de carga (computeWorkloadPct, con techo en 100% dentro de la zona Óptima):
  si realHours <= baseHours   → round(realHours/baseHours × 100)
  si realHours <= limitHigh   → 100
  si no                       → round(100 + (realHours-limitHigh)/limitHigh × 100)
```
`limitLow`, `baseHours` (=`hoursPerDay`), `limitHigh`, `limitOverload` vienen **escalados** por el caller (límite diario × días hábiles del período) para que el rango crezca proporcionalmente en vistas semanales/mensuales.

### Variables
- `realHours`: horas reales = Σ `Task.realHours` (tipo `FIJA`, completadas) + Σ `TaskActivity.duration/60`, del período.
- `baseHours` (de exhibición) y `classificationBase` (de clasificación real): normalmente iguales; difieren solo si un **Estado especial** (maternidad/lactancia) configuró `dailyHours` ≠ `limitBase` para ese registro — dos "bases" paralelas documentadas explícitamente en el código para no confundir exhibición vs. clasificación.
- `limitLow/High/Overload`: `getEffectiveWorkloadLimitLow/High/Overload` (`systemConfig.ts`), ponderados día a día por permisos/estado especial vía `sumWeightedBaseHours`/`sumWeightedLimit`.

### Pesos
No son "pesos" (no es una suma ponderada) sino **4 límites independientes** configurables (`ANALYTICS_CONFIG_DEFAULTS` no los incluye — viven en claves propias de `systemConfig.ts`, no en `ANALYTICS_CONFIG_DEFAULTS`):
- `HORAS_EFECTIVAS_DIA` (base) = **6.5 h/día** (`DEFAULT_HORAS_EFECTIVAS`)
- `workload_limit_low` = **5.5 h/día** (`DEFAULT_WORKLOAD_LIMIT_LOW`)
- `workload_limit_high` = **7.5 h/día** (`DEFAULT_WORKLOAD_LIMIT_HIGH`)
- `workload_limit_overload` = **8.5 h/día** (`DEFAULT_WORKLOAD_LIMIT_OVERLOAD`)

Deliberadamente independientes entre sí (no derivados de base ± tolerancia) para que un cambio en uno no desalinee silenciosamente los demás.

### Normalización
No usa NormalizationEngine directamente en `workload.ts` (el semáforo de 5 zonas es su propia clasificación por rango) — pero el Performance/Operational Risk sí normalizan la carga vía la curva `carga` (bell curve, ver §13) cuando la usan como input.

### Ejemplo de cálculo
Vista diaria: `hoursPerDay=6.5`, `limitLow=5.5`, `limitHigh=7.5`, `limitOverload=8.5`. Un día con `realHours=7.667h`.

1. Zona: `7.667 > limitHigh(7.5)` y `7.667 <= limitOverload(8.5)` → **"Carga elevada"** (naranja).
2. %: `realHours(7.667) > baseHours(6.5)`, y `7.667 > limitHigh(7.5)` (fuera de la zona óptima) → `pct = round(100 + (7.667-7.5)/7.5 × 100) = round(100 + 2.23) ≈ 102%`.

(Este es el ejemplo citado explícitamente en el propio comentario del código: "7.667h con límite óptimo 7.5h da ~102%, no un salto brusco".)

Vista mensual con 22 días hábiles: `baseHours=22×6.5=143h`, `limitLow=22×5.5=121h`, `limitHigh=22×7.5=165h`, `limitOverload=22×8.5=187h`. `realHours=150h` → `143<=150<=165` → **"Óptimo"**, `pct=100%` (dentro de zona óptima, techo en 100).

### Casos borde
- `baseHours<=0` (mes/semana sin días hábiles): si `realHours>0` → `{color: orange, label: "Carga elevada"}`; si no → `{color: green, label: "Óptimo"}` (sin división por cero).
- Fin de semana/feriado: sin base laboral — se muestra como "trabajo en fin de semana"/"trabajo en feriado" en vez de forzar una clasificación sin sentido (`computeCargaTiempo`, rama `todayIsWeekendDay || todayIsHolidayDay`).
- Permiso parcial (médico/personal) un día: reduce proporcionalmente **toda** la envolvente del día (base y los 4 límites) vía `dayFactor = max(0, 1 - leaveHours/dailyHours)` — evita que un permiso de 3h en un día de 6.5h marque falsamente "Subutilización".
- Ajuste `User.kpiStartDate`: si cae dentro del mes en curso, los días anteriores no cuentan para la base laboral ni las horas reales.

### Reglas de negocio
- `computeWorkloadPct`/`computeWorkloadRange` son la **única fuente** para toda clasificación de carga en 5 zonas (Registro de auditoría, **D5** — confirmado sin duplicación fuera de `workload.ts`).
- `WorkloadColor` "red" es **ambiguo** entre Subutilización y Sobrecarga (comparten color) — código que necesita distinguir "carga excesiva" de "carga insuficiente" debe usar `WorkloadLabel`, no `WorkloadColor` (bug real documentado y corregido en `riskAlerts.ts`, ver §12).

### Versión
`FORMULA_VERSIONS.cargaLaboral = "1.0"`.

### Notas
- Riesgo de regresión (registro de auditoría): Medio — la existencia de `baseHours` vs. `classificationBase` como dos denominadores distintos es fácil de confundir en cambios futuros; documentado extensamente en comentarios del código (`toMetric`, `sumWeightedBaseHours`).

---

## 5. Capacidad Disponible / Capacity Forecast

**Funciones:** `computeCapacityForecast` / `computeTeamCapacityForecast` (+ `classifyCapacity`) (`src/lib/capacityForecast.ts`)

### Objetivo
Proyectar hacia adelante (desde ahora hasta fin de mes, nunca hacia atrás) cuánta capacidad libre tiene un colaborador para **asumir nuevas tareas** — distinto de "Carga Laboral" (§4), que mide el mes ya transcurrido.

### Fórmula
```
baseFuturaTotal    = horasRestantesHoy + Σ(baseHours ponderada de días hábiles futuros, mañana→fin de mes)
comprometidoEnProgreso = Σ max(0, getOfficialTargetTime(t) - t.realHours)   para tareas EN_PROGRESO con target>0
comprometidoPendiente  = Σ getOfficialTargetTime(t)                         para tareas PENDIENTE (dentro de ventana) con target>0
comprometidoFuturo = comprometidoEnProgreso + comprometidoPendiente

disponible    = baseFuturaTotal - comprometidoFuturo
disponiblePct = baseFuturaTotal>0 ? round(disponible/baseFuturaTotal × 100) : 0

horasRestantesHoy = (día hábil AND antes de las 17:00 hora local) ? max(0, horasEfectivasHoy - horasYaTrabajadasHoy) : 0
```

`classifyCapacity(disponible, baseFuturaTotal, disponiblePct)`:
```
baseFuturaTotal<=0     → "sin-planificacion" (gray)
disponible<0           → "sobrecarga" (red)
disponiblePct>20       → "alta" (green)     "Puede asumir proyectos"
disponiblePct>=10      → "limitada" (yellow) "Capacidad limitada"
si no                  → "no-asignar" (red)  "No asignar nuevas tareas"
```

### Variables
- `getOfficialTargetTime(task)`: Tiempo Objetivo oficial = `targetTimeValidated ?? estimatedHours` (ver §11).
- `WORKDAY_END_HOUR_LOCAL = 17` (hora de corte, hardcodeada, **no configurable**).
- `diasLaborablesRestantes`: días hábiles desde mañana hasta fin de mes (`countBusinessDays`, holiday-aware).
- Permisos (`LeaveRecord`) y Estado especial reducen `baseFuturaTotal` día a día vía `sumWeightedBaseHours`.

### Pesos
No aplica (no es una suma ponderada) — sí depende de: `getEffectiveHorasEfectivas` (6.5h/día por defecto) y de la penalización de confiabilidad:
```
confiabilidadPct = clamp(0, 100, 100 - tasksSinEstimar×5 - (holidaysConfigured ? 0 : 3))
```

### Normalización
No usa NormalizationEngine en el cálculo — el simulador de escenarios (`/api/analytics/simulate`) sí normaliza `disponiblePct` con la curva `capacidad` (§13) cuando recompone Performance/Health/Risk Score bajo un escenario hipotético.

### Ejemplo de cálculo
Hoy es día hábil, 10:00 hora local (antes del corte de 17:00). `hoursPerDay=6.5h`, ya trabajó 2h hoy → `horasRestantesHoy = max(0, 6.5-2) = 4.5h`. Quedan 10 días hábiles el resto del mes, sin permisos/estado especial → `baseFuturaFullDays = 10×6.5 = 65h`. `baseFuturaTotal = 4.5+65 = 69.5h`.

Tareas abiertas: 1 `EN_PROGRESO` con Tiempo Objetivo oficial `20h`, `realHours=8h` ya trabajadas → `comprometidoEnProgreso = max(0, 20-8) = 12h`. 2 tareas `PENDIENTE` dentro de la ventana con Tiempo Objetivo `10h` y `15h` → `comprometidoPendiente = 25h`. `comprometidoFuturo = 12+25 = 37h`.

`disponible = 69.5-37 = 32.5h`. `disponiblePct = round(32.5/69.5×100) = round(46.76) = 47%`.

`classifyCapacity(32.5, 69.5, 47)`: `47>20` → **"alta"** (verde), "Puede asumir proyectos".

Confiabilidad: `tasksSinEstimar=0`, feriados configurados → `confiabilidadPct=100`.

### Casos borde
- `workdayEnded` (hora local ≥17:00) o hoy no es día hábil → `horasRestantesHoy=0` (no cuenta el día actual como parcial).
- `baseFuturaTotal<=0` (fin de mes con 0 días hábiles restantes) → `"sin-planificacion"`, evita división por cero en `disponiblePct`.
- No se infieren permisos por ausencia de actividad — un colaborador puede estar en entrevistas/capacitaciones sin registrar `TaskActivity`; inferir un permiso generaría falsos positivos (documentado explícitamente en el código, ver también §Calidad de datos).

### Reglas de negocio
- El Tiempo Objetivo **Validado** es siempre la referencia oficial cuando existe (Sprint 6 §S6-H) — nunca el estimado inicial obsoleto una vez validado.
- `classifyCapacity` es la única fuente del semáforo de capacidad — reutilizada por `computeTeamCapacityForecast`, `computeTeamRecommendations` y el simulador (Registro de auditoría, D5 confirmado sin duplicación).

### Versión
`FORMULA_VERSIONS.capacidadDisponible = "1.1"` (subió desde `"1.0"` por la normalización progresiva de `capacityToScore` — Sprint Analytics 2.0, Bloque 9, ver §3 — que consume `classifyCapacity` tal cual, sin cambios en esta función; el bump documenta que el *consumidor* de su salida cambió, no `classifyCapacity` en sí).

### Notas
- Riesgo de regresión (registro de auditoría): Medio — la hora de corte de jornada (17:00) está hardcodeada, no configurable; un cambio de horario de oficina requeriría tocar código, no Ajustes.
- "Horas Comprometidas (futuro)" (`comprometidoEnProgreso`/`comprometidoPendiente`/`comprometidoFuturo`) no tiene función exportada propia — vive embebido en este cálculo, versionado junto con `capacidadDisponible`.

---

## 6. Cumplimiento

**Función canónica:** `computeCompletedPctAny` (`src/lib/analytics.ts`)

### Objetivo
Medir qué porcentaje de las tareas de un período se completaron. **Existen DOS definiciones distintas coexistiendo bajo el mismo nombre de campo (`completedPct`)** — ver "Reglas de negocio" abajo, esta es la inconsistencia más importante documentada en `docs/ANALYTICS_CALCULATION_REGISTRY.md` §D1.

### Fórmula
**Definición A — "completado en cualquier momento"** (la que documenta esta sección, usada por el motor central):
```
completedPct = tasks.length === 0
  ? emptyValue        // 0 (reportes/rankings) o 100 (Health/Performance Score)
  : round(tasks.filter(t => t.status === "COMPLETADA").length / tasks.length × 100)
```

**Definición B — "completado A TIEMPO"** (`isCompletedOnTime`, `src/lib/priorityCompliance.ts`, §7):
```
isCompletedOnTime(t) = t.status === "COMPLETADA" && t.completedAt != null
  && businessCalendarDay(t.completedAt) <= utcCalendarDay(t.endDate)
```
Comparación por **día calendario en huso de negocio (UTC-5)**, no por
instante UTC crudo — corregido 2026-07-24 (ver "Casos borde" y
`docs/AUDIT_LOG.md` § 2026-07-24). `endDate` es fecha pura (UTC-medianoche
por convención, se lee sin desplazar con `utcCalendarDay`); `completedAt` es
un instante real (`new Date()` al momento del PATCH) y por eso se desplaza a
huso de negocio con `businessCalendarDay` antes de comparar — mismo patrón
que usa `isTaskOverdue` para "vencida".

### Variables
- `tasks`: array de `{ status }` (Definición A) o `{ status, completedAt, endDate }` (Definición B) del período.
- `emptyValue`: `0 | 100` — parámetro explícito de `computeCompletedPctAny`, documenta una diferencia **real y no accidental**: reportes/rankings/histórico muestran `0` (sin tareas = sin dato), mientras Health/Performance Score muestran `100` (sin tareas asignadas ese mes no debe penalizar el score).

### Pesos
No aplica (no es una suma ponderada).

### Normalización
No aplica directamente — el resultado (0-100) alimenta la curva `cumplimiento` (identidad) cuando se usa dentro de Performance Score.

### Ejemplo de cálculo
20 tareas del mes, 16 con `status === "COMPLETADA"` (sin importar si se cerraron a tiempo):
```
completedPct (Definición A) = round(16/20 × 100) = 80%
```
De esas mismas 20 tareas, solo 13 se cerraron con `completedAt <= endDate` (3 de las 16 completadas se cerraron tarde):
```
completedPct (Definición B, "a tiempo") = round(13/20 × 100) = 65%
```
**El mismo colaborador, el mismo mes, ve 80% en un módulo y 65% en otro** — ver Reglas de negocio.

### Casos borde
- `tasks.length === 0` → devuelve `emptyValue` directamente (`0` o `100` según el caller), nunca `NaN` por división 0/0.
- Definición B: `completedAt === null` (tarea completada pero sin fecha de cierre registrada, no debería ocurrir en datos consistentes) → `isCompletedOnTime` devuelve `false` explícitamente (`completedAt != null` es parte de la condición). Auditoría del 2026-07-24 encontró 33 de 121 tareas `COMPLETADA` con `completedAt = NULL` en producción — anteriores a la migración `20260707004617` que agregó la columna, sin backfill.
- **Bug corregido 2026-07-24** (ver `docs/AUDIT_LOG.md`): la comparación anterior (`completedAt.getTime() <= endDate.getTime()`, instante UTC crudo) clasificaba como "tardía" cualquier tarea cerrada durante el horario laboral real del propio día de vencimiento, porque medianoche UTC del día de vencimiento equivale a las 7pm del día ANTERIOR en huso de negocio (UTC-5). Auditoría empírica sobre datos reales: de 65 tareas clasificadas como "fuera de tiempo", 33 (51%) se habían completado el mismo día calendario en huso de negocio. Corregido para comparar por día calendario, igual que `isTaskOverdue`.

### Reglas de negocio
- **Consolidación de fórmula ya resuelta** (2026-07-21, Registro de auditoría §D1): las 4 reimplementaciones inline dentro de `analytics.ts` (`computeMonthlyHistory`, `computeWeeklyHistory`, `computeHealthScore`, `computePerformanceScore`) y 5 rutas externas (`kpis/team`, `kpis/executive`, `kpis/me/range`, `reports/generate`, `reports/range`) ahora llaman a esta única función.
- **NO resuelto, a propósito** — la Definición A y la Definición B siguen siendo dos fórmulas distintas bajo el mismo nombre `completedPct`: `/api/kpis/[userId]` y `/api/kpis/me` (vista personal) muestran la Definición B ("a tiempo"), mientras que el ranking ejecutivo, el panel de equipo, el reporte mensual/de rango y el motor central de Analytics muestran la Definición A ("cualquier momento") — **para el mismo mes, sin que ninguna UI aclare la diferencia**. Decidir cuál debería ser la única oficial (o si ambas deben coexistir con nombres de campo distintos, p. ej. `completedAnyPct` vs. `completedOnTimePct`) es una **decisión de negocio pendiente**, documentada pero no resuelta.
- `validateCumplimientoConsistency` (§S3-C) solo compara cumplimiento general vs. por prioridad (ambos Definición B) — **no detecta** el desacuerdo entre A y B porque nunca los cruza.

### Versión
`FORMULA_VERSIONS.cumplimiento = "2.0"` — aplica solo a la Definición A dentro del motor central. La Definición B tiene su propia entrada desde esta corrección: `FORMULA_VERSIONS.completadoATiempo = "1.0"` (§7).

### Notas
- Riesgo de regresión (registro de auditoría): **Alto** a nivel sistema — cualquier cambio a una definición no se propaga a la otra; eran 8 implementaciones divergentes antes de la consolidación de fórmula (que resolvió la duplicación de código, no la duplicación de definición de negocio).
- `computeMonthlyCompliancePace` (usada por Predicción, §9) era una 4ª reimplementación de esta misma cuenta dentro del propio `analytics.ts` — corregida (D4) para reutilizar `computeMonthlyHistory` en vez de su propia consulta.

---

## 7. Cumplimiento por Prioridad

**Función:** `computePriorityCompliance` (+ `isCompletedOnTime`) (`src/lib/priorityCompliance.ts`)

### Objetivo
Desglosar el cumplimiento "a tiempo" (Definición B) por nivel de prioridad (`ALTA`/`MEDIA`/`BAJA`), para detectar si las tareas más importantes se están cumpliendo peor que el promedio.

### Fórmula
```
para cada priority en [ALTA, MEDIA, BAJA]:
  forPriority     = tasks.filter(t => t.priority === priority)
  completedOnTime = forPriority.filter(isCompletedOnTime).length
  total           = forPriority.length
  pct             = total>0 ? round(completedOnTime/total × 100) : 0
```
`isCompletedOnTime(t) = t.status === "COMPLETADA" && t.completedAt != null && businessCalendarDay(t.completedAt) <= utcCalendarDay(t.endDate)` (corregido 2026-07-24, comparación por día calendario en huso de negocio) — **la misma función** que usa `/api/kpis/[userId]`/`/api/kpis/me` para el cumplimiento general (garantiza coherencia entre el desglose y el total, dentro de la Definición B).

### Variables
- `tasks`: `{ priority, status, completedAt, endDate }[]` del período.

### Pesos
No aplica.

### Normalización
No aplica — es un porcentaje directo por categoría, sin curva.

### Ejemplo de cálculo
Mes con tareas por prioridad:
- `ALTA`: 5 tareas, 4 completadas a tiempo → `pct = round(4/5×100) = 80%`
- `MEDIA`: 10 tareas, 6 completadas a tiempo → `pct = round(6/10×100) = 60%`
- `BAJA`: 5 tareas, 3 completadas a tiempo → `pct = round(3/5×100) = 60%`

Resultado: `[{ALTA,5,4,80}, {MEDIA,10,6,60}, {BAJA,5,3,60}]`.

### Casos borde
- Prioridad sin tareas en el período → se incluye igual en el resultado con `{ total: 0, completedOnTime: 0, pct: 0 }` (nunca se omite la fila) — el componente que consume esto decide cómo mostrar el caso sin datos.

### Reglas de negocio
- Usa la Definición B ("a tiempo"), consistente con `/api/kpis/[userId]`/`/api/kpis/me` — **no** es consumida por el motor central (`analytics.ts`), que usa la Definición A (§6) para sus propios cálculos internos.
- `validateCumplimientoConsistency` cruza la suma de `total` por prioridad contra el total general, y compara el promedio ponderado por prioridad contra el % general con tolerancia de 15 puntos porcentuales — si difiere más, registra `cumplimiento_incoherente` como fallo de validación.

### Versión
`FORMULA_VERSIONS.completadoATiempo = "1.0"` (nueva, 2026-07-24) — primera vez que `isCompletedOnTime` se versiona; v1.0 es ya la forma corregida (comparación por día calendario), no la comparación cruda por instante que tenía antes de esta fecha.

### Notas
- Confirmado sin duplicación fuera de `priorityCompliance.ts` (Registro de auditoría, D5).
- **Corrección 2026-07-24**: `isCompletedOnTime` comparaba `completedAt.getTime() <= endDate.getTime()` (instante UTC crudo) en vez de por día calendario — ver §6 "Casos borde" para el detalle completo y `docs/AUDIT_LOG.md` para la auditoría empírica sobre datos de producción que motivó la corrección.

---

## 8. Consistencia

**Función:** `computeConsistency` (+ `consistencyLevelFromCv`, `consistencyPctFromCv`, `consistencyReliabilityFromWeeks`) (`src/lib/analytics.ts`)

### Objetivo
Medir qué tan estable es el ritmo de trabajo de un colaborador semana a semana (horas, tareas completadas, cumplimiento) — un CV alto indica semanas muy irregulares, aunque el promedio esté bien.

### Fórmula
```
CV_serie = (sd(serie) / |mean(serie)|) × 100        // stddev()
avgCv = ( CV(horas_reales) + CV(tareas_completadas) + CV(cumplimiento) ) / 3    sobre semanas VÁLIDAS

consistencyPct = round( 100 / (1 + avgCv/100), 1 )   // siempre en (0,100], nunca requiere un min(100,…)
```
Clasificación por `avgCv`: `<10 muy-consistente`, `<20 consistente`, `<35 variable`, si no `muy-variable`.
Confiabilidad (★) por **cantidad de semanas válidas** (no por el CV): `≤4 baja(2★)`, `≤8 media(3★)`, `≤12 alta(4★)`, `>12 muy-alta(5★)`.

**Auto-explicación cuando el nivel es Variable (Sprint Analytics 2.0, Bloque 10)** — `ConsistencyResult.explain.impactNote` (nuevo campo, `string | null`):
```
muy-consistente / consistente → null   (sin nota — el nivel no lo amerita)
variable                      → "reduciendo la estabilidad operativa"
muy-variable                  → "afectando significativamente la previsibilidad operativa"
```
El resto de los datos del párrafo auto-generado (`% de variación` = `avgCv`, `semanas afectadas` = `weeksAnalyzed`, `motivo` = `explain.periodsExcluded[].reason`) ya existían — Bloque 10 solo agrega la frase de impacto cualitativo. Ejemplo (nivel "variable", `avgCv=37`): *"La distribución semanal presentó una variación del 37%, indicando diferencias importantes entre semanas que reducen la estabilidad operativa."*

### Variables
- Se evalúan hasta `CONSISTENCY_LOOKBACK_WEEKS = 16` semanas hacia atrás (`computeWeeklyHistory`).
- `computeEffectiveHistoryStart(userId)`: fecha efectiva desde la que existe historial real — MAX de: primer `TaskActivity`, primera tarea completada, primera imputación de horas, `User.kpiStartDate`, `User.createdAt`.
- Una semana es **válida** solo si: termina después de la fecha efectiva de inicio, tiene `businessDays>0`, tiene `daysWithRegistration>0`, y no está anulada por permiso/vacaciones de **día completo** durante toda la semana.
- `CONSISTENCY_MIN_WEEKS = 2` — mínimo de semanas válidas para calcular.

### Pesos
No aplica (promedio simple de 3 coeficientes de variación, sin ponderación distinta entre ellos).

### Normalización
El resultado (`consistencyPct`, ya 0-100) alimenta la curva `consistencia` (identidad) cuando se usa dentro de Performance Score.

### Ejemplo de cálculo
6 semanas válidas con horas reales `[30, 32, 28, 31, 29, 33]`:
```
mean = (30+32+28+31+29+33)/6 = 183/6 = 30.5
desviaciones² : (-0.5)²=0.25, (1.5)²=2.25, (-2.5)²=6.25, (0.5)²=0.25, (-1.5)²=2.25, (2.5)²=6.25 → Σ=17.5
variance = 17.5/6 = 2.9167 → sd = 1.708
CV_horas = 1.708/30.5 × 100 = 5.60%
```
Tareas completadas por semana `[4, 5, 3, 4, 4, 5]`: `mean=4.1667`, `sd=0.6872` → `CV_tareas = 0.6872/4.1667 × 100 = 16.49%`.
Cumplimiento semanal `[80, 83, 75, 80, 80, 83]`: `mean=80.1667`, `sd=2.672` → `CV_cumplimiento = 2.672/80.1667 × 100 = 3.33%`.

```
avgCv = (5.60 + 16.49 + 3.33) / 3 = 8.47%
consistencyPct = round(100 / (1 + 8.47/100), 1) = round(92.19, 1) = 92.2%
```
Clasificación: `avgCv(8.47) < 10` → **"Muy consistente"**. Confiabilidad: 6 semanas válidas → `≤8` → **media (3★)**.

### Casos borde
- `validWeeks.length < 2` → `{ available: false, reason: "Historial insuficiente..." }` (incluye el conteo de días con datos si los hubo).
- `hoursMean <= 0` (todas las semanas válidas con 0 horas — no debería ocurrir dado el filtro de `daysWithRegistration>0`, pero se verifica igual) → `available: false`.
- Semanas excluidas explícitamente con motivo: "Anterior al inicio efectivo del historial", "Sin base laboral esa semana (feriados/fin de semana)", "Sin registros esa semana", "Semana anulada por vacaciones o permiso de día completo".

### Reglas de negocio
- **Corrección Analytics Engine v1.3.1**: antes de esta versión, el motor asumía que existían semanas anteriores al inicio real de los registros del colaborador, contándolas como "con base laboral pero cero horas" — esto **inflaba artificialmente el CV**. `computeEffectiveHistoryStart` corrige esto usando la señal más reciente disponible (un dato posterior siempre gana sobre uno más antiguo, mismo criterio que `kpiStartDate` en `workload.ts`).
- La confiabilidad depende **solo** del tamaño de la muestra (cantidad de semanas), nunca de qué tan consistente resultó el CV en sí — son dos preguntas distintas ("¿cuánto confío en este número?" vs. "¿qué dice el número?").

### Versión
`FORMULA_VERSIONS.consistencia = "2.1"` (subió desde `2.0` al excluir semanas sin historial válido/registro/permiso completo — antes esas semanas inflaban el CV).

### Notas
- Bien cubierta por tests puros (`consistencyLevelFromCv`, `consistencyPctFromCv`, `consistencyReliabilityFromWeeks` son funciones puras testeables sin BD) — riesgo de regresión Bajo según el registro de auditoría.

---

## 9. Predicción

**Función:** `computePrediction` (+ `computePredictionConfidencePct`, `computeMonthlyCompliancePace`) (`src/lib/analytics.ts`)

### Objetivo
Proyectar la carga de la próxima semana (regresión lineal simple sobre horas reales semanales) y el cumplimiento estimado al cierre del mes (extrapolación de ritmo), siempre con una confianza explícita y nunca al 100%.

### Fórmula
**Regresión lineal simple** (carga de la próxima semana), sobre hasta 6 semanas de `realHours`:
```
n = semanas con datos (businessDays>0)
x_i = índice de semana (0..n-1), y_i = realHours de esa semana
xMean = (n-1)/2,  yMean = mean(y)
slope = Σ(x_i-xMean)(y_i-yMean) / Σ(x_i-xMean)²        (0 si el denominador es 0)
cargaProximaSemanaHoras = max(0, round(yMean + slope×n, 2))
```
**Ritmo de cumplimiento al cierre de mes** (`computeMonthlyCompliancePace`, reutiliza `computeMonthlyHistory` — Definición A, §6):
```
projected = completedPct_actual × (díasHábilesDelMes / díasHábilesTranscurridos)
cumplimientoEstimadoCierreMes = min(100, round(projected))
```
**Confianza numérica** (nunca 100%, `MAX_PREDICTION_CONFIDENCE_PCT=92`):
```
dataScore       = min(1, weeksOfData/6)
consistencyScore = muy-consistente→1, consistente→0.8, variable→0.5, muy-variable→0.25, no-disponible→0.5
horizonScore    = 1 - (min(díasRestantes, PREDICTION_MAX_DAYS=30)/30) × 0.4
confidencePct   = round(92 × (0.4×dataScore + 0.4×consistencyScore + 0.2×horizonScore))
```
**Rango del cumplimiento estimado:**
```
halfWidth = max(2, round((100-confidencePct) × 0.2))
rango = [max(0, estimado-halfWidth), min(100, estimado+halfWidth)]
```

### Variables
- `weekly`: `computeWeeklyHistory(userId, 6, now)`, filtrado a semanas con `businessDays>0`.
- `consistency`: `ConsistencyResult` (§8).
- `daysRemaining`: días calendario restantes hasta fin de mes.
- `PREDICTION_MAX_DAYS = 30` — **fijo por diseño, no configurable** (más allá de eso la precisión cae demasiado).
- `horasParaRangoOptimo`: si la carga mensual actual está en "Subutilización", `max(0, round(rangeMin - realHours, 2))`; si no, `0`.

### Pesos
`predictionMinWeeksMedia = 2` (config) — mínimo de semanas con datos para confianza "media" (categórica, distinta de `confidencePct`). No hay pesos configurables dentro de la fórmula de `confidencePct` en sí (los coeficientes 0.4/0.4/0.2 están hardcodeados).

### Normalización
No usa NormalizationEngine — `confidencePct` tiene su propia fórmula acotada (0-92%) por diseño.

### Ejemplo de cálculo
4 semanas con `realHours = [28, 30, 32, 34]`:
```
xMean = (4-1)/2 = 1.5,  yMean = (28+30+32+34)/4 = 31
num = (0-1.5)(28-31) + (1-1.5)(30-31) + (2-1.5)(32-31) + (3-1.5)(34-31)
    = (-1.5)(-3) + (-0.5)(-1) + (0.5)(1) + (1.5)(3) = 4.5+0.5+0.5+4.5 = 10
den = (-1.5)²+(-0.5)²+(0.5)²+(1.5)² = 2.25+0.25+0.25+2.25 = 5
slope = 10/5 = 2
cargaProximaSemanaHoras = max(0, round(31 + 2×4, 2)) = 39h
```
Confianza categórica: `n=4 > 3` → `"alta"`.

Ritmo de cumplimiento: mes con 22 días hábiles totales, 15 transcurridos, `completedPct_actual=55%`:
```
projected = 55 × (22/15) = 55 × 1.4667 = 80.67 → cumplimientoEstimadoCierreMes = min(100, round(80.67)) = 81%
```
Confianza numérica: `weeksOfData=4` → `dataScore=min(1,4/6)=0.667`; consistencia "consistente" → `consistencyScore=0.8`; `daysRemaining=7` → `horizonScore=1-(7/30)×0.4=0.9067`:
```
confidencePct = round(92×(0.4×0.667 + 0.4×0.8 + 0.2×0.9067)) = round(92×(0.2667+0.32+0.1813)) = round(92×0.768) = round(70.66) = 71%
```
Rango: `halfWidth = max(2, round((100-71)×0.2)) = max(2, round(5.8)) = 6` → `rango = [75, 87]`.

`horasParaRangoOptimo = 0` (la carga mensual no está en Subutilización en este ejemplo).

### Casos borde
- Ninguna semana con `businessDays>0` → `{ available: false, reason: "Sin historial suficiente" }`.
- `den === 0` (todas las semanas con el mismo índice x — no ocurre en la práctica con n≥1, pero se protege) → `slope=0`.
- `elapsedBusinessDays === 0` o `totalTasks === 0` este mes → `computeMonthlyCompliancePace` devuelve `0` directamente (evita división por cero).

### Reglas de negocio
- La confianza **nunca llega a 100%** — techo fijo de 92%, decisión de producto explícita (Sprint 1 §S1-C) para no transmitir falsa certeza en una proyección.
- `computeMonthlyCompliancePace` reutiliza `computeMonthlyHistory` (misma Definición A que el resto del motor) desde la corrección D4 — antes tenía su propia consulta y su propio cálculo de `completedPct`, una 4ª variante redundante dentro del mismo archivo. Efecto residual (documentado, no un bug): `computeMonthlyHistory.completedPct` viene redondeado a entero *antes* de aplicar el factor de proyección, mientras la versión anterior redondeaba solo al final — diferencia de como máximo ±1 punto porcentual en casos de borde.

### Versión
`FORMULA_VERSIONS.prediccion = "2.0"`.

### Notas
- Riesgo de regresión Bajo (registro de auditoría) — acotada y con techo de confianza fijo que evita falsa certeza.

---

## 10. Benchmark Inteligente

**Función:** `computeSmartBenchmark` (+ `buildCargoBenchmark`, `buildCargoBenchmarkCarga`, `buildCargoLimitadoBenchmark`, `buildPersonalFromAuditHistory`, `buildPersonalFromWorkHistory`, `buildPersonalCapacidadFutura`) (`src/lib/analytics.ts`)

### Objetivo
Comparar a un colaborador contra sus pares del **mismo cargo** (`Role`) cuando hay muestra suficiente, o contra su **propio historial** cuando no la hay — nunca devuelve "sin compañeros para comparar" (Sprint 7 reemplaza el benchmark de Sprint 5, que sí lo hacía, mala experiencia para cargos de una sola persona).

### Fórmula
**Motor de decisión** (aplica a los 5 indicadores por igual: Performance, Riesgo Operativo, Cumplimiento, Carga Laboral, Capacidad Futura):
```
peerCount >= 3   → Nivel 1 "cargo"           (promedio, percentil, mejor del cargo, diff vs. promedio)
peerCount === 2  → Nivel 2 "cargo-limitado"  (SOLO promedio y diff — nunca percentil/mejor, n=2 no representativo)
peerCount <= 1   → Nivel 3 "personal"        (contra el propio historial + objetivo del cargo si está configurado)
```
**Nivel 1 — genérico** (mayor=mejor, p. ej. Performance/Cumplimiento/Capacidad):
```
peerAverage    = round(mean(peerValues), 1)
percentile     = round( count(peers no-mejores-que-value) / peerCount × 100 )
best           = max(value, ...peerValues)          (min si higherIsBetter=false, p. ej. Riesgo Operativo)
diffFromAverage = round(value - peerAverage, 1)
```
**Nivel 1 — Carga Laboral** (óptimo=100%, "mejor" = más cercano a 100, no mayor magnitud):
```
distance(v) = |v - 100|
percentile  = round( count(peers con distance>=distance(value)) / peerCount × 100 )
best        = el valor (propio o de pares) con menor distance(v)
```
**Nivel 3 — Performance/Riesgo** (`buildPersonalFromAuditHistory`, historial vía `AnalyticsAuditLog`, ventana `PERSONAL_HISTORY_WINDOW_DAYS=366`):
```
bestEver       = max(scores) [o min si higherIsBetter=false]
avgLast90Days  = mean(scores de los últimos 90 días)
semanaAnterior = closestScoredPoint(history, now, 7 días, tolerancia 3 días)
mesAnterior    = closestScoredPoint(history, now, 30 días, tolerancia 3 días)
targetGap      = target !== null ? round(value - target, 1) : null
```
**Nivel 3 — Cumplimiento/Carga** (`buildPersonalFromWorkHistory`, recalculado siempre desde tablas fuente, no desde auditoría — más preciso que muestrear el log): mismo patrón, usando `computeMonthlyHistory`/`computeWeeklyHistory` en vez de `AnalyticsAuditLog`.

### Variables
- `peers`: usuarios con el mismo `Role` exacto (nunca cruza roles distintos aunque compartan `ROLE_LEVEL`, p. ej. Coordinador ZS vs. Analista CC, ambos nivel 2, **nunca** se comparan entre sí).
- `roleTarget`: `getEffectiveRoleTarget(role)` — objetivo opcional configurado en Ajustes; `null` si nunca se configuró (nunca se inventa un valor).
- Las 5 métricas por persona vienen de `computeBenchmarkMetricValues` (reutiliza cachés `perf-bench:`/`risk-bench:`/`monthly-bench:`/`capacity-bench:`, compartidas con `/api/kpis/executive`).

### Pesos
No aplica (no es una suma ponderada) — el único parámetro configurable es `roleTarget` (`performance`, `riesgoMax`, `cumplimiento` opcionales por `Role`, vía `setRoleTarget`, Ajustes §Sprint 7). Capacidad futura **no** tiene objetivo de cargo configurable (Sprint 7 solo define Performance/Riesgo/Cumplimiento).

### Normalización
No aplica directamente — opera sobre valores ya calculados (0-100 o horas) de otros KPIs.

### Ejemplo de cálculo
**Modo "cargo"** (4 pares del mismo `Role`): Performance Score propio = `82`, pares = `[75, 88, 70, 79]`.
```
peerAverage = round((75+88+70+79)/4, 1) = round(78, 1) = 78.0
notBetter = count(peers <= 82) = {75,70,79} → 3     (88 no cuenta, es mejor)
percentile = round(3/4 × 100) = 75
best = max(82,75,88,70,79) = 88
diffFromAverage = round(82-78, 1) = 4.0
```
Resultado: `{ mode:"cargo", value:82, peerAverage:78.0, percentile:75, best:88, diffFromAverage:4.0, peerCount:4 }`.

**Modo "personal"** (cargo único, sin pares): Performance Score propio = `82`; historial de auditoría de los últimos 366 días con scores `[78, 80, 85, 82, 79]`; objetivo de cargo configurado = `85`.
```
bestEver = max(78,80,85,82,79) = 85 → bestEverDiff = round(82-85, 1) = -3.0
avgLast90Days = (78+80+85+82+79)/5 = 404/5 = 80.8 → avgLast90DaysDiff = round(82-80.8, 1) = 1.2
semanaAnterior (punto más cercano a hace 7 días) = 80 → diff = 2.0
mesAnterior (punto más cercano a hace 30 días) = 78 → diff = 4.0
targetGap = round(82-85, 1) = -3.0
```

### Casos borde
- `peerValues` vacío en modo "cargo"/"cargo-limitado" no puede ocurrir por construcción (el modo se decide por `peerCount`).
- Sin historial personal (modo "personal", `history.length===0`) → `emptyPersonalMetric(value, target, "Sin historial personal suficiente todavía.")` — todos los campos de comparación en `null`, nunca inventa un valor.
- Capacidad Futura en modo personal → **siempre** `emptyPersonalMetric` con nota explícita ("es una proyección hacia adelante — no existe un historial acumulado comparable"), nunca compara contra historial ni tiene objetivo de cargo.

### Reglas de negocio
- **Nunca compara cargos distintos**, aunque compartan nivel jerárquico (`ROLE_LEVEL`).
- **Nunca modifica el cálculo de ningún KPI** — el objetivo del cargo es solo referencia visual.
- **Nunca devuelve "sin compañeros para comparar"** — siempre hay un benchmark útil que mostrar (motivo explícito del rediseño Sprint 7 sobre el benchmark de pares de Sprint 5).

### Versión
`FORMULA_VERSIONS.benchmarkInteligente = "1.0"` (Sprint 7, reemplaza por completo el benchmark de pares de Sprint 5).

### Notas
- Riesgo de regresión Medio (registro de auditoría): la lógica de "cuál dirección es mejor" está distribuida entre `buildCargoBenchmark` (mayor=mejor) y `buildCargoBenchmarkCarga` (cercano a 100=mejor) — un nuevo indicador que olvide esta distinción produciría un benchmark invertido.

---

## 11. Tiempo Objetivo — Desviación y Precisión

**Funciones:** `getOfficialTargetTime`, `computeDeviation`, `computePrecisionPct`, `precisionClassification` (`src/lib/targetTime.ts`); agregación mensual: `computeTargetTimePrecision` (`src/lib/analytics.ts`)

### Objetivo
Medir qué tan cerca estuvo la ejecución real (`Task.realHours`) del estándar operativo esperado (Tiempo Objetivo) — reemplaza la idea de "Horas estimadas" como predicción subjetiva del colaborador por un **estándar operativo** validable por un líder.

**Nota de Sprint 6:** "Tiempo Objetivo" reemplaza el nombre "Horas estimadas" — el campo `Task.estimatedHours` (objetivo inicial) y `Task.targetTimeValidated` (objetivo validado por un líder) coexisten con `Task.realHours` (ejecución), nunca modificado por este módulo. `getOfficialTargetTime()` es el accesor **validado-aware**: usa el validado si existe, si no cae al inicial — nunca usa horas reales como estándar.

### Fórmula
```
getOfficialTargetTime(task) = task.targetTimeValidated ?? task.estimatedHours
isTargetTimeValidated(task) = task.targetTimeValidated !== null

Desviación:
  hours = round(realHours - officialTarget, 2)
  pct   = officialTarget>0 ? round(hours/officialTarget × 100) : null

Precisión (0-100, 1 decimal):
  raw = 1 - |realHours - officialTarget| / officialTarget       (null si officialTarget<=0)
  precisionPct = round(max(0, raw) × 1000) / 10

Precisión promedio del mes (computeTargetTimePrecision):
  avgPrecisionPct = round( mean(precisionPct de tareas completadas del mes con realHours>0 y target>0), 1 )
  validatedPct    = round( count(tareas cuya referencia fue validada) / sampleSize × 100 )
```
Clasificación: `≥90 Excelente`, `≥75 Buena`, `≥60 Aceptable`, `≥40 Baja`, si no `Muy baja`.

### Variables
- `officialTarget`: ver `getOfficialTargetTime` arriba.
- `realHours`: horas reales de la tarea completada.
- Alcance de `computeTargetTimePrecision`: tareas `status==="COMPLETADA"`, `completedAt` en el mes en curso, `realHours>0`.

### Pesos
No aplica.

### Normalización
`computePrecisionPct` ya devuelve 0-100 directamente (fórmula propia, no pasa por NormalizationEngine) — clasificación por umbrales fijos (ver arriba), no configurables desde Ajustes.

### Ejemplo de cálculo
Tarea con `targetTimeValidated=10h` (gana sobre `estimatedHours=8h` por estar validado), `realHours=11.5h`:
```
officialTarget = 10 (validado)
Desviación: hours = 11.5-10 = 1.5h;  pct = round(1.5/10×100) = 15%
Precisión: raw = 1 - |11.5-10|/10 = 1 - 0.15 = 0.85 → precisionPct = round(0.85×1000)/10 = 85.0
```
`precisionClassification(85.0)` → `85 ≥ 75` → **"Buena"**.

**Agregado mensual** — 3 tareas completadas este mes con horas reales:
| Tarea | official | validado | real | precisionPct |
|---|---|---|---|---|
| A | 10 | sí | 11.5 | 85.0 |
| B | 8 (estimado, sin validar) | no | 8.2 | `1-0.2/8=0.975` → 97.5 |
| C | 5 | sí | 6 | `1-1/5=0.8` → 80.0 |

```
avgPrecisionPct = round((85.0+97.5+80.0)/3, 1) = round(87.5, 1) = 87.5
classification(87.5) → "Buena"
validatedPct = round(2/3 × 100) = 67%   (A y C fueron validadas, B no)
```

### Casos borde
- `officialTarget <= 0` → `computeDeviation.pct = null` y `computePrecisionPct = null` (evita división por cero) — la tarea se excluye del promedio mensual (`filter(x => x.official > 0)`).
- Sin tareas completadas con `realHours>0` este mes → `{ available: false, reason: "Sin tareas completadas con horas reales registradas este mes." }`.
- Todas las tareas completadas tienen `official <= 0` → `{ available: false, reason: "Ninguna tarea completada este mes tiene un Tiempo Objetivo mayor a cero." }`.

### Reglas de negocio
- Nunca se usan horas reales como estándar (§S6-E) — el Tiempo Objetivo siempre viene de `estimatedHours`/`targetTimeValidated`, jamás derivado de `realHours` histórico automáticamente.
- Solo `ADMINISTRADOR`, `JEFE_NACIONAL`, `COORDINADOR_NACIONAL` pueden validar el Tiempo Objetivo (`CAN_VALIDATE_TARGET_TIME_ROLES`), y **nunca** el propio responsable de la tarea, sin importar su rol (`canValidateTargetTime`, §S6-B punto 2).
- KPI **aditivo** (Sprint 6 §S6-F) — no reemplaza Performance Score ni Operational Risk, que quedan exactamente iguales.

### Versión
No tiene entrada en `FORMULA_VERSIONS` de `analytics.ts` (vive en `targetTime.ts`, funciones puras versionadas implícitamente por Sprint 6 §S6-B/S6-F/S6-H; no se le asignó un string de versión propio en el registro central).

### Notas
- `getOfficialTargetTime` es reutilizada por Capacity Forecast (§5) para el "comprometido futuro" — un cambio en esta función afecta ambos KPIs simultáneamente.

---

## 12. Alertas

**Dos motores independientes:** `computeAlerts` (`src/lib/analytics.ts`, panel avanzado/Nova) y `computeRiskAlerts` (`src/lib/riskAlerts.ts`, panel básico "Mis KPIs").

### Objetivo
Detectar automáticamente condiciones de riesgo/atención en la actividad de un colaborador y sugerir una acción concreta, sin intervención de un analista.

### Fórmula — `computeAlerts` (analytics.ts, 8 reglas, severidades `red/orange/yellow`)
| Regla | Condición | Severidad |
|---|---|---|
| `sobrecarga_proyectada` | `capacity.estado === "sobrecarga"` | red |
| `capacidad_critica` | `capacity.estado === "no-asignar"` | orange |
| `subutilizacion_prolongada` | días consecutivos en "Subutilización" ≥ `alertConsecutiveOverloadDays` | yellow |
| `tareas_vencidas` | `overdue.length >= threshold×2` / `>= threshold` | red / orange |
| `cumplimiento_bajo` | tendencia mensual empeoró | red(≥20pp) / orange(≥10pp) / yellow |
| `horas_extra_inusuales` | `currentWeekend > priorAvg×1.5 + 1` | yellow |
| `dias_consecutivos_sobrecarga` | días consecutivos en Carga elevada/Sobrecarga ≥ threshold | red(≥2×threshold) / orange |
| `caida_registros` | `lastWeekRate < priorAvgRate×0.5` (y `priorAvgRate>0.3`) | yellow |
| `crecimiento_seguimiento` | `currentSeg > priorAvg×1.5` (y `priorAvg>0`) | yellow |

`threshold = config.alertOverdueTaskThreshold`, `config.alertConsecutiveOverloadDays` — ambos configurables.

### Fórmula — `computeRiskAlerts` (riskAlerts.ts, 4 reglas, severidades `red/yellow` solamente)
| Regla | Condición | Severidad |
|---|---|---|
| Tareas vencidas | `overdue.length >= alertOverdueTaskThreshold` | yellow (`>= threshold`) / red (`>= 2×threshold`) |
| Carga fuera de rango | `cargaLabel ∈ {"Sobrecarga","Carga elevada"}` | red / yellow respectivamente |
| Actividades por vencer | tareas con `endDate` dentro de los próximos 3 días, no vencidas | yellow |
| Inactividad | `gap = countBusinessDays(díaDespuésDelÚltimoRegistro, hoy, holidays) >= 2` | red |

### Variables
- `capacity`, `cargaHistory`, `trends`, `monthly`, `weekly`: resultados ya calculados de §5, §4, tendencias, histórico.
- `cargaLabel`/`cargaPct` (solo `computeRiskAlerts`): pasados explícitamente por el caller — usa `WorkloadLabel`, **nunca** `WorkloadColor` ("red" es ambiguo entre Subutilización y Sobrecarga, comparten color en el semáforo de 5 zonas; esta alerta solo debe dispararse por carga excesiva).

### Pesos
`alertOverdueTaskThreshold = 3` (default), `alertConsecutiveOverloadDays = 3` (default) — `ANALYTICS_CONFIG_DEFAULTS`, compartidos por **ambos** motores desde la corrección D2 (antes `riskAlerts.ts` tenía el umbral de vencidas hardcodeado en `>0`).

### Normalización
No aplica (reglas discretas, no un score continuo).

### Ejemplo de cálculo
Colaborador con 4 tareas vencidas (1 de prioridad Alta, `threshold=3`), carga mensual en "Carga elevada" al 112%, 2 tareas por vencer en 3 días, último registro de actividad hace 3 días hábiles.

**`computeRiskAlerts`:**
- Vencidas: `4 >= 3` sí, `4 >= 6` no → severidad **yellow**: "4 tareas vencidas (umbral configurado: 3) — 1 crítica de prioridad alta"
- Carga: "Carga elevada" → severidad **yellow**: "La carga laboral del mes está en Carga elevada (112%), por encima del rango óptimo"
- Por vencer: 2 actividades → severidad **yellow**
- Inactividad: `gap=3 >= 2` → severidad **red**: "Sin registro de actividades en los últimos 3 días laborables"
- Total: 4 alertas.

**`computeAlerts`** (mismos datos, más reglas de tendencia/histórico que este ejemplo no activa): Vencidas `4 >= 3×2=6`? no → `4 >= 3` → severidad **orange** (no yellow — el motor avanzado no tiene un tercer nivel "yellow" para este umbral base, usa orange directamente).

### Casos borde
- `computeRiskAlerts`: sin `lastActivity` histórico alguna vez → no se evalúa la alerta de inactividad (un colaborador nuevo puede simplemente no tener registros aún, no está "en riesgo").
- `computeAlerts`: `priorWeekendAvg === null` (sin historial de meses anteriores) → la regla de horas extra inusuales no se evalúa.
- Array vacío en ambos motores = "sin alertas activas" — el componente que consume esto debe mostrar el estado "Sin alertas" cuando `length === 0`.

### Reglas de negocio
- **Por qué existen dos motores** (Registro de auditoría §D2): `computeRiskAlerts` es deliberadamente más simple e inmediato (panel básico "Mis KPIs") — cubre 2 señales sin equivalente en el motor avanzado (actividades por vencer en 3 días, inactividad de 2+ días hábiles). `computeAlerts` es el motor configurable/estratégico (8 reglas) que alimenta el panel avanzado de Analytics y Nova. Se documentó explícitamente en el código que ambos coexisten a propósito, con alcances distintos.
- **Corrección D2 aplicada**: la regla de "tareas vencidas" de `computeRiskAlerts` ahora comparte `alertOverdueTaskThreshold` con `computeAlerts` — antes estaba hardcodeada en `>0`, desalineada de lo que un Administrador configurara en Ajustes.
- **Corrección D9 aplicada**: la alerta de inactividad ahora usa `countBusinessDays` (holiday-aware) en vez de su propio conteo que no excluía feriados — podía sobreestimar el gap en semanas con feriado.

### Versión
Ninguna de las dos tiene entrada en `FORMULA_VERSIONS` (no son "fórmulas" en el sentido de score ponderado — son árboles de reglas discretas).

### Notas
- **Inconsistencia residual no documentada previamente en el registro de auditoría, encontrada al escribir este documento**: el vocabulario de severidad difiere entre ambos motores — `computeAlerts` usa 4 niveles (`red/orange/yellow/green`), `computeRiskAlerts` usa solo 2 (`red/yellow`). Para la misma condición de "tareas vencidas ≥ umbral, < 2×umbral", el motor avanzado marca **orange** y el motor básico marca **yellow** — no son estrictamente comparables aunque compartan el umbral numérico. No es necesariamente un bug (audiencias distintas: panel avanzado vs. básico), pero un desarrollador que intente "traducir" severidad de un motor a otro debe saber que no hay una tabla de equivalencia 1:1.
- `computeRiskAlerts` no persiste en `AnalyticsAuditLog` (a diferencia de `computeAlerts`, que sí registra `kind: "alerts"` para alimentar `getResolvedAlertsHistory`).

---

## 13. NormalizationEngine

**Funciones:** `normalize`, `interpolateCurve` (`src/lib/normalizationEngine.ts`); configuración: `getEffectiveCurve` (`src/lib/systemConfig.ts`)

### Objetivo
Servicio central único para convertir cualquier métrica cruda en un puntaje 0-100 mediante interpolación lineal por tramos entre puntos de control **configurables** — elimina saltos abruptos (p. ej. 89%→85pts, 90%→95pts) por construcción, ya que el resultado varía de forma continua y proporcional entre cada punto de control.

### Fórmula
```
interpolateCurve(x, points):
  sorted = points ordenados por x
  si x <= min(x de sorted) → y del primer punto
  si x >= max(x de sorted) → y del último punto
  si no, para el tramo [a,b] que contiene x:
    t = (x - a.x) / (b.x - a.x)
    y = a.y + t × (b.y - a.y)

normalize(curveName, rawValue, points?):
  curva = (points válidos, ≥2) ?? DEFAULT_CURVES[curveName]
  y = interpolateCurve(rawValue, curva)
  resultado = round( clamp(y, 0, 100), 1 )
```

### Variables
- `rawValue`: la métrica cruda de entrada (rango variable según la curva: 0-100 para cumplimiento/consistencia/trazabilidad, conteo ponderado para vencidas, % con o sin techo para carga/capacidad).
- `points`: puntos de control `{x, y}[]`, provistos por `getEffectiveCurve(curveName)` — configurables desde Ajustes, o `DEFAULT_CURVES[curveName]` si nunca se configuraron.

### Pesos
No aplica (no es una suma ponderada) — los "pesos" reales son los propios puntos de control de cada curva, editables vía `setCurveConfig` (Ajustes), historizados en `SystemConfigHistory` igual que el resto de configuración.

### Normalización — curvas por defecto (`DEFAULT_CURVES`)
| Curva | Puntos de control | Uso |
|---|---|---|
| `cumplimiento` | `[(0,0),(100,100)]` — identidad | Performance Score |
| `vencidas` | `[(0,100),(10,0)]` — lineal decreciente | Performance Score |
| `carga` | `(0,15) (50,35) (85,75) (100,100) (115,75) (130,40) (160,10)` — campana | usada por el simulador de escenarios sobre `cargaPct` |
| `capacidad` | `(-50,0) (0,20) (10,40) (20,70) (40,100) (100,100)` — rampa | simulador de escenarios sobre `disponiblePct` |
| `consistencia` | `[(0,0),(100,100)]` — identidad | Performance Score |
| `trazabilidad` | `[(0,0),(100,100)]` — identidad | Performance Score |

Calibradas explícitamente para **reproducir el resultado de las fórmulas legacy** en sus tramos lineales (p. ej. `vencidas` reproduce `100 - 10×normal - 20×alta`) — activar el motor de normalización no cambia ningún número ya validado.

### Ejemplo de cálculo
`normalize("carga", 92)` usando `DEFAULT_CURVES.carga`: el valor `x=92` cae entre los puntos de control `(85, 75)` y `(100, 100)`:
```
t = (92-85) / (100-85) = 7/15 = 0.4667
y = 75 + 0.4667 × (100-75) = 75 + 11.67 = 86.67
resultado = round(clamp(86.67, 0, 100), 1) = 86.7
```

### Casos borde
- `x` menor o igual al primer punto → devuelve el `y` del primer punto (clamping por debajo, no extrapola).
- `x` mayor o igual al último punto → devuelve el `y` del último punto (clamping por arriba).
- `x` no finito (`NaN`/`Infinity`) → devuelve el `y` del primer punto ordenado (protección explícita en `interpolateCurve`).
- `points.length === 0` → `interpolateCurve` devuelve `0` directamente.
- Curva configurada inválida (menos de 2 puntos, o algún `y` fuera de `[0,100]`, validado por `isValidCurve`) → `getEffectiveCurve` recae en `DEFAULT_CURVES[name]`.

### Reglas de negocio
- **Fuente única obligatoria**: "ningún componente ni ruta de API debe reimplementar su propia tabla de puntos de corte" (comentario de cabecera del archivo).
- Cada curva se guarda como JSON en `SystemConfigHistory` (mismo mecanismo que el resto de config del motor) — el historial de cambios (usuario/fecha/valor anterior) viene gratis vía `setConfigValue`.

### Versión
No versionada individualmente en `FORMULA_VERSIONS` — su introducción coincide con la subida de `performanceScore` a `"4.0"` (Sprint 5 §S5-D/S5-E), que es el único KPI documentado que la consume en el motor central hoy (el simulador de escenarios la usa aparte, para `carga`/`capacidad`).

### Notas
- Motor genérico reutilizable — actualmente usado por 6 curvas nombradas, pero el mecanismo (`interpolateCurve`) no está atado a ningún KPI específico.

---

## 14. Insights Engine / Decision Intelligence

**Función principal:** `computeInsights` (+ `computeIndicatorRelations`, `computePersonalBenchmark`, `computeRecommendationReevaluation`, `prioritizeRecommendations`/`prioritizeInsights`, `computeConfidence`) (`src/lib/insightsEngine.ts`, `INSIGHTS_ENGINE_VERSION = "1.0.0"`)

### Objetivo
Construir interpretación, correlación y priorización **encima** de los KPIs que ya calculó `analytics.ts` — traduce factores/indicadores ya calculados a hallazgos accionables (qué pasó, por qué, qué hacer) sin volver a tocar ninguna fórmula de negocio.

### Qué SÍ hace (composición, no cálculo)
- `computeInsights`: traduce 1:1 cada factor **activo** de `OperationalRiskResult.factors` (por encima de `FACTOR_INSIGHT_THRESHOLD_PTS = 2` puntos) a un Insight de 4 bloques (`hallazgo` = `detail` del motor, `explicacion` = texto fijo por tipo de factor, `evidencia`, `accion` sugerida con impacto = los mismos puntos que ese factor ya aporta al riesgo — **cero números inventados**).
- `computeIndicatorRelations`: correlaciona indicadores ya calculados (histórico mensual, consistencia, riesgo, capacidad) — pura, recibe todo ya calculado.
- `computePersonalBenchmark`/`computeRecommendationReevaluation`: leen `AnalyticsAuditLog` (mismo mecanismo que `getScoredAuditHistory`), no vuelven a calcular el score.
- `prioritizeRecommendations`/`prioritizeInsights`: ordenan listas ya construidas (puras, sin BD).
- `computeConfidence`: compuesto de 3 señales ya calculadas (observaciones, calidad de datos, consistencia) → estrellas 1-5.

```
computeConfidence:
  dataScore        = clamp(observations/maxObservations, 0, 1)
  qualityScore     = clamp(dataQualityPct/100, 0, 1)
  consistencyScore = consistent===null ? 0.5 : (consistent ? 1 : 0.3)
  composite = dataScore×0.4 + qualityScore×0.35 + consistencyScore×0.25
  stars = composite>=0.85→5, >=0.65→4, >=0.45→3, >=0.25→2, si no→1
```

### Ejemplo de cálculo
`computeConfidence({ observations: 5, maxObservations: 6, dataQualityPct: 90, consistent: true })`:
```
dataScore = min(1, 5/6) = 0.833
qualityScore = 0.90
consistencyScore = 1 (consistent=true)
composite = 0.833×0.4 + 0.90×0.35 + 1×0.25 = 0.3333 + 0.315 + 0.25 = 0.8983
stars: 0.8983 >= 0.85 → 5 ("Muy alta")
```

### Qué NO hace (garantías explícitas del código)
- **Nunca recalcula un KPI de negocio** — no reimplementa Performance Score, Operational Risk, Carga, Capacidad, Consistencia ni Cumplimiento; siempre recibe esos valores ya calculados como parámetro.
- **Nunca usa IA/ML para calcular** — es 100% determinista (reglas + comparación con historial propio vía `AnalyticsAuditLog`).
- **No depende de Groq en absoluto** — Groq (`nova-insights`), si se usa en alguna vista, solo redacta texto en lenguaje natural sobre JSON que este módulo (o el motor central) ya calculó; nunca al revés.

### Reglas de negocio
- `FACTOR_EXPLANATION`/`FACTOR_ACTION` son diccionarios estáticos por nombre de factor de riesgo — si `computeOperationalRisk` agrega un factor nuevo sin entrada correspondiente aquí, ese factor no generará un Insight explicado (fallback silencioso, no un error).
- `impactNote = "Impacto no estimable con los datos actuales."` cuando `impact` es `null` — nunca se muestra un impacto inventado.

### Versión
`INSIGHTS_ENGINE_VERSION = "1.0.0"` — versión de módulo, no de fórmula individual (no tiene entradas en `FORMULA_VERSIONS` de `analytics.ts`, al no ser una fórmula de negocio nueva sino una capa de composición).

### Notas
- Capa de explicabilidad relacionada (`src/lib/analyticsExplain.ts`, Sprint 6.5) sigue el mismo principio: funciones puras de presentación (`scoreLevel`, `reliabilityPctFromStars`, `cumplimientoColor`, `maturityFromCount`/`maturityFromWeeks`) que traducen valores ya calculados a niveles/etiquetas ejecutivas — nunca recalculan. Documentado como consolidación D10 en el registro de auditoría (antes disperso en 3-4 componentes de UI).
- Las 3 heurísticas de "confianza según historial" que coexisten en el sistema (`consistencyReliabilityFromWeeks` en `analytics.ts`, `computeConfidence` aquí, `maturityFromCount`/`maturityFromWeeks` en `analyticsExplain.ts`) son **conceptualmente distintas** (Confiabilidad de Consistencia vs. Confianza compuesta de Insights vs. madurez visual de una tarjeta) y se documentaron a propósito **sin fusionar** — forzarlas a una sola fórmula cambiaría el resultado de al menos 2 de las 3 (Registro de auditoría, D10).

### Ampliación — Sprint A: Analytics Explicativo (2026-07-23)

**No es una fórmula nueva ni un cambio de versión** (`INSIGHTS_ENGINE_VERSION` se mantiene en `"1.0.0"`, `ANALYTICS_ENGINE_VERSION`/`FORMULA_SET_VERSION` sin cambios) — es una ampliación de la capa de composición que ya describe esta sección, aplicando el mismo patrón que ya existía para Riesgo Operativo a un segundo indicador:

- `computePerformanceInsights` (`insightsEngine.ts`) traduce `PerformanceScoreResult.factors[]` a `Insight[]`, pero **en ambas direcciones** (a diferencia de los factores de Riesgo Operativo, siempre negativos por diseño): `normalizedValue` en "Alto"/"Muy alto" (`scoreLevel`, umbrales ya existentes) → fortaleza (`tone: "positive"`); "Bajo" → oportunidad de mejora con acción e impacto (`weight - points`, el máximo puntaje que ese factor podría aportar — nunca inventado). "Medio" no genera insight, mismo criterio anti-ruido que `FACTOR_INSIGHT_THRESHOLD_PTS`.
- `explainScoreTrend`/`getScoreTrendExplanation` (`insightsEngine.ts`) comparan `factors[]` actuales contra un snapshot histórico de `AnalyticsAuditLog` (leído vía la capa nueva `src/lib/analyticsAuditHistory.ts`, de solo lectura, fuera del motor) y narran qué factor cambió más — nunca recalculan un score.
- El simulador de escenarios (§ya documentado arriba en esta sección para `carga`/`capacidad`) se amplía con 4 escenarios sobre factores de Performance Score (`complete_task`, `reduce_overdue`, `increase_consistency`) y uno sobre Carga Laboral (`register_hours`) — cada uno recalcula un único factor con `normalize()`/`weightedPoints()` reales y lo recombina con los demás, sin tocar `computePerformanceScore`.
- Ningún archivo del motor central (`analytics.ts`, `capacityForecast.ts`, `workload.ts`, `targetTime.ts`, `normalizationEngine.ts`) fue modificado para esta ampliación.

## 15. Base Horaria Efectiva (Sprint Analytics 2.1 — capa de Reporte, no del Analytics Engine)

### Objetivo
Comparar a cada colaborador, en el Informe Ejecutivo, contra la base
laboral del tramo en que **realmente tuvo disponibilidad** para registrar
actividades en NEXO — no contra el período completo. Sin esto, un
colaborador incorporado a mitad de un mes/rango salía con un % de
utilización artificialmente bajo frente a compañeros que estuvieron activos
todo el período.

**No es una fórmula del Analytics Engine** — vive enteramente en la capa de
reporte (`src/lib/reportInsights.ts` § `computeEffectiveMemberBases`,
`src/lib/workload.ts` § `businessBaseForRange`). No afecta ningún KPI
individual (Cumplimiento, Carga, Equilibrio Operativo, Performance Score,
Riesgo Operativo, Consistencia) ni ninguna vista distinta del Informe
Ejecutivo — `ANALYTICS_ENGINE_VERSION`/`FORMULA_SET_VERSION` no cambian.

### Fórmula
```
efectivoInicio(colaborador) = computeEffectiveHistoryStart(userId, finDelPeríodo)
inicioRecortado             = MAX(inicioDelPeríodo, efectivoInicio)
fueProrrateado               = inicioRecortado > inicioDelPeríodo

baseHoras(colaborador) = Σ (horasEfectivasDelDía) para cada día hábil en [inicioRecortado, finDelPeríodo]
```
`computeEffectiveHistoryStart` es la MISMA función que usa Consistencia
desde el Analytics Engine v1.3.1 (§8 de este documento) — cruza
`kpiStartDate`, primera actividad registrada, primera tarea completada,
primera imputación de horas y `User.createdAt`, quedándose con la señal
**más reciente**.

### Variables
- `inicioDelPeríodo`/`finDelPeríodo`: límites del informe (mes calendario,
  rango de meses, o rango de fechas arbitrario — ver `/api/reports/{generate,range,custom-range}`).
- `efectivoInicio`: ver §8 de este documento (Consistencia) para el detalle
  completo de las 5 señales cruzadas.

### Normalización
No aplica (no es un score 0-100) — es un recorte de fechas que alimenta el
mismo cálculo de base horaria (`sumWeightedBaseHours`/`sumWeightedLimit`,
`workload.ts`) que ya usa toda la app, ponderado por estado especial
(maternidad/lactancia) si corresponde.

### Ejemplo de cálculo
Período: julio 2026 (01/07 – 31/07). Colaboradora con `createdAt` =
10/07/2026 y sin actividad previa: `efectivoInicio` = 10/07/2026 →
`inicioRecortado` = 10/07/2026 (posterior al inicio del mes) →
`fueProrrateado` = true → base = solo los días hábiles del 10/07 al 31/07
(≈91h en vez de los ≈149h del mes completo).

### Casos borde
- Colaborador cuyo `efectivoInicio` cae DESPUÉS del fin del período
  (incorporado tras el cierre del informe): base = 0h, `fueProrrateado` =
  true.
- Informes de rango multi-mes (trimestre/semestre/año/rango personalizado):
  la tarifa (horas/día, límites) usada para todo el rango prorrateado es la
  vigente al INICIO del rango completo, no mes a mes — simplificación
  deliberada, ver `docs/AUDIT_LOG.md` § Sprint Analytics 2.1 y
  `docs/DECISIONS.md`.
- Estado especial (maternidad/lactancia) vigente dentro del tramo
  prorrateado: se pondera igual que en cualquier otro cálculo de base
  horaria (`sumWeightedBaseHours`/`sumWeightedLimit` con el `specialMap` del
  colaborador).

### Reglas de negocio
- La UI marca cada fila con base recortada (`*` + nota informativa,
  Bloque 2 del sprint) — nunca se muestra un % de utilización recortado sin
  explicar por qué.
- Se aplica en la tabla "Detalle por Colaborador" y en todas las
  exportaciones (PDF, Excel, Generador Inteligente de Reportes) — nunca en
  KPIs individuales (`/kpis/me`, `/kpis/[userId]`, Analytics personal), que
  siguen usando `computeCargaTiempo`/`kpiStartDate` como siempre.

### Versión
No versionada en `FORMULA_VERSIONS` (no es una fórmula del Analytics
Engine) — cambios a esta lógica se documentan en `docs/CHANGELOG.md` bajo
el sprint correspondiente.

### Notas
Ver también §8 (Consistencia) para el detalle completo de
`computeEffectiveHistoryStart`, la función que ambos cálculos comparten sin
duplicar.

---

## 16. Trend Engine (Sprint E)

**Función principal:** `computeTrendEngine` (`src/lib/trendEngine.ts`, `TREND_ENGINE_VERSION = "1.0.0"`)

### Objetivo
Detectar automáticamente la evolución (positiva/negativa/estable/variable/cambio brusco) de 8 indicadores, sin IA — capa de solo lectura sobre historial YA CALCULADO por `analytics.ts`/`analyticsAuditHistory.ts`, no un motor de KPIs nuevo. **No modifica ningún KPI existente ni sus fórmulas.**

### Qué SÍ hace (composición sobre historial existente, no cálculo nuevo)
| Indicador | Fuente de datos | ¿Nueva consulta? |
|---|---|---|
| Cumplimiento, Horas registradas | `computeWeeklyHistory(userId, windowWeeks, now)` | No — reuso directo |
| Productividad | `getScoreSeries(userId, "performance_score", now, windowDays)` | No — reuso directo |
| Equilibrio Operativo | `getScoreSeries(userId, "health_score", now, windowDays)` | No — reuso directo |
| Consistencia Operativa | `computeConsistency(userId, now)` en dos cortes: `now` y `now - windowDays` (ventana actual vs. anterior) | No — misma función, 2 llamadas |
| Capacidad Disponible | `getFactorAuditHistory(userId, "health_score", now, windowDays)`, filtrado al factor `"Capacidad futura"`, parseando su `rawLabel` (`"42%"` → `42`) | No — lectura de auditoría existente |
| Proyectos | `SUM(ProjectActivity.duration)` por semana, autor = usuario | Sí — agregación semanal nueva, sin fórmula de negocio |
| Actividades | `COUNT(TaskActivity)` por semana, autor = usuario | Sí — agregación semanal nueva, sin fórmula de negocio |

**"Consultas" (consultas a Nova) queda fuera de alcance** — no existe ninguna tabla que registre preguntas hechas al asistente (Nova es stateless por diseño). Ver `docs/AUDIT_LOG.md` § Sprint E y `docs/ROADMAP.md`.

### Fórmula — clasificador de dirección
```
slope(valores)  = pendiente OLS sobre índice de semana (x) vs. valor (y)   // regresión lineal simple
residuo_i       = valor_i - (media(y) + slope × (x_i - media(x)))         // desviación respecto a la recta
CV_residuos     = (desviación_estándar(residuos) / |media(y)|) × 100      // variabilidad NETA de tendencia

cambio_brusco   = |residuo_último - media(residuos_anteriores)| > 2 × desviación_estándar(residuos_anteriores)   (requiere ≥4 puntos)
variable        = CV_residuos >= 35   (si no es cambio_brusco)
positiva/negativa = |slope / media(y) × 100| >= 3%/semana   (si no es variable ni cambio_brusco)
estable         = ningún otro caso
```
**Por qué CV de residuos y no CV crudo:** una serie que sube en línea perfectamente recta tiene alta dispersión cruda alrededor de su media plana (eso es justamente la tendencia) pero residuo ≈ 0 en cada punto — usar CV crudo clasificaría cualquier tendencia fuerte y limpia como "variable", confundiendo "hay una tendencia clara" con "esto es ruidoso". El CV de residuos mide el ruido *después* de remover la tendencia, que es lo que "variable" debe significar.

**Independiente de la regresión de `computePrediction`** (`analytics.ts`, protegida esta sesión) — duplicación pequeña y deliberada de matemática genérica (OLS/CV), no de ninguna fórmula de KPI. Ver `docs/AUDIT_LOG.md` § Sprint E.

### Variables
- `windowWeeks`: ventana histórica configurada por el Administrador (§Bloque 2, `src/lib/predictiveConfig.ts`, default 3 semanas) — o un override puntual para Tendencias Históricas (§17 abajo, Bloque 9), independiente de la configuración global.
- `available`: `false` cuando hay menos de 2 puntos utilizables (o, para Proyectos/Actividades, siempre `true` — cero es un valor válido, no "sin dato").

### Ejemplo de cálculo
Cumplimiento con `windowWeeks=3`, valores semanales `[88, 82, 75]`: `slope ≈ -6.5`, media ≈ 81.7, `slope/media×100 ≈ -8%` (≥3% en magnitud) → `direction = "negativa"`.

### Casos borde
- Menos de 4 puntos → nunca se clasifica `cambio_brusco` (residuos previos insuficientes para una desviación estándar confiable).
- Capacidad Disponible con 0-1 puntos de auditoría en la ventana (usuario poco activo, granularidad oportunista — un punto por corrida no-cacheada del motor) → `available: false`, nunca se sintetiza un valor.
- `mean(y) === 0` → CV y pendiente relativa se reportan como 0 (evita división por cero).

### Reglas de negocio
- Nunca escribe en `AnalyticsAuditLog` con un `kind` que pueda confundirse con los 6 del motor oficial (`health_score`/`performance_score`/`operational_risk`/`alerts`/`validation_failure`/`smart_benchmark`).
- No modifica `previousBusinessDays`, `computeWeeklyHistory`, `computeConsistency`, `getScoreSeries` ni ninguna otra función del motor central — solo las invoca.

### Versión
`TREND_ENGINE_VERSION = "1.0.0"` — módulo nuevo, no versionado dentro de `FORMULA_VERSIONS` (no es una fórmula de KPI, es una capa de detección de tendencia).

### Notas
- **Rechazado explícitamente:** "retroceder `now`" y volver a llamar `computeCapacityForecast(userId, now)` para reconstruir un histórico de Capacidad Disponible — `Task.status` no tiene tabla de historial propia, así que esa técnica mezclaría matemática de negocio del pasado con asignaciones de tareas de HOY. Detectado y corregido antes de implementar (ver `docs/AUDIT_LOG.md` § Sprint E) — por eso Capacidad Disponible usa el factor de auditoría de Equilibrio Operativo en vez de recalcular.
- Ver §17/§18 para cómo Prediction Engine y Estabilidad Operativa consumen la salida de este motor.

---

## 17. Predicciones Preventivas (Sprint E)

**Funciones:** `computeCumplimientoProjection`, `computeSobrecargaProbability`, `computeSubutilizacionPredictions`, `computeTaskDelayPrediction`, `computeProjectDelayPrediction` (`src/lib/predictionEngine.ts`, `PREDICTION_ENGINE_VERSION = "1.0.0"`)

### Objetivo
4 predicciones explicables (qué ocurrirá, cuándo, por qué, qué hacer), cada una con nivel de confianza, confiabilidad del histórico (eje distinto) y horizonte temporal fijo — reglas determinísticas sobre salidas ya calculadas de `analytics.ts`/`capacityForecast.ts`/`trendEngine.ts`. Sin IA.

### Fórmula — horizonte y confianza (compartidos por las 4 predicciones)
```
horizonte = el más cercano de {7, 15, 30, 90} días a los días restantes reales   (§Bloque 11 — nunca fuera de este set)

confidencePct = round(92 × (0.4×dataScore + 0.4×consistencyScore + 0.2×horizonScore))
  dataScore        = min(1, semanasConDatos / ventanaConfigurada)
  consistencyScore = muy-consistente→1, consistente→0.8, variable→0.5, muy-variable→0.25, sin-historial→0.5
  horizonScore      = 1 - (horizonte / 90) × 0.4

confiabilidadHistórico = composite(0.6×min(1,semanas/6) + 0.4×(dataQualityPct/100))
  >= 0.75 → "alta"   |   >= 0.45 → "media"   |   si no → "baja"
```
**Misma filosofía de pesos que `computePredictionConfidencePct`** (`analytics.ts`, protegida) pero parametrizada contra el set fijo `{7,15,30,90}` en vez de la constante `PREDICTION_MAX_DAYS=30` — reusar la función protegida tal cual habría tratado todo horizonte >30 días de forma idéntica, perdiendo la distinción entre 30 y 90 días. `confidencePct` y `confiabilidadHistórico` son ejes deliberadamente distintos (§Bloque 13): el primero mide certeza de ESTA predicción puntual, el segundo mide volumen+calidad del histórico disponible — nunca se combinan en un solo número.

### Fórmula por predicción

**Cumplimiento** (Bloque 3): pace/ritmo, independiente de la privada `computeMonthlyCompliancePace` (ventana fija, no reutilizable para una ventana configurable sin tocar un archivo protegido):
```
cumplimientoEsperadoCierre = min(100, round(completadoHastaHoy% × (díasHábilesDelMes / díasHábilesTranscurridos)))
variaciónEsperada          = cumplimientoEsperadoCierre - promedio(cumplimiento, últimas N semanas configuradas)
```

**Sobrecarga** (Bloque 4): probabilidad base por estado de capacidad, ajustada por tendencia y consistencia:
```
base = sobrecarga→90, no-asignar→65, limitada→35, sin-planificación→20, alta→10
+10 si Trend Engine.capacidad_disponible.direction === "negativa"  (-10 si "positiva")
+5  si consistencia === "muy-variable"
nivel = probabilidad>=70→Alto, >=40→Medio, si no→Bajo
```

**Subutilización** (Bloque 5, vista de equipo — SIEMPRE batch vía `computeTeamCapacityForecast`, nunca en loop la función singular):
```
nivel = disponiblePct>=70→Alto, >=40→Medio, si no→Bajo
```

**Retrasos** (Bloque 6, tareas y proyectos) — exactamente los 3 factores del ejemplo del pedido ("Sobrecarga, Baja consistencia, Retrasos recientes"):
```
+40 (o +15 si "limitada") si estado de capacidad del responsable es sobrecarga/no-asignar
+30 (o +15 si "variable") si consistencia del responsable es muy-variable
+min(30, tareasVencidas×10) si el responsable tiene tareas vencidas actuales
[proyectos, además] +20 "Retrasos recientes" si el ritmo de ejecución va detrás del tiempo transcurrido (elapsedPct - executedPct >= 15)
probabilidad = min(95, suma)
```
A nivel de proyecto, capacidad/consistencia se agregan sobre TODOS los participantes (peor caso de capacidad, presencia de variabilidad en cualquiera) — batcheado una vez por proyecto, no por participante.

### Variables
- `historicalWindowWeeks`: igual a Trend Engine (§16) — misma configuración global.
- `motivos`: solo se listan los factores que efectivamente dispararon puntaje (nunca un motivo "por defecto").

### Ejemplo de cálculo
Sobrecarga: estado `"sobrecarga"` (base 90) + tendencia de capacidad `"negativa"` (+10, tope 100) + consistencia `"consistente"` (sin ajuste) → `probabilidadPct = 100`, `nivel = "Alto"`.

### Casos borde
- Tarea ya `COMPLETADA` o proyecto `COMPLETADO`/`CANCELADO` → `{available: false, reason}`, nunca una predicción sin sentido sobre algo cerrado.
- Cero participantes en un proyecto → capacidad/consistencia quedan en sus valores neutros (`sin-planificacion`/`null`), solo el factor de ritmo puede disparar.

### Reglas de negocio
- Nunca reimplementa `computeCapacityForecast`, `computeConsistency`, `computeOperationalRisk` — siempre los invoca de solo lectura.
- El simulador de escenarios nuevo (§Bloque 8, `src/app/api/predictive/simulate/**`) reutiliza las MISMAS funciones puras que `/api/analytics/simulate/[userId]` ya exporta (`computeWorkloadRange`, `classifyCapacity`, `normalize`, `weightedPoints`, `capacityToScore`, `cargaHealthScore`) — ruta nueva y separada (no se modifica la ruta protegida existente) porque 2 de los 3 escenarios nuevos (redistribuir carga, agregar participantes) son bi-usuario/proyecto y no encajan en el contrato de un solo usuario de esa ruta. Nunca persiste nada.

### Versión
`PREDICTION_ENGINE_VERSION = "1.0.0"`.

### Notas
Ver `docs/AUDIT_LOG.md` § Sprint E para la decisión completa de "modificar tiempo objetivo" como escenario de tarea (no de proyecto) y las demás decisiones de alcance de este sprint.

---

## 18. Estabilidad Operativa (Sprint E)

**Función:** `computeOperationalStability` (`src/lib/predictionEngine.ts`)

### Objetivo
Indicador nuevo (Bloque 10), **exclusivamente predictivo — no modifica ningún KPI existente**: clasifica qué tan estables han sido, en conjunto, los 8 indicadores del Trend Engine (§16) en la ventana configurada.

### Fórmula
```
CV_promedio = promedio(coefficientOfVariation) sobre los indicadores con available=true del Trend Engine
clasificación = CV_promedio<10→"Muy Alta", <20→"Alta", <35→"Media", <50→"Baja", si no→"Muy Baja"
basedOn = indicadores con CV_residuos >= 20, ordenados de mayor a menor variabilidad
```
Los umbrales reutilizan los mismos cortes que `consistencyLevelFromCv` (`analytics.ts`) como referencia conceptual (no como código compartido — evaluar 5 tramos en vez de 4 no encaja en esa función sin modificarla).

### Variables
Ninguna propia — deriva 100% de `IndicatorTrend.coefficientOfVariation` (§16), que ya calcula CV de residuos (no crudo).

### Ejemplo de cálculo
8 indicadores, 6 disponibles con CV `[5, 8, 12, 15, 9, 40]` → promedio ≈ 14.8 → `"Alta"`; `basedOn = ["<indicador con CV 40>"]` (único ≥20).

### Casos borde
- Ningún indicador disponible (usuario sin historial en absoluto) → `"Baja"` por defecto, `basedOn: []` — nunca revienta ni devuelve `NaN`.

### Reglas de negocio
- No escribe en `AnalyticsAuditLog`, no altera `computeConsistency` ni ningún score existente — es una lectura derivada, desechable, recalculada en cada petición (con caché estándar del motor).

### Versión
No versionada en `FORMULA_VERSIONS` — parte de `PREDICTION_ENGINE_VERSION = "1.0.0"`.

### Notas
Distinto de "Consistencia Operativa" (uno de los 8 indicadores del Trend Engine, §16, que compara solo dos ventanas de tiempo entre sí vía `computeConsistency`) — Estabilidad Operativa es un agregado de variabilidad **across** los 8 indicadores, no la consistencia de uno solo.

---

_Generado a partir de src/lib/analytics.ts (ANALYTICS_ENGINE_VERSION 1.5.0 / FORMULA_SET_VERSION 4.4) el 2026-07-22. Ampliado el 2026-07-23 (Sprint A). Ampliado el 2026-07-24 (Sprint Analytics 2.0 — Equilibrio Operativo, curva progresiva de Capacidad Futura, corrige la desincronización de versión 4.2 vs. 4.3 vigente en código). Ampliado el 2026-07-24 (Sprint Analytics 2.1 — Base Horaria Efectiva, capa de Reporte, sin cambios al Analytics Engine). Ampliado el 2026-07-26 (Sprint E — Trend Engine, Predicciones Preventivas, Estabilidad Operativa; nuevos motores en trendEngine.ts/predictionEngine.ts, cero cambios al Analytics Engine central)._
