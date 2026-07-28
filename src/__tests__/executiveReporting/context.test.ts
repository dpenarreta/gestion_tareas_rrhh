import { describe, expect, it } from "vitest";
import { deriveExecutiveReportContext } from "@/lib/executiveReporting/context";
import type { ExecutiveReportSnapshotData } from "@/lib/executiveReporting/snapshotData";

function fixture(overrides: Partial<ExecutiveReportSnapshotData> = {}): ExecutiveReportSnapshotData {
  const base = {
    meta: { type: "RANGO_PERSONALIZADO", periodLabel: "01 jul — 28 jul 2026", fechaCorte: "2026-07-28T00:00:00.000Z", periodStatus: "EN_CURSO", collaboratorCount: 2 },
    estadoGeneral: { indiceEjecutivo: null, dataQuality: { pct: 88, issues: [] } },
    teamSummary: { avgCumplimiento: 90, avgCargaPct: 100, totalCargaRealHours: 190, totalCargaBaseHours: 200, totalCompletedTasks: 29, totalConsultas: 12, totalTasks: 40, hoursPerDay: 6.5, cargaRangeMin: 90, cargaRangeMax: 130 },
    members: [
      { id: "u1", name: "Ana", role: "ASISTENTE_GH", score: 90, completedPct: 92 },
      { id: "u2", name: "Luis", role: "ASISTENTE_GH", score: 55, completedPct: 50 },
    ],
    trends: null,
    rangeTrend: null,
    findings: [],
    insights: [],
    alerts: [],
    distribuciones: { consultasByReason: [], riskQuadrant: [] },
    recommendations: [],
  } as unknown as ExecutiveReportSnapshotData;
  return { ...base, ...overrides };
}

describe("deriveExecutiveReportContext — Estado General unificado (bug real corregido)", () => {
  it("resuelve estadoGeneralNivel/Valor con el mismo constructor que la Portada, en vez de null cuando no hay Índice Ejecutivo", () => {
    const ctx = deriveExecutiveReportContext(fixture());
    expect(ctx.resumen.estadoGeneralNivel).not.toBeNull();
    expect(ctx.resumen.estadoGeneralValor).not.toBeNull();
  });

  it("sigue devolviendo null cuando el snapshot está realmente vacío", () => {
    const ctx = deriveExecutiveReportContext(
      fixture({
        members: [],
        teamSummary: { avgCumplimiento: 0, avgCargaPct: 0, totalCargaRealHours: 0, totalCargaBaseHours: 0, totalCompletedTasks: 0, totalConsultas: 0, totalTasks: 0, hoursPerDay: 0, cargaRangeMin: 0, cargaRangeMax: 0 },
      }),
    );
    expect(ctx.resumen.estadoGeneralNivel).toBeNull();
    expect(ctx.resumen.estadoGeneralValor).toBeNull();
  });
});
