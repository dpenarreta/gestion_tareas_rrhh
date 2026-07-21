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

export type ScoreLevel = "Bajo" | "Medio" | "Alto" | "Muy alto";

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
