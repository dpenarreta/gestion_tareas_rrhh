import { describe, expect, it, vi, beforeEach } from "vitest";

const userFindUnique = vi.fn();
const taskFindMany = vi.fn();
const taskFindFirst = vi.fn();
const taskActivityFindMany = vi.fn();
const taskActivityFindFirst = vi.fn();
const activityReasonFindMany = vi.fn();
const specialStatusFindMany = vi.fn();
const holidayFindMany = vi.fn();
const systemConfigHistoryCount = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: userFindUnique },
    task: { findMany: taskFindMany, findFirst: taskFindFirst },
    taskActivity: { findMany: taskActivityFindMany, findFirst: taskActivityFindFirst },
    activityReason: { findMany: activityReasonFindMany },
    specialStatus: { findMany: specialStatusFindMany },
    holiday: { findMany: holidayFindMany },
    systemConfigHistory: { count: systemConfigHistoryCount },
  },
}));

// Cutover de stack (Fase 87, ver docs/AUDIT_LOG.md § 2026-08-28):
// resolveRoster.ts ya no lee prisma.user directo — delega en
// `GET /reports/roster/` (Django, RosterView) vía este adaptador. La
// narrowing por roles/áreas/liderazgo ya está probada del lado Django
// (backend/apps/reports/tests/test_roster_view.py) — estos tests ya no
// verifican esa lógica, solo que resolveReportRoster reenvía filtros y
// mapea la respuesta.
const fetchDjangoReportRoster = vi.fn();
vi.mock("@/lib/djangoReportRosterAdapter", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/djangoReportRosterAdapter")>();
  return { ...actual, fetchDjangoReportRoster: (...a: unknown[]) => fetchDjangoReportRoster(...a) };
});

// Cutover de stack (Fase 84, ver docs/AUDIT_LOG.md § 2026-08-27):
// getMonthClosurePeriod (src/lib/closurePeriod.ts) ya no lee prisma.monthClosure
// directo — lee Django vía fetchDjangoMonthClosure.
const fetchDjangoMonthClosure = vi.fn();
vi.mock("@/lib/djangoClosurePeriodAdapter", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/djangoClosurePeriodAdapter")>();
  return { ...actual, fetchDjangoMonthClosure: (...a: unknown[]) => fetchDjangoMonthClosure(...a) };
});

const monthlyBusinessBase = vi.fn();
vi.mock("@/lib/workload", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/workload")>();
  return {
    ...actual,
    monthlyBusinessBase: (...a: unknown[]) => monthlyBusinessBase(...a),
  };
});

// Cutover de stack (Fase 72, ver docs/AUDIT_LOG.md § 2026-08-26):
// buildMonthlySnapshotData ya no calcula ReportMemberKpi/agregados de equipo
// localmente contra Prisma — llama a Django (djangoReportKpisBridge.ts). Ese
// cálculo YA está cubierto exhaustivamente del lado Django
// (backend/apps/reports/tests/test_member_kpis.py — as_of_fecha_corte,
// prorrateo, etc. — verificado con datos sintéticos reales en las Fases
// 70/71) — estos tests mockean el bundle en vez de duplicar esa cobertura,
// y se concentran en lo que SIGUE en TS: resolución de fecha de corte,
// metadatos, inmutabilidad, roster. El puente cuid↔id-Django
// (`resolveDjangoIdsForRoster`) se retiró por completo (decisión explícita
// del usuario, ver docs/AUDIT_LOG.md § 2026-08-31) — el roster ya expone el
// id numérico de Django directo, sin traducción.
const fetchMonthlyTeamReport = vi.fn();
const fetchCustomRangeTeamReport = vi.fn();
const fetchRangeTeamReport = vi.fn();
// Cutover de stack (Fase 89, ver docs/AUDIT_LOG.md § 2026-08-28):
// `prisma.monthlyReport.findUnique` (variación del Índice Ejecutivo contra
// el mes anterior) pasó a `GET /reports/monthly-report/` (Django).
const fetchDjangoMonthlyReport = vi.fn();
vi.mock("@/lib/executiveReporting/djangoReportKpisBridge", () => ({
  fetchMonthlyTeamReport: (...a: unknown[]) => fetchMonthlyTeamReport(...a),
  fetchCustomRangeTeamReport: (...a: unknown[]) => fetchCustomRangeTeamReport(...a),
  fetchRangeTeamReport: (...a: unknown[]) => fetchRangeTeamReport(...a),
  fetchDjangoMonthlyReport: (...a: unknown[]) => fetchDjangoMonthlyReport(...a),
}));

const { buildMonthlySnapshotData, buildCustomRangeSnapshotData, buildRangeSnapshotData } = await import("@/lib/executiveReporting/buildSnapshotData");
const { resolveReportRoster } = await import("@/lib/executiveReporting/resolveRoster");

function emptyIndicatorExplanation() {
  return { meaning: "", why: "", impact: "", action: "" };
}

function defaultTeamReportBundle() {
  return {
    teamSummary: { avgCumplimiento: 0, avgCargaPct: 0, totalCargaRealHours: 0, totalCargaBaseHours: 0, totalCompletedTasks: 0, totalConsultas: 0, totalTasks: 0, hoursPerDay: 6.5, cargaRangeMin: 100, cargaRangeMax: 120 },
    members: [
      { id: "sub1", name: "Ana", role: "ASISTENTE_GH", score: 0, completedPct: 0, cargaPct: 0, cargaRealHours: 0, cargaBaseHours: 0, cargaColor: "green", cargaLabel: "Óptimo", cargaRangeMin: 100, cargaRangeMax: 120, totalTasks: 0, completedTasks: 0, overdueCount: 0, seguimientoTotal: 0, byReason: [], baseWasProrated: false },
    ],
    ranking: [{ id: "sub1", name: "Ana", role: "ASISTENTE_GH", score: 0, completedPct: 0 }],
    distribuciones: { consultasByReason: [], riskQuadrant: [{ id: "sub1", name: "Ana", completedPct: 0, cargaPct: 0, quadrant: "saludables" }] },
    trends: {
      mesAnterior: { label: "Mes anterior", currentValue: 0, compareValue: null, delta: null, direction: "sin-datos" },
      trimestre: { label: "Trimestre (prom. 3 meses)", currentValue: 0, compareValue: null, delta: null, direction: "sin-datos" },
      semestre: { label: "Semestre (prom. 6 meses)", currentValue: 0, compareValue: null, delta: null, direction: "sin-datos" },
    },
    findings: [],
    recommendations: [],
    indicatorExplanations: { cumplimiento: emptyIndicatorExplanation(), carga: emptyIndicatorExplanation(), consultas: emptyIndicatorExplanation() },
    alerts: [],
    dataQuality: { pct: 100, issues: [] },
  };
}

function defaultCustomRangeTeamReportBundle() {
  const { trends: _trends, ...rest } = defaultTeamReportBundle();
  void _trends; // RANGO_PERSONALIZADO no tiene tarjetas de tendencia (trends: null en el resultado final).
  return { ...rest, insights: [] };
}

function defaultRangeTeamReportBundle() {
  const { trends: _trends, ...rest } = defaultTeamReportBundle();
  void _trends;
  return {
    ...rest,
    insights: [],
    monthlyEvolution: [
      {
        month: "2026-06",
        label: "junio de 2026",
        teamAvgCumplimiento: 0,
        totalCompletedTasks: 0,
        totalTasks: 0,
        totalCargaRealHours: 0,
        totalCargaBaseHours: 0,
        totalConsultas: 0,
        memberSnapshots: { sub1: { completedPct: 0, cargaPct: 0, cargaColor: "green", cargaLabel: "Óptimo", score: 0, totalTasks: 0 } },
      },
    ],
    rangeTrend: { cumplimientoTrend: "estancamiento", cumplimientoChange: 0, firstMonthAvgCumplimiento: 0, lastMonthAvgCumplimiento: 0 },
    problematicMonths: [],
  };
}

function resetAll() {
  fetchDjangoReportRoster.mockReset().mockResolvedValue({
    users: [{ id: "sub1", name: "Ana", role: "ASISTENTE_GH" }],
    user_ids: ["sub1"],
    scope: "JEFE",
    roster_kind: "CONSOLIDADO",
  });
  userFindUnique.mockReset().mockResolvedValue({ kpiStartDate: null, createdAt: new Date("2000-01-01") });
  taskFindMany.mockReset().mockResolvedValue([]);
  taskFindFirst.mockReset().mockResolvedValue(null);
  taskActivityFindMany.mockReset().mockResolvedValue([]);
  taskActivityFindFirst.mockReset().mockResolvedValue(null);
  activityReasonFindMany.mockReset().mockResolvedValue([]);
  specialStatusFindMany.mockReset().mockResolvedValue([]);
  holidayFindMany.mockReset().mockResolvedValue([]);
  systemConfigHistoryCount.mockReset().mockResolvedValue(1);
  fetchDjangoMonthClosure.mockReset().mockResolvedValue(null);
  fetchDjangoMonthlyReport.mockReset().mockResolvedValue(null);
  monthlyBusinessBase.mockReset().mockImplementation(async (year: number, month: number) => ({
    start: new Date(Date.UTC(year, month - 1, 1)),
    end: new Date(Date.UTC(year, month, 1) - 1),
    businessDays: 20,
    baseHours: 100,
    hoursPerDay: 6.5,
    limitLowPerDay: 5.5,
    limitHighPerDay: 7.5,
    limitOverloadPerDay: 8.5,
    limitLowHours: 80,
    limitHighHours: 120,
    limitOverloadHours: 140,
  }));
  fetchMonthlyTeamReport.mockReset().mockResolvedValue(defaultTeamReportBundle());
  fetchCustomRangeTeamReport.mockReset().mockResolvedValue(defaultCustomRangeTeamReportBundle());
  fetchRangeTeamReport.mockReset().mockResolvedValue(defaultRangeTeamReportBundle());
}

describe("buildMonthlySnapshotData — bundle de Django (ReportMemberKpi + agregados de equipo)", () => {
  beforeEach(resetAll);

  it("pasa los userIds del roster directo a fetchMonthlyTeamReport, sin traducción de id", async () => {
    const roster = await resolveReportRoster({ role: "JEFE_NACIONAL" }, {});
    await buildMonthlySnapshotData({
      roster,
      filters: { periodo: { tipoReporte: "MENSUAL", month: 6, year: 2026 } },
      generatedBy: { userId: "u1", name: "Ana" },
      now: new Date("2026-08-01"),
    });

    expect(fetchMonthlyTeamReport).toHaveBeenCalledTimes(1);
    expect(fetchMonthlyTeamReport.mock.calls[0][0]).toEqual(["sub1"]);
  });

  it("members/teamSummary/findings del snapshot vienen tal cual del bundle de Django", async () => {
    fetchMonthlyTeamReport.mockResolvedValue({
      ...defaultTeamReportBundle(),
      teamSummary: { ...defaultTeamReportBundle().teamSummary, avgCumplimiento: 87 },
      findings: [{ text: "Hallazgo de prueba", tone: "positive" }],
    });

    const roster = await resolveReportRoster({ role: "JEFE_NACIONAL" }, {});
    const snapshot = await buildMonthlySnapshotData({
      roster,
      filters: { periodo: { tipoReporte: "MENSUAL", month: 6, year: 2026 } },
      generatedBy: { userId: "u1", name: "Ana" },
      now: new Date("2026-08-01"),
    });

    expect(snapshot.teamSummary.avgCumplimiento).toBe(87);
    expect(snapshot.findings).toEqual([{ text: "Hallazgo de prueba", tone: "positive" }]);
  });

  it("integrityCheck queda null para un mes que no es el mes en curso (Sprint R, Fase 79 — solo corre para el mes en curso)", async () => {
    const roster = await resolveReportRoster({ role: "JEFE_NACIONAL" }, {});
    const snapshot = await buildMonthlySnapshotData({
      roster,
      filters: { periodo: { tipoReporte: "MENSUAL", month: 6, year: 2026 } },
      generatedBy: { userId: "u1", name: "Ana" },
      now: new Date("2026-08-01"),
    });

    expect(snapshot.integrityCheck).toBeNull();
  });

  it("si Django no responde, la generación del reporte falla explícitamente", async () => {
    fetchMonthlyTeamReport.mockRejectedValue(new Error("No se pudo calcular el reporte vía Django"));

    const roster = await resolveReportRoster({ role: "JEFE_NACIONAL" }, {});
    await expect(
      buildMonthlySnapshotData({
        roster,
        filters: { periodo: { tipoReporte: "MENSUAL", month: 6, year: 2026 } },
        generatedBy: { userId: "u1", name: "Ana" },
        now: new Date("2026-08-01"),
      }),
    ).rejects.toThrow("No se pudo calcular el reporte vía Django");
  });
});

describe("buildMonthlySnapshotData — meta e inmutabilidad", () => {
  beforeEach(resetAll);

  it("meta trae Report ID, versiones, generador y tiempo de generación", async () => {
    const roster = await resolveReportRoster({ role: "JEFE_NACIONAL" }, {});
    const snapshot = await buildMonthlySnapshotData({
      roster,
      filters: { periodo: { tipoReporte: "MENSUAL", month: 6, year: 2026 } },
      generatedBy: { userId: "u1", name: "Ana" },
      now: new Date("2026-08-01"),
    });

    expect(snapshot.meta.reportId).toMatch(/^NXR-\d{8}-\d{6}-/);
    expect(snapshot.meta.origin).toBe("GENERATED");
    expect(snapshot.meta.integrityFlag).toBe("FULL");
    expect(snapshot.meta.generatedBy).toEqual({ userId: "u1", name: "Ana" });
    expect(typeof snapshot.meta.generationMs).toBe("number");
    expect(snapshot.meta.versions.reportingEngineVersion).toBe("2.0");
    expect(snapshot.meta.versions.analyticsEngineVersion).toBeTruthy();
  });

  it("el snapshot devuelto está congelado — ningún consumidor puede modificarlo", async () => {
    const roster = await resolveReportRoster({ role: "JEFE_NACIONAL" }, {});
    const snapshot = await buildMonthlySnapshotData({
      roster,
      filters: { periodo: { tipoReporte: "MENSUAL", month: 6, year: 2026 } },
      generatedBy: { userId: "u1", name: "Ana" },
      now: new Date("2026-08-01"),
    });

    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.meta)).toBe(true);
    expect(Object.isFrozen(snapshot.members)).toBe(true);
    expect(() => {
      "use strict";
      (snapshot.teamSummary as unknown as { avgCumplimiento: number }).avgCumplimiento = 999;
    }).toThrow();
  });
});

describe("buildMonthlySnapshotData — Motor de Cierre Inteligente con Fecha de Corte", () => {
  beforeEach(resetAll);

  it("un mes con MonthClosure hereda cutoffDate como fechaCorte por defecto, sin importar cuándo se genera el reporte", async () => {
    fetchDjangoMonthClosure.mockResolvedValue({
      cutoffDate: new Date(Date.UTC(2026, 5, 20)), // 20 de junio, no el fin de mes
      closureType: "MANUAL",
      calendarDaysTotal: 30,
      calendarDaysConsidered: 20,
      workingDaysConsidered: 14,
      workingHoursConsidered: 91,
      closedAt: new Date(Date.UTC(2026, 6, 5)),
    });

    const roster = await resolveReportRoster({ role: "JEFE_NACIONAL" }, {});
    const snapshot = await buildMonthlySnapshotData({
      roster,
      filters: { periodo: { tipoReporte: "MENSUAL", month: 6, year: 2026 } }, // sin fechaCorte explícita
      generatedBy: { userId: "u1", name: "Ana" },
      now: new Date("2026-09-15"), // generado mucho después del cierre
    });

    // fechaCorte hereda el día del cierre (20/06), no "ahora" ni el fin de mes —
    // convertido al instante real de FIN del día hábil de negocio (UTC-5), igual
    // que el resto del motor pasa de "día calendario" a "instante real"
    // (businessDayRealRange): 20/06 medianoche UTC -> 21/06 04:59:59.999 UTC.
    expect(snapshot.meta.fechaCorte).toBe(new Date(Date.UTC(2026, 5, 21, 4, 59, 59, 999)).toISOString());
    expect(snapshot.meta.closure).toEqual({
      closureType: "MANUAL",
      cutoffDate: new Date(Date.UTC(2026, 5, 20)).toISOString(),
      closedAt: new Date(Date.UTC(2026, 6, 5)).toISOString(),
      calendarDaysTotal: 30,
      calendarDaysConsidered: 20,
      workingDaysConsidered: 14,
      workingHoursConsidered: 91,
    });
  });

  it("un fechaCorte explícito sigue ganando sobre el default heredado del cierre", async () => {
    fetchDjangoMonthClosure.mockResolvedValue({
      cutoffDate: new Date(Date.UTC(2026, 5, 20)),
      closureType: "MANUAL",
      calendarDaysTotal: 30,
      calendarDaysConsidered: 20,
      workingDaysConsidered: 14,
      workingHoursConsidered: 91,
      closedAt: new Date(Date.UTC(2026, 6, 5)),
    });

    const roster = await resolveReportRoster({ role: "JEFE_NACIONAL" }, {});
    const snapshot = await buildMonthlySnapshotData({
      roster,
      filters: { periodo: { tipoReporte: "MENSUAL", month: 6, year: 2026 }, fechaCorte: new Date("2026-06-10T00:00:00.000Z") },
      generatedBy: { userId: "u1", name: "Ana" },
      now: new Date("2026-09-15"),
    });

    expect(snapshot.meta.fechaCorte).toBe(new Date("2026-06-10T00:00:00.000Z").toISOString());
    // El bloque `closure` (info del cierre) sigue presente aunque el corte usado sea el explícito.
    expect(snapshot.meta.closure?.closureType).toBe("MANUAL");
  });

  it("un mes con MonthClosure de closureType NORMAL no aparece como bloque de cierre en meta (closure sigue poblado, pero closureType es NORMAL)", async () => {
    fetchDjangoMonthClosure.mockResolvedValue({
      cutoffDate: new Date(Date.UTC(2026, 5, 30)),
      closureType: "NORMAL",
      calendarDaysTotal: 30,
      calendarDaysConsidered: 30,
      workingDaysConsidered: 22,
      workingHoursConsidered: 143,
      closedAt: new Date(Date.UTC(2026, 6, 1)),
    });

    const roster = await resolveReportRoster({ role: "JEFE_NACIONAL" }, {});
    const snapshot = await buildMonthlySnapshotData({
      roster,
      filters: { periodo: { tipoReporte: "MENSUAL", month: 6, year: 2026 } },
      generatedBy: { userId: "u1", name: "Ana" },
      now: new Date("2026-09-15"),
    });

    expect(snapshot.meta.closure?.closureType).toBe("NORMAL");
  });

  it("un mes sin MonthClosure no trae bloque de cierre (comportamiento histórico intacto)", async () => {
    fetchDjangoMonthClosure.mockResolvedValue(null);

    const roster = await resolveReportRoster({ role: "JEFE_NACIONAL" }, {});
    const snapshot = await buildMonthlySnapshotData({
      roster,
      filters: { periodo: { tipoReporte: "MENSUAL", month: 6, year: 2026 } },
      generatedBy: { userId: "u1", name: "Ana" },
      now: new Date("2026-08-01"),
    });

    expect(snapshot.meta.closure).toBeNull();
  });
});

describe("buildCustomRangeSnapshotData — bundle de Django (Fase 73)", () => {
  beforeEach(resetAll);

  it("pasa los userIds del roster directo a fetchCustomRangeTeamReport, con periodStart/periodEnd correctos", async () => {
    const roster = await resolveReportRoster({ role: "JEFE_NACIONAL" }, {});
    await buildCustomRangeSnapshotData({
      roster,
      filters: { periodo: { tipoReporte: "RANGO_PERSONALIZADO", from: "2026-06-01", to: "2026-06-20" } },
      generatedBy: { userId: "u1", name: "Ana" },
      now: new Date("2026-08-01"),
    });

    expect(fetchCustomRangeTeamReport).toHaveBeenCalledTimes(1);
    const [userIds, periodStart, periodEnd] = fetchCustomRangeTeamReport.mock.calls[0];
    expect(userIds).toEqual(["sub1"]);
    expect(periodStart.toISOString()).toBe("2026-06-01T00:00:00.000Z");
    expect(periodEnd.toISOString()).toBe("2026-06-20T23:59:59.999Z");
  });

  it("members/teamSummary/findings/insights del snapshot vienen tal cual del bundle de Django", async () => {
    fetchCustomRangeTeamReport.mockResolvedValue({
      ...defaultCustomRangeTeamReportBundle(),
      teamSummary: { ...defaultCustomRangeTeamReportBundle().teamSummary, avgCumplimiento: 73 },
      insights: ["Ana concentró el 100% del tiempo ejecutado por el equipo este período."],
    });

    const roster = await resolveReportRoster({ role: "JEFE_NACIONAL" }, {});
    const snapshot = await buildCustomRangeSnapshotData({
      roster,
      filters: { periodo: { tipoReporte: "RANGO_PERSONALIZADO", from: "2026-06-01", to: "2026-06-20" } },
      generatedBy: { userId: "u1", name: "Ana" },
      now: new Date("2026-08-01"),
    });

    expect(snapshot.teamSummary.avgCumplimiento).toBe(73);
    expect(snapshot.insights).toEqual(["Ana concentró el 100% del tiempo ejecutado por el equipo este período."]);
    expect(snapshot.meta.closure).toBeNull();
    expect(snapshot.trends).toBeNull();
    expect(snapshot.monthlyEvolution).toBeNull();
    // Sprint R (Fase 79) solo corre para MENSUAL del mes en curso — nunca para RANGO_PERSONALIZADO.
    expect(snapshot.integrityCheck).toBeNull();
  });

  it("si Django no responde, la generación del reporte falla explícitamente", async () => {
    fetchCustomRangeTeamReport.mockRejectedValue(new Error("No se pudo calcular el reporte vía Django"));

    const roster = await resolveReportRoster({ role: "JEFE_NACIONAL" }, {});
    await expect(
      buildCustomRangeSnapshotData({
        roster,
        filters: { periodo: { tipoReporte: "RANGO_PERSONALIZADO", from: "2026-06-01", to: "2026-06-20" } },
        generatedBy: { userId: "u1", name: "Ana" },
        now: new Date("2026-08-01"),
      }),
    ).rejects.toThrow("No se pudo calcular el reporte vía Django");
  });
});

describe("buildRangeSnapshotData — bundle de Django (Fase 73)", () => {
  beforeEach(resetAll);

  it("pasa los userIds del roster directo a fetchRangeTeamReport, con from/to correctos", async () => {
    const roster = await resolveReportRoster({ role: "JEFE_NACIONAL" }, {});
    await buildRangeSnapshotData({
      roster,
      filters: { periodo: { tipoReporte: "RANGO_MESES", from: "2026-05", to: "2026-06" } },
      generatedBy: { userId: "u1", name: "Ana" },
      now: new Date("2026-08-01"),
    });

    expect(fetchRangeTeamReport).toHaveBeenCalledTimes(1);
    const [userIds, fromYear, fromMonth, toYear, toMonth] = fetchRangeTeamReport.mock.calls[0];
    expect(userIds).toEqual(["sub1"]);
    expect([fromYear, fromMonth, toYear, toMonth]).toEqual([2026, 5, 2026, 6]);
  });

  it("monthlyEvolution reconstruye memberSnapshots como array con identidad, a partir del id numérico de Django directo", async () => {
    const roster = await resolveReportRoster({ role: "JEFE_NACIONAL" }, {});
    const snapshot = await buildRangeSnapshotData({
      roster,
      filters: { periodo: { tipoReporte: "RANGO_MESES", from: "2026-06", to: "2026-06" } },
      generatedBy: { userId: "u1", name: "Ana" },
      now: new Date("2026-08-01"),
    });

    expect(snapshot.monthlyEvolution).toHaveLength(1);
    const [monthSnapshot] = snapshot.monthlyEvolution!;
    expect(monthSnapshot.month).toBe("2026-06");
    expect(monthSnapshot.memberSnapshots).toEqual([
      { id: "sub1", name: "Ana", role: "ASISTENTE_GH", completedPct: 0, cargaPct: 0, cargaColor: "green", cargaLabel: "Óptimo", score: 0, totalTasks: 0 },
    ]);
  });

  it("members/rangeTrend/problematicMonths vienen tal cual del bundle de Django", async () => {
    fetchRangeTeamReport.mockResolvedValue({
      ...defaultRangeTeamReportBundle(),
      rangeTrend: { cumplimientoTrend: "mejora", cumplimientoChange: 12, firstMonthAvgCumplimiento: 60, lastMonthAvgCumplimiento: 72 },
      problematicMonths: [{ month: "2026-05", label: "mayo de 2026", teamAvgCumplimiento: 40 }],
    });

    const roster = await resolveReportRoster({ role: "JEFE_NACIONAL" }, {});
    const snapshot = await buildRangeSnapshotData({
      roster,
      filters: { periodo: { tipoReporte: "RANGO_MESES", from: "2026-05", to: "2026-06" } },
      generatedBy: { userId: "u1", name: "Ana" },
      now: new Date("2026-08-01"),
    });

    expect(snapshot.rangeTrend).toEqual({ cumplimientoTrend: "mejora", cumplimientoChange: 12, firstMonthAvgCumplimiento: 60, lastMonthAvgCumplimiento: 72 });
    expect(snapshot.problematicMonths).toEqual([{ month: "2026-05", label: "mayo de 2026", teamAvgCumplimiento: 40 }]);
    expect(snapshot.trends).toBeNull();
    expect(snapshot.meta.type).toBe("RANGO_MESES");
    // Sprint R (Fase 79) solo corre para MENSUAL del mes en curso — nunca para RANGO_MESES.
    expect(snapshot.integrityCheck).toBeNull();
  });

  it("si Django no responde, la generación del reporte falla explícitamente", async () => {
    fetchRangeTeamReport.mockRejectedValue(new Error("No se pudo calcular el reporte vía Django"));

    const roster = await resolveReportRoster({ role: "JEFE_NACIONAL" }, {});
    await expect(
      buildRangeSnapshotData({
        roster,
        filters: { periodo: { tipoReporte: "RANGO_MESES", from: "2026-05", to: "2026-06" } },
        generatedBy: { userId: "u1", name: "Ana" },
        now: new Date("2026-08-01"),
      }),
    ).rejects.toThrow("No se pudo calcular el reporte vía Django");
  });
});

describe("resolveReportRoster — delega en Django, no narrowa localmente", () => {
  beforeEach(resetAll);

  it("reenvía los filtros a fetchDjangoReportRoster y mapea la respuesta a camelCase", async () => {
    fetchDjangoReportRoster.mockResolvedValueOnce({
      users: [{ id: "sub-zs", name: "Zulema", role: "COORDINADOR_ZS" }],
      user_ids: ["sub-zs"],
      scope: "COORDINADOR",
      roster_kind: "POR_AREA",
    });
    const filters = { roles: ["ADMINISTRADOR", "JEFE_NACIONAL", "COORDINADOR_ZS"] as never };

    const roster = await resolveReportRoster({ role: "COORDINADOR_NACIONAL" }, filters);

    expect(fetchDjangoReportRoster).toHaveBeenCalledWith(filters);
    expect(roster).toEqual({
      users: [{ id: "sub-zs", name: "Zulema", role: "COORDINADOR_ZS" }],
      userIds: ["sub-zs"],
      scope: "COORDINADOR",
      rosterKind: "POR_AREA",
    });
  });

  it("colaboradores explícitos se reenvían tal cual, sin narrowing local", async () => {
    await resolveReportRoster({ role: "JEFE_NACIONAL" }, { colaboradores: ["sub1", "sub2"] });
    expect(fetchDjangoReportRoster).toHaveBeenCalledWith({ colaboradores: ["sub1", "sub2"] });
  });

  it("lanza si Django no responde — nunca degrada a un roster vacío silencioso", async () => {
    fetchDjangoReportRoster.mockResolvedValueOnce(null);
    await expect(resolveReportRoster({ role: "JEFE_NACIONAL" }, {})).rejects.toThrow();
  });
});
