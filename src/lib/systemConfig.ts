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

// Ventana histórica del motor predictivo (Sprint E — Analytics Predictivo) —
// semanas hacia atrás que Trend Engine/Prediction Engine usan como muestra.
// Global, un único valor para toda la plataforma, editable solo por
// Administrador (ver src/lib/predictiveConfig.ts).
export const CONFIG_KEY_PREDICTION_WINDOW_WEEKS = "prediction_window_weeks";
export const DEFAULT_PREDICTION_WINDOW_WEEKS = "3";

export async function getEffectivePredictionWindowWeeks(asOf: Date = new Date()): Promise<string> {
  return getEffectiveConfigString(CONFIG_KEY_PREDICTION_WINDOW_WEEKS, asOf, DEFAULT_PREDICTION_WINDOW_WEEKS);
}

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

// ── Sprint O — Centro de Configuración NEXO: 9 parámetros de bajo riesgo ────
//
// Cada uno reemplaza un literal hardcodeado (mismo valor por defecto, cero
// cambio de comportamiento hasta que un Administrador lo edite), siguiendo
// el mismo patrón CONFIG_KEY_*/DEFAULT_*/getEffective*/set* de arriba.

// Trabajo — ventana de registro retroactivo (antes: literal `2` en 4 sitios).
export const CONFIG_KEY_RETROACTIVE_WINDOW_DAYS = "retroactive_window_business_days";
export const DEFAULT_RETROACTIVE_WINDOW_DAYS = 2;

export async function getEffectiveRetroactiveWindowDays(asOf: Date = new Date()): Promise<number> {
  return getEffectiveConfigValue(CONFIG_KEY_RETROACTIVE_WINDOW_DAYS, asOf, DEFAULT_RETROACTIVE_WINDOW_DAYS);
}

export async function setRetroactiveWindowDays(days: number, userId: string): Promise<void> {
  await setConfigValue(CONFIG_KEY_RETROACTIVE_WINDOW_DAYS, String(days), userId);
}

// Trabajo — hora de corte de jornada usada por Capacidad Proyectada (antes: literal `17`).
export const CONFIG_KEY_WORKDAY_END_HOUR = "capacity_workday_end_hour_local";
export const DEFAULT_WORKDAY_END_HOUR = 17;

export async function getEffectiveWorkdayEndHour(asOf: Date = new Date()): Promise<number> {
  return getEffectiveConfigValue(CONFIG_KEY_WORKDAY_END_HOUR, asOf, DEFAULT_WORKDAY_END_HOUR);
}

export async function setWorkdayEndHour(hour: number, userId: string): Promise<void> {
  await setConfigValue(CONFIG_KEY_WORKDAY_END_HOUR, String(hour), userId);
}

// Escritorio Digital — retención de notas archivadas antes de purga (antes: literal `15`).
export const CONFIG_KEY_DESK_ARCHIVE_RETENTION_DAYS = "desk_archive_retention_days";
export const DEFAULT_DESK_ARCHIVE_RETENTION_DAYS = 15;

export async function getEffectiveDeskArchiveRetentionDays(asOf: Date = new Date()): Promise<number> {
  return getEffectiveConfigValue(CONFIG_KEY_DESK_ARCHIVE_RETENTION_DAYS, asOf, DEFAULT_DESK_ARCHIVE_RETENTION_DAYS);
}

export async function setDeskArchiveRetentionDays(days: number, userId: string): Promise<void> {
  await setConfigValue(CONFIG_KEY_DESK_ARCHIVE_RETENTION_DAYS, String(days), userId);
}

// Escritorio Digital — tope de respuestas cortas por nota (antes: literal `2`).
export const CONFIG_KEY_DESK_NOTE_MAX_REPLIES = "desk_note_max_replies";
export const DEFAULT_DESK_NOTE_MAX_REPLIES = 2;

export async function getEffectiveDeskNoteMaxReplies(asOf: Date = new Date()): Promise<number> {
  return getEffectiveConfigValue(CONFIG_KEY_DESK_NOTE_MAX_REPLIES, asOf, DEFAULT_DESK_NOTE_MAX_REPLIES);
}

export async function setDeskNoteMaxReplies(n: number, userId: string): Promise<void> {
  await setConfigValue(CONFIG_KEY_DESK_NOTE_MAX_REPLIES, String(n), userId);
}

// Escritorio Digital — presets de posposición de recordatorios, en minutos (antes: array hardcodeado).
export const CONFIG_KEY_SNOOZE_PRESETS_MINUTES = "desk_reminder_snooze_presets_minutes";
export const DEFAULT_SNOOZE_PRESETS_MINUTES = [15, 30, 60, 1440];

export async function getEffectiveSnoozePresetsMinutes(asOf: Date = new Date()): Promise<number[]> {
  const raw = await getEffectiveConfigString(CONFIG_KEY_SNOOZE_PRESETS_MINUTES, asOf, "");
  if (!raw) return DEFAULT_SNOOZE_PRESETS_MINUTES;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.every((n) => typeof n === "number" && Number.isFinite(n))
      ? parsed
      : DEFAULT_SNOOZE_PRESETS_MINUTES;
  } catch {
    return DEFAULT_SNOOZE_PRESETS_MINUTES;
  }
}

export async function setSnoozePresetsMinutes(minutes: number[], userId: string): Promise<void> {
  await setConfigValue(CONFIG_KEY_SNOOZE_PRESETS_MINUTES, JSON.stringify(minutes), userId);
}

// NOVA — TTL de caché de mensajes generados (Dashboard + Insights), antes duplicado como literal
// `4 * 60 * 60 * 1000` en 2 archivos. Par dedicado (no se mezcla con ANALYTICS_CONFIG_DEFAULTS
// porque Nova no es el motor de Analytics), mismo patrón que `cacheTtlMinutes` de ese motor.
export const CONFIG_KEY_NOVA_CACHE_TTL_MINUTES = "nova_cache_ttl_minutes";
export const DEFAULT_NOVA_CACHE_TTL_MINUTES = 240;

export async function getEffectiveNovaCacheTtlMinutes(asOf: Date = new Date()): Promise<number> {
  return getEffectiveConfigValue(CONFIG_KEY_NOVA_CACHE_TTL_MINUTES, asOf, DEFAULT_NOVA_CACHE_TTL_MINUTES);
}

export async function setNovaCacheTtlMinutes(minutes: number, userId: string): Promise<void> {
  await setConfigValue(CONFIG_KEY_NOVA_CACHE_TTL_MINUTES, String(minutes), userId);
}

// Seguridad — longitud mínima de contraseña (antes: literal `6` duplicado cliente/servidor).
export const CONFIG_KEY_PASSWORD_MIN_LENGTH = "password_min_length";
export const DEFAULT_PASSWORD_MIN_LENGTH = 6;

export async function getEffectivePasswordMinLength(asOf: Date = new Date()): Promise<number> {
  return getEffectiveConfigValue(CONFIG_KEY_PASSWORD_MIN_LENGTH, asOf, DEFAULT_PASSWORD_MIN_LENGTH);
}

export async function setPasswordMinLength(n: number, userId: string): Promise<void> {
  await setConfigValue(CONFIG_KEY_PASSWORD_MIN_LENGTH, String(n), userId);
}

// Seguridad — duración de sesión (antes: literales DURATION_DEFAULT_MS/DURATION_REMEMBER_MS en
// session.ts). Solo afecta sesiones NUEVAS — los JWT ya emitidos conservan su `exp` original.
export const CONFIG_KEY_SESSION_DURATION_DEFAULT_HOURS = "session_duration_default_hours";
export const DEFAULT_SESSION_DURATION_DEFAULT_HOURS = 168; // 7 días

export const CONFIG_KEY_SESSION_DURATION_REMEMBER_HOURS = "session_duration_remember_hours";
export const DEFAULT_SESSION_DURATION_REMEMBER_HOURS = 720; // 30 días

export async function getEffectiveSessionDurationDefaultHours(asOf: Date = new Date()): Promise<number> {
  return getEffectiveConfigValue(CONFIG_KEY_SESSION_DURATION_DEFAULT_HOURS, asOf, DEFAULT_SESSION_DURATION_DEFAULT_HOURS);
}

export async function setSessionDurationDefaultHours(hours: number, userId: string): Promise<void> {
  await setConfigValue(CONFIG_KEY_SESSION_DURATION_DEFAULT_HOURS, String(hours), userId);
}

export async function getEffectiveSessionDurationRememberHours(asOf: Date = new Date()): Promise<number> {
  return getEffectiveConfigValue(CONFIG_KEY_SESSION_DURATION_REMEMBER_HOURS, asOf, DEFAULT_SESSION_DURATION_REMEMBER_HOURS);
}

export async function setSessionDurationRememberHours(hours: number, userId: string): Promise<void> {
  await setConfigValue(CONFIG_KEY_SESSION_DURATION_REMEMBER_HOURS, String(hours), userId);
}

// Seguridad — retención de intentos de login expirados, en días (antes: literal `30`).
// Hermano de CONFIG_KEY_RETENTION_MONTHLY_REPORTS/ARCHIVED_TASKS/KNOWLEDGE_DOCS de arriba —
// mismo formato string por consistencia con esas 3 claves.
export const CONFIG_KEY_RETENTION_LOGIN_ATTEMPTS = "retention_login_attempts";
export const DEFAULT_RETENTION_LOGIN_ATTEMPTS = "30";

export async function getEffectiveRetentionLoginAttempts(asOf: Date = new Date()): Promise<string> {
  return getEffectiveConfigString(CONFIG_KEY_RETENTION_LOGIN_ATTEMPTS, asOf, DEFAULT_RETENTION_LOGIN_ATTEMPTS);
}

export async function setRetentionLoginAttempts(days: string, userId: string): Promise<void> {
  await setConfigValue(CONFIG_KEY_RETENTION_LOGIN_ATTEMPTS, days, userId);
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
  // Equilibrio Operativo (antes "Score de Salud Laboral" — Sprint Analytics 2.0) — ponderaciones (deben sumar 100).
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

// ── Matriz de Compatibilidad Operativa (motor determinista de recomendaciones) ──
//
// Cargos ADICIONALES (más allá del propio, siempre prioritario) con los que
// un cargo puede redistribuir carga cuando no hay nadie disponible del mismo
// cargo. Solo tiene efecto entre cargos del MISMO nivel jerárquico — esa
// validación vive en el caller (que sí conoce `ROLE_LEVEL`, ver
// `computeTeamRecommendations` en `analytics.ts`), deliberadamente fuera de
// este módulo, mismo criterio que `getAllEffectiveRoleTargets` ("el caller
// pasa la lista de roles, evita acoplar este módulo a roles.ts"). El sentido
// de cada entrada es direccional (guardado por separado del lado de cada
// cargo) — para compatibilidad mutua hay que configurar ambos lados.
// Vacío por defecto: sin configuración explícita, un cargo solo redistribuye
// con el mismo cargo (Regla 1), nunca se inventa compatibilidad.

function roleCompatibilityConfigKey(role: Role): string {
  return `analytics_role_compatibility_${role.toLowerCase()}`;
}

export async function getEffectiveRoleCompatibility(role: Role, asOf: Date = new Date()): Promise<Role[]> {
  const raw = await getEffectiveConfigString(roleCompatibilityConfigKey(role), asOf, "");
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((r): r is Role => typeof r === "string") : [];
  } catch {
    return [];
  }
}

/** Matriz completa para varios cargos a la vez — el caller pasa la lista de roles (mismo criterio que `getAllEffectiveRoleTargets`). */
export async function getAllEffectiveRoleCompatibility(roles: Role[], asOf: Date = new Date()): Promise<Record<Role, Role[]>> {
  const uniqueRoles = [...new Set(roles)];
  const entries = await Promise.all(uniqueRoles.map(async (role) => [role, await getEffectiveRoleCompatibility(role, asOf)] as const));
  return Object.fromEntries(entries) as Record<Role, Role[]>;
}

export async function setRoleCompatibility(role: Role, compatibleRoles: Role[], userId: string): Promise<void> {
  await setConfigValue(roleCompatibilityConfigKey(role), JSON.stringify(compatibleRoles), userId);
}
