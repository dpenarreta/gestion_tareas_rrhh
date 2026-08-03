import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SessionPayload } from "@/lib/session";
import type { NextRequest } from "next/server";

const taskFindMany = vi.fn();
const taskFindUnique = vi.fn();
const taskUpdate = vi.fn();
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
    task: { findMany: taskFindMany, findUnique: taskFindUnique, update: taskUpdate },
    endDateAuditLog: { create: endDateAuditLogCreate },
    notification: { create: notificationCreate },
    $transaction,
  },
}));

vi.mock("@/lib/session", () => ({ getSession: vi.fn() }));

const { getSession } = await import("@/lib/session");
const { POST: bulkApprovePOST } = await import("@/app/api/tasks/end-date/bulk-approve/route");

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

function postRequest(body: unknown): NextRequest {
  return { json: async () => body, headers: new Headers() } as unknown as NextRequest;
}

function resetAll() {
  taskFindMany.mockReset().mockResolvedValue([]);
  taskFindUnique.mockReset();
  taskUpdate.mockReset();
  endDateAuditLogCreate.mockReset().mockResolvedValue({});
  notificationCreate.mockReset().mockResolvedValue({});
  $transaction.mockClear();
  vi.mocked(getSession).mockReset();
}

describe("POST /api/tasks/end-date/bulk-approve", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await bulkApprovePOST(postRequest({}));
    expect(res.status).toBe(401);
  });

  it("responde 403 para un rol fuera de CAN_REGULARIZE", async () => {
    mockSession({ role: "COORDINADOR_NACIONAL" });
    const res = await bulkApprovePOST(postRequest({ taskIds: ["t1"] }));
    expect(res.status).toBe(403);
  });

  it("responde 400 si no se seleccionó ninguna tarea", async () => {
    mockSession({ role: "ADMINISTRADOR" });
    const res = await bulkApprovePOST(postRequest({ taskIds: [] }));
    expect(res.status).toBe(400);
  });

  it("aprueba las tareas elegibles y omite las autoasignadas", async () => {
    mockSession({ role: "ADMINISTRADOR", userId: "admin-1" });
    taskFindMany.mockResolvedValue([
      { id: "t1", assignedToId: "colaborador-1" },
      { id: "t2", assignedToId: "admin-1" }, // autoasignada -> se omite
    ]);
    taskFindUnique.mockImplementation(() =>
      Promise.resolve({ endDate: new Date(Date.UTC(2026, 7, 15)), title: "Tarea", assignedToId: "colaborador-1" })
    );
    taskUpdate.mockResolvedValue({ endDate: new Date(Date.UTC(2026, 7, 15)), endDateApprovalStatus: "APROBADA" });

    const res = await bulkApprovePOST(postRequest({ taskIds: ["t1", "t2"] }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.updatedCount).toBe(1);
    expect(body.skippedSelfAssigned).toEqual(["t2"]);
    expect(taskUpdate).toHaveBeenCalledTimes(1);
    // El bulk-approve nunca notifica (solo Modificada/Rechazada notifican, no Aprobada).
    expect(notificationCreate).not.toHaveBeenCalled();
  });
});
