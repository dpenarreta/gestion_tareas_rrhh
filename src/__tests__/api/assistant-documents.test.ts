import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SessionPayload } from "@/lib/session";

vi.mock("@/lib/session", () => ({
  getSession: vi.fn(),
}));

const { getSession } = await import("@/lib/session");
const { GET, POST } = await import("@/app/api/assistant/documents/route");

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

describe("GET /api/assistant/documents", () => {
  beforeEach(() => vi.mocked(getSession).mockReset());

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("responde 403 para un rol sin acceso a la base de conocimiento (ASISTENTE_GH)", async () => {
    mockSession({ role: "ASISTENTE_GH" });
    const res = await GET();
    expect(res.status).toBe(403);
  });

  it("responde 403 para COORDINADOR_ZS (no está en CAN_VIEW_KNOWLEDGE_BASE)", async () => {
    mockSession({ role: "COORDINADOR_ZS" });
    const res = await GET();
    expect(res.status).toBe(403);
  });
});

describe("POST /api/assistant/documents", () => {
  beforeEach(() => vi.mocked(getSession).mockReset());

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await POST(new Request("http://localhost/api/assistant/documents", { method: "POST" }) as never);
    expect(res.status).toBe(401);
  });

  it("responde 403 para un rol sin permiso de administración de documentos (JEFE_NACIONAL no puede subir, solo ADMINISTRADOR)", async () => {
    mockSession({ role: "JEFE_NACIONAL" });
    const res = await POST(new Request("http://localhost/api/assistant/documents", { method: "POST" }) as never);
    expect(res.status).toBe(403);
  });
});
