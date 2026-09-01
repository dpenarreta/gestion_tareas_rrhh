import "server-only";
import { PREDICTION_MAX_DAYS } from "@/lib/systemConfig";
import type { CurveName } from "@/lib/normalizationEngine";

/**
 * Motor centralizado de Analytics — históricamente TODA métrica, tendencia,
 * alerta y predicción se calculaba acá de forma determinística (TypeScript +
 * consultas a PostgreSQL vía Prisma). Ese motor ya está portado a Django
 * (`apps.analytics.*`, Fases 4a-4m de la migración de stack) y
 * `GET /api/analytics/[userId]` sirve ese bundle en vivo desde hace muchas
 * fases — Gemini/IA NUNCA calculó nada ahí tampoco, solo traduce resultados ya
 * calculados a lenguaje natural.
 *
 * Fase 84 (ver docs/AUDIT_LOG.md § 2026-08-27): se retiraron las funciones de
 * cálculo que ya no tenían ningún consumidor real (`computeHealthScore`,
 * `computePerformanceScore`, `computeOperationalRisk`, `computeAlerts`,
 * `runAnalyticsPipeline`, `computeSmartBenchmark`, etc. — código muerto desde
 * que sus rutas se cortaron a Django). Los TIPOS se conservan intactos donde
 * `src/components/kpis/types.ts` los re-exporta como contrato de forma de la
 * respuesta que hoy llega de Django.
 *
 * Fase 85 (ver docs/AUDIT_LOG.md § 2026-08-27): se retiraron además
 * `computeWeeklyHistory`/`computeConsistency`/`computeEffectiveHistoryStart`
 * — su único consumidor real, el bloque "Predictivo" de Reportes Ejecutivos
 * (`predictionEngine.ts`, mes en curso), se cortó a Django (réplica exacta
 * ya viva desde la Fase 48, `djangoPredictionAdapter.ts`). Los tipos
 * `ConsistencyResult`/`ConsistencyLevel`/`ConsistencyReliability`/
 * `ExcludedPeriod` se conservan (contrato de forma de `/analytics/<id>/`,
 * consumidos por `AdvancedAnalytics.tsx`/`EquilibrioOperativoCard.tsx`).
 *
 * Fase 88 (ver docs/AUDIT_LOG.md § 2026-08-28): se retiró
 * `computeDataQuality` (última función con implementación real sobre
 * Prisma en este archivo) — réplica exacta ya vivía en Django
 * (`apps/analytics/scoring.py::compute_data_quality`) desde antes de esta
 * fase; su único consumidor TS (`/api/analytics/diagnostics`) se
 * reconectó directo. Este archivo queda sin ninguna dependencia de
 * Prisma. Los tipos `DataQualityResult`/`DataQualityIssue` se conservan
 * (contrato de forma de `dataQuality` en el bundle de Reportes
 * Ejecutivos y en `AdvancedAnalytics.tsx`).
 */
export const ANALYTICS_ENGINE_VERSION = "1.5.0";

/**
 * Versión "de fórmulas" del Sprint 5 (§S5-L) — un tag global mostrado junto a
 * ANALYTICS_ENGINE_VERSION en "Ver cálculo"/Diagnóstico del Motor. Es
 * DISTINTO de FORMULA_VERSIONS (que versiona cada fórmula por separado,
 * §Sprint 4 S4-D) — este es el número de "conjunto de fórmulas" que el
 * Administrador reconoce como paquete (ANALYTICS_ENGINE_VERSION=motor,
 * FORMULA_SET_VERSION=paquete de fórmulas vigente dentro de ese motor).
 */
export const FORMULA_SET_VERSION = "4.4";

export { PREDICTION_MAX_DAYS };

// ── Versionado de fórmulas (§Sprint 4 S4-D, extendido en Sprint 5 S5-L) ──────
// Cada fórmula del negocio tiene su propia versión, independiente de
// ANALYTICS_ENGINE_VERSION (que versiona el motor como un todo). Se sube solo
// cuando la FÓRMULA cambia de resultado, no en cada refactor. Se registra en
// AnalyticsAuditLog (campo `formulaVersions` de `result`) y se expone
// exclusivamente al Administrador en el panel de Diagnóstico del Motor.
export const FORMULA_VERSIONS = {
  cargaLaboral: "1.0",
  // Equilibrio Operativo (antes "Score de Salud Laboral" — Sprint Analytics
  // 2.0 lo revive y renombra; ver docs/DECISIONS.md). v1.1: normalización
  // progresiva de Capacidad Futura (§Sprint Analytics 2.0 Bloque 9) cambia el
  // resultado para usuarios con capacidad negativa.
  equilibrioOperativo: "1.1",
  scoreSimple: "1.0",
  // v1.1: normalización progresiva del rango negativo (antes un salto
  // abrupto a 0) — ver Sprint Analytics 2.0 Bloque 9.
  capacidadDisponible: "1.1",
  // Riesgo Operativo — Sprint 5 § S5-C prohíbe modificar reglas/pesos/alertas.
  riesgoOperativo: "1.0",
  // Sprint 1 cambió el resultado de estas tres — versión real, no cosmética.
  cumplimiento: "2.0",
  // v2.1 (Analytics Engine v1.3.1): excluye semanas anteriores al inicio
  // efectivo del historial, sin registro o anuladas por permiso/vacaciones
  // completas — antes se contaban como semanas con realHours=0, inflando el CV.
  consistencia: "2.1",
  prediccion: "2.0",
  // Nuevas en Sprint 5 (§S5-B, S5-G) — motor de normalización continuo.
  performanceScore: "4.0",
  trazabilidad: "4.0",
  // Sprint 7 — motor de decisión de 3 niveles (cargo/cargo-limitado/personal).
  benchmarkInteligente: "1.0",
  // "Completado a tiempo" (Definición B, isCompletedOnTime,
  // src/lib/priorityCompliance.ts) — primera vez que se versiona; v1.0 es ya
  // la forma corregida (comparación por día calendario en huso de negocio,
  // 2026-07-24), no la comparación cruda por instante que tenía antes.
  completadoATiempo: "1.0",
} as const;
export type FormulaName = keyof typeof FORMULA_VERSIONS;

// ── Priorización de cálculos (§Sprint 4 S4-G) ────────────────────────────────
// Documenta qué KPIs son críticos vs. informativos. Se expone en Diagnóstico
// del Motor.
export const KPI_PRIORITY = {
  cargaLaboral: "alta",
  cumplimiento: "alta",
  capacidadDisponible: "alta",
  riesgoOperativo: "alta",
  equilibrioOperativo: "media",
  performanceScore: "media",
  consistencia: "media",
  trazabilidad: "media",
  tendencias: "media",
  prediccion: "media",
  insightsNova: "baja",
  sparklines: "baja",
  historial: "baja",
  recomendacionesNarrativas: "baja",
} as const;
export type KpiPriority = (typeof KPI_PRIORITY)[keyof typeof KPI_PRIORITY];

// ── Fórmulas compartidas heredadas (§Sprint 4 S4-B) ──────────────────────────
// "Score simple" (0-100, ponderado 40/20/20/20) y el ratio estimado-vs-real de
// carga por tareas — existían duplicados byte-por-byte en 7 y 5 API routes
// respectivamente (kpis/[userId], kpis/me, kpis/me/range, kpis/team,
// kpis/executive, reports/generate, reports/range, dashboard). Es un cálculo
// DISTINTO del "Equilibrio Operativo" del motor — se muestra en
// rankings/reportes, no en el panel de Analytics avanzado; no se fusionan
// porque cambiaría números ya validados en esas pantallas. Única fuente ahora.
export function computeSimpleScore(completedPct: number, cargaRatio: number, avgProgress: number, totalComments = 0): number {
  const scoreC = (completedPct / 100) * 40;
  const scoreL = Math.max(0, 20 - Math.max(0, cargaRatio - 100) * 0.5);
  const scoreA = (avgProgress / 100) * 20;
  const scoreAct = Math.min(1, totalComments / 10) * 20;
  return Math.round(scoreC + scoreL + scoreA + scoreAct);
}

/** % de horas reales sobre estimadas para un conjunto de tareas; 200% centinela cuando hay horas reales pero cero estimadas (evita 0/0). */
export function computeEstimatedVsRealRatio(totalReal: number, totalEstimated: number): number {
  if (totalEstimated > 0) return Math.round((totalReal / totalEstimated) * 100);
  return totalReal > 0 ? 200 : 0;
}

/**
 * Definición A de "cumplimiento" (§Analytics Calculation Registry D1): % de
 * tareas con `status === "COMPLETADA"` en el período, sin importar si se
 * cerraron a tiempo. Coexiste con `isCompletedOnTime` (Definición B, "a
 * tiempo", `priorityCompliance.ts`) — son fórmulas DISTINTAS, no una
 * duplicada de la otra.
 *
 * `emptyValue` es el resultado cuando `tasks` está vacío — dos usos
 * legítimamente distintos: `0` para pantallas de reporte/ranking/histórico
 * (sin tareas = sin dato que mostrar) y `100` para el Equilibrio
 * Operativo/Performance (sin tareas asignadas ese mes no debe penalizar el
 * score).
 */
export function computeCompletedPctAny(tasks: { status: string }[], emptyValue: 0 | 100 = 0): number {
  if (tasks.length === 0) return emptyValue;
  const completed = tasks.filter((t) => t.status === "COMPLETADA").length;
  return Math.round((completed / tasks.length) * 100);
}

/**
 * Puntos ponderados = rawScore(0-100) × weight% / 100, redondeado a 2
 * decimales — convierte un sub-score/porcentaje ya calculado (crudo o
 * normalizado) en su aporte de puntos dentro de una suma ponderada. Usada por
 * el simulador de escenarios (`/api/analytics/simulate`).
 */
export function weightedPoints(rawScore: number, weightPct: number): number {
  return Math.round(((rawScore * weightPct) / 100) * 100) / 100;
}

// ── Caché en memoria (TTL configurable) ──────────────────────────────────────
//
// Recalcular únicamente cuando cambian tareas/permisos/config/cierre de mes —
// ver Analytics § Caché y performance. Los endpoints envuelven su cálculo
// principal con `cached()`, siempre con una clave `prefix:${userId}` (ver
// todos los `cached(` de este archivo y de las rutas de Analytics — ninguna
// clave usa otro formato). `invalidateAnalyticsCache(userId)` aprovecha ese
// formato fijo para borrar solo las entradas de ese usuario cuando se le
// pasa uno o varios ids; sin argumento hace limpieza total, reservada para
// cambios verdaderamente globales (config del sistema, curvas de
// normalización, cierre de mes) que no tienen un usuario único al que
// targetear.
type CacheEntry<T> = { value: T; expiresAt: number; computedAt: number };
const cache = new Map<string, CacheEntry<unknown>>();

// ── Diagnóstico del motor (§S3-D) ────────────────────────────────────────────
// Contadores en memoria (se reinician con cada reinicio del servidor, igual
// que el caché) — sin tabla nueva. Reflejan la actividad real del proceso
// desde que arrancó, no un "ciclo" artificial.
const diagnostics = {
  serverStartedAt: Date.now(),
  cacheHits: 0,
  cacheMisses: 0,
  totalComputeMs: 0,
  validationsRun: 0,
  validationsFailed: 0,
};

export function getDiagnosticsSnapshot() {
  return { ...diagnostics };
}

export async function cached<T>(key: string, ttlMinutes: number, compute: () => Promise<T>): Promise<{ value: T; computedAt: number; fromCache: boolean }> {
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) {
    diagnostics.cacheHits++;
    return { value: hit.value as T, computedAt: hit.computedAt, fromCache: true };
  }
  const startedAt = Date.now();
  const value = await compute();
  const computedAt = Date.now();
  diagnostics.cacheMisses++;
  diagnostics.totalComputeMs += computedAt - startedAt;
  cache.set(key, { value, expiresAt: computedAt + ttlMinutes * 60000, computedAt });
  return { value, computedAt, fromCache: false };
}

/**
 * Sin argumentos: limpieza total (comportamiento histórico, para cambios
 * globales sin un usuario único al que targetear). Con uno o varios userId:
 * borra únicamente las claves de caché de esos usuarios — toda clave de este
 * módulo termina en `:${userId}` (ver comentario arriba), así que basta con
 * comparar el sufijo tras los dos puntos finales.
 */
export function invalidateAnalyticsCache(userIds?: string | string[]): void {
  if (userIds === undefined) {
    cache.clear();
    return;
  }
  const ids = new Set(Array.isArray(userIds) ? userIds : [userIds]);
  if (ids.size === 0) return;
  for (const key of cache.keys()) {
    const suffix = key.slice(key.lastIndexOf(":") + 1);
    if (ids.has(suffix)) cache.delete(key);
  }
}

// ── Tendencias (§2) — tipos conservados como contrato de forma de la
// respuesta de Django (GET /analytics/<id>/), el cálculo ya no vive acá. ──

export type TrendResult =
  | { available: false; reason: string }
  | { available: true; direction: "mejora" | "empeoro" | "estable"; absoluteDiff: number; pctDiff: number; current: number; compared: number };

export type KpiTrends = {
  cumplimiento: { semanaAnterior: TrendResult; mesAnterior: TrendResult; promedio6Meses: TrendResult };
  carga: { semanaAnterior: TrendResult; mesAnterior: TrendResult; promedio6Meses: TrendResult };
};

// ── Consistencia (§4, corregida en Analytics Engine v1.3.1) ──────────────────

export type ConsistencyLevel = "muy-consistente" | "consistente" | "variable" | "muy-variable";
export type ConsistencyReliabilityLevel = "baja" | "media" | "alta" | "muy-alta";
export type ConsistencyReliability = { level: ConsistencyReliabilityLevel; stars: 2 | 3 | 4 | 5; label: string };
export type ExcludedPeriod = { period: string; reason: string };

export type ConsistencyResult =
  | { available: false; reason: string }
  | {
      available: true;
      level: ConsistencyLevel;
      label: string;
      coefficientOfVariation: number;
      /** Score 0-100 = 100/(1+CV) — ver Analytics § Sprint 1 (S1-B, reemplaza fórmulas previas que podían superar 100%). */
      consistencyPct: number;
      /** Semanas con datos REALES usadas en el cálculo — nunca incluye semanas anteriores al inicio efectivo del historial, sin registro, o anuladas por permiso/vacaciones de día completo (§Analytics Engine v1.3.1). */
      weeksAnalyzed: number;
      /** Días laborables con registro dentro de esas semanas válidas. */
      daysAnalyzed: number;
      /** Frase de contexto para el CV técnico — el usuario debe leer esto, no el CV crudo. */
      interpretation: string;
      /** Confiabilidad de la muestra — depende únicamente de la cantidad de semanas válidas usadas. */
      reliability: ConsistencyReliability;
      explain: {
        formula: string;
        periodsUsed: string[];
        periodsExcluded: ExcludedPeriod[];
        steps: string[];
        /** Frase de impacto cualitativo cuando level es "variable"/"muy-variable" (Sprint Analytics 2.0 Bloque 10); null en los demás niveles. */
        impactNote: string | null;
      };
    };

// ── Detección de anomalías (§5) — tipo conservado como contrato de forma. ────

export type Anomaly = { type: string; message: string; severity: "yellow" | "orange"; pctVariation: number };
export type AnomalyResult = { available: boolean; reason?: string; anomalies: Anomaly[] };

// ── Predicción simple (§6) — tipos conservados como contrato de forma. ──────

export type PredictionConfidence = "alta" | "media" | "baja";

export type Prediction =
  | { available: false; reason: string }
  | {
      available: true;
      confidence: PredictionConfidence;
      /** Confianza numérica 0-92% — nunca 100%, siempre hay incertidumbre (ver Sprint 1 S1-C). f(cantidad de datos, consistencia histórica, días restantes de proyección). */
      confidencePct: number;
      weeksOfData: number;
      cargaProximaSemanaHoras: number;
      cumplimientoEstimadoCierreMes: number;
      /** Intervalo alrededor de cumplimientoEstimadoCierreMes — más ancho cuanto menor la confianza. */
      cumplimientoEstimadoRango: { min: number; max: number };
      horasParaRangoOptimo: number;
      maxProjectionDays: number;
    };

// ── Equilibrio Operativo (§3, antes "Score de Salud Laboral" — ver docs/DECISIONS.md) ──
// Tipo conservado como contrato de forma — el cálculo ya lo hace Django.

export type HealthFactor = { name: string; rawLabel: string; weight: number; points: number; detail: string };
export type HealthScoreResult = {
  score: number;
  classification: "Excelente" | "Bueno" | "Riesgo" | "Crítico";
  classificationColor: "green" | "yellow" | "red";
  factors: HealthFactor[];
  engineVersion: string;
  explain: { formula: string; steps: string[] };
};

// ── Estado Operativo — 5 niveles (Sprint Analytics 2.0 Bloque 11/12) ────────
// Capa de PRESENTACIÓN adicional sobre HealthScoreResult.score — no
// reemplaza `classification`/`classificationColor` (que HealthScoreResult
// conserva con sus 4 valores de siempre, para no romper consumidores
// existentes: WhatIfSimulator, TeamWorkloadCards, nova-insights). Es una
// escala genuinamente nueva: ningún clasificador existente (Health 4-tier,
// Performance 4-tier, Riesgo 4-tier) tenía cortes en 90/75/60/40.

export type EstadoOperativo = "Equilibrio Óptimo" | "Equilibrio Estable" | "Requiere Atención" | "Riesgo Operativo" | "Desequilibrio Crítico";
export type EstadoOperativoColor = "green" | "blue" | "yellow" | "orange" | "red";

export type EstadoOperativoResult = {
  estado: EstadoOperativo;
  color: EstadoOperativoColor;
  emoji: string;
  rango: string;
  explicacionEjecutiva: string;
};

const ESTADO_OPERATIVO_TIERS: { min: number; estado: EstadoOperativo; color: EstadoOperativoColor; emoji: string; rango: string; explicacionEjecutiva: string }[] = [
  { min: 90, estado: "Equilibrio Óptimo", color: "green", emoji: "🟢", rango: "90–100", explicacionEjecutiva: "Puede asumir nuevos desafíos." },
  { min: 75, estado: "Equilibrio Estable", color: "blue", emoji: "🔵", rango: "75–89", explicacionEjecutiva: "Operación saludable." },
  { min: 60, estado: "Requiere Atención", color: "yellow", emoji: "🟡", rango: "60–74", explicacionEjecutiva: "Se recomienda seguimiento." },
  { min: 40, estado: "Riesgo Operativo", color: "orange", emoji: "🟠", rango: "40–59", explicacionEjecutiva: "Es conveniente intervenir." },
  { min: 0, estado: "Desequilibrio Crítico", color: "red", emoji: "🔴", rango: "0–39", explicacionEjecutiva: "Se recomienda una revisión inmediata." },
];

export function classifyEstadoOperativo(score: number): EstadoOperativoResult {
  const tier = ESTADO_OPERATIVO_TIERS.find((t) => score >= t.min) ?? ESTADO_OPERATIVO_TIERS[ESTADO_OPERATIVO_TIERS.length - 1];
  const { min: _min, ...rest } = tier;
  return rest;
}

// ── Performance Score (§Sprint 5 S5-B) — tipos conservados como contrato de
// forma; el cálculo (NormalizationEngine, 4 factores) ya lo hace Django. ────

export type PerformanceFactor = {
  name: string;
  curve: CurveName;
  rawValue: number;
  rawLabel: string;
  normalizedValue: number;
  weight: number;
  points: number;
  detail: string;
};
export type PerformanceScoreResult = {
  score: number;
  classification: "Excelente" | "Bueno" | "Riesgo" | "Crítico";
  classificationColor: "green" | "yellow" | "red";
  factors: PerformanceFactor[];
  engineVersion: string;
  formulaSetVersion: string;
  explain: { formula: string; steps: string[] };
};

// ── Índice de Riesgo Operativo (§13) — tipos conservados como contrato de forma. ──

export type RiskFactor = { name: string; weight: number; points: number; detail: string };
export type OperationalRiskResult = {
  score: number;
  classification: "Bajo" | "Medio" | "Alto" | "Crítico";
  classificationColor: "green" | "yellow" | "orange" | "red";
  factors: RiskFactor[];
  trendVsPrevMonth: { available: boolean; diff?: number; reason?: string };
  suggestedActions: string[];
  engineVersion: string;
  explain: { formula: string; steps: string[] };
};

// ── Tendencias de score (§Sprint 5 S5-I) — tipo conservado como contrato de forma. ──

export type ScoreTrendHistory = { semanaAnterior: TrendResult; mesAnterior: TrendResult; promedio6Meses: TrendResult };

// ── Calidad de los datos (§15) ──────────────────────────────────────────────────
//
// NO incluye "permisos no registrados detectados por ausencia de actividad":
// un colaborador puede estar en entrevistas, capacitaciones, visitas o
// reuniones sin registrar TaskActivity ese día — inferir un permiso a partir
// de la ausencia de registro generaría falsos positivos. Tampoco incluye
// "tareas sin prioridad": `Task.priority` es un enum obligatorio en el
// schema, ese estado no puede ocurrir.

// Cutover de stack — Fase 88 (ver docs/AUDIT_LOG.md § 2026-08-28):
// `computeDataQuality` (la implementación) se retiró — réplica exacta ya
// vive en Django (`apps/analytics/scoring.py::compute_data_quality`, 3
// consumidores reales) desde antes de esta fase; el único consumidor TS
// que quedaba (`api/analytics/diagnostics/route.ts`) ya llama a Django
// directo. Los TIPOS se conservan: siguen siendo el contrato de forma de
// `dataQuality` en el bundle de Reportes Ejecutivos
// (`buildSnapshotData.ts`, ya poblado desde Django vía
// `djangoReportKpisBridge.ts`) y en `AdvancedAnalytics.tsx`.
export type DataQualityIssue = { key: string; label: string; count: number };
export type DataQualityResult = { pct: number; issues: DataQualityIssue[] };

// ── Motor de alertas automáticas (§1) — tipo conservado como contrato de forma. ──

export type AlertSeverity = "red" | "orange" | "yellow" | "green";
export type EngineAlert = {
  rule: string;
  severity: AlertSeverity;
  message: string;
  suggestedAction: string;
  detectedAt: string;
};

// ── Historial de alertas resueltas (§S2-F) — tipo conservado como contrato de forma. ──

export type ResolvedAlert = { rule: string; message: string; daysAgo: number };

// ── Validación de consistencia entre KPIs (§S3-C) — tipo conservado como
// contrato de forma (`AnalyticsBundle.validationWarnings`, solo Administrador). ──

export type ValidationFailure = { rule: string; detail: string };

// ── Motor de Benchmarks Inteligente (§Sprint 7) — tipos conservados como
// contrato de forma; el cálculo (decisión cargo/cargo-limitado/personal para
// los 5 indicadores) ya lo hace Django. ──────────────────────────────────────

export type BenchmarkMode = "cargo" | "cargo-limitado" | "personal";

export type CargoMetricBenchmark = {
  mode: "cargo";
  value: number;
  peerAverage: number;
  percentile: number;
  best: number;
  diffFromAverage: number;
  peerCount: number;
};
export type CargoLimitadoMetricBenchmark = {
  mode: "cargo-limitado";
  value: number;
  peerAverage: number;
  diffFromAverage: number;
  peerCount: number;
};
export type PersonalMetricBenchmark = {
  mode: "personal";
  value: number;
  bestEver: number | null;
  bestEverDiff: number | null;
  avgLast90Days: number | null;
  avgLast90DaysDiff: number | null;
  semanaAnterior: number | null;
  semanaAnteriorDiff: number | null;
  mesAnterior: number | null;
  mesAnteriorDiff: number | null;
  /** Objetivo esperado del cargo (Ajustes) — null si nunca se configuró, NUNCA un valor inventado. */
  target: number | null;
  targetGap: number | null;
  /** Explica por qué algún campo quedó en null (p. ej. "Sin historial personal suficiente todavía"). */
  note: string | null;
};
export type MetricBenchmark = CargoMetricBenchmark | CargoLimitadoMetricBenchmark | PersonalMetricBenchmark;

export type SmartBenchmarkExplain = {
  mode: BenchmarkMode;
  reason: string;
  peerCount: number;
  periodAnalyzed: string;
  dataAvailable: string;
};

/**
 * Objetivo esperado del cargo (§Sprint 7) — configuración OPCIONAL por cargo,
 * usada únicamente como referencia en el Benchmark Personal. El GET/PATCH real
 * ya vive en Django (`apps.configuration`, `role-targets`) — este tipo se
 * conserva acá solo porque `SmartBenchmarkResult.roleTarget` (contrato de
 * forma de `GET /analytics/benchmarks/<id>/`) lo sigue necesitando.
 */
export type RoleTarget = {
  performance: number | null;
  riesgoMax: number | null;
  cumplimiento: number | null;
};

export type SmartBenchmarkResult = {
  mode: BenchmarkMode;
  performance: MetricBenchmark;
  operationalRisk: MetricBenchmark;
  cumplimiento: MetricBenchmark;
  cargaLaboral: MetricBenchmark;
  capacidadFutura: MetricBenchmark;
  roleTarget: RoleTarget | null;
  explain: SmartBenchmarkExplain;
  engineVersion: string;
};

// ── Evolución Personal (§Sprint 7) — tipos conservados como contrato de forma. ──

export type PersonalEvolutionTrend =
  | { available: false }
  | { available: true; direction: "mejora" | "empeoro" | "estable"; diff: number; basis: "semana anterior" | "promedio histórico" };

export type PersonalEvolution =
  | { available: false; reason: string; current: number }
  | {
      available: true;
      current: number;
      bestEver: number;
      worstEver: number;
      average: number;
      trend: PersonalEvolutionTrend;
      observations: number;
      spanWeeks: number;
    };
