import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SessionPayload } from "@/lib/session";

vi.mock("@/lib/session", () => ({
  getSession: vi.fn(),
}));

const { getSession } = await import("@/lib/session");
const { PATCH } = await import("@/app/api/ideas/[id]/status/route");

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

function ctx(id = "idea-1") {
  return { params: Promise.resolve({ id }) };
}

describe("PATCH /api/ideas/[id]/status", () => {
  beforeEach(() => vi.mocked(getSession).mockReset());

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await PATCH(
      new Request("http://localhost/api/ideas/idea-1/status", { method: "PATCH" }) as never,
      ctx()
    );
    expect(res.status).toBe(401);
  });

  it("responde 403 para un rol sin permiso de revisión de ideas (ASISTENTE_GH)", async () => {
    mockSession({ role: "ASISTENTE_GH" });
    const res = await PATCH(
      new Request("http://localhost/api/ideas/idea-1/status", { method: "PATCH" }) as never,
      ctx()
    );
    expect(res.status).toBe(403);
  });

  it("responde 403 para COORDINADOR_ZS (no está en CAN_REVIEW_IDEAS)", async () => {
    mockSession({ role: "COORDINADOR_ZS" });
    const res = await PATCH(
      new Request("http://localhost/api/ideas/idea-1/status", { method: "PATCH" }) as never,
      ctx()
    );
    expect(res.status).toBe(403);
  });
});
