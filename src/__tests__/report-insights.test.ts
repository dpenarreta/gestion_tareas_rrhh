import { describe, expect, it } from "vitest";
import {
  classifyIndiceEjecutivo,
  computeRiskQuadrant,
  explainMotivoDistribution,
  computeTrendComparisons,
  computeFindings,
  computeRecommendations,
  computeTeamInsights,
  type TeamMonthlyPoint,
} from "@/lib/reportInsights";

// Funciones puras del motor de interpretación de Informes Ejecutivos (Sprint
// Reportes Ejecutivos 2.0) — mismo criterio que analytics-formulas.test.ts:
// caso normal, límite, sin datos y extremo por función.

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

describe("computeRiskQuadrant (Bloque 8 — Mapa de Riesgo)", () => {
  it("caso normal: bajo cumplimiento + sobrecarga → crítico", () => {
    const [p] = computeRiskQuadrant([{ id: "1", name: "A", completedPct: 40, cargaPct: 130 }]);
    expect(p.quadrant).toBe("criticos");
  });

  it("caso límite: exactamente en los umbrales (60% cumplimiento, 100% carga) no cuenta como bajo/alto", () => {
    const [p] = computeRiskQuadrant([{ id: "1", name: "A", completedPct: 60, cargaPct: 100 }]);
    expect(p.quadrant).toBe("saludables");
  });

  it("caso sin datos: lista vacía no lanza", () => {
    expect(computeRiskQuadrant([])).toEqual([]);
  });

  it("caso extremo: alta carga con buen cumplimiento → atención por carga, no crítico", () => {
    const [p] = computeRiskQuadrant([{ id: "1", name: "A", completedPct: 90, cargaPct: 200 }]);
    expect(p.quadrant).toBe("atencion-carga");
  });

  it("bajo cumplimiento sin sobrecarga → atención por cumplimiento", () => {
    const [p] = computeRiskQuadrant([{ id: "1", name: "A", completedPct: 30, cargaPct: 80 }]);
    expect(p.quadrant).toBe("atencion-cumplimiento");
  });
});

describe("explainMotivoDistribution (Bloque 6 — Distribución por Motivo)", () => {
  it("caso normal: motivo dominante (≥30%) con pista de negocio conocida", () => {
    const text = explainMotivoDistribution("NOVEDADES_PAGO", "Novedades de Pago", 34, null);
    expect(text).toContain("34%");
    expect(text).toContain("principal motivo");
    expect(text).toContain("ajustes de nómina");
  });

  it("caso límite: motivo minoritario (<30%) no se etiqueta como principal", () => {
    const text = explainMotivoDistribution("FACTURAS", "Facturas", 10, null);
    expect(text).not.toContain("principal motivo");
  });

  it("caso sin datos: sin período anterior (trendPct null) no menciona tendencia", () => {
    const text = explainMotivoDistribution("FACTURAS", "Facturas", 10, null);
    expect(text).not.toContain("respecto al período anterior");
  });

  it("caso extremo: motivo desconocido (personalizado) no lanza y omite la pista de negocio", () => {
    expect(() => explainMotivoDistribution("MOTIVO_CUSTOM_XYZ", "Motivo Custom", 15, 25)).not.toThrow();
    const text = explainMotivoDistribution("MOTIVO_CUSTOM_XYZ", "Motivo Custom", 15, 25);
    expect(text).toContain("Aumentó 25%");
  });
});

describe("computeTrendComparisons (Bloque 9 — Tendencias)", () => {
  function point(month: string, avgCumplimiento: number, totalTasks = 10): TeamMonthlyPoint {
    return { month, label: month, avgCumplimiento, avgCargaPct: 100, totalConsultas: 0, totalTasks };
  }

  it("caso normal: mejora clara vs. mes anterior", () => {
    const points = [point("2026-05", 60), point("2026-06", 70)];
    const { mesAnterior } = computeTrendComparisons(points);
    expect(mesAnterior.direction).toBe("mejora");
    expect(mesAnterior.delta).toBe(10);
  });

  it("caso límite: delta exactamente en el umbral (5) clasifica como mejora/deterioro, no estable", () => {
    const points = [point("2026-05", 60), point("2026-06", 65)];
    expect(computeTrendComparisons(points).mesAnterior.direction).toBe("mejora");
  });

  it("caso sin datos: un solo punto (sin historial previo) → sin-datos en las 3 comparaciones", () => {
    const { mesAnterior, trimestre, semestre } = computeTrendComparisons([point("2026-06", 70)]);
    expect(mesAnterior.direction).toBe("sin-datos");
    expect(trimestre.direction).toBe("sin-datos");
    expect(semestre.direction).toBe("sin-datos");
  });

  it("caso extremo: meses sin tareas (totalTasks 0) se excluyen del promedio de comparación", () => {
    const points = [point("2026-04", 50, 0), point("2026-05", 80), point("2026-06", 80)];
    const { mesAnterior } = computeTrendComparisons(points);
    expect(mesAnterior.compareValue).toBe(80);
  });
});

describe("computeFindings / computeRecommendations (Bloques 2 y 3)", () => {
  const baseMembers = [
    { name: "Ana", cargaLabel: "Óptimo" as const, completedPct: 90, overdueCount: 0 },
    { name: "Luis", cargaLabel: "Sobrecarga" as const, completedPct: 50, overdueCount: 2 },
  ];

  it("caso normal: sobrecarga + bajo cumplimiento generan hallazgo y recomendación de alta prioridad", () => {
    const findings = computeFindings({ avgCumplimiento: 70, avgCumplimientoDelta: null, members: baseMembers, totalOverdue: 2, topReason: null });
    expect(findings.some((f) => f.tone === "risk")).toBe(true);
    const recs = computeRecommendations({ avgCumplimiento: 70, members: baseMembers, topReason: null });
    expect(recs.some((r) => r.priority === "alta")).toBe(true);
  });

  it("caso límite: sin sobrecarga, sin subutilización, cumplimiento alto → hallazgo positivo de carga adecuada", () => {
    const members = [{ name: "Ana", cargaLabel: "Óptimo" as const, completedPct: 95, overdueCount: 0 }];
    const findings = computeFindings({ avgCumplimiento: 95, avgCumplimientoDelta: null, members, totalOverdue: 0, topReason: null });
    expect(findings.find((f) => f.text.includes("carga general del equipo es adecuada"))?.tone).toBe("positive");
    expect(findings.find((f) => f.text.includes("No existen tareas vencidas"))?.tone).toBe("positive");
  });

  it("caso sin datos: sin miembros no lanza y no genera hallazgos de carga/cumplimiento inventados", () => {
    expect(() => computeFindings({ avgCumplimiento: 0, avgCumplimientoDelta: null, members: [], totalOverdue: 0, topReason: null })).not.toThrow();
  });

  it("caso extremo: delta de cumplimiento fuertemente negativo genera hallazgo de riesgo", () => {
    const findings = computeFindings({ avgCumplimiento: 40, avgCumplimientoDelta: -15, members: [], totalOverdue: 0, topReason: null });
    expect(findings[0].tone).toBe("risk");
    expect(findings[0].text).toContain("disminuyó");
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
