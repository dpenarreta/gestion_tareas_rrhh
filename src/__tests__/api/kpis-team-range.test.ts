import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { SessionPayload } from "@/lib/session";
import type { NextRequest } from "next/server";

// GET /api/kpis/team pasó a Django en el cutover de stack (Fase 47, ver
// docs/AUDIT_LOG.md § 2026-08-24) — mockeado con `@/lib/djangoSession`, el
// cálculo real ya vive en `TeamKpiView`. GET /api/kpis/me/range pasó a
// Django en la Fase 4c (ver docs/AUDIT_LOG.md § 2026-08-11) — mockeado
// igual; el cálculo real (validación de from/to, agregación por mes) ya no
// vive en `route.ts`, se movió a `KpiMeRangeView`.
const getSession = vi.fn();
vi.mock("@/lib/session", () => ({ getSession: (...args: unknown[]) => getSession(...args) }));

const djangoApiFetch = vi.fn();
vi.mock("@/lib/djangoSession", () => ({
  djangoApiFetch: (...args: unknown[]) => djangoApiFetch(...args),
}));

const { GET: teamGET } = await import("@/app/api/kpis/team/route");
const { GET: rangeGET } = await import("@/app/api/kpis/me/range/route");

function mockSession(overrides: Partial<SessionPayload> | null) {
  getSession.mockResolvedValue(
    overrides === null
      ? null
      : {
          djangoUserId: 1,
          role: "JEFE_NACIONAL",
          name: "Ana",
          email: "test@nexo.com",
          expiresAt: new Date(Date.now() + 100000).toISOString(),
          ...overrides,
        }
  );
}

function getRequest(url: string): NextRequest {
  return { nextUrl: new URL(url) } as unknown as NextRequest;
}

function djangoResponse(ok: boolean, data: unknown, status = ok ? 200 : 400) {
  return { ok, status, json: async () => data } as Response;
}

function resetAll() {
  getSession.mockReset();
  djangoApiFetch.mockReset();
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 7, 1));
});
afterEach(() => {
  vi.useRealTimers();
});

describe("GET /api/kpis/team", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await teamGET(getRequest("http://localhost/api/kpis/team"));
    expect(res.status).toBe(401);
    expect(djangoApiFetch).not.toHaveBeenCalled();
  });

  it("responde 403 si Django rechaza por permisos", async () => {
    mockSession({ role: "ASISTENTE_GH" });
    djangoApiFetch.mockResolvedValue(djangoResponse(false, { error: "Sin permisos" }, 403));
    const res = await teamGET(getRequest("http://localhost/api/kpis/team"));
    expect(res.status).toBe(403);
  });

  it("reenvía month como query string y mapea el payload a camelCase", async () => {
    mockSession({ role: "JEFE_NACIONAL" });
    djangoApiFetch.mockResolvedValue(
      djangoResponse(true, {
        users: [{ id: "sub1", name: "Ana", completed_pct: 50, carga_ratio: 67, total_tasks: 2, score: 46 }],
      })
    );

    const res = await teamGET(getRequest("http://localhost/api/kpis/team?month=2026-06"));
    expect(res.status).toBe(200);
    expect(djangoApiFetch).toHaveBeenCalledWith("/kpis/team/?month=2026-06");
    const body = await res.json();
    expect(body.users[0]).toMatchObject({ id: "sub1", completedPct: 50, cargaRatio: 67, totalTasks: 2 });
  });
});

describe("GET /api/kpis/me/range", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await rangeGET(getRequest("http://localhost/api/kpis/me/range?from=2026-01&to=2026-02"));
    expect(res.status).toBe(401);
  });

  it("responde 401 si Django no tiene sesión disponible", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(null);
    const res = await rangeGET(getRequest("http://localhost/api/kpis/me/range?from=2026-01&to=2026-02"));
    expect(res.status).toBe(401);
  });

  it("responde 400 con el mensaje de Django si faltan los parámetros from/to", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(false, { detail: "Faltan los parámetros from/to" }, 400));
    const res = await rangeGET(getRequest("http://localhost/api/kpis/me/range"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Faltan los parámetros from/to");
  });

  it("reenvía from/to como query string y devuelve el reporte mapeado a camelCase", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(
      djangoResponse(true, { report: { months: [{ month: "2026-01" }, { month: "2026-02" }], total_tasks: 2 } })
    );

    const res = await rangeGET(getRequest("http://localhost/api/kpis/me/range?from=2026-01&to=2026-02"));
    expect(res.status).toBe(200);
    expect(djangoApiFetch).toHaveBeenCalledWith("/kpis/me/range/?from=2026-01&to=2026-02");
    const body = await res.json();
    expect(body.report.months).toHaveLength(2);
    expect(body.report.totalTasks).toBe(2);
  });
});
