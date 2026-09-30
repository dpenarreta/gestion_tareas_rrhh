import "server-only";
import { isBusinessDay } from "@/lib/businessTime";
import { getHolidaySet } from "@/lib/holidays";
import {
  getEffectiveHorasEfectivas,
  getEffectiveHorasEsperadasMes,
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
 * Horas esperadas de un mes de trabajo: 140h fijas (`HORAS_ESPERADAS_MES`)
 * repartidas entre los días hábiles de ese mes calendario. El divisor es
 * siempre el mes completo, así un mes entero suma exactamente 140h y cualquier
 * tramo queda prorrateado por sus días hábiles.
 *
 * Réplica de `expected_hours_per_day_for_month`
 * (`backend/apps/configuration/services.py`) — Django es la fuente de verdad.
 */
async function expectedHoursPerDayForMonth(year: number, month: number, holidays: Set<number>): Promise<number> {
  const monthStart = new Date(Date.UTC(year, month - 1, 1));
  const monthEnd = new Date(Date.UTC(year, month, 0));
  const businessDays = countBusinessDays(monthStart, monthEnd, holidays);
  if (businessDays <= 0) return 0;
  return (await getEffectiveHorasEsperadasMes(monthStart)) / businessDays;
}

/** Réplica de `expected_base_hours_for_range` — mes por mes, porque cada uno
 * tiene su propia tasa diaria esperada. */
async function expectedBaseHoursForRange(start: Date, end: Date, holidays: Set<number>): Promise<number> {
  let total = 0;
  let cursor = start;
  while (cursor.getTime() <= end.getTime()) {
    const monthEnd = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 0));
    const segmentEnd = monthEnd.getTime() < end.getTime() ? monthEnd : end;
    const segmentDays = countBusinessDays(cursor, segmentEnd, holidays);
    if (segmentDays > 0) {
      total += segmentDays * (await expectedHoursPerDayForMonth(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, holidays));
    }
    cursor = new Date(monthEnd.getTime() + 86400000);
  }
  return Math.round(total * 100) / 100;
}

/**
 * The business-day base for an explicit calendar month — for historical/report
 * contexts where the month is given directly (no "now" ambiguity, so no
 * business-timezone shift is needed). No es por usuario — los permisos (que sí
 * son por persona) se aplican aparte, por miembro, donde se consuma este valor.
 *
 * `baseHours` YA NO es `díasHábiles × horasEfectivas`: el objetivo de un mes
 * son 140h fijas y es ese total el que se prorratea. Los 3 límites externos del
 * semáforo siguen siendo umbrales POR DÍA configurados aparte.
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
  /** Tasa diaria implícita del rango (140h del mes / sus días hábiles) — la
   * usan los cálculos que reconstruyen la base día a día. */
  expectedHoursPerDay: number;
  limitLowPerDay: number;
  limitHighPerDay: number;
  limitOverloadPerDay: number;
  limitLowHours: number;
  // Umbral de clasificación Moderado/Óptimo — tiene que ser el MISMO número que
  // se exhibe como base, o la pantalla muestra 140h y clasifica contra otra cosa.
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
  const baseHours = await expectedBaseHoursForRange(start, end, holidays);
  const expectedHoursPerDay = businessDays > 0 ? Math.round((baseHours / businessDays) * 10000) / 10000 : 0;
  return {
    start,
    end,
    businessDays,
    baseHours,
    hoursPerDay,
    expectedHoursPerDay,
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
