import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SessionPayload } from "@/lib/session";

vi.mock("@/lib/session", () => ({ getSession: vi.fn() }));

// GET /api/activity-reasons (listado público) pasó de Prisma a Django en la
// Fase 3b (ver docs/AUDIT_LOG.md § 2026-08-07). POST/PATCH
// /api/settings/activity-reasons (admin) se cortaron a Django en el cutover
// de stack (ver docs/AUDIT_LOG.md § 2026-08-21): el catálogo que consume el
// resto de la app ya vivía únicamente en Django, así que el alta/edición
// desde Postgres no tenía ningún efecto visible.
const djangoApiFetch = vi.fn();
vi.mock("@/lib/djangoSession", () => ({
  djangoApiFetch: (...args: unknown[]) => djangoApiFetch(...args),
  extractDjangoFlatErrorMessage: async (response: Response) => {
    const data = await response.json().catch(() => null);
    return typeof (data as { error?: unknown })?.error === "string" ? (data as { error: string }).error : undefined;
  },
}));

const { getSession } = await import("@/lib/session");
const { POST: reasonsPOST } = await import("@/app/api/settings/activity-reasons/route");
const { PATCH: reasonPATCH } = await import("@/app/api/settings/activity-reasons/[id]/route");
const { GET: publicReasonsGET } = await import("@/app/api/activity-reasons/route");

function mockSession(overrides: Partial<SessionPayload> | null) {
  vi.mocked(getSession).mockResolvedValue(
    overrides === null
      ? null
      : {
          djangoUserId: 1,
          permissions: [],
          role: "ADMINISTRADOR",
          name: "Admin",
          email: "admin@nexo.com",
          expiresAt: new Date(Date.now() + 100000).toISOString(),
          ...overrides,
        }
  );
}

function jsonRequest(body: unknown) {
  return { json: async () => body } as never;
}

function badJsonRequest() {
  return { json: async () => { throw new Error("bad"); } } as never;
}

function ctx(id = "1") {
  return { params: Promise.resolve({ id }) };
}

function resetAll() {
  vi.mocked(getSession).mockReset();
  djangoApiFetch.mockReset();
}

function djangoResponse(ok: boolean, data: unknown, status = ok ? 200 : 400) {
  return { ok, status, json: async () => data } as Response;
}

const DJANGO_REASON = {
  id: 1,
  key: "REUNION",
  label: "Reunión",
  description: "",
  is_active: true,
  is_archived: false,
  archived_at: null,
  assigned_roles: ["ADMINISTRADOR"],
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

describe("POST /api/settings/activity-reasons", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await reasonsPOST(jsonRequest({}));
    expect(res.status).toBe(401);
  });

  it("responde 403 si el rol no es Administrador", async () => {
    mockSession({ role: "COORDINADOR_NACIONAL" });
    const res = await reasonsPOST(jsonRequest({ label: "Motivo", assignedRoles: ["ADMINISTRADOR"] }));
    expect(res.status).toBe(403);
  });

  it("responde 400 si el body no es JSON válido", async () => {
    mockSession({});
    const res = await reasonsPOST(badJsonRequest());
    expect(res.status).toBe(400);
  });

  it("responde 400 si falta el nombre", async () => {
    mockSession({});
    const res = await reasonsPOST(jsonRequest({ label: "   ", assignedRoles: ["ADMINISTRADOR"] }));
    expect(res.status).toBe(400);
    expect(djangoApiFetch).not.toHaveBeenCalled();
  });

  it("responde 400 si no hay roles válidos seleccionados", async () => {
    mockSession({});
    expect((await reasonsPOST(jsonRequest({ label: "Motivo", assignedRoles: [] }))).status).toBe(400);
    expect((await reasonsPOST(jsonRequest({ label: "Motivo", assignedRoles: ["NO_EXISTE"] }))).status).toBe(400);
    expect(djangoApiFetch).not.toHaveBeenCalled();
  });

  it("responde 401 si Django no tiene sesión disponible", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(null);
    const res = await reasonsPOST(jsonRequest({ label: "Motivo", assignedRoles: ["ADMINISTRADOR"] }));
    expect(res.status).toBe(401);
  });

  it("propaga el error de validación de Django", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(false, { error: "El nombre del motivo es obligatorio" }));
    const res = await reasonsPOST(jsonRequest({ label: "Motivo", assignedRoles: ["ADMINISTRADOR"] }));
    expect(res.status).toBe(400);
  });

  it("crea el motivo contra Django y devuelve la forma Nexo", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(true, DJANGO_REASON, 201));
    const res = await reasonsPOST(
      jsonRequest({ label: "  Reunión  ", description: "  detalle  ", assignedRoles: ["ADMINISTRADOR"] })
    );
    expect(res.status).toBe(201);
    expect(djangoApiFetch).toHaveBeenCalledWith(
      "/settings/activity-reasons/",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ label: "Reunión", description: "  detalle  ", assigned_roles: ["ADMINISTRADOR"] }),
      })
    );
    const body = await res.json();
    expect(body).toMatchObject({ id: "1", key: "REUNION", label: "Reunión", isActive: true });
  });
});

describe("PATCH /api/settings/activity-reasons/[id]", () => {
  beforeEach(resetAll);

  it("responde 401/403 según sesión y rol", async () => {
    mockSession(null);
    expect((await reasonPATCH(jsonRequest({}), ctx())).status).toBe(401);
    mockSession({ role: "COORDINADOR_NACIONAL" });
    expect((await reasonPATCH(jsonRequest({}), ctx())).status).toBe(403);
  });

  it("responde 400 si el body no es JSON válido", async () => {
    mockSession({});
    const res = await reasonPATCH(badJsonRequest(), ctx());
    expect(res.status).toBe(400);
  });

  it("responde 400 si se envía un label vacío", async () => {
    mockSession({});
    const res = await reasonPATCH(jsonRequest({ label: "   " }), ctx());
    expect(res.status).toBe(400);
    expect(djangoApiFetch).not.toHaveBeenCalled();
  });

  it("responde 400 si assignedRoles queda vacío o con un rol inválido", async () => {
    mockSession({});
    expect((await reasonPATCH(jsonRequest({ assignedRoles: [] }), ctx())).status).toBe(400);
    expect((await reasonPATCH(jsonRequest({ assignedRoles: ["NO_EXISTE"] }), ctx())).status).toBe(400);
  });

  it("responde 404 si el motivo no existe en Django", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue({ ok: false, status: 404, json: async () => ({ detail: "Not found." }) } as Response);
    const res = await reasonPATCH(jsonRequest({ label: "Nuevo nombre" }), ctx());
    expect(res.status).toBe(404);
  });

  it("actualiza label, description y assignedRoles juntos", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(true, { ...DJANGO_REASON, label: "Nuevo", description: "" }));
    const res = await reasonPATCH(
      jsonRequest({ label: "  Nuevo  ", description: null, assignedRoles: ["JEFE_NACIONAL", "ADMINISTRADOR"] }),
      ctx()
    );
    expect(res.status).toBe(200);
    expect(djangoApiFetch).toHaveBeenCalledWith(
      "/settings/activity-reasons/1/",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ label: "Nuevo", description: null, assigned_roles: ["JEFE_NACIONAL", "ADMINISTRADOR"] }),
      })
    );
  });

  it("archivar fuerza isArchived=true en el body enviado a Django", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(true, { ...DJANGO_REASON, is_archived: true, is_active: false }));
    const res = await reasonPATCH(jsonRequest({ isArchived: true }), ctx());
    expect(res.status).toBe(200);
    expect(djangoApiFetch).toHaveBeenCalledWith(
      "/settings/activity-reasons/1/",
      expect.objectContaining({ body: JSON.stringify({ is_archived: true }) })
    );
  });
});

describe("GET /api/activity-reasons (listado público)", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await publicReasonsGET();
    expect(res.status).toBe(401);
  });

  it("responde 401 si Django no tiene sesión disponible", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(null);
    const res = await publicReasonsGET();
    expect(res.status).toBe(401);
  });

  it("devuelve todos los motivos (activos, inactivos y archivados) mapeados a la forma Nexo", async () => {
    mockSession({ role: "ASISTENTE_GH" });
    djangoApiFetch.mockResolvedValue(
      djangoResponse(true, [
        { id: 1, key: "A", label: "A", description: "", is_active: true, is_archived: false, archived_at: null, assigned_roles: ["ASISTENTE_GH"], created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" },
        { id: 2, key: "B", label: "B", description: "", is_active: false, is_archived: true, archived_at: "2026-01-01T00:00:00.000Z", assigned_roles: [], created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" },
      ])
    );
    const res = await publicReasonsGET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(2);
    expect(body[0]).toMatchObject({ id: "1", key: "A", isActive: true });
    expect(body[1].isArchived).toBe(true);
  });
});
