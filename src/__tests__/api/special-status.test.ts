import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SessionPayload } from "@/lib/session";

// Cutover de stack (ver docs/AUDIT_LOG.md § 2026-08-24, Fase 52): pasó de
// leer/escribir Postgres a ser un wrapper delgado sobre Django
// (`SpecialStatusListView`/`SpecialStatusDetailView`, Fase 29) — mockeado
// con `@/lib/djangoSession`. El cálculo/validación real ya lo cubre la
// suite de Django (`backend/apps/configuration/tests/test_special_status_view.py`).
// Nunca había tenido ningún test previo (gap preexistente, cerrado acá).
const getSession = vi.fn();
vi.mock("@/lib/session", () => ({ getSession: (...args: unknown[]) => getSession(...args) }));

const djangoApiFetch = vi.fn();
vi.mock("@/lib/djangoSession", () => ({
  djangoApiFetch: (...args: unknown[]) => djangoApiFetch(...args),
  extractDjangoFlatErrorMessage: async (response: Response) => (await response.json().catch(() => null))?.error,
}));

const { GET: specialStatusGET, POST: specialStatusPOST } = await import("@/app/api/settings/special-status/route");
const { PATCH: specialStatusPATCH, DELETE: specialStatusDELETE } = await import(
  "@/app/api/settings/special-status/[id]/route"
);

function mockSession(overrides: Partial<SessionPayload> | null) {
  getSession.mockResolvedValue(
    overrides === null
      ? null
      : {
          userId: "admin-1",
          role: "ADMINISTRADOR",
          name: "Admin",
          email: "admin@nexo.com",
          expiresAt: new Date(Date.now() + 100000).toISOString(),
          ...overrides,
        }
  );
}

function jsonRequest(body: unknown) {
  return { json: async () => body } as never;
}

function getRequest(url: string) {
  return { nextUrl: new URL(url) } as never;
}

function ctx(id = "1") {
  return { params: Promise.resolve({ id }) };
}

function resetAll() {
  getSession.mockReset();
  djangoApiFetch.mockReset();
}

function djangoResponse(ok: boolean, data: unknown, status = ok ? 200 : 400) {
  return { ok, status, json: async () => data } as Response;
}

const DJANGO_RECORD = {
  id: 4,
  userId: 3,
  user: { id: 3, name: "Ana" },
  type: "MATERNIDAD",
  startDate: "2026-07-01",
  endDate: null,
  isActive: true,
  dailyHours: 6,
  limitLow: 3,
  limitBase: 5,
  limitHigh: 6,
  limitOverload: 8,
};

const NEXO_RECORD = { ...DJANGO_RECORD, id: "4", userId: "3", user: { id: "3", name: "Ana" } };

describe("GET /api/settings/special-status", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await specialStatusGET(getRequest("http://localhost/api/settings/special-status"));
    expect(res.status).toBe(401);
  });

  it("responde 403 si Django rechaza por permisos", async () => {
    mockSession({ role: "COORDINADOR_NACIONAL" });
    djangoApiFetch.mockResolvedValue(djangoResponse(false, { error: "Sin permisos" }, 403));
    const res = await specialStatusGET(getRequest("http://localhost/api/settings/special-status"));
    expect(res.status).toBe(403);
  });

  it("reenvía userId como user_id y mapea los ids a string", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(true, [DJANGO_RECORD]));
    const res = await specialStatusGET(getRequest("http://localhost/api/settings/special-status?userId=3"));
    expect(djangoApiFetch).toHaveBeenCalledWith("/settings/special-status/?user_id=3");
    const body = await res.json();
    expect(body).toEqual([NEXO_RECORD]);
  });
});

describe("POST /api/settings/special-status", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión, sin llamar a Django", async () => {
    mockSession(null);
    const res = await specialStatusPOST(jsonRequest({}));
    expect(res.status).toBe(401);
    expect(djangoApiFetch).not.toHaveBeenCalled();
  });

  it("responde 403 si Django rechaza por permisos", async () => {
    mockSession({ role: "COORDINADOR_NACIONAL" });
    djangoApiFetch.mockResolvedValue(djangoResponse(false, { error: "Sin permisos" }, 403));
    const res = await specialStatusPOST(jsonRequest({ userId: "3", type: "MATERNIDAD", startDate: "2026-07-01" }));
    expect(res.status).toBe(403);
  });

  it("responde 400 si faltan campos requeridos o el tipo es inválido, sin llamar a Django", async () => {
    mockSession({});
    expect((await specialStatusPOST(jsonRequest({ userId: "3" }))).status).toBe(400);
    expect(
      (await specialStatusPOST(jsonRequest({ userId: "3", type: "OTRO", startDate: "2026-07-01" }))).status
    ).toBe(400);
    expect(djangoApiFetch).not.toHaveBeenCalled();
  });

  it("responde 404 si el usuario no existe", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(false, { error: "Usuario no encontrado" }, 404));
    const res = await specialStatusPOST(
      jsonRequest({
        userId: "999", type: "MATERNIDAD", startDate: "2026-07-01",
        dailyHours: 6, limitLow: 3, limitBase: 5, limitHigh: 6, limitOverload: 8,
      })
    );
    expect(res.status).toBe(404);
  });

  it("propaga un mensaje de validación de Django (ej. orden de límites)", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(
      djangoResponse(false, { error: "Los límites deben cumplir: Subutilización < Moderado/Óptimo ≤ Óptimo/Elevada < Elevada/Sobrecarga" }, 400)
    );
    const res = await specialStatusPOST(
      jsonRequest({
        userId: "3", type: "MATERNIDAD", startDate: "2026-07-01",
        dailyHours: 6, limitLow: 9, limitBase: 5, limitHigh: 6, limitOverload: 8,
      })
    );
    expect(res.status).toBe(400);
  });

  it("traduce el body a snake_case y mapea la respuesta a camelCase", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(true, DJANGO_RECORD, 201));
    const res = await specialStatusPOST(
      jsonRequest({
        userId: "3", type: "MATERNIDAD", startDate: "2026-07-01", endDate: null,
        dailyHours: 6, limitLow: 3, limitBase: 5, limitHigh: 6, limitOverload: 8,
      })
    );
    expect(res.status).toBe(201);
    expect(djangoApiFetch).toHaveBeenCalledWith("/settings/special-status/", {
      method: "POST",
      body: JSON.stringify({
        user_id: "3", type: "MATERNIDAD", start_date: "2026-07-01", end_date: null,
        daily_hours: 6, limit_low: 3, limit_base: 5, limit_high: 6, limit_overload: 8,
      }),
    });
    const body = await res.json();
    expect(body).toEqual(NEXO_RECORD);
  });
});

describe("PATCH /api/settings/special-status/[id]", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await specialStatusPATCH(jsonRequest(undefined), ctx());
    expect(res.status).toBe(401);
  });

  it("responde 403 si Django rechaza por permisos", async () => {
    mockSession({ role: "COORDINADOR_NACIONAL" });
    djangoApiFetch.mockResolvedValue(djangoResponse(false, { error: "Sin permisos" }, 403));
    const res = await specialStatusPATCH(jsonRequest(undefined), ctx());
    expect(res.status).toBe(403);
  });

  it("responde 404 si el estado especial no existe", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(false, {}, 404));
    const res = await specialStatusPATCH(jsonRequest(undefined), ctx());
    expect(res.status).toBe(404);
  });

  it("finaliza el estado especial y mapea la respuesta", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(true, { ...DJANGO_RECORD, isActive: false, endDate: "2026-08-24" }));
    const res = await specialStatusPATCH(jsonRequest(undefined), ctx("4"));
    expect(res.status).toBe(200);
    expect(djangoApiFetch).toHaveBeenCalledWith("/settings/special-status/4/", { method: "PATCH" });
    const body = await res.json();
    expect(body).toMatchObject({ id: "4", isActive: false, endDate: "2026-08-24" });
  });
});

describe("DELETE /api/settings/special-status/[id]", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await specialStatusDELETE(jsonRequest(undefined), ctx());
    expect(res.status).toBe(401);
  });

  it("responde 403 si Django rechaza por permisos", async () => {
    mockSession({ role: "COORDINADOR_NACIONAL" });
    djangoApiFetch.mockResolvedValue(djangoResponse(false, { error: "Sin permisos" }, 403));
    const res = await specialStatusDELETE(jsonRequest(undefined), ctx());
    expect(res.status).toBe(403);
  });

  it("responde 404 si el estado especial no existe", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(false, {}, 404));
    const res = await specialStatusDELETE(jsonRequest(undefined), ctx());
    expect(res.status).toBe(404);
  });

  it("elimina el estado especial existente", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(true, { ok: true }));
    const res = await specialStatusDELETE(jsonRequest(undefined), ctx("4"));
    expect(res.status).toBe(200);
    expect(djangoApiFetch).toHaveBeenCalledWith("/settings/special-status/4/", { method: "DELETE" });
  });
});
