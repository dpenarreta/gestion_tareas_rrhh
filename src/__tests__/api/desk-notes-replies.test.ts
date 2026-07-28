import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SessionPayload } from "@/lib/session";
import type { NextRequest } from "next/server";

vi.mock("@/lib/session", () => ({ getSession: vi.fn() }));

const deskNoteFindUnique = vi.fn();
const deskNoteReplyFindMany = vi.fn();
const deskNoteReplyCreate = vi.fn();
const notificationCreate = vi.fn();
const systemConfigHistoryFindFirst = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    deskNote: { findUnique: deskNoteFindUnique },
    deskNoteReply: { findMany: deskNoteReplyFindMany, create: deskNoteReplyCreate },
    notification: { create: notificationCreate },
    // getEffectiveDeskNoteMaxReplies (Sprint O) consulta esto — sin registro
    // guardado, cae al default (DEFAULT_DESK_NOTE_MAX_REPLIES = 2).
    systemConfigHistory: { findFirst: systemConfigHistoryFindFirst },
  },
}));

const logDeskAudit = vi.fn();
vi.mock("@/lib/deskAudit", () => ({ logDeskAudit: (...args: unknown[]) => logDeskAudit(...args) }));

const { getSession } = await import("@/lib/session");
const { GET, POST } = await import("@/app/api/desk-notes/[id]/replies/route");

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

function resetAll() {
  deskNoteFindUnique.mockReset();
  deskNoteReplyFindMany.mockReset();
  deskNoteReplyCreate.mockReset();
  notificationCreate.mockReset();
  logDeskAudit.mockReset();
  systemConfigHistoryFindFirst.mockReset().mockResolvedValue(null);
  vi.mocked(getSession).mockReset();
}

describe("GET /api/desk-notes/[id]/replies", () => {
  beforeEach(resetAll);

  it("responde 403 si no es participante de la nota", async () => {
    mockSession({ userId: "otro" });
    deskNoteFindUnique.mockResolvedValue({ senderId: "s1", recipientId: "u1", deletedAt: null });
    const res = await GET(jsonRequest(undefined), ctx());
    expect(res.status).toBe(403);
  });

  it("devuelve las respuestas en orden cronológico", async () => {
    mockSession({ userId: "u1" });
    deskNoteFindUnique.mockResolvedValue({ senderId: "s1", recipientId: "u1", deletedAt: null });
    deskNoteReplyFindMany.mockResolvedValue([
      { id: "r1", message: "Ok, reviso", authorId: "u1", author: { name: "Ana" }, createdAt: new Date("2026-07-23T10:00:00Z") },
    ]);
    const res = await GET(jsonRequest(undefined), ctx());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([
      { id: "r1", message: "Ok, reviso", authorId: "u1", authorName: "Ana", createdAt: "2026-07-23T10:00:00.000Z" },
    ]);
  });
});

describe("POST /api/desk-notes/[id]/replies", () => {
  beforeEach(resetAll);

  it("responde 403 si no es remitente ni destinatario", async () => {
    mockSession({ userId: "otro" });
    deskNoteFindUnique.mockResolvedValue({ senderId: "s1", recipientId: "u1", deletedAt: null, _count: { replies: 0 } });
    const res = await POST(jsonRequest({ message: "hola" }), ctx());
    expect(res.status).toBe(403);
  });

  it("responde 409 con el mensaje exacto del pedido al llegar al límite de 2 respuestas", async () => {
    mockSession({ userId: "u1" });
    deskNoteFindUnique.mockResolvedValue({ senderId: "s1", recipientId: "u1", deletedAt: null, _count: { replies: 2 } });
    const res = await POST(jsonRequest({ message: "una más" }), ctx());
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "Esta conversación alcanzó el límite permitido." });
    expect(deskNoteReplyCreate).not.toHaveBeenCalled();
  });

  it("responde 400 si el mensaje está vacío", async () => {
    mockSession({ userId: "u1" });
    deskNoteFindUnique.mockResolvedValue({ senderId: "s1", recipientId: "u1", deletedAt: null, _count: { replies: 0 } });
    const res = await POST(jsonRequest({ message: "   " }), ctx());
    expect(res.status).toBe(400);
  });

  it("el destinatario responde: notifica al remitente (la otra parte) y audita REPLIED", async () => {
    mockSession({ userId: "u1", name: "Bea" });
    deskNoteFindUnique.mockResolvedValue({ senderId: "s1", recipientId: "u1", deletedAt: null, _count: { replies: 0 } });
    deskNoteReplyCreate.mockResolvedValue({
      id: "r1", message: "Ok, reviso", authorId: "u1", author: { name: "Bea" }, createdAt: new Date("2026-07-23T10:00:00Z"),
    });

    const res = await POST(jsonRequest({ message: "Ok, reviso" }), ctx("n1"));
    expect(res.status).toBe(201);
    expect(notificationCreate).toHaveBeenCalledWith({
      data: { userId: "s1", message: "Bea respondió tu Nota Rápida." },
    });
    expect(logDeskAudit).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: "NOTE", entityId: "n1", action: "REPLIED" })
    );
  });

  it("el remitente responde: notifica al destinatario (la otra parte)", async () => {
    mockSession({ userId: "s1", name: "Carlos" });
    deskNoteFindUnique.mockResolvedValue({ senderId: "s1", recipientId: "u1", deletedAt: null, _count: { replies: 1 } });
    deskNoteReplyCreate.mockResolvedValue({
      id: "r2", message: "Gracias", authorId: "s1", author: { name: "Carlos" }, createdAt: new Date("2026-07-23T11:00:00Z"),
    });

    await POST(jsonRequest({ message: "Gracias" }), ctx("n1"));
    expect(notificationCreate).toHaveBeenCalledWith({
      data: { userId: "u1", message: "Carlos respondió tu Nota Rápida." },
    });
  });
});
