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
import { computeCapacityForecast } from "@/lib/capacityForecast";
import { getHolidaySet } from "@/lib/holidays";
import { isTaskOverdue } from "@/lib/utils";
import {
  getEffectiveAnalyticsConfig,
  getEffectiveHorasEfectivas,
  CONFIG_KEY_HORAS_EFECTIVAS,
  type AnalyticsConfigKey,
  PREDICTION_MAX_DAYS,
} from "@/lib/systemConfig";
import type { DailyCargaPoint } from "@/components/kpis/types";

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
export const ANALYTICS_ENGINE_VERSION = "1.0.0";

export { PREDICTION_MAX_DAYS };

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

export async function cached<T>(key: string, ttlMinutes: number, compute: () => Promise<T>): Promise<{ value: T; computedAt: number }> {
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return { value: hit.value as T, computedAt: hit.computedAt };
  const value = await compute();
  const computedAt = Date.now();
  cache.set(key, { value, expiresAt: computedAt + ttlMinutes * 60000, computedAt });
  return { value, computedAt };
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

async function auditCalculation(userId: string, kind: string, period: string, inputs: object, result: object): Promise<void> {
  try {
    await prisma.analyticsAuditLog.create({
      data: { userId, kind, period, inputs, result, engineVersion: ANALYTICS_ENGINE_VERSION },
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
  | { available: true; level: ConsistencyLevel; label: string; coefficientOfVariation: number; weeksAnalyzed: number };

export async function computeConsistency(userId: string, now: Date = new Date()): Promise<ConsistencyResult> {
  const weekly = await computeWeeklyHistory(userId, 6, now);
  const withData = weekly.filter((w) => w.businessDays > 0);
  if (withData.length < 2) return { available: false, reason: "Sin historial suficiente" };

  const hoursCv = stddev(withData.map((w) => w.realHours)).cv;
  const tasksCv = stddev(withData.map((w) => w.completedTasks)).cv;
  const complianceCv = stddev(withData.map((w) => w.completedPct)).cv;
  const avgCv = (hoursCv + tasksCv + complianceCv) / 3;

  let level: ConsistencyLevel;
  let label: string;
  if (avgCv < 10) { level = "muy-consistente"; label = "Muy consistente"; }
  else if (avgCv < 20) { level = "consistente"; label = "Consistente"; }
  else if (avgCv < 35) { level = "variable"; label = "Variable"; }
  else { level = "muy-variable"; label = "Muy variable"; }

  return { available: true, level, label, coefficientOfVariation: Math.round(avgCv * 10) / 10, weeksAnalyzed: withData.length };
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
      weeksOfData: number;
      cargaProximaSemanaHoras: number;
      cumplimientoEstimadoCierreMes: number;
      horasParaRangoOptimo: number;
      maxProjectionDays: number;
    };

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

  const [cargaTiempo, cumplimientoEstimadoCierreMes] = await Promise.all([
    computeCargaTiempo(userId, now),
    computeMonthlyCompliancePace(userId, now),
  ]);

  const horasParaRangoOptimo =
    cargaTiempo.mensual.label === "Subutilización"
      ? Math.max(0, Math.round((cargaTiempo.mensual.rangeMin - cargaTiempo.mensual.realHours) * 100) / 100)
      : 0;

  return {
    available: true,
    confidence,
    weeksOfData: n,
    cargaProximaSemanaHoras,
    cumplimientoEstimadoCierreMes,
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
function cargaHealthScore(realHours: number, baseHours: number, limitHighHours: number, limitOverloadHours: number): number {
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

function capacityToScore(estado: string, disponiblePct: number): number {
  if (estado === "alta") return 100;
  if (estado === "limitada") return 70;
  if (estado === "sin-planificacion") return 70;
  if (disponiblePct < 0) return 0;
  return 40;
}

export async function computeHealthScore(userId: string, now: Date = new Date()): Promise<HealthScoreResult> {
  const config = await getEffectiveAnalyticsConfig(now);
  const today = businessCalendarDay(now);
  const year = today.getUTCFullYear();
  const month = today.getUTCMonth() + 1;
  const { start, end } = monthBounds(year, month);

  const [tasks, cargaTiempo, capacity, consistency, biz] = await Promise.all([
    prisma.task.findMany({ where: { assignedToId: userId, endDate: { gte: start, lte: end } }, select: { status: true, priority: true, endDate: true } }),
    computeCargaTiempo(userId, now),
    computeCapacityForecast(userId, now),
    computeConsistency(userId, now),
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
  const classification: OperationalRiskResult["classification"] =
    score >= config.riskThresholdCritico ? "Crítico" : score >= config.riskThresholdAlto ? "Alto" : score >= config.riskThresholdMedio ? "Medio" : "Bajo";
  const classificationColor: OperationalRiskResult["classificationColor"] =
    classification === "Crítico" ? "red" : classification === "Alto" ? "orange" : classification === "Medio" ? "yellow" : "green";

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

  return alerts.sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);
}
