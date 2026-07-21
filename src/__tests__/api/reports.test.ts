import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { SessionPayload } from "@/lib/session";
import type { NextRequest } from "next/server";

const monthlyReportFindUnique = vi.fn();
const monthlyReportFindMany = vi.fn();
const monthlyReportUpsert = vi.fn();
const userFindMany = vi.fn();
const taskFindMany = vi.fn();
const taskActivityFindMany = vi.fn();
const activityReasonFindMany = vi.fn().mockResolvedValue([]);

vi.mock("@/lib/prisma", () => ({
  prisma: {
    monthlyReport: { findUnique: monthlyReportFindUnique, findMany: monthlyReportFindMany, upsert: monthlyReportUpsert },
    user: { findMany: userFindMany },
    task: { findMany: taskFindMany },
    taskActivity: { findMany: taskActivityFindMany },
    activityReason: { findMany: activityReasonFindMany },
  },
}));

vi.mock("@/lib/session", () => ({ getSession: vi.fn() }));

const monthlyBusinessBase = vi.fn();
vi.mock("@/lib/workload", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/workload")>();
  return {
    ...actual,
    monthlyBusinessBase: (...a: unknown[]) => monthlyBusinessBase(...a),
    // Sin usuarios con estado especial en estos tests — perUser vacío hace que los
    // llamadores usen siempre la base compartida (mock de monthlyBusinessBase).
    monthlyBusinessBaseForUsers: async (_userIds: string[], year: number, month: number) => ({
      shared: await monthlyBusinessBase(year, month),
      perUser: new Map(),
    }),
  };
});

class MockGroq {
  chat = { completions: { create: vi.fn() } };
}
vi.mock("groq-sdk", () => ({ default: MockGroq }));

const { getSession } = await import("@/lib/session");
const { GET: reportsGET } = await import("@/app/api/reports/route");
const { POST: generatePOST } = await import("@/app/api/reports/generate/route");
const { GET: rangeGET } = await import("@/app/api/reports/range/route");

function mockSession(overrides: Partial<SessionPayload> | null) {
  vi.mocked(getSession).mockResolvedValue(
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

function resetAll() {
  monthlyReportFindUnique.mockReset();
  monthlyReportFindMany.mockReset();
  monthlyReportUpsert.mockReset();
  userFindMany.mockReset().mockResolvedValue([]);
  taskFindMany.mockReset().mockResolvedValue([]);
  taskActivityFindMany.mockReset().mockResolvedValue([]);
  activityReasonFindMany.mockReset().mockResolvedValue([]);
  monthlyBusinessBase.mockReset().mockImplementation(async (year: number, month: number) => ({
    start: new Date(Date.UTC(year, month - 1, 1)),
    end: new Date(Date.UTC(year, month, 1) - 1),
    businessDays: 20,
    baseHours: 100,
    hoursPerDay: 6.5,
    limitLowPerDay: 5.5,
    limitHighPerDay: 7.5,
    limitOverloadPerDay: 8.5,
    limitLowHours: 80,
    limitHighHours: 120,
    limitOverloadHours: 140,
  }));
  vi.mocked(getSession).mockReset();
  delete process.env.GROQ_API_KEY;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 7, 1));
});
afterEach(() => vi.useRealTimers());

describe("GET /api/reports", () => {
  beforeEach(resetAll);

  it("responde 401/403 según sesión y permisos", async () => {
    mockSession(null);
    expect((await reportsGET(getRequest("http://localhost/api/reports"))).status).toBe(401);
    mockSession({ role: "ASISTENTE_GH" });
    expect((await reportsGET(getRequest("http://localhost/api/reports"))).status).toBe(403);
  });

  it("usa el scope JEFE para JEFE_NACIONAL/ADMINISTRADOR y COORDINADOR para el resto", async () => {
    mockSession({ role: "COORDINADOR_NACIONAL" });
    monthlyReportFindMany.mockResolvedValue([]);
    await reportsGET(getRequest("http://localhost/api/reports"));
    expect(monthlyReportFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { scope: "COORDINADOR" } }));
  });

  it("con ?month, devuelve report=null si no existe informe para ese mes/scope", async () => {
    mockSession({ role: "JEFE_NACIONAL" });
    monthlyReportFindUnique.mockResolvedValue(null);
    const res = await reportsGET(getRequest("http://localhost/api/reports?month=2026-06"));
    const body = await res.json();
    expect(body).toEqual({ report: null });
  });

  it("con ?month, devuelve el informe mapeado si existe", async () => {
    mockSession({ role: "JEFE_NACIONAL" });
    monthlyReportFindUnique.mockResolvedValue({
      id: "r1", month: 6, year: 2026, scope: "JEFE", data: {}, aiAnalysis: "",
      generator: { name: "Ana" }, createdAt: new Date("2026-07-01"), updatedAt: new Date("2026-07-01"),
    });
    const res = await reportsGET(getRequest("http://localhost/api/reports?month=2026-06"));
    const body = await res.json();
    expect(body.report).toMatchObject({ id: "r1", generatedBy: "Ana" });
  });

  it("sin ?month, lista todos los informes del scope, ordenados desc", async () => {
    mockSession({ role: "JEFE_NACIONAL" });
    monthlyReportFindMany.mockResolvedValue([]);
    await reportsGET(getRequest("http://localhost/api/reports"));
    expect(monthlyReportFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: [{ year: "desc" }, { month: "desc" }] })
    );
  });
});

describe("POST /api/reports/generate", () => {
  beforeEach(resetAll);

  it("responde 401/403 según sesión y permisos", async () => {
    mockSession(null);
    expect((await generatePOST(getRequest("http://localhost/api/reports/generate"))).status).toBe(401);
    mockSession({ role: "ASISTENTE_GH" });
    expect((await generatePOST(getRequest("http://localhost/api/reports/generate"))).status).toBe(403);
  });

  it("excluye siempre a ADMINISTRADOR, y también a JEFE_NACIONAL en scope COORDINADOR", async () => {
    mockSession({ role: "COORDINADOR_NACIONAL" });
    monthlyReportUpsert.mockResolvedValue({ id: "r1", month: 6, year: 2026, scope: "COORDINADOR", data: {}, aiAnalysis: "", generator: { name: "Ana" }, createdAt: new Date(), updatedAt: new Date() });
    await generatePOST(getRequest("http://localhost/api/reports/generate?month=2026-06"));
    expect(userFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { role: { notIn: ["ADMINISTRADOR", "JEFE_NACIONAL"] } } })
    );
  });

  it("genera y guarda (upsert) el informe consolidado, marcando alertas de bajo cumplimiento", async () => {
    mockSession({ role: "JEFE_NACIONAL", userId: "u1" });
    userFindMany.mockResolvedValue([{ id: "sub1", name: "Ana", role: "ASISTENTE_GH" }]);
    taskFindMany.mockResolvedValue([
      { assignedToId: "sub1", createdById: "sub1", status: "PENDIENTE", endDate: new Date("2026-06-05"), progress: 0, type: "FIJA", frequency: "PUNTUAL", estimatedHours: 4, realHours: 0 },
    ]);
    monthlyReportUpsert.mockImplementation(async ({ create }: { create: Record<string, unknown> }) => ({
      id: "r1", month: 6, year: 2026, scope: "JEFE", data: create.data, aiAnalysis: "",
      generator: { name: "Ana" }, createdAt: new Date(), updatedAt: new Date(),
    }));

    const res = await generatePOST(getRequest("http://localhost/api/reports/generate?month=2026-06"));
    expect(res.status).toBe(200);
    expect(monthlyReportUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { month_year_scope: { month: 6, year: 2026, scope: "JEFE" } } })
    );
    const body = await res.json();
    expect(body.report.data.alerts).toEqual([{ userId: "sub1", name: "Ana", type: "cumplimiento", value: 0 }]);
    expect(body.report.aiAnalysis).toBe(""); // sin GROQ_API_KEY
  });

  it("responde 500 ante un error inesperado", async () => {
    mockSession({ role: "JEFE_NACIONAL" });
    userFindMany.mockRejectedValue(new Error("db"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await generatePOST(getRequest("http://localhost/api/reports/generate?month=2026-06"));
    expect(res.status).toBe(500);
  });
});

describe("GET /api/reports/range", () => {
  beforeEach(resetAll);

  it("responde 401/403 según sesión y permisos", async () => {
    mockSession(null);
    expect((await rangeGET(getRequest("http://localhost/api/reports/range?from=2026-01&to=2026-02"))).status).toBe(401);
    mockSession({ role: "ASISTENTE_GH" });
    expect((await rangeGET(getRequest("http://localhost/api/reports/range?from=2026-01&to=2026-02"))).status).toBe(403);
  });

  it("responde 400 si faltan from/to", async () => {
    mockSession({ role: "JEFE_NACIONAL" });
    const res = await rangeGET(getRequest("http://localhost/api/reports/range"));
    expect(res.status).toBe(400);
  });

  it("responde 400 si el rango tiene menos de 2 meses", async () => {
    mockSession({ role: "JEFE_NACIONAL" });
    const res = await rangeGET(getRequest("http://localhost/api/reports/range?from=2026-06&to=2026-06"));
    expect(res.status).toBe(400);
  });

  it("responde 400 si el rango supera 24 meses", async () => {
    mockSession({ role: "JEFE_NACIONAL" });
    const res = await rangeGET(getRequest("http://localhost/api/reports/range?from=2024-01&to=2026-06"));
    expect(res.status).toBe(400);
  });

  it("genera un informe de rango válido con equipo vacío, sin fallar", async () => {
    mockSession({ role: "JEFE_NACIONAL" });
    userFindMany.mockResolvedValue([]);
    const res = await rangeGET(getRequest("http://localhost/api/reports/range?from=2026-01&to=2026-02"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.report.months).toHaveLength(2);
    expect(body.report.aggregated.members).toEqual([]);
  });
});
