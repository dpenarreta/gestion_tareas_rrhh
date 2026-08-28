import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SessionPayload } from "@/lib/session";

// Papelera de Proyectos — cutover de stack (ver docs/AUDIT_LOG.md §
// 2026-08-21): cierra el gap explícito de la Fase 5f (DELETE/trash/restore/
// permanent seguían en Prisma mientras el resto de Proyectos ya era 100%
// Django, dejando inalcanzable cualquier proyecto creado después de ese
// cutover). Mockeado con `@/lib/djangoSession`, mismo patrón que el resto
// de Proyectos ya cutover.
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
const { DELETE: moveToTrashDELETE } = await import("@/app/api/projects/[id]/route");
const { GET: trashGET } = await import("@/app/api/projects/trash/route");
const { POST: restorePOST } = await import("@/app/api/projects/[id]/restore/route");
const { DELETE: permanentDELETE } = await import("@/app/api/projects/[id]/permanent/route");

function mockSession(overrides: Partial<SessionPayload> | null) {
  vi.mocked(getSession).mockResolvedValue(
    overrides === null
      ? null
      : {
          userId: "u1",
          role: "COORDINADOR_NACIONAL",
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

describe("DELETE /api/projects/[id] (mover a la papelera)", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await moveToTrashDELETE(req(), ctx());
    expect(res.status).toBe(401);
    expect(djangoApiFetch).not.toHaveBeenCalled();
  });

  it("responde 401 si Django no tiene sesión disponible", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(null);
    const res = await moveToTrashDELETE(req(), ctx());
    expect(res.status).toBe(401);
  });

  it("responde 404 si el proyecto no existe", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(false, {}, 404));
    const res = await moveToTrashDELETE(req(), ctx());
    expect(res.status).toBe(404);
  });

  it("responde 403 si quien pide no es el creador", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(false, {}, 403));
    const res = await moveToTrashDELETE(req(), ctx());
    expect(res.status).toBe(403);
  });

  it("responde 409 con el mensaje de Django ante un RecoveryError", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(false, { error: "Ya fue enviado a la papelera" }, 409));
    const res = await moveToTrashDELETE(req(), ctx());
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("Ya fue enviado a la papelera");
  });

  it("mueve el proyecto a la papelera", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(true, { success: true }));
    const res = await moveToTrashDELETE(req(), ctx("42"));
    expect(res.status).toBe(200);
    expect(djangoApiFetch).toHaveBeenCalledWith("/projects/42/", { method: "DELETE" });
    expect(await res.json()).toEqual({ success: true });
  });
});

describe("GET /api/projects/trash", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await trashGET();
    expect(res.status).toBe(401);
  });

  it("responde 403 si el rol no puede crear proyectos", async () => {
    mockSession({ role: "ASISTENTE_GH" });
    const res = await trashGET();
    expect(res.status).toBe(403);
    expect(djangoApiFetch).not.toHaveBeenCalled();
  });

  it("mapea la lista de Django a la forma Nexo (camelCase, ids como string)", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(
      djangoResponse(true, [
        {
          id: 42,
          name: "Proyecto X",
          status: "PLANIFICACION",
          responsible: { id: 5, name: "Beto" },
          created_by: { id: 1, name: "Ana" },
          deleted_at: "2026-08-01T00:00:00Z",
          expires_at: "2026-09-01T00:00:00Z",
          ms_remaining: 1000,
          can_delete: true,
        },
      ])
    );
    const res = await trashGET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([
      {
        id: "42",
        name: "Proyecto X",
        status: "PLANIFICACION",
        responsible: { id: "5", name: "Beto" },
        createdBy: { id: "1", name: "Ana" },
        deletedAt: "2026-08-01T00:00:00Z",
        expiresAt: "2026-09-01T00:00:00Z",
        msRemaining: 1000,
        canDelete: true,
      },
    ]);
  });
});

describe("POST /api/projects/[id]/restore", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await restorePOST(req(), ctx());
    expect(res.status).toBe(401);
  });

  it("responde 404 si el proyecto no existe", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(false, { error: "Proyecto no encontrado" }, 404));
    const res = await restorePOST(req(), ctx());
    expect(res.status).toBe(404);
  });

  it("responde 409 si el proyecto no está en la papelera", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(false, { error: "Este proyecto no está en la papelera" }, 409));
    const res = await restorePOST(req(), ctx());
    expect(res.status).toBe(409);
  });

  it("responde 403 si quien pide no es el creador", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(
      djangoResponse(false, { error: "Solo el creador del proyecto puede restaurarlo" }, 403)
    );
    const res = await restorePOST(req(), ctx());
    expect(res.status).toBe(403);
  });

  it("restaura el proyecto", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(true, { success: true }));
    const res = await restorePOST(req(), ctx("42"));
    expect(res.status).toBe(200);
    expect(djangoApiFetch).toHaveBeenCalledWith("/projects/42/restore/", { method: "POST" });
  });
});

describe("DELETE /api/projects/[id]/permanent", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await permanentDELETE(req(), ctx());
    expect(res.status).toBe(401);
  });

  it("responde 409 si el proyecto no está en la papelera", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(false, { error: "Este proyecto no está en la papelera" }, 409));
    const res = await permanentDELETE(req(), ctx());
    expect(res.status).toBe(409);
  });

  it("responde 403 si quien pide no es el creador", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(
      djangoResponse(false, { error: "Solo el creador del proyecto puede eliminarlo definitivamente" }, 403)
    );
    const res = await permanentDELETE(req(), ctx());
    expect(res.status).toBe(403);
  });

  it("elimina el proyecto definitivamente", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(true, { success: true }));
    const res = await permanentDELETE(req(), ctx("42"));
    expect(res.status).toBe(200);
    expect(djangoApiFetch).toHaveBeenCalledWith("/projects/42/permanent/", { method: "DELETE" });
  });
});
