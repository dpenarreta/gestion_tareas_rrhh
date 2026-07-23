import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SessionPayload } from "@/lib/session";
import type { NextRequest } from "next/server";

vi.mock("@/lib/session", () => ({ getSession: vi.fn() }));

const deskNoteFindUnique = vi.fn();
const deskNoteUpdate = vi.fn();
const deskNoteCount = vi.fn();
const personalReminderCreate = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    deskNote: { findUnique: deskNoteFindUnique, update: deskNoteUpdate, count: deskNoteCount },
    personalReminder: { create: personalReminderCreate },
  },
}));

const logDeskAudit = vi.fn();
vi.mock("@/lib/deskAudit", () => ({ logDeskAudit: (...args: unknown[]) => logDeskAudit(...args) }));

const { getSession } = await import("@/lib/session");
const { POST: convertToReminder } = await import("@/app/api/desk-notes/[id]/convert-to-reminder/route");
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

const CONVERT_BODY = { dueAt: "2026-08-01T10:00:00Z" };

function resetAll() {
  deskNoteFindUnique.mockReset();
  deskNoteUpdate.mockReset();
  deskNoteCount.mockReset();
  personalReminderCreate.mockReset();
  logDeskAudit.mockReset();
  vi.mocked(getSession).mockReset();
}

describe("POST /api/desk-notes/[id]/convert-to-reminder", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await convertToReminder(jsonRequest(CONVERT_BODY), ctx());
    expect(res.status).toBe(401);
  });

  it("responde 404 si la nota no existe o está eliminada", async () => {
    mockSession({});
    deskNoteFindUnique.mockResolvedValue(null);
    const res = await convertToReminder(jsonRequest(CONVERT_BODY), ctx());
    expect(res.status).toBe(404);
  });

  it("responde 403 si quien convierte no es el destinatario", async () => {
    mockSession({ userId: "u1" });
    deskNoteFindUnique.mockResolvedValue({
      recipientId: "otro", deletedAt: null, message: "x", priority: "INFORMACION",
      attachmentName: null, attachmentMime: null, attachmentData: null, convertedToReminderId: null,
    });
    const res = await convertToReminder(jsonRequest(CONVERT_BODY), ctx());
    expect(res.status).toBe(403);
  });

  it("responde 409 si la nota ya fue convertida antes", async () => {
    mockSession({ userId: "u1" });
    deskNoteFindUnique.mockResolvedValue({
      recipientId: "u1", deletedAt: null, message: "x", priority: "INFORMACION",
      attachmentName: null, attachmentMime: null, attachmentData: null, convertedToReminderId: "r-old",
    });
    const res = await convertToReminder(jsonRequest(CONVERT_BODY), ctx());
    expect(res.status).toBe(409);
  });

  it("responde 400 si falta dueAt", async () => {
    mockSession({ userId: "u1" });
    deskNoteFindUnique.mockResolvedValue({
      recipientId: "u1", deletedAt: null, message: "x", priority: "INFORMACION",
      attachmentName: null, attachmentMime: null, attachmentData: null, convertedToReminderId: null,
    });
    const res = await convertToReminder(jsonRequest({}), ctx());
    expect(res.status).toBe(400);
  });

  it("URGENTE se traduce a URGENTE, copia el adjunto, y marca la nota como convertida sin eliminarla", async () => {
    mockSession({ userId: "u1", name: "Ana" });
    deskNoteFindUnique.mockResolvedValue({
      recipientId: "u1",
      deletedAt: null,
      message: "No olvides revisar el contrato",
      priority: "URGENTE",
      attachmentName: "contrato.pdf",
      attachmentMime: "application/pdf",
      attachmentData: "data:application/pdf;base64,xxx",
      convertedToReminderId: null,
    });
    personalReminderCreate.mockResolvedValue({ id: "rem-1", title: "No olvides revisar el contrato" });
    deskNoteUpdate.mockResolvedValue({});

    const res = await convertToReminder(jsonRequest(CONVERT_BODY), ctx("n1"));
    expect(res.status).toBe(201);

    expect(personalReminderCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: "u1",
          priority: "URGENTE",
          attachmentName: "contrato.pdf",
          attachmentData: "data:application/pdf;base64,xxx",
        }),
      })
    );
    // La nota original NUNCA se borra ni se edita su contenido — solo se marca.
    expect(deskNoteUpdate).toHaveBeenCalledWith({
      where: { id: "n1" },
      data: expect.objectContaining({ convertedToReminderId: "rem-1" }),
    });
    expect(logDeskAudit).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: "NOTE", action: "CONVERTED_TO_REMINDER", metadata: { reminderId: "rem-1" } })
    );
    expect(logDeskAudit).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: "REMINDER", entityId: "rem-1", action: "CREATED" })
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
