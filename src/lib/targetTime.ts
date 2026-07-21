/**
 * Tiempo Objetivo (§Sprint 6) — funciones puras, sin acceso a BD, así que son
 * importables tanto desde componentes cliente como desde rutas de API/motor
 * de Analytics (mismo patrón que normalizationEngine.ts/analyticsExplain.ts).
 *
 * Concepto de negocio: el Tiempo Objetivo reemplaza la idea de "Horas
 * estimadas" como predicción subjetiva del colaborador por un estándar
 * operativo. Las Horas Reales (ejecución) y el Tiempo Objetivo (estándar)
 * son conceptos independientes que coexisten — ver Task.estimatedHours
 * (objetivo inicial) / Task.targetTimeValidated (objetivo validado) /
 * Task.realHours (ejecución, nunca tocada por este módulo).
 */

import type { Role } from "@/generated/prisma/client";

export const TARGET_TIME_TOOLTIP =
  "Tiempo esperado para completar la actividad en condiciones normales de trabajo. Es un estándar operativo, no una predicción personal.";

// ── Referencia oficial (§S6-B/S6-H) ──────────────────────────────────────────
// Mientras no exista validación, la referencia oficial sigue siendo el
// tiempo objetivo inicial — nunca se usa horas reales como estándar (§S6-E).

export type TargetTimeTask = { estimatedHours: number; targetTimeValidated: number | null };

export function isTargetTimeValidated(task: TargetTimeTask): boolean {
  return task.targetTimeValidated !== null;
}

export function getOfficialTargetTime(task: TargetTimeTask): number {
  return task.targetTimeValidated ?? task.estimatedHours;
}

// ── Desviación (§S6-B punto 4) ───────────────────────────────────────────────

export type Deviation = { hours: number; pct: number | null };

/** Desviación = Horas Reales − Tiempo Objetivo (validado si existe, si no inicial). `pct` es null si el objetivo es 0 (evita división por cero). */
export function computeDeviation(realHours: number, officialTarget: number): Deviation {
  const hours = Math.round((realHours - officialTarget) * 100) / 100;
  const pct = officialTarget > 0 ? Math.round((hours / officialTarget) * 100) : null;
  return { hours, pct };
}

// ── Validación por líderes (§S6-C) ───────────────────────────────────────────

export const CAN_VALIDATE_TARGET_TIME_ROLES: Role[] = ["ADMINISTRADOR", "JEFE_NACIONAL", "COORDINADOR_NACIONAL"];

/** Nunca el responsable de la tarea, sin importar su rol — ver §S6-B punto 2. */
export function canValidateTargetTime(role: Role, assignedToId: string, userId: string): boolean {
  return CAN_VALIDATE_TARGET_TIME_ROLES.includes(role) && assignedToId !== userId;
}

export const TARGET_TIME_REASON_OPTIONS = [
  "PROCEDIMIENTO_ESTANDAR",
  "COMPLEJIDAD_DETECTADA",
  "CAMBIO_ALCANCE",
  "REVISION_LIDER",
  "OTRO",
] as const;
export type TargetTimeAdjustReason = (typeof TARGET_TIME_REASON_OPTIONS)[number];

export const TARGET_TIME_REASON_LABEL: Record<TargetTimeAdjustReason, string> = {
  PROCEDIMIENTO_ESTANDAR: "Basado en procedimiento estándar",
  COMPLEJIDAD_DETECTADA: "Complejidad detectada",
  CAMBIO_ALCANCE: "Cambio de alcance",
  REVISION_LIDER: "Revisión del líder",
  OTRO: "Otro",
};

export function isValidTargetTimeReason(value: unknown): value is TargetTimeAdjustReason {
  return typeof value === "string" && (TARGET_TIME_REASON_OPTIONS as readonly string[]).includes(value);
}

// ── Precisión del Tiempo Objetivo (§S6-F) — NUEVO KPI, no reemplaza ninguno ──
// Fórmula: 1 − ABS(Horas Reales − Tiempo Objetivo) / Tiempo Objetivo

export type PrecisionClassification = "Excelente" | "Buena" | "Aceptable" | "Baja" | "Muy baja";

/** null si el objetivo es <= 0 (no se puede calcular precisión sin un objetivo válido). Resultado en puntos 0-100, puede ser 0 si la desviación es total o mayor. */
export function computePrecisionPct(realHours: number, officialTarget: number): number | null {
  if (officialTarget <= 0) return null;
  const raw = 1 - Math.abs(realHours - officialTarget) / officialTarget;
  return Math.round(Math.max(0, raw) * 1000) / 10; // 0-100, 1 decimal
}

export function precisionClassification(pct: number): PrecisionClassification {
  if (pct >= 90) return "Excelente";
  if (pct >= 75) return "Buena";
  if (pct >= 60) return "Aceptable";
  if (pct >= 40) return "Baja";
  return "Muy baja";
}

export const PRECISION_CLASS_COLOR: Record<PrecisionClassification, string> = {
  Excelente: "text-success",
  Buena: "text-success",
  Aceptable: "text-warning",
  Baja: "text-orange-500",
  "Muy baja": "text-danger",
};

// ── Desviación histórica del proceso (§S6-E) — nunca reemplaza el objetivo automáticamente ──

export type HistoricalDeviationInsight = {
  available: boolean;
  reason?: string;
  sampleSize?: number;
  avgRealHours?: number;
  diffPct?: number;
  recommendation?: string;
};

/** Compone el mensaje ejecutivo a partir de un promedio ya calculado — función pura, la consulta de los últimos N casos vive en targetTimeServer.ts (necesita BD). */
export function buildHistoricalDeviationInsight(sampleSize: number, avgRealHours: number, officialTarget: number): HistoricalDeviationInsight {
  if (sampleSize === 0 || officialTarget <= 0) {
    return { available: false, reason: "Sin historial suficiente de casos similares para comparar." };
  }
  const diffPct = Math.round(((avgRealHours - officialTarget) / officialTarget) * 100);
  const recommendation =
    diffPct > 15
      ? `El tiempo real promedio supera el objetivo en un ${diffPct}%. Se recomienda revisar el estándar del proceso.`
      : diffPct < -15
        ? `El tiempo real promedio está un ${Math.abs(diffPct)}% por debajo del objetivo. Se recomienda revisar si el estándar quedó sobreestimado.`
        : `El tiempo real promedio está alineado con el objetivo (diferencia de ${diffPct}%).`;
  return { available: true, sampleSize, avgRealHours: Math.round(avgRealHours * 100) / 100, diffPct, recommendation };
}
