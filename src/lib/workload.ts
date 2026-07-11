import "server-only";
import { prisma } from "@/lib/prisma";
import { businessCalendarDay, businessDayRealRange } from "@/lib/businessTime";
import { getEffectiveHorasEfectivas, getEffectiveWorkloadTolerance } from "@/lib/systemConfig";
import type {
  WorkloadColor,
  WorkloadMetric,
  WorkloadLabel,
  CargaTiempo,
  DailyCargaPoint,
  WeeklyCargaPoint,
} from "@/components/kpis/types";

export type { WorkloadMetric, CargaTiempo, DailyCargaPoint, WeeklyCargaPoint };

const MONTH_NAMES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

const DAY_ABBR = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

function isBusinessDay(d: Date): boolean {
  const dow = d.getUTCDay();
  return dow !== 0 && dow !== 6;
}

function countBusinessDays(start: Date, end: Date): number {
  let count = 0;
  for (let t = start.getTime(); t <= end.getTime(); t += 86400000) {
    if (isBusinessDay(new Date(t))) count++;
  }
  return count;
}

function firstBusinessDay(start: Date, end: Date): Date | null {
  for (let t = start.getTime(); t <= end.getTime(); t += 86400000) {
    const d = new Date(t);
    if (isBusinessDay(d)) return d;
  }
  return null;
}

function lastBusinessDay(start: Date, end: Date): Date | null {
  for (let t = end.getTime(); t >= start.getTime(); t -= 86400000) {
    const d = new Date(t);
    if (isBusinessDay(d)) return d;
  }
  return null;
}

function formatShortDate(d: Date): string {
  const day = String(d.getUTCDate()).padStart(2, "0");
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${day}/${month}`;
}

function formatMonthLabel(d: Date): string {
  return `${MONTH_NAMES[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export type WorkloadRange = {
  /** Límite inferior de Subutilización (= base - tolerancia). */
  min: number;
  /** Límite superior de la zona Óptima ("límite superior óptimo") = base + tolerancia. */
  max: number;
  /** Límite superior de Carga elevada = max + elevatedBandHours. */
  elevatedMax: number;
  color: WorkloadColor;
  label: WorkloadLabel;
};

/**
 * Semáforo de carga laboral por RANGO (no un punto exacto de 100%), 5 zonas:
 *   🔴 Subutilización : realHours <  base - tolerancia
 *   🟡 Moderado       : base - tolerancia <= realHours < base
 *   🟢 Óptimo         : base <= realHours <= base + tolerancia
 *   🟠 Carga elevada  : base + tolerancia <  realHours <= base + tolerancia + elevatedBandHours
 *   🔴 Sobrecarga     : realHours > base + tolerancia + elevatedBandHours
 *
 * `toleranceHours` y `elevatedBandHours` ya vienen escalados por quien llama
 * (p. ej. tolerancia diaria × días hábiles del período), para que el rango
 * crezca proporcionalmente en vistas semanales/mensuales en vez de usar una
 * tolerancia absoluta fija sin sentido a esa escala.
 */
export function computeWorkloadRange(
  realHours: number,
  baseHours: number,
  toleranceHours: number,
  elevatedBandHours: number,
): WorkloadRange {
  if (baseHours <= 0) {
    return realHours > 0
      ? { min: 0, max: 0, elevatedMax: 0, color: "orange", label: "Carga elevada" }
      : { min: 0, max: 0, elevatedMax: 0, color: "green", label: "Óptimo" };
  }
  const min = Math.round((baseHours - toleranceHours) * 100) / 100;
  const max = Math.round((baseHours + toleranceHours) * 100) / 100;
  const elevatedMax = Math.round((max + elevatedBandHours) * 100) / 100;
  if (realHours < min) return { min, max, elevatedMax, color: "red", label: "Subutilización" };
  if (realHours < baseHours) return { min, max, elevatedMax, color: "yellow", label: "Moderado" };
  if (realHours <= max) return { min, max, elevatedMax, color: "green", label: "Óptimo" };
  if (realHours <= elevatedMax) return { min, max, elevatedMax, color: "orange", label: "Carga elevada" };
  return { min, max, elevatedMax, color: "red", label: "Sobrecarga" };
}

/**
 * Porcentaje de carga con techo en 100% dentro del rango óptimo: el % sube
 * linealmente hasta llegar a la base (100%), se mantiene en 100% mientras
 * las horas reales queden dentro de la zona Óptima (hasta `optimalMax` =
 * base + tolerancia), y solo vuelve a subir por encima de 100% al superar
 * `optimalMax`. Así 7h de 6.5h base no marca 108% si 7h sigue siendo
 * "óptimo" — el % debe reflejar el semáforo, no solo la razón cruda.
 */
export function computeWorkloadPct(realHours: number, baseHours: number, optimalMax: number): number {
  if (baseHours <= 0) return 0;
  if (realHours <= baseHours) return Math.round((realHours / baseHours) * 100);
  if (realHours <= optimalMax) return 100;
  return Math.round((realHours / baseHours) * 100);
}

function utcDayStart(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function utcWeekStart(d: Date) {
  const day = utcDayStart(d);
  const dow = day.getUTCDay(); // 0=Sun..6=Sat
  const diffToMonday = dow === 0 ? -6 : 1 - dow;
  return new Date(day.getTime() + diffToMonday * 86400000);
}
function utcWeekEnd(d: Date) {
  return new Date(utcWeekStart(d).getTime() + 7 * 86400000 - 1);
}
function utcMonthStart(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}
function utcMonthEnd(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) - 1);
}

/**
 * The dynamic business-day base (días lunes-viernes × 8h) for an explicit
 * calendar month — for historical/report contexts where the month is given
 * directly (no "now" ambiguity, so no business-timezone shift is needed).
 */
export async function monthlyBusinessBase(year: number, month: number): Promise<{
  start: Date;
  end: Date;
  businessDays: number;
  baseHours: number;
  hoursPerDay: number;
  tolerancePerDay: number;
  toleranceHours: number;
  elevatedBandHours: number;
}> {
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 1) - 1);
  const businessDays = countBusinessDays(start, end);
  // El valor vigente al INICIO del mes es el que rigió ese período — así cambios
  // de configuración posteriores no alteran KPIs de meses ya cerrados.
  const [hoursPerDay, tolerancePerDay] = await Promise.all([
    getEffectiveHorasEfectivas(start),
    getEffectiveWorkloadTolerance(start),
  ]);
  return {
    start,
    end,
    businessDays,
    baseHours: businessDays * hoursPerDay,
    hoursPerDay,
    tolerancePerDay,
    toleranceHours: businessDays * tolerancePerDay,
    elevatedBandHours: businessDays * 1,
  };
}

async function realHoursInWindow(userId: string, calStart: Date, calEnd: Date): Promise<number> {
  const { start: realStart } = businessDayRealRange(calStart);
  const { end: realEnd } = businessDayRealRange(calEnd);

  const [fijaTasks, activities] = await Promise.all([
    prisma.task.findMany({
      where: {
        assignedToId: userId,
        type: "FIJA",
        archivedMonth: null,
        completedAt: { gte: realStart, lte: realEnd },
      },
      select: { realHours: true },
    }),
    prisma.taskActivity.findMany({
      where: { authorId: userId, createdAt: { gte: realStart, lte: realEnd } },
      select: { duration: true },
    }),
  ]);

  const fijaHours = fijaTasks.reduce((s, t) => s + t.realHours, 0);
  const activityHours = activities.reduce((s, a) => s + a.duration, 0) / 60;
  return Math.round((fijaHours + activityHours) * 100) / 100;
}

function toMetric(
  realHours: number,
  baseHours: number,
  hoursPerDay: number,
  toleranceHours: number,
  elevatedBandHours: number,
): WorkloadMetric {
  const range = computeWorkloadRange(realHours, baseHours, toleranceHours, elevatedBandHours);
  const pct =
    baseHours > 0
      ? computeWorkloadPct(realHours, baseHours, range.max)
      : Math.round((realHours / hoursPerDay) * 100);
  return {
    realHours,
    baseHours,
    pct,
    color: range.color,
    // rangeMin/rangeMax describen la zona Óptima (verde) en sí, no toda la
    // banda de tolerancia — esa banda ahora se reparte entre Moderado y Óptimo.
    rangeMin: baseHours > 0 ? Math.round(baseHours * 100) / 100 : 0,
    rangeMax: range.max,
    label: range.label,
  };
}

export async function computeCargaTiempo(userId: string, now: Date = new Date()): Promise<CargaTiempo> {
  const today = businessCalendarDay(now);
  const monthStart = utcMonthStart(today);
  const monthEnd = utcMonthEnd(today);

  const weekStartRaw = utcWeekStart(today);
  const weekEndRaw = utcWeekEnd(today);
  const weekStart = weekStartRaw < monthStart ? monthStart : weekStartRaw;
  const weekEnd = weekEndRaw > monthEnd ? monthEnd : weekEndRaw;

  // diaria/semanal/mensual son siempre relativas al momento actual (no a un mes
  // histórico), así que las tres usan el valor vigente ahora mismo — comparar
  // contra el instante real (no medianoche del día) para que un cambio de
  // configuración hecho hoy se refleje de inmediato.
  const [hoursPerDay, tolerancePerDay] = await Promise.all([
    getEffectiveHorasEfectivas(now),
    getEffectiveWorkloadTolerance(now),
  ]);

  const dailyBaseHours = isBusinessDay(today) ? hoursPerDay : 0;
  const weeklyBusinessDays = countBusinessDays(weekStart, weekEnd);
  const weeklyBaseHours = weeklyBusinessDays * hoursPerDay;
  const monthlyBusinessDays = countBusinessDays(monthStart, monthEnd);
  const monthlyBaseHours = monthlyBusinessDays * hoursPerDay;

  const [diariaHours, semanalHours, mensualHours] = await Promise.all([
    realHoursInWindow(userId, today, today),
    realHoursInWindow(userId, weekStart, weekEnd),
    realHoursInWindow(userId, monthStart, monthEnd),
  ]);

  const weekBizStart = firstBusinessDay(weekStart, weekEnd) ?? weekStart;
  const weekBizEnd = lastBusinessDay(weekStart, weekEnd) ?? weekEnd;

  return {
    diaria: toMetric(diariaHours, dailyBaseHours, hoursPerDay, tolerancePerDay, 1),
    semanal: {
      ...toMetric(semanalHours, weeklyBaseHours, hoursPerDay, tolerancePerDay * weeklyBusinessDays, weeklyBusinessDays),
      weekStartLabel: formatShortDate(weekBizStart),
      weekEndLabel: formatShortDate(weekBizEnd),
      businessDays: weeklyBusinessDays,
    },
    mensual: {
      ...toMetric(mensualHours, monthlyBaseHours, hoursPerDay, tolerancePerDay * monthlyBusinessDays, monthlyBusinessDays),
      monthLabel: formatMonthLabel(today),
      businessDays: monthlyBusinessDays,
    },
    horasEfectivasPorDia: hoursPerDay,
    workloadTolerance: tolerancePerDay,
    // El histórico (para los gráficos) es una consulta aparte y más cara
    // (computeCargaHistory) — se deja vacío aquí para que llamadores que solo
    // necesitan el snapshot actual (p. ej. el mensaje diario de Nova) no paguen
    // ese costo. Las rutas de KPI que sí muestran gráficos la completan aparte.
    dailyHistory: [],
    weeklyHistory: [],
  };
}

/**
 * Histórico para los gráficos de carga laboral: últimos `dailyCount` días
 * hábiles (barras) y las semanas del mes en curso hasta hoy (línea). Aparte
 * de computeCargaTiempo a propósito — es una consulta más cara y solo la
 * necesitan las vistas de Analytics/Mi actividad que renderizan los gráficos.
 */
export async function computeCargaHistory(
  userId: string,
  now: Date = new Date(),
  dailyCount = 7,
): Promise<{ daily: DailyCargaPoint[]; weekly: WeeklyCargaPoint[] }> {
  const today = businessCalendarDay(now);
  const [hoursPerDay, tolerancePerDay] = await Promise.all([
    getEffectiveHorasEfectivas(now),
    getEffectiveWorkloadTolerance(now),
  ]);

  // ── Diario: últimos `dailyCount` días hábiles (incluye hoy si es hábil) ──
  const businessDaysDesc: Date[] = [];
  for (let cursor = new Date(today); businessDaysDesc.length < dailyCount; cursor = new Date(cursor.getTime() - 86400000)) {
    if (isBusinessDay(cursor)) businessDaysDesc.push(new Date(cursor));
  }
  const businessDaysAsc = businessDaysDesc.reverse();

  const dailyRangeStart = businessDaysAsc[0];
  const dailyRangeEnd = businessDaysAsc[businessDaysAsc.length - 1];
  const { start: dailyRealStart } = businessDayRealRange(dailyRangeStart);
  const { end: dailyRealEnd } = businessDayRealRange(dailyRangeEnd);

  const [dailyFijaTasks, dailyActivities] = await Promise.all([
    prisma.task.findMany({
      where: { assignedToId: userId, type: "FIJA", archivedMonth: null, completedAt: { gte: dailyRealStart, lte: dailyRealEnd } },
      select: { completedAt: true, realHours: true },
    }),
    prisma.taskActivity.findMany({
      where: { authorId: userId, createdAt: { gte: dailyRealStart, lte: dailyRealEnd } },
      select: { createdAt: true, duration: true },
    }),
  ]);

  const daily: DailyCargaPoint[] = businessDaysAsc.map((day) => {
    const { start, end } = businessDayRealRange(day);
    const fijaHours = dailyFijaTasks
      .filter((t) => t.completedAt! >= start && t.completedAt! <= end)
      .reduce((s, t) => s + t.realHours, 0);
    const activityHours =
      dailyActivities.filter((a) => a.createdAt >= start && a.createdAt <= end).reduce((s, a) => s + a.duration, 0) / 60;
    const realHours = Math.round((fijaHours + activityHours) * 100) / 100;
    const range = computeWorkloadRange(realHours, hoursPerDay, tolerancePerDay, 1);
    return {
      date: `${day.getUTCFullYear()}-${String(day.getUTCMonth() + 1).padStart(2, "0")}-${String(day.getUTCDate()).padStart(2, "0")}`,
      dayLabel: `${DAY_ABBR[day.getUTCDay()]} ${formatShortDate(day)}`,
      realHours,
      baseHours: hoursPerDay,
      color: range.color,
      label: range.label,
    };
  });

  // ── Semanal: semanas del mes en curso, hasta la semana de hoy ──
  const monthStart = utcMonthStart(today);
  const monthEnd = utcMonthEnd(today);
  const weekSlices: { start: Date; end: Date }[] = [];
  for (let cursor = monthStart; cursor <= monthEnd && cursor <= today; ) {
    const weekStartRaw = utcWeekStart(cursor);
    const weekEndRaw = utcWeekEnd(cursor);
    const sliceStart = weekStartRaw < monthStart ? monthStart : weekStartRaw;
    const sliceEndRaw = weekEndRaw > monthEnd ? monthEnd : weekEndRaw;
    const sliceEnd = sliceEndRaw > today ? today : sliceEndRaw;
    weekSlices.push({ start: sliceStart, end: sliceEnd });
    cursor = new Date(weekEndRaw.getTime() + 86400000);
  }

  const weeklyRangeStart = weekSlices[0].start;
  const weeklyRangeEnd = weekSlices[weekSlices.length - 1].end;
  const { start: weeklyRealStart } = businessDayRealRange(weeklyRangeStart);
  const { end: weeklyRealEnd } = businessDayRealRange(weeklyRangeEnd);

  const [weeklyFijaTasks, weeklyActivities] = await Promise.all([
    prisma.task.findMany({
      where: { assignedToId: userId, type: "FIJA", archivedMonth: null, completedAt: { gte: weeklyRealStart, lte: weeklyRealEnd } },
      select: { completedAt: true, realHours: true },
    }),
    prisma.taskActivity.findMany({
      where: { authorId: userId, createdAt: { gte: weeklyRealStart, lte: weeklyRealEnd } },
      select: { createdAt: true, duration: true },
    }),
  ]);

  const weekly: WeeklyCargaPoint[] = weekSlices.map((slice, i) => {
    const businessDays = countBusinessDays(slice.start, slice.end);
    const baseHours = businessDays * hoursPerDay;
    const { start: realStart } = businessDayRealRange(slice.start);
    const { end: realEnd } = businessDayRealRange(slice.end);
    const fijaHours = weeklyFijaTasks
      .filter((t) => t.completedAt! >= realStart && t.completedAt! <= realEnd)
      .reduce((s, t) => s + t.realHours, 0);
    const activityHours =
      weeklyActivities.filter((a) => a.createdAt >= realStart && a.createdAt <= realEnd).reduce((s, a) => s + a.duration, 0) / 60;
    const realHours = Math.round((fijaHours + activityHours) * 100) / 100;
    const range = computeWorkloadRange(realHours, baseHours, tolerancePerDay * businessDays, businessDays * 1);
    return {
      weekLabel: `Sem ${i + 1}`,
      realHours,
      baseHours: Math.round(baseHours * 100) / 100,
      color: range.color,
      label: range.label,
    };
  });

  return { daily, weekly };
}
