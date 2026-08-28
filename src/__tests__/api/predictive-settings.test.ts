import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SessionPayload } from "@/lib/session";

const invalidateAnalyticsCache = vi.fn();
vi.mock("@/lib/analytics", () => ({ invalidateAnalyticsCache: (...a: unknown[]) => invalidateAnalyticsCache(...a) }));

// Cutover de stack (Fase 84, ver docs/AUDIT_LOG.md § 2026-08-27): réplica de
// `PredictionWindowSettingsView` (backend, completa desde la Fase 13) —
// mockeado con `@/lib/djangoSession`, ya no con `@/lib/systemConfig`.
const djangoApiFetch = vi.fn();
vi.mock("@/lib/djangoSession", () => ({
  djangoApiFetch: (...args: unknown[]) => djangoApiFetch(...args),
  extractDjangoFlatErrorMessage: async (response: Response) => (await response.json().catch(() => null))?.error,
}));

function djangoResponse(ok: boolean, data: unknown, status = ok ? 200 : 400) {
  return { ok, status, json: async () => data } as Response;
}

vi.mock("@/lib/session", () => ({ getSession: vi.fn() }));

const { getSession } = await import("@/lib/session");
const { GET, PUT } = await import("@/app/api/settings/prediction-window/route");

function mockSession(overrides: Partial<SessionPayload> | null) {
  vi.mocked(getSession).mockResolvedValue(
    overrides === null
      ? null
      : { userId: "u1", role: "ADMINISTRADOR", name: "Ana", email: "a@nexo.com", expiresAt: new Date(Date.now() + 100000).toISOString(), ...overrides }
  );
}

function putRequest(body: unknown) {
  return { json: async () => body } as never;
}

function resetAll() {
  djangoApiFetch.mockReset();
  invalidateAnalyticsCache.mockReset();
  vi.mocked(getSession).mockReset();
}

describe("GET /api/settings/prediction-window", () => {
  beforeEach(resetAll);

  it("responde 401 sin sesión", async () => {
    mockSession(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("cualquier usuario autenticado puede leer la ventana efectiva", async () => {
    mockSession({ role: "ASISTENTE_GH" });
    djangoApiFetch.mockResolvedValue(djangoResponse(true, { window_weeks: "3" }));
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ windowWeeks: "3", options: ["3", "4", "6", "8", "12"] });
  });
});

describe("PUT /api/settings/prediction-window", () => {
  beforeEach(resetAll);

  it("responde 401 sin sesión", async () => {
    mockSession(null);
    const res = await PUT(putRequest({ windowWeeks: "6" }));
    expect(res.status).toBe(401);
  });

  it("responde 403 si el rol no es ADMINISTRADOR (ni siquiera Coordinador Nacional), sin llamar a Django", async () => {
    mockSession({ role: "COORDINADOR_NACIONAL" });
    const res = await PUT(putRequest({ windowWeeks: "6" }));
    expect(res.status).toBe(403);
    expect(djangoApiFetch).not.toHaveBeenCalled();
  });

  it("responde 400 con un valor fuera de las 5 opciones permitidas, sin llamar a Django", async () => {
    mockSession({ role: "ADMINISTRADOR" });
    const res = await PUT(putRequest({ windowWeeks: "5" }));
    expect(res.status).toBe(400);
    expect(djangoApiFetch).not.toHaveBeenCalled();
  });

  it("ADMINISTRADOR guarda un valor válido, invalida el caché global (sin argumentos) y devuelve el nuevo valor efectivo", async () => {
    mockSession({ role: "ADMINISTRADOR", userId: "admin-1" });
    djangoApiFetch
      .mockResolvedValueOnce(djangoResponse(true, { window_weeks: "6" })) // PUT
      .mockResolvedValueOnce(djangoResponse(true, { window_weeks: "6" })); // re-fetch tras guardar
    const res = await PUT(putRequest({ windowWeeks: "6" }));
    expect(res.status).toBe(200);
    expect(djangoApiFetch).toHaveBeenCalledWith("/settings/prediction-window/", {
      method: "PUT",
      body: JSON.stringify({ window_weeks: "6" }),
    });
    expect(invalidateAnalyticsCache).toHaveBeenCalledWith(); // sin argumentos — cambio global, no por usuario
    const body = await res.json();
    expect(body.windowWeeks).toBe("6");
  });
});
