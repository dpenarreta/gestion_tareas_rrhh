import "server-only";

/**
 * Adaptador entre los payloads de `GET/POST /api/v1/predictive/**` de
 * Django (Fase 48, ver docs/AUDIT_LOG.md § 2026-08-24) y la forma
 * camelCase que ya esperan los componentes de Inteligencia Preventiva
 * (`src/components/inteligencia-preventiva/types.ts`).
 *
 * Mismo patrón exacto que `djangoAnalyticsAdapter.ts` (Fase 4m/47): el
 * payload es 100% mecánico snake_case→camelCase, sin renombres ni
 * reestructuración — verificado contra `build_prediction_bundle_payload`/
 * `compute_trend_engine`/`compute_preventive_alerts`/
 * `compute_team_preventive_alerts`/`compute_subutilizacion_predictions`/
 * `compute_project_delay_prediction`/`simulate_*` (`backend/apps/analytics/**`).
 * Se duplica la transformación en vez de compartirla con
 * `djangoAnalyticsAdapter.ts`/`djangoKpisAdapter.ts`, mismo criterio ya
 * documentado ahí (acotado a un único archivo por payload).
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

export function mapDjangoPredictivePayloadToNexoShape(payload: Record<string, unknown>): Record<string, unknown> {
  return deepCamelCase(payload) as Record<string, unknown>;
}
