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
    const res = await bulkApprovePOST(postRequest({ items: [{ taskId: "t1" }] }));
    expect(res.status).toBe(403);
  });

  it("responde 400 si no se seleccionó ninguna tarea", async () => {
    mockSession({ role: "ADMINISTRADOR" });
    const res = await bulkApprovePOST(postRequest({ items: [] }));
    expect(res.status).toBe(400);
  });

  it("responde 400 si items trae un elemento con forma inválida", async () => {
    mockSession({ role: "ADMINISTRADOR" });
    const res = await bulkApprovePOST(postRequest({ items: [{ taskId: 123 }] }));
    expect(res.status).toBe(400);
  });

  it("aprueba sin cambio (sin newEndDate) y omite las autoasignadas", async () => {
    mockSession({ role: "ADMINISTRADOR", userId: "admin-1" });
    taskFindMany.mockResolvedValue([
      { id: "t1", assignedToId: "colaborador-1", startDate: new Date(Date.UTC(2026, 7, 1)), endDate: new Date(Date.UTC(2026, 7, 15)) },
      { id: "t2", assignedToId: "admin-1", startDate: new Date(Date.UTC(2026, 7, 1)), endDate: new Date(Date.UTC(2026, 7, 15)) }, // autoasignada -> se omite
    ]);
    taskFindUnique.mockResolvedValue({ endDate: new Date(Date.UTC(2026, 7, 15)), title: "Tarea", assignedToId: "colaborador-1" });
    taskUpdate.mockResolvedValue({ endDate: new Date(Date.UTC(2026, 7, 15)), endDateApprovalStatus: "APROBADA" });

    const res = await bulkApprovePOST(postRequest({ items: [{ taskId: "t1" }, { taskId: "t2" }] }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.updatedCount).toBe(1);
    expect(body.skippedSelfAssigned).toEqual(["t2"]);
    expect(taskUpdate).toHaveBeenCalledTimes(1);
    expect(taskUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ endDateApprovalStatus: "APROBADA" }) }));
    // El bulk-approve nunca notifica cuando aprueba sin cambio (solo Modificada/Rechazada notifican).
    expect(notificationCreate).not.toHaveBeenCalled();
  });

  it("un newEndDate distinto al vigente se aplica como MODIFICAR y notifica al colaborador", async () => {
    mockSession({ role: "ADMINISTRADOR", userId: "admin-1" });
    taskFindMany.mockResolvedValue([
      { id: "t1", assignedToId: "colaborador-1", startDate: new Date(Date.UTC(2026, 7, 1)), endDate: new Date(Date.UTC(2026, 7, 15)) },
    ]);
    taskFindUnique.mockResolvedValue({ endDate: new Date(Date.UTC(2026, 7, 15)), title: "Tarea", assignedToId: "colaborador-1" });
    taskUpdate.mockResolvedValue({ endDate: new Date("2026-08-20"), endDateApprovalStatus: "MODIFICADA" });

    const res = await bulkApprovePOST(postRequest({ items: [{ taskId: "t1", newEndDate: "2026-08-20" }] }));
    expect(res.status).toBe(200);
    expect(taskUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ endDate: new Date("2026-08-20"), endDateApprovalStatus: "MODIFICADA" }) })
    );
    expect(notificationCreate).toHaveBeenCalledTimes(1);
  });

  it("un newEndDate IGUAL al vigente se trata como APROBAR (sin cambio real, sin notificar)", async () => {
    mockSession({ role: "ADMINISTRADOR", userId: "admin-1" });
    taskFindMany.mockResolvedValue([
      { id: "t1", assignedToId: "colaborador-1", startDate: new Date(Date.UTC(2026, 7, 1)), endDate: new Date(Date.UTC(2026, 7, 15)) },
    ]);
    taskFindUnique.mockResolvedValue({ endDate: new Date(Date.UTC(2026, 7, 15)), title: "Tarea", assignedToId: "colaborador-1" });
    taskUpdate.mockResolvedValue({ endDate: new Date(Date.UTC(2026, 7, 15)), endDateApprovalStatus: "APROBADA" });

    const res = await bulkApprovePOST(postRequest({ items: [{ taskId: "t1", newEndDate: "2026-08-15" }] }));
    expect(res.status).toBe(200);
    expect(taskUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ endDateApprovalStatus: "APROBADA" }) }));
    expect(notificationCreate).not.toHaveBeenCalled();
  });

  it("omite (y reporta aparte) una tarea cuya newEndDate es anterior a su startDate", async () => {
    mockSession({ role: "ADMINISTRADOR", userId: "admin-1" });
    taskFindMany.mockResolvedValue([
      { id: "t1", assignedToId: "colaborador-1", startDate: new Date(Date.UTC(2026, 7, 10)), endDate: new Date(Date.UTC(2026, 7, 15)) },
    ]);

    const res = await bulkApprovePOST(postRequest({ items: [{ taskId: "t1", newEndDate: "2026-08-05" }] }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.updatedCount).toBe(0);
    expect(body.skippedInvalidDate).toEqual(["t1"]);
    expect(taskUpdate).not.toHaveBeenCalled();
  });
});
