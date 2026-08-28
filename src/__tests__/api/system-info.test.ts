import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SessionPayload } from "@/lib/session";

// Cutover de stack (ver docs/AUDIT_LOG.md § 2026-08-24, Fase 49): pasó de
// contar Usuarios/Tareas/Reuniones/Ideas en Postgres (desactualizados desde
// sus respectivos cutovers) a ser un wrapper delgado sobre Django
// (`SystemInfoView`, Fase 32). Nunca había tenido ningún test (gap
// preexistente).
const getSession = vi.fn();
vi.mock("@/lib/session", () => ({ getSession: (...args: unknown[]) => getSession(...args) }));

const djangoApiFetch = vi.fn();
vi.mock("@/lib/djangoSession", () => ({
  djangoApiFetch: (...args: unknown[]) => djangoApiFetch(...args),
}));

const { GET } = await import("@/app/api/settings/system-info/route");

function mockSession(overrides: Partial<SessionPayload> | null) {
  getSession.mockResolvedValue(
    overrides === null
      ? null
      : { userId: "u1", role: "ADMINISTRADOR", name: "Ana", email: "a@nexo.com", expiresAt: new Date(Date.now() + 100000).toISOString(), ...overrides }
  );
}

function resetAll() {
  getSession.mockReset();
  djangoApiFetch.mockReset();
}

function djangoResponse(ok: boolean, data: unknown, status = ok ? 200 : 400) {
  return { ok, status, json: async () => data } as Response;
}

describe("GET /api/settings/system-info", () => {
  beforeEach(resetAll);

  it("responde 401 sin sesión", async () => {
    mockSession(null);
    const res = await GET();
    expect(res.status).toBe(401);
    expect(djangoApiFetch).not.toHaveBeenCalled();
  });

  it("responde 403 si Django rechaza por no ser ADMINISTRADOR", async () => {
    mockSession({ role: "COORDINADOR_NACIONAL" });
    djangoApiFetch.mockResolvedValue(djangoResponse(false, { error: "Sin permisos" }, 403));
    const res = await GET();
    expect(res.status).toBe(403);
  });

  it("mapea la respuesta de Django a camelCase", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(
      djangoResponse(true, {
        version: "2.1.0",
        commit_sha: "abc1234",
        server_started_at: "2026-08-24T10:00:00.000Z",
        total_users: 42,
        total_tasks: 900,
        total_meetings: 15,
        total_ideas: 7,
      })
    );
    const res = await GET();
    expect(res.status).toBe(200);
    expect(djangoApiFetch).toHaveBeenCalledWith("/settings/system-info/");
    const body = await res.json();
    expect(body).toEqual({
      version: "2.1.0",
      commitSha: "abc1234",
      serverStartedAt: "2026-08-24T10:00:00.000Z",
      totalUsers: 42,
      totalTasks: 900,
      totalMeetings: 15,
      totalIdeas: 7,
    });
  });
});
