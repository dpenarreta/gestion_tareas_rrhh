import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SessionPayload } from "@/lib/session";

// Cutover de stack (ver docs/AUDIT_LOG.md § 2026-08-24): esta ruta nunca
// tuvo cobertura de test (gap preexistente desde su creación) — se agrega
// en el mismo cambio que el cutover, mismo criterio que la Fase 39/47/52.
// `resolveDjangoUserId` se mockea con la misma réplica mínima usada en
// `users-id.test.ts` (Fase 40): usa `session.djangoUserId` si está presente.
const getSession = vi.fn();
vi.mock("@/lib/session", () => ({ getSession: (...args: unknown[]) => getSession(...args) }));

const djangoApiFetch = vi.fn();
vi.mock("@/lib/djangoSession", () => ({
  djangoApiFetch: (...args: unknown[]) => djangoApiFetch(...args),
  ANALYTICS_BUNDLE_TIMEOUT_MS: 12000,
  resolveDjangoUserId: async (session: { djangoUserId?: number }) => {
    if (typeof session.djangoUserId === "number") return session.djangoUserId;
    const response = await djangoApiFetch("/auth/me/");
    if (!response || !response.ok) return null;
    const me = await response.json();
    return me.id;
  },
}));

// Cutover de stack (ver docs/AUDIT_LOG.md § 2026-08-25, Fase 59): el TTL de
// caché de Nova pasó de Prisma (`getEffectiveNovaCacheTtlMinutes`) a Django
// (`GET /settings/nova-cache/`, `djangoNovaCacheConfig.ts`).
const fetchDjangoNovaCacheTtlMinutes = vi.fn();
vi.mock("@/lib/djangoNovaCacheConfig", () => ({
  fetchDjangoNovaCacheTtlMinutes: (...a: unknown[]) => fetchDjangoNovaCacheTtlMinutes(...a),
}));

const geminiGenerate = vi.fn();
class MockGoogleGenAI {
  models = { generateContent: (...a: unknown[]) => geminiGenerate(...a) };
}
vi.mock("@google/genai", () => ({ GoogleGenAI: MockGoogleGenAI }));

const { GET: novaInsightsGET } = await import("@/app/api/kpis/nova-insights/[userId]/route");

function mockSession(overrides: Partial<SessionPayload> & { djangoUserId?: number }) {
  getSession.mockResolvedValue({
    userId: "u1",
    role: "ADMINISTRADOR",
    name: "Ana",
    email: "test@nexo.com",
    expiresAt: new Date(Date.now() + 100000).toISOString(),
    ...overrides,
  });
}

function djangoResponse(ok: boolean, data: unknown, status = ok ? 200 : 400) {
  return { ok, status, json: async () => data } as Response;
}

function ctx(userId: string) {
  return { params: Promise.resolve({ userId }) };
}

const BUNDLE = {
  healthScore: {
    score: 82,
    classification: "Bueno",
    factors: [{ name: "Cumplimiento", detail: "85% cumplido", rawLabel: "85%" }],
  },
  alerts: [{ severity: "orange", message: "Sobrecarga detectada" }],
  trends: {
    cumplimiento: { mesAnterior: { available: true, direction: "mejora", absoluteDiff: 5 }, promedio6Meses: { available: false } },
    carga: { mesAnterior: { available: false } },
  },
  consistency: { value: 1 },
  anomalies: [],
  prediction: { available: false },
  dataQuality: { validatedPct: 90 },
};

const KPI_PAYLOAD = {
  user: { id: "999", name: "Marco Colaborador", role: "ANALISTA_CC" },
  cargaTiempo: { mensual: { specialStatusType: null } },
};

const RISK_PAYLOAD = {
  score: 40,
  classification: "Moderado",
  trendVsPrevMonth: "estable",
  factors: [{ points: 5, detail: "Sobrecarga leve" }],
  suggestedActions: ["Redistribuir una tarea"],
};

function mockDjangoRoutes(userId: string, opts: { risk?: boolean } = {}) {
  djangoApiFetch.mockImplementation(async (path: string) => {
    if (path === `/analytics/${userId}/`) return djangoResponse(true, BUNDLE);
    if (path === `/kpis/${userId}/`) return djangoResponse(true, { ...KPI_PAYLOAD, user: { ...KPI_PAYLOAD.user, id: userId } });
    if (opts.risk && path === `/analytics/operational-risk/${userId}/`) return djangoResponse(true, RISK_PAYLOAD);
    throw new Error(`ruta Django inesperada en el mock: ${path}`);
  });
}

function resetAll() {
  getSession.mockReset();
  djangoApiFetch.mockReset();
  fetchDjangoNovaCacheTtlMinutes.mockReset().mockResolvedValue(240);
  geminiGenerate.mockReset();
  delete process.env.GEMINI_API_KEY;
}

describe("GET /api/kpis/nova-insights/[userId]", () => {
  beforeEach(resetAll);

  it("401 sin sesión", async () => {
    getSession.mockResolvedValue(null);
    const res = await novaInsightsGET(undefined as never, ctx("7"));
    expect(res.status).toBe(401);
  });

  it("modo motivacional para el propio perfil de un nivel 1 — solo llama al bundle, no a /kpis/ ni operational-risk", async () => {
    mockSession({ role: "ASISTENTE_GH", djangoUserId: 7, name: "Marco" });
    mockDjangoRoutes("7");
    const res = await novaInsightsGET(undefined as never, ctx("7"));
    const body = await res.json();
    expect(body.mode).toBe("motivational");
    expect(Array.isArray(body.messages)).toBe(true);
    expect(djangoApiFetch.mock.calls.some((c) => c[0] === "/analytics/7/")).toBe(true);
    expect(djangoApiFetch.mock.calls.some((c) => c[0] === "/kpis/7/")).toBe(false);
  });

  it("modo insights-only para un nivel 2 viendo a otra persona — sin riesgo operativo, sin riesgos/recomendaciones en la respuesta", async () => {
    mockSession({ role: "ANALISTA_CC", djangoUserId: 1 });
    mockDjangoRoutes("8");
    const res = await novaInsightsGET(undefined as never, ctx("8"));
    const body = await res.json();
    expect(body.mode).toBe("insights-only");
    expect(body.hallazgoPrincipal).toBeTruthy();
    expect(body.riesgos).toBeUndefined();
    expect(body.recomendaciones).toBeUndefined();
    expect(djangoApiFetch.mock.calls.some((c) => c[0] === "/analytics/operational-risk/8/")).toBe(false);
  });

  it("modo completo para un nivel >= 3 viendo a otra persona — incluye riesgo operativo", async () => {
    mockSession({ role: "ADMINISTRADOR", djangoUserId: 1 });
    mockDjangoRoutes("9", { risk: true });
    const res = await novaInsightsGET(undefined as never, ctx("9"));
    const body = await res.json();
    expect(body.mode).toBe("full");
    expect(body.riesgos).toBeDefined();
    expect(body.recomendaciones).toEqual(["Redistribuir una tarea"]);
    expect(djangoApiFetch.mock.calls.some((c) => c[0] === "/analytics/operational-risk/9/")).toBe(true);
  });

  it("propaga 404 de Django como 'Usuario no encontrado'", async () => {
    mockSession({ role: "ADMINISTRADOR", djangoUserId: 1 });
    djangoApiFetch.mockResolvedValue(djangoResponse(false, { error: "not found" }, 404));
    const res = await novaInsightsGET(undefined as never, ctx("404-id"));
    expect(res.status).toBe(404);
  });

  it("propaga 403 de Django como 'Sin permisos'", async () => {
    mockSession({ role: "ANALISTA_CC", djangoUserId: 1 });
    djangoApiFetch.mockResolvedValue(djangoResponse(false, { error: "forbidden" }, 403));
    const res = await novaInsightsGET(undefined as never, ctx("403-id"));
    expect(res.status).toBe(403);
  });

  it("401 si la sesión de Next.js todavía no tiene acceso a Django", async () => {
    mockSession({ role: "ADMINISTRADOR", djangoUserId: 1 });
    djangoApiFetch.mockResolvedValue(null);
    const res = await novaInsightsGET(undefined as never, ctx("no-django-id"));
    expect(res.status).toBe(401);
  });

  it("responde el resultado cacheado en llamadas repetidas dentro del TTL, sin volver a llamar a Django", async () => {
    mockSession({ role: "ADMINISTRADOR", djangoUserId: 1 });
    mockDjangoRoutes("13", { risk: true });

    const first = await novaInsightsGET(undefined as never, ctx("13"));
    const firstBody = await first.json();
    djangoApiFetch.mockClear();

    const second = await novaInsightsGET(undefined as never, ctx("13"));
    const secondBody = await second.json();
    expect(secondBody.hallazgoPrincipal).toBe(firstBody.hallazgoPrincipal);
    expect(djangoApiFetch).not.toHaveBeenCalled();
  });

  it("dos viewers distintos sobre el mismo colaborador NO comparten la caché — cada uno dispara su propia validación en Django", async () => {
    // Hallazgo de seguridad corregido (ver docs/AUDIT_LOG.md § 2026-09-02,
    // "Bypass de autorización vía caché compartida en Nova Insights"):
    // antes del fix, la clave de caché no incluía al viewer — un segundo
    // viewer con el mismo rol reutilizaba el resultado del primero SIN
    // que Django volviera a validar la jerarquía real sobre ese target.
    mockSession({ role: "ANALISTA_CC", djangoUserId: 1 });
    mockDjangoRoutes("20");
    await novaInsightsGET(undefined as never, ctx("20"));
    djangoApiFetch.mockClear();

    mockSession({ role: "ANALISTA_CC", djangoUserId: 2 }); // mismo rol, viewer distinto
    mockDjangoRoutes("20");
    await novaInsightsGET(undefined as never, ctx("20"));
    expect(djangoApiFetch.mock.calls.some((c) => c[0] === "/analytics/20/")).toBe(true);
  });

  it("un segundo viewer sin visibilidad jerárquica real recibe el 403 de Django, nunca el resultado cacheado del primero", async () => {
    mockSession({ role: "ANALISTA_CC", djangoUserId: 1 });
    mockDjangoRoutes("21");
    const first = await novaInsightsGET(undefined as never, ctx("21"));
    expect(first.status).toBe(200);
    djangoApiFetch.mockReset();

    mockSession({ role: "ANALISTA_CC", djangoUserId: 2 });
    djangoApiFetch.mockResolvedValue(djangoResponse(false, { error: "forbidden" }, 403));
    const second = await novaInsightsGET(undefined as never, ctx("21"));
    expect(second.status).toBe(403);
  });

  it("sin GEMINI_API_KEY, usa el fallback determinista construido a partir del bundle", async () => {
    mockSession({ role: "ADMINISTRADOR", djangoUserId: 1 });
    mockDjangoRoutes("14", { risk: true });
    const res = await novaInsightsGET(undefined as never, ctx("14"));
    const body = await res.json();
    expect(body.hallazgoPrincipal).toMatch(/Equilibrio Operativo/);
    expect(geminiGenerate).not.toHaveBeenCalled();
  });

  it("con GEMINI_API_KEY configurada, usa el resultado generado por la IA", async () => {
    mockSession({ role: "ADMINISTRADOR", djangoUserId: 1 });
    mockDjangoRoutes("15", { risk: true });
    process.env.GEMINI_API_KEY = "test-key";
    geminiGenerate.mockResolvedValue({
      text: JSON.stringify({
        hallazgoPrincipal: "Hallazgo generado por IA",
        riesgos: ["Riesgo 1"],
        aspectosPositivos: ["Positivo 1"],
        recomendaciones: ["Recomendación 1"],
      }),
    });
    const res = await novaInsightsGET(undefined as never, ctx("15"));
    const body = await res.json();
    expect(body.hallazgoPrincipal).toBe("Hallazgo generado por IA");
    expect(body.riesgos).toEqual(["Riesgo 1"]);
  });
});
