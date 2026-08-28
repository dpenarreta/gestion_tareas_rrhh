import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SessionPayload } from "@/lib/session";
import type { NextRequest } from "next/server";

// Fase 3c de la migración de stack (ver docs/AUDIT_LOG.md § 2026-08-07):
// GET/POST /api/tasks/[id]/end-date pasaron de Prisma a Django — este
// archivo mockeaba `@/lib/prisma` hasta esta actualización, probando
// lógica (permisos de validación, transición de estado, notificaciones)
// que ya NO vive en `route.ts`. Acá solo se cubre lo que el wrapper de
// Next.js realmente hace.
const getSession = vi.fn();
vi.mock("@/lib/session", () => ({ getSession: (...args: unknown[]) => getSession(...args) }));

const djangoApiFetch = vi.fn();
vi.mock("@/lib/djangoSession", () => ({
  djangoApiFetch: (...args: unknown[]) => djangoApiFetch(...args),
}));

const { GET, POST } = await import("@/app/api/tasks/[id]/end-date/route");

function mockSession(overrides: Partial<SessionPayload> | null) {
  getSession.mockResolvedValue(
    overrides === null
      ? null
      : {
          userId: "u1",
          role: "ASISTENTE_GH",
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

function postRequest(body: unknown): NextRequest {
  return { json: async () => body, headers: new Headers() } as unknown as NextRequest;
}

function resetAll() {
  getSession.mockReset();
  djangoApiFetch.mockReset();
}

function djangoResponse(ok: boolean, data: unknown, status = ok ? 200 : 400) {
  return { ok, status, json: async () => data } as Response;
}

const DJANGO_USER_REF = { id: 2, username: "jefe", first_name: "Jefe", email: "jefe@nexo.com", roles: [{ id: 1, name: "JEFE_NACIONAL" }] };

function djangoEndDateInfo(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    end_date: "2026-08-15T00:00:00Z",
    end_date_approval_status: "PENDIENTE",
    end_date_approved_at: null,
    approved_by: null,
    can_validate: false,
    audit_history: [],
    ...overrides,
  };
}

describe("GET /api/tasks/[id]/end-date", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await GET({} as NextRequest, ctx());
    expect(res.status).toBe(401);
  });

  it("responde 401 si Django no tiene sesión disponible", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(null);
    const res = await GET({} as NextRequest, ctx());
    expect(res.status).toBe(401);
  });

  it("responde 404 si la tarea no existe", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(false, {}, 404));
    const res = await GET({} as NextRequest, ctx());
    expect(res.status).toBe(404);
  });

  it("devuelve el estado de Fecha Fin mapeado a la forma Nexo", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(true, djangoEndDateInfo({ can_validate: true, approved_by: DJANGO_USER_REF })));

    const res = await GET({} as NextRequest, ctx("1"));
    expect(res.status).toBe(200);
    expect(djangoApiFetch).toHaveBeenCalledWith("/tasks/1/end-date/");
    const body = await res.json();
    expect(body).toMatchObject({ endDateApprovalStatus: "PENDIENTE", canValidate: true, approvedBy: { id: "2", name: "Jefe" } });
  });
});

describe("POST /api/tasks/[id]/end-date", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await POST(postRequest({}), ctx());
    expect(res.status).toBe(401);
  });

  it("responde 404 si Django rechaza por permisos (403)", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(false, {}, 403));
    const res = await POST(postRequest({ action: "APROBAR" }), ctx());
    expect(res.status).toBe(404);
  });

  it("responde 400 con el mensaje de Django ante una acción inválida", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(
      djangoResponse(false, { error: { details: { non_field_errors: ["Acción inválida"] } } }, 400)
    );
    const res = await POST(postRequest({ action: "INVALIDA" }), ctx());
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Acción inválida");
  });

  it("mapea action/newEndDate/observaciones a snake_case y devuelve el estado actualizado", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(true, djangoEndDateInfo({ end_date_approval_status: "MODIFICADA" })));

    const res = await POST(
      postRequest({ action: "MODIFICAR", newEndDate: "2026-08-18", observaciones: "  se corre la fecha  " }),
      ctx("1")
    );
    expect(res.status).toBe(200);
    expect(djangoApiFetch).toHaveBeenCalledWith(
      "/tasks/1/end-date/",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ action: "MODIFICAR", new_end_date: "2026-08-18", observaciones: "se corre la fecha" }),
      })
    );
    expect((await res.json()).endDateApprovalStatus).toBe("MODIFICADA");
  });

  it("observaciones vacías/ausentes se envían como null", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(true, djangoEndDateInfo()));

    await POST(postRequest({ action: "APROBAR" }), ctx("1"));
    expect(djangoApiFetch).toHaveBeenCalledWith(
      "/tasks/1/end-date/",
      expect.objectContaining({ body: JSON.stringify({ action: "APROBAR", new_end_date: null, observaciones: null }) })
    );
  });
});
