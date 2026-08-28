import "server-only";
import {
  fetchDjangoWorkloadLimits,
  fetchDjangoAnalyticsConfig,
  fetchDjangoPredictionWindowWeeks,
  ANALYTICS_CONFIG_DEFAULTS,
  PREDICTION_MAX_DAYS,
  type AnalyticsConfigKey,
} from "@/lib/djangoSystemConfigAdapter";

export { ANALYTICS_CONFIG_DEFAULTS, PREDICTION_MAX_DAYS, type AnalyticsConfigKey };

/**
 * Fase 84 de la migración de stack (ver docs/AUDIT_LOG.md § 2026-08-27):
 * `getEffectiveHorasEfectivas`/`getEffectiveWorkloadLimit*`/
 * `getEffectiveAnalyticsConfig`/`getEffectivePredictionWindowWeeks` ya no
 * leen `prisma.systemConfigHistory` — delegan a Django
 * (`djangoSystemConfigAdapter.ts`), que ya escribía estos valores desde las
 * Fases 31/52 sin que este archivo los leyera de vuelta (mismo bug de
 * divergencia ya confirmado en `holidays.ts`). Las versiones de ESCRITURA
 * (`setAnalyticsConfigValue`/`setCurveConfig`/`getAllEffectiveCurves`) se
 * retiraron de acá — sus únicos callers (`analytics-config`/
 * `normalization-curves` route.ts) llaman al adaptador Django directo. El
 * parámetro `asOf` se conserva por compatibilidad de firma con los callers
 * existentes (`workload.ts`/`capacityForecast.ts`/`analytics.ts`) pero ya NO
 * tiene efecto — Django solo expone el valor efectivo AHORA, no en una fecha
 * pasada arbitraria (mismo trade-off ya aceptado en la Fase 73 para
 * `workday_end_hour`).
 */

export async function getEffectiveHorasEfectivas(_asOf?: Date): Promise<number> {
  return (await fetchDjangoWorkloadLimits()).hoursPerDay;
}

export async function getEffectiveWorkloadLimitLow(_asOf?: Date): Promise<number> {
  return (await fetchDjangoWorkloadLimits()).workloadLimitLow;
}

export async function getEffectiveWorkloadLimitHigh(_asOf?: Date): Promise<number> {
  return (await fetchDjangoWorkloadLimits()).workloadLimitHigh;
}

export async function getEffectiveWorkloadLimitOverload(_asOf?: Date): Promise<number> {
  return (await fetchDjangoWorkloadLimits()).workloadLimitOverload;
}

export async function getEffectiveAnalyticsConfig(): Promise<Record<AnalyticsConfigKey, number>> {
  return fetchDjangoAnalyticsConfig();
}

export async function getEffectivePredictionWindowWeeks(_asOf?: Date): Promise<string> {
  return fetchDjangoPredictionWindowWeeks();
}

// Cutover de stack — Fase 88 (ver docs/AUDIT_LOG.md § 2026-08-28):
// `getEffectiveConfigString`/`setConfigValue`/`recordEngineVersionIfChanged`
// (versionado del motor, §Sprint 5 S5-L) se retiraron — último rastro de
// Prisma en este archivo. Su único consumidor
// (`/api/analytics/diagnostics/route.ts`) ya llama a Django directo
// (`AnalyticsDiagnosticsView`, `get_effective_config_string`/
// `set_config_value` genéricos de `apps.configuration.services`).
