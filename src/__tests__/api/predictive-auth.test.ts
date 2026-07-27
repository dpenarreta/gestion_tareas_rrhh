import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SessionPayload } from "@/lib/session";

const userFindUnique = vi.fn();
const projectFindUnique = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: (...a: unknown[]) => userFindUnique(...a), findMany: vi.fn().mockResolvedValue([]) },
    project: { findUnique: (...a: unknown[]) => projectFindUnique(...a) },
  },
}));

vi.mock("@/lib/session", () => ({ getSession: vi.fn() }));

// cached() como passthrough — estos tests validan autenticación/autorización
// de la ruta, no el cálculo del motor (cubierto en trendEngine.test.ts /
// predictionEngine.test.ts).
vi.mock("@/lib/analytics", () => ({
  cached: async (_key: string, _ttl: number, compute: () => Promise<unknown>) => ({ value: await compute(), fromCache: false }),
}));
vi.mock("@/lib/systemConfig", () => ({ getEffectiveAnalyticsConfig: vi.fn().mockResolvedValue({ cacheTtlMinutes: 15 }) }));

vi.mock("@/lib/trendEngine", () => ({ computeTrendEngine: vi.fn().mockResolvedValue({ userId: "u1", windowWeeks: 3, indicators: {}, engineVersion: "1.0.0", generatedAt: "" }) }));
vi.mock("@/lib/predictionEngine", () => ({
  computeSubutilizacionPredictions: vi.fn().mockResolvedValue(new Map()),
  computeProjectDelayPrediction: vi.fn().mockResolvedValue({ available: false, reason: "sin datos" }),
}));
vi.mock("@/lib/preventiveIntelligence", () => ({ computePreventiveAlerts: vi.fn().mockResolvedValue([]) }));

const { getSession } = await import("@/lib/session");
const { GET: trendGET } = await import("@/app/api/predictive/trend/[userId]/route");
const { GET: alertsGET } = await import("@/app/api/predictive/alerts/[userId]/route");
const { GET: teamSubutilizationGET } = await import("@/app/api/predictive/team-subutilization/route");
const { GET: projectDelayGET } = await import("@/app/api/predictive/project-delay/[projectId]/route");

function mockSession(overrides: Partial<SessionPayload> | null) {
  vi.mocked(getSession).mockResolvedValue(
    overrides === null
      ? null
      : { userId: "u1", role: "ASISTENTE_GH", name: "Ana", email: "a@nexo.com", expiresAt: new Date(Date.now() + 100000).toISOString(), ...overrides }
  );
}

function getRequest(url = "http://localhost/x") {
  return { nextUrl: new URL(url) } as never;
}
function userCtx(userId: string) {
  return { params: Promise.resolve({ userId }) };
}
function projectCtx(projectId: string) {
  return { params: Promise.resolve({ projectId }) };
}

describe("GET /api/predictive/trend/[userId] — auth (mismo patrón que /api/predictive/alerts/[userId])", () => {
  beforeEach(() => {
    userFindUnique.mockReset();
    vi.mocked(getSession).mockReset();
  });

  it("responde 401 sin sesión", async () => {
    mockSession(null);
    const res = await trendGET(getRequest(), userCtx("u1"));
    expect(res.status).toBe(401);
  });

  it("un usuario puede consultar su propio userId sin lookup adicional", async () => {
    mockSession({ userId: "u1" });
    const res = await trendGET(getRequest(), userCtx("u1"));
    expect(res.status).toBe(200);
    expect(userFindUnique).not.toHaveBeenCalled();
  });

  it("responde 403 si el rol del solicitante no ve el rol del usuario objetivo", async () => {
    mockSession({ userId: "u1", role: "ASISTENTE_GH" }); // VISIBLE_ROLES[ASISTENTE_GH] = [ASISTENTE_GH] únicamente
    userFindUnique.mockResolvedValue({ role: "JEFE_NACIONAL" });
    const res = await trendGET(getRequest(), userCtx("u2"));
    expect(res.status).toBe(403);
  });

  it("responde 200 si el rol del solicitante SÍ ve el rol del usuario objetivo", async () => {
    mockSession({ userId: "leader-1", role: "JEFE_NACIONAL" });
    userFindUnique.mockResolvedValue({ role: "ASISTENTE_GH" });
    const res = await trendGET(getRequest(), userCtx("u2"));
    expect(res.status).toBe(200);
  });

  it("responde 403 si el usuario objetivo no existe (evita filtrar existencia de cuentas)", async () => {
    mockSession({ userId: "u1", role: "ASISTENTE_GH" });
    userFindUnique.mockResolvedValue(null);
    const res = await trendGET(getRequest(), userCtx("no-existe"));
    expect(res.status).toBe(403);
  });
});

describe("GET /api/predictive/alerts/[userId] — mismo esquema de auth", () => {
  beforeEach(() => {
    userFindUnique.mockReset();
    vi.mocked(getSession).mockReset();
  });

  it("responde 401 sin sesión", async () => {
    mockSession(null);
    const res = await alertsGET(getRequest(), userCtx("u1"));
    expect(res.status).toBe(401);
  });

  it("responde 403 para un rol sin visibilidad sobre el usuario objetivo", async () => {
    mockSession({ userId: "u1", role: "ASISTENTE_GH" });
    userFindUnique.mockResolvedValue({ role: "JEFE_NACIONAL" });
    const res = await alertsGET(getRequest(), userCtx("u2"));
    expect(res.status).toBe(403);
  });
});

describe("GET /api/predictive/team-subutilization", () => {
  beforeEach(() => vi.mocked(getSession).mockReset());

  it("responde 401 sin sesión", async () => {
    mockSession(null);
    const res = await teamSubutilizationGET();
    expect(res.status).toBe(401);
  });

  it("responde 403 para un rol de nivel 1 (canViewTeam=false)", async () => {
    mockSession({ role: "ASISTENTE_GH" });
    const res = await teamSubutilizationGET();
    expect(res.status).toBe(403);
  });

  it("responde 200 para un rol con visibilidad de equipo", async () => {
    mockSession({ role: "COORDINADOR_ZS" });
    const res = await teamSubutilizationGET();
    expect(res.status).toBe(200);
  });
});

describe("GET /api/predictive/project-delay/[projectId]", () => {
  beforeEach(() => {
    projectFindUnique.mockReset();
    vi.mocked(getSession).mockReset();
  });

  it("responde 401 sin sesión", async () => {
    mockSession(null);
    const res = await projectDelayGET(getRequest(), projectCtx("p1"));
    expect(res.status).toBe(401);
  });

  it("responde 404 si el proyecto no existe", async () => {
    mockSession({ userId: "u1" });
    projectFindUnique.mockResolvedValue(null);
    const res = await projectDelayGET(getRequest(), projectCtx("p1"));
    expect(res.status).toBe(404);
  });

  it("responde 403 si no es responsable/creador/participante ni liderazgo (nivel < 3)", async () => {
    mockSession({ userId: "u1", role: "ASISTENTE_GH" });
    projectFindUnique.mockResolvedValue({ responsibleId: "other-1", createdById: "other-2", participants: [] });
    const res = await projectDelayGET(getRequest(), projectCtx("p1"));
    expect(res.status).toBe(403);
  });

  it("responde 200 si es el responsable del proyecto", async () => {
    mockSession({ userId: "u1", role: "ASISTENTE_GH" });
    projectFindUnique.mockResolvedValue({ responsibleId: "u1", createdById: "other-2", participants: [] });
    const res = await projectDelayGET(getRequest(), projectCtx("p1"));
    expect(res.status).toBe(200);
  });

  it("responde 200 para liderazgo (nivel >= 3) sin importar responsable/participante", async () => {
    mockSession({ userId: "leader-1", role: "COORDINADOR_NACIONAL" });
    projectFindUnique.mockResolvedValue({ responsibleId: "other-1", createdById: "other-2", participants: [] });
    const res = await projectDelayGET(getRequest(), projectCtx("p1"));
    expect(res.status).toBe(200);
  });
});
