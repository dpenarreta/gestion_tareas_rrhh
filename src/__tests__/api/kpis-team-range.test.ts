import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { SessionPayload } from "@/lib/session";
import type { NextRequest } from "next/server";

const userFindMany = vi.fn();
const taskFindMany = vi.fn();
const taskActivityFindMany = vi.fn();
const commentGroupBy = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findMany: userFindMany },
    task: { findMany: taskFindMany },
    taskActivity: { findMany: taskActivityFindMany },
    comment: { groupBy: commentGroupBy },
  },
}));

vi.mock("@/lib/session", () => ({ getSession: vi.fn() }));

const monthlyBusinessBase = vi.fn();
vi.mock("@/lib/workload", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/workload")>();
  return { ...actual, monthlyBusinessBase: (...args: unknown[]) => monthlyBusinessBase(...args) };
});

const { getSession } = await import("@/lib/session");
const { GET: teamGET } = await import("@/app/api/kpis/team/route");
const { GET: rangeGET } = await import("@/app/api/kpis/me/range/route");

function mockSession(overrides: Partial<SessionPayload> | null) {
  vi.mocked(getSession).mockResolvedValue(
    overrides === null
      ? null
      : {
          userId: "u1",
          role: "JEFE_NACIONAL",
          name: "Ana",
          email: "test@nexo.com",
          expiresAt: new Date(Date.now() + 100000).toISOString(),
          ...overrides,
        }
  );
}

function getRequest(url: string): NextRequest {
  return { nextUrl: new URL(url) } as unknown as NextRequest;
}

function resetAll() {
  userFindMany.mockReset();
  taskFindMany.mockReset().mockResolvedValue([]);
  taskActivityFindMany.mockReset().mockResolvedValue([]);
  commentGroupBy.mockReset().mockResolvedValue([]);
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
  vi.mocked(getSession).mockReset();
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 7, 1));
});
afterEach(() => {
  vi.useRealTimers();
});

describe("GET /api/kpis/team", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await teamGET(getRequest("http://localhost/api/kpis/team"));
    expect(res.status).toBe(401);
  });

  it("responde 403 para un rol de nivel 1 (no puede ver equipo)", async () => {
    mockSession({ role: "ASISTENTE_GH" });
    const res = await teamGET(getRequest("http://localhost/api/kpis/team"));
    expect(res.status).toBe(403);
  });

  it("devuelve users=[] sin consultar tareas si no hay subordinados", async () => {
    mockSession({ role: "JEFE_NACIONAL" });
    userFindMany.mockResolvedValue([]);
    const res = await teamGET(getRequest("http://localhost/api/kpis/team"));
    const body = await res.json();
    expect(body).toEqual({ users: [] });
    expect(taskFindMany).not.toHaveBeenCalled();
  });

  it("calcula completedPct/cargaRatio/score por subordinado a partir de sus tareas y comentarios", async () => {
    mockSession({ role: "JEFE_NACIONAL" });
    userFindMany.mockResolvedValue([
      { id: "sub1", name: "Ana", role: "ASISTENTE_GH" },
      { id: "sub2", name: "Beto", role: "ASISTENTE_SELECCION" },
    ]);
    taskFindMany.mockResolvedValue([
      { assignedToId: "sub1", status: "COMPLETADA", estimatedHours: 4, realHours: 4, endDate: new Date("2026-06-10"), progress: 100 },
      { assignedToId: "sub1", status: "PENDIENTE", estimatedHours: 2, realHours: 0, endDate: new Date("2026-06-05"), progress: 0 },
      { assignedToId: "sub2", status: "EN_PROGRESO", estimatedHours: 3, realHours: 2, endDate: new Date("2026-06-25"), progress: 60 },
    ]);
    commentGroupBy.mockResolvedValue([{ authorId: "sub1", _count: { id: 3 } }]);

    const res = await teamGET(getRequest("http://localhost/api/kpis/team?month=2026-06"));
    expect(res.status).toBe(200);
    const body = await res.json();

    const sub1 = body.users.find((u: { id: string }) => u.id === "sub1");
    const sub2 = body.users.find((u: { id: string }) => u.id === "sub2");

    expect(sub1).toMatchObject({ name: "Ana", completedPct: 50, cargaRatio: Math.round((4 / 6) * 100), totalTasks: 2 });
    expect(sub1.score).toBe(46); // 20(cumpl) + 20(carga, sin sobrecarga) + 0(calidad) + 6(actividad: 3 comentarios)

    expect(sub2).toMatchObject({ name: "Beto", completedPct: 0, cargaRatio: Math.round((2 / 3) * 100), totalTasks: 1 });
    expect(sub2.score).toBe(32); // 0(cumpl) + 20(carga) + 12(calidad: progreso 60%) + 0(actividad: sin comentarios)
  });
});

describe("GET /api/kpis/me/range", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await rangeGET(getRequest("http://localhost/api/kpis/me/range?from=2026-01&to=2026-02"));
    expect(res.status).toBe(401);
  });

  it("responde 400 si faltan los parámetros from/to", async () => {
    mockSession({});
    const res = await rangeGET(getRequest("http://localhost/api/kpis/me/range"));
    expect(res.status).toBe(400);
  });

  it("responde 400 si from no es anterior a to", async () => {
    mockSession({});
    const res = await rangeGET(getRequest("http://localhost/api/kpis/me/range?from=2026-06&to=2026-06"));
    expect(res.status).toBe(400);
  });

  it("responde 400 si el rango resultante tiene menos de 2 meses (meses sin cero a la izquierda invierten el orden numérico)", async () => {
    mockSession({});
    // "2026-12" < "2026-2" lexicográficamente, pasa la validación from<to como
    // string, pero numéricamente diciembre es posterior a febrero → 0 meses generados.
    const res = await rangeGET(getRequest("http://localhost/api/kpis/me/range?from=2026-12&to=2026-2"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/al menos 2 meses/);
  });

  it("responde 400 si el rango supera 24 meses", async () => {
    mockSession({});
    const res = await rangeGET(getRequest("http://localhost/api/kpis/me/range?from=2024-01&to=2026-06"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/no puede superar 24 meses/);
  });

  it("agrega un rango válido de 2 meses con los totales correctos", async () => {
    mockSession({ userId: "u1" });
    taskFindMany.mockResolvedValue([
      { endDate: new Date("2026-01-15"), status: "COMPLETADA", type: "FIJA", estimatedHours: 5, realHours: 5, progress: 100 },
      { endDate: new Date("2026-02-10"), status: "PENDIENTE", type: "FIJA", estimatedHours: 3, realHours: 0, progress: 0 },
    ]);

    const res = await rangeGET(getRequest("http://localhost/api/kpis/me/range?from=2026-01&to=2026-02"));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.report.months).toHaveLength(2);
    expect(body.report.months.map((m: { month: string }) => m.month)).toEqual(["2026-01", "2026-02"]);
    expect(body.report.aggregated.totalTasks).toBe(2);
    expect(body.report.aggregated.totalCompletedTasks).toBe(1);
    expect(["mejora", "deterioro", "estancamiento"]).toContain(body.report.trends.cumplimientoTrend);
  });
});
