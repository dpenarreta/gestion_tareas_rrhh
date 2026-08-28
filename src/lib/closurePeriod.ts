import "server-only";
import { fetchDjangoMonthClosure, type DjangoMonthClosure } from "@/lib/djangoClosurePeriodAdapter";

/**
 * Motor de Cierre Inteligente con Fecha de Corte — única fuente de verdad de
 * "hasta qué fecha calcular este mes". Todo motor que hoy asume "fin de mes =
 * último día calendario" (Analytics/KPIs/Carga/Executive Reporting) debe
 * resolver su `end` efectivo a través de este helper (directa o
 * indirectamente vía `monthlyBusinessBase`, ver workload.ts) en vez de
 * recalcular `nextMonthStartUTC - 1` por su cuenta — así un cierre con corte
 * anticipado queda reflejado en todo el stack sin excepciones, y un mes sin
 * cierre (en curso o histórico sin cerrar formalmente) se comporta
 * exactamente igual que hoy.
 *
 * Fase 84 (ver docs/AUDIT_LOG.md § 2026-08-27): lee `MonthClosure` desde
 * Django (`GET /reports/executive/closure-status/`) en vez de Prisma
 * directo — mismo bug de divergencia ya confirmado en `holidays.ts`.
 */
export type MonthClosurePeriod = {
  /** Cierre formal para (year, month), o null si el mes nunca se cerró. */
  closure: DjangoMonthClosure | null;
  /** Último día calendario del mes, sin importar si hay cierre — punto de referencia para comparar. */
  naturalEnd: Date;
  /** `closure.cutoffDate` si el mes está cerrado; si no, `naturalEnd` (comportamiento histórico). */
  effectiveEnd: Date;
};

export async function getMonthClosurePeriod(year: number, month: number): Promise<MonthClosurePeriod> {
  const naturalEnd = new Date(Date.UTC(year, month, 1) - 1);
  const closure = await fetchDjangoMonthClosure(year, month);
  return {
    closure,
    naturalEnd,
    effectiveEnd: closure ? closure.cutoffDate : naturalEnd,
  };
}
