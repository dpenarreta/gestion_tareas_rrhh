import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SessionPayload } from "@/lib/session";
import type { NextRequest } from "next/server";

// Fase 7g de la migración de stack (ver docs/AUDIT_LOG.md § 2026-08-18):
// todas estas rutas pasaron de Prisma a Django — sin gaps (Recordatorios
// no tiene Papelera, es borrado físico ya resuelto en la Fase 7b). La
// lógica real (completar/posponer/reabrir/archivar, generación de la
// siguiente ocurrencia, filtros) ya vive en `DeskReminderViewSet`/
// `PersonalReminderService`, cubierta en `backend/apps/desk/tests/`.
const getSession = vi.fn();
vi.mock("@/lib/session", () => ({ getSession: (...args: unknown[]) => getSession(...args) }));

const djangoApiFetch = vi.fn();
vi.mock("@/lib/djangoSession", () => ({
  djangoApiFetch: (...args: unknown[]) => djangoApiFetch(...args),
}));

const { GET, POST } = await import("@/app/api/desk-reminders/route");
const { PATCH, DELETE } = await import("@/app/api/desk-reminders/[id]/route");
const { GET: historyGET } = await import("@/app/api/desk-reminders/[id]/history/route");

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

function getRequest(url: string): NextRequest {
  return { url } as unknown as NextRequest;
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

function djangoReminder(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1, title: "Llamar a Finanzas", description: null, due_at: "2026-08-01T10:00:00Z", priority: "MEDIA",
    status: "PENDIENTE", repeat: "UNA_VEZ", completed_at: null, archived: false, archived_at: null,
    converted_to_task_id: null, converted_to_task_at: null, has_attachment: false, attachment_name: null,
    attachment_mime: null, created_at: "2026-07-20T10:00:00Z",
    ...overrides,
  };
}

describe("GET /api/desk-reminders", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await GET(getRequest("http://localhost/api/desk-reminders"));
    expect(res.status).toBe(401);
  });

  it("responde 403 para Administrador", async () => {
    mockSession({ role: "ADMINISTRADOR" });
    djangoApiFetch.mockResolvedValue(djangoResponse(false, {}, 403));
    const res = await GET(getRequest("http://localhost/api/desk-reminders"));
    expect(res.status).toBe(403);
  });

  it("reenvía status/limit como query string y devuelve los recordatorios mapeados", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(true, [djangoReminder()]));
    const res = await GET(getRequest("http://localhost/api/desk-reminders?status=PENDIENTE&limit=5"));
    expect(djangoApiFetch).toHaveBeenCalledWith("/desk-reminders/?status=PENDIENTE&limit=5");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body[0].dueAt).toBe("2026-08-01T10:00:00Z");
  });

  it("con archived=true reenvía ese filtro", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(true, []));
    await GET(getRequest("http://localhost/api/desk-reminders?archived=true"));
    expect(djangoApiFetch).toHaveBeenCalledWith("/desk-reminders/?archived=true");
  });
});

describe("POST /api/desk-reminders", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await POST(jsonRequest({}));
    expect(res.status).toBe(401);
  });

  it("responde 400 con el mensaje de Django si faltan campos requeridos", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(false, { error: { details: { title: ["Faltan campos requeridos"] } } }, 400));
    const res = await POST(jsonRequest({ title: "Solo título" }));
    expect(res.status).toBe(400);
  });

  it("mapea dueAt->due_at y crea el recordatorio", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(true, djangoReminder(), 201));
    const res = await POST(jsonRequest({ title: "Llamar a Finanzas", dueAt: "2026-08-01T10:00:00Z" }));
    expect(res.status).toBe(201);
    expect(djangoApiFetch).toHaveBeenCalledWith(
      "/desk-reminders/",
      expect.objectContaining({ body: JSON.stringify({ title: "Llamar a Finanzas", due_at: "2026-08-01T10:00:00Z" }) })
    );
  });
});

describe("PATCH /api/desk-reminders/[id]", () => {
  beforeEach(resetAll);

  it("responde 404 si el recordatorio no existe o es de otro usuario", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(false, {}, 404));
    const res = await PATCH(jsonRequest({ action: "complete" }), ctx());
    expect(res.status).toBe(404);
  });

  it("responde 409 con el mensaje de Django al reabrir uno no completado", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(false, { error: { message: "Solo se puede reabrir un recordatorio completado" } }, 409));
    const res = await PATCH(jsonRequest({ action: "reopen" }), ctx());
    expect(res.status).toBe(409);
  });

  it("mapea dueAt->due_at para postpone/reopen", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(true, djangoReminder({ due_at: "2026-08-05T10:00:00Z" })));
    await PATCH(jsonRequest({ action: "postpone", dueAt: "2026-08-05T10:00:00Z" }), ctx("1"));
    expect(djangoApiFetch).toHaveBeenCalledWith(
      "/desk-reminders/1/",
      expect.objectContaining({ body: JSON.stringify({ action: "postpone", due_at: "2026-08-05T10:00:00Z" }) })
    );
  });

  it("edición directa de campos se reenvía tal cual (sin action)", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(true, djangoReminder({ title: "Nuevo título" })));
    const res = await PATCH(jsonRequest({ title: "Nuevo título" }), ctx("1"));
    expect(res.status).toBe(200);
    expect(djangoApiFetch).toHaveBeenCalledWith("/desk-reminders/1/", expect.objectContaining({ body: JSON.stringify({ title: "Nuevo título" }) }));
    expect((await res.json()).title).toBe("Nuevo título");
  });

  it("completar con repetición devuelve el recordatorio original mapeado (la nueva ocurrencia la crea Django, no viaja en la respuesta)", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(true, djangoReminder({ status: "COMPLETADO" })));
    const res = await PATCH(jsonRequest({ action: "complete" }), ctx("1"));
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("COMPLETADO");
  });
});

describe("DELETE /api/desk-reminders/[id]", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await DELETE(jsonRequest(undefined), ctx());
    expect(res.status).toBe(401);
  });

  it("responde 404 si pertenece a otro usuario", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(false, {}, 404));
    const res = await DELETE(jsonRequest(undefined), ctx());
    expect(res.status).toBe(404);
  });

  it("elimina el recordatorio propio", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(true, { ok: true }));
    const res = await DELETE(jsonRequest(undefined), ctx());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});

describe("GET /api/desk-reminders/[id]/history", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await historyGET(jsonRequest(undefined), ctx());
    expect(res.status).toBe(401);
  });

  it("responde 404 si el recordatorio no existe o es de otro usuario", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(false, {}, 404));
    const res = await historyGET(jsonRequest(undefined), ctx());
    expect(res.status).toBe(404);
  });

  it("devuelve los eventos de auditoría mapeados a la forma Nexo", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(
      djangoResponse(true, [
        { id: 1, action: "CREATED", metadata: null, created_at: "2026-07-22T09:10:00Z" },
        { id: 2, action: "COMPLETED", metadata: null, created_at: "2026-07-22T11:30:00Z" },
      ])
    );
    const res = await historyGET(jsonRequest(undefined), ctx("1"));
    expect(await res.json()).toEqual([
      { id: "1", action: "CREATED", metadata: null, createdAt: "2026-07-22T09:10:00Z" },
      { id: "2", action: "COMPLETED", metadata: null, createdAt: "2026-07-22T11:30:00Z" },
    ]);
  });
});
