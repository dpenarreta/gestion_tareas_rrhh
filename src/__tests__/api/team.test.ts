import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SessionPayload } from "@/lib/session";

// Cutover de stack (ver docs/AUDIT_LOG.md § 2026-08-24): estas rutas
// pasaron de Prisma a Django (Fase 46) — mockeado con `@/lib/djangoSession`.
// El enmascarado de email, el conteo de tareas por estado y el caso
// especial de "tareas de un subordinado" ya viven en `apps.team.views`.
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
const { GET: teamGET } = await import("@/app/api/team/route");
const { GET: teamTasksGET } = await import("@/app/api/team/[userId]/tasks/route");

function mockSession(overrides: Partial<SessionPayload> | null) {
  vi.mocked(getSession).mockResolvedValue(
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

function ctx(userId = "1") {
  return { params: Promise.resolve({ userId }) };
}

function req() {
  return {} as never;
}

function resetAll() {
  djangoApiFetch.mockReset();
  vi.mocked(getSession).mockReset();
}

function djangoResponse(ok: boolean, data: unknown, status = ok ? 200 : 400) {
  return { ok, status, json: async () => data } as Response;
}

describe("GET /api/team", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await teamGET();
    expect(res.status).toBe(401);
  });

  it("responde 403 si Django rechaza por permisos", async () => {
    mockSession({ role: "ASISTENTE_GH" });
    djangoApiFetch.mockResolvedValue(djangoResponse(false, { error: "Sin permisos" }, 403));
    const res = await teamGET();
    expect(res.status).toBe(403);
  });

  it("mapea el conteo de tareas (in_progress -> inProgress) y el id como string", async () => {
    mockSession({ role: "JEFE_NACIONAL" });
    djangoApiFetch.mockResolvedValue(
      djangoResponse(true, [
        { id: 7, name: "Ana", email: "a**@n***.com", role: "ASISTENTE_GH", tasks: { total: 4, completed: 1, in_progress: 1, pending: 2 } },
      ])
    );
    const res = await teamGET();
    const body = await res.json();
    expect(body[0]).toMatchObject({
      id: "7",
      email: "a**@n***.com",
      tasks: { total: 4, completed: 1, inProgress: 1, pending: 2 },
    });
    expect(djangoApiFetch).toHaveBeenCalledWith("/team/");
  });
});

describe("GET /api/team/[userId]/tasks", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await teamTasksGET(req(), ctx());
    expect(res.status).toBe(401);
  });

  it("responde 403 si Django rechaza por permisos generales de equipo", async () => {
    mockSession({ role: "ASISTENTE_GH" });
    djangoApiFetch.mockResolvedValue(djangoResponse(false, { error: "Sin permisos" }, 403));
    const res = await teamTasksGET(req(), ctx());
    expect(res.status).toBe(403);
  });

  it("responde 404 si el usuario objetivo no existe", async () => {
    mockSession({ role: "JEFE_NACIONAL" });
    djangoApiFetch.mockResolvedValue(djangoResponse(false, {}, 404));
    const res = await teamTasksGET(req(), ctx());
    expect(res.status).toBe(404);
  });

  it("responde 403 con el mensaje específico si el objetivo no es un subordinado", async () => {
    mockSession({ role: "COORDINADOR_ZS" });
    djangoApiFetch.mockResolvedValue(djangoResponse(false, { error: "Sin permisos para ver este usuario" }, 403));
    const res = await teamTasksGET(req(), ctx());
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("Sin permisos para ver este usuario");
  });

  it("mapea las tareas del subordinado a la forma Nexo", async () => {
    mockSession({ role: "JEFE_NACIONAL" });
    djangoApiFetch.mockResolvedValue(
      djangoResponse(true, [
        {
          id: 1, title: "Tarea", description: "d", type: "FIJA", status: "PENDIENTE", priority: "ALTA", frequency: "UNICA",
          start_date: "2026-08-01", end_date: "2026-08-05", estimated_hours: 5, real_hours: 2, target_time_validated: false,
          progress: 20, color: null, corrected: false,
          assigned_to: { id: 7, name: "Ana", email: "ana@nexo.com", role: "ASISTENTE_GH" },
          created_by: { id: 1, name: "Jefe" },
          comment_count: 3, created_at: "2026-08-01T00:00:00Z", updated_at: "2026-08-01T00:00:00Z",
        },
      ])
    );
    const res = await teamTasksGET(req(), ctx("7"));
    expect(djangoApiFetch).toHaveBeenCalledWith("/team/7/tasks/");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body[0]).toMatchObject({
      id: "1", startDate: "2026-08-01", estimatedHours: 5, realHours: 2,
      assignedTo: { id: "7", name: "Ana" }, createdBy: { id: "1", name: "Jefe" },
      _count: { comments: 3 },
    });
  });
});
