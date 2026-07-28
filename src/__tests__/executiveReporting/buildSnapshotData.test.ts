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
