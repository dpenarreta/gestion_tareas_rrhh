// Estado del período evaluado (FPS Parte IV §6) — evita interpretar mal un
// reporte emitido antes del cierre mensual. Se apoya en MonthClosure (ya
// existente, un registro por mes efectivamente cerrado por un
// Administrador) — no se crea un concepto de cierre paralelo.
import { prisma } from "@/lib/prisma";
import type { ExecutiveReportPeriodStatus } from "@/generated/prisma/client";

/** Reporte de un solo mes calendario (MENSUAL). */
export async function resolveMonthlyPeriodStatus(
  month: number,
  year: number,
  now: Date = new Date(),
): Promise<ExecutiveReportPeriodStatus> {
  const isCurrentMonth = month === now.getMonth() + 1 && year === now.getFullYear();
  if (isCurrentMonth) return "EN_CURSO";

  const closure = await prisma.monthClosure.findUnique({ where: { month_year: { month, year } } });
  return closure ? "CERRADO" : "HISTORICO";
}

/**
 * Rango de meses calendario completos (RANGO_MESES) — se evalúa sobre el
 * ÚLTIMO mes del rango: si ese mes sigue en curso, el rango completo se
 * marca EN_CURSO (contiene datos parciales de ese mes); en caso contrario
 * hereda el estado (Cerrado/Histórico) de ese último mes.
 */
export async function resolveRangePeriodStatus(
  lastMonth: number,
  lastYear: number,
  now: Date = new Date(),
): Promise<ExecutiveReportPeriodStatus> {
  return resolveMonthlyPeriodStatus(lastMonth, lastYear, now);
}

/**
 * Rango de fechas arbitrario (RANGO_PERSONALIZADO) — no calza con un mes
 * calendario completo, así que no existe un MonthClosure que consultar;
 * CERRADO (cierre formal de un mes) nunca aplica aquí.
 */
export function resolveCustomRangePeriodStatus(periodEnd: Date, now: Date = new Date()): ExecutiveReportPeriodStatus {
  return periodEnd.getTime() < now.getTime() ? "HISTORICO" : "EN_CURSO";
}
