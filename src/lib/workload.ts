import "server-only";
import { prisma } from "@/lib/prisma";
import type { KpiColor } from "@/components/kpis/types";

export type WorkloadMetric = { realHours: number; pct: number; color: KpiColor };
export type CargaTiempo = { diaria: WorkloadMetric; semanal: WorkloadMetric; mensual: WorkloadMetric };

function workloadColor(pct: number): KpiColor {
  if (pct > 120) return "red";
  if (pct >= 100) return "yellow";
  if (pct >= 60) return "green";
  return "red";
}

function utcDayStart(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
function utcDayEnd(d: Date) {
  return new Date(utcDayStart(d).getTime() + 86400000 - 1);
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

async function realHoursInWindow(userId: string, start: Date, end: Date): Promise<number> {
  const [fijaTasks, activities] = await Promise.all([
    prisma.task.findMany({
      where: {
        assignedToId: userId,
        type: "FIJA",
        archivedMonth: null,
        endDate: { gte: start, lte: end },
      },
      select: { realHours: true },
    }),
    prisma.taskActivity.findMany({
      where: { authorId: userId, createdAt: { gte: start, lte: end } },
      select: { duration: true },
    }),
  ]);

  const fijaHours = fijaTasks.reduce((s, t) => s + t.realHours, 0);
  const activityHours = activities.reduce((s, a) => s + a.duration, 0) / 60;
  return Math.round((fijaHours + activityHours) * 100) / 100;
}

function toMetric(realHours: number, budgetHours: number): WorkloadMetric {
  const pct = Math.round((realHours / budgetHours) * 100);
  return { realHours, pct, color: workloadColor(pct) };
}

export async function computeCargaTiempo(userId: string, now: Date = new Date()): Promise<CargaTiempo> {
  const [diariaHours, semanalHours, mensualHours] = await Promise.all([
    realHoursInWindow(userId, utcDayStart(now), utcDayEnd(now)),
    realHoursInWindow(userId, utcWeekStart(now), utcWeekEnd(now)),
    realHoursInWindow(userId, utcMonthStart(now), utcMonthEnd(now)),
  ]);

  return {
    diaria: toMetric(diariaHours, 8),
    semanal: toMetric(semanalHours, 40),
    mensual: toMetric(mensualHours, 160),
  };
}
