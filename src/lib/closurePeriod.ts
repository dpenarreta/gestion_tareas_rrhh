import "server-only";
import { prisma } from "@/lib/prisma";
import type { MonthClosure } from "@/generated/prisma/client";

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
 */
export type MonthClosurePeriod = {
  /** Fila de MonthClosure para (year, month), o null si el mes nunca se cerró formalmente. */
  closure: MonthClosure | null;
  /** Último día calendario del mes, sin importar si hay cierre — punto de referencia para comparar. */
  naturalEnd: Date;
  /** `closure.cutoffDate` si el mes está cerrado; si no, `naturalEnd` (comportamiento histórico). */
  effectiveEnd: Date;
};

export async function getMonthClosurePeriod(year: number, month: number): Promise<MonthClosurePeriod> {
  const naturalEnd = new Date(Date.UTC(year, month, 1) - 1);
  const closure = await prisma.monthClosure.findUnique({ where: { month_year: { month, year } } });
  return {
    closure,
    naturalEnd,
    effectiveEnd: closure ? closure.cutoffDate : naturalEnd,
  };
}
