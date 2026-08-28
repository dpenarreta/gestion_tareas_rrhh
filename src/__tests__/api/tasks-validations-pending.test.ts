import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SessionPayload } from "@/lib/session";
import type { NextRequest } from "next/server";

// Sub-fase 3c-bulk de la migración de stack (ver docs/AUDIT_LOG.md §
// 2026-08-07): GET /api/tasks/validations/pending pasó de Prisma a
// Django — este archivo mockeaba `@/lib/prisma` hasta esta actualización,
// probando la consulta de unión (Tiempo Objetivo O Fecha Fin pendiente) y
// el cálculo de calidad de dato, que ya NO viven en `route.ts`. Acá solo
// se cubre lo que el wrapper de Next.js realmente hace: sesión, query
// string, mapeo de respuesta.
const getSession = vi.fn();
vi.mock("@/lib/session", () => ({ getSession: (...args: unknown[]) => getSession(...args) }));

const djangoApiFetch = vi.fn();
vi.mock("@/lib/djangoSession", () => ({
  djangoApiFetch: (...args: unknown[]) => djangoApiFetch(...args),
}));

const { GET } = await import("@/app/api/tasks/validations/pending/route");

function mockSession(overrides: Partial<SessionPayload> | null) {
  getSession.mockResolvedValue(
    overrides === null
      ? null
      : {
          userId: "u1",
          role: "ADMINISTRADOR",
          name: "Admin",
          email: "test@nexo.com",
          expiresAt: new Date(Date.now() + 100000).toISOString(),
          ...overrides,
        }
  );
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

const DJANGO_USER_REF = { id: 1, username: "ana", first_name: "Ana", email: "ana@nexo.com", roles: [{ id: 1, name: "ASISTENTE_GH" }] };

function dataQuality(overrides: Partial<Record<string, unknown>> = {}) {
  return { validated_count: 3, pending_count: 4, total_count: 10, validated_pct: 30, pending_pct: 40, ...overrides };
}

function djangoPendingResponse(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    tasks: [
      {
        id: 1, title: "Tarea 1", status: "PENDIENTE", type: "FIJA", priority: "MEDIA", start_date: "2026-08-01T00:00:00Z",
        estimated_hours: 4, real_hours: 3, target_time_validated: null, end_date: "2026-08-05T00:00:00Z",
        end_date_approval_status: "PENDIENTE", archived_month: null, assigned_to: DJANGO_USER_REF,
      },
    ],
    target_time_data_quality: dataQuality(),
    end_date_data_quality: dataQuality({ validated_count: 4, pending_count: 4 }),
    ...overrides,
  };
}

describe("GET /api/tasks/validations/pending", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await GET(getRequest("http://localhost/api/tasks/validations/pending"));
    expect(res.status).toBe(401);
  });

  it("responde 401 si Django no tiene sesión disponible", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(null);
    const res = await GET(getRequest("http://localhost/api/tasks/validations/pending"));
    expect(res.status).toBe(401);
  });

  it("responde 403 si Django rechaza por permisos (único motivo real de !ok en este GET)", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(false, {}, 403));
    const res = await GET(getRequest("http://localhost/api/tasks/validations/pending"));
    expect(res.status).toBe(403);
  });

  it("devuelve tasks + calidad de dato de ambas dimensiones, mapeadas a la forma Nexo", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(true, djangoPendingResponse()));

    const res = await GET(getRequest("http://localhost/api/tasks/validations/pending"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tasks).toHaveLength(1);
    expect(body.tasks[0]).toMatchObject({ id: "1", title: "Tarea 1", assignedTo: { id: "1", name: "Ana" } });
    expect(body.targetTimeDataQuality).toMatchObject({ validatedCount: 3, totalCount: 10 });
    expect(body.endDateDataQuality).toMatchObject({ validatedCount: 4, totalCount: 10 });
  });

  it("mapea userId/role/type a la query string de Django (user_id en snake_case)", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(true, djangoPendingResponse()));

    await GET(getRequest("http://localhost/api/tasks/validations/pending?userId=u2&role=ASISTENTE_GH&type=FIJA"));
    expect(djangoApiFetch).toHaveBeenCalledWith("/tasks/validations/pending/?user_id=u2&role=ASISTENTE_GH&type=FIJA");
  });

  it("sin parámetros, no agrega query string", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(true, djangoPendingResponse()));
    await GET(getRequest("http://localhost/api/tasks/validations/pending"));
    expect(djangoApiFetch).toHaveBeenCalledWith("/tasks/validations/pending/");
  });
});
