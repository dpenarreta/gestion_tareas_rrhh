import { describe, expect, it } from "vitest";
import { buildReportPages } from "@/lib/executiveReporting/documentModel";
import { buildExecutiveReportHtml } from "@/lib/executiveReporting/renderReportHtml";
import { buildExecutiveReportWorkbook } from "@/lib/executiveReporting/renderReportExcel";
import type { ExecutiveReportSnapshotData } from "@/lib/executiveReporting/snapshotData";

function fixtureSnapshot(overrides: Partial<ExecutiveReportSnapshotData> = {}): ExecutiveReportSnapshotData {
  const base: ExecutiveReportSnapshotData = {
    meta: {
      reportId: "NXR-20260728-143522-7F3C",
      origin: "GENERATED",
      integrityFlag: "FULL",
      type: "MENSUAL",
      rosterKind: "CONSOLIDADO",
      scope: "JEFE",
      periodLabel: "julio de 2026",
      periodStart: "2026-07-01T00:00:00.000Z",
      periodEnd: "2026-07-31T23:59:59.000Z",
      fechaCorte: "2026-07-28T00:00:00.000Z",
      periodStatus: "EN_CURSO",
      collaboratorIds: ["u1", "u2"],
      collaboratorCount: 2,
      generatedBy: { userId: "u1", name: "Ana" },
      generatedAt: "2026-07-28T12:00:00.000Z",
      generationMs: 1234,
      versions: { analyticsEngineVersion: "1.5.0", formulaSetVersion: "4.4", reportingEngineVersion: "2.0", nexoVersion: "1.21.0" },
    },
    estadoGeneral: {
      indiceEjecutivo: { valor: 78, nivel: "Bueno", color: "green", explicacion: "El equipo opera de forma saludable.", avgPerformance: 80, avgEquilibrio: 76, variacion: 2 },
      dataQuality: { pct: 88, issues: [] },
    },
    teamSummary: { avgCumplimiento: 72, avgCargaPct: 95, totalCargaRealHours: 190, totalCargaBaseHours: 200, totalCompletedTasks: 29, totalConsultas: 12, totalTasks: 40, hoursPerDay: 6.5, cargaRangeMin: 90, cargaRangeMax: 130 },
    members: [
      {
        id: "u1",
        name: "Ana",
        role: "ASISTENTE_GH",
        score: 90,
        completedPct: 92,
        cargaPct: 95,
        cargaRealHours: 95,
        cargaBaseHours: 100,
        cargaColor: "green",
        cargaLabel: "Óptimo",
        cargaRangeMin: 90,
        cargaRangeMax: 130,
        totalTasks: 20,
        completedTasks: 18,
        overdueCount: 0,
        seguimientoTotal: 6,
        byReason: [{ reason: "SOPORTE", count: 6, totalMinutes: 300 }],
        estadoOperativo: { estado: "Equilibrio Estable", color: "blue", emoji: "🔵", rango: "75–89", explicacionEjecutiva: "Operación saludable." },
        principalHallazgo: "Desempeño sostenido.",
      },
      {
        id: "u2",
        name: "Luis",
        role: "ASISTENTE_GH",
        score: 55,
        completedPct: 50,
        cargaPct: 130,
        cargaRealHours: 130,
        cargaBaseHours: 100,
        cargaColor: "orange",
        cargaLabel: "Carga elevada",
        cargaRangeMin: 90,
        cargaRangeMax: 130,
        totalTasks: 20,
        completedTasks: 10,
        overdueCount: 3,
        seguimientoTotal: 6,
        byReason: [],
        estadoOperativo: { estado: "Requiere Atención", color: "yellow", emoji: "🟡", rango: "60–74", explicacionEjecutiva: "Se recomienda seguimiento." },
        principalHallazgo: "Carga elevada con tareas vencidas.",
      },
    ],
    ranking: [
      { id: "u1", name: "Ana", role: "ASISTENTE_GH", score: 90, completedPct: 92 },
      { id: "u2", name: "Luis", role: "ASISTENTE_GH", score: 55, completedPct: 50 },
    ],
    distribuciones: {
      consultasByReason: [{ reason: "SOPORTE", count: 6, totalMinutes: 300, pct: 100, trendPct: 10, interpretation: "Motivo estable." }],
      riskQuadrant: [
        { id: "u1", name: "Ana", completedPct: 92, cargaPct: 95, quadrant: "saludables" },
        { id: "u2", name: "Luis", completedPct: 50, cargaPct: 130, quadrant: "criticos" },
      ],
    },
    trends: {
      mesAnterior: { label: "Mes anterior", currentValue: 72, compareValue: 68, delta: 4, direction: "mejora" },
      trimestre: { label: "Trimestre", currentValue: 72, compareValue: 70, delta: 2, direction: "mejora" },
      semestre: { label: "Semestre", currentValue: 72, compareValue: 65, delta: 7, direction: "mejora" },
    },
    monthlyEvolution: null,
    rangeTrend: null,
    problematicMonths: null,
    findings: [{ text: "El equipo mantiene un cumplimiento saludable.", tone: "positive" }],
    insights: ["Ana concentró el 45% del tiempo ejecutado por el equipo."],
    indicatorExplanations: {
      cumplimiento: { meaning: "m", why: "w", impact: "i", action: "a" },
      carga: { meaning: "m", why: "w", impact: "i", action: "a" },
      consultas: { meaning: "m", why: "w", impact: "i", action: "a" },
    },
    recommendations: [
      { id: "redistribuir-carga-sobrecarga", text: "Redistribuir carga de Luis hacia colaboradores con capacidad disponible.", priority: "alta" },
      { id: "mantener-planificacion", text: "Mantener la planificación actual.", priority: "media" },
    ],
    alerts: [{ userId: "u2", name: "Luis", type: "sobrecarga", value: 130 }],
    predictivo: null,
    nova: {
      executiveSummary: { situacionGeneral: "a", fortalezas: "b", aspectosAtencion: "c", conclusion: "d" },
      executiveInsights: { patrones: ["p"], cambios: ["c"], anomalias: ["a"], relacionesCruzadas: ["r"] },
      executiveAssessment: {
        diagnosticoGeneral: "d",
        fortalezasEstrategicas: ["f"],
        riesgosDetectados: ["r"],
        oportunidades: ["o"],
        prioridades: ["p"],
        perspectivaEstrategica: "pe",
        opinionEjecutiva: "oe",
      },
      recommendationEnrichment: [
        { id: "redistribuir-carga-sobrecarga", justificacion: "j", impactoEsperado: "i", areaAfectada: "a", beneficio: "b", complejidadEstimada: "c", tiempoEstimado: "t", responsableSugerido: "r" },
        { id: "mantener-planificacion", justificacion: "j2", impactoEsperado: "i2", areaAfectada: "a2", beneficio: "b2", complejidadEstimada: "c2", tiempoEstimado: "t2", responsableSugerido: "r2" },
      ],
      scenarios: null,
    },
    novaDegraded: false,
  };
  return { ...base, ...overrides };
}

describe("buildReportPages", () => {
  it("produce las 11 páginas en el orden fijo del FPS", () => {
    const pages = buildReportPages(fixtureSnapshot());
    expect(pages.map((p) => p.kind)).toEqual([
      "cover",
      "executiveSummary",
      "teamStatus",
      "strategicIndicators",
      "memberDetail",
      "operationalDistribution",
      "insights",
      "assessment",
      "recommendations",
      "predictive",
      "metadata",
    ]);
  });

  it("la página de recomendaciones agrupa correctamente por prioridad", () => {
    const pages = buildReportPages(fixtureSnapshot());
    const recs = pages.find((p) => p.kind === "recommendations");
    expect(recs?.kind).toBe("recommendations");
    if (recs?.kind === "recommendations") {
      expect(recs.alta).toHaveLength(1);
      expect(recs.media).toHaveLength(1);
      expect(recs.alta[0].enrichment?.justificacion).toBe("j");
    }
  });

  it("la página predictiva se marca no disponible cuando predictivo es null", () => {
    const pages = buildReportPages(fixtureSnapshot());
    const predictive = pages.find((p) => p.kind === "predictive");
    expect(predictive?.kind).toBe("predictive");
    if (predictive?.kind === "predictive") {
      expect(predictive.available).toBe(false);
      expect(predictive.message.length).toBeGreaterThan(0);
    }
  });

  it("la página predictiva muestra datos reales del motor cuando el snapshot los trae (mes en curso)", () => {
    const pages = buildReportPages(
      fixtureSnapshot({
        predictivo: {
          asOf: "2026-07-28T12:00:00.000Z",
          horizonDays: 7,
          membersAtRiskSobrecarga: 1,
          avgCumplimientoEsperadoCierrePct: 74,
          members: [
            {
              id: "u1",
              name: "Ana",
              cumplimiento: { available: true, queOcurrira: "Cumplimiento esperado 90%.", porQue: "Ritmo estable.", queHacer: ["Mantener el ritmo."], confidencePct: 80 },
              sobrecarga: { available: true, queOcurrira: "Probabilidad de sobrecarga baja.", porQue: "Capacidad disponible.", nivel: "Bajo", queHacer: ["Sin acción necesaria."], confidencePct: 75 },
              subutilizacion: null,
            },
            {
              id: "u2",
              name: "Luis",
              cumplimiento: { available: false, queOcurrira: "Sin historial suficiente para proyectar.", porQue: "", queHacer: [], confidencePct: 0 },
              sobrecarga: { available: true, queOcurrira: "Probabilidad de sobrecarga alta.", porQue: "Capacidad negativa.", nivel: "Alto", queHacer: ["Redistribuir tareas."], confidencePct: 70 },
              subutilizacion: null,
            },
          ],
        },
      }),
    );
    const predictive = pages.find((p) => p.kind === "predictive");
    expect(predictive?.kind).toBe("predictive");
    if (predictive?.kind === "predictive") {
      expect(predictive.available).toBe(true);
      expect(predictive.membersAtRiskSobrecarga).toBe(1);
      expect(predictive.avgCumplimientoEsperadoCierrePct).toBe(74);
      expect(predictive.members).toHaveLength(2);
      expect(predictive.members[1].sobrecargaNivel).toBe("Alto");
    }

    const html = buildExecutiveReportHtml(pages);
    expect(html).toContain("Probabilidad de sobrecarga alta");
    const wb = buildExecutiveReportWorkbook(pages);
    expect(wb.SheetNames).toContain("Analytics Predictivo");
  });

  it(
    "bug real corregido: la Portada de un Informe de Rango Personalizado con datos completos ya NO muestra " +
      "'Sin datos para el período' solo porque el Índice Ejecutivo no aplica fuera del mes en curso",
    () => {
      const pages = buildReportPages(
        fixtureSnapshot({
          meta: { ...fixtureSnapshot().meta, type: "RANGO_PERSONALIZADO" },
          estadoGeneral: { indiceEjecutivo: null, dataQuality: { pct: 88, issues: [] } },
        }),
      );
      const cover = pages.find((p) => p.kind === "cover");
      expect(cover?.kind).toBe("cover");
      if (cover?.kind === "cover") {
        expect(cover.estadoGeneralLabel).not.toBe("Sin datos para el período");
        expect(cover.estadoGeneralColor).not.toBe("gray");
        expect(cover.scoreGeneral).not.toBeNull();
      }
    },
  );

  it('la Portada SÍ muestra "Sin datos para el período" cuando el snapshot está realmente vacío (sin importar el tipo de reporte)', () => {
    const pages = buildReportPages(
      fixtureSnapshot({
        meta: { ...fixtureSnapshot().meta, type: "RANGO_PERSONALIZADO" },
        estadoGeneral: { indiceEjecutivo: null, dataQuality: { pct: 0, issues: [] } },
        members: [],
        teamSummary: { ...fixtureSnapshot().teamSummary, totalTasks: 0, totalConsultas: 0 },
      }),
    );
    const cover = pages.find((p) => p.kind === "cover");
    expect(cover?.kind).toBe("cover");
    if (cover?.kind === "cover") {
      expect(cover.estadoGeneralLabel).toBe("Sin datos para el período");
      expect(cover.estadoGeneralColor).toBe("gray");
      expect(cover.scoreGeneral).toBeNull();
    }
  });

  it("degrada con gracia cuando nova es null (snapshot legacy) — nunca lanza", () => {
    const pages = buildReportPages(fixtureSnapshot({ nova: null }));
    const summary = pages.find((p) => p.kind === "executiveSummary");
    expect(summary?.kind).toBe("executiveSummary");
    if (summary?.kind === "executiveSummary") {
      expect(summary.situacionGeneral).toBe("No disponible.");
    }
  });

  it("degrada con gracia cuando meta viene undefined (bug real: LEGACY_MIGRATION persistido sin meta) — nunca lanza TypeError", () => {
    const brokenSnapshot = fixtureSnapshot({ meta: undefined as unknown as ExecutiveReportSnapshotData["meta"] });
    expect(() => buildReportPages(brokenSnapshot)).not.toThrow();

    const pages = buildReportPages(brokenSnapshot);
    const cover = pages.find((p) => p.kind === "cover");
    expect(cover?.kind).toBe("cover");
    if (cover?.kind === "cover") {
      expect(cover.periodLabel).toBe("Período no disponible");
      expect(cover.reportId).toBe("—");
      expect(cover.generatedByName).toBe("—");
    }

    const metadata = pages.find((p) => p.kind === "metadata");
    expect(metadata?.kind).toBe("metadata");
    if (metadata?.kind === "metadata") {
      expect(metadata.periodLabel).toBe("Período no disponible");
      expect(metadata.collaboratorCount).toBe(brokenSnapshot.members.length);
    }

    const strategic = pages.find((p) => p.kind === "strategicIndicators");
    expect(strategic?.kind).toBe("strategicIndicators");
  });
});

describe("buildExecutiveReportHtml", () => {
  it("genera HTML no vacío con el Report ID y el período visibles, sin lanzar", () => {
    const pages = buildReportPages(fixtureSnapshot());
    const html = buildExecutiveReportHtml(pages);
    expect(html).toContain("NXR-20260728-143522-7F3C");
    expect(html).toContain("julio de 2026");
    expect(html.length).toBeGreaterThan(1000);
  });

  it("escapa contenido para evitar inyectar HTML desde datos del reporte", () => {
    const pages = buildReportPages(fixtureSnapshot({ meta: { ...fixtureSnapshot().meta, generatedBy: { userId: "u1", name: '<img src=x onerror=alert(1)>' } } }));
    const html = buildExecutiveReportHtml(pages);
    expect(html).not.toContain("<img src=x onerror=alert(1)>");
    expect(html).toContain("&lt;img");
  });
});

describe("buildExecutiveReportWorkbook", () => {
  it("genera un workbook con las hojas esperadas, sin lanzar", () => {
    const pages = buildReportPages(fixtureSnapshot());
    const wb = buildExecutiveReportWorkbook(pages);
    expect(wb.SheetNames).toContain("Resumen");
    expect(wb.SheetNames).toContain("Detalle por Colaborador");
    expect(wb.SheetNames).toContain("Recomendaciones");
    expect(wb.SheetNames).toContain("Metadatos");
  });
});
