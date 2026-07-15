import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SessionPayload } from "@/lib/session";

vi.mock("@/lib/session", () => ({
  getSession: vi.fn(),
}));

const { getSession } = await import("@/lib/session");
const { GET, POST } = await import("@/app/api/users/route");

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

describe("GET /api/users", () => {
  beforeEach(() => {
    vi.mocked(getSession).mockReset();
  });

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("responde 403 para un rol sin permiso de gestión de usuarios (ASISTENTE_GH)", async () => {
    mockSession({ role: "ASISTENTE_GH" });
    const res = await GET();
    expect(res.status).toBe(403);
  });

  it("responde 403 para un rol de nivel intermedio sin permiso (COORDINADOR_ZS)", async () => {
    mockSession({ role: "COORDINADOR_ZS" });
    const res = await GET();
    expect(res.status).toBe(403);
  });
});

describe("POST /api/users", () => {
  beforeEach(() => {
    vi.mocked(getSession).mockReset();
  });

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await POST(new Request("http://localhost/api/users", { method: "POST" }) as never);
    expect(res.status).toBe(401);
  });

  it("responde 403 para un rol sin permiso de gestión de usuarios", async () => {
    mockSession({ role: "ANALISTA_CC" });
    const res = await POST(new Request("http://localhost/api/users", { method: "POST" }) as never);
    expect(res.status).toBe(403);
  });
});
