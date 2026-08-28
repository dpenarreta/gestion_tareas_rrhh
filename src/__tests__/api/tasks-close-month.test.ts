import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SessionPayload } from "@/lib/session";
import type { NextRequest } from "next/server";

// Sub-fase 3d de la migración de stack (ver docs/AUDIT_LOG.md §
// 2026-08-07): GET/POST /api/tasks/close-month pasaron de Prisma a
// Django — este archivo mockeaba `@/lib/prisma` hasta esta actualización,
// probando lógica (cálculo de preview, Fecha de Corte, duplicación de
// tareas recurrentes) que ya NO vive en `route.ts`. Acá solo se cubre lo
// que el wrapper de Next.js realmente hace.
const getSession = vi.fn();
vi.mock("@/lib/session", () => ({ getSession: (...args: unknown[]) => getSession(...args) }));

const djangoApiFetch = vi.fn();
vi.mock("@/lib/djangoSession", () => ({
  djangoApiFetch: (...args: unknown[]) => djangoApiFetch(...args),
}));

const { GET, POST } = await import("@/app/api/tasks/close-month/route");

function mockSession(overrides: Partial<SessionPayload> | null) {
  getSession.mockResolvedValue(
    overrides === null
      ? null
      : {
          userId: "u1",
          role: "JEFE_NACIONAL",
          name: "Test",
          email: "test@nexo.com",
          expiresAt: new Date(Date.now() + 100000).toISOString(),
          ...overrides,
        }
  );
}

function getRequest(url: string): NextRequest {
  return { url } as unknown as NextRequest;
}

function postRequest(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

function djangoResponse(ok: boolean, data: unknown, status = ok ? 200 : 400) {
  return { ok, status, json: async () => data } as Response;
}

function djangoPreview(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    year: 2026, month: 7, already_closed: false, total: 4, completed: 2, pending: 1, in_progress: 1,
    continued_active: 3, cutoff_date: "2026-07-31", closure_type: "NORMAL", calendar_days_total: 31,
    calendar_days_considered: 31, working_days_considered: 23, working_hours_considered: 184,
    ...overrides,
  };
}

function djangoClosureResult(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    archived_count: 1, duplicated_count: 0, continued_active_count: 0, month: 6, year: 2026,
    next_month: 7, next_year: 2026, cutoff_date: "2026-06-30", closure_type: "NORMAL",
    calendar_days_total: 30, calendar_days_considered: 30, working_days_considered: 22, working_hours_considered: 176,
    ...overrides,
  };
}

function resetAll() {
  getSession.mockReset();
  djangoApiFetch.mockReset();
}

describe("GET /api/tasks/close-month", () => {
  beforeEach(() => {
    resetAll();
    mockSession({});
  });

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await GET(getRequest("http://localhost/api/tasks/close-month"));
    expect(res.status).toBe(401);
  });

  it("responde 401 si Django no tiene sesión disponible", async () => {
    djangoApiFetch.mockResolvedValue(null);
    const res = await GET(getRequest("http://localhost/api/tasks/close-month"));
    expect(res.status).toBe(401);
  });

  it("responde 403 si Django rechaza por permisos", async () => {
    djangoApiFetch.mockResolvedValue(djangoResponse(false, {}, 403));
    const res = await GET(getRequest("http://localhost/api/tasks/close-month"));
    expect(res.status).toBe(403);
  });

  it("responde 400 si el año/mes es inválido", async () => {
    djangoApiFetch.mockResolvedValue(djangoResponse(false, {}, 400));
    const res = await GET(getRequest("http://localhost/api/tasks/close-month?year=2026&month=13"));
    expect(res.status).toBe(400);
  });

  it("reenvía year/month/cutoffDate como query string y devuelve el preview mapeado a la forma Nexo", async () => {
    djangoApiFetch.mockResolvedValue(djangoResponse(true, djangoPreview()));

    const res = await GET(getRequest("http://localhost/api/tasks/close-month?year=2026&month=7&cutoffDate=2026-07-20"));
    expect(res.status).toBe(200);
    expect(djangoApiFetch).toHaveBeenCalledWith("/tasks/close-month/?year=2026&month=7&cutoffDate=2026-07-20");

    const body = await res.json();
    expect(body).toMatchObject({
      year: 2026, month: 7, alreadyClosed: false, total: 4, completed: 2, pending: 1, inProgress: 1,
      continuedActive: 3, cutoffDate: "2026-07-31", closureType: "NORMAL",
    });
  });

  it("sin parámetros, no agrega query string", async () => {
    djangoApiFetch.mockResolvedValue(djangoResponse(true, djangoPreview()));
    await GET(getRequest("http://localhost/api/tasks/close-month"));
    expect(djangoApiFetch).toHaveBeenCalledWith("/tasks/close-month/");
  });
});

describe("POST /api/tasks/close-month", () => {
  beforeEach(() => {
    resetAll();
    mockSession({});
  });

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await POST(postRequest({}));
    expect(res.status).toBe(401);
  });

  it("responde 401 si Django no tiene sesión disponible", async () => {
    djangoApiFetch.mockResolvedValue(null);
    const res = await POST(postRequest({ year: 2026, month: 6 }));
    expect(res.status).toBe(401);
  });

  it("responde 403 si Django rechaza por permisos", async () => {
    djangoApiFetch.mockResolvedValue(djangoResponse(false, {}, 403));
    const res = await POST(postRequest({ year: 2026, month: 6 }));
    expect(res.status).toBe(403);
  });

  it("responde 409 si el mes ya fue cerrado", async () => {
    djangoApiFetch.mockResolvedValue(djangoResponse(false, {}, 409));
    const res = await POST(postRequest({ year: 2026, month: 6 }));
    expect(res.status).toBe(409);
  });

  it("responde 400 con el mensaje de Django ante año/mes inválido", async () => {
    djangoApiFetch.mockResolvedValue(
      djangoResponse(false, { error: { details: { non_field_errors: ["Año o mes inválido"] } } }, 400)
    );
    const res = await POST(postRequest({ year: 2026, month: 0 }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Año o mes inválido");
  });

  it("reenvía year/month/cutoffDate y devuelve el resultado mapeado a la forma Nexo", async () => {
    djangoApiFetch.mockResolvedValue(djangoResponse(true, djangoClosureResult({ archived_count: 3, duplicated_count: 1 })));

    const res = await POST(postRequest({ year: 2026, month: 6, cutoffDate: "2026-06-25" }));
    expect(res.status).toBe(200);
    expect(djangoApiFetch).toHaveBeenCalledWith(
      "/tasks/close-month/",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ year: 2026, month: 6, cutoffDate: "2026-06-25" }) })
    );
    const body = await res.json();
    expect(body).toMatchObject({ archivedCount: 3, duplicatedCount: 1, month: 6, year: 2026, nextMonth: 7, nextYear: 2026 });
  });
});
