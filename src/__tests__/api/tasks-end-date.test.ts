import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SessionPayload } from "@/lib/session";
import type { NextRequest } from "next/server";

const taskFindUnique = vi.fn();
const taskUpdate = vi.fn();
const endDateAuditLogFindMany = vi.fn();
const endDateAuditLogCreate = vi.fn();
const notificationCreate = vi.fn();
const $transaction = vi.fn(async (fn: (tx: unknown) => unknown) =>
  fn({
    task: { findUnique: taskFindUnique, update: taskUpdate },
    endDateAuditLog: { create: endDateAuditLogCreate },
    notification: { create: notificationCreate },
  })
);

vi.mock("@/lib/prisma", () => ({
  prisma: {
    task: { findUnique: taskFindUnique, update: taskUpdate },
    endDateAuditLog: { findMany: endDateAuditLogFindMany, create: endDateAuditLogCreate },
    notification: { create: notificationCreate },
    $transaction,
  },
}));

vi.mock("@/lib/session", () => ({ getSession: vi.fn() }));

const { getSession } = await import("@/lib/session");
const { GET, POST } = await import("@/app/api/tasks/[id]/end-date/route");

function mockSession(overrides: Partial<SessionPayload> | null) {
  vi.mocked(getSession).mockResolvedValue(
    overrides === null
      ? null
      : {
          userId: "u1",
          role: "ASISTENTE_GH",
          name: "Test",
          email: "test@nexo.com",
          expiresAt: new Date(Date.now() + 100000).toISOString(),
          ...overrides,
        }
  );
}

function ctx(id = "task-1") {
  return { params: Promise.resolve({ id }) };
}

function postRequest(body: unknown): NextRequest {
  return { json: async () => body, headers: new Headers() } as unknown as NextRequest;
}

function resetAll() {
  taskFindUnique.mockReset();
  taskUpdate.mockReset();
  endDateAuditLogFindMany.mockReset().mockResolvedValue([]);
  endDateAuditLogCreate.mockReset().mockResolvedValue({});
  notificationCreate.mockReset().mockResolvedValue({});
  $transaction.mockClear();
  vi.mocked(getSession).mockReset();
}

const ASSIGNEE = "colaborador-1";
const LEADER = "jefe-1";

function taskForGet(overrides: Partial<{ endDateApprovalStatus: string }> = {}) {
  return {
    id: "task-1",
    title: "Revisión de Nómina",
    endDate: new Date(Date.UTC(2026, 7, 15)),
    endDateApprovalStatus: "PENDIENTE",
    endDateApprovedAt: null,
    endDateApprover: null,
    assignedToId: ASSIGNEE,
    createdById: ASSIGNEE,
    assignedTo: { role: "ASISTENTE_GH" },
    ...overrides,
  };
}

function taskForPost() {
  return { id: "task-1", assignedToId: ASSIGNEE, assignedTo: { role: "ASISTENTE_GH" } };
}

describe("GET /api/tasks/[id]/end-date", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await GET({} as NextRequest, ctx());
    expect(res.status).toBe(401);
  });

  it("responde 404 si la tarea no existe", async () => {
    mockSession({ userId: ASSIGNEE });
    taskFindUnique.mockResolvedValue(null);
    const res = await GET({} as NextRequest, ctx());
    expect(res.status).toBe(404);
  });

  it("responde 403 si no es responsable, creador, ni jerarquía visible", async () => {
    // TRABAJO_SOCIAL solo ve TRABAJO_SOCIAL (VISIBLE_ROLES) — la tarea es de un ASISTENTE_GH, un rol distinto sin relación jerárquica.
    mockSession({ role: "TRABAJO_SOCIAL", userId: "otro-user" });
    taskFindUnique.mockResolvedValue(taskForGet());
    const res = await GET({} as NextRequest, ctx());
    expect(res.status).toBe(403);
  });

  it("el responsable puede ver el estado pero canValidate es false", async () => {
    mockSession({ role: "ASISTENTE_GH", userId: ASSIGNEE });
    taskFindUnique.mockResolvedValue(taskForGet());
    const res = await GET({} as NextRequest, ctx());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.canValidate).toBe(false);
    expect(body.endDateApprovalStatus).toBe("PENDIENTE");
  });

  it("un líder autorizado ve canValidate=true", async () => {
    mockSession({ role: "JEFE_NACIONAL", userId: LEADER });
    taskFindUnique.mockResolvedValue(taskForGet());
    const res = await GET({} as NextRequest, ctx());
    const body = await res.json();
    expect(body.canValidate).toBe(true);
  });
});

describe("POST /api/tasks/[id]/end-date", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await POST(postRequest({}), ctx());
    expect(res.status).toBe(401);
  });

  it("responde 403 si el responsable intenta validar su propia fecha fin", async () => {
    mockSession({ role: "JEFE_NACIONAL", userId: ASSIGNEE });
    taskFindUnique.mockResolvedValue(taskForPost());
    const res = await POST(postRequest({ action: "APROBAR" }), ctx());
    expect(res.status).toBe(403);
  });

  it("responde 403 para un rol sin permiso de validación (fuera de la whitelist)", async () => {
    mockSession({ role: "COORDINADOR_ZS", userId: "coord-1" });
    taskFindUnique.mockResolvedValue(taskForPost());
    const res = await POST(postRequest({ action: "APROBAR" }), ctx());
    expect(res.status).toBe(403);
  });

  it("responde 400 con una acción inválida", async () => {
    mockSession({ role: "JEFE_NACIONAL", userId: LEADER });
    taskFindUnique.mockResolvedValue(taskForPost());
    const res = await POST(postRequest({ action: "INVALIDA" }), ctx());
    expect(res.status).toBe(400);
  });

  it("responde 400 si MODIFICAR no trae una nueva fecha válida", async () => {
    mockSession({ role: "JEFE_NACIONAL", userId: LEADER });
    taskFindUnique.mockResolvedValue(taskForPost());
    const res = await POST(postRequest({ action: "MODIFICAR" }), ctx());
    expect(res.status).toBe(400);
  });

  it("APROBAR: no cambia endDate, marca APROBADA, audita, y NO notifica al colaborador", async () => {
    mockSession({ role: "JEFE_NACIONAL", userId: LEADER });
    taskFindUnique.mockResolvedValue(taskForPost());
    // Dentro de applyEndDateAction, el findUnique interno (vía tx) reutiliza el mismo mock.
    taskFindUnique.mockResolvedValueOnce(taskForPost()).mockResolvedValueOnce({
      endDate: new Date(Date.UTC(2026, 7, 15)),
      title: "Revisión de Nómina",
      assignedToId: ASSIGNEE,
    });
    taskUpdate.mockResolvedValue({ endDate: new Date(Date.UTC(2026, 7, 15)), endDateApprovalStatus: "APROBADA", endDateApprovedAt: new Date() });

    const res = await POST(postRequest({ action: "APROBAR" }), ctx());
    expect(res.status).toBe(200);

    expect(taskUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ endDate: new Date(Date.UTC(2026, 7, 15)), endDateApprovalStatus: "APROBADA" }),
      })
    );
    expect(endDateAuditLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: "APROBADA" }) })
    );
    expect(notificationCreate).not.toHaveBeenCalled();
  });

  it("MODIFICAR: cambia endDate al nuevo valor, marca MODIFICADA, audita, y notifica al colaborador", async () => {
    mockSession({ role: "JEFE_NACIONAL", userId: LEADER, name: "Jefe" });
    taskFindUnique.mockResolvedValueOnce(taskForPost()).mockResolvedValueOnce({
      endDate: new Date(Date.UTC(2026, 7, 15)),
      title: "Revisión de Nómina",
      assignedToId: ASSIGNEE,
    });
    taskUpdate.mockResolvedValue({ endDate: new Date(Date.UTC(2026, 7, 18)), endDateApprovalStatus: "MODIFICADA", endDateApprovedAt: new Date() });

    const res = await POST(postRequest({ action: "MODIFICAR", newEndDate: "2026-08-18" }), ctx());
    expect(res.status).toBe(200);

    expect(taskUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ endDate: new Date("2026-08-18"), endDateApprovalStatus: "MODIFICADA" }) })
    );
    expect(notificationCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ userId: ASSIGNEE, taskId: "task-1" }),
      })
    );
    const message = notificationCreate.mock.calls[0][0].data.message as string;
    expect(message).toContain("Revisión de Nómina");
    expect(message).toContain("15/08/2026");
    expect(message).toContain("18/08/2026");
  });

  it("RECHAZAR: NO cambia endDate, marca RECHAZADA, audita, y notifica al colaborador", async () => {
    mockSession({ role: "JEFE_NACIONAL", userId: LEADER });
    taskFindUnique.mockResolvedValueOnce(taskForPost()).mockResolvedValueOnce({
      endDate: new Date(Date.UTC(2026, 7, 15)),
      title: "Revisión de Nómina",
      assignedToId: ASSIGNEE,
    });
    taskUpdate.mockResolvedValue({ endDate: new Date(Date.UTC(2026, 7, 15)), endDateApprovalStatus: "RECHAZADA", endDateApprovedAt: new Date() });

    const res = await POST(postRequest({ action: "RECHAZAR" }), ctx());
    expect(res.status).toBe(200);

    expect(taskUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ endDate: new Date(Date.UTC(2026, 7, 15)), endDateApprovalStatus: "RECHAZADA" }) })
    );
    expect(notificationCreate).toHaveBeenCalledTimes(1);
  });
});
