import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SessionPayload } from "@/lib/session";

// Cutover de stack (ver docs/AUDIT_LOG.md § 2026-08-24, Fase 49): pasó de
// leer/escribir Postgres a ser un wrapper delgado sobre Django
// (`RoleTargetsView`, Fase 28) — su único consumidor real hoy es
// `analytics/benchmarks/[userId]` (Django, Fase 22/47); el caller TS
// (`runAnalyticsPipeline`) es código muerto. Nunca había tenido ningún test
// (gap preexistente).
const getSession = vi.fn();
vi.mock("@/lib/session", () => ({ getSession: (...args: unknown[]) => getSession(...args) }));

const djangoApiFetch = vi.fn();
vi.mock("@/lib/djangoSession", () => ({
  djangoApiFetch: (...args: unknown[]) => djangoApiFetch(...args),
  extractDjangoFlatErrorMessage: async (response: Response) => (await response.json().catch(() => null))?.error,
}));

const { GET, PATCH } = await import("@/app/api/settings/role-targets/route");

function mockSession(overrides: Partial<SessionPayload> | null) {
  getSession.mockResolvedValue(
    overrides === null
      ? null
      : { djangoUserId: 1, role: "ADMINISTRADOR", name: "Ana", email: "a@nexo.com", expiresAt: new Date(Date.now() + 100000).toISOString(), ...overrides }
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

describe("GET /api/settings/role-targets", () => {
  beforeEach(resetAll);

  it("responde 401 sin sesión", async () => {
    mockSession(null);
    const res = await GET();
    expect(res.status).toBe(401);
    expect(djangoApiFetch).not.toHaveBeenCalled();
  });

  it("cualquier usuario autenticado puede leer los objetivos, riesgo_max se mapea a riesgoMax", async () => {
    mockSession({ role: "ASISTENTE_GH" });
    djangoApiFetch.mockResolvedValue(
      djangoResponse(true, { targets: { ASISTENTE_GH: { performance: 80, riesgo_max: 20, cumplimiento: 90 } } })
    );
    const res = await GET();
    expect(res.status).toBe(200);
    expect(djangoApiFetch).toHaveBeenCalledWith("/settings/role-targets/");
    const body = await res.json();
    expect(body.targets).toEqual({ ASISTENTE_GH: { performance: 80, riesgoMax: 20, cumplimiento: 90 } });
    expect(body.roles).toContain("ASISTENTE_GH");
    expect(body.roleLabels.ASISTENTE_GH).toBeTruthy();
  });
});

describe("PATCH /api/settings/role-targets", () => {
  beforeEach(resetAll);

  it("responde 401 sin sesión", async () => {
    mockSession(null);
    const res = await PATCH(patchRequest({ role: "ASISTENTE_GH", target: { performance: 80, riesgoMax: 20, cumplimiento: 90 } }));
    expect(res.status).toBe(401);
  });

  it("responde 403 para un rol sin canManageUsers, sin llamar a Django", async () => {
    mockSession({ role: "COORDINADOR_ZS" });
    const res = await PATCH(patchRequest({ role: "ASISTENTE_GH", target: { performance: 80, riesgoMax: 20, cumplimiento: 90 } }));
    expect(res.status).toBe(403);
    expect(djangoApiFetch).not.toHaveBeenCalled();
  });

  it("responde 400 con un cargo desconocido", async () => {
    mockSession({ role: "ADMINISTRADOR" });
    const res = await PATCH(patchRequest({ role: "NO_EXISTE", target: { performance: 80, riesgoMax: 20, cumplimiento: 90 } }));
    expect(res.status).toBe(400);
  });

  it("responde 400 con un objetivo fuera de rango, sin llamar a Django", async () => {
    mockSession({ role: "ADMINISTRADOR" });
    const res = await PATCH(patchRequest({ role: "ASISTENTE_GH", target: { performance: 150, riesgoMax: 20, cumplimiento: 90 } }));
    expect(res.status).toBe(400);
    expect(djangoApiFetch).not.toHaveBeenCalled();
  });

  it("guarda un objetivo válido, traduce riesgoMax a riesgo_max y mapea la respuesta", async () => {
    mockSession({ role: "ADMINISTRADOR" });
    djangoApiFetch.mockResolvedValue(
      djangoResponse(true, { targets: { ASISTENTE_GH: { performance: 80, riesgo_max: 20, cumplimiento: 90 } } })
    );
    const res = await PATCH(patchRequest({ role: "ASISTENTE_GH", target: { performance: 80, riesgoMax: 20, cumplimiento: 90 } }));
    expect(res.status).toBe(200);
    expect(djangoApiFetch).toHaveBeenCalledWith("/settings/role-targets/", {
      method: "PATCH",
      body: JSON.stringify({ role: "ASISTENTE_GH", target: { performance: 80, riesgo_max: 20, cumplimiento: 90 } }),
    });
    const body = await res.json();
    expect(body.targets).toEqual({ ASISTENTE_GH: { performance: 80, riesgoMax: 20, cumplimiento: 90 } });
  });

  it("acepta null en cualquier campo (objetivo sin definir)", async () => {
    mockSession({ role: "ADMINISTRADOR" });
    djangoApiFetch.mockResolvedValue(djangoResponse(true, { targets: {} }));
    const res = await PATCH(patchRequest({ role: "ASISTENTE_GH", target: { performance: null, riesgoMax: null, cumplimiento: null } }));
    expect(res.status).toBe(200);
    expect(djangoApiFetch).toHaveBeenCalledWith("/settings/role-targets/", {
      method: "PATCH",
      body: JSON.stringify({ role: "ASISTENTE_GH", target: { performance: null, riesgo_max: null, cumplimiento: null } }),
    });
  });

  it("propaga el mensaje de error plano de Django", async () => {
    mockSession({ role: "ADMINISTRADOR" });
    djangoApiFetch.mockResolvedValue(
      djangoResponse(false, { error: "Objetivo inválido: cada campo debe ser un número entre 0 y 100, o null" }, 400)
    );
    const res = await PATCH(patchRequest({ role: "ASISTENTE_GH", target: { performance: 50, riesgoMax: 10, cumplimiento: 90 } }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Objetivo inválido: cada campo debe ser un número entre 0 y 100, o null");
  });
});
