import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SessionPayload } from "@/lib/session";
import type { NextRequest } from "next/server";

vi.mock("@/lib/session", () => ({ getSession: vi.fn() }));

const deskNoteFindUnique = vi.fn();
const deskNoteUpdate = vi.fn();
const deskNoteCount = vi.fn();
const taskCreate = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    deskNote: { findUnique: deskNoteFindUnique, update: deskNoteUpdate, count: deskNoteCount },
    task: { create: taskCreate },
  },
}));

vi.mock("@/lib/analytics", () => ({ invalidateAnalyticsCache: vi.fn() }));

const logDeskAudit = vi.fn();
vi.mock("@/lib/deskAudit", () => ({ logDeskAudit: (...args: unknown[]) => logDeskAudit(...args) }));

const { getSession } = await import("@/lib/session");
const { POST: convertToTask } = await import("@/app/api/desk-notes/[id]/convert-to-task/route");
const { GET: unreadCount } = await import("@/app/api/desk-notes/unread-count/route");

function mockSession(overrides: Partial<SessionPayload> | null) {
  vi.mocked(getSession).mockResolvedValue(
    overrides === null
      ? null
      : {
          userId: "u1",
          role: "ASISTENTE_GH",
          name: "Ana",
          email: "test@nexo.com",
          expiresAt: new Date(Date.now() + 100000).toISOString(),
          ...overrides,
        }
  );
}

function ctx(id = "n1") {
  return { params: Promise.resolve({ id }) };
}

function jsonRequest(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

const CONVERT_BODY = {
  title: "Revisar contrato",
  type: "SEGUIMIENTO",
  frequency: "PUNTUAL",
  startDate: "2026-08-01",
  endDate: "2026-08-08",
  estimatedHours: 1,
};

function resetAll() {
  deskNoteFindUnique.mockReset();
  deskNoteUpdate.mockReset();
  deskNoteCount.mockReset();
  taskCreate.mockReset();
  logDeskAudit.mockReset();
  vi.mocked(getSession).mockReset();
}

describe("POST /api/desk-notes/[id]/convert-to-task", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await convertToTask(jsonRequest(CONVERT_BODY), ctx());
    expect(res.status).toBe(401);
  });

  it("responde 404 si la nota no existe o está eliminada", async () => {
    mockSession({});
    deskNoteFindUnique.mockResolvedValue(null);
    const res = await convertToTask(jsonRequest(CONVERT_BODY), ctx());
    expect(res.status).toBe(404);
  });

  it("responde 403 si quien convierte no es el destinatario", async () => {
    mockSession({ userId: "u1" });
    deskNoteFindUnique.mockResolvedValue({ recipientId: "otro", deletedAt: null, message: "x", priority: "INFORMACION", attachmentName: null, convertedToTaskId: null });
    const res = await convertToTask(jsonRequest(CONVERT_BODY), ctx());
    expect(res.status).toBe(403);
  });

  it("responde 409 si la nota ya fue convertida antes", async () => {
    mockSession({ userId: "u1" });
    deskNoteFindUnique.mockResolvedValue({ recipientId: "u1", deletedAt: null, message: "x", priority: "INFORMACION", attachmentName: null, convertedToTaskId: "task-old" });
    const res = await convertToTask(jsonRequest(CONVERT_BODY), ctx());
    expect(res.status).toBe(409);
  });

  it("responde 400 si faltan campos requeridos de la tarea", async () => {
    mockSession({ userId: "u1" });
    deskNoteFindUnique.mockResolvedValue({ recipientId: "u1", deletedAt: null, message: "x", priority: "INFORMACION", attachmentName: null, convertedToTaskId: null });
    const res = await convertToTask(jsonRequest({ title: "Solo título" }), ctx());
    expect(res.status).toBe(400);
  });

  it("URGENTE se traduce a ALTA, asigna la tarea a quien convierte, y marca la nota como convertida sin eliminarla", async () => {
    mockSession({ userId: "u1", name: "Ana" });
    deskNoteFindUnique.mockResolvedValue({
      recipientId: "u1",
      deletedAt: null,
      message: "No olvides revisar el contrato",
      priority: "URGENTE",
      attachmentName: "contrato.pdf",
      convertedToTaskId: null,
    });
    taskCreate.mockResolvedValue({ id: "task-1", title: CONVERT_BODY.title });
    deskNoteUpdate.mockResolvedValue({});

    const res = await convertToTask(jsonRequest(CONVERT_BODY), ctx("n1"));
    expect(res.status).toBe(201);

    expect(taskCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          priority: "ALTA",
          assignedToId: "u1",
          createdById: "u1",
          description: expect.stringContaining("contrato.pdf"),
        }),
      })
    );
    // La nota original NUNCA se borra ni se edita su contenido — solo se marca.
    expect(deskNoteUpdate).toHaveBeenCalledWith({
      where: { id: "n1" },
      data: expect.objectContaining({ convertedToTaskId: "task-1" }),
    });
    expect(logDeskAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "CONVERTED_TO_TASK", metadata: { taskId: "task-1" } })
    );
  });
});

describe("GET /api/desk-notes/unread-count", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await unreadCount();
    expect(res.status).toBe(401);
  });

  it("Administrador siempre ve 0 sin consultar la base de datos", async () => {
    mockSession({ role: "ADMINISTRADOR" });
    const res = await unreadCount();
    const body = await res.json();
    expect(body).toEqual({ unread: 0 });
    expect(deskNoteCount).not.toHaveBeenCalled();
  });

  it("cuenta solo notas propias, no leídas, activas y no archivadas", async () => {
    mockSession({ userId: "u1" });
    deskNoteCount.mockResolvedValue(3);
    const res = await unreadCount();
    expect(deskNoteCount).toHaveBeenCalledWith({
      where: { recipientId: "u1", read: false, archived: false, deletedAt: null },
    });
    expect(await res.json()).toEqual({ unread: 3 });
  });
});
