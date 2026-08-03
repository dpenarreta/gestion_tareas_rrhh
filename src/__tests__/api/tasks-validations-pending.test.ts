import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SessionPayload } from "@/lib/session";
import type { NextRequest } from "next/server";

const taskFindMany = vi.fn();
const taskCount = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    task: { findMany: taskFindMany, count: taskCount },
  },
}));

vi.mock("@/lib/session", () => ({ getSession: vi.fn() }));

const { getSession } = await import("@/lib/session");
const { GET } = await import("@/app/api/tasks/validations/pending/route");

function mockSession(overrides: Partial<SessionPayload> | null) {
  vi.mocked(getSession).mockResolvedValue(
    overrides === null
      ? null
      : {
          userId: "u1",
          role: "ADMINISTRADOR",
          name: "Admin",
          email: "test@nexo.com",
          expiresAt: new Date(Date.now() + 100000).toISOString(),
          ...overrides,
        }
  );
}

function getRequest(url: string): NextRequest {
  return { nextUrl: new URL(url), url } as unknown as NextRequest;
}

function resetAll() {
  taskFindMany.mockReset().mockResolvedValue([]);
  taskCount.mockReset().mockResolvedValue(0);
  vi.mocked(getSession).mockReset();
}

describe("GET /api/tasks/validations/pending", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await GET(getRequest("http://localhost/api/tasks/validations/pending"));
    expect(res.status).toBe(401);
  });

  it("responde 403 para un rol fuera de CAN_REGULARIZE", async () => {
    mockSession({ role: "COORDINADOR_NACIONAL" });
    const res = await GET(getRequest("http://localhost/api/tasks/validations/pending"));
    expect(res.status).toBe(403);
  });

  it("consulta la unión de ambas validaciones (Tiempo Objetivo O Fecha Fin pendiente)", async () => {
    mockSession({ role: "ADMINISTRADOR" });
    taskFindMany.mockResolvedValue([{ id: "t1", title: "Tarea 1" }]);

    const res = await GET(getRequest("http://localhost/api/tasks/validations/pending"));
    expect(res.status).toBe(200);

    expect(taskFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([
            { OR: [{ targetTimeValidated: null }, { endDateApprovalStatus: "PENDIENTE" }] },
          ]),
        }),
      })
    );
  });

  it("devuelve tasks + dataQuality de ambas dimensiones por separado", async () => {
    mockSession({ role: "ADMINISTRADOR" });
    taskFindMany.mockResolvedValue([{ id: "t1" }]);
    // 2 llamadas a count por cada getXDataQuality (validated/total) x 2 dimensiones = 4 llamadas.
    taskCount
      .mockResolvedValueOnce(3) // targetTime validated
      .mockResolvedValueOnce(10) // targetTime total
      .mockResolvedValueOnce(4) // endDate pending
      .mockResolvedValueOnce(10); // endDate total

    const res = await GET(getRequest("http://localhost/api/tasks/validations/pending"));
    const body = await res.json();
    expect(body.tasks).toHaveLength(1);
    expect(body.targetTimeDataQuality).toMatchObject({ validatedCount: 3, totalCount: 10 });
    expect(body.endDateDataQuality).toMatchObject({ pendingCount: 4, totalCount: 10 });
  });

  it("filtra por colaborador/cargo/tipo cuando vienen en la query", async () => {
    mockSession({ role: "ADMINISTRADOR" });
    await GET(getRequest("http://localhost/api/tasks/validations/pending?userId=u2&role=ASISTENTE_GH&type=FIJA"));
    expect(taskFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          assignedToId: "u2",
          type: "FIJA",
          assignedTo: { role: "ASISTENTE_GH" },
        }),
      })
    );
  });
});
