import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SessionPayload } from "@/lib/session";

const userFindMany = vi.fn();
const userFindUnique = vi.fn();
const taskFindMany = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findMany: userFindMany, findUnique: userFindUnique },
    task: { findMany: taskFindMany },
  },
}));

vi.mock("@/lib/session", () => ({ getSession: vi.fn() }));

const { getSession } = await import("@/lib/session");
const { GET: teamGET } = await import("@/app/api/team/route");
const { GET: teamTasksGET } = await import("@/app/api/team/[userId]/tasks/route");

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

function ctx(userId = "sub-1") {
  return { params: Promise.resolve({ userId }) };
}

function jsonRequest() {
  return {} as never;
}

function resetAll() {
  userFindMany.mockReset();
  userFindUnique.mockReset();
  taskFindMany.mockReset();
  vi.mocked(getSession).mockReset();
}

describe("GET /api/team", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await teamGET();
    expect(res.status).toBe(401);
  });

  it("responde 403 para un rol de nivel 1", async () => {
    mockSession({ role: "ASISTENTE_GH" });
    const res = await teamGET();
    expect(res.status).toBe(403);
  });

  it("enmascara el email y agrega el conteo de tareas por estado, de cada subordinado", async () => {
    mockSession({ role: "JEFE_NACIONAL" });
    userFindMany.mockResolvedValue([
      {
        id: "sub-1",
        name: "Ana",
        email: "ana@nexo.com",
        role: "ASISTENTE_GH",
        assignedTasks: [{ status: "COMPLETADA" }, { status: "EN_PROGRESO" }, { status: "PENDIENTE" }, { status: "PENDIENTE" }],
      },
    ]);
    const res = await teamGET();
    const body = await res.json();
    expect(body[0]).toMatchObject({
      email: "a**@n***.com",
      tasks: { total: 4, completed: 1, inProgress: 1, pending: 2 },
    });
  });
});

describe("GET /api/team/[userId]/tasks", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await teamTasksGET(jsonRequest(), ctx());
    expect(res.status).toBe(401);
  });

  it("responde 403 para un rol de nivel 1", async () => {
    mockSession({ role: "ASISTENTE_GH" });
    const res = await teamTasksGET(jsonRequest(), ctx());
    expect(res.status).toBe(403);
  });

  it("responde 404 si el usuario objetivo no existe", async () => {
    mockSession({ role: "JEFE_NACIONAL" });
    userFindUnique.mockResolvedValue(null);
    const res = await teamTasksGET(jsonRequest(), ctx());
    expect(res.status).toBe(404);
  });

  it("responde 403 si el objetivo no es un subordinado (fuera de la jerarquía)", async () => {
    mockSession({ role: "COORDINADOR_ZS" });
    userFindUnique.mockResolvedValue({ role: "ANALISTA_CC" });
    const res = await teamTasksGET(jsonRequest(), ctx());
    expect(res.status).toBe(403);
  });

  it("devuelve las tareas no archivadas del subordinado", async () => {
    mockSession({ role: "JEFE_NACIONAL" });
    userFindUnique.mockResolvedValue({ role: "ASISTENTE_GH" });
    taskFindMany.mockResolvedValue([{ id: "t1" }]);
    const res = await teamTasksGET(jsonRequest(), ctx("sub-1"));
    expect(taskFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { assignedToId: "sub-1", archivedMonth: null } })
    );
    expect(res.status).toBe(200);
  });
});
