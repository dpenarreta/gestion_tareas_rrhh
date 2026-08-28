// Estado del período evaluado (FPS Parte IV §6) — evita interpretar mal un
// reporte emitido antes del cierre mensual. Se apoya en MonthClosure (ya
// existente, un registro por mes efectivamente cerrado por un
// Administrador) — no se crea un concepto de cierre paralelo.
//
// Fase 84 (ver docs/AUDIT_LOG.md § 2026-08-27): lee el cierre desde Django
// (`fetchDjangoMonthClosure`, ya usado por `closurePeriod.ts`) en vez de
// `prisma.monthClosure` directo — mismo bug de divergencia ya confirmado en
// `holidays.ts`.
import { fetchDjangoMonthClosure } from "@/lib/djangoClosurePeriodAdapter";
import type { ExecutiveReportPeriodStatus } from "./snapshotData";

/** Reporte de un solo mes calendario (MENSUAL). */
export async function resolveMonthlyPeriodStatus(
  month: number,
  year: number,
  now: Date = new Date(),
): Promise<ExecutiveReportPeriodStatus> {
  const isCurrentMonth = month === now.getMonth() + 1 && year === now.getFullYear();
  if (isCurrentMonth) return "EN_CURSO";

  const closure = await fetchDjangoMonthClosure(year, month);
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
