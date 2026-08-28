import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SessionPayload } from "@/lib/session";
import type { NextRequest } from "next/server";

// Fase 7g de la migración de stack (ver docs/AUDIT_LOG.md § 2026-08-18):
// esta ruta pasó de Prisma a Django — la lógica real (participantes,
// límite de 2 respuestas, notificación a la otra parte) ya vive en
// `DeskNoteViewSet.replies`/`DeskNoteReplyService`, cubierta en
// `backend/apps/desk/tests/`.
const getSession = vi.fn();
vi.mock("@/lib/session", () => ({ getSession: (...args: unknown[]) => getSession(...args) }));

const djangoApiFetch = vi.fn();
vi.mock("@/lib/djangoSession", () => ({
  djangoApiFetch: (...args: unknown[]) => djangoApiFetch(...args),
}));

const { GET, POST } = await import("@/app/api/desk-notes/[id]/replies/route");

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

function resetAll() {
  getSession.mockReset();
  djangoApiFetch.mockReset();
}

function djangoResponse(ok: boolean, data: unknown, status = ok ? 200 : 400) {
  return { ok, status, json: async () => data } as Response;
}

describe("GET /api/desk-notes/[id]/replies", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await GET(jsonRequest(undefined), ctx());
    expect(res.status).toBe(401);
  });

  it("responde 403 si no es participante de la nota", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(false, {}, 403));
    const res = await GET(jsonRequest(undefined), ctx());
    expect(res.status).toBe(403);
  });

  it("devuelve las respuestas mapeadas a la forma Nexo", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(
      djangoResponse(true, [{ id: 1, message: "Ok, reviso", author: { id: 5, name: "Ana" }, created_at: "2026-07-23T10:00:00Z" }])
    );
    const res = await GET(jsonRequest(undefined), ctx());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([
      { id: "1", message: "Ok, reviso", authorId: "5", authorName: "Ana", createdAt: "2026-07-23T10:00:00Z" },
    ]);
  });
});

describe("POST /api/desk-notes/[id]/replies", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await POST(jsonRequest({ message: "hola" }), ctx());
    expect(res.status).toBe(401);
  });

  it("responde 403 si no es remitente ni destinatario", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(false, {}, 403));
    const res = await POST(jsonRequest({ message: "hola" }), ctx());
    expect(res.status).toBe(403);
  });

  it("responde 409 con el mensaje exacto del pedido al llegar al límite de respuestas", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(false, {}, 409));
    const res = await POST(jsonRequest({ message: "una más" }), ctx());
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "Esta conversación alcanzó el límite permitido." });
  });

  it("responde 400 si el mensaje está vacío", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(false, { error: { details: { message: ["Escribe un mensaje"] } } }, 400));
    const res = await POST(jsonRequest({ message: "   " }), ctx());
    expect(res.status).toBe(400);
  });

  it("crea la respuesta y devuelve 201 con la forma Nexo", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(
      djangoResponse(true, { id: 1, message: "Ok, reviso", author: { id: 5, name: "Bea" }, created_at: "2026-07-23T10:00:00Z" }, 201)
    );

    const res = await POST(jsonRequest({ message: "Ok, reviso" }), ctx("1"));
    expect(res.status).toBe(201);
    expect(djangoApiFetch).toHaveBeenCalledWith("/desk-notes/1/replies/", expect.objectContaining({ body: JSON.stringify({ message: "Ok, reviso" }) }));
    expect(await res.json()).toEqual({ id: "1", message: "Ok, reviso", authorId: "5", authorName: "Bea", createdAt: "2026-07-23T10:00:00Z" });
  });
});
