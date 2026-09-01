import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SessionPayload } from "@/lib/session";
import type { NextRequest } from "next/server";

// Cutover de stack (ver docs/AUDIT_LOG.md § 2026-08-21): esta ruta pasó de
// Prisma a Django (Fase 43). La máquina de estados, el badge "innovador" y
// la notificación al autor ya viven en
// `apps.ideas.services.change_idea_status`, cubierto por la suite de
// Django — acá solo se prueba ruteo y mapeo de campos.
vi.mock("@/lib/session", () => ({ getSession: vi.fn() }));

const djangoApiFetch = vi.fn();
vi.mock("@/lib/djangoSession", () => ({
  djangoApiFetch: (...args: unknown[]) => djangoApiFetch(...args),
  extractDjangoFlatErrorMessage: async (response: Response) => {
    const data = await response.json().catch(() => null);
    return typeof (data as { error?: unknown })?.error === "string" ? (data as { error: string }).error : undefined;
  },
}));

const { getSession } = await import("@/lib/session");
const { PATCH } = await import("@/app/api/ideas/[id]/status/route");

const DJANGO_USER_REF = { id: 1, username: "ana", first_name: "Ana", email: "ana@nexo.com", roles: [{ id: 1, name: "JEFE_NACIONAL" }] };

function mockSession(overrides: Partial<SessionPayload> | null) {
  vi.mocked(getSession).mockResolvedValue(
    overrides === null
      ? null
      : {
          djangoUserId: 1,
          permissions: [],
          role: "JEFE_NACIONAL",
          name: "Test",
          email: "test@nexo.com",
          expiresAt: new Date(Date.now() + 100000).toISOString(),
          ...overrides,
        }
  );
}

function ctx(id = "1") {
  return { params: Promise.resolve({ id }) };
}

function patchRequest(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

function djangoResponse(ok: boolean, data: unknown, status = ok ? 200 : 400) {
  return { ok, status, json: async () => data } as Response;
}

function resetAll() {
  vi.mocked(getSession).mockReset();
  djangoApiFetch.mockReset();
}

describe("PATCH /api/ideas/[id]/status", () => {
  beforeEach(() => {
    resetAll();
    mockSession({ role: "JEFE_NACIONAL" });
  });

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await PATCH(patchRequest({ action: "ADVANCE" }), ctx());
    expect(res.status).toBe(401);
    expect(djangoApiFetch).not.toHaveBeenCalled();
  });

  it("responde 403 con el mensaje de Django para un rol sin permiso de revisión", async () => {
    mockSession({ role: "ASISTENTE_GH" });
    djangoApiFetch.mockResolvedValue(djangoResponse(false, { error: "Sin permisos para mover ideas" }, 403));
    const res = await PATCH(patchRequest({ action: "ADVANCE" }), ctx());
    expect(res.status).toBe(403);
  });

  it("responde 404 si la idea no existe", async () => {
    djangoApiFetch.mockResolvedValue(djangoResponse(false, { error: "Idea no encontrada" }, 404));
    const res = await PATCH(patchRequest({ action: "ADVANCE" }), ctx());
    expect(res.status).toBe(404);
  });

  it("responde 400 con el mensaje de Django ante una acción inválida o fuera de rango", async () => {
    djangoApiFetch.mockResolvedValue(djangoResponse(false, { error: "No se puede avanzar desde esta etapa" }, 400));
    const res = await PATCH(patchRequest({ action: "ADVANCE" }), ctx());
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("No se puede avanzar desde esta etapa");
  });

  it("recorta el comentario y lo manda como null si queda vacío", async () => {
    djangoApiFetch.mockResolvedValue(djangoResponse(true, { id: 1, title: "Idea", status: "RECHAZADA", author: DJANGO_USER_REF, vote_count: 0, voted_by_me: false, impact: "ALTO", description: "d", progress: 0, attachment_name: null, attachment_mime: null, created_at: "x", updated_at: "x" }));
    await PATCH(patchRequest({ action: "REJECT", comment: "   " }), ctx());
    expect(djangoApiFetch).toHaveBeenCalledWith(
      "/ideas/1/status/",
      expect.objectContaining({ body: JSON.stringify({ action: "REJECT", comment: null }) })
    );
  });

  it("mapea la idea actualizada a la forma Nexo", async () => {
    djangoApiFetch.mockResolvedValue(
      djangoResponse(true, {
        id: 1, title: "Mi idea", status: "EN_REVISION", author: DJANGO_USER_REF, vote_count: 5, voted_by_me: true,
        impact: "ALTO", description: "d", progress: 0, attachment_name: null, attachment_mime: null,
        created_at: "2026-08-01T00:00:00Z", updated_at: "2026-08-02T00:00:00Z",
      })
    );
    const res = await PATCH(patchRequest({ action: "ADVANCE" }), ctx());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ id: "1", status: "EN_REVISION", voteCount: 5, votedByMe: true });
  });
});
