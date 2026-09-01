import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SessionPayload } from "@/lib/session";

// Cutover de stack (ver docs/AUDIT_LOG.md § 2026-08-21): esta ruta pasó de
// Prisma a Django (Fase 42) — mockeado con `@/lib/djangoSession`, mismo
// patrón que el resto de este cutover. Zoom (real/simulado) y la
// notificación a los invitados ya viven en `apps.meetings.services.create_meeting`
// del lado Django, sin equivalente que mockear acá.
vi.mock("@/lib/session", () => ({ getSession: vi.fn() }));

const djangoApiFetch = vi.fn();
vi.mock("@/lib/djangoSession", () => ({
  djangoApiFetch: (...args: unknown[]) => djangoApiFetch(...args),
}));

const { getSession } = await import("@/lib/session");
const { GET: meetingsGET, POST: meetingsPOST } = await import("@/app/api/meetings/route");
const { GET: meetingGET, PATCH: meetingPATCH, DELETE: meetingDELETE } = await import("@/app/api/meetings/[id]/route");

const DJANGO_USER_REF = { id: 1, username: "ana", first_name: "Ana", email: "ana@nexo.com", roles: [{ id: 1, name: "JEFE_NACIONAL" }] };

const DJANGO_MEETING_FIXTURE = {
  id: 1,
  title: "Reunión",
  description: null,
  host: DJANGO_USER_REF,
  meeting_date: "2026-08-01T15:00:00Z",
  duration: 40,
  zoom_meeting_id: "123",
  zoom_join_url: "https://zoom.us/j/123",
  zoom_password: "ABC123",
  status: "PROGRAMADA",
  otter_invited: false,
  otter_summary: null,
  otter_transcript_url: null,
  created_at: "2026-07-01T00:00:00Z",
  updated_at: "2026-07-01T00:00:00Z",
  invitees: [],
};

function mockSession(overrides: Partial<SessionPayload> | null) {
  vi.mocked(getSession).mockResolvedValue(
    overrides === null
      ? null
      : {
          djangoUserId: 1,
          permissions: [],
          role: "JEFE_NACIONAL",
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

describe("GET /api/meetings", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await meetingsGET();
    expect(res.status).toBe(401);
  });

  it("mapea la lista de Django a la forma Nexo (camelCase, ids como string)", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(true, [DJANGO_MEETING_FIXTURE]));
    const res = await meetingsGET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body[0]).toMatchObject({
      id: "1",
      title: "Reunión",
      hostId: "1",
      host: { id: "1", name: "Ana", role: "JEFE_NACIONAL" },
      meetingDate: "2026-08-01T15:00:00Z",
    });
    expect(djangoApiFetch).toHaveBeenCalledWith("/meetings/");
  });
});

describe("POST /api/meetings", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await meetingsPOST(jsonRequest({}));
    expect(res.status).toBe(401);
    expect(djangoApiFetch).not.toHaveBeenCalled();
  });

  it("responde 403 si Django rechaza por permisos de creación", async () => {
    mockSession({ role: "ASISTENTE_GH" });
    djangoApiFetch.mockResolvedValue(djangoResponse(false, { error: "Sin permisos para crear reuniones" }, 403));
    const res = await meetingsPOST(jsonRequest({ title: "Reunión" }));
    expect(res.status).toBe(403);
  });

  it("responde 400 si el body no es JSON válido", async () => {
    mockSession({ role: "JEFE_NACIONAL" });
    const badRequest = { json: async () => { throw new Error("bad"); } } as never;
    const res = await meetingsPOST(badRequest);
    expect(res.status).toBe(400);
    expect(djangoApiFetch).not.toHaveBeenCalled();
  });

  it("responde 400 con el mensaje de Django si faltan campos requeridos", async () => {
    mockSession({ role: "JEFE_NACIONAL" });
    djangoApiFetch.mockResolvedValue(djangoResponse(false, { error: "Faltan campos requeridos" }, 400));
    const res = await meetingsPOST(jsonRequest({ title: "Reunión" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Faltan campos requeridos");
  });

  it("mapea inviteeIds a invitee_ids numéricos y crea la reunión, incluyendo zoomWarning", async () => {
    mockSession({ role: "JEFE_NACIONAL" });
    djangoApiFetch.mockResolvedValue(djangoResponse(true, { ...DJANGO_MEETING_FIXTURE, zoom_warning: null }, 201));

    const res = await meetingsPOST(
      jsonRequest({ title: "Reunión", meetingDate: "2026-08-01T15:00:00Z", duration: 30, inviteeIds: ["2", "3"] })
    );
    expect(res.status).toBe(201);
    expect(djangoApiFetch).toHaveBeenCalledWith(
      "/meetings/",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          title: "Reunión",
          description: null,
          meeting_date: "2026-08-01T15:00:00Z",
          duration: 30,
          invitee_ids: [2, 3],
        }),
      })
    );
    const body = await res.json();
    expect(body.zoomWarning).toBeNull();
  });

  it("si Zoom falló del lado Django, propaga zoomWarning igual con éxito", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(
      djangoResponse(true, { ...DJANGO_MEETING_FIXTURE, zoom_warning: "No se pudo conectar con Zoom. Se generó un enlace simulado." }, 201)
    );
    const res = await meetingsPOST(jsonRequest({ title: "Reunión", meetingDate: "2026-08-01T15:00:00Z", duration: 30 }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.zoomWarning).toMatch(/enlace simulado/);
  });

  it("sin inviteeIds, manda invitee_ids vacío", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(true, { ...DJANGO_MEETING_FIXTURE, zoom_warning: null }, 201));
    await meetingsPOST(jsonRequest({ title: "Reunión", meetingDate: "2026-08-01T15:00:00Z", duration: 30 }));
    expect(djangoApiFetch).toHaveBeenCalledWith(
      "/meetings/",
      expect.objectContaining({ body: expect.stringContaining('"invitee_ids":[]') })
    );
  });
});

describe("GET /api/meetings/[id]", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await meetingGET(req(), ctx());
    expect(res.status).toBe(401);
  });

  it("responde 404 si la reunión no existe", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(false, { error: "No encontrada" }, 404));
    const res = await meetingGET(req(), ctx());
    expect(res.status).toBe(404);
  });

  it("responde 403 si el usuario no es anfitrión ni invitado", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(false, { error: "Sin acceso" }, 403));
    const res = await meetingGET(req(), ctx());
    expect(res.status).toBe(403);
  });

  it("un invitado (no anfitrión) puede ver la reunión", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(true, DJANGO_MEETING_FIXTURE));
    const res = await meetingGET(req(), ctx());
    expect(res.status).toBe(200);
  });
});

describe("PATCH /api/meetings/[id]", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await meetingPATCH(jsonRequest({}), ctx());
    expect(res.status).toBe(401);
  });

  it("responde 404 si la reunión no existe", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(false, { error: "No encontrada" }, 404));
    const res = await meetingPATCH(jsonRequest({}), ctx());
    expect(res.status).toBe(404);
  });

  it("responde 403 si quien edita no es el anfitrión", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(false, { error: "Solo el anfitrión puede editar la reunión" }, 403));
    const res = await meetingPATCH(jsonRequest({ title: "x" }), ctx());
    expect(res.status).toBe(403);
  });

  it("solo envía a Django los campos permitidos, mapeados a snake_case", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(true, DJANGO_MEETING_FIXTURE));

    await meetingPATCH(
      jsonRequest({ title: "Nuevo título", meetingDate: "2026-09-01T10:00:00Z", noPermitido: "x" }),
      ctx("1")
    );
    expect(djangoApiFetch).toHaveBeenCalledWith(
      "/meetings/1/",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ title: "Nuevo título", meeting_date: "2026-09-01T10:00:00Z" }),
      })
    );
  });
});

describe("DELETE /api/meetings/[id]", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await meetingDELETE(req(), ctx());
    expect(res.status).toBe(401);
  });

  it("responde 404 si la reunión no existe", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(false, { error: "No encontrada" }, 404));
    const res = await meetingDELETE(req(), ctx());
    expect(res.status).toBe(404);
  });

  it("responde 403 si quien elimina no es el anfitrión", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(false, { error: "Solo el anfitrión puede eliminar la reunión" }, 403));
    const res = await meetingDELETE(req(), ctx());
    expect(res.status).toBe(403);
  });

  it("el anfitrión puede eliminar la reunión", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(true, { ok: true }));
    const res = await meetingDELETE(req(), ctx());
    expect(res.status).toBe(200);
  });
});
