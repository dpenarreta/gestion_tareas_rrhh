import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SessionPayload } from "@/lib/session";
import type { NextRequest } from "next/server";

// Fase 7g de la migración de stack (ver docs/AUDIT_LOG.md § 2026-08-18):
// GET/POST /api/desk-notes, GET /api/desk-notes/recipients,
// GET /api/desk-notes/[id]/history y GET /api/desk-notes/[id]/attachment
// pasaron de Prisma a Django — ninguna tenía cobertura de Vitest previa
// (el TS legacy nunca las testeó en este archivo). La lógica real ya vive
// en `DeskNoteViewSet`, cubierta en `backend/apps/desk/tests/`; acá solo
// se cubre lo que el wrapper de Next.js realmente hace.
const getSession = vi.fn();
vi.mock("@/lib/session", () => ({ getSession: (...args: unknown[]) => getSession(...args) }));

const djangoApiFetch = vi.fn();
vi.mock("@/lib/djangoSession", () => ({
  djangoApiFetch: (...args: unknown[]) => djangoApiFetch(...args),
}));

const { GET: listGET, POST: createPOST } = await import("@/app/api/desk-notes/route");
const { GET: recipientsGET } = await import("@/app/api/desk-notes/recipients/route");
const { GET: historyGET } = await import("@/app/api/desk-notes/[id]/history/route");
const { GET: attachmentGET } = await import("@/app/api/desk-notes/[id]/attachment/route");

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
    is_mine: true, reply_count: 0, has_attachment: false, attachment_name: null, attachment_mime: null,
    converted_to_reminder_id: null, converted_at: null,
    ...overrides,
  };
}

async function formDataRequest(fields: Record<string, string>, file?: File): Promise<NextRequest> {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) formData.set(key, value);
  if (file) formData.set("file", file);
  return { formData: async () => formData } as unknown as NextRequest;
}

describe("GET /api/desk-notes", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await listGET(getRequest("http://localhost/api/desk-notes"));
    expect(res.status).toBe(401);
  });

  it("responde 401 si Django no tiene sesión disponible", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(null);
    const res = await listGET(getRequest("http://localhost/api/desk-notes"));
    expect(res.status).toBe(401);
  });

  it("responde 403 para Administrador", async () => {
    mockSession({ role: "ADMINISTRADOR" });
    djangoApiFetch.mockResolvedValue(djangoResponse(false, {}, 403));
    const res = await listGET(getRequest("http://localhost/api/desk-notes"));
    expect(res.status).toBe(403);
  });

  it("reenvía view/limit como query string y devuelve las notas mapeadas", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(true, [djangoNote()]));
    const res = await listGET(getRequest("http://localhost/api/desk-notes?view=archive&limit=10"));
    expect(djangoApiFetch).toHaveBeenCalledWith("/desk-notes/?view=archive&limit=10");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body[0]).toMatchObject({ id: "1", message: "Revisar el contrato" });
  });

  it("sin query params, no agrega query string", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(true, []));
    await listGET(getRequest("http://localhost/api/desk-notes"));
    expect(djangoApiFetch).toHaveBeenCalledWith("/desk-notes/");
  });
});

describe("POST /api/desk-notes", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await createPOST(await formDataRequest({ recipientId: "2", message: "hola" }));
    expect(res.status).toBe(401);
  });

  it("responde 400 si faltan campos requeridos, sin consultar Django", async () => {
    mockSession({});
    const res = await createPOST(await formDataRequest({ message: "hola" }));
    expect(res.status).toBe(400);
    expect(djangoApiFetch).not.toHaveBeenCalled();
  });

  it("responde 403 si Django rechaza (ej. destinatario inválido)", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(false, {}, 403));
    const res = await createPOST(await formDataRequest({ recipientId: "2", message: "hola" }));
    expect(res.status).toBe(403);
  });

  it("responde 400 con el mensaje de Django ante una validación rechazada", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(
      djangoResponse(false, { error: { details: { recipient: ["No puedes dejarte una nota a ti mismo"] } } }, 400)
    );
    const res = await createPOST(await formDataRequest({ recipientId: "1", message: "hola" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("No puedes dejarte una nota a ti mismo");
  });

  it("sin adjunto: manda recipient numérico y message, sin tocar los campos de adjunto", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(true, djangoNote(), 201));
    await createPOST(await formDataRequest({ recipientId: "2", message: "hola" }));
    expect(djangoApiFetch).toHaveBeenCalledWith(
      "/desk-notes/",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          recipient: 2, message: "hola", priority: undefined, color: undefined,
          attachment_name: null, attachment_mime: null, attachment_data: null,
        }),
      })
    );
  });

  it("con adjunto: codifica el File recibido por FormData a data URL antes de reenviarlo a Django", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(true, djangoNote({ has_attachment: true }), 201));
    const file = new File(["contenido"], "captura.png", { type: "image/png" });

    await createPOST(await formDataRequest({ recipientId: "2", message: "hola" }, file));

    const call = djangoApiFetch.mock.calls[0];
    const sentBody = JSON.parse(call[1].body as string);
    expect(sentBody.attachment_name).toBe("captura.png");
    expect(sentBody.attachment_mime).toBe("image/png");
    expect(sentBody.attachment_data).toMatch(/^data:image\/png;base64,/);
  });

  it("responde 201 con la nota creada mapeada a la forma Nexo", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(true, djangoNote({ id: 9 }), 201));
    const res = await createPOST(await formDataRequest({ recipientId: "2", message: "hola" }));
    expect(res.status).toBe(201);
    expect((await res.json()).id).toBe("9");
  });
});

describe("GET /api/desk-notes/recipients", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await recipientsGET();
    expect(res.status).toBe(401);
  });

  it("devuelve los destinatarios mapeados a la forma Nexo", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(true, [{ id: 2, name: "Bea", role: "ASISTENTE_GH" }]));
    const res = await recipientsGET();
    expect(await res.json()).toEqual([{ id: "2", name: "Bea", role: "ASISTENTE_GH" }]);
  });
});

describe("GET /api/desk-notes/[id]/history", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await historyGET(getRequest("http://localhost"), ctx());
    expect(res.status).toBe(401);
  });

  it("responde 404 si la nota no existe", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(false, {}, 404));
    const res = await historyGET(getRequest("http://localhost"), ctx());
    expect(res.status).toBe(404);
  });

  it("devuelve los eventos de auditoría mapeados a la forma Nexo", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(
      djangoResponse(true, [{ id: 1, action: "CREATED", metadata: null, created_at: "2026-07-23T10:00:00Z" }])
    );
    const res = await historyGET(getRequest("http://localhost"), ctx("1"));
    expect(await res.json()).toEqual([{ id: "1", action: "CREATED", metadata: null, createdAt: "2026-07-23T10:00:00Z" }]);
  });
});

describe("GET /api/desk-notes/[id]/attachment", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await attachmentGET(getRequest("http://localhost"), ctx());
    expect(res.status).toBe(401);
  });

  it("responde 404 si no hay adjunto o la nota no existe", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue({ ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) } as Response);
    const res = await attachmentGET(getRequest("http://localhost"), ctx());
    expect(res.status).toBe(404);
  });

  it("responde 403 si no es participante de la nota", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue({ ok: false, status: 403, arrayBuffer: async () => new ArrayBuffer(0) } as Response);
    const res = await attachmentGET(getRequest("http://localhost"), ctx());
    expect(res.status).toBe(403);
  });

  it("devuelve el archivo con los headers que entrega Django", async () => {
    mockSession({});
    const bytes = new TextEncoder().encode("contenido").buffer;
    djangoApiFetch.mockResolvedValue({
      ok: true,
      arrayBuffer: async () => bytes,
      headers: new Headers({ "Content-Type": "image/png", "Content-Disposition": 'attachment; filename="captura.png"' }),
    } as Response);

    const res = await attachmentGET(getRequest("http://localhost"), ctx());
    expect(res.headers.get("Content-Type")).toBe("image/png");
    expect(res.headers.get("Content-Disposition")).toContain("captura.png");
    expect((await res.arrayBuffer()).byteLength).toBeGreaterThan(0);
  });
});
