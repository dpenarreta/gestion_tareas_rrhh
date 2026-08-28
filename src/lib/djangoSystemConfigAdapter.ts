import "server-only";
import { djangoApiFetch } from "@/lib/djangoSession";

/**
 * Fase 84 de la migración de stack (ver docs/AUDIT_LOG.md § 2026-08-27).
 * Reemplaza el resto de `systemConfig.ts` que seguía tocando
 * `prisma.systemConfigHistory` directo por los endpoints Django ya
 * construidos desde las Fases 31/32 (`WorkloadConfigView`/
 * `AnalyticsConfigView`/`NormalizationCurvesView`/
 * `PredictionWindowSettingsView`) — mismo bug de divergencia ya
 * confirmado en `holidays.ts`: `settings/workload-config` ya escribe en
 * Django desde la Fase 52, pero `workload.ts` seguía leyendo Postgres.
 *
 * Limitación deliberada, mismo criterio ya aceptado en la Fase 73
 * (`fetchDjangoWorkdayEndHour`): estos 4 endpoints Django solo devuelven
 * el valor EFECTIVO AHORA, no "vigente en una fecha pasada arbitraria"
 * (a diferencia de `getEffectiveConfigValue` original, que sí soportaba
 * `asOf` vía `SystemConfigHistory.validFrom/validUntil`). Los callers que
 * pasan una fecha pasada (ej. `workload.ts::businessBaseCore` con el
 * inicio de un mes histórico) siguen compilando igual, pero el valor
 * devuelto ya no varía según esa fecha — mismo trade-off aceptado en su
 * momento para `workday_end_hour`, documentado ahí como "gap aceptado".
 */

type DjangoWorkloadConfig = {
  hours_per_day: number;
  workload_limit_low: number;
  workload_limit_high: number;
  workload_limit_overload: number;
};

const FALLBACK_WORKLOAD_CONFIG = { hoursPerDay: 6.5, workloadLimitLow: 5.5, workloadLimitHigh: 7.5, workloadLimitOverload: 8.5 };

export async function fetchDjangoWorkloadLimits(): Promise<typeof FALLBACK_WORKLOAD_CONFIG> {
  const response = await djangoApiFetch("/settings/workload-config/");
  if (!response || !response.ok) return FALLBACK_WORKLOAD_CONFIG;
  const data = (await response.json()) as DjangoWorkloadConfig;
  return {
    hoursPerDay: data.hours_per_day,
    workloadLimitLow: data.workload_limit_low,
    workloadLimitHigh: data.workload_limit_high,
    workloadLimitOverload: data.workload_limit_overload,
  };
}

// ── Configuración del motor de Analytics ────────────────────────────────────

/** camelCase (TS) -> snake_case (clave interna Django) — mismas 26 claves en ambos lados. */
const ANALYTICS_CONFIG_KEY_MAP = {
  healthWeightCumplimiento: "health_weight_cumplimiento",
  healthWeightCarga: "health_weight_carga",
  healthWeightVencidas: "health_weight_vencidas",
  healthWeightConsistencia: "health_weight_consistencia",
  healthWeightCapacidad: "health_weight_capacidad",
  perfWeightCumplimiento: "perf_weight_cumplimiento",
  perfWeightVencidas: "perf_weight_vencidas",
  perfWeightConsistencia: "perf_weight_consistencia",
  perfWeightTrazabilidad: "perf_weight_trazabilidad",
  riskWeightSobrecarga: "risk_weight_sobrecarga",
  riskWeightVencidasCriticas: "risk_weight_vencidas_criticas",
  riskWeightTendenciaNegativa: "risk_weight_tendencia_negativa",
  riskWeightHorasExtra: "risk_weight_horas_extra",
  riskWeightBajaCapacidad: "risk_weight_baja_capacidad",
  riskWeightVariabilidad: "risk_weight_variabilidad",
  riskWeightConcentracion: "risk_weight_concentracion",
  riskWeightSinPlanificacion: "risk_weight_sin_planificacion",
  riskThresholdMedio: "risk_threshold_medio",
  riskThresholdAlto: "risk_threshold_alto",
  riskThresholdCritico: "risk_threshold_critico",
  alertOverdueTaskThreshold: "alert_overdue_task_threshold",
  alertConsecutiveOverloadDays: "alert_consecutive_overload_days",
  anomalyVariationThresholdPct: "anomaly_variation_threshold_pct",
  cacheTtlMinutes: "cache_ttl_minutes",
  predictionMinWeeksMedia: "prediction_min_weeks_media",
  predictionMinWeeksAlta: "prediction_min_weeks_alta",
} as const;

export type AnalyticsConfigKey = keyof typeof ANALYTICS_CONFIG_KEY_MAP;

export const ANALYTICS_CONFIG_DEFAULTS: Record<AnalyticsConfigKey, number> = {
  healthWeightCumplimiento: 25,
  healthWeightCarga: 25,
  healthWeightVencidas: 20,
  healthWeightConsistencia: 15,
  healthWeightCapacidad: 15,
  perfWeightCumplimiento: 35,
  perfWeightVencidas: 25,
  perfWeightConsistencia: 25,
  perfWeightTrazabilidad: 15,
  riskWeightSobrecarga: 22,
  riskWeightVencidasCriticas: 18,
  riskWeightTendenciaNegativa: 15,
  riskWeightHorasExtra: 12,
  riskWeightBajaCapacidad: 11,
  riskWeightVariabilidad: 10,
  riskWeightConcentracion: 7,
  riskWeightSinPlanificacion: 5,
  riskThresholdMedio: 31,
  riskThresholdAlto: 61,
  riskThresholdCritico: 81,
  alertOverdueTaskThreshold: 3,
  alertConsecutiveOverloadDays: 3,
  anomalyVariationThresholdPct: 30,
  cacheTtlMinutes: 15,
  predictionMinWeeksMedia: 2,
  predictionMinWeeksAlta: 4,
};

/** Límite máximo de proyección del motor de predicción — fijo por diseño, NO configurable desde Ajustes. */
export const PREDICTION_MAX_DAYS = 30;

function toNexoAnalyticsConfig(snakeConfig: Record<string, number>): Record<AnalyticsConfigKey, number> {
  const entries = Object.entries(ANALYTICS_CONFIG_KEY_MAP) as [AnalyticsConfigKey, string][];
  return Object.fromEntries(entries.map(([camel, snake]) => [camel, snakeConfig[snake] ?? ANALYTICS_CONFIG_DEFAULTS[camel]])) as Record<
    AnalyticsConfigKey,
    number
  >;
}

export async function fetchDjangoAnalyticsConfig(): Promise<Record<AnalyticsConfigKey, number>> {
  const response = await djangoApiFetch("/settings/analytics-config/");
  if (!response || !response.ok) return ANALYTICS_CONFIG_DEFAULTS;
  const data = (await response.json()) as { config: Record<string, number> };
  return toNexoAnalyticsConfig(data.config);
}

/** `response` es la del PATCH — llamar solo tras confirmar `response.ok`. */
export async function patchDjangoAnalyticsConfig(patch: Partial<Record<AnalyticsConfigKey, number>>) {
  const snakePatch = Object.fromEntries(
    Object.entries(patch).map(([camel, value]) => [ANALYTICS_CONFIG_KEY_MAP[camel as AnalyticsConfigKey], value])
  );
  return djangoApiFetch("/settings/analytics-config/", { method: "PATCH", body: JSON.stringify(snakePatch) });
}

// ── Curvas de normalización ──────────────────────────────────────────────────

export type CurveName = "cumplimiento" | "vencidas" | "carga" | "capacidad" | "consistencia" | "trazabilidad";
export type CurvePoint = { x: number; y: number };

export async function fetchDjangoNormalizationCurves(): Promise<Record<CurveName, CurvePoint[]> | null> {
  const response = await djangoApiFetch("/settings/normalization-curves/");
  if (!response || !response.ok) return null;
  const data = (await response.json()) as { curves: Record<CurveName, CurvePoint[]> };
  return data.curves;
}

export async function patchDjangoNormalizationCurve(name: CurveName, points: CurvePoint[]) {
  return djangoApiFetch("/settings/normalization-curves/", { method: "PATCH", body: JSON.stringify({ name, points }) });
}

// ── Ventana histórica del motor predictivo ───────────────────────────────────

const DEFAULT_PREDICTION_WINDOW_WEEKS = "3";

export async function fetchDjangoPredictionWindowWeeks(): Promise<string> {
  const response = await djangoApiFetch("/settings/prediction-window/");
  if (!response || !response.ok) return DEFAULT_PREDICTION_WINDOW_WEEKS;
  const data = (await response.json()) as { window_weeks: string };
  return data.window_weeks;
}

export async function putDjangoPredictionWindowWeeks(windowWeeks: string) {
  return djangoApiFetch("/settings/prediction-window/", { method: "PUT", body: JSON.stringify({ window_weeks: windowWeeks }) });
}
