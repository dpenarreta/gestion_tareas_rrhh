import "server-only";
import { prisma } from "@/lib/prisma";
import { businessCalendarDay, businessDayRealRange } from "@/lib/businessTime";
import { computeWeeklyHistory, computeConsistency, utcWeekStartOf } from "@/lib/analytics";
import { getScoreSeries, getFactorAuditHistory } from "@/lib/analyticsAuditHistory";
import { getEffectivePredictionWindowWeeksNumber } from "@/lib/predictiveConfig";

/**
 * Trend Engine (Sprint E — Analytics Predictivo) — capa de SOLO LECTURA que
 * detecta dirección/estabilidad de 8 indicadores a partir de historial YA
 * CALCULADO por el motor central (`analytics.ts`) y su capa de auditoría
 * (`analyticsAuditHistory.ts`). Nunca recalcula un KPI, nunca escribe en
 * AnalyticsAuditLog con un `kind` que pueda confundirse con los del motor
 * oficial, y nunca usa IA — toda clasificación es regresión lineal (OLS) y
 * coeficiente de variación, funciones puras sin llamada externa.
 *
 * "Consultas" (consultas a Nova) queda fuera de alcance: no existe ninguna
 * tabla que registre preguntas hechas al asistente — ver docs/ROADMAP.md y
 * docs/AUDIT_LOG.md § Sprint E.
 */
export const TREND_ENGINE_VERSION = "1.0.0";

export type TrendIndicator =
  | "cumplimiento"
  | "productividad"
  | "horas_registradas"
  | "consistencia_operativa"
  | "capacidad_disponible"
  | "equilibrio_operativo"
  | "proyectos"
  | "actividades";

export type TrendDirection = "positiva" | "negativa" | "estable" | "variable" | "cambio_brusco";

export type TrendDataPoint = { label: string; value: number };

export type IndicatorTrend = {
  indicator: TrendIndicator;
  label: string;
  available: boolean;
  reason?: string;
  direction: TrendDirection;
  slope: number;
  coefficientOfVariation: number;
  dataPoints: TrendDataPoint[];
};

export type TrendEngineResult = {
  userId: string;
  windowWeeks: number;
  indicators: Record<TrendIndicator, IndicatorTrend>;
  engineVersion: string;
  generatedAt: string;
};

export const INDICATOR_LABEL: Record<TrendIndicator, string> = {
  cumplimiento: "Cumplimiento",
  productividad: "Productividad",
  horas_registradas: "Horas registradas",
  consistencia_operativa: "Consistencia Operativa",
  capacidad_disponible: "Capacidad Disponible",
  equilibrio_operativo: "Equilibrio Operativo",
  proyectos: "Proyectos",
  actividades: "Actividades",
};

// ── Clasificador puro (sin BD) — deliberadamente independiente de la
// regresión inline de computePrediction (analytics.ts): extraerla como
// helper compartido implicaría tocar un archivo de fórmulas protegido para
// este sprint. Duplicación pequeña y documentada, no un descuido — ver
// docs/AUDIT_LOG.md § Sprint E.

function linearSlope(values: number[]): number {
  const n = values.length;
  if (n < 2) return 0;
  const xMean = (n - 1) / 2;
  const yMean = values.reduce((s, y) => s + y, 0) / n;
  let num = 0;
  let den = 0;
  values.forEach((y, x) => {
    num += (x - xMean) * (y - yMean);
    den += (x - xMean) ** 2;
  });
  return den !== 0 ? num / den : 0;
}

/**
 * Residuos respecto a la recta de regresión (valor real - valor esperado por
 * la tendencia). Trabajar sobre el residuo, no sobre el valor crudo, es lo
 * que separa "hay una tendencia" de "esto es ruidoso": una serie que sube en
 * línea perfectamente recta tiene alta dispersión cruda alrededor de su
 * media plana (por construcción — eso es justamente la tendencia), pero
 * residuo ≈ 0 en cada punto (ningún punto se aparta de lo esperado).
 */
function residuals(values: number[], slope: number): number[] {
  const n = values.length;
  const xMean = (n - 1) / 2;
  const yMean = values.reduce((s, v) => s + v, 0) / n;
  return values.map((v, x) => v - (yMean + slope * (x - xMean)));
}

/** CV de los residuos (ruido tras remover la tendencia) como % de la media de la serie — mide variabilidad real, no la dispersión que la propia tendencia ya explica. */
function residualCoefficientOfVariation(values: number[], resid: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  if (mean === 0) return 0;
  const variance = resid.reduce((s, r) => s + r ** 2, 0) / resid.length;
  return (Math.sqrt(variance) / Math.abs(mean)) * 100;
}

/** El residuo del último punto se aparta más de 2 desviaciones estándar de los residuos anteriores — un salto puntual, no variabilidad sostenida. */
function hasAbruptChange(resid: number[]): boolean {
  if (resid.length < 4) return false;
  const prior = resid.slice(0, -1);
  const last = resid[resid.length - 1];
  const priorMean = prior.reduce((s, r) => s + r, 0) / prior.length;
  const variance = prior.reduce((s, r) => s + (r - priorMean) ** 2, 0) / prior.length;
  const sd = Math.sqrt(variance);
  if (sd === 0) return Math.abs(last - priorMean) > 1e-9;
  return Math.abs(last - priorMean) > 2 * sd;
}

/**
 * positiva/negativa/estable: pendiente relativa a la media, umbral 3%/semana.
 * variable: CV de residuos >= 35 (mismo corte que `consistencyLevelFromCv`
 * "muy-variable" en analytics.ts, reutilizado como referencia conceptual, no
 * como código) — CV de RESIDUOS, no del valor crudo, para no confundir una
 * tendencia fuerte con ruido (ver `residualCoefficientOfVariation`).
 * cambio_brusco: el último punto rompe el patrón de los anteriores — se
 * evalúa antes que "variable" porque un salto puntual no es lo mismo que
 * variabilidad sostenida.
 */
export function classifyTrendDirection(values: number[]): { direction: TrendDirection; slope: number; cv: number } {
  const slope = linearSlope(values);
  if (values.length < 2) return { direction: "estable", slope, cv: 0 };
  const resid = residuals(values, slope);
  const cv = Math.round(residualCoefficientOfVariation(values, resid) * 10) / 10;
  if (hasAbruptChange(resid)) return { direction: "cambio_brusco", slope, cv };
  if (cv >= 35) return { direction: "variable", slope, cv };
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const relativeSlopePct = mean !== 0 ? (slope / Math.abs(mean)) * 100 : 0;
  if (Math.abs(relativeSlopePct) < 3) return { direction: "estable", slope, cv };
  return { direction: relativeSlopePct > 0 ? "positiva" : "negativa", slope, cv };
}

function unavailable(indicator: TrendIndicator, reason: string): IndicatorTrend {
  return {
    indicator,
    label: INDICATOR_LABEL[indicator],
    available: false,
    reason,
    direction: "estable",
    slope: 0,
    coefficientOfVariation: 0,
    dataPoints: [],
  };
}

function fromSeries(indicator: TrendIndicator, points: TrendDataPoint[], minPoints = 2): IndicatorTrend {
  if (points.length < minPoints) {
    return unavailable(indicator, "Sin historial suficiente para evaluar la tendencia");
  }
  const { direction, slope, cv } = classifyTrendDirection(points.map((p) => p.value));
  return {
    indicator,
    label: INDICATOR_LABEL[indicator],
    available: true,
    direction,
    slope: Math.round(slope * 100) / 100,
    coefficientOfVariation: cv,
    dataPoints: points,
  };
}

/** "42%" → 42 — formato exacto de `HealthFactor.rawLabel` para "Capacidad futura" (ver computeHealthScore, analytics.ts). */
function parsePctLabel(rawLabel: string | undefined): number | null {
  if (!rawLabel) return null;
  const parsed = parseFloat(rawLabel);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * `windowWeeksOverride` — para Tendencias Históricas (§Bloque 9), que ofrece
 * ventanas independientes (3/4/8 semanas, 3/6 meses, 1 año) distintas de la
 * "Ventana Histórica de Predicción" configurada por el Administrador
 * (§Bloque 2). Sin override, se usa la configuración global como siempre.
 */
export async function computeTrendEngine(userId: string, now: Date = new Date(), windowWeeksOverride?: number): Promise<TrendEngineResult> {
  const windowWeeks = windowWeeksOverride ?? (await getEffectivePredictionWindowWeeksNumber(now));
  const windowDays = windowWeeks * 7;

  const today = businessCalendarDay(now);
  const currentWeekStart = utcWeekStartOf(today);
  // Mismos límites de semana que computeWeeklyHistory (analytics.ts) — para
  // que "Proyectos"/"Actividades" (indicadores nuevos, sin función existente
  // que los calcule) queden bucketeados con el mismo criterio lun-vie que el
  // resto del motor, en vez de inventar un agrupamiento distinto.
  const weeks = Array.from({ length: windowWeeks }, (_, i) => {
    const start = new Date(currentWeekStart.getTime() - (windowWeeks - i) * 7 * 86400000);
    const end = new Date(start.getTime() + 4 * 86400000);
    return { start, end, label: `Sem ${i + 1}` };
  });
  const rangeRealStart = businessDayRealRange(weeks[0].start).start;
  const rangeRealEnd = businessDayRealRange(weeks[weeks.length - 1].end).end;

  const [weeklyHistory, perfSeries, healthSeries, consistencyNow, consistencyPrev, capacityAudit, projectActivities, taskActivities] =
    await Promise.all([
      computeWeeklyHistory(userId, windowWeeks, now),
      getScoreSeries(userId, "performance_score", now, windowDays),
      getScoreSeries(userId, "health_score", now, windowDays),
      computeConsistency(userId, now),
      computeConsistency(userId, new Date(now.getTime() - windowDays * 86400000)),
      getFactorAuditHistory(userId, "health_score", now, windowDays),
      prisma.projectActivity.findMany({
        where: { authorId: userId, createdAt: { gte: rangeRealStart, lte: rangeRealEnd } },
        select: { createdAt: true, duration: true },
      }),
      prisma.taskActivity.findMany({
        where: { authorId: userId, createdAt: { gte: rangeRealStart, lte: rangeRealEnd } },
        select: { createdAt: true },
      }),
    ]);

  const withRegistration = weeklyHistory.filter((w) => w.businessDays > 0);

  const indicators: Record<TrendIndicator, IndicatorTrend> = {
    cumplimiento: fromSeries(
      "cumplimiento",
      withRegistration.map((w, i) => ({ label: `Sem ${i + 1}`, value: w.completedPct }))
    ),
    horas_registradas: fromSeries(
      "horas_registradas",
      withRegistration.map((w, i) => ({ label: `Sem ${i + 1}`, value: w.realHours }))
    ),
    productividad: fromSeries(
      "productividad",
      perfSeries.map((p) => ({ label: p.date.slice(0, 10), value: p.score }))
    ),
    equilibrio_operativo: fromSeries(
      "equilibrio_operativo",
      healthSeries.map((p) => ({ label: p.date.slice(0, 10), value: p.score }))
    ),
    consistencia_operativa:
      consistencyNow.available && consistencyPrev.available
        ? fromSeries("consistencia_operativa", [
            { label: "Ventana anterior", value: consistencyPrev.consistencyPct },
            { label: "Ventana actual", value: consistencyNow.consistencyPct },
          ])
        : unavailable(
            "consistencia_operativa",
            !consistencyNow.available ? consistencyNow.reason : (consistencyPrev as { reason: string }).reason
          ),
    // NO se usa `computeCapacityForecast` con `now` retroactivo — el estado de
    // Task.status es mutable y sin historial propio, así que retroceder `now`
    // mezclaría el cálculo de negocio del pasado con asignaciones de HOY (ver
    // docs/AUDIT_LOG.md § Sprint E). Se usa en cambio lo que el motor ya
    // capturó realmente en cada corrida pasada, vía el factor "Capacidad
    // futura" de Equilibrio Operativo en AnalyticsAuditLog.
    capacidad_disponible: fromSeries(
      "capacidad_disponible",
      capacityAudit
        .slice()
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .map((p) => {
          const factor = p.factors.find((f) => f.name === "Capacidad futura");
          const value = parsePctLabel(factor?.rawLabel);
          return value === null ? null : { label: p.createdAt.toISOString().slice(0, 10), value };
        })
        .filter((p): p is TrendDataPoint => p !== null)
    ),
    proyectos: fromSeries(
      "proyectos",
      weeks.map((w) => {
        const ds = businessDayRealRange(w.start).start;
        const de = businessDayRealRange(w.end).end;
        const hours = projectActivities
          .filter((a) => a.createdAt >= ds && a.createdAt <= de)
          .reduce((s, a) => s + a.duration, 0) / 60;
        return { label: w.label, value: Math.round(hours * 100) / 100 };
      }),
      windowWeeks // "Proyectos"/"Actividades" siempre tienen windowWeeks puntos (cero es un valor válido, no "sin dato") — mínimo = la ventana completa, no 2.
    ),
    actividades: fromSeries(
      "actividades",
      weeks.map((w) => {
        const ds = businessDayRealRange(w.start).start;
        const de = businessDayRealRange(w.end).end;
        const count = taskActivities.filter((a) => a.createdAt >= ds && a.createdAt <= de).length;
        return { label: w.label, value: count };
      }),
      windowWeeks
    ),
  };

  return {
    userId,
    windowWeeks,
    indicators,
    engineVersion: TREND_ENGINE_VERSION,
    generatedAt: now.toISOString(),
  };
}
