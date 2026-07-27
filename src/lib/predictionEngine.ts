import "server-only";
import { prisma } from "@/lib/prisma";
import { businessCalendarDay } from "@/lib/businessTime";
import { monthlyBusinessBase, countBusinessDays } from "@/lib/workload";
import { getHolidaySet } from "@/lib/holidays";
import { isTaskOverdue } from "@/lib/utils";
import { computeWeeklyHistory, computeConsistency, computeDataQuality, type ConsistencyLevel } from "@/lib/analytics";
import { computeCapacityForecast, computeTeamCapacityForecast, type CapacityEstado } from "@/lib/capacityForecast";
import { computeTrendEngine } from "@/lib/trendEngine";
import { getEffectivePredictionWindowWeeksNumber } from "@/lib/predictiveConfig";

/**
 * Prediction Engine (Sprint E) — 4 predicciones explicables (Cumplimiento,
 * Sobrecarga, Subutilización, Retrasos) + Estabilidad Operativa, todas
 * reglas determinísticas sobre datos ya calculados por analytics.ts/
 * capacityForecast.ts/trendEngine.ts. Sin IA, sin persistencia de negocio
 * nueva (solo lee).
 *
 * `computeMonthlyCompliancePace` (analytics.ts) es privada y de ventana fija
 * (mes en curso) — no puede reutilizarse para una proyección de ventana
 * configurable sin tocar un archivo de fórmulas protegido, así que la pace
 * de Cumplimiento se recalcula aquí de forma independiente (misma idea,
 * implementación separada — ver docs/AUDIT_LOG.md § Sprint E).
 */
export const PREDICTION_ENGINE_VERSION = "1.0.0";

export const PREDICTION_HORIZONS = [7, 15, 30, 90] as const;
export type PredictionHorizon = (typeof PREDICTION_HORIZONS)[number];

/** El horizonte fijo más cercano a `daysRemaining` — nunca se devuelve un horizonte fuera de {7,15,30,90} (§Bloque 11). */
export function nearestHorizon(daysRemaining: number): PredictionHorizon {
  let best: PredictionHorizon = PREDICTION_HORIZONS[0];
  let bestDiff = Infinity;
  for (const h of PREDICTION_HORIZONS) {
    const diff = Math.abs(h - daysRemaining);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = h;
    }
  }
  return best;
}

export type HistoricalReliability = "alta" | "media" | "baja";

/**
 * Confiabilidad del histórico — volumen de semanas + calidad de datos
 * ACTUAL. Deliberadamente un eje distinto de `confidencePct` (§Bloque 13:
 * "no debe confundirse con el nivel de confianza") — dos preguntas
 * distintas: "¿cuánta información hay?" vs. "¿qué tan seguro está el
 * modelo de esta predicción puntual?".
 */
export function computeHistoricalReliability(weeksOfData: number, dataQualityPct: number): HistoricalReliability {
  const volumeScore = Math.min(1, weeksOfData / 6);
  const qualityScore = Math.max(0, Math.min(1, dataQualityPct / 100));
  const composite = 0.6 * volumeScore + 0.4 * qualityScore;
  if (composite >= 0.75) return "alta";
  if (composite >= 0.45) return "media";
  return "baja";
}

/** Mismo espíritu de pesos que `computePredictionConfidencePct` (analytics.ts) — 40% datos / 40% consistencia / 20% horizonte — pero parametrizado contra el set fijo {7,15,30,90} en vez de la constante protegida PREDICTION_MAX_DAYS=30, para no tratar todo horizonte >30 días como idéntico. Nunca 100%: mismo tope 92%. */
export function computePredictionConfidence(args: { dataScore: number; consistencyScore: number; horizon: PredictionHorizon }): number {
  const MAX_CONFIDENCE_PCT = 92;
  const maxHorizon = PREDICTION_HORIZONS[PREDICTION_HORIZONS.length - 1];
  const horizonScore = 1 - (args.horizon / maxHorizon) * 0.4;
  return Math.round(MAX_CONFIDENCE_PCT * (0.4 * args.dataScore + 0.4 * args.consistencyScore + 0.2 * horizonScore));
}

function consistencyScoreFromLevel(level: ConsistencyLevel | null): number {
  if (level === "muy-consistente") return 1;
  if (level === "consistente") return 0.8;
  if (level === "variable") return 0.5;
  if (level === "muy-variable") return 0.25;
  return 0.5; // sin historial suficiente — mismo neutro que el resto del motor.
}

export type ExplainablePrediction = {
  horizon: PredictionHorizon;
  confidencePct: number;
  historicalReliability: HistoricalReliability;
  historicalWindowWeeks: number;
  queOcurrira: string;
  porQue: string;
  datosUtilizados: string[];
  variablesConMayorImpacto: string[];
  queHacer: string[];
};

function monthBounds(year: number, month: number) {
  return { start: new Date(year, month - 1, 1), end: new Date(year, month, 0, 23, 59, 59, 999) };
}

async function daysRemainingInMonth(now: Date): Promise<number> {
  const today = businessCalendarDay(now);
  const { end } = monthBounds(today.getUTCFullYear(), today.getUTCMonth() + 1);
  return Math.max(0, Math.round((end.getTime() - today.getTime()) / 86400000));
}

// ── Bloque 3 — Predicción de Cumplimiento ───────────────────────────────────

export type CumplimientoProjection =
  | { available: false; reason: string }
  | (ExplainablePrediction & { available: true; cumplimientoEsperadoCierrePct: number; variacionEsperadaPct: number });

export async function computeCumplimientoProjection(userId: string, now: Date = new Date()): Promise<CumplimientoProjection> {
  const windowWeeks = await getEffectivePredictionWindowWeeksNumber(now);
  const today = businessCalendarDay(now);
  const year = today.getUTCFullYear();
  const month = today.getUTCMonth() + 1;

  const [weekly, biz, holidays, consistency, dataQuality] = await Promise.all([
    computeWeeklyHistory(userId, windowWeeks, now),
    monthlyBusinessBase(year, month),
    getHolidaySet(),
    computeConsistency(userId, now),
    computeDataQuality([userId]),
  ]);

  const withData = weekly.filter((w) => w.businessDays > 0);
  if (withData.length < 1) return { available: false, reason: "Sin historial suficiente para proyectar el cumplimiento" };

  const elapsedBusinessDays = countBusinessDays(biz.start, today, holidays);
  const monthTasks = await prisma.task.findMany({
    where: { assignedToId: userId, endDate: { gte: biz.start, lte: biz.end } },
    select: { status: true },
  });
  const currentCompletedPct = monthTasks.length > 0 ? Math.round((monthTasks.filter((t) => t.status === "COMPLETADA").length / monthTasks.length) * 100) : 0;
  const cumplimientoEsperadoCierrePct =
    monthTasks.length === 0 || elapsedBusinessDays === 0
      ? currentCompletedPct
      : Math.min(100, Math.round(currentCompletedPct * (biz.businessDays / elapsedBusinessDays)));

  const windowAvgPct = Math.round(withData.reduce((s, w) => s + w.completedPct, 0) / withData.length);
  const variacionEsperadaPct = cumplimientoEsperadoCierrePct - windowAvgPct;

  const daysRemaining = await daysRemainingInMonth(now);
  const horizon = nearestHorizon(daysRemaining);
  const confidencePct = computePredictionConfidence({
    dataScore: Math.min(1, withData.length / windowWeeks),
    consistencyScore: consistencyScoreFromLevel(consistency.available ? consistency.level : null),
    horizon,
  });
  const historicalReliability = computeHistoricalReliability(withData.length, dataQuality.pct);

  return {
    available: true,
    horizon,
    confidencePct,
    historicalReliability,
    historicalWindowWeeks: windowWeeks,
    cumplimientoEsperadoCierrePct,
    variacionEsperadaPct,
    queOcurrira: `El cumplimiento esperado al cierre del mes es ${cumplimientoEsperadoCierrePct}%.`,
    porQue: `Con ${elapsedBusinessDays} de ${biz.businessDays} días hábiles transcurridos y ${currentCompletedPct}% completado hasta hoy, el ritmo actual proyecta ${cumplimientoEsperadoCierrePct}% al cierre — ${variacionEsperadaPct >= 0 ? "por encima" : "por debajo"} del promedio de las últimas ${windowWeeks} semanas (${windowAvgPct}%).`,
    datosUtilizados: [
      `Historial semanal de cumplimiento (últimas ${windowWeeks} semanas)`,
      `Días hábiles transcurridos/totales del mes en curso (${elapsedBusinessDays}/${biz.businessDays})`,
      `Consistencia operativa (${consistency.available ? consistency.label : "sin historial suficiente"})`,
    ],
    variablesConMayorImpacto: ["Ritmo de cumplimiento del mes en curso", `Promedio de cumplimiento de las últimas ${windowWeeks} semanas`],
    queHacer:
      variacionEsperadaPct < 0
        ? ["Priorizar el cierre de tareas pendientes antes del fin de mes.", "Revisar tareas de prioridad Alta próximas a vencer."]
        : ["Mantener el ritmo actual de cierre de tareas."],
  };
}

// ── Bloque 4 — Predicción de Sobrecarga ─────────────────────────────────────

export type SobrecargaPrediction =
  | { available: false; reason: string }
  | (ExplainablePrediction & { available: true; probabilidadPct: number; nivel: "Alto" | "Medio" | "Bajo" });

const CAPACITY_BASE_PROBABILITY: Record<CapacityEstado, number> = {
  sobrecarga: 90,
  "no-asignar": 65,
  limitada: 35,
  alta: 10,
  "sin-planificacion": 20,
};

export async function computeSobrecargaProbability(userId: string, now: Date = new Date()): Promise<SobrecargaPrediction> {
  const windowWeeks = await getEffectivePredictionWindowWeeksNumber(now);
  const [capacity, consistency, trend, dataQuality] = await Promise.all([
    computeCapacityForecast(userId, now),
    computeConsistency(userId, now),
    computeTrendEngine(userId, now),
    computeDataQuality([userId]),
  ]);

  let probabilidadPct = CAPACITY_BASE_PROBABILITY[capacity.estado];
  const variables: string[] = ["Estado de capacidad disponible proyectada"];

  const capacidadTrend = trend.indicators.capacidad_disponible;
  if (capacidadTrend.available && capacidadTrend.direction === "negativa") {
    probabilidadPct = Math.min(100, probabilidadPct + 10);
    variables.push("Tendencia decreciente de capacidad disponible");
  } else if (capacidadTrend.available && capacidadTrend.direction === "positiva") {
    probabilidadPct = Math.max(0, probabilidadPct - 10);
  }
  if (consistency.available && consistency.level === "muy-variable") {
    probabilidadPct = Math.min(100, probabilidadPct + 5);
    variables.push("Alta variabilidad en la carga semanal");
  }

  const nivel: "Alto" | "Medio" | "Bajo" = probabilidadPct >= 70 ? "Alto" : probabilidadPct >= 40 ? "Medio" : "Bajo";
  const daysRemaining = await daysRemainingInMonth(now);
  const horizon = nearestHorizon(daysRemaining);
  const confidencePct = computePredictionConfidence({
    dataScore: capacidadTrend.available ? Math.min(1, capacidadTrend.dataPoints.length / 4) : 0.3,
    consistencyScore: consistencyScoreFromLevel(consistency.available ? consistency.level : null),
    horizon,
  });
  const historicalReliability = computeHistoricalReliability(windowWeeks, dataQuality.pct);

  return {
    available: true,
    horizon,
    confidencePct,
    historicalReliability,
    historicalWindowWeeks: windowWeeks,
    probabilidadPct,
    nivel,
    queOcurrira: `Probabilidad de sobrecarga operativa: ${probabilidadPct}% (nivel ${nivel}).`,
    porQue: `Estado actual de capacidad: "${capacity.estadoLabel}" (${capacity.disponiblePct}% disponible)${capacidadTrend.available ? `, con tendencia ${capacidadTrend.direction}` : ""}.`,
    datosUtilizados: ["Capacidad disponible proyectada (mes en curso)", "Tendencia de capacidad disponible", "Consistencia operativa"],
    variablesConMayorImpacto: variables,
    queHacer:
      nivel !== "Bajo"
        ? ["Redistribuir tareas pendientes/en progreso para evitar la sobrecarga proyectada.", "Evitar asignar nuevas tareas hasta liberar capacidad."]
        : ["Sin acción preventiva necesaria por ahora."],
  };
}

// ── Bloque 5 — Predicción de Subutilización (equipo) ────────────────────────

export type SubutilizacionPrediction = ExplainablePrediction & { nivel: "Alto" | "Medio" | "Bajo" };

/** Batch — SIEMPRE usa `computeTeamCapacityForecast` (ya agrupado), nunca en loop la función singular (riesgo N+1). */
export async function computeSubutilizacionPredictions(userIds: string[], now: Date = new Date()): Promise<Map<string, SubutilizacionPrediction>> {
  const result = new Map<string, SubutilizacionPrediction>();
  if (userIds.length === 0) return result;

  const windowWeeks = await getEffectivePredictionWindowWeeksNumber(now);
  const capacityMap = await computeTeamCapacityForecast(userIds, now);
  const daysRemaining = await daysRemainingInMonth(now);
  const horizon = nearestHorizon(daysRemaining);

  for (const userId of userIds) {
    const capacity = capacityMap.get(userId);
    if (!capacity) continue;
    const nivel: "Alto" | "Medio" | "Bajo" = capacity.disponiblePct >= 70 ? "Alto" : capacity.disponiblePct >= 40 ? "Medio" : "Bajo";
    const confidencePct = computePredictionConfidence({
      dataScore: capacity.confiabilidad.pct / 100,
      consistencyScore: 0.5,
      horizon,
    });
    result.set(userId, {
      horizon,
      confidencePct,
      historicalReliability: capacity.confiabilidad.pct >= 75 ? "alta" : capacity.confiabilidad.pct >= 45 ? "media" : "baja",
      historicalWindowWeeks: windowWeeks,
      nivel,
      queOcurrira: `Proyección de subutilización: nivel ${nivel} (${capacity.disponiblePct}% de capacidad disponible proyectada).`,
      porQue: `Capacidad disponible proyectada para lo que resta del mes: ${capacity.disponible}h de ${capacity.baseFuturaTotal}h (${capacity.disponiblePct}%), con solo ${capacity.comprometidoFuturo}h comprometidas.`,
      datosUtilizados: ["Capacidad disponible proyectada (mes en curso)", "Horas comprometidas futuras (tareas pendientes/en progreso)"],
      variablesConMayorImpacto: ["% de capacidad disponible proyectada"],
      queHacer: nivel !== "Bajo" ? ["Evaluar asignar nuevas tareas o redistribuir carga hacia este colaborador."] : ["Sin acción necesaria."],
    });
  }
  return result;
}

// ── Bloque 6 — Predicción de Retrasos (tareas y proyectos) ──────────────────

function computeDelayScore(args: { capacityEstado: CapacityEstado; consistencyLevel: ConsistencyLevel | null; overdueCount: number; paceBehind?: boolean }): {
  probabilidadPct: number;
  motivos: string[];
} {
  let score = 0;
  const motivos: string[] = [];
  if (args.capacityEstado === "sobrecarga" || args.capacityEstado === "no-asignar") {
    score += 40;
    motivos.push("Sobrecarga");
  } else if (args.capacityEstado === "limitada") {
    score += 15;
  }
  if (args.consistencyLevel === "muy-variable") {
    score += 30;
    motivos.push("Baja consistencia");
  } else if (args.consistencyLevel === "variable") {
    score += 15;
    motivos.push("Baja consistencia");
  }
  if (args.overdueCount > 0) {
    score += Math.min(30, args.overdueCount * 10);
    motivos.push("Retrasos recientes");
  }
  if (args.paceBehind && !motivos.includes("Retrasos recientes")) {
    score += 20;
    motivos.push("Retrasos recientes");
  }
  return { probabilidadPct: Math.min(95, score), motivos };
}

export type DelayPrediction =
  | { available: false; reason: string }
  | (ExplainablePrediction & { available: true; probabilidadPct: number; nivel: "Alto" | "Medio" | "Bajo"; motivos: string[] });

export async function computeTaskDelayPrediction(taskId: string, now: Date = new Date()): Promise<DelayPrediction> {
  const task = await prisma.task.findUnique({ where: { id: taskId }, select: { assignedToId: true, status: true, endDate: true } });
  if (!task) return { available: false, reason: "Tarea no encontrada" };
  if (task.status === "COMPLETADA") return { available: false, reason: "La tarea ya está completada" };

  const windowWeeks = await getEffectivePredictionWindowWeeksNumber(now);
  const [capacity, consistency, openTasks, dataQuality] = await Promise.all([
    computeCapacityForecast(task.assignedToId, now),
    computeConsistency(task.assignedToId, now),
    prisma.task.findMany({
      where: { assignedToId: task.assignedToId, archivedMonth: null, status: { not: "COMPLETADA" } },
      select: { endDate: true, status: true },
    }),
    computeDataQuality([task.assignedToId]),
  ]);

  const overdueCount = openTasks.filter((t) => isTaskOverdue(t.endDate, t.status, now)).length;
  const { probabilidadPct, motivos } = computeDelayScore({
    capacityEstado: capacity.estado,
    consistencyLevel: consistency.available ? consistency.level : null,
    overdueCount,
  });
  const nivel: "Alto" | "Medio" | "Bajo" = probabilidadPct >= 60 ? "Alto" : probabilidadPct >= 30 ? "Medio" : "Bajo";

  const daysRemaining = Math.max(0, Math.round((task.endDate.getTime() - businessCalendarDay(now).getTime()) / 86400000));
  const horizon = nearestHorizon(daysRemaining);
  const confidencePct = computePredictionConfidence({
    dataScore: consistency.available ? Math.min(1, consistency.weeksAnalyzed / windowWeeks) : 0.3,
    consistencyScore: consistencyScoreFromLevel(consistency.available ? consistency.level : null),
    horizon,
  });

  return {
    available: true,
    horizon,
    confidencePct,
    historicalReliability: computeHistoricalReliability(consistency.available ? consistency.weeksAnalyzed : 0, dataQuality.pct),
    historicalWindowWeeks: windowWeeks,
    probabilidadPct,
    nivel,
    motivos,
    queOcurrira: `Probabilidad de retraso: ${probabilidadPct}% (nivel ${nivel}).`,
    porQue: motivos.length > 0 ? `Motivos identificados: ${motivos.join(", ")}.` : "Sin señales de riesgo identificadas para el responsable de esta tarea.",
    datosUtilizados: ["Capacidad disponible del responsable", "Consistencia operativa del responsable", "Tareas vencidas actuales del responsable"],
    variablesConMayorImpacto: motivos,
    queHacer: motivos.length > 0 ? ["Revisar la carga del responsable y priorizar esta tarea si es crítica."] : ["Sin acción necesaria."],
  };
}

export async function computeProjectDelayPrediction(projectId: string, now: Date = new Date()): Promise<DelayPrediction> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      startDate: true,
      targetDate: true,
      targetTimeHours: true,
      realHours: true,
      status: true,
      participants: { select: { userId: true } },
    },
  });
  if (!project) return { available: false, reason: "Proyecto no encontrado" };
  if (project.status === "COMPLETADO" || project.status === "CANCELADO") {
    return { available: false, reason: "El proyecto ya está cerrado" };
  }

  const windowWeeks = await getEffectivePredictionWindowWeeksNumber(now);
  const participantIds = project.participants.map((p) => p.userId);
  const today = businessCalendarDay(now);

  const totalSpanMs = Math.max(1, project.targetDate.getTime() - project.startDate.getTime());
  const elapsedMs = Math.max(0, Math.min(totalSpanMs, today.getTime() - project.startDate.getTime()));
  const elapsedPct = Math.round((elapsedMs / totalSpanMs) * 100);
  const executedPct = project.targetTimeHours > 0 ? Math.round((project.realHours / project.targetTimeHours) * 100) : 0;
  const paceBehind = elapsedPct - executedPct >= 15;

  let capacityEstado: CapacityEstado = "sin-planificacion";
  let consistencyLevel: ConsistencyLevel | null = null;
  let dataQualityPct = 100;

  if (participantIds.length > 0) {
    const [capacityMap, consistencies, dataQuality] = await Promise.all([
      computeTeamCapacityForecast(participantIds, now),
      Promise.all(participantIds.map((id) => computeConsistency(id, now))),
      computeDataQuality(participantIds),
    ]);
    const estados = participantIds.map((id) => capacityMap.get(id)?.estado).filter((e): e is CapacityEstado => !!e);
    if (estados.some((e) => e === "sobrecarga")) capacityEstado = "sobrecarga";
    else if (estados.some((e) => e === "no-asignar")) capacityEstado = "no-asignar";
    else if (estados.some((e) => e === "limitada")) capacityEstado = "limitada";
    else if (estados.length > 0) capacityEstado = "alta";

    const variableLevels = consistencies.filter((c): c is Extract<typeof c, { available: true }> => c.available).map((c) => c.level);
    if (variableLevels.some((l) => l === "muy-variable")) consistencyLevel = "muy-variable";
    else if (variableLevels.some((l) => l === "variable")) consistencyLevel = "variable";
    else if (variableLevels.length > 0) consistencyLevel = "consistente";
    dataQualityPct = dataQuality.pct;
  }

  const { probabilidadPct, motivos } = computeDelayScore({ capacityEstado, consistencyLevel, overdueCount: 0, paceBehind });
  const nivel: "Alto" | "Medio" | "Bajo" = probabilidadPct >= 60 ? "Alto" : probabilidadPct >= 30 ? "Medio" : "Bajo";

  const daysRemaining = Math.max(0, Math.round((project.targetDate.getTime() - today.getTime()) / 86400000));
  const horizon = nearestHorizon(daysRemaining);
  const confidencePct = computePredictionConfidence({
    dataScore: Math.min(1, participantIds.length > 0 ? 0.7 : 0.3),
    consistencyScore: consistencyScoreFromLevel(consistencyLevel),
    horizon,
  });

  return {
    available: true,
    horizon,
    confidencePct,
    historicalReliability: computeHistoricalReliability(windowWeeks, dataQualityPct),
    historicalWindowWeeks: windowWeeks,
    probabilidadPct,
    nivel,
    motivos,
    queOcurrira: `Probabilidad de retraso del proyecto: ${probabilidadPct}% (nivel ${nivel}).`,
    porQue: `Avance ejecutado ${executedPct}% vs. ${elapsedPct}% del tiempo transcurrido${motivos.length > 0 ? `; motivos: ${motivos.join(", ")}` : ""}.`,
    datosUtilizados: ["Horas ejecutadas vs. tiempo objetivo del proyecto", "Tiempo transcurrido vs. fecha objetivo", "Capacidad y consistencia de los participantes"],
    variablesConMayorImpacto: motivos,
    queHacer: motivos.length > 0 ? ["Revisar el ritmo de ejecución del proyecto y la carga de sus participantes."] : ["Sin acción necesaria."],
  };
}

// ── Bloque 10 — Estabilidad Operativa ───────────────────────────────────────

export type OperationalStabilityClassification = "Muy Alta" | "Alta" | "Media" | "Baja" | "Muy Baja";
export type OperationalStabilityResult = {
  classification: OperationalStabilityClassification;
  averageCoefficientOfVariation: number;
  basedOn: string[];
};

/** Puramente derivado de la volatilidad ya calculada por el Trend Engine — no modifica ningún KPI existente (§Bloque 10). */
export async function computeOperationalStability(userId: string, now: Date = new Date()): Promise<OperationalStabilityResult> {
  const trend = await computeTrendEngine(userId, now);
  const available = Object.values(trend.indicators).filter((i) => i.available);
  if (available.length === 0) {
    return { classification: "Baja", averageCoefficientOfVariation: 0, basedOn: [] };
  }
  const avgCv = Math.round((available.reduce((s, i) => s + i.coefficientOfVariation, 0) / available.length) * 10) / 10;
  const classification: OperationalStabilityClassification =
    avgCv < 10 ? "Muy Alta" : avgCv < 20 ? "Alta" : avgCv < 35 ? "Media" : avgCv < 50 ? "Baja" : "Muy Baja";
  const basedOn = available
    .filter((i) => i.coefficientOfVariation >= 20)
    .sort((a, b) => b.coefficientOfVariation - a.coefficientOfVariation)
    .map((i) => i.label);

  return { classification, averageCoefficientOfVariation: avgCv, basedOn };
}
