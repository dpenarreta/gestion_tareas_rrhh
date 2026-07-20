import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { SessionPayload } from "@/lib/session";

const userFindMany = vi.fn();
const taskFindMany = vi.fn();
const taskActivityFindMany = vi.fn();
const improvementIdeaFindMany = vi.fn();
const systemConfigHistoryFindFirst = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findMany: userFindMany },
    task: { findMany: taskFindMany },
    taskActivity: { findMany: taskActivityFindMany },
    improvementIdea: { findMany: improvementIdeaFindMany },
    // getEffectiveAnalyticsConfig (usada por el bloque CEO, §Sprint 5 S5-K) —
    // sin registro → usa los defaults del motor, comportamiento determinista.
    systemConfigHistory: { findFirst: systemConfigHistoryFindFirst },
  },
}));

vi.mock("@/lib/session", () => ({ getSession: vi.fn() }));

const monthlyBusinessBase = vi.fn();
vi.mock("@/lib/workload", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/workload")>();
  return {
    ...actual,
    monthlyBusinessBaseForUsers: async (_userIds: string[], year: number, month: number) => ({
      shared: await monthlyBusinessBase(year, month),
      perUser: new Map(),
    }),
  };
});

// El bloque CEO (§Sprint 5 S5-K) calcula Performance Score/Operational Risk
// promedio del equipo — se mockean directamente (no sus dependencias de BD,
// ya cubiertas por tests dedicados de analytics.ts) para mantener este test
// enfocado en la agregación del propio endpoint.
vi.mock("@/lib/analytics", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/analytics")>();
  return {
    ...actual,
    computePerformanceScore: vi.fn().mockResolvedValue({ score: 70, classification: "Bueno", factors: [] }),
    computeOperationalRisk: vi.fn().mockResolvedValue({ score: 30, classification: "Bajo", factors: [] }),
  };
});

const { getSession } = await import("@/lib/session");
const { GET: executiveGET } = await import("@/app/api/kpis/executive/route");

function mockSession(overrides: Partial<SessionPayload> | null) {
  vi.mocked(getSession).mockResolvedValue(
    overrides === null
      ? null
      : {
          userId: "jefe-1",
          role: "JEFE_NACIONAL",
          name: "Jefe",
          email: "jefe@nexo.com",
          expiresAt: new Date(Date.now() + 100000).toISOString(),
          ...overrides,
        },
  );
}

function resetAll() {
  userFindMany.mockReset();
  taskFindMany.mockReset().mockResolvedValue([]);
  taskActivityFindMany.mockReset().mockResolvedValue([]);
  improvementIdeaFindMany.mockReset().mockResolvedValue([]);
  systemConfigHistoryFindFirst.mockReset().mockResolvedValue(null);
  vi.mocked(getSession).mockReset();
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
    limitBaseHours: 100,
    limitHighHours: 120,
    limitOverloadHours: 140,
  }));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 7, 1)); // 1 de agosto de 2026
  resetAll();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("GET /api/kpis/executive", () => {
  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await executiveGET();
    expect(res.status).toBe(401);
  });

  it("responde 403 si el rol no es JEFE_NACIONAL", async () => {
    mockSession({ role: "COORDINADOR_NACIONAL" });
    const res = await executiveGET();
    expect(res.status).toBe(403);
  });

  it("sin subordinados, devuelve una respuesta vacía sin consultar tareas", async () => {
    mockSession({});
    userFindMany.mockResolvedValue([]);
    const res = await executiveGET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ranking).toEqual([]);
    expect(body.overview.avgCumplimiento).toBe(0);
    expect(taskFindMany).not.toHaveBeenCalled();
  });

  it("calcula overview/ranking/alertas a partir de las tareas del mes en curso", async () => {
    mockSession({});
    userFindMany.mockResolvedValue([
      { id: "sub1", name: "Ana", role: "ASISTENTE_GH" },
      { id: "sub2", name: "Beto", role: "COORDINADOR_ZS" },
    ]);
    // endDate dentro de agosto 2026 (mes en curso, "ahora" = 2026-08-01).
    taskFindMany.mockResolvedValue([
      { assignedToId: "sub1", status: "COMPLETADA", endDate: new Date("2026-08-05"), progress: 100 },
      { assignedToId: "sub1", status: "COMPLETADA", endDate: new Date("2026-08-10"), progress: 100 },
      // sub2: 1 de 4 completada → 25% (< 60% → alerta de cumplimiento)
      { assignedToId: "sub2", status: "COMPLETADA", endDate: new Date("2026-08-05"), progress: 100 },
      { assignedToId: "sub2", status: "PENDIENTE", endDate: new Date("2026-08-06"), progress: 0 },
      { assignedToId: "sub2", status: "PENDIENTE", endDate: new Date("2026-08-07"), progress: 0 },
      { assignedToId: "sub2", status: "PENDIENTE", endDate: new Date("2026-08-08"), progress: 0 },
    ]);
    improvementIdeaFindMany.mockResolvedValue([
      { id: "idea1", title: "Idea pendiente", status: "PROPUESTA", author: { name: "Carla" } },
    ]);

    const res = await executiveGET();
    expect(res.status).toBe(200);
    const body = await res.json();

    // sub1: 100% cumplimiento, sub2: 25% → promedio 62 o 63 (redondeo)
    expect(body.overview.avgCumplimiento).toBe(Math.round((100 + 25) / 2));
    expect(body.ranking).toHaveLength(2);
    // sub1 debe ir primero (mayor score que sub2, que tiene bajo cumplimiento)
    expect(body.ranking[0].id).toBe("sub1");

    expect(body.alerts.lowCumplimiento).toHaveLength(1);
    expect(body.alerts.lowCumplimiento[0]).toMatchObject({ userId: "sub2", value: 25 });

    expect(body.alerts.pendingIdeas).toHaveLength(1);
    expect(body.alerts.pendingIdeas[0]).toMatchObject({ title: "Idea pendiente", authorName: "Carla" });

    expect(body.workload).toHaveLength(2);
    expect(body.trend).toHaveLength(6);
    expect(body.trend[5].month).toBe("2026-08");
  });

  it("nunca incluye ADMINISTRADOR ni al propio JEFE_NACIONAL en el ranking (vía getSubordinateRoles)", async () => {
    mockSession({});
    userFindMany.mockResolvedValue([{ id: "sub1", name: "Ana", role: "ASISTENTE_GH" }]);
    await executiveGET();
    // getSubordinateRoles(JEFE_NACIONAL) no incluye ADMINISTRADOR ni JEFE_NACIONAL —
    // se verifica que el filtro de roles pasado a user.findMany los excluya.
    const callArgs = userFindMany.mock.calls[0][0];
    expect(callArgs.where.role.in).not.toContain("ADMINISTRADOR");
    expect(callArgs.where.role.in).not.toContain("JEFE_NACIONAL");
  });
});
