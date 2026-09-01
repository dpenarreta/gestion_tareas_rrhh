import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SessionPayload } from "@/lib/session";
import type { NextRequest } from "next/server";

// Cutover de stack (ver docs/AUDIT_LOG.md § 2026-08-21): estas rutas pasaron
// de Prisma a Django (Fase 43) — mockeado con `@/lib/djangoSession`. La
// visibilidad/notificación a revisores/adjunto ya viven en
// `apps.ideas.services`, cubierto por la suite de Django — acá solo se
// prueba ruteo, mapeo de campos y el encoding del adjunto a data: URL.
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
const { GET: ideasGET, POST: ideasPOST } = await import("@/app/api/ideas/route");
const { GET: ideaGET, PATCH: ideaPATCH } = await import("@/app/api/ideas/[id]/route");
const { GET: historyGET } = await import("@/app/api/ideas/[id]/history/route");
const { POST: votePOST } = await import("@/app/api/ideas/[id]/vote/route");

const DJANGO_USER_REF = { id: 1, username: "ana", first_name: "Ana", email: "ana@nexo.com", roles: [{ id: 1, name: "ASISTENTE_GH" }] };

function mockSession(overrides: Partial<SessionPayload> | null) {
  vi.mocked(getSession).mockResolvedValue(
    overrides === null
      ? null
      : {
          djangoUserId: 1,
          permissions: [],
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

function jsonRequest(body: unknown) {
  return { json: async () => body } as never;
}

function req() {
  return {} as never;
}

function resetAll() {
  vi.mocked(getSession).mockReset();
  djangoApiFetch.mockReset();
}

function djangoResponse(ok: boolean, data: unknown, status = ok ? 200 : 400) {
  return { ok, status, json: async () => data } as Response;
}

describe("GET /api/ideas", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await ideasGET();
    expect(res.status).toBe(401);
  });

  it("mapea la lista de Django a la forma Nexo", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(
      djangoResponse(true, [
        {
          id: 1, title: "Idea", description: "desc", impact: "ALTO", status: "PROPUESTA", progress: 0,
          attachment_name: null, attachment_mime: null, created_at: "2026-08-01T00:00:00Z", updated_at: "2026-08-01T00:00:00Z",
          author: DJANGO_USER_REF, latest_rejection_comment: "no cumple", vote_count: 3, voted_by_me: true,
        },
      ])
    );
    const res = await ideasGET();
    const body = await res.json();
    expect(body[0]).toMatchObject({ id: "1", latestRejectionComment: "no cumple", voteCount: 3, votedByMe: true });
    expect(djangoApiFetch).toHaveBeenCalledWith("/ideas/");
  });
});

function ideaFormData(fields: Record<string, string | File>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

const DJANGO_IDEA_FIXTURE = {
  id: 1, title: "Idea", description: "desc", impact: "ALTO", status: "PROPUESTA", progress: 0,
  attachment_name: null, attachment_mime: null, created_at: "2026-08-01T00:00:00Z", updated_at: "2026-08-01T00:00:00Z",
  author: DJANGO_USER_REF, vote_count: 0, voted_by_me: false,
};

describe("POST /api/ideas", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await ideasPOST({ formData: async () => new FormData() } as unknown as NextRequest);
    expect(res.status).toBe(401);
  });

  it("responde 400 con el mensaje de Django si faltan campos o el impacto es inválido", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(false, { error: "Faltan campos requeridos o son inválidos" }, 400));
    const res = await ideasPOST({
      formData: async () => ideaFormData({ title: "Idea", description: "desc", impact: "URGENTE" }),
    } as unknown as NextRequest);
    expect(res.status).toBe(400);
  });

  it("crea la idea sin adjunto cuando no se envía archivo", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(true, DJANGO_IDEA_FIXTURE, 201));

    const res = await ideasPOST({
      formData: async () => ideaFormData({ title: "Idea", description: "desc", impact: "ALTO" }),
    } as unknown as NextRequest);
    expect(res.status).toBe(201);
    expect(djangoApiFetch).toHaveBeenCalledWith(
      "/ideas/",
      expect.objectContaining({
        body: JSON.stringify({
          title: "Idea", description: "desc", impact: "ALTO",
          attachment_name: null, attachment_mime: null, attachment_data: null,
        }),
      })
    );
  });

  it("codifica el archivo adjunto como data: URL antes de mandarlo a Django", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(true, DJANGO_IDEA_FIXTURE, 201));
    const file = new File([new Uint8Array([1, 2, 3])], "adjunto.pdf", { type: "application/pdf" });

    await ideasPOST({
      formData: async () => ideaFormData({ title: "Idea", description: "desc", impact: "ALTO", file }),
    } as unknown as NextRequest);

    const [, init] = djangoApiFetch.mock.calls[0];
    const sentBody = JSON.parse(init.body as string);
    expect(sentBody.attachment_name).toBe("adjunto.pdf");
    expect(sentBody.attachment_mime).toBe("application/pdf");
    expect(sentBody.attachment_data).toMatch(/^data:application\/pdf;base64,/);
  });
});

describe("GET /api/ideas/[id]", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await ideaGET(req(), ctx());
    expect(res.status).toBe(401);
  });

  it("responde 404 si la idea no existe o no es visible (IDOR)", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(false, { error: "Idea no encontrada" }, 404));
    const res = await ideaGET(req(), ctx());
    expect(res.status).toBe(404);
  });

  it("mapea el detalle incluyendo historial y adjunto", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(
      djangoResponse(true, {
        ...DJANGO_IDEA_FIXTURE,
        attachment_data: "data:application/pdf;base64,xxx",
        history: [{ id: 1, from_status: "PROPUESTA", to_status: "EN_REVISION", comment: null, created_at: "2026-08-02T00:00:00Z", changer: DJANGO_USER_REF }],
      })
    );
    const res = await ideaGET(req(), ctx());
    const body = await res.json();
    expect(body.attachmentData).toBe("data:application/pdf;base64,xxx");
    expect(body.history).toHaveLength(1);
    expect(body.history[0]).toMatchObject({ fromStatus: "PROPUESTA", toStatus: "EN_REVISION" });
  });
});

describe("PATCH /api/ideas/[id]", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await ideaPATCH(jsonRequest({ progress: 50 }), ctx());
    expect(res.status).toBe(401);
  });

  it("responde 403 para un rol sin permiso de revisión de ideas", async () => {
    mockSession({ role: "ASISTENTE_GH" });
    djangoApiFetch.mockResolvedValue(djangoResponse(false, { error: "Sin permisos para actualizar el progreso" }, 403));
    const res = await ideaPATCH(jsonRequest({ progress: 50 }), ctx());
    expect(res.status).toBe(403);
  });

  it("responde 400 ante un progreso inválido", async () => {
    mockSession({ role: "JEFE_NACIONAL" });
    djangoApiFetch.mockResolvedValue(djangoResponse(false, { error: "Progreso inválido (debe ser un entero entre 0 y 100)" }, 400));
    const res = await ideaPATCH(jsonRequest({ progress: 200 }), ctx());
    expect(res.status).toBe(400);
  });

  it("actualiza el progreso y devuelve voteCount/votedByMe", async () => {
    mockSession({ role: "JEFE_NACIONAL" });
    djangoApiFetch.mockResolvedValue(
      djangoResponse(true, { ...DJANGO_IDEA_FIXTURE, progress: 75, vote_count: 2, history: [] })
    );
    const res = await ideaPATCH(jsonRequest({ progress: 75 }), ctx());
    expect(res.status).toBe(200);
    expect(djangoApiFetch).toHaveBeenCalledWith("/ideas/1/", expect.objectContaining({ method: "PATCH", body: JSON.stringify({ progress: 75 }) }));
    const body = await res.json();
    expect(body).toMatchObject({ progress: 75, voteCount: 2, votedByMe: false });
  });
});

describe("GET /api/ideas/[id]/history", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await historyGET(req(), ctx());
    expect(res.status).toBe(401);
  });

  it("responde 404 (IDOR) fuera de la visibilidad", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(false, { error: "Idea no encontrada" }, 404));
    const res = await historyGET(req(), ctx());
    expect(res.status).toBe(404);
  });

  it("devuelve el historial mapeado", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(
      djangoResponse(true, [{ id: 1, from_status: "PROPUESTA", to_status: "EN_REVISION", comment: null, created_at: "2026-08-02T00:00:00Z", changer: DJANGO_USER_REF }])
    );
    const res = await historyGET(req(), ctx());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body[0]).toMatchObject({ fromStatus: "PROPUESTA", toStatus: "EN_REVISION" });
  });
});

describe("POST /api/ideas/[id]/vote", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await votePOST(req(), ctx());
    expect(res.status).toBe(401);
  });

  it("responde 404 (IDOR) fuera de la visibilidad", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(false, { error: "Idea no encontrada" }, 404));
    const res = await votePOST(req(), ctx());
    expect(res.status).toBe(404);
  });

  it("mapea el toggle de voto a camelCase", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(true, { vote_count: 4, voted_by_me: true }));
    const res = await votePOST(req(), ctx());
    expect(await res.json()).toEqual({ voteCount: 4, votedByMe: true });
  });
});
