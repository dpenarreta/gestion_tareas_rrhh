import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SessionPayload } from "@/lib/session";
import type { NextRequest } from "next/server";

const userFindMany = vi.fn();
const monthClosureFindMany = vi.fn();
const monthClosureFindUnique = vi.fn();
const taskFindMany = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findMany: userFindMany },
    monthClosure: { findMany: monthClosureFindMany, findUnique: monthClosureFindUnique },
    task: { findMany: taskFindMany },
  },
}));

vi.mock("@/lib/session", () => ({ getSession: vi.fn() }));

const { getSession } = await import("@/lib/session");
const { GET: repositoryGET } = await import("@/app/api/repository/route");
const { GET: repositoryMonthGET } = await import("@/app/api/repository/[year]/[month]/route");

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

function ctx(year = "2026", month = "6") {
  return { params: Promise.resolve({ year, month }) };
}

function req() {
  return {} as unknown as NextRequest;
}

function resetAll() {
  userFindMany.mockReset();
  monthClosureFindMany.mockReset();
  monthClosureFindUnique.mockReset();
  taskFindMany.mockReset();
  vi.mocked(getSession).mockReset();
}

describe("GET /api/repository", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await repositoryGET();
    expect(res.status).toBe(401);
  });

  it("agrega tareas archivadas por mes, solo de usuarios visibles, y omite meses sin datos agregados", async () => {
    mockSession({ role: "JEFE_NACIONAL" });
    userFindMany.mockResolvedValue([{ id: "sub1" }]);
    monthClosureFindMany.mockResolvedValue([
      { year: 2026, month: 6 },
      { year: 2026, month: 5 }, // sin tareas archivadas -> se omite
    ]);
    taskFindMany.mockResolvedValue([
      { archivedMonth: "2026-06", status: "COMPLETADA", realHours: 4 },
      { archivedMonth: "2026-06", status: "PENDIENTE", realHours: 2 },
    ]);

    const res = await repositoryGET();
    const body = await res.json();
    expect(body).toEqual([{ year: 2026, month: 6, totalTasks: 2, completedTasks: 1, totalHours: 6 }]);
  });
});

describe("GET /api/repository/[year]/[month]", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await repositoryMonthGET(req(), ctx());
    expect(res.status).toBe(401);
  });

  it("responde 400 ante año/mes inválidos", async () => {
    mockSession({});
    const res = await repositoryMonthGET(req(), ctx("abc", "6"));
    expect(res.status).toBe(400);
  });

  it("responde 404 si ese mes no fue cerrado", async () => {
    mockSession({});
    monthClosureFindUnique.mockResolvedValue(null);
    const res = await repositoryMonthGET(req(), ctx());
    expect(res.status).toBe(404);
  });

  it("devuelve las tareas archivadas del mes, filtradas a usuarios visibles", async () => {
    mockSession({ role: "JEFE_NACIONAL" });
    monthClosureFindUnique.mockResolvedValue({ id: "closure-1" });
    userFindMany.mockResolvedValue([{ id: "sub1" }]);
    taskFindMany.mockResolvedValue([{ id: "t1" }]);

    const res = await repositoryMonthGET(req(), ctx("2026", "6"));
    expect(res.status).toBe(200);
    expect(taskFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { archivedMonth: "2026-06", assignedToId: { in: ["sub1"] } } })
    );
  });
});
