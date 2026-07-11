import "server-only";
import { prisma } from "@/lib/prisma";
import { businessCalendarDay, businessDayRealRange } from "@/lib/businessTime";
import { getEffectiveHorasEfectivas, getEffectiveWorkloadTolerance } from "@/lib/systemConfig";
import type { KpiColor, WorkloadMetric, WorkloadLabel, CargaTiempo } from "@/components/kpis/types";

export type { WorkloadMetric, CargaTiempo };

const MONTH_NAMES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

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
  min: number;
  max: number;
  elevatedMax: number;
  color: KpiColor;
  label: WorkloadLabel;
};

/**
 * Semáforo de carga laboral por RANGO (no un punto exacto de 100%):
 *   🔴 Subutilización : realHours <  base - tolerancia
 *   🟢 Óptimo         : base - tolerancia <= realHours <= base + tolerancia
 *   🟡 Carga elevada  : base + tolerancia <  realHours <= base + tolerancia + elevatedBandHours
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
      ? { min: 0, max: 0, elevatedMax: 0, color: "yellow", label: "Carga elevada" }
      : { min: 0, max: 0, elevatedMax: 0, color: "green", label: "Óptimo" };
  }
  const min = Math.round((baseHours - toleranceHours) * 100) / 100;
  const max = Math.round((baseHours + toleranceHours) * 100) / 100;
  const elevatedMax = Math.round((max + elevatedBandHours) * 100) / 100;
  if (realHours < min) return { min, max, elevatedMax, color: "red", label: "Subutilización" };
  if (realHours <= max) return { min, max, elevatedMax, color: "green", label: "Óptimo" };
  if (realHours <= elevatedMax) return { min, max, elevatedMax, color: "yellow", label: "Carga elevada" };
  return { min, max, elevatedMax, color: "red", label: "Sobrecarga" };
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
  const divisor = baseHours > 0 ? baseHours : hoursPerDay;
  const pct = Math.round((realHours / divisor) * 100);
  const range = computeWorkloadRange(realHours, baseHours, toleranceHours, elevatedBandHours);
  return {
    realHours,
    baseHours,
    pct,
    color: range.color,
    rangeMin: range.min,
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
  };
}
