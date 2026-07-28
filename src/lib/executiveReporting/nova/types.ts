// Executive Reporting Engine 2.0 — Fase C — formas de salida de NOVA (FPS
// Parte III). Groq NUNCA calcula nada: recibe ExecutiveReportContext (ya
// derivado, en Fase B, de ExecutiveReportSnapshotData — datos ya calculados
// por analytics.ts/reportInsights.ts) y solo interpreta/prioriza/redacta.
//
// `scenarios` queda deliberadamente `null` en esta fase: el FPS condiciona
// los 3 escenarios (Esperado/Preventivo/Optimista) a que "Analytics
// Predictivo esté disponible" — hoy `ExecutiveReportSnapshotData.predictivo`
// todavía es `null` (la síntesis de escenarios de equipo desde
// predictionEngine.ts es una fase posterior, ver documentModel/diagrama de
// la Fase B). Narrar sobre datos que no existen violaría la regla
// antialucinación — por eso no se implementa un 5º prompt todavía.

export type NovaExecutiveSummary = {
  situacionGeneral: string;
  fortalezas: string;
  aspectosAtencion: string;
  conclusion: string;
};

export type NovaExecutiveInsights = {
  patrones: string[];
  cambios: string[];
  anomalias: string[];
  relacionesCruzadas: string[];
};

/** Orden fijo — FPS Parte II §8: nunca se altera. */
export type NovaExecutiveAssessment = {
  diagnosticoGeneral: string;
  fortalezasEstrategicas: string[];
  riesgosDetectados: string[];
  oportunidades: string[];
  prioridades: string[];
  perspectivaEstrategica: string;
  opinionEjecutiva: string;
};

/**
 * Enriquecimiento 1:1 de una recomendación ya existente (`Recommendation.id`,
 * ver reportInsights.ts) — NOVA nunca agrega ni quita recomendaciones, solo
 * anota la lista fija que el motor determinista ya produjo.
 */
export type NovaRecommendationEnrichment = {
  id: string;
  justificacion: string;
  impactoEsperado: string;
  beneficio: string;
  tiempoEstimado: string;
  responsableSugerido: string;
};

export type NovaSections = {
  executiveSummary: NovaExecutiveSummary;
  executiveInsights: NovaExecutiveInsights;
  executiveAssessment: NovaExecutiveAssessment;
  recommendationEnrichment: NovaRecommendationEnrichment[];
  scenarios: null;
};

export type NovaSectionName = "executiveSummary" | "executiveInsights" | "executiveAssessment" | "recommendationEnrichment";

export type NovaGenerationResult = {
  sections: NovaSections;
  /** true si CUALQUIER sección degradó a fallback determinista (sin GROQ_API_KEY, timeout, o respuesta malformada). */
  degraded: boolean;
  /** Qué secciones específicamente degradaron — para el log de auditoría (Fase A/D), nunca para bloquear la generación. */
  degradedSections: NovaSectionName[];
};

/** Nivel de confianza interno (FPS Parte III) — no necesariamente visible; gobierna cuánto puede profundizar el texto. */
export type NovaConfidence = "Muy Alta" | "Alta" | "Media" | "Baja";
