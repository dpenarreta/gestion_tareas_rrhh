import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { ExecutiveReportContext } from "@/lib/executiveReporting/context";

const create = vi.fn();
class MockGroq {
  chat = { completions: { create } };
}
vi.mock("groq-sdk", () => ({ default: MockGroq }));

const { generateExecutiveNarrative } = await import("@/lib/executiveReporting/nova/generateNarrative");

function baseContext(): ExecutiveReportContext {
  return {
    meta: { type: "MENSUAL", periodLabel: "Julio 2026", fechaCorte: new Date().toISOString(), periodStatus: "EN_CURSO", collaboratorCount: 3 },
    resumen: {
      avgCumplimiento: 72,
      avgCargaPct: 95,
      totalConsultas: 12,
      totalTasks: 40,
      totalCompletedTasks: 29,
      estadoGeneralNivel: "Bueno",
      estadoGeneralValor: 78,
      dataQualityPct: 88,
    },
    tendenciaMensual: null,
    tendenciaRango: null,
    hallazgos: ["El equipo mantiene un cumplimiento saludable."],
    insights: ["Ana concentró el 40% del tiempo ejecutado."],
    alertas: [{ userId: "u2", name: "Luis", type: "sobrecarga", value: 130 }],
    distribucionTop: [{ reason: "SOPORTE", count: 5, totalMinutes: 300, pct: 42, trendPct: 10, interpretation: "..." }],
    recomendaciones: [
      { id: "redistribuir-carga-sobrecarga", text: "Redistribuir carga de Luis hacia colaboradores con capacidad disponible.", priority: "alta" },
      { id: "mantener-planificacion", text: "Mantener la planificación actual.", priority: "media" },
    ],
    destacado: { mejor: { id: "u1", name: "Ana", role: "ASISTENTE_GH", score: 90, completedPct: 92 }, atencion: { id: "u2", name: "Luis", role: "ASISTENTE_GH", score: 55, completedPct: 50 } },
  };
}

function validGroqPayload(kind: string): string {
  if (kind === "summary")
    return JSON.stringify({ situacionGeneral: "a", fortalezas: "b", aspectosAtencion: "c", conclusion: "d" });
  if (kind === "insights")
    return JSON.stringify({ patrones: ["p"], cambios: ["c"], anomalias: ["a"], relacionesCruzadas: ["r"] });
  if (kind === "assessment")
    return JSON.stringify({
      diagnosticoGeneral: "d",
      fortalezasEstrategicas: ["f"],
      riesgosDetectados: ["r"],
      oportunidades: ["o"],
      prioridades: ["p"],
      perspectivaEstrategica: "pe",
      opinionEjecutiva: "oe",
    });
  // enrichment
  return JSON.stringify({
    enriquecimiento: [
      { id: "redistribuir-carga-sobrecarga", justificacion: "j", impactoEsperado: "i", areaAfectada: "a", beneficio: "b", complejidadEstimada: "c", tiempoEstimado: "t", responsableSugerido: "r" },
      { id: "mantener-planificacion", justificacion: "j2", impactoEsperado: "i2", areaAfectada: "a2", beneficio: "b2", complejidadEstimada: "c2", tiempoEstimado: "t2", responsableSugerido: "r2" },
    ],
  });
}

beforeEach(() => {
  create.mockReset();
  process.env.GROQ_API_KEY = "test-key";
});
afterEach(() => {
  delete process.env.GROQ_API_KEY;
});

describe("generateExecutiveNarrative — sin GROQ_API_KEY", () => {
  it("degrada las 4 secciones de inmediato, sin llamar a Groq, y nunca queda en blanco", async () => {
    delete process.env.GROQ_API_KEY;
    const result = await generateExecutiveNarrative(baseContext());
    expect(create).not.toHaveBeenCalled();
    expect(result.degraded).toBe(true);
    expect(result.degradedSections.sort()).toEqual(["executiveAssessment", "executiveInsights", "executiveSummary", "recommendationEnrichment"].sort());
    expect(result.sections.executiveSummary.situacionGeneral.length).toBeGreaterThan(0);
    expect(result.sections.recommendationEnrichment).toHaveLength(2);
  });
});

describe("generateExecutiveNarrative — con Groq disponible", () => {
  it("usa la respuesta válida de Groq cuando todo sale bien, en las 4 secciones", async () => {
    create.mockImplementation(async (req: { messages: Array<{ role: string; content: string }> }) => {
      const system = req.messages[0].content as string;
      const kind = system.includes("EXECUTIVE SUMMARY")
        ? "summary"
        : system.includes("EXECUTIVE INSIGHTS")
          ? "insights"
          : system.includes("EXECUTIVE ASSESSMENT")
            ? "assessment"
            : "enrichment";
      return { choices: [{ message: { content: validGroqPayload(kind) } }] };
    });
    const result = await generateExecutiveNarrative(baseContext());
    expect(result.degraded).toBe(false);
    expect(result.sections.executiveSummary).toEqual({ situacionGeneral: "a", fortalezas: "b", aspectosAtencion: "c", conclusion: "d" });
    expect(result.sections.executiveInsights.patrones).toEqual(["p"]);
    expect(result.sections.executiveAssessment.opinionEjecutiva).toBe("oe");
    expect(result.sections.recommendationEnrichment.map((e) => e.id).sort()).toEqual(["mantener-planificacion", "redistribuir-carga-sobrecarga"]);
  });

  it("cae a fallback si Groq lanza un error (nunca bloquea la generación)", async () => {
    create.mockRejectedValue(new Error("groq down"));
    const result = await generateExecutiveNarrative(baseContext());
    expect(result.degraded).toBe(true);
    expect(result.sections.executiveSummary.situacionGeneral.length).toBeGreaterThan(0);
  });

  it("cae a fallback si Groq excede el timeout (nunca bloquea más allá del plazo)", async () => {
    create.mockImplementation(() => new Promise(() => {})); // nunca resuelve
    const start = Date.now();
    const result = await generateExecutiveNarrative(baseContext(), 50);
    expect(Date.now() - start).toBeLessThan(2000);
    expect(result.degraded).toBe(true);
  });

  it("cae a fallback si Groq responde JSON malformado o incompleto", async () => {
    create.mockResolvedValue({ choices: [{ message: { content: "no es json" } }] });
    const result = await generateExecutiveNarrative(baseContext());
    expect(result.degraded).toBe(true);
    expect(result.sections.executiveAssessment.diagnosticoGeneral.length).toBeGreaterThan(0);
  });

  it("el enriquecimiento de recomendaciones nunca inventa ni pierde ids, aunque Groq alucine uno inexistente", async () => {
    create.mockImplementation(async (req: { messages: Array<{ role: string; content: string }> }) => {
      const isEnrichment = req.messages[0].content.includes("Enriqueces una lista FIJA");
      if (!isEnrichment) return { choices: [{ message: { content: "no es json" } }] }; // resto degrada, no es el foco de este test
      return {
        choices: [
          {
            message: {
              content: JSON.stringify({
                enriquecimiento: [
                  { id: "redistribuir-carga-sobrecarga", justificacion: "j", impactoEsperado: "i", areaAfectada: "a", beneficio: "b", complejidadEstimada: "c", tiempoEstimado: "t", responsableSugerido: "r" },
                  { id: "id-inventado-que-no-existe", justificacion: "j", impactoEsperado: "i", areaAfectada: "a", beneficio: "b", complejidadEstimada: "c", tiempoEstimado: "t", responsableSugerido: "r" },
                  // "mantener-planificacion" queda deliberadamente omitido
                ],
              }),
            },
          },
        ],
      };
    });

    const result = await generateExecutiveNarrative(baseContext());
    const ids = result.sections.recommendationEnrichment.map((e) => e.id).sort();
    // exactamente los 2 ids reales — ni el inventado, ni menos de los 2 originales
    expect(ids).toEqual(["mantener-planificacion", "redistribuir-carga-sobrecarga"]);
    expect(result.sections.recommendationEnrichment.find((e) => e.id === "redistribuir-carga-sobrecarga")?.justificacion).toBe("j");
    // el omitido se completó con el fallback determinista, no quedó vacío
    expect(result.sections.recommendationEnrichment.find((e) => e.id === "mantener-planificacion")?.justificacion.length).toBeGreaterThan(0);
  });
});
