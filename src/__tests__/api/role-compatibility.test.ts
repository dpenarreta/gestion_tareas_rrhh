import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SessionPayload } from "@/lib/session";

// Cutover de stack (ver docs/AUDIT_LOG.md § 2026-08-24, Fase 49): pasó de
// leer/escribir Postgres a ser un wrapper delgado sobre Django
// (`RoleCompatibilityView`, Fase 28) — su único consumidor real hoy es
// `analytics/recommendations/team` (Django, Fase 24/47); el caller TS
// (`computeTeamRecommendations`) es código muerto. La validación
// client-side (cargo válido, Regla 4) se conserva como defensa en
// profundidad, mismo criterio que `role-targets`.
const getSession = vi.fn();
vi.mock("@/lib/session", () => ({ getSession: (...args: unknown[]) => getSession(...args) }));

const djangoApiFetch = vi.fn();
vi.mock("@/lib/djangoSession", () => ({
  djangoApiFetch: (...args: unknown[]) => djangoApiFetch(...args),
  extractDjangoFlatErrorMessage: async (response: Response) => (await response.json().catch(() => null))?.error,
}));

const { GET, PATCH } = await import("@/app/api/settings/role-compatibility/route");

function mockSession(overrides: Partial<SessionPayload> | null) {
  getSession.mockResolvedValue(
    overrides === null
      ? null
      : { userId: "u1", role: "ADMINISTRADOR", name: "Ana", email: "a@nexo.com", expiresAt: new Date(Date.now() + 100000).toISOString(), ...overrides }
  );
}

function patchRequest(body: unknown) {
  return { json: async () => body } as never;
}

function resetAll() {
  getSession.mockReset();
  djangoApiFetch.mockReset();
}

function djangoResponse(ok: boolean, data: unknown, status = ok ? 200 : 400) {
  return { ok, status, json: async () => data } as Response;
}

describe("GET /api/settings/role-compatibility", () => {
  beforeEach(resetAll);

  it("responde 401 sin sesión", async () => {
    mockSession(null);
    const res = await GET();
    expect(res.status).toBe(401);
    expect(djangoApiFetch).not.toHaveBeenCalled();
  });

  it("cualquier usuario autenticado puede leer la matriz completa", async () => {
    mockSession({ role: "ASISTENTE_GH" });
    djangoApiFetch.mockResolvedValue(djangoResponse(true, { matrix: { ASISTENTE_GH: ["ASISTENTE_NOMINA"] } }));
    const res = await GET();
    expect(res.status).toBe(200);
    expect(djangoApiFetch).toHaveBeenCalledWith("/settings/role-compatibility/");
    const body = await res.json();
    expect(body.matrix).toEqual({ ASISTENTE_GH: ["ASISTENTE_NOMINA"] });
    expect(body.roles).toContain("ASISTENTE_GH");
    expect(body.roleLabels.ASISTENTE_GH).toBeTruthy();
    expect(body.roleLevels.ASISTENTE_GH).toBeDefined();
  });
});

describe("PATCH /api/settings/role-compatibility", () => {
  beforeEach(resetAll);

  it("responde 401 sin sesión", async () => {
    mockSession(null);
    const res = await PATCH(patchRequest({ role: "ASISTENTE_GH", compatibleRoles: [] }));
    expect(res.status).toBe(401);
  });

  it("responde 403 para un rol sin canManageUsers (ej. Coordinador ZS), sin llamar a Django", async () => {
    mockSession({ role: "COORDINADOR_ZS" });
    const res = await PATCH(patchRequest({ role: "ASISTENTE_GH", compatibleRoles: [] }));
    expect(res.status).toBe(403);
    expect(djangoApiFetch).not.toHaveBeenCalled();
  });

  it("responde 400 con un cargo desconocido", async () => {
    mockSession({ role: "ADMINISTRADOR" });
    const res = await PATCH(patchRequest({ role: "NO_EXISTE", compatibleRoles: [] }));
    expect(res.status).toBe(400);
  });

  it("Regla 4 — responde 400 si compatibleRoles incluye un cargo de otro nivel jerárquico, sin llamar a Django", async () => {
    mockSession({ role: "ADMINISTRADOR" });
    // ASISTENTE_GH es nivel 1, COORDINADOR_ZS es nivel 2 — inválido.
    const res = await PATCH(patchRequest({ role: "ASISTENTE_GH", compatibleRoles: ["COORDINADOR_ZS"] }));
    expect(res.status).toBe(400);
    expect(djangoApiFetch).not.toHaveBeenCalled();
  });

  it("guarda una configuración válida del mismo nivel jerárquico, traduce compatibleRoles a compatible_roles", async () => {
    mockSession({ role: "ADMINISTRADOR", userId: "admin-1" });
    djangoApiFetch.mockResolvedValue(
      djangoResponse(true, { matrix: { ASISTENTE_GH: ["ASISTENTE_NOMINA", "TRABAJO_SOCIAL"] } })
    );
    const res = await PATCH(patchRequest({ role: "ASISTENTE_GH", compatibleRoles: ["ASISTENTE_NOMINA", "TRABAJO_SOCIAL"] }));
    expect(res.status).toBe(200);
    expect(djangoApiFetch).toHaveBeenCalledWith("/settings/role-compatibility/", {
      method: "PATCH",
      body: JSON.stringify({ role: "ASISTENTE_GH", compatible_roles: ["ASISTENTE_NOMINA", "TRABAJO_SOCIAL"] }),
    });
    const body = await res.json();
    expect(body.matrix).toEqual({ ASISTENTE_GH: ["ASISTENTE_NOMINA", "TRABAJO_SOCIAL"] });
  });

  it("filtra silenciosamente una auto-referencia (el propio cargo) antes de reenviar a Django", async () => {
    mockSession({ role: "ADMINISTRADOR", userId: "admin-1" });
    djangoApiFetch.mockResolvedValue(djangoResponse(true, { matrix: {} }));
    await PATCH(patchRequest({ role: "ASISTENTE_GH", compatibleRoles: ["ASISTENTE_GH", "ASISTENTE_NOMINA"] }));
    expect(djangoApiFetch).toHaveBeenCalledWith("/settings/role-compatibility/", {
      method: "PATCH",
      body: JSON.stringify({ role: "ASISTENTE_GH", compatible_roles: ["ASISTENTE_NOMINA"] }),
    });
  });

  it("propaga el mensaje de error plano de Django", async () => {
    mockSession({ role: "ADMINISTRADOR" });
    djangoApiFetch.mockResolvedValue(djangoResponse(false, { error: "compatible_roles debe ser una lista de cargos válidos" }, 400));
    const res = await PATCH(patchRequest({ role: "ASISTENTE_GH", compatibleRoles: ["ASISTENTE_NOMINA"] }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("compatible_roles debe ser una lista de cargos válidos");
  });
});
