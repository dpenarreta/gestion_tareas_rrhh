import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SessionPayload } from "@/lib/session";
import type { NextRequest } from "next/server";

// Cutover de stack (ver docs/AUDIT_LOG.md § 2026-08-24): estas 10 rutas
// pasaron de composición sobre el motor central (ya portado a Django entre
// las Fases 16-24) a reenvíos directos — mismo patrón que
// `analytics/[userId]/route.ts` (Fase 4m). La lógica de negocio (jerarquía,
// cálculos, redistribución greedy, notificación de riesgo alto, etc.) ya la
// cubre la suite de Django — acá solo se prueba ruteo, forwarding de query
// params/body y el mapeo genérico snake_case→camelCase.
const getSession = vi.fn();
vi.mock("@/lib/session", () => ({ getSession: (...args: unknown[]) => getSession(...args) }));

const djangoApiFetch = vi.fn();
vi.mock("@/lib/djangoSession", () => ({
  djangoApiFetch: (...args: unknown[]) => djangoApiFetch(...args),
  ANALYTICS_BUNDLE_TIMEOUT_MS: 12000,
}));

const { GET: insightsGET } = await import("@/app/api/analytics/insights/[userId]/route");
const { GET: equilibrioGET } = await import("@/app/api/analytics/equilibrio/[userId]/route");
const { GET: benchmarksGET } = await import("@/app/api/analytics/benchmarks/[userId]/route");
const { POST: simulatePOST } = await import("@/app/api/analytics/simulate/[userId]/route");
const { GET: operationalRiskGET } = await import("@/app/api/analytics/operational-risk/[userId]/route");
const { GET: operationalRiskTeamGET } = await import("@/app/api/analytics/operational-risk/team/route");
const { GET: recommendationsTeamGET } = await import("@/app/api/analytics/recommendations/team/route");
const { GET: historyGET } = await import("@/app/api/analytics/history/[userId]/route");
const { GET: targetTimeGET } = await import("@/app/api/analytics/target-time/[userId]/route");
const { GET: dataQualityGET } = await import("@/app/api/analytics/data-quality/route");

function mockSession(overrides: Partial<SessionPayload> | null) {
  getSession.mockResolvedValue(
    overrides === null
      ? null
      : {
          userId: "u1",
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

function ctx(userId = "target-1") {
  return { params: Promise.resolve({ userId }) };
}

function resetAll() {
  getSession.mockReset();
  djangoApiFetch.mockReset();
}

function djangoResponse(ok: boolean, data: unknown, status = ok ? 200 : 400) {
  return { ok, status, json: async () => data } as Response;
}

// Rutas GET con userId en el path: mismo contrato (401/404/403/200 + mapeo).
const userScopedRoutes: Array<{
  name: string;
  path: string;
  handler: (request: Request, ctx: { params: Promise<{ userId: string }> }) => Promise<Response>;
}> = [
  { name: "insights", path: "/analytics/insights", handler: insightsGET },
  { name: "equilibrio", path: "/analytics/equilibrio", handler: equilibrioGET },
  { name: "benchmarks", path: "/analytics/benchmarks", handler: benchmarksGET },
  { name: "operational-risk", path: "/analytics/operational-risk", handler: operationalRiskGET },
  { name: "target-time", path: "/analytics/target-time", handler: targetTimeGET },
];

describe.each(userScopedRoutes)("GET /api/$name/[userId]", ({ path, handler }) => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await handler(new Request("http://localhost"), ctx());
    expect(res.status).toBe(401);
    expect(djangoApiFetch).not.toHaveBeenCalled();
  });

  it("responde 404 si el usuario objetivo no existe", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(false, {}, 404));
    const res = await handler(new Request("http://localhost"), ctx());
    expect(res.status).toBe(404);
  });

  it("responde 403 si el objetivo está fuera de la jerarquía visible", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(false, {}, 403));
    const res = await handler(new Request("http://localhost"), ctx());
    expect(res.status).toBe(403);
  });

  it("reenvía userId a Django y mapea la respuesta a camelCase", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(true, { low_cumplimiento: true, sub_items: [{ user_id: "a" }] }));
    const res = await handler(new Request("http://localhost"), ctx("target-1"));
    expect(res.status).toBe(200);
    // Primer argumento (la ruta) es el contrato que importa acá — algunos de
    // estos endpoints (insights/operational-risk) pasan además un timeout
    // extendido como 3er argumento (ver ANALYTICS_BUNDLE_TIMEOUT_MS,
    // docs/AUDIT_LOG.md § 2026-08-31), sin efecto sobre este test.
    expect(djangoApiFetch.mock.calls[0][0]).toBe(`${path}/target-1/`);
    const body = await res.json();
    expect(body).toEqual({ lowCumplimiento: true, subItems: [{ userId: "a" }] });
  });
});

describe("POST /api/analytics/simulate/[userId]", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await simulatePOST(new Request("http://localhost", { method: "POST", body: "{}" }), ctx());
    expect(res.status).toBe(401);
  });

  it("responde 404 si el usuario objetivo no existe", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(false, {}, 404));
    const res = await simulatePOST(new Request("http://localhost", { method: "POST", body: "{}" }), ctx());
    expect(res.status).toBe(404);
  });

  it("responde 403 si el objetivo está fuera de la jerarquía visible", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(false, {}, 403));
    const res = await simulatePOST(new Request("http://localhost", { method: "POST", body: "{}" }), ctx());
    expect(res.status).toBe(403);
  });

  it("responde 400 con mensaje genérico si el escenario es inválido", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(false, { error: "detalle interno" }, 400));
    const res = await simulatePOST(new Request("http://localhost", { method: "POST", body: "{}" }), ctx());
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Escenario inválido");
  });

  it("reenvía el body tal cual a Django y mapea la respuesta a camelCase", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(true, { resultado_estimado: 80 }));
    const scenario = { target_hours: 40 };
    const res = await simulatePOST(
      new Request("http://localhost", { method: "POST", body: JSON.stringify(scenario) }),
      ctx("target-1")
    );
    expect(res.status).toBe(200);
    expect(djangoApiFetch).toHaveBeenCalledWith("/analytics/simulate/target-1/", {
      method: "POST",
      body: JSON.stringify(scenario),
    });
    const body = await res.json();
    expect(body).toEqual({ resultadoEstimado: 80 });
  });
});

// Rutas GET sin userId en el path (agregados de equipo): sin rama 404.
const teamRoutes: Array<{
  name: string;
  path: string;
  handler: () => Promise<Response>;
}> = [
  { name: "operational-risk/team", path: "/analytics/operational-risk/team/", handler: operationalRiskTeamGET },
  { name: "recommendations/team", path: "/analytics/recommendations/team/", handler: recommendationsTeamGET },
];

describe.each(teamRoutes)("GET /api/$name", ({ path, handler }) => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await handler();
    expect(res.status).toBe(401);
    expect(djangoApiFetch).not.toHaveBeenCalled();
  });

  it("responde 403 si Django rechaza por permisos", async () => {
    mockSession({ role: "ASISTENTE_GH" });
    djangoApiFetch.mockResolvedValue(djangoResponse(false, {}, 403));
    const res = await handler();
    expect(res.status).toBe(403);
  });

  it("mapea la respuesta de Django a camelCase", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(true, { high_risk_users: [{ user_id: "sub1" }] }));
    const res = await handler();
    expect(res.status).toBe(200);
    expect(djangoApiFetch.mock.calls[0][0]).toBe(path);
    const body = await res.json();
    expect(body).toEqual({ highRiskUsers: [{ userId: "sub1" }] });
  });
});

describe("GET /api/analytics/history/[userId]", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await historyGET(getRequest("http://localhost/api/analytics/history/target-1"), ctx());
    expect(res.status).toBe(401);
  });

  it("responde 404 si el usuario objetivo no existe", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(false, {}, 404));
    const res = await historyGET(getRequest("http://localhost/api/analytics/history/target-1"), ctx());
    expect(res.status).toBe(404);
  });

  it("sin kind/months, no agrega query string", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(true, {}));
    await historyGET(getRequest("http://localhost/api/analytics/history/target-1"), ctx("target-1"));
    expect(djangoApiFetch).toHaveBeenCalledWith("/analytics/history/target-1/");
  });

  it("reenvía kind y months como query params y mapea la respuesta", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(true, { data_points: [{ month_label: "Ago" }] }));
    const res = await historyGET(
      getRequest("http://localhost/api/analytics/history/target-1?kind=cumplimiento&months=6"),
      ctx("target-1")
    );
    expect(res.status).toBe(200);
    expect(djangoApiFetch).toHaveBeenCalledWith("/analytics/history/target-1/?kind=cumplimiento&months=6");
    const body = await res.json();
    expect(body).toEqual({ dataPoints: [{ monthLabel: "Ago" }] });
  });
});

describe("GET /api/analytics/data-quality", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await dataQualityGET(getRequest("http://localhost/api/analytics/data-quality"));
    expect(res.status).toBe(401);
    expect(djangoApiFetch).not.toHaveBeenCalled();
  });

  it("responde 403 si Django rechaza scope=team para un rol de nivel 1", async () => {
    mockSession({ role: "ASISTENTE_GH" });
    djangoApiFetch.mockResolvedValue(djangoResponse(false, {}, 403));
    const res = await dataQualityGET(getRequest("http://localhost/api/analytics/data-quality?scope=team"));
    expect(res.status).toBe(403);
  });

  it("sin scope, usa self por defecto", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(true, {}));
    await dataQualityGET(getRequest("http://localhost/api/analytics/data-quality"));
    expect(djangoApiFetch).toHaveBeenCalledWith("/analytics/data-quality/?scope=self");
  });

  it("con scope inválido, normaliza a self", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(true, {}));
    await dataQualityGET(getRequest("http://localhost/api/analytics/data-quality?scope=otro"));
    expect(djangoApiFetch).toHaveBeenCalledWith("/analytics/data-quality/?scope=self");
  });

  it("reenvía scope=team y mapea la respuesta a camelCase", async () => {
    mockSession({ role: "JEFE_NACIONAL" });
    djangoApiFetch.mockResolvedValue(djangoResponse(true, { missing_fields_count: 3 }));
    const res = await dataQualityGET(getRequest("http://localhost/api/analytics/data-quality?scope=team"));
    expect(res.status).toBe(200);
    expect(djangoApiFetch).toHaveBeenCalledWith("/analytics/data-quality/?scope=team");
    const body = await res.json();
    expect(body).toEqual({ missingFieldsCount: 3 });
  });
});
