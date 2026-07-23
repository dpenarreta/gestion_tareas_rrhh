import "server-only";
import { prisma } from "@/lib/prisma";
import { getEffectiveAnalyticsConfig, getEffectiveCurve } from "@/lib/systemConfig";
import { normalize } from "@/lib/normalizationEngine";
import {
  computeMonthlyHistory,
  utcWeekStartOf,
  formatIsoDate,
  type MonthlyHistoryPoint,
  type OperationalRiskResult,
  type RiskFactor,
  type PerformanceScoreResult,
  type PerformanceFactor,
  type ConsistencyResult,
  type EngineAlert,
  type KpiTrends,
  type DataQualityResult,
} from "@/lib/analytics";
import type { CapacityForecast } from "@/lib/capacityForecast";
import { scoreLevel } from "@/lib/analyticsExplain";
import { getFactorAuditHistory, closestFactorPoint, type AuditKind, type AuditFactorSnapshot } from "@/lib/analyticsAuditHistory";

/**
 * Motor de Insights (Sprint 6 — Decision Intelligence Engine) — construye
 * interpretación y apoyo a la decisión ENCIMA de los KPIs ya calculados por
 * analytics.ts. NUNCA recalcula un KPI de negocio ni usa IA/ML para calcular:
 * solo compone, correlaciona con reglas determinísticas, compara contra el
 * historial propio del colaborador (AnalyticsAuditLog, sin tabla nueva) y
 * prioriza. Groq (si se usa en alguna vista) solo redactaría texto ya
 * calculado aquí — este módulo no depende de Groq en absoluto.
 */
export const INSIGHTS_ENGINE_VERSION = "1.0.0";

// ── S6-F: Confianza de los Insights (★ 1-5) ──────────────────────────────────

export type ConfidenceStars = 1 | 2 | 3 | 4 | 5;
export type Confidence = { stars: ConfidenceStars; label: string };

const CONFIDENCE_LABEL: Record<ConfidenceStars, string> = {
  5: "Muy alta",
  4: "Alta",
  3: "Media",
  2: "Baja",
  1: "Muy baja",
};

/** Compuesto de: cantidad de observaciones históricas, calidad del dato y consistencia — nunca depende de Groq. */
export function computeConfidence(params: { observations: number; maxObservations?: number; dataQualityPct: number; consistent: boolean | null }): Confidence {
  const { observations, maxObservations = 6, dataQualityPct, consistent } = params;
  const dataScore = Math.max(0, Math.min(1, observations / maxObservations));
  const qualityScore = Math.max(0, Math.min(1, dataQualityPct / 100));
  const consistencyScore = consistent === null ? 0.5 : consistent ? 1 : 0.3;
  const composite = dataScore * 0.4 + qualityScore * 0.35 + consistencyScore * 0.25;
  const stars: ConfidenceStars = composite >= 0.85 ? 5 : composite >= 0.65 ? 4 : composite >= 0.45 ? 3 : composite >= 0.25 ? 2 : 1;
  return { stars, label: CONFIDENCE_LABEL[stars] };
}

// ── S6-A: Motor de Insights (4 bloques) ──────────────────────────────────────

export type EvidenceItem = { label: string; before: string; after: string };
export type ActionImpact = { metric: string; delta: number; unit: string };
export type SuggestedAction = {
  /** Qué hacer. */
  what: string;
  /** A quién. */
  who: string;
  /** Cuánto. */
  howMuch: string;
  /** Cuándo. */
  when: string;
  /** Impacto esperado, cuando es estimable a partir de las MISMAS fórmulas del motor — nunca inventado. */
  impact: ActionImpact[] | null;
  /** "Impacto no estimable con los datos actuales." cuando `impact` es null. */
  impactNote: string;
};
export type Insight = {
  id: string;
  tone: "risk" | "positive" | "neutral";
  hallazgo: string;
  explicacion: string;
  evidencia: EvidenceItem[];
  accion: SuggestedAction | null;
  confidence: Confidence;
};

const FACTOR_EXPLANATION: Record<string, string> = {
  "Sobrecarga proyectada": "Relación observada: las horas comprometidas en tareas pendientes o en progreso superan la base laboral disponible para lo que resta del mes.",
  "Tareas críticas vencidas": "Posible causa principal: acumulación de tareas de prioridad Alta sin cerrar dentro del plazo comprometido.",
  "Horas extras recurrentes": "Relación observada: registro de horas en fin de semana por encima del promedio histórico personal.",
  "Baja capacidad futura (<10%)": "Posible causa principal: la carga ya comprometida deja muy poco margen sobre la base laboral restante del mes.",
  "Variabilidad excesiva entre semanas": "Relación observada: el ritmo de horas trabajadas y tareas completadas varía fuertemente semana a semana (coeficiente de variación alto).",
  "Alta concentración en un solo tipo de actividad": "Posible causa principal: un solo motivo de consulta concentra la mayoría del tiempo de Seguimiento del período.",
  "Muchas tareas sin planificación": "Relación observada: varias tareas abiertas no tienen tiempo objetivo definido, lo que reduce la confiabilidad de la proyección de capacidad.",
};

const FACTOR_ACTION: Record<string, (f: RiskFactor) => Omit<SuggestedAction, "impact" | "impactNote">> = {
  "Sobrecarga proyectada": (f) => ({
    what: "Redistribuir tareas pendientes o en progreso hacia un compañero con capacidad disponible.",
    who: "El coordinador directo del colaborador.",
    howMuch: f.detail,
    when: "Esta semana, antes de asignar trabajo nuevo.",
  }),
  "Tareas críticas vencidas": (f) => ({
    what: "Priorizar el cierre inmediato de las tareas de prioridad Alta vencidas.",
    who: "El colaborador y su coordinador directo.",
    howMuch: f.detail,
    when: "Hoy.",
  }),
  "Tendencia negativa de cumplimiento": (f) => ({
    what: "Revisar con el colaborador las causas de la caída y reajustar prioridades de la semana.",
    who: "El coordinador directo.",
    howMuch: f.detail,
    when: "En la próxima reunión de seguimiento.",
  }),
  "Horas extras recurrentes": (f) => ({
    what: "Confirmar si el trabajo en fin de semana es puntual o refleja sobrecarga sostenida.",
    who: "El coordinador directo.",
    howMuch: f.detail,
    when: "Esta semana.",
  }),
  "Baja capacidad futura (<10%)": (f) => ({
    what: "No asignar tareas nuevas hasta liberar capacidad.",
    who: "Quien asigna tareas al colaborador.",
    howMuch: f.detail,
    when: "Inmediato, hasta el cierre de mes.",
  }),
  "Variabilidad excesiva entre semanas": (f) => ({
    what: "Revisar la planificación semana a semana para suavizar el ritmo de trabajo.",
    who: "El coordinador directo.",
    howMuch: f.detail,
    when: "En la próxima planificación semanal.",
  }),
  "Alta concentración en un solo tipo de actividad": (f) => ({
    what: "Evaluar si se requiere apoyo adicional para ese motivo específico de consulta.",
    who: "El coordinador del área.",
    howMuch: f.detail,
    when: "Este mes.",
  }),
  "Muchas tareas sin planificación": (f) => ({
    what: "Completar el Tiempo Objetivo de las tareas pendientes.",
    who: "El colaborador.",
    howMuch: f.detail,
    when: "Antes de iniciar cada tarea nueva.",
  }),
};

// ── Sprint A: Insights de Performance Score (fortalezas + oportunidades) ────
// Mismo patrón que FACTOR_EXPLANATION/FACTOR_ACTION arriba, pero bidireccional
// (a diferencia de Riesgo Operativo, donde todo factor activo es negativo por
// diseño): un factor normalizado alto es una fortaleza (`tone: "positive"`),
// uno bajo es una oportunidad de mejora (`tone: "risk"`, con acción). Nunca
// recalcula PerformanceScoreResult — solo traduce `factors[]` ya calculados.

const PERFORMANCE_FACTOR_EXPLANATION: Record<string, { high: string; low: string }> = {
  Cumplimiento: {
    high: "El porcentaje de tareas completadas este mes está por encima del rango esperado.",
    low: "El porcentaje de tareas completadas este mes está por debajo del rango esperado.",
  },
  "Tareas vencidas": {
    high: "No hay una acumulación relevante de tareas vencidas este mes.",
    low: "Hay una acumulación de tareas vencidas — pesa más cuando son de prioridad Alta.",
  },
  Consistencia: {
    high: "El ritmo de trabajo (horas, tareas completadas, cumplimiento) es estable semana a semana.",
    low: "El ritmo de trabajo varía fuertemente semana a semana (coeficiente de variación alto).",
  },
  "Índice de Trazabilidad": {
    high: "El trabajo realizado queda bien documentado (registro diario, comentarios, actividades).",
    low: "El trabajo realizado queda poco documentado (registro diario, comentarios, actividades).",
  },
};

const PERFORMANCE_FACTOR_MAINTAIN: Record<string, string> = {
  Cumplimiento: "Mantener el ritmo actual de cierre de tareas dentro del plazo comprometido.",
  "Tareas vencidas": "Mantener el control de plazos — seguir cerrando tareas antes de su vencimiento.",
  Consistencia: "Mantener el ritmo de trabajo estable semana a semana.",
  "Índice de Trazabilidad": "Mantener el registro diario y la documentación del trabajo realizado.",
};

const PERFORMANCE_FACTOR_ACTION: Record<string, (f: PerformanceFactor) => Omit<SuggestedAction, "impact" | "impactNote">> = {
  Cumplimiento: (f) => ({
    what: "Completar las tareas pendientes de este mes, priorizando las más próximas a vencer.",
    who: "El colaborador.",
    howMuch: f.rawLabel,
    when: "Antes de fin de mes.",
  }),
  "Tareas vencidas": (f) => ({
    what: "Priorizar el cierre de las tareas vencidas, especialmente las de prioridad Alta.",
    who: "El colaborador.",
    howMuch: f.rawLabel,
    when: "Esta semana.",
  }),
  Consistencia: (f) => ({
    what: "Mantener un registro y un cumplimiento más parejo entre semanas, evitando picos y caídas fuertes.",
    who: "El colaborador.",
    howMuch: f.rawLabel,
    when: "Las próximas semanas.",
  }),
  "Índice de Trazabilidad": (f) => ({
    what: "Registrar a diario el avance del trabajo: comentarios y actividades que documenten lo realizado.",
    who: "El colaborador.",
    howMuch: f.rawLabel,
    when: "A diario.",
  }),
};

const PERFORMANCE_FACTOR_HALLAZGO: Record<string, (f: PerformanceFactor, high: boolean) => string> = {
  Cumplimiento: (f, high) =>
    high ? `Buen cumplimiento de tareas: ${f.rawLabel} completadas este mes.` : `Cumplimiento por debajo del objetivo: ${f.rawLabel} completadas este mes.`,
  "Tareas vencidas": (f, high) => (high ? `Buen control de plazos: ${f.rawLabel} vencidas.` : `Acumulación de tareas vencidas: ${f.rawLabel}.`),
  Consistencia: (f, high) =>
    high ? `Ritmo de trabajo estable: consistencia ${f.rawLabel}.` : `Ritmo de trabajo irregular semana a semana: consistencia ${f.rawLabel}.`,
  "Índice de Trazabilidad": (f, high) =>
    high ? `Buen registro de evidencia del trabajo: ${f.rawLabel}.` : `Poca evidencia documentada del trabajo: ${f.rawLabel}.`,
};

/**
 * Sprint A — traduce `PerformanceScoreResult.factors[]` YA CALCULADOS a
 * Insights de 4 bloques, en ambas direcciones: `normalizedValue` en "Alto"/
 * "Muy alto" (`scoreLevel`, `analyticsExplain.ts`) → fortaleza; "Bajo" →
 * oportunidad de mejora con acción concreta. "Medio" no genera insight (evita
 * ruido, mismo criterio que `FACTOR_INSIGHT_THRESHOLD_PTS` para Riesgo
 * Operativo). El impacto de la acción es el máximo puntaje que ESE factor
 * podría aportar si llegara al tope de su curva (`weight - points`, ambos ya
 * calculados por el motor) — nunca un número inventado; se etiqueta como
 * potencial, no como el efecto exacto de la acción sugerida.
 */
export function computePerformanceInsights(performanceScore: PerformanceScoreResult, baseConfidence: Confidence): Insight[] {
  const insights: Insight[] = [];
  for (const factor of performanceScore.factors) {
    const level = scoreLevel(factor.normalizedValue);
    if (level === "Medio") continue;
    const high = level === "Alto" || level === "Muy alto";

    const explanationPair = PERFORMANCE_FACTOR_EXPLANATION[factor.name];
    const explicacion = explanationPair ? (high ? explanationPair.high : explanationPair.low) : "Relación observada entre este factor y el Performance Score actual.";
    const hallazgoBuilder = PERFORMANCE_FACTOR_HALLAZGO[factor.name];
    const hallazgo = hallazgoBuilder ? hallazgoBuilder(factor, high) : factor.detail;
    const evidencia: EvidenceItem[] = [
      { label: factor.name, before: "—", after: factor.rawLabel },
      { label: "Aporte al Performance Score", before: `${factor.weight}% de peso`, after: `${factor.points} pts` },
    ];

    if (high) {
      insights.push({
        id: `perf-factor:${factor.name}:fortaleza`,
        tone: "positive",
        hallazgo,
        explicacion,
        evidencia,
        accion: {
          what: PERFORMANCE_FACTOR_MAINTAIN[factor.name] ?? "Mantener las prácticas actuales.",
          who: "El colaborador.",
          howMuch: "Sin cambios necesarios.",
          when: "Continuo.",
          impact: null,
          impactNote: "Impacto no estimable con los datos actuales.",
        },
        confidence: baseConfidence,
      });
      continue;
    }

    const maxUpsidePts = Math.round((factor.weight - factor.points) * 100) / 100;
    const actionBuilder = PERFORMANCE_FACTOR_ACTION[factor.name];
    const accion: SuggestedAction | null = actionBuilder
      ? {
          ...actionBuilder(factor),
          impact: maxUpsidePts > 0 ? [{ metric: "Performance Score", delta: maxUpsidePts, unit: "pts" }] : null,
          impactNote: maxUpsidePts > 0 ? "" : "Impacto no estimable con los datos actuales.",
        }
      : null;

    insights.push({
      id: `perf-factor:${factor.name}:oportunidad`,
      tone: "risk",
      hallazgo,
      explicacion,
      evidencia,
      accion,
      confidence: baseConfidence,
    });
  }
  return insights;
}

const FACTOR_INSIGHT_THRESHOLD_PTS = 2;

/**
 * S6-A — construye Insights de 4 bloques a partir de los factores YA
 * CALCULADOS del Índice de Riesgo Operativo (computeOperationalRisk) — cada
 * factor activo se traduce 1:1 a un Insight (hallazgo=detail del motor,
 * impacto=los mismos puntos que ese factor aporta al riesgo, cero números
 * inventados). El factor "Tendencia negativa de cumplimiento" recibe una
 * explicación enriquecida cruzando Seguimiento/carga del histórico mensual —
 * es el caso que más se acerca al ejemplo del pedido (cumplimiento cae junto
 * con Seguimiento y capacidad).
 */
export async function computeInsights(
  userId: string,
  now: Date,
  pipeline: { consistency: ConsistencyResult; dataQuality: DataQualityResult; trends: KpiTrends; performanceScore: PerformanceScoreResult },
  operationalRisk: OperationalRiskResult
): Promise<Insight[]> {
  const insights: Insight[] = [];
  const baseConfidence = computeConfidence({
    observations: pipeline.consistency.available ? pipeline.consistency.weeksAnalyzed : 2,
    dataQualityPct: pipeline.dataQuality.pct,
    consistent: pipeline.consistency.available ? pipeline.consistency.level === "muy-consistente" || pipeline.consistency.level === "consistente" : null,
  });

  insights.push(...computePerformanceInsights(pipeline.performanceScore, baseConfidence));

  const relevantFactors = operationalRisk.factors.filter((f) => f.points >= FACTOR_INSIGHT_THRESHOLD_PTS).sort((a, b) => b.points - a.points);

  let monthlyEnrichment: MonthlyHistoryPoint[] | null = null;

  for (const factor of relevantFactors) {
    let explicacion = FACTOR_EXPLANATION[factor.name] ?? "Relación observada entre este factor y el Índice de Riesgo Operativo actual.";
    const evidencia: EvidenceItem[] = [
      { label: factor.name, before: "—", after: factor.detail },
      { label: "Contribución al Riesgo Operativo", before: `${factor.weight}% de peso`, after: `${factor.points} pts` },
    ];

    const impact: ActionImpact[] = factor.points > 0 ? [{ metric: "Riesgo Operativo", delta: -Math.round(factor.points * 100) / 100, unit: "pts" }] : [];

    if (factor.name === "Tendencia negativa de cumplimiento") {
      if (!monthlyEnrichment) monthlyEnrichment = await computeMonthlyHistory(userId, 3, now);
      const current = monthlyEnrichment[monthlyEnrichment.length - 1];
      const prev = monthlyEnrichment.length >= 2 ? monthlyEnrichment[monthlyEnrichment.length - 2] : undefined;
      if (current && prev) {
        const segDelta = current.seguimientoCount - prev.seguimientoCount;
        const cargaDelta = current.cargaRealHours - prev.cargaRealHours;
        const causes: string[] = [];
        if (Math.abs(segDelta) >= 2) {
          causes.push(`un ${segDelta > 0 ? "incremento" : "una reducción"} del tiempo invertido en actividades de Seguimiento (${prev.seguimientoCount} → ${current.seguimientoCount})`);
          evidencia.push({ label: "Actividades de Seguimiento", before: `${prev.seguimientoCount}`, after: `${current.seguimientoCount}` });
        }
        if (Math.abs(cargaDelta) >= 5) {
          causes.push(`un ${cargaDelta > 0 ? "aumento" : "una reducción"} de la carga laboral registrada (${prev.cargaRealHours}h → ${current.cargaRealHours}h)`);
          evidencia.push({ label: "Carga laboral real", before: `${prev.cargaRealHours}h`, after: `${current.cargaRealHours}h` });
        }
        explicacion =
          causes.length > 0
            ? `Posible causa principal: la variación de cumplimiento coincide con ${causes.join(" y ")}. Relación observada a partir del historial mensual — no implica causalidad directa.`
            : "No se identificó, en el historial disponible, una variable con relación observable suficientemente fuerte.";

        if (current.completedPct < prev.completedPct) {
          const [config, curve] = await Promise.all([getEffectiveAnalyticsConfig(now), getEffectiveCurve("cumplimiento", now)]);
          const normCurrent = normalize("cumplimiento", current.completedPct, curve);
          const normPrev = normalize("cumplimiento", prev.completedPct, curve);
          const perfDelta = Math.round((((normPrev - normCurrent) * config.perfWeightCumplimiento) / 100) * 100) / 100;
          if (perfDelta > 0) impact.push({ metric: "Performance Score", delta: perfDelta, unit: "pts" });
        }
      }
    }

    const actionBuilder = FACTOR_ACTION[factor.name];
    const accion: SuggestedAction | null = actionBuilder
      ? {
          ...actionBuilder(factor),
          impact: impact.length > 0 ? impact : null,
          impactNote: impact.length > 0 ? "" : "Impacto no estimable con los datos actuales.",
        }
      : null;

    insights.push({
      id: `risk-factor:${factor.name}`,
      tone: "risk",
      hallazgo: factor.detail,
      explicacion,
      evidencia,
      accion,
      confidence: baseConfidence,
    });
  }

  const cumpTrend = pipeline.trends.cumplimiento.mesAnterior;
  if (cumpTrend.available && cumpTrend.direction === "mejora") {
    insights.push({
      id: "positive:cumplimiento-mejora",
      tone: "positive",
      hallazgo: `El cumplimiento mejoró ${Math.abs(cumpTrend.absoluteDiff)}pp respecto al mes anterior (${cumpTrend.compared}% → ${cumpTrend.current}%).`,
      explicacion: "Relación observada: la mejora coincide con un cierre más consistente de tareas dentro del plazo comprometido.",
      evidencia: [{ label: "Cumplimiento", before: `${cumpTrend.compared}%`, after: `${cumpTrend.current}%` }],
      accion: {
        what: "Mantener las prácticas actuales de planificación y registro.",
        who: "El colaborador.",
        howMuch: "Sin cambios necesarios.",
        when: "Continuo.",
        impact: null,
        impactNote: "Impacto no estimable con los datos actuales.",
      },
      confidence: baseConfidence,
    });
  }

  if (relevantFactors.length === 0 && insights.length === 0) {
    insights.push({
      id: "neutral:sin-senales",
      tone: "neutral",
      hallazgo: "No se detectaron cambios relevantes en los indicadores este período.",
      explicacion: "El Índice de Riesgo Operativo se mantiene bajo y no hay factores con contribución significativa.",
      evidencia: [{ label: "Riesgo Operativo", before: "—", after: `${operationalRisk.score} pts (${operationalRisk.classification})` }],
      accion: null,
      confidence: baseConfidence,
    });
  }

  return insights;
}

// ── Sprint A: Explicación de tendencias (Performance Score / Score de Salud) ─
// Nunca recalcula un score: compara `factors[]` YA CALCULADOS de dos
// instantes en el tiempo (el actual vs. un snapshot histórico de
// `AnalyticsAuditLog`, leído a través de `analyticsAuditHistory.ts` — capa de
// solo lectura, no del motor) y narra qué factores subieron/bajaron más.
// Mismo principio "cero números inventados" que el resto de este archivo.

export type ScoreTrendExplanation = {
  available: boolean;
  direction: "mejora" | "empeoro" | "estable";
  scoreDelta: number;
  bullets: string[];
  reason?: string;
};

const TREND_STABLE_EPSILON = 0.5;
const FACTOR_DELTA_EPSILON = 0.5;
const MAX_TREND_BULLETS = 3;

/** Pura — compara dos snapshots de factores (misma forma que `PerformanceFactor`/`HealthFactor`) sin volver a calcular nada. */
export function explainScoreTrend(
  currentScore: number,
  currentFactors: AuditFactorSnapshot[],
  previousScore: number | null,
  previousFactors: AuditFactorSnapshot[] | null
): ScoreTrendExplanation {
  if (previousScore === null || previousFactors === null) {
    return { available: false, direction: "estable", scoreDelta: 0, bullets: [], reason: "Sin historial suficiente para explicar la tendencia." };
  }
  const scoreDelta = Math.round((currentScore - previousScore) * 100) / 100;
  const direction: ScoreTrendExplanation["direction"] = scoreDelta > TREND_STABLE_EPSILON ? "mejora" : scoreDelta < -TREND_STABLE_EPSILON ? "empeoro" : "estable";

  const prevByName = new Map(previousFactors.map((f) => [f.name, f]));
  const deltas = currentFactors
    .map((f) => {
      const prev = prevByName.get(f.name);
      if (!prev) return null;
      const delta = Math.round((f.points - prev.points) * 100) / 100;
      return { name: f.name, delta, prevLabel: prev.rawLabel ?? prev.detail ?? "", curLabel: f.rawLabel ?? f.detail ?? "" };
    })
    .filter((d): d is { name: string; delta: number; prevLabel: string; curLabel: string } => d !== null && Math.abs(d.delta) >= FACTOR_DELTA_EPSILON)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, MAX_TREND_BULLETS);

  const bullets = deltas.map((d) => {
    const verb = d.delta > 0 ? "aportó" : "restó";
    const labelChange = d.prevLabel && d.curLabel && d.prevLabel !== d.curLabel ? ` (${d.prevLabel} → ${d.curLabel})` : "";
    return `${d.name} ${verb} ${Math.abs(d.delta)}pts${labelChange}`;
  });

  return { available: true, direction, scoreDelta, bullets, reason: bullets.length === 0 ? "No hay un factor individual con variación relevante." : undefined };
}

/**
 * Envoltorio async: resuelve el punto histórico más cercano a `daysAgo` vía
 * `getFactorAuditHistory`/`closestFactorPoint` (`analyticsAuditHistory.ts`) y
 * delega la comparación a `explainScoreTrend` (pura). `kind` acepta
 * `"health_score"` porque esa lectura vive en la capa complementaria nueva,
 * no en `getScoredAuditHistory` del motor (que no se modifica).
 */
export async function getScoreTrendExplanation(
  userId: string,
  kind: AuditKind,
  currentScore: number,
  currentFactors: AuditFactorSnapshot[],
  now: Date,
  daysAgo = 30
): Promise<ScoreTrendExplanation> {
  const history = await getFactorAuditHistory(userId, kind, now, Math.max(daysAgo + 10, 40));
  const point = closestFactorPoint(history, now, daysAgo);
  return explainScoreTrend(currentScore, currentFactors, point?.score ?? null, point?.factors ?? null);
}

// ── S6-C: Relaciones entre indicadores (reglas determinísticas) ─────────────

export type RelationConfidenceLevel = "alta" | "media" | "baja";
export type IndicatorRelation = {
  id: string;
  statement: string;
  confidence: RelationConfidenceLevel;
  evidencia: EvidenceItem[];
};

/** Confianza de una relación: cantidad de observaciones históricas que la respaldan × fuerza del efecto observado — NUNCA Machine Learning, solo umbrales. */
function relationConfidence(observations: number, strengthRatio: number): RelationConfidenceLevel {
  if (observations >= 4 && strengthRatio >= 1.5) return "alta";
  if (observations >= 2 && strengthRatio >= 1.15) return "media";
  return "baja";
}

/**
 * S6-C — cruza indicadores YA CALCULADOS con reglas fijas (sin ML). Todas las
 * entradas (histórico mensual, consistencia, factores de riesgo, capacidad)
 * ya fueron calculadas por analytics.ts/capacityForecast.ts — esta función es
 * pura (sin queries propias) para mantenerla barata y testeable.
 */
export function computeIndicatorRelations(
  monthly: MonthlyHistoryPoint[],
  consistency: ConsistencyResult,
  operationalRisk: OperationalRiskResult,
  capacity: CapacityForecast
): IndicatorRelation[] {
  const relations: IndicatorRelation[] = [];
  const monthsWithData = monthly.filter((m) => m.totalTasks > 0 || m.cargaRealHours > 0).length;
  const current = monthly.length > 0 ? monthly[monthly.length - 1] : undefined;
  const prev = monthly.length >= 2 ? monthly[monthly.length - 2] : undefined;

  if (current && prev && prev.completedPct > 0 && current.completedPct < prev.completedPct - 5 && prev.seguimientoCount > 0 && current.seguimientoCount > prev.seguimientoCount * 1.2) {
    const ratio = current.seguimientoCount / prev.seguimientoCount;
    relations.push({
      id: "cumplimiento-vs-seguimiento",
      statement: "La disminución del cumplimiento coincide con un incremento del tiempo dedicado a actividades de Seguimiento.",
      confidence: relationConfidence(monthsWithData, ratio),
      evidencia: [
        { label: "Cumplimiento", before: `${prev.completedPct}%`, after: `${current.completedPct}%` },
        { label: "Actividades de Seguimiento", before: `${prev.seguimientoCount}`, after: `${current.seguimientoCount}` },
      ],
    });
  }

  const horasExtraFactor = operationalRisk.factors.find((f) => f.name === "Horas extras recurrentes");
  const bajaCapFactor = operationalRisk.factors.find((f) => f.name === "Baja capacidad futura (<10%)");
  if (horasExtraFactor && horasExtraFactor.points > 0 && bajaCapFactor && bajaCapFactor.points > 0) {
    relations.push({
      id: "horas-extra-vs-capacidad",
      statement: "El aumento de horas extra coincide con una reducción de la capacidad futura disponible.",
      confidence: relationConfidence(monthsWithData, (horasExtraFactor.points + bajaCapFactor.points) / 10),
      evidencia: [
        { label: "Horas extras recurrentes", before: "—", after: horasExtraFactor.detail },
        { label: "Capacidad futura disponible", before: "—", after: bajaCapFactor.detail },
      ],
    });
  }

  if (current && prev && prev.cargaBaseHours > 0 && current.cargaPct > prev.cargaPct + 10 && consistency.available && (consistency.level === "variable" || consistency.level === "muy-variable")) {
    relations.push({
      id: "carga-vs-consistencia",
      statement: "El incremento de carga laboral coincide con mayor variabilidad en el ritmo de trabajo semana a semana.",
      confidence: relationConfidence(monthsWithData, (current.cargaPct - prev.cargaPct) / 10),
      evidencia: [
        { label: "Carga laboral", before: `${prev.cargaPct}%`, after: `${current.cargaPct}%` },
        { label: "Consistencia", before: "—", after: `${consistency.label} (CV ${consistency.coefficientOfVariation}%)` },
      ],
    });
  }

  if (capacity.tasksSinEstimar >= 3 && capacity.confiabilidad.pct < 80) {
    relations.push({
      id: "sin-estimar-vs-confiabilidad",
      statement: "La falta de tiempo objetivo definido en varias tareas reduce la confiabilidad de la proyección de capacidad futura.",
      confidence: relationConfidence(monthsWithData, capacity.tasksSinEstimar / 3),
      evidencia: [
        { label: "Tareas sin tiempo objetivo definido", before: "—", after: `${capacity.tasksSinEstimar}` },
        { label: "Confiabilidad de la proyección", before: "100%", after: `${capacity.confiabilidad.pct}%` },
      ],
    });
  }

  return relations;
}

// ── S6-D: Benchmarks personales (contra el propio historial, nunca entre personas) ──

export type PersonalBenchmark = {
  current: number;
  average: number;
  bestEver: { score: number; period: string } | null;
  bestWeek: { score: number; weekOf: string } | null;
  last4Weeks: number | null;
  last3Months: number | null;
  percentile: number;
  narrative: string;
  observations: number;
  confidence: Confidence;
};

/**
 * Reutiliza AnalyticsAuditLog (kind="performance_score", ya existe — no se
 * crea tabla ni se persiste nada nuevo) para reconstruir el historial
 * PERSONAL del Performance Score. La granularidad real depende de cuántas
 * veces se recalculó (cada `cacheTtlMinutes` mientras el colaborador/su
 * gerencia usan Analytics) — mismo patrón ya usado por getScoreTrendHistory.
 */
export async function computePersonalBenchmark(userId: string, currentScore: number, dataQualityPct: number, now: Date = new Date()): Promise<PersonalBenchmark> {
  const windowStart = new Date(now.getTime() - 366 * 86400000);
  let entries: Array<{ createdAt: Date; period: string; result: unknown }> = [];
  try {
    entries = await prisma.analyticsAuditLog.findMany({
      where: { userId, kind: "performance_score", createdAt: { gte: windowStart, lt: now } },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true, period: true, result: true },
    });
  } catch {
    entries = [];
  }

  const scored = entries
    .map((e) => ({ createdAt: e.createdAt, period: e.period, score: e.result && typeof e.result === "object" ? (e.result as { score?: unknown }).score : undefined }))
    .filter((e): e is { createdAt: Date; period: string; score: number } => typeof e.score === "number");

  if (scored.length === 0) {
    return {
      current: currentScore,
      average: currentScore,
      bestEver: null,
      bestWeek: null,
      last4Weeks: null,
      last3Months: null,
      percentile: 50,
      narrative: "Sin historial personal suficiente todavía para comparar.",
      observations: 0,
      confidence: { stars: 1, label: "Muy baja" },
    };
  }

  const average = Math.round((scored.reduce((s, e) => s + e.score, 0) / scored.length) * 10) / 10;

  const byPeriod = new Map<string, number[]>();
  for (const e of scored) byPeriod.set(e.period, [...(byPeriod.get(e.period) ?? []), e.score]);
  let bestEver: { score: number; period: string } | null = null;
  for (const [period, scores] of byPeriod) {
    const avg = Math.round((scores.reduce((s, v) => s + v, 0) / scores.length) * 10) / 10;
    if (!bestEver || avg > bestEver.score) bestEver = { score: avg, period };
  }

  const byWeek = new Map<string, number[]>();
  for (const e of scored) {
    const key = formatIsoDate(utcWeekStartOf(e.createdAt));
    byWeek.set(key, [...(byWeek.get(key) ?? []), e.score]);
  }
  let bestWeek: { score: number; weekOf: string } | null = null;
  for (const [weekOf, scores] of byWeek) {
    const avg = Math.round((scores.reduce((s, v) => s + v, 0) / scores.length) * 10) / 10;
    if (!bestWeek || avg > bestWeek.score) bestWeek = { score: avg, weekOf };
  }

  const last4WeeksScores = scored.filter((e) => e.createdAt.getTime() >= now.getTime() - 28 * 86400000);
  const last4Weeks = last4WeeksScores.length > 0 ? Math.round((last4WeeksScores.reduce((s, e) => s + e.score, 0) / last4WeeksScores.length) * 10) / 10 : null;

  const last3MonthsScores = scored.filter((e) => e.createdAt.getTime() >= now.getTime() - 91 * 86400000);
  const last3Months = last3MonthsScores.length > 0 ? Math.round((last3MonthsScores.reduce((s, e) => s + e.score, 0) / last3MonthsScores.length) * 10) / 10 : null;

  const notBetter = scored.filter((e) => e.score <= currentScore).length;
  const percentile = Math.round((notBetter / scored.length) * 100);

  const diffFromAvg = Math.round((currentScore - average) * 10) / 10;
  const isBestEver = bestEver !== null && scored.length >= 4 && Math.round(currentScore) >= Math.round(bestEver.score);
  let narrative: string;
  if (isBestEver) {
    narrative = "Este es su mejor desempeño registrado en el historial disponible.";
  } else if (diffFromAvg > 3) {
    narrative = `Actualmente se encuentra ${diffFromAvg} pts por encima de su promedio histórico.`;
  } else if (diffFromAvg < -3) {
    narrative = `Actualmente se encuentra ${Math.abs(diffFromAvg)} pts por debajo de su promedio histórico.`;
  } else {
    narrative = "Actualmente en línea con su promedio histórico personal.";
  }

  const confidence = computeConfidence({ observations: byPeriod.size, maxObservations: 6, dataQualityPct, consistent: scored.length >= 8 });

  return { current: currentScore, average, bestEver, bestWeek, last4Weeks, last3Months, percentile, narrative, observations: scored.length, confidence };
}

// ── S6-G: Reevaluación automática de recomendaciones ─────────────────────────
// Sin tabla nueva, sin persistir nada: reutiliza AnalyticsAuditLog (kind
// "alerts"/"operational_risk", ya existentes) para comparar el ciclo actual
// contra la referencia más antigua disponible dentro de la ventana — se
// recalcula íntegramente en cada llamada.

export type ReevaluationStatus = "mejorada" | "valida" | "prioritaria" | "sin-datos";
export type RecommendationReevaluation = {
  rule: string;
  message: string;
  status: ReevaluationStatus;
  referenceDaysAgo: number;
};

const ALERT_RULE_LABEL: Record<string, string> = {
  sobrecarga_proyectada: "Sobrecarga proyectada",
  capacidad_critica: "Capacidad crítica",
  subutilizacion_prolongada: "Subutilización prolongada",
  tareas_vencidas: "Tareas vencidas",
  cumplimiento_bajo: "Cumplimiento bajo",
  horas_extra_inusuales: "Horas extra inusuales",
  dias_consecutivos_sobrecarga: "Días consecutivos de sobrecarga",
  caida_registros: "Caída de registros diarios",
  crecimiento_seguimiento: "Crecimiento de actividades de seguimiento",
};

const REEVALUATION_WINDOW_DAYS = 14;
const RISK_WORSENED_THRESHOLD = 3;

export async function computeRecommendationReevaluation(userId: string, currentAlerts: EngineAlert[], currentRiskScore: number, now: Date = new Date()): Promise<RecommendationReevaluation[]> {
  const sinceDate = new Date(now.getTime() - REEVALUATION_WINDOW_DAYS * 86400000);
  let alertEntries: Array<{ createdAt: Date; result: unknown }> = [];
  let riskEntries: Array<{ createdAt: Date; result: unknown }> = [];
  try {
    [alertEntries, riskEntries] = await Promise.all([
      prisma.analyticsAuditLog.findMany({ where: { userId, kind: "alerts", createdAt: { gte: sinceDate, lt: now } }, orderBy: { createdAt: "asc" }, select: { createdAt: true, result: true } }),
      prisma.analyticsAuditLog.findMany({ where: { userId, kind: "operational_risk", createdAt: { gte: sinceDate, lt: now } }, orderBy: { createdAt: "asc" }, select: { createdAt: true, result: true } }),
    ]);
  } catch {
    return [];
  }

  if (alertEntries.length === 0) return [];

  // Referencia = el snapshot más antiguo disponible en la ventana ("ciclo anterior").
  const reference = alertEntries[0];
  const referenceRulesRaw = reference.result && typeof reference.result === "object" ? (reference.result as { alerts?: unknown }).alerts : undefined;
  const referenceRules = Array.isArray(referenceRulesRaw) ? referenceRulesRaw.filter((r): r is string => typeof r === "string") : [];
  if (referenceRules.length === 0) return [];

  const referenceRiskEntry =
    riskEntries.find((e) => Math.abs(e.createdAt.getTime() - reference.createdAt.getTime()) <= 3 * 86400000) ?? riskEntries[0];
  const referenceRiskScore =
    referenceRiskEntry && typeof referenceRiskEntry.result === "object" && referenceRiskEntry.result !== null
      ? (referenceRiskEntry.result as { score?: unknown }).score
      : undefined;

  const currentRuleSet = new Set(currentAlerts.map((a) => a.rule));
  const referenceDaysAgo = Math.max(0, Math.round((now.getTime() - reference.createdAt.getTime()) / 86400000));

  return referenceRules.map((rule) => {
    const label = ALERT_RULE_LABEL[rule] ?? rule;
    if (!currentRuleSet.has(rule)) {
      return { rule, message: `${label}: la situación evolucionó favorablemente respecto a la recomendación anterior.`, status: "mejorada" as const, referenceDaysAgo };
    }
    if (typeof referenceRiskScore !== "number") {
      return { rule, message: `${label}: no es posible evaluar todavía el impacto de la recomendación anterior.`, status: "sin-datos" as const, referenceDaysAgo };
    }
    const delta = currentRiskScore - referenceRiskScore;
    if (delta > RISK_WORSENED_THRESHOLD) {
      return { rule, message: `${label}: la condición requiere intervención prioritaria — el Riesgo Operativo aumentó desde la última recomendación.`, status: "prioritaria" as const, referenceDaysAgo };
    }
    return { rule, message: `${label}: la recomendación continúa siendo válida.`, status: "valida" as const, referenceDaysAgo };
  });
}

// ── S6-H: Priorización inteligente ───────────────────────────────────────────

export type Rankable = {
  priority: "alta" | "media";
  impactScorePts: number;
  impactRiskPts: number;
  /** Cantidad de colaboradores afectados por implementar la recomendación. */
  affectedCount: number;
  /** Facilidad de implementación — menor = más fácil de ejecutar. */
  easeRank: number;
};

/**
 * Orden fijo (§S6-H): 1) Riesgo Operativo (prioridad + magnitud del impacto
 * en riesgo), 2) Impacto esperado combinado, 3) Facilidad de implementación,
 * 4) Cantidad de colaboradores afectados. Solo las 3 primeras se muestran —
 * el resto queda agrupado ("Ver recomendaciones adicionales").
 */
export function prioritizeRecommendations<T extends Rankable>(items: T[]): { top: T[]; additional: T[] } {
  const priorityRank = (p: "alta" | "media") => (p === "alta" ? 0 : 1);
  const ranked = [...items].sort((a, b) => {
    if (priorityRank(a.priority) !== priorityRank(b.priority)) return priorityRank(a.priority) - priorityRank(b.priority);
    const riskA = Math.abs(a.impactRiskPts);
    const riskB = Math.abs(b.impactRiskPts);
    if (riskA !== riskB) return riskB - riskA;
    const impactA = Math.abs(a.impactScorePts) + Math.abs(a.impactRiskPts);
    const impactB = Math.abs(b.impactScorePts) + Math.abs(b.impactRiskPts);
    if (impactA !== impactB) return impactB - impactA;
    if (a.easeRank !== b.easeRank) return a.easeRank - b.easeRank;
    return b.affectedCount - a.affectedCount;
  });
  return { top: ranked.slice(0, 3), additional: ranked.slice(3) };
}

function insightPriority(i: Insight): "alta" | "media" {
  const riskImpact = i.accion?.impact?.find((x) => x.metric === "Riesgo Operativo");
  return riskImpact && Math.abs(riskImpact.delta) >= 10 ? "alta" : "media";
}

/** Aplica la misma priorización (§S6-H) a los Insights individuales que tienen acción accionable. */
export function prioritizeInsights(insights: Insight[]): { top: Insight[]; additional: Insight[] } {
  const withAction = insights.filter((i) => i.tone === "risk" && i.accion);
  const rankable = withAction.map((i) => ({
    insight: i,
    priority: insightPriority(i),
    impactScorePts: i.accion?.impact?.find((x) => x.metric === "Performance Score")?.delta ?? 0,
    impactRiskPts: i.accion?.impact?.find((x) => x.metric === "Riesgo Operativo")?.delta ?? 0,
    affectedCount: 1,
    easeRank: 0,
  }));
  const { top, additional } = prioritizeRecommendations(rankable);
  return { top: top.map((r) => r.insight), additional: additional.map((r) => r.insight) };
}
