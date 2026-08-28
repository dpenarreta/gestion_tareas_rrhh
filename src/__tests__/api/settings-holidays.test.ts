import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SessionPayload } from "@/lib/session";

// Cutover de stack (ver docs/AUDIT_LOG.md § 2026-08-24, Fase 52): pasó de
// leer/escribir Postgres a ser un wrapper delgado sobre Django
// (`HolidayListView`/`HolidayDetailView`, Fase 29) — mockeado con
// `@/lib/djangoSession`. Se detectó y corrigió en el backend, en el mismo
// cambio, que `GET` exigía ADMINISTRADOR por error (el `route.ts` original
// nunca lo restringió) — ver `docs/AUDIT_LOG.md` § 2026-08-24.
const getSession = vi.fn();
vi.mock("@/lib/session", () => ({ getSession: (...args: unknown[]) => getSession(...args) }));

const djangoApiFetch = vi.fn();
vi.mock("@/lib/djangoSession", () => ({
  djangoApiFetch: (...args: unknown[]) => djangoApiFetch(...args),
  extractDjangoFlatErrorMessage: async (response: Response) => (await response.json().catch(() => null))?.error,
}));

const { GET: holidaysGET, POST: holidaysPOST } = await import("@/app/api/settings/holidays/route");
const { DELETE: holidayDELETE } = await import("@/app/api/settings/holidays/[id]/route");

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

function badJsonRequest() {
  return { json: async () => { throw new Error("bad"); } } as never;
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

describe("GET /api/settings/holidays", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await holidaysGET(getRequest("http://localhost/api/settings/holidays"));
    expect(res.status).toBe(401);
  });

  it("no exige rol Administrador para leer (cualquier autenticado puede consultar el calendario)", async () => {
    mockSession({ role: "ASISTENTE_GH" });
    djangoApiFetch.mockResolvedValue(djangoResponse(true, []));
    const res = await holidaysGET(getRequest("http://localhost/api/settings/holidays"));
    expect(res.status).toBe(200);
  });

  it("sin year, no agrega query string", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(true, []));
    await holidaysGET(getRequest("http://localhost/api/settings/holidays"));
    expect(djangoApiFetch).toHaveBeenCalledWith("/settings/holidays/");
  });

  it("con year filtra por el año dado y mapea el id a string", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(true, [{ id: 5, date: "2026-01-01", name: "Año Nuevo", year: 2026 }]));
    const res = await holidaysGET(getRequest("http://localhost/api/settings/holidays?year=2026"));
    expect(djangoApiFetch).toHaveBeenCalledWith("/settings/holidays/?year=2026");
    const body = await res.json();
    expect(body).toEqual([{ id: "5", date: "2026-01-01", name: "Año Nuevo", year: 2026 }]);
  });
});

describe("POST /api/settings/holidays", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión, sin llamar a Django", async () => {
    mockSession(null);
    expect((await holidaysPOST(jsonRequest({}))).status).toBe(401);
    expect(djangoApiFetch).not.toHaveBeenCalled();
  });

  it("responde 403 si Django rechaza por permisos", async () => {
    mockSession({ role: "COORDINADOR_NACIONAL" });
    djangoApiFetch.mockResolvedValue(djangoResponse(false, { error: "Sin permisos" }, 403));
    const res = await holidaysPOST(jsonRequest({ date: "2026-01-01", name: "Feriado" }));
    expect(res.status).toBe(403);
  });

  it("responde 400 si el body no es JSON válido", async () => {
    mockSession({});
    const res = await holidaysPOST(badJsonRequest());
    expect(res.status).toBe(400);
  });

  it("responde 400 si falta la fecha o el nombre, sin llamar a Django", async () => {
    mockSession({});
    expect((await holidaysPOST(jsonRequest({ name: "Feriado" }))).status).toBe(400);
    expect((await holidaysPOST(jsonRequest({ date: "2026-01-01", name: "  " }))).status).toBe(400);
    expect(djangoApiFetch).not.toHaveBeenCalled();
  });

  it("responde 409 si ya existe un feriado en esa fecha", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(false, { error: "Ya existe un feriado registrado en esa fecha" }, 409));
    const res = await holidaysPOST(jsonRequest({ date: "2026-01-01", name: "Año Nuevo" }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("Ya existe un feriado registrado en esa fecha");
  });

  it("crea el feriado, recorta el nombre y mapea el id a string", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(true, { id: 9, date: "2026-08-10", name: "Primer Grito de Independencia", year: 2026 }));
    const res = await holidaysPOST(jsonRequest({ date: "2026-08-10", name: "  Primer Grito de Independencia  " }));
    expect(res.status).toBe(201);
    expect(djangoApiFetch).toHaveBeenCalledWith("/settings/holidays/", {
      method: "POST",
      body: JSON.stringify({ date: "2026-08-10", name: "Primer Grito de Independencia" }),
    });
    const body = await res.json();
    expect(body).toEqual({ id: "9", date: "2026-08-10", name: "Primer Grito de Independencia", year: 2026 });
  });
});

describe("DELETE /api/settings/holidays/[id]", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await holidayDELETE(jsonRequest(undefined), ctx());
    expect(res.status).toBe(401);
  });

  it("responde 403 si Django rechaza por permisos", async () => {
    mockSession({ role: "JEFE_NACIONAL" });
    djangoApiFetch.mockResolvedValue(djangoResponse(false, { error: "Sin permisos" }, 403));
    const res = await holidayDELETE(jsonRequest(undefined), ctx());
    expect(res.status).toBe(403);
  });

  it("responde 404 si el feriado no existe", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(false, {}, 404));
    const res = await holidayDELETE(jsonRequest(undefined), ctx());
    expect(res.status).toBe(404);
  });

  it("elimina el feriado existente", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(true, { ok: true }));
    const res = await holidayDELETE(jsonRequest(undefined), ctx("5"));
    expect(res.status).toBe(200);
    expect(djangoApiFetch).toHaveBeenCalledWith("/settings/holidays/5/", { method: "DELETE" });
  });
});
