import "server-only";
import { djangoApiFetch } from "@/lib/djangoSession";

// Cutover de stack — Fase 90 (ver docs/AUDIT_LOG.md § 2026-08-28): ya no se
// importa del cliente Prisma generado (retirado del repo) — mismos valores
// que `prisma/schema.prisma` tenía, réplica exacta de
// `MonthClosure.closure_type` (Django).
export type MonthClosureType = "NORMAL" | "EARLY" | "MANUAL";

/**
 * Motor de Cierre Inteligente — Fase 84 de la migración de stack (ver
 * docs/AUDIT_LOG.md § 2026-08-27). Reemplaza la lectura directa de
 * `prisma.monthClosure` en `src/lib/closurePeriod.ts` (Prisma/Postgres) por
 * `GET /reports/executive/closure-status/` (Django, `ClosureStatusView`,
 * completa desde la Fase 34 — extendida en esta misma fase con
 * `closed_at`/`calendar_days_*`/`working_*_considered` para cubrir también
 * lo que necesita `buildSnapshotData.ts::closureMetaFrom`, no solo la vista
 * previa de `closure-status/route.ts`). Mismo bug de divergencia ya
 * confirmado en `holidays.ts`: `settings/holidays`/`workload-config` ya
 * escriben en Django desde la Fase 52, pero el motor interno seguía leyendo
 * Postgres.
 */

export type DjangoMonthClosure = {
  closureType: MonthClosureType;
  cutoffDate: Date;
  closedAt: Date;
  calendarDaysTotal: number;
  calendarDaysConsidered: number;
  workingDaysConsidered: number;
  workingHoursConsidered: number;
};

type DjangoClosureStatusResponse = {
  closed: boolean;
  cutoff_date: string | null;
  closure_type: string | null;
  closed_at: string | null;
  calendar_days_total: number | null;
  calendar_days_considered: number | null;
  working_days_considered: number | null;
  working_hours_considered: number | null;
};

/** `null` si el mes nunca se cerró formalmente, o si Django no está disponible (mismo criterio que hoy: sin cierre, se usa el fin de mes natural). */
export async function fetchDjangoMonthClosure(year: number, month: number): Promise<DjangoMonthClosure | null> {
  const response = await djangoApiFetch(`/reports/executive/closure-status/?year=${year}&month=${month}`);
  if (!response || !response.ok) return null;

  const data = (await response.json()) as DjangoClosureStatusResponse;
  if (!data.closed || !data.cutoff_date || !data.closure_type) return null;

  return {
    closureType: data.closure_type as MonthClosureType,
    cutoffDate: new Date(data.cutoff_date),
    closedAt: data.closed_at ? new Date(data.closed_at) : new Date(data.cutoff_date),
    calendarDaysTotal: data.calendar_days_total ?? 0,
    calendarDaysConsidered: data.calendar_days_considered ?? 0,
    workingDaysConsidered: data.working_days_considered ?? 0,
    workingHoursConsidered: data.working_hours_considered ?? 0,
  };
}
