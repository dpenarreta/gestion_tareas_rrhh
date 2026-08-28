import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SessionPayload } from "@/lib/session";
import type { NextRequest } from "next/server";

// Sub-fase 3d de la migración de stack (ver docs/AUDIT_LOG.md §
// 2026-08-07): GET /api/repository y GET /api/repository/[year]/[month]
// pasaron de Prisma a Django — este archivo mockeaba `@/lib/prisma` hasta
// esta actualización, probando agregación por mes y filtrado por
// jerarquía visible que ya NO viven en `route.ts` (movidos a
// `MonthClosureService.list_repository_months`, con un gap de visibilidad
// documentado ahí: sin `apps.hierarchy` conectado, cada usuario ve solo
// sus propias tareas archivadas). Acá solo se cubre lo que el wrapper de
// Next.js realmente hace.
const getSession = vi.fn();
vi.mock("@/lib/session", () => ({ getSession: (...args: unknown[]) => getSession(...args) }));

const djangoApiFetch = vi.fn();
vi.mock("@/lib/djangoSession", () => ({
  djangoApiFetch: (...args: unknown[]) => djangoApiFetch(...args),
}));

const { GET: repositoryGET } = await import("@/app/api/repository/route");
const { GET: repositoryMonthGET } = await import("@/app/api/repository/[year]/[month]/route");

function mockSession(overrides: Partial<SessionPayload> | null) {
  getSession.mockResolvedValue(
    overrides === null
      ? null
      : {
          userId: "u1",
          role: "JEFE_NACIONAL",
          name: "Ana",
          email: "test@nexo.com",
          expiresAt: new Date(Date.now() + 100000).toISOString(),
          ...overrides,
        }
  );
}

function ctx(year = "2026", month = "6") {
  return { params: Promise.resolve({ year, month }) };
}

function req() {
  return {} as unknown as NextRequest;
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
    frequency: "PUNTUAL", start_date: "2026-06-01T00:00:00Z", end_date: "2026-06-05T00:00:00Z",
    estimated_hours: 4, real_hours: 4, target_time_validated: null, progress: 100, color: "",
    corrected: false, assigned_to: DJANGO_USER_REF, created_by: DJANGO_USER_REF, comment_count: 0,
    has_unread_comments: false, created_at: "2026-06-01T00:00:00Z", updated_at: "2026-06-01T00:00:00Z",
    ...overrides,
  };
}

describe("GET /api/repository", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await repositoryGET();
    expect(res.status).toBe(401);
  });

  it("responde 401 si Django no tiene sesión disponible", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(null);
    const res = await repositoryGET();
    expect(res.status).toBe(401);
  });

  it("responde 400 si Django no pudo cargar el repositorio", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(false, {}, 500));
    const res = await repositoryGET();
    expect(res.status).toBe(400);
  });

  it("devuelve los meses del repositorio mapeados a la forma Nexo", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(
      djangoResponse(true, [{ year: 2026, month: 6, total_tasks: 2, completed_tasks: 1, total_hours: 6 }])
    );

    const res = await repositoryGET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ year: 2026, month: 6, totalTasks: 2, completedTasks: 1, totalHours: 6 }]);
  });
});

describe("GET /api/repository/[year]/[month]", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await repositoryMonthGET(req(), ctx());
    expect(res.status).toBe(401);
  });

  it("responde 400 ante año/mes inválidos, sin consultar Django", async () => {
    mockSession({});
    const res = await repositoryMonthGET(req(), ctx("abc", "6"));
    expect(res.status).toBe(400);
    expect(djangoApiFetch).not.toHaveBeenCalled();
  });

  it("responde 401 si Django no tiene sesión disponible", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(null);
    const res = await repositoryMonthGET(req(), ctx());
    expect(res.status).toBe(401);
  });

  it("responde 404 si ese mes no fue cerrado", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(false, {}, 404));
    const res = await repositoryMonthGET(req(), ctx());
    expect(res.status).toBe(404);
  });

  it("consulta el endpoint de Django con año/mes y devuelve las tareas mapeadas a la forma Nexo", async () => {
    mockSession({ role: "JEFE_NACIONAL" });
    djangoApiFetch.mockResolvedValue(djangoResponse(true, [djangoTask({ id: 7 })]));

    const res = await repositoryMonthGET(req(), ctx("2026", "6"));
    expect(res.status).toBe(200);
    expect(djangoApiFetch).toHaveBeenCalledWith("/tasks/repository/2026/6/");
    const body = await res.json();
    expect(body).toEqual([expect.objectContaining({ id: "7" })]);
  });
});
