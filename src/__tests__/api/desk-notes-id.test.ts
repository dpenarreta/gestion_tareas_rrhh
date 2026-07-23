import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SessionPayload } from "@/lib/session";
import type { NextRequest } from "next/server";

vi.mock("@/lib/session", () => ({ getSession: vi.fn() }));

const deskNoteFindUnique = vi.fn();
const deskNoteUpdate = vi.fn();
const deskNoteDelete = vi.fn();
const notificationCreate = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    deskNote: { findUnique: deskNoteFindUnique, update: deskNoteUpdate, delete: deskNoteDelete },
    notification: { create: notificationCreate },
  },
}));

const logDeskAudit = vi.fn();
vi.mock("@/lib/deskAudit", () => ({ logDeskAudit: (...args: unknown[]) => logDeskAudit(...args) }));

const moveToTrash = vi.fn();
vi.mock("@/lib/recoveryCenter", () => ({ moveToTrash: (...args: unknown[]) => moveToTrash(...args) }));

const { getSession } = await import("@/lib/session");
const { GET, PATCH, DELETE } = await import("@/app/api/desk-notes/[id]/route");

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

const FULL_NOTE_ROW = {
  id: "n1",
  message: "Revisar el contrato",
  priority: "INFORMACION",
  color: "AMARILLO",
  read: false,
  readAt: null,
  pinned: false,
  archived: false,
  archivedAt: null,
  createdAt: new Date("2026-07-23T10:00:00Z"),
  senderId: "sender-1",
  sender: { name: "Ana" },
  recipientId: "u1",
  recipient: { name: "Bea" },
  attachmentName: null,
  attachmentMime: null,
  convertedToReminderId: null,
  convertedAt: null,
  _count: { replies: 0 },
  deletedAt: null,
};

function resetAll() {
  deskNoteFindUnique.mockReset();
  deskNoteUpdate.mockReset();
  deskNoteDelete.mockReset();
  notificationCreate.mockReset();
  logDeskAudit.mockReset();
  moveToTrash.mockReset();
  vi.mocked(getSession).mockReset();
}

describe("GET /api/desk-notes/[id]", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await GET(jsonRequest(undefined), ctx());
    expect(res.status).toBe(401);
  });

  it("responde 404 si la nota no existe o fue eliminada", async () => {
    mockSession({});
    deskNoteFindUnique.mockResolvedValue({ ...FULL_NOTE_ROW, deletedAt: new Date() });
    const res = await GET(jsonRequest(undefined), ctx());
    expect(res.status).toBe(404);
  });

  it("responde 403 si el usuario no es remitente ni destinatario", async () => {
    mockSession({ userId: "otro" });
    deskNoteFindUnique.mockResolvedValue(FULL_NOTE_ROW);
    const res = await GET(jsonRequest(undefined), ctx());
    expect(res.status).toBe(403);
  });

  it("devuelve el detalle serializado para el destinatario", async () => {
    mockSession({ userId: "u1" });
    deskNoteFindUnique.mockResolvedValue(FULL_NOTE_ROW);
    const res = await GET(jsonRequest(undefined), ctx());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ id: "n1", message: "Revisar el contrato", replyCount: 0 });
  });
});

describe("PATCH /api/desk-notes/[id] — acción read", () => {
  beforeEach(resetAll);

  it("marcar leída notifica al remitente y audita READ", async () => {
    mockSession({ userId: "u1", name: "Bea" });
    deskNoteFindUnique.mockResolvedValue({ recipientId: "u1", senderId: "sender-1", deletedAt: null, read: false });
    deskNoteUpdate.mockResolvedValue({ id: "n1", read: true, pinned: false, archived: false });

    const res = await PATCH(jsonRequest({ action: "read" }), ctx());
    expect(res.status).toBe(200);
    expect(notificationCreate).toHaveBeenCalledWith({
      data: { userId: "sender-1", message: "Bea leyó tu Nota Rápida." },
    });
    expect(logDeskAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "READ" }));
  });

  it("marcar leída una nota ya leída es idempotente — no vuelve a notificar", async () => {
    mockSession({ userId: "u1" });
    deskNoteFindUnique.mockResolvedValue({ recipientId: "u1", senderId: "sender-1", deletedAt: null, read: true });
    const res = await PATCH(jsonRequest({ action: "read" }), ctx());
    expect(res.status).toBe(200);
    expect(notificationCreate).not.toHaveBeenCalled();
    expect(deskNoteUpdate).not.toHaveBeenCalled();
  });

  it("responde 403 si quien marca leída no es el destinatario", async () => {
    mockSession({ userId: "otro" });
    deskNoteFindUnique.mockResolvedValue({ recipientId: "u1", senderId: "sender-1", deletedAt: null, read: false });
    const res = await PATCH(jsonRequest({ action: "read" }), ctx());
    expect(res.status).toBe(403);
  });
});

describe("DELETE /api/desk-notes/[id]", () => {
  beforeEach(resetAll);

  it("el remitente elimina vía Centro de Recuperación (moveToTrash)", async () => {
    mockSession({ userId: "sender-1" });
    deskNoteFindUnique.mockResolvedValue({ senderId: "sender-1", recipientId: "u1", archived: false, deletedAt: null });
    moveToTrash.mockResolvedValue({});
    const res = await DELETE(jsonRequest(undefined), ctx());
    expect(res.status).toBe(200);
    expect(moveToTrash).toHaveBeenCalledWith({ entityType: "DESK_NOTE", entityId: "n1", userId: "sender-1" });
    expect(deskNoteDelete).not.toHaveBeenCalled();
    expect(logDeskAudit).toHaveBeenCalledWith(expect.objectContaining({ metadata: { origin: "manual", actor: "sender" } }));
  });

  it("el destinatario NO puede eliminar una nota que sigue activa (no archivada)", async () => {
    mockSession({ userId: "u1" });
    deskNoteFindUnique.mockResolvedValue({ senderId: "sender-1", recipientId: "u1", archived: false, deletedAt: null });
    const res = await DELETE(jsonRequest(undefined), ctx());
    expect(res.status).toBe(409);
    expect(deskNoteDelete).not.toHaveBeenCalled();
  });

  it("el destinatario elimina definitivamente una nota archivada (borrado directo, no papelera)", async () => {
    mockSession({ userId: "u1" });
    deskNoteFindUnique.mockResolvedValue({ senderId: "sender-1", recipientId: "u1", archived: true, deletedAt: null });
    deskNoteDelete.mockResolvedValue({});
    const res = await DELETE(jsonRequest(undefined), ctx());
    expect(res.status).toBe(200);
    expect(deskNoteDelete).toHaveBeenCalledWith({ where: { id: "n1" } });
    expect(moveToTrash).not.toHaveBeenCalled();
    expect(logDeskAudit).toHaveBeenCalledWith(expect.objectContaining({ metadata: { origin: "manual", actor: "recipient" } }));
  });

  it("responde 403 si no es remitente ni destinatario", async () => {
    mockSession({ userId: "otro" });
    deskNoteFindUnique.mockResolvedValue({ senderId: "sender-1", recipientId: "u1", archived: true, deletedAt: null });
    const res = await DELETE(jsonRequest(undefined), ctx());
    expect(res.status).toBe(403);
  });
});
