import "server-only";
import { prisma } from "@/lib/prisma";
import { businessCalendarDay, businessDayRealRange, isBusinessDay } from "@/lib/businessTime";
import {
  computeCargaTiempo,
  computeCargaHistory,
  monthlyBusinessBase,
  isWorkingDay,
  countBusinessDays,
} from "@/lib/workload";
import { computeCapacityForecast, computeTeamCapacityForecast, classifyCapacity } from "@/lib/capacityForecast";
import { getHolidaySet } from "@/lib/holidays";
import { isTaskOverdue } from "@/lib/utils";
import {
  getEffectiveAnalyticsConfig,
  getEffectiveHorasEfectivas,
  getEffectiveCurve,
  CONFIG_KEY_HORAS_EFECTIVAS,
  type AnalyticsConfigKey,
  PREDICTION_MAX_DAYS,
} from "@/lib/systemConfig";
import { normalize, type CurveName, type CurvePoint } from "@/lib/normalizationEngine";
import type { DailyCargaPoint } from "@/components/kpis/types";
import type { Role } from "@/generated/prisma/client";

/**
 * Motor centralizado de Analytics — TODA métrica, tendencia, alerta y
 * predicción se calcula aquí de forma determinística (TypeScript + consultas
 * a PostgreSQL vía Prisma). Groq/IA NUNCA calcula nada — solo traduce
 * resultados YA CALCULADOS a lenguaje natural (ver /api/kpis/nova-insights).
 * PROHIBIDO duplicar estas fórmulas en componentes o rutas — todo endpoint
 * nuevo debe consumir las funciones de este archivo. Las fórmulas que ya
 * vivían en workload.ts/capacityForecast.ts/priorityCompliance.ts (base
 * laboral, semáforo de carga, capacidad proyectada, cumplimiento por
 * prioridad) NO se reimplementan aquí — este motor las reutiliza y construye
 * los indicadores nuevos (§3 Score de Salud, §13 Riesgo Operativo, tendencias,
 * consistencia, anomalías, predicción, calidad de datos, alertas) encima.
 */
export const ANALYTICS_ENGINE_VERSION = "1.3.0";

/**
 * Versión "de fórmulas" del Sprint 5 (§S5-L) — un tag global mostrado junto a
 * ANALYTICS_ENGINE_VERSION en "Ver cálculo"/Diagnóstico del Motor. Es
 * DISTINTO de FORMULA_VERSIONS (que versiona cada fórmula por separado,
 * §Sprint 4 S4-D) — este es el número de "conjunto de fórmulas" que el
 * Administrador reconoce como paquete (ANALYTICS_ENGINE_VERSION=motor,
 * FORMULA_SET_VERSION=paquete de fórmulas vigente dentro de ese motor).
 */
export const FORMULA_SET_VERSION = "4.0";

export { PREDICTION_MAX_DAYS };

// ── Versionado de fórmulas (§Sprint 4 S4-D, extendido en Sprint 5 S5-L) ──────
// Cada fórmula del negocio tiene su propia versión, independiente de
// ANALYTICS_ENGINE_VERSION (que versiona el motor como un todo). Se sube solo
// cuando la FÓRMULA cambia de resultado, no en cada refactor. Se registra en
// AnalyticsAuditLog (campo `formulaVersions` de `result`) y se expone
// exclusivamente al Administrador en el panel de Diagnóstico del Motor.
export const FORMULA_VERSIONS = {
  cargaLaboral: "1.0",
  // Score de Salud Laboral (LEGACY, ver Sprint 5 § S5-A) — fórmula sin tocar.
  scoreSalud: "1.0",
  scoreSimple: "1.0",
  capacidadDisponible: "1.0",
  // Riesgo Operativo — Sprint 5 § S5-C prohíbe modificar reglas/pesos/alertas.
  riesgoOperativo: "1.0",
  // Sprint 1 cambió el resultado de estas tres — versión real, no cosmética.
  cumplimiento: "2.0",
  consistencia: "2.0",
  prediccion: "2.0",
  // Nuevas en Sprint 5 (§S5-B, S5-G) — motor de normalización continuo.
  performanceScore: "4.0",
  trazabilidad: "4.0",
} as const;
export type FormulaName = keyof typeof FORMULA_VERSIONS;

// ── Priorización de cálculos (§Sprint 4 S4-G) ────────────────────────────────
// Documenta qué KPIs son críticos vs. informativos. El pipeline (ver más
// abajo) ya calcula primero los de prioridad alta — este mapa es la fuente
// de verdad de esa clasificación (también se expone en Diagnóstico del Motor).
export const KPI_PRIORITY = {
  cargaLaboral: "alta",
  cumplimiento: "alta",
  capacidadDisponible: "alta",
  riesgoOperativo: "alta",
  scoreSalud: "media",
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
// DISTINTO del "Score de Salud Laboral" del motor (computeHealthScore) — se
// muestra en rankings/reportes, no en el panel de Analytics avanzado; no se
// fusionan porque cambiaría números ya validados en esas pantallas. Única
// fuente ahora: esta función.
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

// ── Caché en memoria (TTL configurable) ──────────────────────────────────────
//
// Recalcular únicamente cuando cambian tareas/permisos/config/cierre de mes —
// ver Analytics § Caché y performance. Los endpoints envuelven su cálculo
// principal con `cached()`; los mutation endpoints relevantes llaman
// `invalidateAnalyticsCache()` (limpieza total: simple y correcta — el TTL ya
// es corto, y varias vistas son agregados de equipo sin una clave de usuario
// única que targetear con precisión).
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

export function invalidateAnalyticsCache(): void {
  cache.clear();
}

// ── Helpers de fecha ──────────────────────────────────────────────────────────

function monthBounds(year: number, month: number) {
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 0, 23, 59, 59, 999);
  return { start, end };
}

function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

function monthLabel(year: number, month: number): string {
  return new Date(year, month - 1, 1).toLocaleDateString("es-CL", { month: "short", year: "2-digit" });
}

function pluralize(n: number, singular: string, plural: string): string {
  return n === 1 ? singular : plural;
}

function avgOf(values: number[]): number | null {
  return values.length > 0 ? values.reduce((s, v) => s + v, 0) / values.length : null;
}

function stddev(values: number[]): { mean: number; sd: number; cv: number } {
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  const sd = Math.sqrt(variance);
  const cv = mean !== 0 ? (sd / Math.abs(mean)) * 100 : 0;
  return { mean, sd, cv };
}

function utcWeekStartOf(d: Date): Date {
  const dow = d.getUTCDay();
  const diff = dow === 0 ? -6 : 1 - dow;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + diff));
}

function formatIsoDate(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

// ── Auditoría (§11) ───────────────────────────────────────────────────────────

/** kind de AnalyticsAuditLog → fórmula(s) de negocio involucradas (§Sprint 4 S4-D). */
const AUDIT_KIND_FORMULAS: Record<string, FormulaName[]> = {
  health_score: ["scoreSalud", "cargaLaboral", "cumplimiento", "consistencia", "capacidadDisponible"],
  performance_score: ["performanceScore", "cumplimiento", "consistencia", "trazabilidad"],
  operational_risk: ["riesgoOperativo"],
  alerts: [],
  validation_failure: [],
};

async function auditCalculation(userId: string, kind: string, period: string, inputs: object, result: object): Promise<void> {
  try {
    const formulaVersions = Object.fromEntries((AUDIT_KIND_FORMULAS[kind] ?? []).map((f) => [f, FORMULA_VERSIONS[f]]));
    await prisma.analyticsAuditLog.create({
      data: { userId, kind, period, inputs, result: { ...result, formulaVersions }, engineVersion: ANALYTICS_ENGINE_VERSION },
    });
  } catch {
    // La auditoría es best-effort — nunca debe romper la respuesta del cálculo.
  }
}

// ── Histórico mensual (base de tendencias/anomalías) ─────────────────────────

export type MonthlyHistoryPoint = {
  month: string;
  label: string;
  totalTasks: number;
  completedPct: number;
  overdueCount: number;
  overdueAltaCount: number;
  cargaRealHours: number;
  cargaBaseHours: number;
  cargaPct: number;
  weekendHours: number;
  seguimientoCount: number;
};

/** Últimos `monthsBack` meses (incluye el actual, en curso) — usado por tendencias, anomalías y el Índice de Riesgo. */
export async function computeMonthlyHistory(userId: string, monthsBack = 6, now: Date = new Date()): Promise<MonthlyHistoryPoint[]> {
  const today = businessCalendarDay(now);
  const months = Array.from({ length: monthsBack }, (_, i) => {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - (monthsBack - 1 - i), 1));
    return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
  });

  const bizByMonth = await Promise.all(months.map(({ year, month }) => monthlyBusinessBase(year, month)));

  const rangeStart = monthBounds(months[0].year, months[0].month).start;
  const rangeEnd = monthBounds(months[months.length - 1].year, months[months.length - 1].month).end;
  const { start: realStart } = businessDayRealRange(bizByMonth[0].start);
  const { end: realEnd } = businessDayRealRange(bizByMonth[bizByMonth.length - 1].end);

  const [tasks, fijaTasks, activities] = await Promise.all([
    prisma.task.findMany({
      where: { assignedToId: userId, endDate: { gte: rangeStart, lte: rangeEnd } },
      select: { endDate: true, status: true, priority: true },
    }),
    prisma.task.findMany({
      where: { assignedToId: userId, type: "FIJA", archivedMonth: null, completedAt: { gte: realStart, lte: realEnd } },
      select: { completedAt: true, realHours: true },
    }),
    prisma.taskActivity.findMany({
      where: { authorId: userId, createdAt: { gte: realStart, lte: realEnd } },
      select: { createdAt: true, duration: true, task: { select: { type: true } } },
    }),
  ]);

  return months.map(({ year, month }, i) => {
    const { start, end } = monthBounds(year, month);
    const biz = bizByMonth[i];
    const { start: mRealStart } = businessDayRealRange(biz.start);
    const { end: mRealEnd } = businessDayRealRange(biz.end);

    const monthTasks = tasks.filter((t) => t.endDate >= start && t.endDate <= end);
    const completed = monthTasks.filter((t) => t.status === "COMPLETADA").length;
    const overdue = monthTasks.filter((t) => isTaskOverdue(t.endDate, t.status, now));
    const overdueAlta = overdue.filter((t) => t.priority === "ALTA").length;

    const monthFija = fijaTasks.filter((t) => t.completedAt! >= mRealStart && t.completedAt! <= mRealEnd);
    const monthActs = activities.filter((a) => a.createdAt >= mRealStart && a.createdAt <= mRealEnd);
    const fijaHours = monthFija.reduce((s, t) => s + t.realHours, 0);
    const actHours = monthActs.reduce((s, a) => s + a.duration, 0) / 60;
    const cargaRealHours = Math.round((fijaHours + actHours) * 100) / 100;

    let weekendHours = 0;
    for (let t = biz.start.getTime(); t <= biz.end.getTime(); t += 86400000) {
      const d = new Date(t);
      if (isBusinessDay(d)) continue;
      const { start: ds, end: de } = businessDayRealRange(d);
      const dayFija = monthFija.filter((x) => x.completedAt! >= ds && x.completedAt! <= de).reduce((s, x) => s + x.realHours, 0);
      const dayAct = monthActs.filter((x) => x.createdAt >= ds && x.createdAt <= de).reduce((s, x) => s + x.duration, 0) / 60;
      weekendHours += dayFija + dayAct;
    }

    const seguimientoCount = monthActs.filter((a) => a.task.type === "SEGUIMIENTO").length;

    return {
      month: monthKey(year, month),
      label: monthLabel(year, month),
      totalTasks: monthTasks.length,
      completedPct: monthTasks.length > 0 ? Math.round((completed / monthTasks.length) * 100) : 0,
      overdueCount: overdue.length,
      overdueAltaCount: overdueAlta,
      cargaRealHours,
      cargaBaseHours: biz.baseHours,
      cargaPct: biz.limitBaseHours > 0 ? Math.round((cargaRealHours / biz.limitBaseHours) * 100) : 0,
      weekendHours: Math.round(weekendHours * 100) / 100,
      seguimientoCount,
    };
  });
}

// ── Histórico semanal (consistencia, predicción, alertas) ────────────────────

export type WeeklyHistoryPoint = {
  weekStart: string;
  label: string;
  businessDays: number;
  realHours: number;
  baseHours: number;
  totalTasks: number;
  completedTasks: number;
  completedPct: number;
  daysWithRegistration: number;
};

/** Últimas `weeksBack` semanas COMPLETAS (lunes-viernes ya transcurridos) — la semana en curso se excluye para no sesgar promedios con datos parciales. */
export async function computeWeeklyHistory(userId: string, weeksBack = 6, now: Date = new Date()): Promise<WeeklyHistoryPoint[]> {
  const today = businessCalendarDay(now);
  const currentWeekStart = utcWeekStartOf(today);
  const weeks = Array.from({ length: weeksBack }, (_, i) => {
    const start = new Date(currentWeekStart.getTime() - (weeksBack - i) * 7 * 86400000);
    const end = new Date(start.getTime() + 4 * 86400000);
    return { start, end };
  });

  const holidays = await getHolidaySet();
  const hoursPerDay = await getEffectiveHorasEfectivas(now);
  const rangeStart = weeks[0].start;
  const rangeEnd = weeks[weeks.length - 1].end;
  const { start: realStart } = businessDayRealRange(rangeStart);
  const { end: realEnd } = businessDayRealRange(rangeEnd);

  const [tasks, fijaTasks, activities] = await Promise.all([
    prisma.task.findMany({
      where: { assignedToId: userId, endDate: { gte: rangeStart, lte: rangeEnd } },
      select: { endDate: true, status: true },
    }),
    prisma.task.findMany({
      where: { assignedToId: userId, type: "FIJA", archivedMonth: null, completedAt: { gte: realStart, lte: realEnd } },
      select: { completedAt: true, realHours: true },
    }),
    prisma.taskActivity.findMany({
      where: { authorId: userId, createdAt: { gte: realStart, lte: realEnd } },
      select: { createdAt: true, duration: true },
    }),
  ]);

  return weeks.map(({ start, end }, i) => {
    const businessDays = countBusinessDays(start, end, holidays);
    const weekTasks = tasks.filter((t) => t.endDate >= start && t.endDate <= end);
    const completed = weekTasks.filter((t) => t.status === "COMPLETADA").length;

    let realHours = 0;
    let daysWithRegistration = 0;
    for (let t = start.getTime(); t <= end.getTime(); t += 86400000) {
      const d = new Date(t);
      if (!isWorkingDay(d, holidays)) continue;
      const { start: ds, end: de } = businessDayRealRange(d);
      const dayFija = fijaTasks.filter((x) => x.completedAt! >= ds && x.completedAt! <= de).reduce((s, x) => s + x.realHours, 0);
      const dayAct = activities.filter((x) => x.createdAt >= ds && x.createdAt <= de).reduce((s, x) => s + x.duration, 0) / 60;
      const dayHours = dayFija + dayAct;
      realHours += dayHours;
      if (dayHours > 0) daysWithRegistration++;
    }

    return {
      weekStart: formatIsoDate(start),
      label: `Sem ${i + 1}`,
      businessDays,
      realHours: Math.round(realHours * 100) / 100,
      baseHours: Math.round(businessDays * hoursPerDay * 100) / 100,
      totalTasks: weekTasks.length,
      completedTasks: completed,
      completedPct: weekTasks.length > 0 ? Math.round((completed / weekTasks.length) * 100) : 0,
      daysWithRegistration,
    };
  });
}

// ── Tendencias (§2) ────────────────────────────────────────────────────────────

export type TrendResult =
  | { available: false; reason: string }
  | { available: true; direction: "mejora" | "empeoro" | "estable"; absoluteDiff: number; pctDiff: number; current: number; compared: number };

const NO_HISTORY: TrendResult = { available: false, reason: "Sin historial suficiente" };

function computeTrendGeneric(current: number, compared: number | null, higherIsBetter: boolean): TrendResult {
  if (compared === null) return NO_HISTORY;
  const absoluteDiff = Math.round((current - compared) * 100) / 100;
  const pctDiff = compared !== 0 ? Math.round((absoluteDiff / Math.abs(compared)) * 1000) / 10 : 0;
  const improved = higherIsBetter ? absoluteDiff > 0.5 : absoluteDiff < -0.5;
  const worsened = higherIsBetter ? absoluteDiff < -0.5 : absoluteDiff > 0.5;
  const direction = improved ? "mejora" : worsened ? "empeoro" : "estable";
  return { available: true, direction, absoluteDiff, pctDiff, current, compared };
}

/** Para carga laboral no hay una dirección monótona "mejor" — "mejora" = se acercó al 100% (base); "empeoró" = se alejó (hacia subutilización o sobrecarga). */
function computeCargaTrend(current: number, compared: number | null): TrendResult {
  if (compared === null) return NO_HISTORY;
  const absoluteDiff = Math.round((current - compared) * 100) / 100;
  const pctDiff = compared !== 0 ? Math.round((absoluteDiff / Math.abs(compared)) * 1000) / 10 : 0;
  const currentDeviation = Math.abs(current - 100);
  const comparedDeviation = Math.abs(compared - 100);
  const direction = currentDeviation < comparedDeviation - 1 ? "mejora" : currentDeviation > comparedDeviation + 1 ? "empeoro" : "estable";
  return { available: true, direction, absoluteDiff, pctDiff, current, compared };
}

export type KpiTrends = {
  cumplimiento: { semanaAnterior: TrendResult; mesAnterior: TrendResult; promedio6Meses: TrendResult };
  carga: { semanaAnterior: TrendResult; mesAnterior: TrendResult; promedio6Meses: TrendResult };
};

export async function computeTrends(userId: string, now: Date = new Date()): Promise<KpiTrends> {
  const [monthly, weekly] = await Promise.all([computeMonthlyHistory(userId, 6, now), computeWeeklyHistory(userId, 6, now)]);

  const currentMonth = monthly[monthly.length - 1];
  const prevMonth = monthly.length >= 2 ? monthly[monthly.length - 2] : null;
  const priorMonths = monthly.slice(0, -1).filter((m) => m.totalTasks > 0);
  const priorMonthsCarga = monthly.slice(0, -1).filter((m) => m.cargaRealHours > 0 || m.cargaBaseHours > 0);

  const lastWeek = weekly.length >= 1 ? weekly[weekly.length - 1] : null;
  const prevWeek = weekly.length >= 2 ? weekly[weekly.length - 2] : null;
  const lastWeekCargaPct = lastWeek && lastWeek.baseHours > 0 ? Math.round((lastWeek.realHours / lastWeek.baseHours) * 100) : null;
  const prevWeekCargaPct = prevWeek && prevWeek.baseHours > 0 ? Math.round((prevWeek.realHours / prevWeek.baseHours) * 100) : null;

  return {
    cumplimiento: {
      semanaAnterior:
        lastWeek && prevWeek && lastWeek.totalTasks > 0 && prevWeek.totalTasks > 0
          ? computeTrendGeneric(lastWeek.completedPct, prevWeek.completedPct, true)
          : NO_HISTORY,
      mesAnterior:
        prevMonth && currentMonth.totalTasks > 0 && prevMonth.totalTasks > 0
          ? computeTrendGeneric(currentMonth.completedPct, prevMonth.completedPct, true)
          : NO_HISTORY,
      promedio6Meses: currentMonth.totalTasks > 0 ? computeTrendGeneric(currentMonth.completedPct, avgOf(priorMonths.map((m) => m.completedPct)), true) : NO_HISTORY,
    },
    carga: {
      semanaAnterior: lastWeekCargaPct !== null && prevWeekCargaPct !== null ? computeCargaTrend(lastWeekCargaPct, prevWeekCargaPct) : NO_HISTORY,
      mesAnterior: prevMonth && prevMonth.cargaBaseHours > 0 ? computeCargaTrend(currentMonth.cargaPct, prevMonth.cargaPct) : NO_HISTORY,
      promedio6Meses: currentMonth.cargaBaseHours > 0 ? computeCargaTrend(currentMonth.cargaPct, avgOf(priorMonthsCarga.map((m) => m.cargaPct))) : NO_HISTORY,
    },
  };
}

// ── Consistencia (§4) ──────────────────────────────────────────────────────────

export type ConsistencyLevel = "muy-consistente" | "consistente" | "variable" | "muy-variable";

export type ConsistencyResult =
  | { available: false; reason: string }
  | {
      available: true;
      level: ConsistencyLevel;
      label: string;
      coefficientOfVariation: number;
      /** Score 0-100 = 100/(1+CV) — ver Analytics § Sprint 1 (S1-B, reemplaza fórmulas previas que podían superar 100%). */
      consistencyPct: number;
      weeksAnalyzed: number;
    };

/** Clasificación categórica a partir del CV promedio (%) — función pura, testeable sin BD. */
export function consistencyLevelFromCv(avgCv: number): { level: ConsistencyLevel; label: string } {
  if (avgCv < 10) return { level: "muy-consistente", label: "Muy consistente" };
  if (avgCv < 20) return { level: "consistente", label: "Consistente" };
  if (avgCv < 35) return { level: "variable", label: "Variable" };
  return { level: "muy-variable", label: "Muy variable" };
}

/** consistencia = 100 / (1 + CV_fraction) — siempre en (0, 100], nunca requiere un MIN(100, …) que oculte un error de fórmula (ver Sprint 1 S1-B). Función pura, testeable sin BD. */
export function consistencyPctFromCv(avgCv: number): number {
  return Math.round((100 / (1 + avgCv / 100)) * 10) / 10;
}

export async function computeConsistency(userId: string, now: Date = new Date()): Promise<ConsistencyResult> {
  const weekly = await computeWeeklyHistory(userId, 6, now);
  const withData = weekly.filter((w) => w.businessDays > 0);
  if (withData.length < 2) return { available: false, reason: "Sin historial suficiente" };

  const hoursCv = stddev(withData.map((w) => w.realHours)).cv;
  const tasksCv = stddev(withData.map((w) => w.completedTasks)).cv;
  const complianceCv = stddev(withData.map((w) => w.completedPct)).cv;
  const avgCv = (hoursCv + tasksCv + complianceCv) / 3;

  const { level, label } = consistencyLevelFromCv(avgCv);
  const consistencyPct = consistencyPctFromCv(avgCv);

  return {
    available: true,
    level,
    label,
    coefficientOfVariation: Math.round(avgCv * 10) / 10,
    consistencyPct,
    weeksAnalyzed: withData.length,
  };
}

// ── Detección de anomalías (§5) ────────────────────────────────────────────────

export type Anomaly = { type: string; message: string; severity: "yellow" | "orange"; pctVariation: number };
export type AnomalyResult = { available: boolean; reason?: string; anomalies: Anomaly[] };

export async function detectAnomalies(userId: string, now: Date = new Date()): Promise<AnomalyResult> {
  const config = await getEffectiveAnalyticsConfig(now);
  const monthly = await computeMonthlyHistory(userId, 6, now);
  const current = monthly[monthly.length - 1];
  const history = monthly.slice(0, -1).filter((m) => m.totalTasks > 0 || m.cargaRealHours > 0);
  if (history.length < 3) return { available: false, reason: "Insuficiente historial para detectar anomalías", anomalies: [] };

  const threshold = config.anomalyVariationThresholdPct;
  const anomalies: Anomaly[] = [];
  const checks: Array<{ key: "cargaRealHours" | "completedPct" | "seguimientoCount"; label: string }> = [
    { key: "cargaRealHours", label: "Carga laboral" },
    { key: "completedPct", label: "Cumplimiento" },
    { key: "seguimientoCount", label: "Actividades de seguimiento" },
  ];
  for (const { key, label } of checks) {
    const values = history.map((m) => m[key]);
    const { mean } = stddev(values);
    if (mean === 0) continue;
    const currentVal = current[key];
    const variation = ((currentVal - mean) / Math.abs(mean)) * 100;
    if (Math.abs(variation) >= threshold) {
      const direction = variation > 0 ? "un incremento" : "una caída";
      anomalies.push({
        type: key,
        message: `${label}: ${direction} del ${Math.abs(Math.round(variation))}% respecto al promedio histórico personal (${Math.round(mean * 10) / 10} → ${Math.round(currentVal * 10) / 10})`,
        severity: Math.abs(variation) >= threshold * 1.5 ? "orange" : "yellow",
        pctVariation: Math.round(variation),
      });
    }
  }
  return { available: true, anomalies };
}

// ── Predicción simple (§6) ──────────────────────────────────────────────────────

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

/** Confianza numérica de la predicción, siempre < 100% — ver Sprint 1 S1-C. */
const MAX_PREDICTION_CONFIDENCE_PCT = 92;

export function computePredictionConfidencePct(weeksOfData: number, consistency: ConsistencyResult, daysRemaining: number): number {
  const dataScore = Math.min(1, weeksOfData / 6);
  const consistencyScore = !consistency.available
    ? 0.5
    : consistency.level === "muy-consistente"
      ? 1
      : consistency.level === "consistente"
        ? 0.8
        : consistency.level === "variable"
          ? 0.5
          : 0.25;
  const cappedDaysRemaining = Math.min(daysRemaining, PREDICTION_MAX_DAYS);
  const horizonScore = 1 - (cappedDaysRemaining / PREDICTION_MAX_DAYS) * 0.4;
  return Math.round(MAX_PREDICTION_CONFIDENCE_PCT * (0.4 * dataScore + 0.4 * consistencyScore + 0.2 * horizonScore));
}

async function computeMonthlyCompliancePace(userId: string, now: Date): Promise<number> {
  const today = businessCalendarDay(now);
  const year = today.getUTCFullYear();
  const month = today.getUTCMonth() + 1;
  const [biz, holidays] = await Promise.all([monthlyBusinessBase(year, month), getHolidaySet()]);
  const elapsedBusinessDays = countBusinessDays(biz.start, today, holidays);
  const { start, end } = monthBounds(year, month);
  const tasks = await prisma.task.findMany({ where: { assignedToId: userId, endDate: { gte: start, lte: end } }, select: { status: true } });
  if (tasks.length === 0 || elapsedBusinessDays === 0) return 0;
  const completed = tasks.filter((t) => t.status === "COMPLETADA").length;
  const completedPct = (completed / tasks.length) * 100;
  const projected = completedPct * (biz.businessDays / elapsedBusinessDays);
  return Math.min(100, Math.round(projected));
}

export async function computePrediction(userId: string, now: Date = new Date()): Promise<Prediction> {
  const config = await getEffectiveAnalyticsConfig(now);
  const weekly = await computeWeeklyHistory(userId, 6, now);
  const withData = weekly.filter((w) => w.businessDays > 0);
  if (withData.length < 1) return { available: false, reason: "Sin historial suficiente" };

  const confidence: PredictionConfidence =
    withData.length > 3 ? "alta" : withData.length >= config.predictionMinWeeksMedia ? "media" : "baja";

  const n = withData.length;
  const ys = withData.map((w) => w.realHours);
  const xMean = (n - 1) / 2;
  const yMean = ys.reduce((s, y) => s + y, 0) / n;
  let num = 0;
  let den = 0;
  ys.forEach((y, x) => {
    num += (x - xMean) * (y - yMean);
    den += (x - xMean) ** 2;
  });
  const slope = den !== 0 ? num / den : 0;
  const cargaProximaSemanaHoras = Math.max(0, Math.round((yMean + slope * n) * 100) / 100);

  const [cargaTiempo, cumplimientoEstimadoCierreMes, consistency] = await Promise.all([
    computeCargaTiempo(userId, now),
    computeMonthlyCompliancePace(userId, now),
    computeConsistency(userId, now),
  ]);

  const horasParaRangoOptimo =
    cargaTiempo.mensual.label === "Subutilización"
      ? Math.max(0, Math.round((cargaTiempo.mensual.rangeMin - cargaTiempo.mensual.realHours) * 100) / 100)
      : 0;

  const today = businessCalendarDay(now);
  const { end: monthEnd } = monthBounds(today.getUTCFullYear(), today.getUTCMonth() + 1);
  const daysRemaining = Math.max(0, Math.round((monthEnd.getTime() - today.getTime()) / 86400000));

  const confidencePct = computePredictionConfidencePct(n, consistency, daysRemaining);
  const halfWidth = Math.max(2, Math.round((100 - confidencePct) * 0.2));
  const cumplimientoEstimadoRango = {
    min: Math.max(0, cumplimientoEstimadoCierreMes - halfWidth),
    max: Math.min(100, cumplimientoEstimadoCierreMes + halfWidth),
  };

  return {
    available: true,
    confidence,
    confidencePct,
    weeksOfData: n,
    cargaProximaSemanaHoras,
    cumplimientoEstimadoCierreMes,
    cumplimientoEstimadoRango,
    horasParaRangoOptimo,
    maxProjectionDays: PREDICTION_MAX_DAYS,
  };
}

// ── Score de Salud Laboral (§3) ─────────────────────────────────────────────────

export type HealthFactor = { name: string; rawLabel: string; weight: number; points: number; detail: string };
export type HealthScoreResult = {
  score: number;
  classification: "Excelente" | "Bueno" | "Riesgo" | "Crítico";
  classificationColor: "green" | "yellow" | "red";
  factors: HealthFactor[];
  engineVersion: string;
  explain: { formula: string; steps: string[] };
};

/** Mapea horas reales del mes a un puntaje 0-100 usando los 4 límites REALES (no el % con techo en 100 usado para mostrar el semáforo) — Óptimo=100, decrece simétricamente hacia ambos extremos. */
export function cargaHealthScore(realHours: number, baseHours: number, limitHighHours: number, limitOverloadHours: number): number {
  if (baseHours <= 0) return 100;
  if (realHours >= baseHours && realHours <= limitHighHours) return 100;
  if (realHours < baseHours) {
    return Math.round(Math.max(0, Math.min(100, (realHours / baseHours) * 100)));
  }
  const overBy = realHours - limitHighHours;
  const span = Math.max((limitOverloadHours - limitHighHours) * 2, 1);
  return Math.round(Math.max(0, 100 - (overBy / span) * 100));
}

function consistencyToScore(consistency: ConsistencyResult): number {
  if (!consistency.available) return 70;
  switch (consistency.level) {
    case "muy-consistente": return 100;
    case "consistente": return 80;
    case "variable": return 55;
    case "muy-variable": return 25;
  }
}

export function capacityToScore(estado: string, disponiblePct: number): number {
  if (estado === "alta") return 100;
  if (estado === "limitada") return 70;
  if (estado === "sin-planificacion") return 70;
  if (disponiblePct < 0) return 0;
  return 40;
}

/**
 * `precomputedConsistency` es opcional — cuando el caller ya la calculó (p.
 * ej. `runAnalyticsPipeline`, que necesita el mismo valor para Performance
 * Score, Predicción y el bundle general) se reutiliza en vez de repetir la
 * consulta. Si se omite, se calcula aquí como antes (compatibilidad con
 * callers existentes como el simulador).
 */
export async function computeHealthScore(userId: string, now: Date = new Date(), precomputedConsistency?: ConsistencyResult): Promise<HealthScoreResult> {
  const config = await getEffectiveAnalyticsConfig(now);
  const today = businessCalendarDay(now);
  const year = today.getUTCFullYear();
  const month = today.getUTCMonth() + 1;
  const { start, end } = monthBounds(year, month);

  const [tasks, cargaTiempo, capacity, consistency, biz] = await Promise.all([
    prisma.task.findMany({ where: { assignedToId: userId, endDate: { gte: start, lte: end } }, select: { status: true, priority: true, endDate: true } }),
    computeCargaTiempo(userId, now),
    computeCapacityForecast(userId, now),
    precomputedConsistency ? Promise.resolve(precomputedConsistency) : computeConsistency(userId, now),
    monthlyBusinessBase(year, month),
  ]);

  const completed = tasks.filter((t) => t.status === "COMPLETADA").length;
  const completedPct = tasks.length > 0 ? Math.round((completed / tasks.length) * 100) : 100;
  const overdue = tasks.filter((t) => isTaskOverdue(t.endDate, t.status, now));
  const overdueAlta = overdue.filter((t) => t.priority === "ALTA").length;
  const overdueNormal = overdue.length - overdueAlta;

  const cargaScore = cargaHealthScore(cargaTiempo.mensual.realHours, biz.limitBaseHours, biz.limitHighHours, biz.limitOverloadHours);
  const overdueScore = Math.max(0, 100 - overdueNormal * 10 - overdueAlta * 20);
  const consistencyScore = consistencyToScore(consistency);
  const capacityScore = capacityToScore(capacity.estado, capacity.disponiblePct);

  const mk = (name: string, rawLabel: string, weightKey: AnalyticsConfigKey, rawScore: number): HealthFactor => {
    const weight = config[weightKey];
    const points = Math.round(((rawScore * weight) / 100) * 100) / 100;
    return { name, rawLabel, weight, points, detail: `${rawLabel} × ${weight}% = ${points} pts` };
  };

  const factors: HealthFactor[] = [
    mk("Cumplimiento", `${completedPct}%`, "healthWeightCumplimiento", completedPct),
    mk("Carga laboral", `${cargaTiempo.mensual.label} (${cargaTiempo.mensual.pct}%)`, "healthWeightCarga", cargaScore),
    mk("Tareas vencidas", `${overdue.length}`, "healthWeightVencidas", overdueScore),
    mk("Consistencia", consistency.available ? consistency.label : "Sin historial suficiente", "healthWeightConsistencia", consistencyScore),
    mk("Capacidad futura", `${capacity.disponiblePct}%`, "healthWeightCapacidad", capacityScore),
  ];

  const score = Math.round(factors.reduce((s, f) => s + f.points, 0) * 100) / 100;
  const classification = score >= 90 ? "Excelente" : score >= 75 ? "Bueno" : score >= 60 ? "Riesgo" : "Crítico";
  const classificationColor = score >= 75 ? "green" : score >= 60 ? "yellow" : "red";

  const steps = factors.map((f) => `${f.name} ${f.rawLabel} × ${f.weight}% = ${f.points} pts`);
  steps.push(`Total: ${score} → ${classification}`);

  const result: HealthScoreResult = {
    score,
    classification,
    classificationColor,
    factors,
    engineVersion: ANALYTICS_ENGINE_VERSION,
    explain: { formula: "Σ (valor_normalizado_factor × peso_factor%)", steps },
  };

  await auditCalculation(
    userId,
    "health_score",
    monthKey(year, month),
    { completedPct, cargaScore, overdueScore, consistencyScore, capacityScore, weights: config },
    result
  );
  return result;
}

// ── Performance Score (§Sprint 5 S5-B) ──────────────────────────────────────────
//
// Responde UNA sola pregunta: "¿qué tan bien está ejecutando su trabajo?".
// Solo 4 factores — Cumplimiento, Tareas vencidas, Consistencia, Índice de
// Trazabilidad — y deliberadamente NUNCA incluye carga laboral, capacidad
// futura, riesgo operativo ni disponibilidad (esos viven en Operational
// Risk, ver computeOperationalRisk más abajo, sin tocar). Cada factor pasa
// por NormalizationEngine (src/lib/normalizationEngine.ts) — cero cálculos
// de negocio inline aquí, todo raw→normalizado ocurre en `normalize()`.

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

/** Índice de Trazabilidad (§S5-G, reemplaza el nombre "Calidad" — NO mide calidad del trabajo, mide evidencia/documentación del trabajo realizado). Raw 0-100, compuesto de: % de días con registro (50%), comentarios del período (25%), actividades documentadas (25%). */
async function computeTrazabilidadRaw(userId: string, start: Date, end: Date, now: Date): Promise<{ raw: number; detail: string }> {
  const [weekly, comments, activities] = await Promise.all([
    computeWeeklyHistory(userId, 4, now),
    prisma.comment.count({ where: { authorId: userId, createdAt: { gte: start, lte: end } } }),
    prisma.taskActivity.count({ where: { authorId: userId, createdAt: { gte: start, lte: end } } }),
  ]);
  const withData = weekly.filter((w) => w.businessDays > 0);
  const registroPct =
    withData.length > 0
      ? (withData.reduce((s, w) => s + w.daysWithRegistration / w.businessDays, 0) / withData.length) * 100
      : 0;
  const commentsScore = Math.min(100, comments * 10);
  const activitiesScore = Math.min(100, activities * 10);
  const raw = registroPct * 0.5 + commentsScore * 0.25 + activitiesScore * 0.25;
  return { raw, detail: `${Math.round(registroPct)}% días con registro, ${comments} comentarios, ${activities} actividades documentadas` };
}

/** `precomputedConsistency` — ver nota en computeHealthScore; evita recalcular la misma consulta dentro del pipeline. */
export async function computePerformanceScore(userId: string, now: Date = new Date(), precomputedConsistency?: ConsistencyResult): Promise<PerformanceScoreResult> {
  const config = await getEffectiveAnalyticsConfig(now);
  const today = businessCalendarDay(now);
  const year = today.getUTCFullYear();
  const month = today.getUTCMonth() + 1;
  const { start, end } = monthBounds(year, month);

  const [tasks, consistency, trazabilidad, curves] = await Promise.all([
    prisma.task.findMany({ where: { assignedToId: userId, endDate: { gte: start, lte: end } }, select: { status: true, priority: true, endDate: true } }),
    precomputedConsistency ? Promise.resolve(precomputedConsistency) : computeConsistency(userId, now),
    computeTrazabilidadRaw(userId, start, end, now),
    Promise.all((["cumplimiento", "vencidas", "consistencia", "trazabilidad"] as CurveName[]).map((n) => getEffectiveCurve(n, now))),
  ]);
  const [cumplimientoCurve, vencidasCurve, consistenciaCurve, trazabilidadCurve] = curves;

  const completed = tasks.filter((t) => t.status === "COMPLETADA").length;
  const completedPct = tasks.length > 0 ? Math.round((completed / tasks.length) * 100) : 100;
  const overdue = tasks.filter((t) => isTaskOverdue(t.endDate, t.status, now));
  const overdueAlta = overdue.filter((t) => t.priority === "ALTA").length;
  const overdueNormal = overdue.length - overdueAlta;
  const weightedOverdue = overdueNormal + overdueAlta * 2;

  // Sin historial suficiente → valor neutro (mismo criterio que el Score
  // Legacy: consistencyToScore también usa 70 como neutro cuando no hay dato).
  const consistencyRaw = consistency.available ? consistency.consistencyPct : 70;

  const mk = (name: string, curve: CurveName, rawValue: number, rawLabel: string, weight: number, curvePoints: CurvePoint[]): PerformanceFactor => {
    const normalizedValue = normalize(curve, rawValue, curvePoints);
    const points = Math.round(((normalizedValue * weight) / 100) * 100) / 100;
    return { name, curve, rawValue: Math.round(rawValue * 10) / 10, rawLabel, normalizedValue, weight, points, detail: `${rawLabel} → normalizado ${normalizedValue} × ${weight}% = ${points} pts` };
  };

  const factors: PerformanceFactor[] = [
    mk("Cumplimiento", "cumplimiento", completedPct, `${completedPct}%`, config.perfWeightCumplimiento, cumplimientoCurve),
    mk("Tareas vencidas", "vencidas", weightedOverdue, `${overdue.length} (${overdueAlta} de prioridad Alta)`, config.perfWeightVencidas, vencidasCurve),
    mk(
      "Consistencia",
      "consistencia",
      consistencyRaw,
      consistency.available ? `${consistency.consistencyPct}%` : "Sin historial suficiente",
      config.perfWeightConsistencia,
      consistenciaCurve
    ),
    mk("Índice de Trazabilidad", "trazabilidad", trazabilidad.raw, trazabilidad.detail, config.perfWeightTrazabilidad, trazabilidadCurve),
  ];

  const score = Math.round(factors.reduce((s, f) => s + f.points, 0) * 100) / 100;
  const classification = score >= 90 ? "Excelente" : score >= 75 ? "Bueno" : score >= 60 ? "Riesgo" : "Crítico";
  const classificationColor = score >= 75 ? "green" : score >= 60 ? "yellow" : "red";

  const steps = factors.map((f) => `${f.name}: ${f.rawLabel} → normalizado ${f.normalizedValue} × ${f.weight}% = ${f.points} pts`);
  steps.push(`Total: ${score} → ${classification}`);

  const result: PerformanceScoreResult = {
    score,
    classification,
    classificationColor,
    factors,
    engineVersion: ANALYTICS_ENGINE_VERSION,
    formulaSetVersion: FORMULA_SET_VERSION,
    explain: { formula: "Σ (NormalizationEngine(valor_original) × peso_factor%)", steps },
  };

  await auditCalculation(userId, "performance_score", monthKey(year, month), { completedPct, weightedOverdue, consistencyRaw, trazabilidadRaw: trazabilidad.raw, weights: config }, result);
  return result;
}

// ── Índice de Riesgo Operativo (§13) ────────────────────────────────────────────

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

async function computeSeguimientoConcentration(userId: string, year: number, month: number): Promise<{ pct: number; detail: string }> {
  const { start, end } = monthBounds(year, month);
  const activities = await prisma.taskActivity.findMany({
    where: { authorId: userId, createdAt: { gte: start, lte: end }, task: { type: "SEGUIMIENTO" } },
    select: { reason: true, duration: true },
  });
  const total = activities.reduce((s, a) => s + a.duration, 0);
  if (total === 0) return { pct: 0, detail: "Sin actividades de seguimiento este mes" };
  const byReason = new Map<string, number>();
  for (const a of activities) byReason.set(a.reason, (byReason.get(a.reason) ?? 0) + a.duration);
  const top = [...byReason.entries()].sort((a, b) => b[1] - a[1])[0];
  const topPct = Math.round((top[1] / total) * 100);
  const pct = topPct > 70 ? Math.min(100, (topPct - 70) * 3) : 0;
  return { pct, detail: topPct > 70 ? `${topPct}% del tiempo de seguimiento concentrado en un solo motivo` : `Concentración máxima entre motivos: ${topPct}%` };
}

// ── Tendencias de score (§Sprint 5 S5-I) ─────────────────────────────────────
// vs. semana anterior / mes anterior / promedio 6 meses — reutiliza
// AnalyticsAuditLog (mismo mecanismo que el resto del motor, sin tabla
// nueva) y el mismo TrendResult/computeTrendGeneric del §2 de arriba.

export type ScoreTrendHistory = { semanaAnterior: TrendResult; mesAnterior: TrendResult; promedio6Meses: TrendResult };

export async function getScoreTrendHistory(
  userId: string,
  kind: "performance_score" | "operational_risk",
  currentScore: number,
  higherIsBetter: boolean,
  now: Date = new Date()
): Promise<ScoreTrendHistory> {
  const sixMonthsAgo = new Date(now.getTime() - 183 * 86400000);
  let entries: Array<{ createdAt: Date; result: unknown }> = [];
  try {
    entries = await prisma.analyticsAuditLog.findMany({
      where: { userId, kind, createdAt: { gte: sixMonthsAgo, lt: now } },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true, result: true },
    });
  } catch {
    return { semanaAnterior: NO_HISTORY, mesAnterior: NO_HISTORY, promedio6Meses: NO_HISTORY };
  }

  const scored = entries
    .map((e) => ({
      createdAt: e.createdAt,
      score: e.result && typeof e.result === "object" ? (e.result as { score?: unknown }).score : undefined,
    }))
    .filter((e): e is { createdAt: Date; score: number } => typeof e.score === "number");

  // El punto histórico más cercano a `daysAgo`, con una tolerancia de ±3 días
  // (los cálculos no ocurren en un cron exacto, sino cuando alguien recalcula).
  function closestTo(daysAgo: number): number | null {
    const target = now.getTime() - daysAgo * 86400000;
    let best: { score: number; diff: number } | null = null;
    for (const e of scored) {
      const diff = Math.abs(e.createdAt.getTime() - target);
      if (diff <= 3 * 86400000 && (!best || diff < best.diff)) best = { score: e.score, diff };
    }
    return best?.score ?? null;
  }

  const weekAgoScore = closestTo(7);
  const monthAgoScore = closestTo(30);
  const olderThanAWeek = scored.filter((e) => e.createdAt.getTime() < now.getTime() - 7 * 86400000);
  const avg6mo = olderThanAWeek.length > 0 ? olderThanAWeek.reduce((s, e) => s + e.score, 0) / olderThanAWeek.length : null;

  return {
    semanaAnterior: computeTrendGeneric(currentScore, weekAgoScore, higherIsBetter),
    mesAnterior: computeTrendGeneric(currentScore, monthAgoScore, higherIsBetter),
    promedio6Meses: computeTrendGeneric(currentScore, avg6mo, higherIsBetter),
  };
}

async function getRiskTrendVsPrevMonth(userId: string, year: number, month: number, currentScore: number): Promise<{ available: boolean; diff?: number; reason?: string }> {
  let pm = month - 1;
  let py = year;
  if (pm <= 0) { pm = 12; py--; }
  const prevKey = monthKey(py, pm);
  try {
    const prev = await prisma.analyticsAuditLog.findFirst({
      where: { userId, kind: "operational_risk", period: prevKey },
      orderBy: { createdAt: "desc" },
      select: { result: true },
    });
    const prevScore = prev && typeof prev.result === "object" && prev.result !== null ? (prev.result as { score?: unknown }).score : undefined;
    if (typeof prevScore !== "number") return { available: false, reason: "Sin historial suficiente" };
    return { available: true, diff: Math.round((currentScore - prevScore) * 100) / 100 };
  } catch {
    return { available: false, reason: "Sin historial suficiente" };
  }
}

/** Clasificación Bajo/Medio/Alto/Crítico a partir del score y los 3 umbrales configurables — función pura, testeable sin BD. */
export function classifyOperationalRisk(
  score: number,
  thresholdMedio: number,
  thresholdAlto: number,
  thresholdCritico: number
): { classification: OperationalRiskResult["classification"]; classificationColor: OperationalRiskResult["classificationColor"] } {
  const classification: OperationalRiskResult["classification"] =
    score >= thresholdCritico ? "Crítico" : score >= thresholdAlto ? "Alto" : score >= thresholdMedio ? "Medio" : "Bajo";
  const classificationColor: OperationalRiskResult["classificationColor"] =
    classification === "Crítico" ? "red" : classification === "Alto" ? "orange" : classification === "Medio" ? "yellow" : "green";
  return { classification, classificationColor };
}

export async function computeOperationalRisk(userId: string, now: Date = new Date()): Promise<OperationalRiskResult> {
  const config = await getEffectiveAnalyticsConfig(now);
  const today = businessCalendarDay(now);
  const year = today.getUTCFullYear();
  const month = today.getUTCMonth() + 1;

  const [capacity, trends, consistency, cargaTiempo, openTasks, concentration] = await Promise.all([
    computeCapacityForecast(userId, now),
    computeTrends(userId, now),
    computeConsistency(userId, now),
    computeCargaTiempo(userId, now),
    prisma.task.findMany({ where: { assignedToId: userId, archivedMonth: null, status: { not: "COMPLETADA" } }, select: { endDate: true, status: true, priority: true } }),
    computeSeguimientoConcentration(userId, year, month),
  ]);

  const overdueAlta = openTasks.filter((t) => isTaskOverdue(t.endDate, t.status, now) && t.priority === "ALTA").length;

  const factors: RiskFactor[] = [];
  const push = (name: string, weightKey: AnalyticsConfigKey, rawPct: number, detail: string) => {
    const weight = config[weightKey];
    const points = Math.round(((rawPct / 100) * weight) * 100) / 100;
    factors.push({ name, weight, points, detail });
  };

  const sobrecargaPct = capacity.disponible < 0 ? Math.min(100, Math.abs(capacity.disponiblePct)) : 0;
  push("Sobrecarga proyectada", "riskWeightSobrecarga", sobrecargaPct, capacity.disponible < 0 ? `Sobrecarga proyectada de ${Math.abs(capacity.disponible)}h para lo que resta del mes` : "Sin sobrecarga proyectada");

  const criticasPct = Math.min(100, overdueAlta * 33);
  push("Tareas críticas vencidas", "riskWeightVencidasCriticas", criticasPct, `${overdueAlta} ${pluralize(overdueAlta, "tarea vencida", "tareas vencidas")} de prioridad Alta`);

  const cumpTrend = trends.cumplimiento.mesAnterior;
  const tendenciaPct = cumpTrend.available && cumpTrend.direction === "empeoro" ? Math.min(100, Math.abs(cumpTrend.absoluteDiff) * 3) : 0;
  push(
    "Tendencia negativa de cumplimiento",
    "riskWeightTendenciaNegativa",
    tendenciaPct,
    cumpTrend.available ? `Cumplimiento ${cumpTrend.direction === "empeoro" ? "cayó" : "estable/mejoró"} ${Math.abs(cumpTrend.absoluteDiff)}pp vs mes anterior` : "Sin historial suficiente"
  );

  const extraPct = Math.min(100, cargaTiempo.mensual.weekendHours * 10);
  push("Horas extras recurrentes", "riskWeightHorasExtra", extraPct, cargaTiempo.mensual.weekendHours > 0 ? `${cargaTiempo.mensual.weekendHours}h trabajadas en fin de semana este mes` : "Sin horas extra registradas");

  const bajaCapPct = capacity.disponiblePct < 10 ? (capacity.disponible < 0 ? 100 : Math.round((1 - capacity.disponiblePct / 10) * 100)) : 0;
  push("Baja capacidad futura (<10%)", "riskWeightBajaCapacidad", bajaCapPct, `${capacity.disponiblePct}% de capacidad disponible proyectada`);

  const variabilidadPct = consistency.available
    ? consistency.level === "muy-variable" ? 100 : consistency.level === "variable" ? 60 : consistency.level === "consistente" ? 20 : 0
    : 0;
  push("Variabilidad excesiva entre semanas", "riskWeightVariabilidad", variabilidadPct, consistency.available ? `Consistencia: ${consistency.label} (CV ${consistency.coefficientOfVariation}%)` : "Sin historial suficiente");

  push("Alta concentración en un solo tipo de actividad", "riskWeightConcentracion", concentration.pct, concentration.detail);

  const sinPlanPct = Math.min(100, capacity.tasksSinEstimar * 25);
  push("Muchas tareas sin planificación", "riskWeightSinPlanificacion", sinPlanPct, `${capacity.tasksSinEstimar} ${pluralize(capacity.tasksSinEstimar, "tarea sin horas estimadas", "tareas sin horas estimadas")}`);

  const score = Math.round(factors.reduce((s, f) => s + f.points, 0) * 100) / 100;
  const { classification, classificationColor } = classifyOperationalRisk(score, config.riskThresholdMedio, config.riskThresholdAlto, config.riskThresholdCritico);

  const trendVsPrevMonth = await getRiskTrendVsPrevMonth(userId, year, month, score);

  const suggestedActions: string[] = [];
  if (sobrecargaPct > 0) suggestedActions.push("Redistribuir tareas pendientes/en progreso para evitar la sobrecarga proyectada.");
  if (criticasPct > 0) suggestedActions.push("Priorizar de inmediato las tareas críticas (prioridad Alta) vencidas.");
  if (bajaCapPct > 50) suggestedActions.push("No asignar nuevas tareas hasta liberar capacidad.");
  if (variabilidadPct >= 60) suggestedActions.push("Revisar la carga semana a semana — el ritmo de trabajo es muy irregular.");
  if (suggestedActions.length === 0) suggestedActions.push("Sin acciones urgentes — mantener el seguimiento habitual.");

  const steps = factors.map((f) => `+${f.points} ${f.name} (${f.detail})`);
  steps.push(`Total: ${score} → Riesgo ${classification}`);

  const result: OperationalRiskResult = {
    score,
    classification,
    classificationColor,
    factors,
    trendVsPrevMonth,
    suggestedActions,
    engineVersion: ANALYTICS_ENGINE_VERSION,
    explain: { formula: "Σ (severidad_factor% × peso_factor%)", steps },
  };

  await auditCalculation(userId, "operational_risk", monthKey(year, month), { factors, weights: config }, result);
  return result;
}

// ── Calidad de los datos (§15) ──────────────────────────────────────────────────
//
// NO incluye "permisos no registrados detectados por ausencia de actividad":
// un colaborador puede estar en entrevistas, capacitaciones, visitas o
// reuniones sin registrar TaskActivity ese día — inferir un permiso a partir
// de la ausencia de registro generaría falsos positivos. Tampoco incluye
// "tareas sin prioridad": `Task.priority` es un enum obligatorio en el
// schema, ese estado no puede ocurrir.

export type DataQualityIssue = { key: string; label: string; count: number };
export type DataQualityResult = { pct: number; issues: DataQualityIssue[] };

export async function computeDataQuality(userIds: string[]): Promise<DataQualityResult> {
  if (userIds.length === 0) return { pct: 100, issues: [] };

  const [openTasks, allTasksForDates, seguimientoTasks, hasHoursConfig] = await Promise.all([
    prisma.task.findMany({ where: { assignedToId: { in: userIds }, status: { not: "COMPLETADA" }, archivedMonth: null }, select: { estimatedHours: true } }),
    prisma.task.findMany({ where: { assignedToId: { in: userIds }, archivedMonth: null }, select: { startDate: true, endDate: true } }),
    prisma.task.findMany({
      where: { assignedToId: { in: userIds }, type: "SEGUIMIENTO", archivedMonth: null },
      select: { id: true, activities: { select: { id: true }, take: 1 } },
    }),
    prisma.systemConfigHistory.count({ where: { key: CONFIG_KEY_HORAS_EFECTIVAS } }),
  ]);

  const tasksSinEstimar = openTasks.filter((t) => t.estimatedHours <= 0).length;
  const fechasInconsistentes = allTasksForDates.filter((t) => t.startDate.getTime() > t.endDate.getTime()).length;
  const seguimientoSinActividad = seguimientoTasks.filter((t) => t.activities.length === 0).length;
  const sinHorasConfig = hasHoursConfig === 0;

  const issues: DataQualityIssue[] = [];
  if (tasksSinEstimar > 0) issues.push({ key: "sin_estimar", label: "Tareas sin horas estimadas", count: tasksSinEstimar });
  if (fechasInconsistentes > 0) issues.push({ key: "fechas_inconsistentes", label: "Tareas con fecha de inicio posterior a la fecha fin", count: fechasInconsistentes });
  if (seguimientoSinActividad > 0) issues.push({ key: "seguimiento_sin_actividad", label: "Tareas de Seguimiento sin actividades registradas", count: seguimientoSinActividad });
  if (sinHorasConfig) issues.push({ key: "sin_horas_config", label: "Horas efectivas nunca configuradas explícitamente (usando el valor por defecto del sistema)", count: 1 });

  const pct = Math.max(0, Math.round(100 - (tasksSinEstimar * 3 + fechasInconsistentes * 10 + seguimientoSinActividad * 2 + (sinHorasConfig ? 10 : 0))));
  return { pct, issues };
}

// ── Motor de alertas automáticas (§1) ───────────────────────────────────────────

export type AlertSeverity = "red" | "orange" | "yellow" | "green";
export type EngineAlert = {
  rule: string;
  severity: AlertSeverity;
  message: string;
  suggestedAction: string;
  detectedAt: string;
};

const SEVERITY_RANK: Record<AlertSeverity, number> = { red: 4, orange: 3, yellow: 2, green: 1 };

function consecutiveDaysWithLabel(daily: DailyCargaPoint[], predicate: (d: DailyCargaPoint) => boolean): number {
  let count = 0;
  for (let i = daily.length - 1; i >= 0; i--) {
    if (predicate(daily[i])) count++;
    else break;
  }
  return count;
}

export async function computeAlerts(userId: string, now: Date = new Date()): Promise<EngineAlert[]> {
  const config = await getEffectiveAnalyticsConfig(now);
  const nowIso = now.toISOString();
  const alerts: EngineAlert[] = [];

  const [capacity, cargaHistory, trends, monthly, weekly, openTasks] = await Promise.all([
    computeCapacityForecast(userId, now),
    computeCargaHistory(userId, now),
    computeTrends(userId, now),
    computeMonthlyHistory(userId, 4, now),
    computeWeeklyHistory(userId, 4, now),
    prisma.task.findMany({ where: { assignedToId: userId, archivedMonth: null, status: { not: "COMPLETADA" } }, select: { endDate: true, status: true, priority: true } }),
  ]);

  // 1. Sobrecarga proyectada / capacidad crítica
  if (capacity.estado === "sobrecarga") {
    alerts.push({
      rule: "sobrecarga_proyectada",
      severity: "red",
      message: `Sobrecarga proyectada para lo que resta del mes: ${capacity.disponible}h`,
      suggestedAction: "Redistribuir tareas pendientes/en progreso antes de asignar trabajo nuevo.",
      detectedAt: nowIso,
    });
  } else if (capacity.estado === "no-asignar") {
    alerts.push({
      rule: "capacidad_critica",
      severity: "orange",
      message: `Capacidad disponible proyectada del ${capacity.disponiblePct}%, por debajo del mínimo recomendado`,
      suggestedAction: "No asignar nuevas tareas hasta liberar carga.",
      detectedAt: nowIso,
    });
  }

  // 2. Subutilización prolongada
  const subutilizacionDays = consecutiveDaysWithLabel(cargaHistory.daily, (d) => d.kind === "normal" && d.label === "Subutilización");
  if (subutilizacionDays >= config.alertConsecutiveOverloadDays) {
    alerts.push({
      rule: "subutilizacion_prolongada",
      severity: "yellow",
      message: `${subutilizacionDays} días laborables consecutivos en Subutilización`,
      suggestedAction: "Revisar si hay carga disponible para asignar o si faltan tareas por planificar.",
      detectedAt: nowIso,
    });
  }

  // 3. Tareas vencidas por encima del umbral configurado
  const overdue = openTasks.filter((t) => isTaskOverdue(t.endDate, t.status, now));
  const overdueAlta = overdue.filter((t) => t.priority === "ALTA").length;
  if (overdue.length >= config.alertOverdueTaskThreshold * 2) {
    alerts.push({
      rule: "tareas_vencidas",
      severity: "red",
      message: `${overdue.length} tareas vencidas (umbral configurado: ${config.alertOverdueTaskThreshold})${overdueAlta > 0 ? `, ${overdueAlta} de prioridad Alta` : ""}`,
      suggestedAction: "Revisar y reprogramar o completar las tareas vencidas de inmediato.",
      detectedAt: nowIso,
    });
  } else if (overdue.length >= config.alertOverdueTaskThreshold) {
    alerts.push({
      rule: "tareas_vencidas",
      severity: "orange",
      message: `${overdue.length} tareas vencidas (umbral configurado: ${config.alertOverdueTaskThreshold})`,
      suggestedAction: "Revisar esta semana las tareas vencidas y priorizar su cierre.",
      detectedAt: nowIso,
    });
  }

  // 4. Disminución del cumplimiento respecto al mes anterior
  const cumpTrend = trends.cumplimiento.mesAnterior;
  if (cumpTrend.available && cumpTrend.direction === "empeoro") {
    const severity: AlertSeverity = Math.abs(cumpTrend.absoluteDiff) >= 20 ? "red" : Math.abs(cumpTrend.absoluteDiff) >= 10 ? "orange" : "yellow";
    alerts.push({
      rule: "cumplimiento_bajo",
      severity,
      message: `Cumplimiento cayó ${Math.abs(cumpTrend.absoluteDiff)}pp respecto al mes anterior (${cumpTrend.compared}% → ${cumpTrend.current}%)`,
      suggestedAction: "Revisar con el colaborador las causas de la caída y ajustar prioridades.",
      detectedAt: nowIso,
    });
  }

  // 5. Incremento inusual de horas extra (fin de semana)
  const currentWeekend = monthly[monthly.length - 1]?.weekendHours ?? 0;
  const priorWeekendAvg = avgOf(monthly.slice(0, -1).map((m) => m.weekendHours));
  if (currentWeekend > 0 && priorWeekendAvg !== null && currentWeekend > priorWeekendAvg * 1.5 + 1) {
    alerts.push({
      rule: "horas_extra_inusuales",
      severity: "yellow",
      message: `${currentWeekend}h trabajadas en fin de semana este mes, por encima del promedio histórico (${Math.round(priorWeekendAvg * 10) / 10}h)`,
      suggestedAction: "Confirmar si el trabajo en fin de semana es puntual o indica sobrecarga sostenida.",
      detectedAt: nowIso,
    });
  }

  // 6. Días consecutivos sobre el rango óptimo
  const overloadDays = consecutiveDaysWithLabel(cargaHistory.daily, (d) => d.kind === "normal" && (d.label === "Carga elevada" || d.label === "Sobrecarga"));
  if (overloadDays >= config.alertConsecutiveOverloadDays) {
    alerts.push({
      rule: "dias_consecutivos_sobrecarga",
      severity: overloadDays >= config.alertConsecutiveOverloadDays * 2 ? "red" : "orange",
      message: `${overloadDays} días laborables consecutivos por encima del rango óptimo`,
      suggestedAction: "Evaluar redistribución de tareas para evitar desgaste.",
      detectedAt: nowIso,
    });
  }

  // 7. Caída importante en registros diarios (señal sobre el DATO, no una inferencia de causa)
  const lastWeek = weekly[weekly.length - 1];
  const priorWeeksAvgReg = avgOf(
    weekly.slice(0, -1).map((w) => (w.businessDays > 0 ? w.daysWithRegistration / w.businessDays : null)).filter((v): v is number => v !== null)
  );
  if (lastWeek && lastWeek.businessDays > 0 && priorWeeksAvgReg !== null && priorWeeksAvgReg > 0.3) {
    const lastRate = lastWeek.daysWithRegistration / lastWeek.businessDays;
    if (lastRate < priorWeeksAvgReg * 0.5) {
      alerts.push({
        rule: "caida_registros",
        severity: "yellow",
        message: `Registros diarios de la última semana completa: ${lastWeek.daysWithRegistration}/${lastWeek.businessDays} días, por debajo del promedio reciente`,
        suggestedAction: "Confirmar con el colaborador si hay actividades sin registrar o dificultades para hacerlo.",
        detectedAt: nowIso,
      });
    }
  }

  // 8. Crecimiento excesivo de actividades de seguimiento
  const currentSeg = monthly[monthly.length - 1]?.seguimientoCount ?? 0;
  const priorSegAvg = avgOf(monthly.slice(0, -1).map((m) => m.seguimientoCount));
  if (currentSeg > 0 && priorSegAvg !== null && priorSegAvg > 0 && currentSeg > priorSegAvg * 1.5) {
    alerts.push({
      rule: "crecimiento_seguimiento",
      severity: "yellow",
      message: `${currentSeg} actividades de seguimiento este mes, ${Math.round(((currentSeg - priorSegAvg) / priorSegAvg) * 100)}% por encima del promedio histórico`,
      suggestedAction: "Revisar si el crecimiento de consultas requiere apoyo adicional.",
      detectedAt: nowIso,
    });
  }

  const sorted = alerts.sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);

  const today = businessCalendarDay(now);
  await auditCalculation(userId, "alerts", monthKey(today.getUTCFullYear(), today.getUTCMonth() + 1), {}, { alerts: sorted.map((a) => a.rule) });

  return sorted;
}

// ── Historial de alertas resueltas (§S2-F) ──────────────────────────────────
// Reutiliza AnalyticsAuditLog (ya existe, sin cambios de esquema) — una alerta
// "resuelta" es una regla que aparecía en un cálculo anterior de computeAlerts
// y ya no aparece en el más reciente.

export type ResolvedAlert = { rule: string; message: string; daysAgo: number };

export async function getResolvedAlertsHistory(userId: string, currentAlerts: EngineAlert[], now: Date = new Date()): Promise<ResolvedAlert[]> {
  const activeRules = new Set(currentAlerts.map((a) => a.rule));
  const RULE_LABEL: Record<string, string> = {
    sobrecarga_proyectada: "Sobrecarga proyectada",
    capacidad_critica: "Capacidad crítica",
    subutilizacion_prolongada: "Subutilización prolongada",
    tareas_vencidas: "Tareas vencidas",
    cumplimiento_bajo: "Cumplimiento bajo",
    horas_extra_inusuales: "Horas extra inusuales",
    dias_consecutivos_sobrecarga: "Días consecutivos de sobrecarga",
    caida_registros: "Caída de registros diarios",
    crecimiento_seguimiento: "Crecimiento de actividades de seguimiento",
  };

  let entries: Array<{ createdAt: Date; result: unknown }> = [];
  try {
    entries = await prisma.analyticsAuditLog.findMany({
      where: { userId, kind: "alerts" },
      orderBy: { createdAt: "desc" },
      take: 30,
      select: { createdAt: true, result: true },
    });
  } catch {
    return [];
  }

  const lastSeenActive = new Map<string, Date>();
  for (const entry of entries) {
    const rules = entry.result && typeof entry.result === "object" ? (entry.result as { alerts?: unknown }).alerts : undefined;
    if (!Array.isArray(rules)) continue;
    for (const rule of rules) {
      if (typeof rule !== "string" || activeRules.has(rule) || lastSeenActive.has(rule)) continue;
      lastSeenActive.set(rule, entry.createdAt);
    }
  }

  return [...lastSeenActive.entries()]
    .map(([rule, lastActiveAt]) => ({
      rule,
      message: RULE_LABEL[rule] ?? rule,
      daysAgo: Math.max(0, Math.floor((now.getTime() - lastActiveAt.getTime()) / 86400000)),
    }))
    .sort((a, b) => a.daysAgo - b.daysAgo)
    .slice(0, 3);
}

// ── Motor de recomendaciones deterministas con impacto (§S3-A) ──────────────
//
// Sin IA — cruza quién tiene exceso de horas comprometidas (capacityForecast
// .disponible < 0) con quién tiene capacidad disponible (.disponible > 0) y
// sugiere una redistribución concreta. El impacto esperado (pts de Score,
// pts de Riesgo) se calcula recomponiendo el factor "Capacidad futura" del
// Score de Salud y el factor "Sobrecarga proyectada" del Riesgo Operativo con
// las MISMAS fórmulas del motor (capacityToScore/classifyCapacity), evaluadas
// antes/después del movimiento hipotético — no son números inventados, pero
// tampoco vuelven a correr el pipeline completo por persona (sería costoso
// para una lista de sugerencias); solo el/los factor(es) que cambian.

export type TeamRecommendation = {
  priority: "alta" | "media";
  priorityColor: "red" | "yellow";
  text: string;
  impactScorePts: number;
  impactRiskPts: number;
};

export async function computeTeamRecommendations(
  members: Array<{ id: string; name: string }>,
  now: Date = new Date()
): Promise<TeamRecommendation[]> {
  if (members.length < 2) return [];
  const config = await getEffectiveAnalyticsConfig(now);
  const capacityMap = await computeTeamCapacityForecast(members.map((m) => m.id), now);
  const nameOf = new Map(members.map((m) => [m.id, m.name]));

  const overloaded = [...capacityMap.entries()]
    .filter(([, c]) => c.disponible < 0)
    .map(([id, c]) => ({ id, name: nameOf.get(id)!, excess: Math.round(-c.disponible * 100) / 100, capacity: c }))
    .sort((a, b) => b.excess - a.excess);

  const availablePool = [...capacityMap.entries()]
    .filter(([, c]) => c.disponible > 0)
    .map(([id, c]) => ({ id, name: nameOf.get(id)!, free: c.disponible }))
    .sort((a, b) => b.free - a.free);

  const recommendations: TeamRecommendation[] = [];

  for (const person of overloaded.slice(0, 5)) {
    let remaining = person.excess;
    const allocations: Array<{ name: string; hours: number }> = [];
    for (const avail of availablePool) {
      if (remaining <= 0.01) break;
      const take = Math.round(Math.min(remaining, avail.free) * 100) / 100;
      if (take <= 0) continue;
      allocations.push({ name: avail.name, hours: take });
      avail.free = Math.round((avail.free - take) * 100) / 100;
      remaining = Math.round((remaining - take) * 100) / 100;
    }
    if (allocations.length === 0) continue;
    const movedTotal = Math.round(allocations.reduce((s, a) => s + a.hours, 0) * 100) / 100;

    const before = person.capacity;
    const newDisponible = Math.round((before.disponible + movedTotal) * 100) / 100;
    const newDisponiblePct = before.baseFuturaTotal > 0 ? Math.round((newDisponible / before.baseFuturaTotal) * 100) : 0;
    const afterEstado = classifyCapacity(newDisponible, before.baseFuturaTotal, newDisponiblePct).estado;

    const beforeCapScore = capacityToScore(before.estado, before.disponiblePct);
    const afterCapScore = capacityToScore(afterEstado, newDisponiblePct);
    const impactScorePts = Math.round((((afterCapScore - beforeCapScore) * config.healthWeightCapacidad) / 100) * 100) / 100;

    const beforeSobrecargaPct = before.disponible < 0 ? Math.min(100, Math.abs(before.disponiblePct)) : 0;
    const afterSobrecargaPct = newDisponible < 0 ? Math.min(100, Math.abs(newDisponiblePct)) : 0;
    const impactRiskPts = Math.round((((afterSobrecargaPct - beforeSobrecargaPct) * config.riskWeightSobrecarga) / 100) * 100) / 100;

    const priority: "alta" | "media" = person.excess >= 10 || before.disponiblePct <= -30 ? "alta" : "media";
    const allocationText = allocations.map((a) => `${a.name} (${a.hours}h disp.)`).join(" y ");

    recommendations.push({
      priority,
      priorityColor: priority === "alta" ? "red" : "yellow",
      text: `Redistribuir ${movedTotal}h de ${person.name} entre ${allocationText}`,
      impactScorePts,
      impactRiskPts,
    });
  }

  return recommendations.sort((a, b) => (a.priority === b.priority ? 0 : a.priority === "alta" ? -1 : 1));
}

// ── Validación de consistencia entre KPIs (§S3-C) ────────────────────────────
// Corre ANTES de responder el bundle de Analytics. Si algo falla: se registra
// en AnalyticsAuditLog con timestamp y detalle (kind: "validation_failure") —
// el endpoint decide, según el rol del viewer, si expone `validationWarnings`
// (solo Administrador) o lo oculta por completo al usuario final.

export type ValidationFailure = { rule: string; detail: string };

export async function validateAnalyticsConsistency(
  userId: string,
  inputs: {
    healthScore: HealthScoreResult;
    performanceScore: PerformanceScoreResult;
    prediction: Prediction;
    capacity: { disponible: number; baseFuturaTotal: number; comprometidoFuturo: number };
  },
  now: Date = new Date()
): Promise<ValidationFailure[]> {
  const failures: ValidationFailure[] = [];

  // Capacidad disponible ≤ base restante del período.
  if (inputs.capacity.disponible > inputs.capacity.baseFuturaTotal + 0.01) {
    failures.push({ rule: "capacidad_excede_base", detail: `Disponible (${inputs.capacity.disponible}h) > base futura (${inputs.capacity.baseFuturaTotal}h)` });
  }
  // Horas comprometidas ≥ 0.
  if (inputs.capacity.comprometidoFuturo < 0) {
    failures.push({ rule: "comprometido_negativo", detail: `Comprometido futuro negativo (${inputs.capacity.comprometidoFuturo}h)` });
  }
  // Score (Legacy y Performance) = suma ponderada exacta de sus factores.
  const sumHealthFactors = Math.round(inputs.healthScore.factors.reduce((s, f) => s + f.points, 0) * 100) / 100;
  if (Math.abs(sumHealthFactors - inputs.healthScore.score) > 0.5) {
    failures.push({ rule: "score_no_coincide", detail: `Suma de factores del Score Legacy (${sumHealthFactors}) ≠ score (${inputs.healthScore.score})` });
  }
  const sumPerfFactors = Math.round(inputs.performanceScore.factors.reduce((s, f) => s + f.points, 0) * 100) / 100;
  if (Math.abs(sumPerfFactors - inputs.performanceScore.score) > 0.5) {
    failures.push({ rule: "performance_score_no_coincide", detail: `Suma de factores del Performance Score (${sumPerfFactors}) ≠ score (${inputs.performanceScore.score})` });
  }
  // Performance Score nunca excede 100 ni es negativo (NormalizationEngine ya acota, esto es un doble check).
  if (inputs.performanceScore.score > 100 || inputs.performanceScore.score < 0) {
    failures.push({ rule: "performance_score_fuera_de_rango", detail: `Performance Score ${inputs.performanceScore.score} fuera de [0,100]` });
  }
  // Predicción siempre con nivel de confianza y cantidad de datos cuando está disponible.
  if (inputs.prediction.available && (!inputs.prediction.confidence || inputs.prediction.weeksOfData <= 0)) {
    failures.push({ rule: "prediccion_incompleta", detail: "Predicción disponible sin confianza o sin semanas de datos" });
  }
  // Ningún valor calculado es NaN/Infinity.
  const numericValues = [
    inputs.capacity.disponible,
    inputs.capacity.baseFuturaTotal,
    inputs.capacity.comprometidoFuturo,
    inputs.healthScore.score,
    inputs.performanceScore.score,
    ...(inputs.prediction.available ? [inputs.prediction.confidencePct, inputs.prediction.cumplimientoEstimadoCierreMes] : []),
  ];
  if (numericValues.some((n) => !Number.isFinite(n))) {
    failures.push({ rule: "valor_no_finito", detail: "Se detectó NaN o Infinity en un valor calculado" });
  }

  diagnostics.validationsRun++;
  if (failures.length > 0) {
    diagnostics.validationsFailed++;
    const today = businessCalendarDay(now);
    await auditCalculation(
      userId,
      "validation_failure",
      monthKey(today.getUTCFullYear(), today.getUTCMonth() + 1),
      {},
      { failures, detectedAt: now.toISOString() }
    );
  }

  return failures;
}

/** Checks 1/2/6 de §S3-C — específicos de cumplimiento general vs. por prioridad (ver Sprint 1 § S1-A). */
export async function validateCumplimientoConsistency(
  userId: string,
  cumplimientoGeneral: { total: number; pct: number },
  priorityCompliance: Array<{ priority: string; total: number; pct: number }>,
  now: Date = new Date()
): Promise<ValidationFailure[]> {
  const failures: ValidationFailure[] = [];

  const sumPriorityTotals = priorityCompliance.reduce((s, p) => s + p.total, 0);
  if (sumPriorityTotals !== cumplimientoGeneral.total) {
    failures.push({ rule: "suma_prioridad_total", detail: `Suma por prioridad (${sumPriorityTotals}) ≠ total (${cumplimientoGeneral.total})` });
  }
  if (sumPriorityTotals > 0) {
    const weighted = priorityCompliance.reduce((s, p) => s + p.pct * p.total, 0) / sumPriorityTotals;
    if (Math.abs(weighted - cumplimientoGeneral.pct) > 15) {
      failures.push({ rule: "cumplimiento_incoherente", detail: `Ponderado por prioridad (${Math.round(weighted)}%) muy distinto del general (${cumplimientoGeneral.pct}%)` });
    }
  }
  if (cumplimientoGeneral.pct > 100) failures.push({ rule: "cumplimiento_excede_100", detail: `Cumplimiento general ${cumplimientoGeneral.pct}%` });
  for (const p of priorityCompliance) {
    if (p.pct > 100) failures.push({ rule: "cumplimiento_prioridad_excede_100", detail: `${p.priority}: ${p.pct}%` });
  }

  diagnostics.validationsRun++;
  if (failures.length > 0) {
    diagnostics.validationsFailed++;
    const today = businessCalendarDay(now);
    await auditCalculation(
      userId,
      "validation_failure",
      monthKey(today.getUTCFullYear(), today.getUTCMonth() + 1),
      {},
      { failures, detectedAt: now.toISOString() }
    );
  }

  return failures;
}

// ── Pipeline único del motor (§Sprint 4 S4-F) ────────────────────────────────
// Todo cálculo del bundle individual de Analytics sigue exactamente este
// orden — no alterar:
//   1. Leer datos       → cada compute* hace sus propias consultas
//   2. Validar calidad  → computeDataQuality primero
//   3. Calcular KPIs    → prioridad alta primero (§S4-G): Salud/Carga/
//                         Cumplimiento/Capacidad ya viven dentro de
//                         computeHealthScore; luego prioridad media en
//                         paralelo (consistencia, tendencias, predicción)
//   4. Validar consistencia matemática → validateAnalyticsConsistency
//   5. Detectar anomalías              → detectAnomalies
//   6. Generar recomendaciones         → computeAlerts + su historial resuelto
//   7. Guardar en caché  → lo hace el caller envolviendo esta función en cached()
//   8. Renderizar        → responsabilidad del endpoint/componente, no del motor
export type AnalyticsPipelineResult = {
  dataQuality: DataQualityResult;
  healthScore: HealthScoreResult;
  performanceScore: PerformanceScoreResult;
  consistency: ConsistencyResult;
  trends: KpiTrends;
  prediction: Prediction;
  anomalies: AnomalyResult;
  alerts: EngineAlert[];
  alertsHistory: ResolvedAlert[];
  validationFailures: ValidationFailure[];
};

export async function runAnalyticsPipeline(userId: string, now: Date = new Date()): Promise<AnalyticsPipelineResult> {
  // 1+2. Leer datos y validar su calidad ANTES de calcular ningún KPI.
  const dataQuality = await computeDataQuality([userId]);

  // 3. Calcular KPIs — Consistencia se calcula UNA vez y se reutiliza en Salud
  // (Legacy) y Performance Score (antes se recalculaba de forma independiente
  // en cada uno — ver nota de rendimiento en computeHealthScore/
  // computePerformanceScore). Prioridad alta (Salud, que compone Carga/
  // Cumplimiento/Capacidad) primero; prioridad media en paralelo a continuación
  // (Performance Score incluida, §Sprint 5 S5-B/S5-G).
  const consistency = await computeConsistency(userId, now);
  const healthScore = await computeHealthScore(userId, now, consistency);
  const [performanceScore, trends, prediction] = await Promise.all([
    computePerformanceScore(userId, now, consistency),
    computeTrends(userId, now),
    computePrediction(userId, now),
  ]);

  // 4. Validar consistencia matemática entre los KPIs recién calculados.
  const capacity = await computeCapacityForecast(userId, now);
  const validationFailures = await validateAnalyticsConsistency(userId, { healthScore, performanceScore, prediction, capacity }, now);

  // 5. Detectar anomalías respecto al historial personal.
  const anomalies = await detectAnomalies(userId, now);

  // 6. Generar recomendaciones (a nivel individual: alertas automáticas + su historial resuelto).
  const alerts = await computeAlerts(userId, now);
  const alertsHistory = alerts.length === 0 ? await getResolvedAlertsHistory(userId, alerts, now) : [];

  return { dataQuality, healthScore, performanceScore, consistency, trends, prediction, anomalies, alerts, alertsHistory, validationFailures };
}

// ── Benchmarks (§Sprint 5 S5-H) ──────────────────────────────────────────────
// Compara el Performance Score y el Operational Risk de una persona contra
// sus pares del MISMO rol (peers) — promedio y percentil. El permiso de
// visibilidad lo aplica el caller (endpoint), este cálculo asume que ya se
// verificó que el viewer puede ver al target (§Sprint 5 "toda comparación
// debe respetar permisos por rol").

export type BenchmarkMetric =
  | { available: false; reason: string }
  | { available: true; value: number; teamAverage: number; percentile: number; topPct: number; peerCount: number };

export type BenchmarkResult = { performance: BenchmarkMetric; operationalRisk: BenchmarkMetric };

/** % de pares con score IGUAL o PEOR que `value` (según `higherIsBetter`) — percentil de "qué tan bien vas" respecto al grupo. */
function computePercentile(value: number, peerValues: number[], higherIsBetter: boolean): number {
  if (peerValues.length === 0) return 50;
  const notBetter = peerValues.filter((v) => (higherIsBetter ? v <= value : v >= value)).length;
  return Math.round((notBetter / peerValues.length) * 100);
}

export async function computeBenchmark(userId: string, role: Role, now: Date = new Date()): Promise<BenchmarkResult> {
  const config = await getEffectiveAnalyticsConfig(now);
  const peers = await prisma.user.findMany({ where: { role, id: { not: userId } }, select: { id: true } });

  const unavailable: BenchmarkMetric = { available: false, reason: "Sin compañeros del mismo rol para comparar" };
  if (peers.length === 0) return { performance: unavailable, operationalRisk: unavailable };

  const [myPerf, myRisk, peerPerf, peerRisk] = await Promise.all([
    cached(`perf-bench:${userId}`, config.cacheTtlMinutes, () => computePerformanceScore(userId, now)).then((r) => r.value.score),
    cached(`risk-bench:${userId}`, config.cacheTtlMinutes, () => computeOperationalRisk(userId, now)).then((r) => r.value.score),
    Promise.all(peers.map((p) => cached(`perf-bench:${p.id}`, config.cacheTtlMinutes, () => computePerformanceScore(p.id, now)).then((r) => r.value.score))),
    Promise.all(peers.map((p) => cached(`risk-bench:${p.id}`, config.cacheTtlMinutes, () => computeOperationalRisk(p.id, now)).then((r) => r.value.score))),
  ]);

  const avg = (nums: number[]) => Math.round((nums.reduce((s, n) => s + n, 0) / nums.length) * 10) / 10;

  const perfPercentile = computePercentile(myPerf, peerPerf, true);
  const riskPercentile = computePercentile(myRisk, peerRisk, false);

  return {
    performance: {
      available: true,
      value: myPerf,
      teamAverage: avg(peerPerf),
      percentile: perfPercentile,
      topPct: 100 - perfPercentile,
      peerCount: peers.length,
    },
    operationalRisk: {
      available: true,
      value: myRisk,
      teamAverage: avg(peerRisk),
      percentile: riskPercentile,
      topPct: 100 - riskPercentile,
      peerCount: peers.length,
    },
  };
}
