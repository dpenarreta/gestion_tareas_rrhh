import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SessionPayload } from "@/lib/session";
import type { NextRequest } from "next/server";

vi.mock("@/lib/session", () => ({ getSession: vi.fn() }));

// Cutover de stack (ver docs/AUDIT_LOG.md § 2026-08-21/2026-08-25):
// `retroactive-window`, `snooze-presets`, `escritorio-digital-config`,
// `nova-cache` (Fase 59), `trabajo-avanzado` (Fase 60) y `seguridad-config`
// (Fase 61, `passwordMinLength`, el último campo pendiente) se cortaron a
// Django — ninguna ruta de este archivo usa `src/lib/systemConfig.ts` ya.
const djangoApiFetch = vi.fn();
const extractDjangoFlatErrorMessage = async (response: Response) => {
  const data = await response.json().catch(() => null);
  return typeof (data as { error?: unknown })?.error === "string" ? (data as { error: string }).error : undefined;
};
vi.mock("@/lib/djangoSession", () => ({
  djangoApiFetch: (...args: unknown[]) => djangoApiFetch(...args),
  extractDjangoFlatErrorMessage,
}));

function djangoResponse(ok: boolean, data: unknown, status = ok ? 200 : 400) {
  return { ok, status, json: async () => data } as Response;
}

const { getSession } = await import("@/lib/session");
const { GET: retroactiveWindowGET } = await import("@/app/api/settings/retroactive-window/route");
const { GET: snoozePresetsGET } = await import("@/app/api/settings/snooze-presets/route");
const { GET: trabajoAvanzadoGET, PUT: trabajoAvanzadoPUT } = await import("@/app/api/settings/trabajo-avanzado/route");
const { GET: escritorioDigitalGET, PUT: escritorioDigitalPUT } = await import(
  "@/app/api/settings/escritorio-digital-config/route"
);
const { GET: novaCacheGET, PUT: novaCachePUT } = await import("@/app/api/settings/nova-cache/route");
const { GET: seguridadConfigGET, PUT: seguridadConfigPUT } = await import("@/app/api/settings/seguridad-config/route");
const { GET: favoritesGET, PATCH: favoritesPATCH } = await import("@/app/api/settings/favorites/route");
const { GET: configHistoryGET } = await import("@/app/api/settings/config-history/route");
const { POST: restoreDefaultPOST } = await import("@/app/api/settings/config-history/restore-default/route");

function mockSession(overrides: Partial<SessionPayload> | null) {
  vi.mocked(getSession).mockResolvedValue(
    overrides === null
      ? null
      : {
          userId: "u1",
          role: "ASISTENTE_GH",
          name: "Ana",
          email: "test@nexo.com",
          expiresAt: new Date(Date.now() + 100000).toISOString(),
          ...overrides,
        }
  );
}

function jsonRequest(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

function urlRequest(url: string): NextRequest {
  return { nextUrl: new URL(url) } as unknown as NextRequest;
}

function resetAll() {
  vi.mocked(getSession).mockReset();
  djangoApiFetch.mockReset();
}

describe("GET /api/settings/retroactive-window", () => {
  beforeEach(resetAll);
  it("401 sin sesión", async () => {
    mockSession(null);
    expect((await retroactiveWindowGET()).status).toBe(401);
  });
  it("cualquier usuario autenticado (no solo Administrador) obtiene el valor desde Django", async () => {
    mockSession({ role: "ASISTENTE_GH" });
    djangoApiFetch.mockResolvedValue(djangoResponse(true, { days: 2 }));
    const res = await retroactiveWindowGET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ days: 2 });
    expect(djangoApiFetch).toHaveBeenCalledWith("/settings/retroactive-window/");
  });
  it("401 si Django no tiene sesión disponible", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(null);
    expect((await retroactiveWindowGET()).status).toBe(401);
  });
});

describe("GET /api/settings/snooze-presets", () => {
  beforeEach(resetAll);
  it("401 sin sesión", async () => {
    mockSession(null);
    expect((await snoozePresetsGET()).status).toBe(401);
  });
  it("cualquier usuario autenticado obtiene los presets desde Django", async () => {
    mockSession({ role: "ASISTENTE_GH" });
    djangoApiFetch.mockResolvedValue(djangoResponse(true, { minutes: [15, 30, 60, 1440] }));
    expect(await (await snoozePresetsGET()).json()).toEqual({ minutes: [15, 30, 60, 1440] });
  });
});

describe("GET/PUT /api/settings/trabajo-avanzado", () => {
  beforeEach(resetAll);
  it("PUT responde 403 si no es Administrador", async () => {
    mockSession({ role: "ASISTENTE_GH" });
    const res = await trabajoAvanzadoPUT(jsonRequest({ retroactiveWindowDays: 3 }));
    expect(res.status).toBe(403);
  });
  it("GET devuelve retroactiveWindowDays y workdayEndHour, ambos desde Django", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(true, { retroactive_window_days: 2, workday_end_hour: 18 }));
    const res = await trabajoAvanzadoGET();
    expect(await res.json()).toEqual({ retroactiveWindowDays: 2, workdayEndHour: 18 });
    expect(djangoApiFetch).toHaveBeenCalledWith("/settings/trabajo-avanzado/");
  });
  it("GET responde 401 si Django no tiene sesión disponible", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(null);
    expect((await trabajoAvanzadoGET()).status).toBe(401);
  });
  it("PUT rechaza una ventana fuera de rango (1-10) sin llegar a Django", async () => {
    mockSession({ role: "ADMINISTRADOR" });
    const res = await trabajoAvanzadoPUT(jsonRequest({ retroactiveWindowDays: 0 }));
    expect(res.status).toBe(400);
    expect(djangoApiFetch).not.toHaveBeenCalled();
  });
  it("PUT rechaza una hora de corte fuera de rango (0-23) sin llegar a Django", async () => {
    mockSession({ role: "ADMINISTRADOR" });
    const res = await trabajoAvanzadoPUT(jsonRequest({ workdayEndHour: 24 }));
    expect(res.status).toBe(400);
    expect(djangoApiFetch).not.toHaveBeenCalled();
  });
  it("PUT guarda retroactiveWindowDays y workdayEndHour, ambos en Django", async () => {
    mockSession({ role: "ADMINISTRADOR" });
    djangoApiFetch.mockResolvedValue(djangoResponse(true, { retroactive_window_days: 3, workday_end_hour: 18 }));
    const res = await trabajoAvanzadoPUT(jsonRequest({ retroactiveWindowDays: 3, workdayEndHour: 18 }));
    expect(res.status).toBe(200);
    expect(djangoApiFetch).toHaveBeenCalledWith(
      "/settings/trabajo-avanzado/",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ retroactive_window_days: 3, workday_end_hour: 18 }),
      })
    );
    expect(await res.json()).toEqual({ retroactiveWindowDays: 3, workdayEndHour: 18 });
  });
});

describe("GET/PUT /api/settings/escritorio-digital-config", () => {
  beforeEach(resetAll);
  it("PUT responde 403 si no es Administrador", async () => {
    mockSession({ role: "ASISTENTE_GH" });
    expect((await escritorioDigitalPUT(jsonRequest({ archiveRetentionDays: 10 }))).status).toBe(403);
  });
  it("GET devuelve los 3 valores vigentes desde Django", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(
      djangoResponse(true, { archive_retention_days: 15, max_replies: 2, snooze_presets_minutes: [15, 30, 60, 1440] })
    );
    const res = await escritorioDigitalGET();
    expect(await res.json()).toEqual({ archiveRetentionDays: 15, maxReplies: 2, snoozePresetsMinutes: [15, 30, 60, 1440] });
  });
  it("PUT rechaza presets de posposición vacíos o inválidos", async () => {
    mockSession({ role: "ADMINISTRADOR" });
    expect((await escritorioDigitalPUT(jsonRequest({ snoozePresetsMinutes: [] }))).status).toBe(400);
    expect((await escritorioDigitalPUT(jsonRequest({ snoozePresetsMinutes: [-5] }))).status).toBe(400);
    expect(djangoApiFetch).not.toHaveBeenCalled();
  });
  it("PUT guarda los 3 valores contra Django como Administrador", async () => {
    mockSession({ role: "ADMINISTRADOR" });
    djangoApiFetch.mockResolvedValue(
      djangoResponse(true, { archive_retention_days: 20, max_replies: 3, snooze_presets_minutes: [5, 10] })
    );
    const res = await escritorioDigitalPUT(
      jsonRequest({ archiveRetentionDays: 20, maxReplies: 3, snoozePresetsMinutes: [5, 10] })
    );
    expect(res.status).toBe(200);
    expect(djangoApiFetch).toHaveBeenCalledWith(
      "/settings/escritorio-digital-config/",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ archive_retention_days: 20, max_replies: 3, snooze_presets_minutes: [5, 10] }),
      })
    );
  });
});

describe("GET/PUT /api/settings/nova-cache", () => {
  beforeEach(resetAll);
  it("PUT responde 403 si no es Administrador", async () => {
    mockSession({ role: "ASISTENTE_GH" });
    expect((await novaCachePUT(jsonRequest({ cacheTtlMinutes: 60 }))).status).toBe(403);
    expect(djangoApiFetch).not.toHaveBeenCalled();
  });
  it("GET devuelve el TTL vigente desde Django", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(true, { cache_ttl_minutes: 240 }));
    expect(await (await novaCacheGET()).json()).toEqual({ cacheTtlMinutes: 240 });
    expect(djangoApiFetch).toHaveBeenCalledWith("/settings/nova-cache/");
  });
  it("GET responde 401 si Django no tiene sesión disponible", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(null);
    expect((await novaCacheGET()).status).toBe(401);
  });
  it("PUT rechaza un TTL fuera de rango sin llegar a Django", async () => {
    mockSession({ role: "ADMINISTRADOR" });
    expect((await novaCachePUT(jsonRequest({ cacheTtlMinutes: 0 }))).status).toBe(400);
    expect((await novaCachePUT(jsonRequest({ cacheTtlMinutes: 99999 }))).status).toBe(400);
    expect(djangoApiFetch).not.toHaveBeenCalled();
  });
  it("PUT guarda el TTL en Django como Administrador", async () => {
    mockSession({ role: "ADMINISTRADOR" });
    djangoApiFetch.mockResolvedValue(djangoResponse(true, { cache_ttl_minutes: 120 }));
    const res = await novaCachePUT(jsonRequest({ cacheTtlMinutes: 120 }));
    expect(res.status).toBe(200);
    expect(djangoApiFetch).toHaveBeenCalledWith(
      "/settings/nova-cache/",
      expect.objectContaining({ method: "PUT", body: JSON.stringify({ cache_ttl_minutes: 120 }) })
    );
    expect(await res.json()).toEqual({ cacheTtlMinutes: 120 });
  });
});

describe("GET/PUT /api/settings/seguridad-config", () => {
  beforeEach(resetAll);
  it("PUT responde 403 si no es Administrador", async () => {
    mockSession({ role: "ASISTENTE_GH" });
    expect((await seguridadConfigPUT(jsonRequest({ passwordMinLength: 8 }))).status).toBe(403);
  });
  it("GET devuelve los 4 valores vigentes, todos desde Django", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(
      djangoResponse(true, {
        password_min_length: 10,
        session_duration_default_hours: 168,
        session_duration_remember_hours: 720,
        retention_login_attempts_days: "30",
      })
    );
    expect(await (await seguridadConfigGET()).json()).toEqual({
      passwordMinLength: 10,
      sessionDurationDefaultHours: 168,
      sessionDurationRememberHours: 720,
      retentionLoginAttemptsDays: "30",
    });
    expect(djangoApiFetch).toHaveBeenCalledWith("/settings/seguridad-config/");
  });
  it("PUT rechaza una retención de intentos de login fuera de las opciones permitidas", async () => {
    mockSession({ role: "ADMINISTRADOR" });
    const res = await seguridadConfigPUT(jsonRequest({ retentionLoginAttemptsDays: "45" }));
    expect(res.status).toBe(400);
    expect(djangoApiFetch).not.toHaveBeenCalled();
  });
  it("PUT guarda los 4 valores en Django, incluido passwordMinLength", async () => {
    mockSession({ role: "ADMINISTRADOR" });
    djangoApiFetch.mockResolvedValue(
      djangoResponse(true, {
        password_min_length: 12,
        session_duration_default_hours: 72,
        session_duration_remember_hours: 168,
        retention_login_attempts_days: "60",
      })
    );
    const res = await seguridadConfigPUT(
      jsonRequest({
        passwordMinLength: 12,
        sessionDurationDefaultHours: 72,
        sessionDurationRememberHours: 168,
        retentionLoginAttemptsDays: "60",
      })
    );
    expect(djangoApiFetch).toHaveBeenCalledWith(
      "/settings/seguridad-config/",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({
          password_min_length: 12,
          session_duration_default_hours: 72,
          session_duration_remember_hours: 168,
          retention_login_attempts_days: "60",
        }),
      })
    );
    expect(await res.json()).toEqual({
      passwordMinLength: 12,
      sessionDurationDefaultHours: 72,
      sessionDurationRememberHours: 168,
      retentionLoginAttemptsDays: "60",
    });
  });
  it("PUT rechaza passwordMinLength por debajo del piso de Django (10) sin llamar a Django", async () => {
    mockSession({ role: "ADMINISTRADOR" });
    const res = await seguridadConfigPUT(jsonRequest({ passwordMinLength: 9 }));
    expect(res.status).toBe(400);
    expect(djangoApiFetch).not.toHaveBeenCalled();
  });
});

describe("GET/PATCH /api/settings/favorites", () => {
  beforeEach(resetAll);
  it("401 sin sesión", async () => {
    mockSession(null);
    expect((await favoritesGET()).status).toBe(401);
  });
  it("401 sin sesión Django (djangoApiFetch devuelve null)", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(null);
    expect((await favoritesGET()).status).toBe(401);
  });
  it("GET devuelve los favoritos del usuario en sesión, desde Django", async () => {
    mockSession({ userId: "u1" });
    djangoApiFetch.mockResolvedValue(djangoResponse(true, { favorites: ["holidays", "nova-cache"] }));
    expect(await (await favoritesGET()).json()).toEqual({ favorites: ["holidays", "nova-cache"] });
    expect(djangoApiFetch).toHaveBeenCalledWith("/settings/favorites/");
  });
  it("PATCH rechaza cuerpo sin settingId/pinned sin llamar a Django", async () => {
    mockSession({});
    expect((await favoritesPATCH(jsonRequest({}))).status).toBe(400);
    expect(djangoApiFetch).not.toHaveBeenCalled();
  });
  it("PATCH marca/desmarca un favorito para el usuario en sesión (cualquier rol), en Django", async () => {
    mockSession({ userId: "u2", role: "ASISTENTE_GH" });
    djangoApiFetch.mockResolvedValue(djangoResponse(true, { ok: true }));
    const res = await favoritesPATCH(jsonRequest({ settingId: "holidays", pinned: true }));
    expect(res.status).toBe(200);
    expect(djangoApiFetch).toHaveBeenCalledWith(
      "/settings/favorites/",
      expect.objectContaining({ method: "PATCH", body: JSON.stringify({ setting_id: "holidays", pinned: true }) })
    );
  });
});

describe("GET /api/settings/config-history", () => {
  beforeEach(resetAll);
  it("401 sin sesión", async () => {
    mockSession(null);
    expect((await configHistoryGET(urlRequest("http://localhost/api/settings/config-history?keys=a"))).status).toBe(401);
  });
  it("403 si no es Administrador", async () => {
    mockSession({ role: "ASISTENTE_GH" });
    expect((await configHistoryGET(urlRequest("http://localhost/api/settings/config-history?keys=a"))).status).toBe(403);
  });
  it("400 sin el parámetro keys", async () => {
    mockSession({ role: "ADMINISTRADOR" });
    expect((await configHistoryGET(urlRequest("http://localhost/api/settings/config-history"))).status).toBe(400);
  });
  it("401 sin sesión Django (djangoApiFetch devuelve null)", async () => {
    mockSession({ role: "ADMINISTRADOR" });
    djangoApiFetch.mockResolvedValue(null);
    expect((await configHistoryGET(urlRequest("http://localhost/api/settings/config-history?keys=a"))).status).toBe(401);
  });
  it("devuelve las filas mapeadas para las claves pedidas", async () => {
    mockSession({ role: "ADMINISTRADOR" });
    djangoApiFetch.mockResolvedValue(
      djangoResponse(true, [
        { key: "a", value: "5", valid_from: "2026-01-01T00:00:00.000Z", valid_until: null, updated_by_name: "Ana" },
      ])
    );
    const res = await configHistoryGET(urlRequest("http://localhost/api/settings/config-history?keys=a,b"));
    const body = await res.json();
    expect(body).toEqual([
      { key: "a", value: "5", validFrom: "2026-01-01T00:00:00.000Z", validUntil: null, updatedByName: "Ana" },
    ]);
    expect(djangoApiFetch).toHaveBeenCalledWith("/settings/config-history/?keys=a%2Cb");
  });
});

describe("POST /api/settings/config-history/restore-default", () => {
  beforeEach(resetAll);
  it("403 si no es Administrador", async () => {
    mockSession({ role: "ASISTENTE_GH" });
    expect((await restoreDefaultPOST(jsonRequest({ defaults: { a: "1" } }))).status).toBe(403);
  });
  it("400 sin defaults", async () => {
    mockSession({ role: "ADMINISTRADOR" });
    expect((await restoreDefaultPOST(jsonRequest({}))).status).toBe(400);
  });
  it("401 sin sesión Django (djangoApiFetch devuelve null)", async () => {
    mockSession({ role: "ADMINISTRADOR" });
    djangoApiFetch.mockResolvedValue(null);
    expect((await restoreDefaultPOST(jsonRequest({ defaults: { a: "1" } }))).status).toBe(401);
  });
  it("restaura cada clave a su valor por defecto vía Django", async () => {
    mockSession({ role: "ADMINISTRADOR" });
    djangoApiFetch.mockResolvedValue(djangoResponse(true, { ok: true }));
    const res = await restoreDefaultPOST(jsonRequest({ defaults: { key_a: "1", key_b: "2" } }));
    expect(res.status).toBe(200);
    expect(djangoApiFetch).toHaveBeenCalledWith("/settings/config-history/restore-default/", {
      method: "POST",
      body: JSON.stringify({ defaults: { key_a: "1", key_b: "2" } }),
    });
  });
});
