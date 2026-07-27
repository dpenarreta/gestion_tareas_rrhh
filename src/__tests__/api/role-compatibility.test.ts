import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SessionPayload } from "@/lib/session";

const getAllEffectiveRoleCompatibility = vi.fn();
const setRoleCompatibility = vi.fn();
const invalidateAnalyticsCache = vi.fn();

vi.mock("@/lib/systemConfig", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/systemConfig")>();
  return {
    ...actual,
    getAllEffectiveRoleCompatibility: (...a: unknown[]) => getAllEffectiveRoleCompatibility(...a),
    setRoleCompatibility: (...a: unknown[]) => setRoleCompatibility(...a),
  };
});
vi.mock("@/lib/analytics", () => ({ invalidateAnalyticsCache: (...a: unknown[]) => invalidateAnalyticsCache(...a) }));
vi.mock("@/lib/session", () => ({ getSession: vi.fn() }));

const { getSession } = await import("@/lib/session");
const { GET, PATCH } = await import("@/app/api/settings/role-compatibility/route");

function mockSession(overrides: Partial<SessionPayload> | null) {
  vi.mocked(getSession).mockResolvedValue(
    overrides === null
      ? null
      : { userId: "u1", role: "ADMINISTRADOR", name: "Ana", email: "a@nexo.com", expiresAt: new Date(Date.now() + 100000).toISOString(), ...overrides }
  );
}

function patchRequest(body: unknown) {
  return { json: async () => body } as never;
}

describe("GET /api/settings/role-compatibility", () => {
  beforeEach(() => {
    getAllEffectiveRoleCompatibility.mockReset().mockResolvedValue({ ASISTENTE_GH: ["ASISTENTE_NOMINA"] });
    vi.mocked(getSession).mockReset();
  });

  it("responde 401 sin sesión", async () => {
    mockSession(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("cualquier usuario autenticado puede leer la matriz completa", async () => {
    mockSession({ role: "ASISTENTE_GH" });
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.matrix).toEqual({ ASISTENTE_GH: ["ASISTENTE_NOMINA"] });
    expect(body.roles).toContain("ASISTENTE_GH");
    expect(body.roleLabels.ASISTENTE_GH).toBeTruthy();
  });
});

describe("PATCH /api/settings/role-compatibility", () => {
  beforeEach(() => {
    getAllEffectiveRoleCompatibility.mockReset().mockResolvedValue({});
    setRoleCompatibility.mockReset().mockResolvedValue(undefined);
    invalidateAnalyticsCache.mockReset();
    vi.mocked(getSession).mockReset();
  });

  it("responde 401 sin sesión", async () => {
    mockSession(null);
    const res = await PATCH(patchRequest({ role: "ASISTENTE_GH", compatibleRoles: [] }));
    expect(res.status).toBe(401);
  });

  it("responde 403 para un rol sin canManageUsers (ej. Coordinador ZS)", async () => {
    mockSession({ role: "COORDINADOR_ZS" });
    const res = await PATCH(patchRequest({ role: "ASISTENTE_GH", compatibleRoles: [] }));
    expect(res.status).toBe(403);
    expect(setRoleCompatibility).not.toHaveBeenCalled();
  });

  it("responde 400 con un cargo desconocido", async () => {
    mockSession({ role: "ADMINISTRADOR" });
    const res = await PATCH(patchRequest({ role: "NO_EXISTE", compatibleRoles: [] }));
    expect(res.status).toBe(400);
  });

  it("Regla 4 — responde 400 si compatibleRoles incluye un cargo de otro nivel jerárquico", async () => {
    mockSession({ role: "ADMINISTRADOR" });
    // ASISTENTE_GH es nivel 1, COORDINADOR_ZS es nivel 2 — inválido.
    const res = await PATCH(patchRequest({ role: "ASISTENTE_GH", compatibleRoles: ["COORDINADOR_ZS"] }));
    expect(res.status).toBe(400);
    expect(setRoleCompatibility).not.toHaveBeenCalled();
  });

  it("guarda una configuración válida del mismo nivel jerárquico e invalida el caché global", async () => {
    mockSession({ role: "ADMINISTRADOR", userId: "admin-1" });
    const res = await PATCH(patchRequest({ role: "ASISTENTE_GH", compatibleRoles: ["ASISTENTE_NOMINA", "TRABAJO_SOCIAL"] }));
    expect(res.status).toBe(200);
    expect(setRoleCompatibility).toHaveBeenCalledWith("ASISTENTE_GH", ["ASISTENTE_NOMINA", "TRABAJO_SOCIAL"], "admin-1");
    expect(invalidateAnalyticsCache).toHaveBeenCalledWith();
  });

  it("filtra silenciosamente una auto-referencia (el propio cargo) en vez de rechazarla", async () => {
    mockSession({ role: "ADMINISTRADOR", userId: "admin-1" });
    const res = await PATCH(patchRequest({ role: "ASISTENTE_GH", compatibleRoles: ["ASISTENTE_GH", "ASISTENTE_NOMINA"] }));
    expect(res.status).toBe(200);
    expect(setRoleCompatibility).toHaveBeenCalledWith("ASISTENTE_GH", ["ASISTENTE_NOMINA"], "admin-1");
  });
});
