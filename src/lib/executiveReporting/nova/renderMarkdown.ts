// Executive Reporting Engine 2.0 — Fase C — adapter temporal: renderiza
// NovaSections (estructurado) como el mismo markdown de un solo bloque que
// MonthlyReports.tsx ya sabe mostrar en su sección "Análisis IA" (##
// encabezados, texto plano — la vista actual NO parsea markdown real, solo
// muestra el texto con whitespace-pre-wrap). Existe para que la UI actual
// siga funcionando sin cambios (Regla de Oro — evolucionar, nunca
// reiniciarse) mientras la Fase E no reemplaza esa sección por las páginas
// reales del documento. Reemplaza — no coexiste con — buildAiAnalysis/
// buildRangeAiAnalysis (su propia llamada a Groq independiente, sin caché,
// se retira: la narrativa ahora viene de generateExecutiveNarrative).
import type { NovaSections } from "./types";
import type { Recommendation } from "@/lib/reportInsights";

function bulletList(items: string[]): string {
  return items.map((i) => `- ${i}`).join("\n");
}

export function renderNovaAsMarkdown(nova: NovaSections, recommendations: Recommendation[]): string {
  const { executiveSummary, executiveInsights, executiveAssessment, recommendationEnrichment } = nova;

  const enrichmentById = new Map(recommendationEnrichment.map((e) => [e.id, e]));
  const recommendationsText =
    recommendations.length > 0
      ? recommendations
          .map((r) => {
            const e = enrichmentById.get(r.id);
            const prioridad = r.priority === "alta" ? "ALTA" : "MEDIA";
            if (!e) return `- [${prioridad}] ${r.text}`;
            return `- [${prioridad}] ${r.text} — ${e.justificacion} (Impacto esperado: ${e.impactoEsperado} · Tiempo estimado: ${e.tiempoEstimado} · Responsable sugerido: ${e.responsableSugerido})`;
          })
          .join("\n")
      : "Sin recomendaciones para este período.";

  return `## Resumen Ejecutivo
${executiveSummary.situacionGeneral}

${executiveSummary.fortalezas}

${executiveSummary.aspectosAtencion}

${executiveSummary.conclusion}

## Fortalezas Estratégicas
${bulletList(executiveAssessment.fortalezasEstrategicas)}

## Riesgos Detectados
${bulletList(executiveAssessment.riesgosDetectados)}

## Patrones y Relaciones Cruzadas
${bulletList([...executiveInsights.patrones, ...executiveInsights.relacionesCruzadas])}

## Oportunidades
${bulletList(executiveAssessment.oportunidades)}

## Recomendaciones
${recommendationsText}

## Perspectiva Estratégica
${executiveAssessment.perspectivaEstrategica}

## Opinión Ejecutiva
${executiveAssessment.opinionEjecutiva}`;
}
