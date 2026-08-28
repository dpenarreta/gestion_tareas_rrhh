import { describe, expect, it } from "vitest";
import { classifyIndiceEjecutivo, computeTeamInsights } from "@/lib/reportInsights";

// Funciones puras del motor de interpretación de Informes Ejecutivos (Sprint
// Reportes Ejecutivos 2.0) — mismo criterio que analytics-formulas.test.ts:
// caso normal, límite, sin datos y extremo por función.
//
// Fase 84 (ver docs/AUDIT_LOG.md § 2026-08-27): se retiró la cobertura de
// computeRiskQuadrant/explainMotivoDistribution/computeTrendComparisons/
// computeFindings/computeRecommendations — esas funciones se eliminaron de
// `src/lib/reportInsights.ts` (el cálculo ya lo hace Django, Fases 67-73);
// esa cobertura ya existe del lado Django (`apps/reports/tests/test_insights.py`).

describe("classifyIndiceEjecutivo (Bloque 11 — Índice Ejecutivo del Equipo)", () => {
  it("caso normal: promedio en zona 'Bueno'", () => {
    const r = classifyIndiceEjecutivo(75, 73);
    expect(r.nivel).toBe("Bueno");
    expect(r.color).toBe("green");
    expect(r.valor).toBe(74);
  });

  it("caso límite: exactamente en cada corte (85/70/50) clasifica hacia el nivel superior, inclusive", () => {
    expect(classifyIndiceEjecutivo(85, 85).nivel).toBe("Excelente");
    expect(classifyIndiceEjecutivo(70, 70).nivel).toBe("Bueno");
    expect(classifyIndiceEjecutivo(50, 50).nivel).toBe("Atención");
  });

  it("caso límite: un punto por debajo de cada corte cae en el nivel inferior", () => {
    expect(classifyIndiceEjecutivo(84.9, 84.9).nivel).toBe("Bueno");
    expect(classifyIndiceEjecutivo(69, 69).nivel).toBe("Atención");
    expect(classifyIndiceEjecutivo(49, 49).nivel).toBe("Crítico");
  });

  it("caso sin datos: ambos promedios en 0 → Crítico, sin lanzar", () => {
    const r = classifyIndiceEjecutivo(0, 0);
    expect(r.nivel).toBe("Crítico");
    expect(r.color).toBe("red");
  });

  it("caso extremo: promedios fuera de rango (>100) siguen clasificando sin NaN", () => {
    const r = classifyIndiceEjecutivo(150, 150);
    expect(r.nivel).toBe("Excelente");
    expect(Number.isFinite(r.valor)).toBe(true);
  });
});

describe("computeTeamInsights (Bloque 10)", () => {
  it("caso normal: colaborador concentra ≥20% del tiempo ejecutado genera insight", () => {
    const insights = computeTeamInsights({
      members: [{ name: "Ana", cargaRealHours: 30 }, { name: "Luis", cargaRealHours: 10 }],
      totalCargaRealHours: 40,
    });
    expect(insights[0]).toContain("Ana");
    expect(insights[0]).toContain("75%");
  });

  it("caso límite: concentración repartida (nadie llega al 20% del total) no genera insight de concentración", () => {
    const members = Array.from({ length: 6 }, (_, i) => ({ name: `M${i}`, cargaRealHours: 100 }));
    const insights = computeTeamInsights({ members, totalCargaRealHours: 600 });
    expect(insights.some((i) => i.includes("concentró"))).toBe(false);
  });

  it("caso sin datos: sin horas registradas no lanza y no genera insight de concentración", () => {
    expect(() => computeTeamInsights({ members: [], totalCargaRealHours: 0 })).not.toThrow();
    expect(computeTeamInsights({ members: [], totalCargaRealHours: 0 })).toEqual([]);
  });

  it("caso extremo: máximo 2 insights de consistencia variable aunque haya más colaboradores afectados", () => {
    const insights = computeTeamInsights({
      members: [],
      totalCargaRealHours: 0,
      variableConsistencyMembers: ["A", "B", "C"],
    });
    expect(insights).toHaveLength(2);
  });
});
