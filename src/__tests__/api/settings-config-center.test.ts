import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SessionPayload } from "@/lib/session";
import type { NextRequest } from "next/server";

vi.mock("@/lib/session", () => ({ getSession: vi.fn() }));

const getEffectiveRetroactiveWindowDays = vi.fn();
const setRetroactiveWindowDays = vi.fn();
const getEffectiveWorkdayEndHour = vi.fn();
const setWorkdayEndHour = vi.fn();
const getEffectiveDeskArchiveRetentionDays = vi.fn();
const setDeskArchiveRetentionDays = vi.fn();
const getEffectiveDeskNoteMaxReplies = vi.fn();
const setDeskNoteMaxReplies = vi.fn();
const getEffectiveSnoozePresetsMinutes = vi.fn();
const setSnoozePresetsMinutes = vi.fn();
const getEffectiveNovaCacheTtlMinutes = vi.fn();
const setNovaCacheTtlMinutes = vi.fn();
const getEffectivePasswordMinLength = vi.fn();
const setPasswordMinLength = vi.fn();
const getEffectiveSessionDurationDefaultHours = vi.fn();
const setSessionDurationDefaultHours = vi.fn();
const getEffectiveSessionDurationRememberHours = vi.fn();
const setSessionDurationRememberHours = vi.fn();
const getEffectiveRetentionLoginAttempts = vi.fn();
const setRetentionLoginAttempts = vi.fn();
const setConfigValue = vi.fn();

vi.mock("@/lib/systemConfig", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/systemConfig")>();
  return {
    ...actual,
    getEffectiveRetroactiveWindowDays: (...a: unknown[]) => getEffectiveRetroactiveWindowDays(...a),
    setRetroactiveWindowDays: (...a: unknown[]) => setRetroactiveWindowDays(...a),
    getEffectiveWorkdayEndHour: (...a: unknown[]) => getEffectiveWorkdayEndHour(...a),
    setWorkdayEndHour: (...a: unknown[]) => setWorkdayEndHour(...a),
    getEffectiveDeskArchiveRetentionDays: (...a: unknown[]) => getEffectiveDeskArchiveRetentionDays(...a),
    setDeskArchiveRetentionDays: (...a: unknown[]) => setDeskArchiveRetentionDays(...a),
    getEffectiveDeskNoteMaxReplies: (...a: unknown[]) => getEffectiveDeskNoteMaxReplies(...a),
    setDeskNoteMaxReplies: (...a: unknown[]) => setDeskNoteMaxReplies(...a),
    getEffectiveSnoozePresetsMinutes: (...a: unknown[]) => getEffectiveSnoozePresetsMinutes(...a),
    setSnoozePresetsMinutes: (...a: unknown[]) => setSnoozePresetsMinutes(...a),
    getEffectiveNovaCacheTtlMinutes: (...a: unknown[]) => getEffectiveNovaCacheTtlMinutes(...a),
    setNovaCacheTtlMinutes: (...a: unknown[]) => setNovaCacheTtlMinutes(...a),
    getEffectivePasswordMinLength: (...a: unknown[]) => getEffectivePasswordMinLength(...a),
    setPasswordMinLength: (...a: unknown[]) => setPasswordMinLength(...a),
    getEffectiveSessionDurationDefaultHours: (...a: unknown[]) => getEffectiveSessionDurationDefaultHours(...a),
    setSessionDurationDefaultHours: (...a: unknown[]) => setSessionDurationDefaultHours(...a),
    getEffectiveSessionDurationRememberHours: (...a: unknown[]) => getEffectiveSessionDurationRememberHours(...a),
    setSessionDurationRememberHours: (...a: unknown[]) => setSessionDurationRememberHours(...a),
    getEffectiveRetentionLoginAttempts: (...a: unknown[]) => getEffectiveRetentionLoginAttempts(...a),
    setRetentionLoginAttempts: (...a: unknown[]) => setRetentionLoginAttempts(...a),
    setConfigValue: (...a: unknown[]) => setConfigValue(...a),
  };
});

const getConfigFavoritesForUser = vi.fn();
const setConfigFavorite = vi.fn();
vi.mock("@/lib/configFavorites", () => ({
  getConfigFavoritesForUser: (...a: unknown[]) => getConfigFavoritesForUser(...a),
  setConfigFavorite: (...a: unknown[]) => setConfigFavorite(...a),
}));

const systemConfigHistoryFindMany = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: { systemConfigHistory: { findMany: (...a: unknown[]) => systemConfigHistoryFindMany(...a) } },
}));

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
  getEffectiveRetroactiveWindowDays.mockReset().mockResolvedValue(2);
  setRetroactiveWindowDays.mockReset().mockResolvedValue(undefined);
  getEffectiveWorkdayEndHour.mockReset().mockResolvedValue(17);
  setWorkdayEndHour.mockReset().mockResolvedValue(undefined);
  getEffectiveDeskArchiveRetentionDays.mockReset().mockResolvedValue(15);
  setDeskArchiveRetentionDays.mockReset().mockResolvedValue(undefined);
  getEffectiveDeskNoteMaxReplies.mockReset().mockResolvedValue(2);
  setDeskNoteMaxReplies.mockReset().mockResolvedValue(undefined);
  getEffectiveSnoozePresetsMinutes.mockReset().mockResolvedValue([15, 30, 60, 1440]);
  setSnoozePresetsMinutes.mockReset().mockResolvedValue(undefined);
  getEffectiveNovaCacheTtlMinutes.mockReset().mockResolvedValue(240);
  setNovaCacheTtlMinutes.mockReset().mockResolvedValue(undefined);
  getEffectivePasswordMinLength.mockReset().mockResolvedValue(6);
  setPasswordMinLength.mockReset().mockResolvedValue(undefined);
  getEffectiveSessionDurationDefaultHours.mockReset().mockResolvedValue(168);
  setSessionDurationDefaultHours.mockReset().mockResolvedValue(undefined);
  getEffectiveSessionDurationRememberHours.mockReset().mockResolvedValue(720);
  setSessionDurationRememberHours.mockReset().mockResolvedValue(undefined);
  getEffectiveRetentionLoginAttempts.mockReset().mockResolvedValue("30");
  setRetentionLoginAttempts.mockReset().mockResolvedValue(undefined);
  setConfigValue.mockReset().mockResolvedValue(undefined);
  getConfigFavoritesForUser.mockReset().mockResolvedValue([]);
  setConfigFavorite.mockReset().mockResolvedValue(undefined);
  systemConfigHistoryFindMany.mockReset().mockResolvedValue([]);
}

describe("GET /api/settings/retroactive-window", () => {
  beforeEach(resetAll);
  it("401 sin sesión", async () => {
    mockSession(null);
    expect((await retroactiveWindowGET()).status).toBe(401);
  });
  it("cualquier usuario autenticado (no solo Administrador) obtiene el valor", async () => {
    mockSession({ role: "ASISTENTE_GH" });
    const res = await retroactiveWindowGET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ days: 2 });
  });
});

describe("GET /api/settings/snooze-presets", () => {
  beforeEach(resetAll);
  it("401 sin sesión", async () => {
    mockSession(null);
    expect((await snoozePresetsGET()).status).toBe(401);
  });
  it("cualquier usuario autenticado obtiene los presets", async () => {
    mockSession({ role: "ASISTENTE_GH" });
    const res = await snoozePresetsGET();
    expect(await res.json()).toEqual({ minutes: [15, 30, 60, 1440] });
  });
});

describe("GET/PUT /api/settings/trabajo-avanzado", () => {
  beforeEach(resetAll);
  it("PUT responde 403 si no es Administrador", async () => {
    mockSession({ role: "ASISTENTE_GH" });
    const res = await trabajoAvanzadoPUT(jsonRequest({ retroactiveWindowDays: 3 }));
    expect(res.status).toBe(403);
  });
  it("GET devuelve ambos valores vigentes", async () => {
    mockSession({});
    const res = await trabajoAvanzadoGET();
    expect(await res.json()).toEqual({ retroactiveWindowDays: 2, workdayEndHour: 17 });
  });
  it("PUT rechaza una ventana fuera de rango (1-10)", async () => {
    mockSession({ role: "ADMINISTRADOR" });
    const res = await trabajoAvanzadoPUT(jsonRequest({ retroactiveWindowDays: 0 }));
    expect(res.status).toBe(400);
    expect(setRetroactiveWindowDays).not.toHaveBeenCalled();
  });
  it("PUT rechaza una hora de corte fuera de rango (0-23)", async () => {
    mockSession({ role: "ADMINISTRADOR" });
    const res = await trabajoAvanzadoPUT(jsonRequest({ workdayEndHour: 24 }));
    expect(res.status).toBe(400);
    expect(setWorkdayEndHour).not.toHaveBeenCalled();
  });
  it("PUT guarda ambos valores como Administrador", async () => {
    mockSession({ role: "ADMINISTRADOR" });
    const res = await trabajoAvanzadoPUT(jsonRequest({ retroactiveWindowDays: 3, workdayEndHour: 18 }));
    expect(res.status).toBe(200);
    expect(setRetroactiveWindowDays).toHaveBeenCalledWith(3, "u1");
    expect(setWorkdayEndHour).toHaveBeenCalledWith(18, "u1");
  });
});

describe("GET/PUT /api/settings/escritorio-digital-config", () => {
  beforeEach(resetAll);
  it("PUT responde 403 si no es Administrador", async () => {
    mockSession({ role: "ASISTENTE_GH" });
    expect((await escritorioDigitalPUT(jsonRequest({ archiveRetentionDays: 10 }))).status).toBe(403);
  });
  it("GET devuelve los 3 valores vigentes", async () => {
    mockSession({});
    const res = await escritorioDigitalGET();
    expect(await res.json()).toEqual({ archiveRetentionDays: 15, maxReplies: 2, snoozePresetsMinutes: [15, 30, 60, 1440] });
  });
  it("PUT rechaza presets de posposición vacíos o inválidos", async () => {
    mockSession({ role: "ADMINISTRADOR" });
    expect((await escritorioDigitalPUT(jsonRequest({ snoozePresetsMinutes: [] }))).status).toBe(400);
    expect((await escritorioDigitalPUT(jsonRequest({ snoozePresetsMinutes: [-5] }))).status).toBe(400);
    expect(setSnoozePresetsMinutes).not.toHaveBeenCalled();
  });
  it("PUT guarda los 3 valores como Administrador", async () => {
    mockSession({ role: "ADMINISTRADOR" });
    const res = await escritorioDigitalPUT(
      jsonRequest({ archiveRetentionDays: 20, maxReplies: 3, snoozePresetsMinutes: [5, 10] })
    );
    expect(res.status).toBe(200);
    expect(setDeskArchiveRetentionDays).toHaveBeenCalledWith(20, "u1");
    expect(setDeskNoteMaxReplies).toHaveBeenCalledWith(3, "u1");
    expect(setSnoozePresetsMinutes).toHaveBeenCalledWith([5, 10], "u1");
  });
});

describe("GET/PUT /api/settings/nova-cache", () => {
  beforeEach(resetAll);
  it("PUT responde 403 si no es Administrador", async () => {
    mockSession({ role: "ASISTENTE_GH" });
    expect((await novaCachePUT(jsonRequest({ cacheTtlMinutes: 60 }))).status).toBe(403);
  });
  it("GET devuelve el TTL vigente", async () => {
    mockSession({});
    expect(await (await novaCacheGET()).json()).toEqual({ cacheTtlMinutes: 240 });
  });
  it("PUT rechaza un TTL fuera de rango", async () => {
    mockSession({ role: "ADMINISTRADOR" });
    expect((await novaCachePUT(jsonRequest({ cacheTtlMinutes: 0 }))).status).toBe(400);
    expect((await novaCachePUT(jsonRequest({ cacheTtlMinutes: 99999 }))).status).toBe(400);
  });
  it("PUT guarda el TTL como Administrador", async () => {
    mockSession({ role: "ADMINISTRADOR" });
    await novaCachePUT(jsonRequest({ cacheTtlMinutes: 120 }));
    expect(setNovaCacheTtlMinutes).toHaveBeenCalledWith(120, "u1");
  });
});

describe("GET/PUT /api/settings/seguridad-config", () => {
  beforeEach(resetAll);
  it("PUT responde 403 si no es Administrador", async () => {
    mockSession({ role: "ASISTENTE_GH" });
    expect((await seguridadConfigPUT(jsonRequest({ passwordMinLength: 8 }))).status).toBe(403);
  });
  it("GET devuelve los 4 valores vigentes", async () => {
    mockSession({});
    expect(await (await seguridadConfigGET()).json()).toEqual({
      passwordMinLength: 6,
      sessionDurationDefaultHours: 168,
      sessionDurationRememberHours: 720,
      retentionLoginAttemptsDays: "30",
    });
  });
  it("PUT rechaza una retención de intentos de login fuera de las opciones permitidas", async () => {
    mockSession({ role: "ADMINISTRADOR" });
    const res = await seguridadConfigPUT(jsonRequest({ retentionLoginAttemptsDays: "45" }));
    expect(res.status).toBe(400);
    expect(setRetentionLoginAttempts).not.toHaveBeenCalled();
  });
  it("PUT guarda los 4 valores como Administrador", async () => {
    mockSession({ role: "ADMINISTRADOR" });
    await seguridadConfigPUT(
      jsonRequest({
        passwordMinLength: 8,
        sessionDurationDefaultHours: 72,
        sessionDurationRememberHours: 168,
        retentionLoginAttemptsDays: "60",
      })
    );
    expect(setPasswordMinLength).toHaveBeenCalledWith(8, "u1");
    expect(setSessionDurationDefaultHours).toHaveBeenCalledWith(72, "u1");
    expect(setSessionDurationRememberHours).toHaveBeenCalledWith(168, "u1");
    expect(setRetentionLoginAttempts).toHaveBeenCalledWith("60", "u1");
  });
});

describe("GET/PATCH /api/settings/favorites", () => {
  beforeEach(resetAll);
  it("401 sin sesión", async () => {
    mockSession(null);
    expect((await favoritesGET()).status).toBe(401);
  });
  it("GET devuelve los favoritos del usuario en sesión", async () => {
    mockSession({ userId: "u1" });
    getConfigFavoritesForUser.mockResolvedValue(["holidays", "nova-cache"]);
    expect(await (await favoritesGET()).json()).toEqual({ favorites: ["holidays", "nova-cache"] });
  });
  it("PATCH rechaza cuerpo sin settingId/pinned", async () => {
    mockSession({});
    expect((await favoritesPATCH(jsonRequest({}))).status).toBe(400);
  });
  it("PATCH marca/desmarca un favorito para el usuario en sesión (cualquier rol)", async () => {
    mockSession({ userId: "u2", role: "ASISTENTE_GH" });
    const res = await favoritesPATCH(jsonRequest({ settingId: "holidays", pinned: true }));
    expect(res.status).toBe(200);
    expect(setConfigFavorite).toHaveBeenCalledWith("u2", "holidays", true);
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
  it("devuelve las filas mapeadas para las claves pedidas", async () => {
    mockSession({ role: "ADMINISTRADOR" });
    systemConfigHistoryFindMany.mockResolvedValue([
      {
        key: "a",
        value: "5",
        validFrom: new Date("2026-01-01T00:00:00Z"),
        validUntil: null,
        updater: { name: "Ana" },
      },
    ]);
    const res = await configHistoryGET(urlRequest("http://localhost/api/settings/config-history?keys=a,b"));
    const body = await res.json();
    expect(body).toEqual([
      { key: "a", value: "5", validFrom: "2026-01-01T00:00:00.000Z", validUntil: null, updatedByName: "Ana" },
    ]);
    expect(systemConfigHistoryFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { key: { in: ["a", "b"] } } })
    );
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
  it("restaura cada clave a su valor por defecto vía setConfigValue", async () => {
    mockSession({ role: "ADMINISTRADOR", userId: "admin1" });
    const res = await restoreDefaultPOST(jsonRequest({ defaults: { key_a: "1", key_b: "2" } }));
    expect(res.status).toBe(200);
    expect(setConfigValue).toHaveBeenCalledWith("key_a", "1", "admin1");
    expect(setConfigValue).toHaveBeenCalledWith("key_b", "2", "admin1");
  });
});
