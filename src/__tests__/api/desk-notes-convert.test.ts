import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SessionPayload } from "@/lib/session";
import type { NextRequest } from "next/server";

// Fase 7g de la migración de stack (ver docs/AUDIT_LOG.md § 2026-08-18):
// ambas rutas pasaron de Prisma a Django — la lógica real (permisos,
// traducción de prioridad, copia de adjunto) ya vive en
// `DeskNoteViewSet.convert_to_reminder`/`unread_count`, cubierta en
// `backend/apps/desk/tests/`.
const getSession = vi.fn();
vi.mock("@/lib/session", () => ({ getSession: (...args: unknown[]) => getSession(...args) }));

const djangoApiFetch = vi.fn();
vi.mock("@/lib/djangoSession", () => ({
  djangoApiFetch: (...args: unknown[]) => djangoApiFetch(...args),
}));

const { POST: convertToReminder } = await import("@/app/api/desk-notes/[id]/convert-to-reminder/route");
const { GET: unreadCount } = await import("@/app/api/desk-notes/unread-count/route");

function mockSession(overrides: Partial<SessionPayload> | null) {
  getSession.mockResolvedValue(
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

function ctx(id = "1") {
  return { params: Promise.resolve({ id }) };
}

function jsonRequest(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

const CONVERT_BODY = { dueAt: "2026-08-01T10:00:00Z" };

function resetAll() {
  getSession.mockReset();
  djangoApiFetch.mockReset();
}

function djangoResponse(ok: boolean, data: unknown, status = ok ? 200 : 400) {
  return { ok, status, json: async () => data } as Response;
}

describe("POST /api/desk-notes/[id]/convert-to-reminder", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await convertToReminder(jsonRequest(CONVERT_BODY), ctx());
    expect(res.status).toBe(401);
  });

  it("responde 404 si la nota no existe", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(false, {}, 404));
    const res = await convertToReminder(jsonRequest(CONVERT_BODY), ctx());
    expect(res.status).toBe(404);
  });

  it("responde 403 si quien convierte no es el destinatario", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(false, {}, 403));
    const res = await convertToReminder(jsonRequest(CONVERT_BODY), ctx());
    expect(res.status).toBe(403);
  });

  it("responde 409 si la nota ya fue convertida antes", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(false, {}, 409));
    const res = await convertToReminder(jsonRequest(CONVERT_BODY), ctx());
    expect(res.status).toBe(409);
  });

  it("responde 400 con el mensaje de Django si falta dueAt", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(
      djangoResponse(false, { error: { details: { due_at: ["Este campo es requerido."] } } }, 400)
    );
    const res = await convertToReminder(jsonRequest({}), ctx());
    expect(res.status).toBe(400);
  });

  it("mapea el body (dueAt->due_at) y devuelve reminderId/reminderTitle", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(true, { reminder_id: 7, reminder_title: "No olvides revisar el contrato" }, 201));

    const res = await convertToReminder(jsonRequest({ title: "custom", dueAt: "2026-08-01T10:00:00Z", priority: "URGENTE" }), ctx("1"));
    expect(res.status).toBe(201);
    expect(djangoApiFetch).toHaveBeenCalledWith(
      "/desk-notes/1/convert-to-reminder/",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ title: "custom", due_at: "2026-08-01T10:00:00Z", priority: "URGENTE" }),
      })
    );
    expect(await res.json()).toEqual({ reminderId: "7", reminderTitle: "No olvides revisar el contrato" });
  });
});

describe("GET /api/desk-notes/unread-count", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await unreadCount();
    expect(res.status).toBe(401);
  });

  it("responde 401 si Django no tiene sesión disponible", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(null);
    const res = await unreadCount();
    expect(res.status).toBe(401);
  });

  it("Administrador siempre ve 0 — réplica de que Django tampoco gatea por rol acá", async () => {
    mockSession({ role: "ADMINISTRADOR" });
    djangoApiFetch.mockResolvedValue(djangoResponse(true, { unread: 0 }));
    const res = await unreadCount();
    expect(await res.json()).toEqual({ unread: 0 });
  });

  it("devuelve el conteo tal cual lo entrega Django", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(true, { unread: 3 }));
    const res = await unreadCount();
    expect(await res.json()).toEqual({ unread: 3 });
  });
});
