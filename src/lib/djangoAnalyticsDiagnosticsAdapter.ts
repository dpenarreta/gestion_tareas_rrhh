import "server-only";
import { djangoApiFetch } from "@/lib/djangoSession";

/**
 * Fase 88 de la migración de stack (ver docs/AUDIT_LOG.md § 2026-08-28).
 * Adaptador de `GET /analytics/diagnostics/` (Django, `AnalyticsDiagnosticsView`)
 * — réplica de los 2 cálculos que `computeDataQuality`/
 * `recordEngineVersionIfChanged` seguían resolviendo contra Prisma. Único
 * consumidor: `src/app/api/analytics/diagnostics/route.ts`.
 */

export type DjangoAnalyticsDiagnostics = {
  data_quality_pct: number;
  version_change: { previous_version: string | null; changed: boolean };
};

export async function fetchDjangoAnalyticsDiagnostics(engineVersion: string): Promise<DjangoAnalyticsDiagnostics | null> {
  const response = await djangoApiFetch(`/analytics/diagnostics/?engine_version=${encodeURIComponent(engineVersion)}`);
  if (!response || !response.ok) return null;
  return (await response.json()) as DjangoAnalyticsDiagnostics;
}
