import { describe, expect, it, vi, beforeEach } from "vitest";
import type { CapacityForecast } from "@/lib/capacityForecast";

const computeTeamCapacityForecast = vi.fn();
vi.mock("@/lib/capacityForecast", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/capacityForecast")>();
  return { ...actual, computeTeamCapacityForecast: (...a: unknown[]) => computeTeamCapacityForecast(...a) };
});

const getAllEffectiveRoleCompatibility = vi.fn();
const ANALYTICS_CONFIG_FIXTURE = {
  healthWeightCumplimiento: 25,
  healthWeightCarga: 25,
  healthWeightVencidas: 20,
  healthWeightConsistencia: 15,
  healthWeightCapacidad: 15,
  perfWeightCumplimiento: 35,
  perfWeightVencidas: 25,
  perfWeightConsistencia: 25,
  perfWeightTrazabilidad: 15,
  riskWeightSobrecarga: 22,
  riskWeightVencidasCriticas: 18,
  riskWeightTendenciaNegativa: 15,
  riskWeightHorasExtra: 12,
  riskWeightBajaCapacidad: 11,
  riskWeightVariabilidad: 10,
  riskWeightConcentracion: 7,
  riskWeightSinPlanificacion: 5,
  riskThresholdMedio: 31,
  riskThresholdAlto: 61,
  riskThresholdCritico: 81,
  alertOverdueTaskThreshold: 3,
  alertConsecutiveOverloadDays: 3,
  anomalyVariationThresholdPct: 30,
  cacheTtlMinutes: 15,
  predictionMinWeeksMedia: 2,
  predictionMinWeeksAlta: 4,
};
// getEffectiveAnalyticsConfig NO se deja como la implementación real — pegaría
// contra Prisma (el mock global de Prisma del setup de tests lanza si no se
// mockea explícitamente). Este test no ejercita esa configuración, solo
// necesita un objeto con la forma correcta.
vi.mock("@/lib/systemConfig", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/systemConfig")>();
  return {
    ...actual,
    getEffectiveAnalyticsConfig: vi.fn().mockResolvedValue(ANALYTICS_CONFIG_FIXTURE),
    getAllEffectiveRoleCompatibility: (...a: unknown[]) => getAllEffectiveRoleCompatibility(...a),
  };
});

const { computeTeamRecommendations } = await import("@/lib/analytics");

function fixtureCapacity(disponible: number, baseFuturaTotal = 40): CapacityForecast {
  const disponiblePct = baseFuturaTotal > 0 ? Math.round((disponible / baseFuturaTotal) * 100) : 0;
  return {
    userId: "x",
    horasRestantesHoy: 0,
    diasLaborablesRestantes: 5,
    baseFuturaTotal,
    comprometidoEnProgreso: 0,
    comprometidoPendiente: baseFuturaTotal - disponible,
    comprometidoFuturo: baseFuturaTotal - disponible,
    disponible,
    disponiblePct,
    estado: disponible < 0 ? "sobrecarga" : "alta",
    estadoColor: disponible < 0 ? "red" : "green",
    estadoLabel: "",
    tasksSinEstimar: 0,
    confiabilidad: { pct: 100, holidaysConfigured: true, tasksWithoutEstimate: 0 },
  };
}

describe("computeTeamRecommendations — compatibilidad organizacional", () => {
  beforeEach(() => {
    computeTeamCapacityForecast.mockReset();
    getAllEffectiveRoleCompatibility.mockReset().mockResolvedValue({});
  });

  it("Regla 1 — prioriza el mismo cargo aunque exista un cargo compatible con más capacidad disponible", async () => {
    computeTeamCapacityForecast.mockResolvedValue(
      new Map([
        ["over1", fixtureCapacity(-8)],
        ["same1", fixtureCapacity(10)], // mismo cargo, cubre el excedente
        ["compat1", fixtureCapacity(30)], // cargo compatible, más capacidad, pero NO debe usarse
      ])
    );
    getAllEffectiveRoleCompatibility.mockResolvedValue({ ASISTENTE_GH: ["ASISTENTE_NOMINA"] });

    const members = [
      { id: "over1", name: "Over", role: "ASISTENTE_GH" as const },
      { id: "same1", name: "Same", role: "ASISTENTE_GH" as const },
      { id: "compat1", name: "Compat", role: "ASISTENTE_NOMINA" as const },
    ];
    const [rec] = await computeTeamRecommendations(members);
    expect(rec.hasCandidate).toBe(true);
    expect(rec.text).toContain("Same");
    expect(rec.text).not.toContain("Compat");
  });

  it("Regla 2/3 — sin candidato del mismo cargo, usa la Matriz de Compatibilidad como respaldo", async () => {
    computeTeamCapacityForecast.mockResolvedValue(
      new Map([
        ["over1", fixtureCapacity(-8)],
        ["compat1", fixtureCapacity(10)],
      ])
    );
    getAllEffectiveRoleCompatibility.mockResolvedValue({ ASISTENTE_GH: ["ASISTENTE_NOMINA"] });

    const members = [
      { id: "over1", name: "Over", role: "ASISTENTE_GH" as const },
      { id: "compat1", name: "Compat", role: "ASISTENTE_NOMINA" as const },
    ];
    const [rec] = await computeTeamRecommendations(members);
    expect(rec.hasCandidate).toBe(true);
    expect(rec.text).toContain("Compat");
  });

  it("sin entrada en la matriz, un cargo del mismo nivel pero NO marcado compatible nunca es candidato", async () => {
    computeTeamCapacityForecast.mockResolvedValue(
      new Map([
        ["over1", fixtureCapacity(-8)],
        ["other1", fixtureCapacity(10)],
      ])
    );
    getAllEffectiveRoleCompatibility.mockResolvedValue({}); // sin configurar

    const members = [
      { id: "over1", name: "Over", role: "ASISTENTE_GH" as const },
      { id: "other1", name: "Other", role: "ASISTENTE_NOMINA" as const },
    ];
    const [rec] = await computeTeamRecommendations(members);
    expect(rec.hasCandidate).toBe(false);
  });

  it("Regla 4 — nunca redistribuye entre niveles jerárquicos distintos, incluso con capacidad de sobra y sin matriz que lo prohíba", async () => {
    computeTeamCapacityForecast.mockResolvedValue(
      new Map([
        ["over1", fixtureCapacity(-8)], // ASISTENTE_GH, nivel 1
        ["coord1", fixtureCapacity(100)], // COORDINADOR_ZS, nivel 2 — mucha capacidad, pero nivel distinto
      ])
    );
    // La matriz ni siquiera permite configurar esto (el API lo rechazaría),
    // pero el motor debe descartarlo de todas formas — defensa en profundidad.
    getAllEffectiveRoleCompatibility.mockResolvedValue({});

    const members = [
      { id: "over1", name: "Over", role: "ASISTENTE_GH" as const },
      { id: "coord1", name: "Coord", role: "COORDINADOR_ZS" as const },
    ];
    const [rec] = await computeTeamRecommendations(members);
    expect(rec.hasCandidate).toBe(false);
    expect(rec.text).not.toContain("Coord");
  });

  it("Regla 5 — sin ningún candidato compatible, emite el mensaje explícito en vez de una recomendación incorrecta", async () => {
    computeTeamCapacityForecast.mockResolvedValue(new Map([["over1", fixtureCapacity(-8)]]));
    getAllEffectiveRoleCompatibility.mockResolvedValue({});

    const members = [{ id: "over1", name: "Solo", role: "ASISTENTE_GH" as const }];
    // computeTeamRecommendations exige al menos 2 miembros para producir algo.
    const zero = await computeTeamRecommendations(members);
    expect(zero).toEqual([]);

    // Con un segundo miembro incompatible, sí debe emitir el mensaje de Regla 5.
    computeTeamCapacityForecast.mockResolvedValue(
      new Map([
        ["over1", fixtureCapacity(-8)],
        ["coord1", fixtureCapacity(100)],
      ])
    );
    const members2 = [
      { id: "over1", name: "Solo", role: "ASISTENTE_GH" as const },
      { id: "coord1", name: "Coord", role: "COORDINADOR_ZS" as const },
    ];
    const [rec] = await computeTeamRecommendations(members2);
    expect(rec.hasCandidate).toBe(false);
    expect(rec.text).toBe("No existe actualmente un colaborador compatible para redistribuir esta carga operativa (Solo).");
    expect(rec.impactScorePts).toBe(0);
    expect(rec.impactRiskPts).toBe(0);
  });
});
