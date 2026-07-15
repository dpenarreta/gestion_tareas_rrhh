import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SessionPayload } from "@/lib/session";

vi.mock("@/lib/session", () => ({
  getSession: vi.fn(),
}));

const { getSession } = await import("@/lib/session");
const { GET, POST } = await import("@/app/api/tasks/close-month/route");

function mockSession(overrides: Partial<SessionPayload> | null) {
  vi.mocked(getSession).mockResolvedValue(
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

describe("GET /api/tasks/close-month", () => {
  beforeEach(() => vi.mocked(getSession).mockReset());

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await GET(new Request("http://localhost/api/tasks/close-month") as never);
    expect(res.status).toBe(401);
  });

  it("responde 403 para un rol sin permiso de gestión de usuarios (no puede cerrar el mes)", async () => {
    mockSession({ role: "ANALISTA_SELECCION" });
    const res = await GET(new Request("http://localhost/api/tasks/close-month") as never);
    expect(res.status).toBe(403);
  });
});

describe("POST /api/tasks/close-month", () => {
  beforeEach(() => vi.mocked(getSession).mockReset());

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await POST(new Request("http://localhost/api/tasks/close-month", { method: "POST" }) as never);
    expect(res.status).toBe(401);
  });

  it("responde 403 para un rol sin permiso de cierre mensual", async () => {
    mockSession({ role: "TRABAJO_SOCIAL" });
    const res = await POST(new Request("http://localhost/api/tasks/close-month", { method: "POST" }) as never);
    expect(res.status).toBe(403);
  });
});
