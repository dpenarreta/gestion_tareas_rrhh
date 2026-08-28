import "server-only";
import { isBusinessDay } from "@/lib/businessTime";
import { getHolidaySet } from "@/lib/holidays";
import {
  getEffectiveHorasEfectivas,
  getEffectiveWorkloadLimitLow,
  getEffectiveWorkloadLimitHigh,
  getEffectiveWorkloadLimitOverload,
} from "@/lib/systemConfig";
import { getMonthClosurePeriod } from "@/lib/closurePeriod";

/** Lunes a viernes Y no feriado configurado. */
export function isWorkingDay(d: Date, holidays: Set<number>): boolean {
  return isBusinessDay(d) && !holidays.has(d.getTime());
}

export function countBusinessDays(start: Date, end: Date, holidays: Set<number>): number {
  let count = 0;
  for (let t = start.getTime(); t <= end.getTime(); t += 86400000) {
    if (isWorkingDay(new Date(t), holidays)) count++;
  }
  return count;
}

/**
 * The dynamic business-day base (días lunes-viernes, excluidos feriados, × horas
 * efectivas configuradas) for an explicit calendar month — for historical/report
 * contexts where the month is given directly (no "now" ambiguity, so no
 * business-timezone shift is needed). No es por usuario — los permisos (que sí
 * son por persona) se aplican aparte, por miembro, donde se consuma este valor.
 *
 * Fase 85 (ver docs/AUDIT_LOG.md § 2026-08-27): `sumWeightedBaseHours` (base
 * "leave-aware" por usuario, con permisos/estados especiales) se retiró de
 * este archivo — su único consumidor real, `capacityForecast.ts`, se cortó a
 * Django (réplica exacta ya viva desde la Fase 4f). `leaves.ts`/
 * `specialStatus.ts` quedaron sin ningún consumidor real tras ese cutover y
 * se eliminaron también.
 */
async function businessBaseCore(start: Date, end: Date): Promise<{
  start: Date;
  end: Date;
  businessDays: number;
  baseHours: number;
  hoursPerDay: number;
  limitLowPerDay: number;
  limitHighPerDay: number;
  limitOverloadPerDay: number;
  limitLowHours: number;
  // Umbral de clasificación Moderado/Óptimo, ya escalado — para el equipo global
  // coincide siempre con `baseHours` (mismo hoursPerDay).
  limitBaseHours: number;
  limitHighHours: number;
  limitOverloadHours: number;
}> {
  const holidays = await getHolidaySet();
  const businessDays = countBusinessDays(start, end, holidays);
  // El valor vigente al INICIO del período es el que rigió ese tramo — así
  // cambios de configuración posteriores no alteran KPIs de períodos ya cerrados.
  const [hoursPerDay, limitLowPerDay, limitHighPerDay, limitOverloadPerDay] = await Promise.all([
    getEffectiveHorasEfectivas(start),
    getEffectiveWorkloadLimitLow(start),
    getEffectiveWorkloadLimitHigh(start),
    getEffectiveWorkloadLimitOverload(start),
  ]);
  const baseHours = businessDays * hoursPerDay;
  return {
    start,
    end,
    businessDays,
    baseHours,
    hoursPerDay,
    limitLowPerDay,
    limitHighPerDay,
    limitOverloadPerDay,
    limitLowHours: businessDays * limitLowPerDay,
    limitBaseHours: baseHours,
    limitHighHours: businessDays * limitHighPerDay,
    limitOverloadHours: businessDays * limitOverloadPerDay,
  };
}

/**
 * Motor de Cierre Inteligente con Fecha de Corte — si (year, month) tiene un
 * MonthClosure con corte anticipado (EARLY/MANUAL), `end` se trunca a
 * `closure.cutoffDate` en vez de siempre usar el último día calendario. Sin
 * cambio de firma a propósito: los llamadores existentes (Analytics, KPIs,
 * Executive Reporting, dashboard) heredan el corte automáticamente. Un mes sin
 * cierre formal, o cerrado en el último día (closureType NORMAL), se comporta
 * exactamente igual que antes de este sprint.
 */
export async function monthlyBusinessBase(year: number, month: number) {
  const start = new Date(Date.UTC(year, month - 1, 1));
  const { effectiveEnd } = await getMonthClosurePeriod(year, month);
  return businessBaseCore(start, effectiveEnd);
}

export type MonthlyBusinessBase = Awaited<ReturnType<typeof monthlyBusinessBase>>;
