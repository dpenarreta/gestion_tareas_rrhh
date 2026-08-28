import "server-only";

/**
 * Adaptador entre el payload de `GET /api/v1/analytics/<user_id>/` de
 * Django (Fase 4m de la migración de stack, ver docs/AUDIT_LOG.md §
 * 2026-08-12) y la forma camelCase que ya espera `AnalyticsBundle`
 * (`src/components/kpis/types.ts`).
 *
 * Mismo patrón exacto que `djangoKpisAdapter.ts` (Fase 4b): el payload es
 * 100% mecánico snake_case→camelCase, sin renombres ni reestructuración
 * — verificado campo por campo contra `AnalyticsBundle`/`HealthScoreResult`/
 * `PerformanceScoreResult`/`EngineAlert`/`ResolvedAlert`/`KpiTrends`/
 * `ConsistencyResult`/`AnomalyResult`/`Prediction`/`DataQualityResult`
 * (`src/lib/analytics.ts`). El único campo que en el TS legacy tenía un
 * nombre distinto de su origen (`validationFailures` → `validationWarnings`)
 * ya se resuelve del lado de Django (`build_analytics_bundle_payload`,
 * `backend/apps/analytics/services.py`), así que este adaptador puede
 * seguir siendo genérico — se duplica la transformación en vez de
 * compartirla con `djangoKpisAdapter.ts`, mismo criterio ya documentado
 * ahí (acotado a un único archivo por payload).
 */

function snakeToCamel(key: string): string {
  return key.replace(/_([a-z0-9])/g, (_, chr: string) => chr.toUpperCase());
}

function deepCamelCase(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(deepCamelCase);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, v]) => [snakeToCamel(key), deepCamelCase(v)]),
    );
  }
  return value;
}

export function mapDjangoAnalyticsPayloadToNexoShape(payload: Record<string, unknown>): Record<string, unknown> {
  return deepCamelCase(payload) as Record<string, unknown>;
}
