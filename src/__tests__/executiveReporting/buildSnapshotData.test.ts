import { describe, expect, it, vi, beforeEach } from "vitest";

const userFindMany = vi.fn();
const userFindUnique = vi.fn();
const taskFindMany = vi.fn();
const taskFindFirst = vi.fn();
const taskActivityFindMany = vi.fn();
const taskActivityFindFirst = vi.fn();
const activityReasonFindMany = vi.fn();
const specialStatusFindMany = vi.fn();
const holidayFindMany = vi.fn();
const systemConfigHistoryCount = vi.fn();
const monthClosureFindUnique = vi.fn();
const monthlyReportFindUnique = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findMany: userFindMany, findUnique: userFindUnique },
    task: { findMany: taskFindMany, findFirst: taskFindFirst },
    taskActivity: { findMany: taskActivityFindMany, findFirst: taskActivityFindFirst },
    activityReason: { findMany: activityReasonFindMany },
    specialStatus: { findMany: specialStatusFindMany },
    holiday: { findMany: holidayFindMany },
    systemConfigHistory: { count: systemConfigHistoryCount },
    monthClosure: { findUnique: monthClosureFindUnique },
    monthlyReport: { findUnique: monthlyReportFindUnique },
  },
}));

const monthlyBusinessBase = vi.fn();
vi.mock("@/lib/workload", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/workload")>();
  return {
    ...actual,
    monthlyBusinessBase: (...a: unknown[]) => monthlyBusinessBase(...a),
    // Sin usuarios con estado especial en estos tests — perUser vacío hace que los
    // llamadores usen siempre la base compartida (mock de monthlyBusinessBase),
    // evitando que computeTeamMonthlySnapshots dispare la ruta real de systemConfig.
    monthlyBusinessBaseForUsers: async (_userIds: string[], year: number, month: number) => ({
      shared: await monthlyBusinessBase(year, month),
      perUser: new Map(),
    }),
  };
});

const { buildMonthlySnapshotData } = await import("@/lib/executiveReporting/buildSnapshotData");
const { resolveReportRoster } = await import("@/lib/executiveReporting/resolveRoster");

function resetAll() {
  userFindMany.mockReset().mockResolvedValue([{ id: "sub1", name: "Ana", role: "ASISTENTE_GH" }]);
  userFindUnique.mockReset().mockResolvedValue({ kpiStartDate: null, createdAt: new Date("2000-01-01") });
  taskFindMany.mockReset().mockResolvedValue([]);
  taskFindFirst.mockReset().mockResolvedValue(null);
  taskActivityFindMany.mockReset().mockResolvedValue([]);
  taskActivityFindFirst.mockReset().mockResolvedValue(null);
  activityReasonFindMany.mockReset().mockResolvedValue([]);
  specialStatusFindMany.mockReset().mockResolvedValue([]);
  holidayFindMany.mockReset().mockResolvedValue([]);
  systemConfigHistoryCount.mockReset().mockResolvedValue(1);
  monthClosureFindUnique.mockReset().mockResolvedValue(null);
  monthlyReportFindUnique.mockReset().mockResolvedValue(null);
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
}

describe("buildMonthlySnapshotData — fecha de corte", () => {
  beforeEach(resetAll);

  it("una tarea completada DESPUÉS de la fecha de corte se trata como no completada", async () => {
    taskFindMany.mockResolvedValue([
      {
        assignedToId: "sub1",
        createdById: "sub1",
        status: "COMPLETADA",
        startDate: new Date("2026-06-01"),
        endDate: new Date("2026-06-20"),
        completedAt: new Date("2026-06-25"), // posterior al corte
        progress: 100,
        type: "FIJA",
        frequency: "PUNTUAL",
        estimatedHours: 4,
        realHours: 3,
        activities: [],
      },
    ]);

    const roster = await resolveReportRoster({ role: "JEFE_NACIONAL" }, {});
    const snapshot = await buildMonthlySnapshotData({
      roster,
      filters: { periodo: { tipoReporte: "MENSUAL", month: 6, year: 2026 }, fechaCorte: new Date("2026-06-20T00:00:00.000Z") },
      generatedBy: { userId: "u1", name: "Ana" },
      now: new Date("2026-08-01"),
    });

    expect(snapshot.members[0].completedPct).toBe(0);
    expect(snapshot.members[0].completedTasks).toBe(0);
  });

  it("sin fecha de corte, la misma tarea completada SÍ cuenta (comportamiento histórico intacto)", async () => {
    taskFindMany.mockResolvedValue([
      {
        assignedToId: "sub1",
        createdById: "sub1",
        status: "COMPLETADA",
        startDate: new Date("2026-06-01"),
        endDate: new Date("2026-06-20"),
        completedAt: new Date("2026-06-25"),
        progress: 100,
        type: "FIJA",
        frequency: "PUNTUAL",
        estimatedHours: 4,
        realHours: 3,
        activities: [],
      },
    ]);

    const roster = await resolveReportRoster({ role: "JEFE_NACIONAL" }, {});
    const snapshot = await buildMonthlySnapshotData({
      roster,
      filters: { periodo: { tipoReporte: "MENSUAL", month: 6, year: 2026 } },
      generatedBy: { userId: "u1", name: "Ana" },
      now: new Date("2026-08-01"),
    });

    expect(snapshot.members[0].completedPct).toBe(100);
    expect(snapshot.members[0].completedTasks).toBe(1);
  });

  it("una tarea completada ANTES de la fecha de corte cuenta igual (el corte no penaliza lo que ya ocurrió)", async () => {
    taskFindMany.mockResolvedValue([
      {
        assignedToId: "sub1",
        createdById: "sub1",
        status: "COMPLETADA",
        startDate: new Date("2026-06-01"),
        endDate: new Date("2026-06-05"),
        completedAt: new Date("2026-06-04"),
        progress: 100,
        type: "FIJA",
        frequency: "PUNTUAL",
        estimatedHours: 4,
        realHours: 3,
        activities: [],
      },
    ]);

    const roster = await resolveReportRoster({ role: "JEFE_NACIONAL" }, {});
    const snapshot = await buildMonthlySnapshotData({
      roster,
      filters: { periodo: { tipoReporte: "MENSUAL", month: 6, year: 2026 }, fechaCorte: new Date("2026-06-20T00:00:00.000Z") },
      generatedBy: { userId: "u1", name: "Ana" },
      now: new Date("2026-08-01"),
    });

    expect(snapshot.members[0].completedPct).toBe(100);
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
    monthClosureFindUnique.mockResolvedValue({
      id: "closure-1",
      month: 6,
      year: 2026,
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
    monthClosureFindUnique.mockResolvedValue({
      id: "closure-1",
      month: 6,
      year: 2026,
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
    monthClosureFindUnique.mockResolvedValue({
      id: "closure-1",
      month: 6,
      year: 2026,
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
    monthClosureFindUnique.mockResolvedValue(null);

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

describe("resolveReportRoster — filtros roles/areas/colaboradores", () => {
  beforeEach(resetAll);

  it("nunca amplía el roster más allá de lo que la jerarquía del generador ya permite ver", async () => {
    await resolveReportRoster({ role: "COORDINADOR_NACIONAL" }, { roles: ["ADMINISTRADOR", "JEFE_NACIONAL", "COORDINADOR_ZS"] as never });
    const call = userFindMany.mock.calls[0][0];
    const rolesQueried: string[] = call.where.role.in;
    // Aunque se pidió ADMINISTRADOR/JEFE_NACIONAL explícitamente, el filtro solo
    // puede NARROWAR — nunca deben aparecer roles de liderazgo en la consulta final.
    expect(rolesQueried).not.toContain("ADMINISTRADOR");
    expect(rolesQueried).not.toContain("JEFE_NACIONAL");
    expect(rolesQueried).toEqual(["COORDINADOR_ZS"]);
  });

  it("colaboradores explícitos intersectan por id además del filtro de rol", async () => {
    await resolveReportRoster({ role: "JEFE_NACIONAL" }, { colaboradores: ["sub1", "sub2"] });
    const call = userFindMany.mock.calls[0][0];
    expect(call.where.id).toEqual({ in: ["sub1", "sub2"] });
  });
});
