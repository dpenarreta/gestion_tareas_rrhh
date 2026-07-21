/**
 * Capa de explicabilidad (Sprint 6.5) — funciones puras de PRESENTACIÓN sobre
 * valores YA calculados por el Motor Analytics (src/lib/analytics.ts). Nunca
 * recalcula un KPI, nunca accede a la base de datos, nunca cambia una
 * fórmula ni un peso. Solo traduce números ya obtenidos a lenguaje ejecutivo
 * (rango, nivel, confianza) — ver Sprint 6.5 § objetivo.
 *
 * Sin "server-only": es pura, así que se puede importar tanto desde
 * componentes cliente (SmartBenchmark.tsx, AdvancedAnalytics.tsx) como desde
 * rutas de API.
 */

import type { KpiColor } from "@/components/kpis/types";

export type ScoreLevel = "Bajo" | "Medio" | "Alto" | "Muy alto";

// ── Umbral compartido 80/60 (§Analytics Calculation Registry D10) ───────────
// `cumplimientoColor` y `resultBarClass` reimplementaban por separado el mismo
// criterio "bueno ≥80% / regular ≥60% / malo <60%" en 4 sitios (3 rutas de
// /api/kpis + InsightCards.tsx) — única fuente ahora.

type ScoreBand = "good" | "warning" | "bad";

function scoreBand8060(pct: number): ScoreBand {
  if (pct >= 80) return "good";
  if (pct >= 60) return "warning";
  return "bad";
}

/** `KpiColor` para un % (cumplimiento, etc.) — única fuente para /api/kpis/[userId], /api/kpis/me y /api/kpis/executive. */
export function cumplimientoColor(pct: number): KpiColor {
  const band = scoreBand8060(pct);
  return band === "good" ? "green" : band === "warning" ? "yellow" : "red";
}

/** Clase Tailwind de fondo para una barra de resultado 0-100, mismo umbral que `cumplimientoColor` — única fuente para InsightCards.tsx. */
export function resultBarClass(pct: number): string {
  const band = scoreBand8060(pct);
  return band === "good" ? "bg-success" : band === "warning" ? "bg-warning" : "bg-danger";
}

/**
 * Invierte `points/weight` → valor normalizado 0-100 (1 decimal), para
 * modales "¿Cómo se obtuvo?" que muestran `normalizedValue` a partir de
 * factores ya calculados (`HealthFactor`/`RiskFactor`, que solo traen
 * `points`/`weight`, no el valor normalizado en sí) — antes duplicada en
 * AdvancedAnalytics.tsx y OperationalRiskCard.tsx (§D10).
 */
export function derivedNormalizedValue(points: number, weight: number): number {
  return weight > 0 ? Math.round((points / weight) * 100 * 10) / 10 : 0;
}

// ── Nivel de madurez del dato (§S2-H) — estrellas 1-5 según cuánto historial
// respalda un KPI (más historial/registro = más estrellas), puramente
// informativo, no altera el cálculo. Antes vivían en AdvancedAnalytics.tsx —
// se movieron aquí (mismo criterio que el resto del archivo: helpers de
// presentación compartidos, ver §D10) para que KpisModule/MyKpisModule no
// dependan de un componente cliente solo para una función pura.

/** Cumplimiento/carga: más tareas o días con registro en el período → más estrellas. */
export function maturityFromCount(count: number, thresholds: [number, number, number, number] = [1, 3, 6, 10]): 1 | 2 | 3 | 4 | 5 {
  const [t1, t2, t3, t4] = thresholds;
  if (count >= t4) return 5;
  if (count >= t3) return 4;
  if (count >= t2) return 3;
  if (count >= t1) return 2;
  return 1;
}

/** Predicción: más semanas de historial disponibles → más estrellas. */
export function maturityFromWeeks(weeksOfData: number): 1 | 2 | 3 | 4 | 5 {
  if (weeksOfData >= 6) return 5;
  if (weeksOfData >= 4) return 4;
  if (weeksOfData >= 2) return 3;
  if (weeksOfData >= 1) return 2;
  return 1;
}

/** Mismos umbrales que ScoreZoneBar (0-40-70-90-100, ver AdvancedAnalytics.tsx) — un puntaje normalizado siempre cae en una de estas 4 franjas. */
export function scoreLevel(normalizedValue: number): ScoreLevel {
  if (normalizedValue < 40) return "Bajo";
  if (normalizedValue < 70) return "Medio";
  if (normalizedValue < 90) return "Alto";
  return "Muy alto";
}

/** Frase ejecutiva para explicar por qué un valor normalizado cayó en su rango — ver Sprint 6.5 § S6.5-I. */
export function scoreLevelExplanation(normalizedValue: number): string {
  const level = scoreLevel(normalizedValue);
  return `Pertenece al rango ${level}. Según la configuración actual, este rango equivale a ${normalizedValue} puntos de 100.`;
}

export type ConfidenceIndicators = { dataQualityPct: number; reliabilityPct: number };

/** Confiabilidad estadística a partir de las mismas 4 estrellas ya usadas por Consistencia (§Analytics Engine v1.3.1) — solo las traduce a %, no cambia su cálculo. */
export function reliabilityPctFromStars(stars: 2 | 3 | 4 | 5): number {
  const map: Record<2 | 3 | 4 | 5, number> = { 2: 55, 3: 72, 4: 86, 5: 96 };
  return map[stars];
}

/** Confiabilidad a partir de una cantidad de observaciones/semanas frente a un máximo de referencia — usada donde no hay un objeto ConsistencyReliability disponible (p. ej. Referencia utilizada en modo personal). */
export function reliabilityPctFromObservations(observations: number, maxObservations = 6): number {
  const ratio = Math.max(0, Math.min(1, observations / maxObservations));
  return Math.round(30 + ratio * 65);
}

/** Etiqueta ejecutiva para un % de confianza — usada en tooltips y resúmenes de auditoría. */
export function confidenceLabel(pct: number): string {
  if (pct >= 90) return "Muy alta";
  if (pct >= 75) return "Alta";
  if (pct >= 55) return "Media";
  return "Baja";
}

/** Umbral mínimo de colaboradores del mismo cargo para habilitar comparación entre pares (§Sprint 7 — computeSmartBenchmark). Documentado aquí para que la copia de UI y el motor nunca queden desalineados. */
export const MIN_PEER_SAMPLE = 3;

/** Copia reutilizada cuando un factor cae en la regla de respaldo de Consistencia (§Analytics Engine — computeHealthScore/computePerformanceScore usan 70/100 como neutro cuando no hay semanas válidas suficientes) — ver Sprint 6.5 § S6.5-F. */
export const CONSISTENCY_FALLBACK_NOTE =
  "Actualmente no hay suficientes semanas con datos válidos para calcular la Consistencia real. Se utiliza temporalmente un puntaje neutro de 70/100 mientras se acumula historial. Este valor será reemplazado automáticamente cuando exista historial suficiente.";

/** Umbrales de clasificación compartidos por Performance Score y Score de Salud Laboral — mismo texto usado como "Referencia utilizada" en ambos audit summaries. */
export const SCORE_CLASSIFICATION_REFERENCE = "Clasificación por umbrales configurados: Excelente ≥90 · Bueno ≥75 · Riesgo ≥60 · Crítico <60";

export const CONFIDENCE_TOOLTIPS = {
  dataQuality: "Calidad del dato: qué tan completos y consistentes están los datos usados en este cálculo (registros, fechas, horas configuradas).",
  reliability: "Confiabilidad del cálculo: qué tan sólido es el resultado desde el punto de vista estadístico (tamaño de la muestra o del historial usado).",
  performanceScore: "Evalúa qué tan bien se ejecuta el trabajo.",
  operationalRisk: "Evalúa el riesgo de continuar asignando trabajo.",
  trazabilidad: "Mide qué tan bien quedó documentado el trabajo realizado.",
  consistencia: "Mide la estabilidad del desempeño entre períodos.",
  referenciaUtilizada: "Indica contra qué estándar se interpreta este indicador.",
  targetTimePrecision: "Mide qué tan cerca estuvo la ejecución real del Tiempo Objetivo esperado — no reemplaza al Performance Score.",
} as const;
