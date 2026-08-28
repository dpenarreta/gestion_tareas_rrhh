import "server-only";
import { djangoApiFetch } from "@/lib/djangoSession";

/**
 * Feriados — Fase 84 de la migración de stack (ver docs/AUDIT_LOG.md §
 * 2026-08-27). Reemplaza `prisma.holiday.findMany()` en
 * `src/lib/holidays.ts` (Prisma/Postgres) por `GET /settings/holidays/`
 * (Django, `HolidayListView`, completa desde la Fase 29, pública sin
 * requerir ADMINISTRADOR desde la corrección de la Fase 52). Bug de
 * divergencia confirmado: `settings/holidays/route.ts` ya escribe feriados
 * nuevos en Django desde la Fase 52 — un feriado agregado desde Ajustes era
 * invisible para el motor de KPIs hasta este cambio.
 */

type DjangoHoliday = { id: number; date: string; name: string; year: number };

/** Set de timestamps (getTime()) de días feriados UTC-medianoche — para lookup O(1) por día. Vacío si Django no está disponible. */
export async function fetchDjangoHolidaySet(): Promise<Set<number>> {
  const response = await djangoApiFetch("/settings/holidays/");
  if (!response || !response.ok) return new Set();

  const data = (await response.json()) as DjangoHoliday[];
  return new Set(data.map((h) => new Date(h.date).getTime()));
}
