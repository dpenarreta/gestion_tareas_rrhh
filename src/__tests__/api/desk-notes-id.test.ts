import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SessionPayload } from "@/lib/session";
import type { NextRequest } from "next/server";

// Fase 7g de la migración de stack (ver docs/AUDIT_LOG.md § 2026-08-18):
// GET/PATCH pasaron a Django (mockeados con `@/lib/djangoSession`) — la
// lógica real (permisos, idempotencia de "read", notificación al
// remitente) ya vive en `DeskNoteViewSet`/`DeskNoteService`, cubierta en
// `backend/apps/desk/tests/`. DELETE pasó a Django en la Fase 50 (ver
// docs/AUDIT_LOG.md § 2026-08-24) — mismo patrón, la Papelera
// (`apps.recovery`) ya resolvía este caso desde la Fase 14.
const getSession = vi.fn();
vi.mock("@/lib/session", () => ({ getSession: (...args: unknown[]) => getSession(...args) }));

const djangoApiFetch = vi.fn();
vi.mock("@/lib/djangoSession", () => ({
  djangoApiFetch: (...args: unknown[]) => djangoApiFetch(...args),
  extractDjangoFlatErrorMessage: async (response: Response) => (await response.json().catch(() => null))?.error,
}));

const { GET, PATCH, DELETE } = await import("@/app/api/desk-notes/[id]/route");

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

const DJANGO_USER_REF = { id: 1, name: "Ana" };

function djangoNote(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1, message: "Revisar el contrato", priority: "INFORMACION", color: "AMARILLO",
    read: false, read_at: null, pinned: false, archived: false, archived_at: null,
    created_at: "2026-07-23T10:00:00Z", sender: DJANGO_USER_REF, recipient: { id: 2, name: "Bea" },
    is_mine: false, reply_count: 0, has_attachment: false, attachment_name: null, attachment_mime: null,
    converted_to_reminder_id: null, converted_at: null,
    ...overrides,
  };
}

describe("GET /api/desk-notes/[id]", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await GET(jsonRequest(undefined), ctx());
    expect(res.status).toBe(401);
  });

  it("responde 401 si Django no tiene sesión disponible", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(null);
    const res = await GET(jsonRequest(undefined), ctx());
    expect(res.status).toBe(401);
  });

  it("responde 404 si la nota no existe", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(false, {}, 404));
    const res = await GET(jsonRequest(undefined), ctx());
    expect(res.status).toBe(404);
  });

  it("responde 403 si el usuario no es remitente ni destinatario", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(false, {}, 403));
    const res = await GET(jsonRequest(undefined), ctx());
    expect(res.status).toBe(403);
  });

  it("devuelve el detalle mapeado a la forma Nexo", async () => {
    mockSession({ userId: "1" });
    djangoApiFetch.mockResolvedValue(djangoResponse(true, djangoNote({ is_mine: true })));
    const res = await GET(jsonRequest(undefined), ctx("1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ id: "1", message: "Revisar el contrato", replyCount: 0, isMine: true });
  });
});

describe("PATCH /api/desk-notes/[id]", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await PATCH(jsonRequest({ action: "read" }), ctx());
    expect(res.status).toBe(401);
  });

  it("responde 400 ante una acción inválida, sin consultar Django", async () => {
    mockSession({});
    const res = await PATCH(jsonRequest({ action: "nope" }), ctx());
    expect(res.status).toBe(400);
    expect(djangoApiFetch).not.toHaveBeenCalled();
  });

  it("responde 404 si la nota no existe", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(false, {}, 404));
    const res = await PATCH(jsonRequest({ action: "read" }), ctx());
    expect(res.status).toBe(404);
  });

  it("responde 403 si quien marca leída no es el destinatario", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(false, {}, 403));
    const res = await PATCH(jsonRequest({ action: "read" }), ctx());
    expect(res.status).toBe(403);
  });

  it("reenvía la acción y devuelve id/read/pinned/archived mapeados", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(true, { id: 1, read: true, pinned: false, archived: false }));
    const res = await PATCH(jsonRequest({ action: "read" }), ctx("1"));
    expect(res.status).toBe(200);
    expect(djangoApiFetch).toHaveBeenCalledWith("/desk-notes/1/", expect.objectContaining({ method: "PATCH", body: JSON.stringify({ action: "read" }) }));
    expect(await res.json()).toEqual({ id: "1", read: true, pinned: false, archived: false });
  });
});

describe("DELETE /api/desk-notes/[id]", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await DELETE(jsonRequest(undefined), ctx());
    expect(res.status).toBe(401);
    expect(djangoApiFetch).not.toHaveBeenCalled();
  });

  it("responde 401 si Django no tiene sesión disponible", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(null);
    const res = await DELETE(jsonRequest(undefined), ctx());
    expect(res.status).toBe(401);
  });

  it("responde 404 si la nota no existe", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(false, { error: "Nota no encontrada" }, 404));
    const res = await DELETE(jsonRequest(undefined), ctx());
    expect(res.status).toBe(404);
  });

  it("responde 403 si no es remitente ni destinatario", async () => {
    mockSession({ userId: "otro" });
    djangoApiFetch.mockResolvedValue(djangoResponse(false, { error: "Sin permisos" }, 403));
    const res = await DELETE(jsonRequest(undefined), ctx());
    expect(res.status).toBe(403);
  });

  it("propaga el mensaje 409 de Django cuando el destinatario intenta eliminar una nota no archivada", async () => {
    mockSession({ userId: "u1" });
    djangoApiFetch.mockResolvedValue(
      djangoResponse(false, { error: "Solo puedes eliminar definitivamente una nota ya archivada" }, 409)
    );
    const res = await DELETE(jsonRequest(undefined), ctx());
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("Solo puedes eliminar definitivamente una nota ya archivada");
  });

  it("propaga el mensaje 409 de Django cuando el elemento ya está en la papelera", async () => {
    mockSession({ userId: "sender-1" });
    djangoApiFetch.mockResolvedValue(djangoResponse(false, { error: "Este elemento ya está en la papelera" }, 409));
    const res = await DELETE(jsonRequest(undefined), ctx());
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("Este elemento ya está en la papelera");
  });

  it("el remitente elimina (envío a la papelera del Centro de Recuperación, resuelto en Django)", async () => {
    mockSession({ userId: "sender-1" });
    djangoApiFetch.mockResolvedValue(djangoResponse(true, { success: true }));
    const res = await DELETE(jsonRequest(undefined), ctx("1"));
    expect(res.status).toBe(200);
    expect(djangoApiFetch).toHaveBeenCalledWith("/desk-notes/1/", { method: "DELETE" });
    expect(await res.json()).toEqual({ success: true });
  });

  it("el destinatario elimina definitivamente una nota archivada", async () => {
    mockSession({ userId: "u1" });
    djangoApiFetch.mockResolvedValue(djangoResponse(true, { success: true }));
    const res = await DELETE(jsonRequest(undefined), ctx("1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
  });
});
