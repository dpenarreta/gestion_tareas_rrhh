import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SessionPayload } from "@/lib/session";

const getEffectivePredictionWindowWeeks = vi.fn();
const setConfigValue = vi.fn();
const invalidateAnalyticsCache = vi.fn();

vi.mock("@/lib/predictiveConfig", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/predictiveConfig")>();
  return { ...actual, getEffectivePredictionWindowWeeks: (...a: unknown[]) => getEffectivePredictionWindowWeeks(...a) };
});

vi.mock("@/lib/systemConfig", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/systemConfig")>();
  return { ...actual, setConfigValue: (...a: unknown[]) => setConfigValue(...a) };
});

vi.mock("@/lib/analytics", () => ({ invalidateAnalyticsCache: (...a: unknown[]) => invalidateAnalyticsCache(...a) }));

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

describe("GET /api/settings/prediction-window", () => {
  beforeEach(() => {
    getEffectivePredictionWindowWeeks.mockReset().mockResolvedValue("3");
    vi.mocked(getSession).mockReset();
  });

  it("responde 401 sin sesión", async () => {
    mockSession(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("cualquier usuario autenticado puede leer la ventana efectiva", async () => {
    mockSession({ role: "ASISTENTE_GH" });
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ windowWeeks: "3", options: ["3", "4", "6", "8", "12"] });
  });
});

describe("PUT /api/settings/prediction-window", () => {
  beforeEach(() => {
    getEffectivePredictionWindowWeeks.mockReset().mockResolvedValue("6");
    setConfigValue.mockReset().mockResolvedValue(undefined);
    invalidateAnalyticsCache.mockReset();
    vi.mocked(getSession).mockReset();
  });

  it("responde 401 sin sesión", async () => {
    mockSession(null);
    const res = await PUT(putRequest({ windowWeeks: "6" }));
    expect(res.status).toBe(401);
  });

  it("responde 403 si el rol no es ADMINISTRADOR (ni siquiera Coordinador Nacional)", async () => {
    mockSession({ role: "COORDINADOR_NACIONAL" });
    const res = await PUT(putRequest({ windowWeeks: "6" }));
    expect(res.status).toBe(403);
    expect(setConfigValue).not.toHaveBeenCalled();
  });

  it("responde 400 con un valor fuera de las 5 opciones permitidas", async () => {
    mockSession({ role: "ADMINISTRADOR" });
    const res = await PUT(putRequest({ windowWeeks: "5" }));
    expect(res.status).toBe(400);
    expect(setConfigValue).not.toHaveBeenCalled();
  });

  it("ADMINISTRADOR guarda un valor válido, invalida el caché global (sin argumentos) y devuelve el nuevo valor efectivo", async () => {
    mockSession({ role: "ADMINISTRADOR", userId: "admin-1" });
    const res = await PUT(putRequest({ windowWeeks: "6" }));
    expect(res.status).toBe(200);
    expect(setConfigValue).toHaveBeenCalledWith("prediction_window_weeks", "6", "admin-1");
    expect(invalidateAnalyticsCache).toHaveBeenCalledWith(); // sin argumentos — cambio global, no por usuario
    const body = await res.json();
    expect(body.windowWeeks).toBe("6");
  });
});
