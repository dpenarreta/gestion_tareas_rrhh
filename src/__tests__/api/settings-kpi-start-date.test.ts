import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SessionPayload } from "@/lib/session";

// Cutover de stack (ver docs/AUDIT_LOG.md § 2026-08-24, Fase 52): pasó de
// leer/escribir Postgres a ser un wrapper delgado sobre Django
// (`KpiStartDateView`, Fase 31) — mockeado con `@/lib/djangoSession`. Ya
// consumida por el bundle de Analytics/Workload desde la Fase 4a — esta
// config editada desde Ajustes no tenía ningún efecto real hasta este
// cutover (gap preexistente, cerrado acá).
const getSession = vi.fn();
vi.mock("@/lib/session", () => ({ getSession: (...args: unknown[]) => getSession(...args) }));

const djangoApiFetch = vi.fn();
vi.mock("@/lib/djangoSession", () => ({
  djangoApiFetch: (...args: unknown[]) => djangoApiFetch(...args),
  extractDjangoFlatErrorMessage: async (response: Response) => (await response.json().catch(() => null))?.error,
}));

const { GET: kpiStartDateGET, PATCH: kpiStartDatePATCH } = await import("@/app/api/settings/kpi-start-date/route");

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

function resetAll() {
  getSession.mockReset();
  djangoApiFetch.mockReset();
}

function djangoResponse(ok: boolean, data: unknown, status = ok ? 200 : 400) {
  return { ok, status, json: async () => data } as Response;
}

describe("GET /api/settings/kpi-start-date", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión, sin llamar a Django", async () => {
    mockSession(null);
    const res = await kpiStartDateGET();
    expect(res.status).toBe(401);
    expect(djangoApiFetch).not.toHaveBeenCalled();
  });

  it("responde 403 si Django rechaza por permisos", async () => {
    mockSession({ role: "COORDINADOR_NACIONAL" });
    djangoApiFetch.mockResolvedValue(djangoResponse(false, { error: "Sin permisos" }, 403));
    const res = await kpiStartDateGET();
    expect(res.status).toBe(403);
  });

  it("devuelve todos los usuarios mapeados a camelCase (id a string, kpi_start_date a kpiStartDate)", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(
      djangoResponse(true, [{ id: 1, name: "Ana", email: "a@nexo.com", role: "ASISTENTE_GH", kpi_start_date: null }])
    );
    const res = await kpiStartDateGET();
    expect(res.status).toBe(200);
    expect(djangoApiFetch).toHaveBeenCalledWith("/settings/kpi-start-date/");
    const body = await res.json();
    expect(body).toEqual([{ id: "1", name: "Ana", email: "a@nexo.com", role: "ASISTENTE_GH", kpiStartDate: null }]);
  });
});

describe("PATCH /api/settings/kpi-start-date", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión, sin llamar a Django", async () => {
    mockSession(null);
    const res = await kpiStartDatePATCH(jsonRequest({}));
    expect(res.status).toBe(401);
    expect(djangoApiFetch).not.toHaveBeenCalled();
  });

  it("responde 403 si Django rechaza por permisos", async () => {
    mockSession({ role: "JEFE_NACIONAL" });
    djangoApiFetch.mockResolvedValue(djangoResponse(false, { error: "Sin permisos" }, 403));
    const res = await kpiStartDatePATCH(jsonRequest({ userId: "1", kpiStartDate: "2026-07-13" }));
    expect(res.status).toBe(403);
  });

  it("responde 400 si el body no es JSON válido", async () => {
    mockSession({});
    const res = await kpiStartDatePATCH(badJsonRequest());
    expect(res.status).toBe(400);
  });

  it("responde 400 si falta userId, sin llamar a Django", async () => {
    mockSession({});
    const res = await kpiStartDatePATCH(jsonRequest({ kpiStartDate: "2026-07-13" }));
    expect(res.status).toBe(400);
    expect(djangoApiFetch).not.toHaveBeenCalled();
  });

  it("responde 404 si el usuario no existe", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(false, { error: "Usuario no encontrado" }, 404));
    const res = await kpiStartDatePATCH(jsonRequest({ userId: "999", kpiStartDate: "2026-07-13" }));
    expect(res.status).toBe(404);
  });

  it("propaga un mensaje de validación de Django (ej. fecha inválida)", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(false, { error: "Datos inválidos" }, 400));
    const res = await kpiStartDatePATCH(jsonRequest({ userId: "1", kpiStartDate: "13-07-2026" }));
    expect(res.status).toBe(400);
  });

  it("traduce el body a snake_case y mapea la respuesta a camelCase", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(
      djangoResponse(true, { id: 1, name: "Ana", email: "a@nexo.com", role: "ASISTENTE_GH", kpi_start_date: "2026-07-13" })
    );
    const res = await kpiStartDatePATCH(jsonRequest({ userId: "1", kpiStartDate: "2026-07-13" }));
    expect(res.status).toBe(200);
    expect(djangoApiFetch).toHaveBeenCalledWith("/settings/kpi-start-date/", {
      method: "PATCH",
      body: JSON.stringify({ user_id: "1", kpi_start_date: "2026-07-13" }),
    });
    const body = await res.json();
    expect(body).toEqual({ id: "1", name: "Ana", email: "a@nexo.com", role: "ASISTENTE_GH", kpiStartDate: "2026-07-13" });
  });

  it("kpiStartDate null quita el ajuste (lo reenvía como null)", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(
      djangoResponse(true, { id: 1, name: "Ana", email: "a@nexo.com", role: "ASISTENTE_GH", kpi_start_date: null })
    );
    const res = await kpiStartDatePATCH(jsonRequest({ userId: "1", kpiStartDate: null }));
    expect(res.status).toBe(200);
    expect(djangoApiFetch).toHaveBeenCalledWith("/settings/kpi-start-date/", {
      method: "PATCH",
      body: JSON.stringify({ user_id: "1", kpi_start_date: null }),
    });
  });
});
