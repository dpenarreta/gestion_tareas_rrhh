import "server-only";
import { prisma } from "@/lib/prisma";
import { DEFAULT_CURVES, isValidCurve, type CurveName, type CurvePoint } from "@/lib/normalizationEngine";
import type { Role } from "@/generated/prisma/client";

export const CONFIG_KEY_HORAS_EFECTIVAS = "HORAS_EFECTIVAS_DIA";
export const DEFAULT_HORAS_EFECTIVAS = 6.5;

// Los 4 límites del semáforo de carga laboral son independientes entre sí
// (no derivados de base ± tolerancia) para evitar que un cambio en uno
// desalinee silenciosamente los demás — cada uno se guarda y edita por separado.
export const CONFIG_KEY_WORKLOAD_LIMIT_LOW = "workload_limit_low";
export const DEFAULT_WORKLOAD_LIMIT_LOW = 5.5;

export const CONFIG_KEY_WORKLOAD_LIMIT_HIGH = "workload_limit_high";
export const DEFAULT_WORKLOAD_LIMIT_HIGH = 7.5;

export const CONFIG_KEY_WORKLOAD_LIMIT_OVERLOAD = "workload_limit_overload";
export const DEFAULT_WORKLOAD_LIMIT_OVERLOAD = 8.5;

// Política de retención de datos (LOPDP) — meses como string ("6"/"12"/"24"/"36"),
// o "indefinite" para la base de conocimiento cuando no hay fecha límite.
export const CONFIG_KEY_RETENTION_MONTHLY_REPORTS = "retention_monthly_reports";
export const DEFAULT_RETENTION_MONTHLY_REPORTS = "24";

export const CONFIG_KEY_RETENTION_ARCHIVED_TASKS = "retention_archived_tasks";
export const DEFAULT_RETENTION_ARCHIVED_TASKS = "24";

export const CONFIG_KEY_RETENTION_KNOWLEDGE_DOCS = "retention_knowledge_docs";
export const DEFAULT_RETENTION_KNOWLEDGE_DOCS = "indefinite";

// Mensaje de bienvenida configurable por el Admin, mostrado como tarjeta en el Dashboard de todos.
export const CONFIG_KEY_WELCOME_MESSAGE = "welcome_message";
export const CONFIG_KEY_WELCOME_MESSAGE_ACTIVE = "welcome_message_active";

// Centro de Recuperación (§14) — período de retención de la papelera antes de
// la purga automática, en horas, para TODOS los módulos registrados (no hay
// un valor por módulo: es una única política de plataforma). Mismo mecanismo
// que el resto de esta configuración — ver src/lib/recoveryCenter.ts.
export const CONFIG_KEY_RECOVERY_RETENTION_HOURS = "recovery_center_retention_hours";
export const DEFAULT_RECOVERY_RETENTION_HOURS = 48;

/** Value in effect for `key` at `asOf` (defaults to now). Falls back to `fallback` if no history exists yet. */
export async function getEffectiveConfigValue(
  key: string,
  asOf: Date = new Date(),
  fallback: number = 0
): Promise<number> {
  const record = await prisma.systemConfigHistory.findFirst({
    where: {
      key,
      validFrom: { lte: asOf },
      OR: [{ validUntil: null }, { validUntil: { gt: asOf } }],
    },
    orderBy: { validFrom: "desc" },
  });
  if (!record) return fallback;
  const parsed = parseFloat(record.value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export async function getEffectiveHorasEfectivas(asOf: Date = new Date()): Promise<number> {
  return getEffectiveConfigValue(CONFIG_KEY_HORAS_EFECTIVAS, asOf, DEFAULT_HORAS_EFECTIVAS);
}

export async function getEffectiveWorkloadLimitLow(asOf: Date = new Date()): Promise<number> {
  return getEffectiveConfigValue(CONFIG_KEY_WORKLOAD_LIMIT_LOW, asOf, DEFAULT_WORKLOAD_LIMIT_LOW);
}

export async function getEffectiveWorkloadLimitHigh(asOf: Date = new Date()): Promise<number> {
  return getEffectiveConfigValue(CONFIG_KEY_WORKLOAD_LIMIT_HIGH, asOf, DEFAULT_WORKLOAD_LIMIT_HIGH);
}

export async function getEffectiveWorkloadLimitOverload(asOf: Date = new Date()): Promise<number> {
  return getEffectiveConfigValue(CONFIG_KEY_WORKLOAD_LIMIT_OVERLOAD, asOf, DEFAULT_WORKLOAD_LIMIT_OVERLOAD);
}

/** Igual que `getEffectiveConfigValue` pero para valores que no son numéricos (ej. "indefinite"). */
export async function getEffectiveConfigString(
  key: string,
  asOf: Date = new Date(),
  fallback: string
): Promise<string> {
  const record = await prisma.systemConfigHistory.findFirst({
    where: {
      key,
      validFrom: { lte: asOf },
      OR: [{ validUntil: null }, { validUntil: { gt: asOf } }],
    },
    orderBy: { validFrom: "desc" },
  });
  return record ? record.value : fallback;
}

export async function getEffectiveRetentionMonthlyReports(asOf: Date = new Date()): Promise<string> {
  return getEffectiveConfigString(CONFIG_KEY_RETENTION_MONTHLY_REPORTS, asOf, DEFAULT_RETENTION_MONTHLY_REPORTS);
}

export async function getEffectiveRetentionArchivedTasks(asOf: Date = new Date()): Promise<string> {
  return getEffectiveConfigString(CONFIG_KEY_RETENTION_ARCHIVED_TASKS, asOf, DEFAULT_RETENTION_ARCHIVED_TASKS);
}

export async function getEffectiveRetentionKnowledgeDocs(asOf: Date = new Date()): Promise<string> {
  return getEffectiveConfigString(CONFIG_KEY_RETENTION_KNOWLEDGE_DOCS, asOf, DEFAULT_RETENTION_KNOWLEDGE_DOCS);
}

export async function getEffectiveWelcomeMessage(asOf: Date = new Date()): Promise<string> {
  return getEffectiveConfigString(CONFIG_KEY_WELCOME_MESSAGE, asOf, "");
}

export async function getEffectiveWelcomeMessageActive(asOf: Date = new Date()): Promise<boolean> {
  return (await getEffectiveConfigString(CONFIG_KEY_WELCOME_MESSAGE_ACTIVE, asOf, "false")) === "true";
}

export async function getEffectiveRecoveryRetentionHours(asOf: Date = new Date()): Promise<number> {
  return getEffectiveConfigValue(CONFIG_KEY_RECOVERY_RETENTION_HOURS, asOf, DEFAULT_RECOVERY_RETENTION_HOURS);
}

export async function setRecoveryRetentionHours(hours: number, userId: string): Promise<void> {
  await setConfigValue(CONFIG_KEY_RECOVERY_RETENTION_HOURS, String(hours), userId);
}

// ── Configuración del motor de Analytics (src/lib/analytics.ts) ─────────────
//
// Todos los umbrales/ponderaciones del motor son configurables desde Ajustes
// (Administrador, Jefe Nacional, Coordinador Nacional) sin tocar código — ver
// Analytics § Configuración centralizada. Cada valor se guarda en
// SystemConfigHistory (misma tabla/mecanismo que horas efectivas arriba), así
// que el historial de cambios (usuario, fecha, valor anterior/nuevo) ya viene
// incluido gratis por `setConfigValue` — no hace falta una tabla de auditoría
// aparte para los cambios de configuración.
export const ANALYTICS_CONFIG_DEFAULTS = {
  // Score de Salud Laboral (LEGACY, ver Sprint 5 § S5-A) — ponderaciones (deben sumar 100).
  healthWeightCumplimiento: 25,
  healthWeightCarga: 25,
  healthWeightVencidas: 20,
  healthWeightConsistencia: 15,
  healthWeightCapacidad: 15,
  // Performance Score (§Sprint 5 S5-B) — ponderaciones (deben sumar 100).
  // NO incluye carga/capacidad/riesgo — esas viven en Operational Risk.
  perfWeightCumplimiento: 35,
  perfWeightVencidas: 25,
  perfWeightConsistencia: 25,
  perfWeightTrazabilidad: 15,
  // Índice de Riesgo Operativo — ponderaciones (deben sumar 100).
  riskWeightSobrecarga: 22,
  riskWeightVencidasCriticas: 18,
  riskWeightTendenciaNegativa: 15,
  riskWeightHorasExtra: 12,
  riskWeightBajaCapacidad: 11,
  riskWeightVariabilidad: 10,
  riskWeightConcentracion: 7,
  riskWeightSinPlanificacion: 5,
  // Índice de Riesgo Operativo — límites inferiores de cada banda (0 a este valor = banda anterior).
  riskThresholdMedio: 31,
  riskThresholdAlto: 61,
  riskThresholdCritico: 81,
  // Motor de alertas.
  alertOverdueTaskThreshold: 3,
  alertConsecutiveOverloadDays: 3,
  anomalyVariationThresholdPct: 30,
  // Caché y predicción.
  cacheTtlMinutes: 15,
  predictionMinWeeksMedia: 2,
  predictionMinWeeksAlta: 4,
} as const;

export type AnalyticsConfigKey = keyof typeof ANALYTICS_CONFIG_DEFAULTS;

const ANALYTICS_CONFIG_KEYS: Record<AnalyticsConfigKey, string> = {
  healthWeightCumplimiento: "analytics_health_weight_cumplimiento",
  healthWeightCarga: "analytics_health_weight_carga",
  healthWeightVencidas: "analytics_health_weight_vencidas",
  healthWeightConsistencia: "analytics_health_weight_consistencia",
  healthWeightCapacidad: "analytics_health_weight_capacidad",
  perfWeightCumplimiento: "analytics_perf_weight_cumplimiento",
  perfWeightVencidas: "analytics_perf_weight_vencidas",
  perfWeightConsistencia: "analytics_perf_weight_consistencia",
  perfWeightTrazabilidad: "analytics_perf_weight_trazabilidad",
  riskWeightSobrecarga: "analytics_risk_weight_sobrecarga",
  riskWeightVencidasCriticas: "analytics_risk_weight_vencidas_criticas",
  riskWeightTendenciaNegativa: "analytics_risk_weight_tendencia_negativa",
  riskWeightHorasExtra: "analytics_risk_weight_horas_extra",
  riskWeightBajaCapacidad: "analytics_risk_weight_baja_capacidad",
  riskWeightVariabilidad: "analytics_risk_weight_variabilidad",
  riskWeightConcentracion: "analytics_risk_weight_concentracion",
  riskWeightSinPlanificacion: "analytics_risk_weight_sin_planificacion",
  riskThresholdMedio: "analytics_risk_threshold_medio",
  riskThresholdAlto: "analytics_risk_threshold_alto",
  riskThresholdCritico: "analytics_risk_threshold_critico",
  alertOverdueTaskThreshold: "analytics_alert_overdue_task_threshold",
  alertConsecutiveOverloadDays: "analytics_alert_consecutive_overload_days",
  anomalyVariationThresholdPct: "analytics_anomaly_variation_threshold_pct",
  cacheTtlMinutes: "analytics_cache_ttl_minutes",
  predictionMinWeeksMedia: "analytics_prediction_min_weeks_media",
  predictionMinWeeksAlta: "analytics_prediction_min_weeks_alta",
};

/** Límite máximo de proyección del motor de predicción — fijo por diseño (la precisión cae demasiado más allá), NO configurable desde Ajustes. */
export const PREDICTION_MAX_DAYS = 30;

/** Config completa del motor de Analytics vigente en `asOf`, en una sola tanda de queries paralelas. */
export async function getEffectiveAnalyticsConfig(asOf: Date = new Date()): Promise<Record<AnalyticsConfigKey, number>> {
  const entries = Object.entries(ANALYTICS_CONFIG_KEYS) as [AnalyticsConfigKey, string][];
  const values = await Promise.all(
    entries.map(([name, key]) => getEffectiveConfigValue(key, asOf, ANALYTICS_CONFIG_DEFAULTS[name]))
  );
  return Object.fromEntries(entries.map(([name], i) => [name, values[i]])) as Record<AnalyticsConfigKey, number>;
}

export async function setAnalyticsConfigValue(name: AnalyticsConfigKey, value: number, userId: string): Promise<void> {
  await setConfigValue(ANALYTICS_CONFIG_KEYS[name], String(value), userId);
}

/** Closes the currently-open history record (if any) and opens a new one, effective now. */
export async function setConfigValue(key: string, value: string, userId: string): Promise<void> {
  const now = new Date();
  await prisma.$transaction([
    prisma.systemConfigHistory.updateMany({
      where: { key, validUntil: null },
      data: { validUntil: now },
    }),
    prisma.systemConfigHistory.create({
      data: { key, value, validFrom: now, validUntil: null, updatedBy: userId },
    }),
  ]);
}

// ── Curvas de normalización (§Sprint 5 S5-E) ─────────────────────────────────
//
// Cada curva se guarda como JSON (array de {x,y}) en SystemConfigHistory, vía
// el mismo mecanismo de arriba — sin cambios de esquema. Reutilizar
// setConfigValue da el historial (usuario/fecha/valor anterior) gratis.

const CURVE_CONFIG_KEY: Record<CurveName, string> = {
  cumplimiento: "analytics_curve_cumplimiento",
  vencidas: "analytics_curve_vencidas",
  carga: "analytics_curve_carga",
  capacidad: "analytics_curve_capacidad",
  consistencia: "analytics_curve_consistencia",
  trazabilidad: "analytics_curve_trazabilidad",
};

export async function getEffectiveCurve(name: CurveName, asOf: Date = new Date()): Promise<CurvePoint[]> {
  const raw = await getEffectiveConfigString(CURVE_CONFIG_KEY[name], asOf, "");
  if (!raw) return DEFAULT_CURVES[name];
  try {
    const parsed = JSON.parse(raw);
    return isValidCurve(parsed) ? parsed : DEFAULT_CURVES[name];
  } catch {
    return DEFAULT_CURVES[name];
  }
}

export async function getAllEffectiveCurves(asOf: Date = new Date()): Promise<Record<CurveName, CurvePoint[]>> {
  const names = Object.keys(CURVE_CONFIG_KEY) as CurveName[];
  const values = await Promise.all(names.map((n) => getEffectiveCurve(n, asOf)));
  return Object.fromEntries(names.map((n, i) => [n, values[i]])) as Record<CurveName, CurvePoint[]>;
}

export async function setCurveConfig(name: CurveName, points: CurvePoint[], userId: string): Promise<void> {
  if (!isValidCurve(points)) throw new Error("Curva inválida: se requieren al menos 2 puntos con x/y finitos e y en [0,100]");
  await setConfigValue(CURVE_CONFIG_KEY[name], JSON.stringify(points), userId);
}

// ── Versión del motor (§Sprint 5 S5-L) ───────────────────────────────────────
// Reutiliza el mismo historial de SystemConfigHistory — fecha/usuario/valor
// anterior quedan registrados gratis por setConfigValue. Se compara de forma
// perezosa (la próxima vez que alguien abra Diagnóstico del Motor) contra la
// versión actual del código; si difieren, se registra el cambio una sola vez.
const CONFIG_KEY_ENGINE_VERSION = "analytics_engine_version_seen";

export async function recordEngineVersionIfChanged(currentVersion: string, userId: string): Promise<{ previousVersion: string | null; changed: boolean }> {
  const previous = await getEffectiveConfigString(CONFIG_KEY_ENGINE_VERSION, new Date(), "");
  if (previous === currentVersion) return { previousVersion: previous || null, changed: false };
  await setConfigValue(CONFIG_KEY_ENGINE_VERSION, currentVersion, userId);
  return { previousVersion: previous || null, changed: true };
}

// ── Objetivo esperado del cargo (§Sprint 7) ──────────────────────────────────
//
// Configuración OPCIONAL por cargo (Role), usada únicamente como referencia
// en el Benchmark Personal (Nivel 3, cargo único) — NUNCA modifica el cálculo
// de ningún KPI. Si un cargo no tiene objetivo configurado, el motor debe
// ocultar esa comparación (nunca mostrar un valor ficticio) — por eso
// `getEffectiveRoleTarget` devuelve `null` en vez de un objeto con ceros.
// Mismo mecanismo que las curvas de normalización: JSON en SystemConfigHistory,
// el historial de cambios (usuario/fecha/valor anterior) viene gratis.

export type RoleTarget = {
  /** Performance Score esperado (0-100), o null si no se configuró. */
  performance: number | null;
  /** Índice de Riesgo Operativo MÁXIMO esperado (0-100) — más alto que esto se considera fuera de objetivo. */
  riesgoMax: number | null;
  /** % de cumplimiento esperado (0-100), o null si no se configuró. */
  cumplimiento: number | null;
};

function roleTargetConfigKey(role: Role): string {
  return `analytics_role_target_${role.toLowerCase()}`;
}

/** `null` si el cargo nunca fue configurado — el caller debe ocultar la comparación, nunca inventar un objetivo. */
export async function getEffectiveRoleTarget(role: Role, asOf: Date = new Date()): Promise<RoleTarget | null> {
  const raw = await getEffectiveConfigString(roleTargetConfigKey(role), asOf, "");
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const p = parsed as Record<string, unknown>;
    return {
      performance: typeof p.performance === "number" && Number.isFinite(p.performance) ? p.performance : null,
      riesgoMax: typeof p.riesgoMax === "number" && Number.isFinite(p.riesgoMax) ? p.riesgoMax : null,
      cumplimiento: typeof p.cumplimiento === "number" && Number.isFinite(p.cumplimiento) ? p.cumplimiento : null,
    };
  } catch {
    return null;
  }
}

/** Objetivos configurados para varios cargos a la vez — el caller pasa la lista de roles (evita acoplar este módulo a roles.ts). */
export async function getAllEffectiveRoleTargets(roles: Role[], asOf: Date = new Date()): Promise<Partial<Record<Role, RoleTarget>>> {
  const entries = await Promise.all(roles.map(async (role) => [role, await getEffectiveRoleTarget(role, asOf)] as const));
  const result: Partial<Record<Role, RoleTarget>> = {};
  for (const [role, target] of entries) {
    if (target) result[role] = target;
  }
  return result;
}

export async function setRoleTarget(role: Role, target: RoleTarget, userId: string): Promise<void> {
  await setConfigValue(roleTargetConfigKey(role), JSON.stringify(target), userId);
}
