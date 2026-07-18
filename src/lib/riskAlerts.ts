import { prisma } from "@/lib/prisma";
import { isTaskOverdue } from "@/lib/utils";
import { businessCalendarDay, isBusinessDay } from "@/lib/businessTime";
import type { WorkloadLabel } from "@/components/kpis/types";

export type RiskAlertSeverity = "red" | "yellow";

export type RiskAlert = {
  severity: RiskAlertSeverity;
  message: string;
};

function pluralize(n: number, singular: string, plural: string): string {
  return n === 1 ? singular : plural;
}

/** UTC-midnight for a pure calendar-date field (Task.endDate) — no business-timezone shift, see businessTime.ts. */
function utcMidnight(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** Días laborables (lun-vie) estrictamente entre `from` y `to` (ambos UTC-medianoche), contando `to` si aplica. */
function businessDaysBetween(from: Date, to: Date): number {
  let count = 0;
  const cursor = new Date(from);
  while (cursor.getTime() < to.getTime()) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    if (isBusinessDay(cursor)) count++;
  }
  return count;
}

/**
 * Indicadores de riesgo automáticos para un colaborador: tareas vencidas
 * (con conteo de críticas de prioridad ALTA), carga laboral fuera del rango
 * óptimo, actividades por vencer en los próximos 3 días, y ausencia de
 * registro de actividades en los últimos 2+ días laborables. Array vacío =
 * sin alertas activas (el componente que consume esto debe mostrar el
 * estado "Sin alertas" cuando length === 0).
 */
export async function computeRiskAlerts({
  userId,
  now = new Date(),
  cargaLabel,
  cargaPct,
}: {
  userId: string;
  now?: Date;
  /**
   * Etiqueta del semáforo de carga laboral MENSUAL. OJO: no usar WorkloadColor
   * aquí — "red" es ambiguo entre "Subutilización" y "Sobrecarga" (comparten
   * color en el semáforo de 5 zonas), y esta alerta solo debe dispararse por
   * carga EXCESIVA (Elevada/Sobrecarga), nunca por subutilización.
   */
  cargaLabel: WorkloadLabel;
  cargaPct: number;
}): Promise<RiskAlert[]> {
  const alerts: RiskAlert[] = [];
  const today = businessCalendarDay(now);
  const in3Days = new Date(today.getTime() + 3 * 86400000);

  const [openTasks, lastActivity] = await Promise.all([
    prisma.task.findMany({
      where: { assignedToId: userId, archivedMonth: null, status: { not: "COMPLETADA" } },
      select: { endDate: true, status: true, priority: true },
    }),
    prisma.taskActivity.findFirst({
      where: { authorId: userId },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
  ]);

  const overdue = openTasks.filter((t) => isTaskOverdue(t.endDate, t.status, now));
  if (overdue.length > 0) {
    const critical = overdue.filter((t) => t.priority === "ALTA").length;
    alerts.push({
      severity: "red",
      message:
        `${overdue.length} ${pluralize(overdue.length, "tarea vencida", "tareas vencidas")}` +
        (critical > 0 ? ` (${critical} ${pluralize(critical, "crítica", "críticas")} de prioridad alta)` : ""),
    });
  }

  if (cargaLabel === "Sobrecarga" || cargaLabel === "Carga elevada") {
    alerts.push({
      severity: cargaLabel === "Sobrecarga" ? "red" : "yellow",
      message: `La carga laboral del mes está en ${cargaLabel} (${cargaPct}%), por encima del rango óptimo`,
    });
  }

  const dueSoon = openTasks.filter((t) => {
    if (isTaskOverdue(t.endDate, t.status, now)) return false;
    const endDay = utcMidnight(t.endDate);
    return endDay.getTime() >= today.getTime() && endDay.getTime() <= in3Days.getTime();
  });
  if (dueSoon.length > 0) {
    alerts.push({
      severity: "yellow",
      message: `${dueSoon.length} ${pluralize(dueSoon.length, "actividad próxima", "actividades próximas")} a vencer en los próximos 3 días`,
    });
  }

  // Solo se alerta si existe al menos un registro previo — un colaborador sin
  // ningún TaskActivity histórico puede simplemente ser nuevo, no en riesgo.
  if (lastActivity) {
    const lastDay = businessCalendarDay(lastActivity.createdAt);
    const gap = businessDaysBetween(lastDay, today);
    if (gap >= 2) {
      alerts.push({
        severity: "red",
        message: `Sin registro de actividades en los últimos ${gap} días laborables`,
      });
    }
  }

  return alerts;
}
