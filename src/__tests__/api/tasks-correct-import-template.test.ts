import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SessionPayload } from "@/lib/session";
import type { NextRequest } from "next/server";

// Sub-fases 3d/3e de la migración de stack (ver docs/AUDIT_LOG.md §
// 2026-08-07): PATCH /api/tasks/[id]/correct, POST /api/tasks/import y
// GET /api/tasks/template pasaron de Prisma a Django — este archivo
// mockeaba `@/lib/prisma` hasta esta actualización, probando parseo de
// xlsx/validaciones que ya NO viven en `route.ts` (el archivo se reenvía
// tal cual a Django como `FormData`, y la plantilla se genera del lado
// Django). Acá solo se cubre lo que el wrapper de Next.js realmente hace.
const getSession = vi.fn();
vi.mock("@/lib/session", () => ({ getSession: (...args: unknown[]) => getSession(...args) }));

const djangoApiFetch = vi.fn();
vi.mock("@/lib/djangoSession", () => ({
  djangoApiFetch: (...args: unknown[]) => djangoApiFetch(...args),
}));

const { PATCH: correctPATCH } = await import("@/app/api/tasks/[id]/correct/route");
const { POST: importPOST } = await import("@/app/api/tasks/import/route");
const { GET: templateGET } = await import("@/app/api/tasks/template/route");

function mockSession(overrides: Partial<SessionPayload> | null) {
  getSession.mockResolvedValue(
    overrides === null
      ? null
      : {
          userId: "u1",
          role: "ADMINISTRADOR",
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

function resetAll() {
  getSession.mockReset();
  djangoApiFetch.mockReset();
}

function djangoResponse(ok: boolean, data: unknown, status = ok ? 200 : 400) {
  return { ok, status, json: async () => data } as Response;
}

const DJANGO_USER_REF = { id: 1, username: "ana", first_name: "Ana", email: "ana@nexo.com", roles: [{ id: 1, name: "ASISTENTE_GH" }] };

function djangoTask(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1, title: "Tarea", description: "", type: "FIJA", status: "COMPLETADA", priority: "MEDIA",
    frequency: "PUNTUAL", start_date: "2026-01-01T00:00:00Z", end_date: "2026-01-05T00:00:00Z",
    estimated_hours: 4, real_hours: 7, target_time_validated: null, progress: 100, color: "",
    corrected: true, assigned_to: DJANGO_USER_REF, created_by: DJANGO_USER_REF, comment_count: 0,
    has_unread_comments: false, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("PATCH /api/tasks/[id]/correct", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await correctPATCH(jsonRequest({}), ctx());
    expect(res.status).toBe(401);
  });

  it("responde 401 si Django no tiene sesión disponible", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(null);
    const res = await correctPATCH(jsonRequest({ realHours: 7 }), ctx());
    expect(res.status).toBe(401);
  });

  it("responde 403 si quien solicita no es Administrador", async () => {
    mockSession({ role: "JEFE_NACIONAL" });
    djangoApiFetch.mockResolvedValue(djangoResponse(false, {}, 403));
    const res = await correctPATCH(jsonRequest({ realHours: 7 }), ctx());
    expect(res.status).toBe(403);
  });

  it("responde 404 si la tarea no existe", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(false, {}, 404));
    const res = await correctPATCH(jsonRequest({ realHours: 7 }), ctx());
    expect(res.status).toBe(404);
  });

  it("responde 400 con el mensaje de Django ante una corrección inválida", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(
      djangoResponse(false, { error: { details: { non_field_errors: ["La tarea no está archivada"] } } }, 400)
    );
    const res = await correctPATCH(jsonRequest({ realHours: 7 }), ctx());
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("La tarea no está archivada");
  });

  it("mapea realHours/status a snake_case y devuelve la tarea corregida", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(true, djangoTask({ real_hours: 7 })));

    const res = await correctPATCH(jsonRequest({ realHours: 7, status: "COMPLETADA" }), ctx("1"));
    expect(res.status).toBe(200);
    expect(djangoApiFetch).toHaveBeenCalledWith(
      "/tasks/1/correct/",
      expect.objectContaining({ method: "PATCH", body: JSON.stringify({ real_hours: 7, status: "COMPLETADA" }) })
    );
    expect((await res.json()).realHours).toBe(7);
  });
});

describe("POST /api/tasks/import", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await importPOST({ formData: async () => new FormData() } as unknown as NextRequest);
    expect(res.status).toBe(401);
  });

  it("responde 401 si Django no tiene sesión disponible", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(null);
    const res = await importPOST({ formData: async () => new FormData() } as unknown as NextRequest);
    expect(res.status).toBe(401);
  });

  it("responde 400 con el mensaje de Django ante un archivo inválido", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(false, { error: "No se pudo leer el archivo" }, 400));
    const res = await importPOST({ formData: async () => new FormData() } as unknown as NextRequest);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("No se pudo leer el archivo");
  });

  it("reenvía el FormData recibido tal cual a Django y devuelve su resultado", async () => {
    mockSession({});
    const formData = new FormData();
    formData.set("file", new File(["contenido"], "import.xlsx"));
    djangoApiFetch.mockResolvedValue(djangoResponse(true, { imported: 3, errors: [] }));

    const res = await importPOST({ formData: async () => formData } as unknown as NextRequest);
    expect(res.status).toBe(200);
    expect(djangoApiFetch).toHaveBeenCalledWith("/tasks/import/", { method: "POST", body: formData });
    expect(await res.json()).toEqual({ imported: 3, errors: [] });
  });
});

describe("GET /api/tasks/template", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await templateGET();
    expect(res.status).toBe(401);
  });

  it("responde 401 si Django no tiene sesión disponible", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(null);
    const res = await templateGET();
    expect(res.status).toBe(401);
  });

  it("responde 400 si Django no pudo generar la plantilla", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue({ ok: false, arrayBuffer: async () => new ArrayBuffer(0) } as Response);
    const res = await templateGET();
    expect(res.status).toBe(400);
  });

  it("devuelve el archivo xlsx que genera Django, con sus headers", async () => {
    mockSession({});
    const bytes = new TextEncoder().encode("contenido-xlsx").buffer;
    djangoApiFetch.mockResolvedValue({
      ok: true,
      arrayBuffer: async () => bytes,
      headers: new Headers({
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": 'attachment; filename="plantilla_tareas.xlsx"',
      }),
    } as Response);

    const res = await templateGET();
    expect(res.headers.get("Content-Type")).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(res.headers.get("Content-Disposition")).toContain("plantilla_tareas.xlsx");
    const buffer = await res.arrayBuffer();
    expect(buffer.byteLength).toBeGreaterThan(0);
  });
});
