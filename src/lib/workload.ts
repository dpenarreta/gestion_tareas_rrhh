import "server-only";
import { prisma } from "@/lib/prisma";
import type { KpiColor } from "@/components/kpis/types";

export type WorkloadMetric = {
  realHours: number;
  baseHours: number;
  pct: number;
  color: KpiColor;
};

export type CargaTiempo = {
  diaria: WorkloadMetric;
  semanal: WorkloadMetric & { weekStartLabel: string; weekEndLabel: string; businessDays: number };
  mensual: WorkloadMetric & { monthLabel: string; businessDays: number };
};

const MONTH_NAMES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

/**
 * Nexo opera en horario de Ecuador/Colombia (America/Guayaquil o Bogotá,
 * UTC-5, sin horario de verano). Los servidores (Vercel) suelen correr con
 * reloj en UTC, así que `new Date()` puede caer ya en "mañana" en UTC
 * mientras localmente todavía es "hoy" — hasta 5 horas de diferencia cada
 * noche. Cualquier cálculo de "qué día es hoy" para KPIs en tiempo real
 * debe desplazar el instante actual a este huso ANTES de leer el día
 * calendario, o los cálculos de semana/mes se corren un día.
 */
const BUSINESS_TZ_OFFSET_HOURS = 5;

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

function workloadColor(pct: number, baseHours: number, realHours: number): KpiColor {
  if (baseHours === 0) {
    return realHours > 0 ? "yellow" : "green";
  }
  if (pct > 120) return "red";
  if (pct >= 100) return "yellow";
  if (pct >= 60) return "green";
  return "red";
}

function utcDayStart(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** The business-timezone calendar day (as a UTC-midnight Date) that `instant` falls on. */
function calendarDayFor(instant: Date): Date {
  const shifted = new Date(instant.getTime() - BUSINESS_TZ_OFFSET_HOURS * 3600000);
  return utcDayStart(shifted);
}

/**
 * The real UTC instant range spanning a business-timezone calendar day —
 * for comparing against genuine timestamps (e.g. TaskActivity.createdAt),
 * as opposed to date-only fields like Task.endDate.
 */
function realRangeForCalendarDay(calDay: Date): { start: Date; end: Date } {
  const start = new Date(
    Date.UTC(calDay.getUTCFullYear(), calDay.getUTCMonth(), calDay.getUTCDate(), BUSINESS_TZ_OFFSET_HOURS)
  );
  return { start, end: new Date(start.getTime() + 86400000 - 1) };
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

async function realHoursInWindow(userId: string, calStart: Date, calEnd: Date): Promise<number> {
  const { start: realStart } = realRangeForCalendarDay(calStart);
  const { end: realEnd } = realRangeForCalendarDay(calEnd);

  const [fijaTasks, activities] = await Promise.all([
    prisma.task.findMany({
      where: {
        assignedToId: userId,
        type: "FIJA",
        archivedMonth: null,
        endDate: { gte: calStart, lte: calEnd },
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

function toMetric(realHours: number, baseHours: number): WorkloadMetric {
  const divisor = baseHours > 0 ? baseHours : 8;
  const pct = Math.round((realHours / divisor) * 100);
  return { realHours, baseHours, pct, color: workloadColor(pct, baseHours, realHours) };
}

export async function computeCargaTiempo(userId: string, now: Date = new Date()): Promise<CargaTiempo> {
  const today = calendarDayFor(now);
  const monthStart = utcMonthStart(today);
  const monthEnd = utcMonthEnd(today);

  const weekStartRaw = utcWeekStart(today);
  const weekEndRaw = utcWeekEnd(today);
  const weekStart = weekStartRaw < monthStart ? monthStart : weekStartRaw;
  const weekEnd = weekEndRaw > monthEnd ? monthEnd : weekEndRaw;

  const dailyBaseHours = isBusinessDay(today) ? 8 : 0;
  const weeklyBusinessDays = countBusinessDays(weekStart, weekEnd);
  const weeklyBaseHours = weeklyBusinessDays * 8;
  const monthlyBusinessDays = countBusinessDays(monthStart, monthEnd);
  const monthlyBaseHours = monthlyBusinessDays * 8;

  const [diariaHours, semanalHours, mensualHours] = await Promise.all([
    realHoursInWindow(userId, today, today),
    realHoursInWindow(userId, weekStart, weekEnd),
    realHoursInWindow(userId, monthStart, monthEnd),
  ]);

  const weekBizStart = firstBusinessDay(weekStart, weekEnd) ?? weekStart;
  const weekBizEnd = lastBusinessDay(weekStart, weekEnd) ?? weekEnd;

  return {
    diaria: toMetric(diariaHours, dailyBaseHours),
    semanal: {
      ...toMetric(semanalHours, weeklyBaseHours),
      weekStartLabel: formatShortDate(weekBizStart),
      weekEndLabel: formatShortDate(weekBizEnd),
      businessDays: weeklyBusinessDays,
    },
    mensual: {
      ...toMetric(mensualHours, monthlyBaseHours),
      monthLabel: formatMonthLabel(today),
      businessDays: monthlyBusinessDays,
    },
  };
}
