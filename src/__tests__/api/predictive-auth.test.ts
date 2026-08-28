import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SessionPayload } from "@/lib/session";

// Cutover de stack (ver docs/AUDIT_LOG.md § 2026-08-24): las 6 rutas GET de
// Inteligencia Preventiva pasaron de calcular en Next.js/Prisma
// (`predictionEngine.ts`/`trendEngine.ts`/`preventiveIntelligence.ts`) a ser
// un wrapper delgado sobre Django (`PredictionBundleView`/`TrendEngineView`/
// `PreventiveAlertsView`/`TeamPreventiveAlertsView`/`TeamSubutilizationView`/
// `ProjectDelayView`, Fase 9). Acá solo se cubre lo que el wrapper de
// Next.js realmente hace: sesión, forwarding de userId/projectId/weeksBack,
// status codes, mapeo snake_case→camelCase — el cálculo real ya lo cubre la
// suite de Django.
const getSession = vi.fn();
vi.mock("@/lib/session", () => ({ getSession: (...args: unknown[]) => getSession(...args) }));

const djangoApiFetch = vi.fn();
vi.mock("@/lib/djangoSession", () => ({
  djangoApiFetch: (...args: unknown[]) => djangoApiFetch(...args),
}));

const { GET: predictionsGET } = await import("@/app/api/predictive/predictions/[userId]/route");
const { GET: trendGET } = await import("@/app/api/predictive/trend/[userId]/route");
const { GET: alertsGET } = await import("@/app/api/predictive/alerts/[userId]/route");
const { GET: teamAlertsGET } = await import("@/app/api/predictive/team-alerts/route");
const { GET: teamSubutilizationGET } = await import("@/app/api/predictive/team-subutilization/route");
const { GET: projectDelayGET } = await import("@/app/api/predictive/project-delay/[projectId]/route");

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

function getRequest(url: string) {
  return { nextUrl: new URL(url) } as never;
}

function userCtx(userId = "target-1") {
  return { params: Promise.resolve({ userId }) };
}

function projectCtx(projectId = "project-1") {
  return { params: Promise.resolve({ projectId }) };
}

function resetAll() {
  getSession.mockReset();
  djangoApiFetch.mockReset();
}

function djangoResponse(ok: boolean, data: unknown, status = ok ? 200 : 400) {
  return { ok, status, json: async () => data } as Response;
}

// GET con userId en el path: mismo contrato (401/404/403/200 + mapeo).
const userScopedRoutes: Array<{
  name: string;
  path: string;
  handler: (request: Request, ctx: { params: Promise<{ userId: string }> }) => Promise<Response>;
}> = [
  { name: "predictions", path: "/predictive/predictions", handler: predictionsGET },
  { name: "alerts", path: "/predictive/alerts", handler: alertsGET },
];

describe.each(userScopedRoutes)("GET /api/$name/[userId]", ({ path, handler }) => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await handler(new Request("http://localhost"), userCtx());
    expect(res.status).toBe(401);
    expect(djangoApiFetch).not.toHaveBeenCalled();
  });

  it("responde 404 si el usuario objetivo no existe", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(false, {}, 404));
    const res = await handler(new Request("http://localhost"), userCtx());
    expect(res.status).toBe(404);
  });

  it("responde 403 si el objetivo está fuera de la jerarquía visible", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(false, {}, 403));
    const res = await handler(new Request("http://localhost"), userCtx());
    expect(res.status).toBe(403);
  });

  it("reenvía userId a Django y mapea la respuesta a camelCase", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(true, { task_delays: [{ task_id: 5, title: "x" }] }));
    const res = await handler(new Request("http://localhost"), userCtx("target-1"));
    expect(res.status).toBe(200);
    expect(djangoApiFetch).toHaveBeenCalledWith(`${path}/target-1/`);
    const body = await res.json();
    expect(body).toEqual({ taskDelays: [{ taskId: 5, title: "x" }] });
  });
});

describe("GET /api/predictive/trend/[userId]", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await trendGET(getRequest("http://localhost/api/predictive/trend/target-1"), userCtx());
    expect(res.status).toBe(401);
  });

  it("responde 404 si el usuario objetivo no existe", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(false, {}, 404));
    const res = await trendGET(getRequest("http://localhost/api/predictive/trend/target-1"), userCtx());
    expect(res.status).toBe(404);
  });

  it("sin weeksBack, no agrega query string", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(true, {}));
    await trendGET(getRequest("http://localhost/api/predictive/trend/target-1"), userCtx("target-1"));
    expect(djangoApiFetch).toHaveBeenCalledWith("/predictive/trend/target-1/");
  });

  it("reenvía weeksBack como weeks_back y mapea la respuesta", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(true, { window_weeks: 6 }));
    const res = await trendGET(
      getRequest("http://localhost/api/predictive/trend/target-1?weeksBack=6"),
      userCtx("target-1")
    );
    expect(res.status).toBe(200);
    expect(djangoApiFetch).toHaveBeenCalledWith("/predictive/trend/target-1/?weeks_back=6");
    const body = await res.json();
    expect(body).toEqual({ windowWeeks: 6 });
  });
});

describe("GET /api/predictive/team-alerts", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await teamAlertsGET();
    expect(res.status).toBe(401);
    expect(djangoApiFetch).not.toHaveBeenCalled();
  });

  it("responde 403 si Django rechaza por permisos", async () => {
    mockSession({ role: "ASISTENTE_GH" });
    djangoApiFetch.mockResolvedValue(djangoResponse(false, {}, 403));
    const res = await teamAlertsGET();
    expect(res.status).toBe(403);
  });

  it("mapea la respuesta de Django a camelCase", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(true, { alerts: [{ related_indicator: "cumplimiento" }] }));
    const res = await teamAlertsGET();
    expect(res.status).toBe(200);
    expect(djangoApiFetch).toHaveBeenCalledWith("/predictive/team-alerts/");
    const body = await res.json();
    expect(body).toEqual({ alerts: [{ relatedIndicator: "cumplimiento" }] });
  });
});

describe("GET /api/predictive/team-subutilization", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await teamSubutilizationGET();
    expect(res.status).toBe(401);
    expect(djangoApiFetch).not.toHaveBeenCalled();
  });

  it("responde 403 si Django rechaza por permisos", async () => {
    mockSession({ role: "ASISTENTE_GH" });
    djangoApiFetch.mockResolvedValue(djangoResponse(false, {}, 403));
    const res = await teamSubutilizationGET();
    expect(res.status).toBe(403);
  });

  it("mapea members (user_id→userId) a camelCase", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(
      djangoResponse(true, { members: [{ user_id: 5, name: "Beto", prediction: null }] })
    );
    const res = await teamSubutilizationGET();
    expect(res.status).toBe(200);
    expect(djangoApiFetch).toHaveBeenCalledWith("/predictive/team-subutilization/");
    const body = await res.json();
    expect(body).toEqual({ members: [{ userId: 5, name: "Beto", prediction: null }] });
  });
});

describe("GET /api/predictive/project-delay/[projectId]", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await projectDelayGET(new Request("http://localhost"), projectCtx());
    expect(res.status).toBe(401);
  });

  it("responde 404 si el proyecto no existe", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(false, {}, 404));
    const res = await projectDelayGET(new Request("http://localhost"), projectCtx());
    expect(res.status).toBe(404);
  });

  it("responde 403 sin visibilidad del proyecto", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(false, {}, 403));
    const res = await projectDelayGET(new Request("http://localhost"), projectCtx());
    expect(res.status).toBe(403);
  });

  it("reenvía projectId a Django y mapea la respuesta", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(true, { probabilidad_pct: 40 }));
    const res = await projectDelayGET(new Request("http://localhost"), projectCtx("project-1"));
    expect(res.status).toBe(200);
    expect(djangoApiFetch).toHaveBeenCalledWith("/predictive/project-delay/project-1/");
    const body = await res.json();
    expect(body).toEqual({ probabilidadPct: 40 });
  });
});
