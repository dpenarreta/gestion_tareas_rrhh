import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SessionPayload } from "@/lib/session";

// Solicitudes LOPD y Comunicados se cortaron a Django en el cutover de
// stack (Fases 45/44, ver docs/AUDIT_LOG.md § 2026-08-24/2026-08-21) —
// mockeado con `@/lib/djangoSession`, ningún consumidor de Prisma queda en
// este archivo.
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
const { GET: requestsGET, POST: requestsPOST } = await import("@/app/api/data-requests/route");
const { PATCH: requestPATCH } = await import("@/app/api/data-requests/[id]/route");
const { GET: myDataGET } = await import("@/app/api/data-requests/my-data/route");
const { GET: announcementsGET, POST: announcementsPOST } = await import("@/app/api/announcements/route");
const { DELETE: announcementDELETE } = await import("@/app/api/announcements/[id]/route");

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

function ctx(id = "1") {
  return { params: Promise.resolve({ id }) };
}

function jsonRequest(body: unknown) {
  return { json: async () => body } as never;
}

function badJsonRequest() {
  return { json: async () => { throw new Error("bad"); } } as never;
}

function resetAll() {
  djangoApiFetch.mockReset();
  vi.mocked(getSession).mockReset();
}

function djangoResponse(ok: boolean, data: unknown, status = ok ? 200 : 400) {
  return { ok, status, json: async () => data } as Response;
}

const DJANGO_REQUEST_FIXTURE = {
  id: 1, user_id: 7, type: "RECTIFICACION", description: "Cambiar mi nombre", status: "PENDIENTE",
  resolved_by_id: null, resolved_at: null, created_at: "2026-08-01T00:00:00Z",
  user: { id: 7, username: "ana", first_name: "Ana", email: "ana@nexo.com", roles: [{ id: 1, name: "ASISTENTE_GH" }] },
  resolver: null,
};

describe("GET /api/data-requests", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await requestsGET();
    expect(res.status).toBe(401);
  });

  it("mapea la lista de Django a la forma Nexo (ids como string)", async () => {
    mockSession({ role: "ADMINISTRADOR" });
    djangoApiFetch.mockResolvedValue(djangoResponse(true, [DJANGO_REQUEST_FIXTURE]));
    const res = await requestsGET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body[0]).toMatchObject({ id: "1", userId: "7", resolvedBy: null, user: { id: "7", name: "Ana" } });
    expect(djangoApiFetch).toHaveBeenCalledWith("/data-requests/");
  });
});

describe("POST /api/data-requests", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await requestsPOST(jsonRequest({}));
    expect(res.status).toBe(401);
  });

  it("responde 400 si el body no es JSON válido", async () => {
    mockSession({});
    const res = await requestsPOST(badJsonRequest());
    expect(res.status).toBe(400);
    expect(djangoApiFetch).not.toHaveBeenCalled();
  });

  it("responde 400 con Django ante un tipo de solicitud inválido", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(false, { error: "Tipo de solicitud inválido" }, 400));
    const res = await requestsPOST(jsonRequest({ type: "OTRO" }));
    expect(res.status).toBe(400);
  });

  it("crea la solicitud y mapea la respuesta (visibilidad/notificación a admins ya resueltas en Django)", async () => {
    mockSession({ name: "Ana" });
    djangoApiFetch.mockResolvedValue(djangoResponse(true, { ...DJANGO_REQUEST_FIXTURE, user: undefined, resolver: undefined }, 201));
    const res = await requestsPOST(jsonRequest({ type: "RECTIFICACION", description: "Cambiar mi nombre" }));
    expect(res.status).toBe(201);
    expect(djangoApiFetch).toHaveBeenCalledWith(
      "/data-requests/",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ type: "RECTIFICACION", description: "Cambiar mi nombre" }) })
    );
    const body = await res.json();
    expect(body).toMatchObject({ id: "1", type: "RECTIFICACION" });
  });
});

describe("PATCH /api/data-requests/[id]", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await requestPATCH(jsonRequest({}), ctx());
    expect(res.status).toBe(401);
  });

  it("responde 403 si quien resuelve no es Administrador", async () => {
    mockSession({ role: "JEFE_NACIONAL" });
    djangoApiFetch.mockResolvedValue(djangoResponse(false, { error: "Sin permisos" }, 403));
    const res = await requestPATCH(jsonRequest({ status: "RESUELTA" }), ctx());
    expect(res.status).toBe(403);
  });

  it("responde 400 si el body no es JSON válido", async () => {
    mockSession({ role: "ADMINISTRADOR" });
    const res = await requestPATCH(badJsonRequest(), ctx());
    expect(res.status).toBe(400);
    expect(djangoApiFetch).not.toHaveBeenCalled();
  });

  it("responde 400 con Django ante un estado inválido", async () => {
    mockSession({ role: "ADMINISTRADOR" });
    djangoApiFetch.mockResolvedValue(djangoResponse(false, { error: "Estado inválido" }, 400));
    const res = await requestPATCH(jsonRequest({ status: "CANCELADA" }), ctx());
    expect(res.status).toBe(400);
  });

  it("responde 404 si la solicitud no existe", async () => {
    mockSession({ role: "ADMINISTRADOR" });
    djangoApiFetch.mockResolvedValue(djangoResponse(false, { error: "Solicitud no encontrada" }, 404));
    const res = await requestPATCH(jsonRequest({ status: "EN_PROCESO" }), ctx());
    expect(res.status).toBe(404);
  });

  it("marca RESUELTA y mapea resolvedBy/resolvedAt", async () => {
    mockSession({ role: "ADMINISTRADOR", userId: "admin-1" });
    djangoApiFetch.mockResolvedValue(
      djangoResponse(true, { ...DJANGO_REQUEST_FIXTURE, status: "RESUELTA", resolved_by_id: 9, resolved_at: "2026-08-02T00:00:00Z" })
    );
    const res = await requestPATCH(jsonRequest({ status: "RESUELTA" }), ctx("1"));
    expect(res.status).toBe(200);
    expect(djangoApiFetch).toHaveBeenCalledWith("/data-requests/1/", expect.objectContaining({ method: "PATCH", body: JSON.stringify({ status: "RESUELTA" }) }));
    const body = await res.json();
    expect(body).toMatchObject({ status: "RESUELTA", resolvedBy: "9", resolvedAt: "2026-08-02T00:00:00Z" });
  });
});

describe("GET /api/data-requests/my-data", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await myDataGET();
    expect(res.status).toBe(401);
  });

  it("responde 401 si Django no tiene sesión disponible", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(null);
    const res = await myDataGET();
    expect(res.status).toBe(401);
  });

  it("mapea el export de Django (snake_case) a la forma Nexo y arma la descarga", async () => {
    mockSession({ userId: "u1" });
    djangoApiFetch.mockResolvedValue(
      djangoResponse(true, {
        generado_el: "2026-08-24T00:00:00Z",
        usuario: { id: 7, username: "ana", first_name: "Ana", email: "ana@nexo.com", roles: ["ASISTENTE_GH"], last_login: null, created_at: "2026-01-01T00:00:00Z" },
        tareas: [{ id: 1, title: "T", description: "d", status: "PENDIENTE", priority: "ALTA", frequency: "UNICA", type: "FIJA", start_date: "2026-01-01", end_date: "2026-01-05", estimated_hours: 5, real_hours: 3, progress: 50, completed_at: null, created_at: "2026-01-01T00:00:00Z" }],
        actividades: [],
        comentarios: [],
        reuniones_organizadas: [],
        reuniones_invitado: [],
        ideas_propuestas: [],
        votos_en_ideas: [],
        solicitudes_previas: [],
      })
    );

    const res = await myDataGET();
    expect(res.status).toBe(200);
    expect(djangoApiFetch).toHaveBeenCalledWith("/data-requests/my-data/");
    expect(res.headers.get("Content-Disposition")).toContain("nexo-mis-datos-u1.json");

    const body = JSON.parse(await res.text());
    expect(body.usuario).toMatchObject({ id: "7", name: "Ana", role: "ASISTENTE_GH" });
    expect(body.tareas[0]).toMatchObject({ id: "1", estimatedHours: 5, realHours: 3 });
  });
});

const DJANGO_ANNOUNCEMENT_FIXTURE = {
  id: 1, title: "Aviso", content: "Contenido", authorId: 5, author: { name: "Ana", role: "ADMINISTRADOR" },
  pinned: false, expiresAt: "2026-09-01T00:00:00Z", createdAt: "2026-08-01T00:00:00Z",
};

describe("GET /api/announcements", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await announcementsGET();
    expect(res.status).toBe(401);
  });

  it("mapea la lista de Django a la forma Nexo (ids como string)", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(true, [DJANGO_ANNOUNCEMENT_FIXTURE]));
    const res = await announcementsGET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body[0]).toMatchObject({ id: "1", authorId: "5", author: { name: "Ana", role: "ADMINISTRADOR" } });
    expect(djangoApiFetch).toHaveBeenCalledWith("/announcements/");
  });
});

describe("POST /api/announcements", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await announcementsPOST(jsonRequest({}));
    expect(res.status).toBe(401);
  });

  it("responde 403 para un rol sin permiso de publicación", async () => {
    mockSession({ role: "COORDINADOR_ZS" });
    djangoApiFetch.mockResolvedValue(djangoResponse(false, { error: "Sin permisos" }, 403));
    const res = await announcementsPOST(jsonRequest({}));
    expect(res.status).toBe(403);
  });

  it("responde 400 con el mensaje de Django si faltan campos requeridos", async () => {
    mockSession({ role: "ADMINISTRADOR" });
    djangoApiFetch.mockResolvedValue(djangoResponse(false, { error: "Faltan campos requeridos" }, 400));
    const res = await announcementsPOST(jsonRequest({ title: "Aviso" }));
    expect(res.status).toBe(400);
  });

  it("publica el comunicado y mapea la respuesta (recorte de duración/notificación ya resueltos en Django)", async () => {
    mockSession({ role: "ADMINISTRADOR" });
    djangoApiFetch.mockResolvedValue(djangoResponse(true, DJANGO_ANNOUNCEMENT_FIXTURE, 201));
    const res = await announcementsPOST(jsonRequest({ title: "Aviso", content: "Contenido", durationDays: 7 }));
    expect(res.status).toBe(201);
    expect(djangoApiFetch).toHaveBeenCalledWith(
      "/announcements/",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ title: "Aviso", content: "Contenido", durationDays: 7, pinned: undefined }) })
    );
    const body = await res.json();
    expect(body).toMatchObject({ id: "1" });
  });
});

describe("DELETE /api/announcements/[id]", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await announcementDELETE(jsonRequest(undefined), ctx("1"));
    expect(res.status).toBe(401);
  });

  it("responde 403 para un rol sin permiso de eliminación", async () => {
    mockSession({ role: "COORDINADOR_ZS" });
    djangoApiFetch.mockResolvedValue(djangoResponse(false, { error: "Sin permisos" }, 403));
    const res = await announcementDELETE(jsonRequest(undefined), ctx("1"));
    expect(res.status).toBe(403);
  });

  it("elimina el comunicado para un rol autorizado", async () => {
    mockSession({ role: "JEFE_NACIONAL" });
    djangoApiFetch.mockResolvedValue(djangoResponse(true, { ok: true }));
    const res = await announcementDELETE(jsonRequest(undefined), ctx("1"));
    expect(res.status).toBe(200);
    expect(djangoApiFetch).toHaveBeenCalledWith("/announcements/1/", { method: "DELETE" });
  });
});
