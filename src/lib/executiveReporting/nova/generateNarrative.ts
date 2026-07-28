// Executive Reporting Engine 2.0 — Fase C — orquestador de NOVA. 4 llamadas a
// Groq en paralelo (Executive Summary/Insights/Assessment/Enriquecimiento de
// Recomendaciones), cada una con timeout independiente y fallback
// determinista — NUNCA bloquea ni falla la generación del reporte (FPS
// Parte IV §8). Sin GROQ_API_KEY, degrada las 4 secciones de inmediato sin
// intentar red — mismo criterio que kpis/nova-insights.
import Groq from "groq-sdk";
import type { ExecutiveReportContext } from "../context";
import type { Recommendation } from "@/lib/reportInsights";
import { computeNovaConfidence } from "./confidence";
import {
  buildExecutiveSummaryPrompt,
  buildExecutiveInsightsPrompt,
  buildExecutiveAssessmentPrompt,
  buildRecommendationEnrichmentPrompt,
} from "./prompts";
import {
  fallbackExecutiveSummary,
  fallbackExecutiveInsights,
  fallbackExecutiveAssessment,
  fallbackRecommendationEnrichment,
} from "./fallbacks";
import type {
  NovaExecutiveSummary,
  NovaExecutiveInsights,
  NovaExecutiveAssessment,
  NovaRecommendationEnrichment,
  NovaSectionName,
  NovaGenerationResult,
} from "./types";

const DEFAULT_DEADLINE_MS = 8000;
const MODEL = "llama-3.3-70b-versatile";

/** Extrae el primer objeto JSON `{...}` de un texto (Groq a veces envuelve la respuesta en markdown pese a la instrucción) — mismo criterio que nova-insights. */
function extractJson(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function asStringArray(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  const arr = v.filter(isNonEmptyString);
  return arr.length > 0 ? arr : null;
}

/** Nunca deja una llamada colgada más allá de `ms` — la promesa externa se resuelve/rechaza en ese plazo aunque la petición HTTP siga en curso en segundo plano. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`NOVA: timeout tras ${ms}ms`)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

async function callGroq(groq: Groq, system: string, user: string, deadlineMs: number): Promise<unknown> {
  const response = await withTimeout(
    groq.chat.completions.create({
      model: MODEL,
      max_tokens: 2048,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
    deadlineMs,
  );
  const text = response.choices[0]?.message?.content ?? "";
  return extractJson(text);
}

function validateSummary(raw: unknown): NovaExecutiveSummary | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (!isNonEmptyString(r.situacionGeneral) || !isNonEmptyString(r.fortalezas) || !isNonEmptyString(r.aspectosAtencion) || !isNonEmptyString(r.conclusion)) return null;
  return { situacionGeneral: r.situacionGeneral, fortalezas: r.fortalezas, aspectosAtencion: r.aspectosAtencion, conclusion: r.conclusion };
}

function validateInsights(raw: unknown): NovaExecutiveInsights | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const patrones = asStringArray(r.patrones);
  const cambios = asStringArray(r.cambios);
  const anomalias = asStringArray(r.anomalias);
  const relacionesCruzadas = asStringArray(r.relacionesCruzadas);
  if (!patrones || !cambios || !anomalias || !relacionesCruzadas) return null;
  return { patrones, cambios, anomalias, relacionesCruzadas };
}

function validateAssessment(raw: unknown): NovaExecutiveAssessment | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const fortalezasEstrategicas = asStringArray(r.fortalezasEstrategicas);
  const riesgosDetectados = asStringArray(r.riesgosDetectados);
  const oportunidades = asStringArray(r.oportunidades);
  const prioridades = asStringArray(r.prioridades);
  if (
    !isNonEmptyString(r.diagnosticoGeneral) ||
    !fortalezasEstrategicas ||
    !riesgosDetectados ||
    !oportunidades ||
    !prioridades ||
    !isNonEmptyString(r.perspectivaEstrategica) ||
    !isNonEmptyString(r.opinionEjecutiva)
  ) {
    return null;
  }
  return {
    diagnosticoGeneral: r.diagnosticoGeneral,
    fortalezasEstrategicas,
    riesgosDetectados,
    oportunidades,
    prioridades,
    perspectivaEstrategica: r.perspectivaEstrategica,
    opinionEjecutiva: r.opinionEjecutiva,
  };
}

/**
 * Valida y REALINEA estrictamente contra los `id` reales de `recommendations`
 * — cualquier id inventado por Groq se descarta; cualquier id real que Groq
 * haya omitido se completa con el fallback determinista de ESA recomendación
 * puntual (nunca se deja una recomendación sin enriquecimiento).
 */
function validateAndAlignRecommendations(raw: unknown, recommendations: Recommendation[]): NovaRecommendationEnrichment[] | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const list = Array.isArray(r.enriquecimiento) ? r.enriquecimiento : null;
  if (!list) return null;

  const byId = new Map<string, NovaRecommendationEnrichment>();
  for (const item of list) {
    if (typeof item !== "object" || item === null) continue;
    const e = item as Record<string, unknown>;
    if (
      isNonEmptyString(e.id) &&
      isNonEmptyString(e.justificacion) &&
      isNonEmptyString(e.impactoEsperado) &&
      isNonEmptyString(e.beneficio) &&
      isNonEmptyString(e.tiempoEstimado) &&
      isNonEmptyString(e.responsableSugerido)
    ) {
      byId.set(e.id, {
        id: e.id,
        justificacion: e.justificacion,
        impactoEsperado: e.impactoEsperado,
        beneficio: e.beneficio,
        tiempoEstimado: e.tiempoEstimado,
        responsableSugerido: e.responsableSugerido,
      });
    }
  }
  if (byId.size === 0) return null;

  const fallbackById = new Map(fallbackRecommendationEnrichment(recommendations).map((f) => [f.id, f]));
  return recommendations.map((rec) => byId.get(rec.id) ?? fallbackById.get(rec.id)!);
}

export async function generateExecutiveNarrative(context: ExecutiveReportContext, deadlineMs: number = DEFAULT_DEADLINE_MS): Promise<NovaGenerationResult> {
  const recommendations = context.recomendaciones;
  const apiKey = process.env.GROQ_API_KEY;

  if (!apiKey) {
    return {
      sections: {
        executiveSummary: fallbackExecutiveSummary(context),
        executiveInsights: fallbackExecutiveInsights(context),
        executiveAssessment: fallbackExecutiveAssessment(context),
        recommendationEnrichment: fallbackRecommendationEnrichment(recommendations),
        scenarios: null,
      },
      degraded: true,
      degradedSections: ["executiveSummary", "executiveInsights", "executiveAssessment", "recommendationEnrichment"],
    };
  }

  const confidence = computeNovaConfidence(context);
  const groq = new Groq({ apiKey });
  const degradedSections: NovaSectionName[] = [];

  const [executiveSummary, executiveInsights, executiveAssessment, recommendationEnrichment] = await Promise.all([
    (async (): Promise<NovaExecutiveSummary> => {
      try {
        const { system, user } = buildExecutiveSummaryPrompt(context, confidence);
        const validated = validateSummary(await callGroq(groq, system, user, deadlineMs));
        if (validated) return validated;
      } catch {
        // cae a fallback
      }
      degradedSections.push("executiveSummary");
      return fallbackExecutiveSummary(context);
    })(),
    (async (): Promise<NovaExecutiveInsights> => {
      try {
        const { system, user } = buildExecutiveInsightsPrompt(context, confidence);
        const validated = validateInsights(await callGroq(groq, system, user, deadlineMs));
        if (validated) return validated;
      } catch {
        // cae a fallback
      }
      degradedSections.push("executiveInsights");
      return fallbackExecutiveInsights(context);
    })(),
    (async (): Promise<NovaExecutiveAssessment> => {
      try {
        const { system, user } = buildExecutiveAssessmentPrompt(context, confidence);
        const validated = validateAssessment(await callGroq(groq, system, user, deadlineMs));
        if (validated) return validated;
      } catch {
        // cae a fallback
      }
      degradedSections.push("executiveAssessment");
      return fallbackExecutiveAssessment(context);
    })(),
    (async (): Promise<NovaRecommendationEnrichment[]> => {
      try {
        const { system, user } = buildRecommendationEnrichmentPrompt(context, confidence);
        const validated = validateAndAlignRecommendations(await callGroq(groq, system, user, deadlineMs), recommendations);
        if (validated) return validated;
      } catch {
        // cae a fallback
      }
      degradedSections.push("recommendationEnrichment");
      return fallbackRecommendationEnrichment(recommendations);
    })(),
  ]);

  return {
    sections: { executiveSummary, executiveInsights, executiveAssessment, recommendationEnrichment, scenarios: null },
    degraded: degradedSections.length > 0,
    degradedSections,
  };
}
