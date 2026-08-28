import "server-only";
import { djangoApiFetch } from "@/lib/djangoSession";

/**
 * Hora de corte de jornada (huso de negocio) usada por Capacidad
 * Proyectada — Fase 73 de la migración de stack (ver docs/AUDIT_LOG.md §
 * 2026-08-26). Lee `GET /settings/trabajo-avanzado/` (Django,
 * `TrabajoAvanzadoView`, completa desde la Fase 32) en vez de
 * `getEffectiveWorkdayEndHour` (`src/lib/systemConfig.ts`, Prisma) —
 * cierra el hallazgo de la Fase 63: la UI de Ajustes ya escribía este
 * valor en Django desde la Fase 60, pero `capacityForecast.ts` seguía
 * leyéndolo de Postgres — 2 almacenes desincronizados, staleness activa
 * (editar la hora de corte desde Ajustes no tenía efecto real en
 * Capacidad Proyectada). Mismo valor por defecto que el backend
 * (`DEFAULT_WORKDAY_END_HOUR` en ambos lados, 17) — si Django no está
 * disponible se degrada al default en vez de fallar: no es un dato que
 * pueda romper la generación de la proyección en sí.
 */
const DEFAULT_WORKDAY_END_HOUR = 17;

export async function fetchDjangoWorkdayEndHour(): Promise<number> {
  const response = await djangoApiFetch("/settings/trabajo-avanzado/");
  if (!response || !response.ok) return DEFAULT_WORKDAY_END_HOUR;
  const data = (await response.json()) as { workday_end_hour: number };
  return Number.isInteger(data.workday_end_hour) ? data.workday_end_hour : DEFAULT_WORKDAY_END_HOUR;
}
