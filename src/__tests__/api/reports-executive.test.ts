import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { SessionPayload } from "@/lib/session";
import type { NextRequest } from "next/server";

const userFindMany = vi.fn();
const userFindUnique = vi.fn();
const taskFindMany = vi.fn();
const taskFindFirst = vi.fn();
const taskActivityFindMany = vi.fn();
const taskActivityFindFirst = vi.fn();
const activityReasonFindMany = vi.fn();
const specialStatusFindMany = vi.fn();
const holidayFindMany = vi.fn();
const systemConfigHistoryCount = vi.fn();
const monthClosureFindUnique = vi.fn();
const monthlyReportFindUnique = vi.fn();
const executiveReportSnapshotCreate = vi.fn();
const executiveReportSnapshotFindUnique = vi.fn();
const executiveReportSnapshotFindMany = vi.fn();
const executiveReportSnapshotCount = vi.fn();
const executiveReportAuditLogCreate = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findMany: userFindMany, findUnique: userFindUnique },
    task: { findMany: taskFindMany, findFirst: taskFindFirst },
    taskActivity: { findMany: taskActivityFindMany, findFirst: taskActivityFindFirst },
    activityReason: { findMany: activityReasonFindMany },
    specialStatus: { findMany: specialStatusFindMany },
    holiday: { findMany: holidayFindMany },
    systemConfigHistory: { count: systemConfigHistoryCount },
    monthClosure: { findUnique: monthClosureFindUnique },
    monthlyReport: { findUnique: monthlyReportFindUnique },
    executiveReportSnapshot: {
      create: executiveReportSnapshotCreate,
      findUnique: executiveReportSnapshotFindUnique,
      findMany: executiveReportSnapshotFindMany,
      count: executiveReportSnapshotCount,
    },
    executiveReportAuditLog: { create: executiveReportAuditLogCreate },
  },
}));

vi.mock("@/lib/session", () => ({ getSession: vi.fn() }));

const monthlyBusinessBase = vi.fn();
vi.mock("@/lib/workload", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/workload")>();
  return {
    ...actual,
    monthlyBusinessBase: (...a: unknown[]) => monthlyBusinessBase(...a),
    monthlyBusinessBaseForUsers: async (_userIds: string[], year: number, month: number) => ({
      shared: await monthlyBusinessBase(year, month),
      perUser: new Map(),
    }),
  };
});

const { getSession } = await import("@/lib/session");
const { POST: executivePOST } = await import("@/app/api/reports/executive/route");
const { GET: executiveGetById } = await import("@/app/api/reports/executive/[reportId]/route");
const { GET: executiveList } = await import("@/app/api/reports/executive/list/route");

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
        },
  );
}

function getRequest(url: string): NextRequest {
  return { nextUrl: new URL(url) } as unknown as NextRequest;
}

function resetAll() {
  userFindMany.mockReset().mockResolvedValue([]);
  userFindUnique.mockReset().mockResolvedValue({ kpiStartDate: null, createdAt: new Date("2000-01-01") });
  taskFindMany.mockReset().mockResolvedValue([]);
  taskFindFirst.mockReset().mockResolvedValue(null);
  taskActivityFindMany.mockReset().mockResolvedValue([]);
  taskActivityFindFirst.mockReset().mockResolvedValue(null);
  activityReasonFindMany.mockReset().mockResolvedValue([]);
  specialStatusFindMany.mockReset().mockResolvedValue([]);
  holidayFindMany.mockReset().mockResolvedValue([]);
  systemConfigHistoryCount.mockReset().mockResolvedValue(1);
  monthClosureFindUnique.mockReset().mockResolvedValue(null);
  monthlyReportFindUnique.mockReset().mockResolvedValue(null);
  executiveReportSnapshotCreate.mockReset();
  executiveReportSnapshotFindUnique.mockReset();
  executiveReportSnapshotFindMany.mockReset().mockResolvedValue([]);
  executiveReportSnapshotCount.mockReset().mockResolvedValue(0);
  executiveReportAuditLogCreate.mockReset().mockResolvedValue({});
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

describe("POST /api/reports/executive", () => {
  beforeEach(resetAll);

  it("responde 401/403 según sesión y permisos", async () => {
    mockSession(null);
    expect((await executivePOST(getRequest("http://localhost/api/reports/executive?tipoReporte=MENSUAL&month=2026-06"))).status).toBe(401);
    mockSession({ role: "ASISTENTE_GH" });
    expect((await executivePOST(getRequest("http://localhost/api/reports/executive?tipoReporte=MENSUAL&month=2026-06"))).status).toBe(403);
  });

  it("responde 400 si falta month para MENSUAL", async () => {
    mockSession({ role: "JEFE_NACIONAL" });
    const res = await executivePOST(getRequest("http://localhost/api/reports/executive?tipoReporte=MENSUAL"));
    expect(res.status).toBe(400);
  });

  it("responde 400 con tipoReporte inválido", async () => {
    mockSession({ role: "JEFE_NACIONAL" });
    const res = await executivePOST(getRequest("http://localhost/api/reports/executive?tipoReporte=INVALIDO"));
    expect(res.status).toBe(400);
  });

  it("genera y persiste un snapshot con Report ID, y audita 'generated'", async () => {
    mockSession({ role: "JEFE_NACIONAL", userId: "u1", name: "Ana" });
    executiveReportSnapshotCreate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => data);

    const res = await executivePOST(getRequest("http://localhost/api/reports/executive?tipoReporte=MENSUAL&month=2026-06"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.reportId).toMatch(/^NXR-\d{8}-\d{6}-/);
    expect(executiveReportSnapshotCreate).toHaveBeenCalledTimes(1);
    expect(executiveReportAuditLogCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: "generated" }) }));
  });
});

describe("GET /api/reports/executive/[reportId]", () => {
  beforeEach(resetAll);

  function ctx(reportId: string) {
    return { params: Promise.resolve({ reportId }) };
  }

  it("responde 404 si no existe", async () => {
    mockSession({ role: "JEFE_NACIONAL" });
    executiveReportSnapshotFindUnique.mockResolvedValue(null);
    const res = await executiveGetById(getRequest("http://localhost/api/reports/executive/NXR-XX"), ctx("NXR-XX"));
    expect(res.status).toBe(404);
  });

  it("responde 403 si el scope del reporte no coincide con el del visor", async () => {
    mockSession({ role: "COORDINADOR_NACIONAL" });
    executiveReportSnapshotFindUnique.mockResolvedValue({ scope: "JEFE", reportId: "NXR-1", generator: { name: "Ana" } });
    const res = await executiveGetById(getRequest("http://localhost/api/reports/executive/NXR-1"), ctx("NXR-1"));
    expect(res.status).toBe(403);
  });

  it("devuelve el snapshot y audita 'viewed' cuando el scope coincide", async () => {
    mockSession({ role: "JEFE_NACIONAL" });
    executiveReportSnapshotFindUnique.mockResolvedValue({
      reportId: "NXR-1",
      type: "MENSUAL",
      scope: "JEFE",
      origin: "GENERATED",
      integrityFlag: "FULL",
      periodLabel: "Junio 2026",
      periodStart: new Date("2026-06-01"),
      periodEnd: new Date("2026-06-30"),
      fechaCorte: new Date("2026-06-30"),
      periodStatus: "CERRADO",
      collaboratorCount: 2,
      generatedAt: new Date("2026-06-30"),
      generationMs: 500,
      analyticsEngineVersion: "1.5.0",
      formulaSetVersion: "4.4",
      reportingEngineVersion: "2.0",
      nexoVersion: "1.21.0",
      data: {},
      nova: null,
      novaDegraded: false,
      dataQuality: { pct: 90, issues: [] },
      generator: { name: "Ana" },
    });
    const res = await executiveGetById(getRequest("http://localhost/api/reports/executive/NXR-1"), ctx("NXR-1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.report.reportId).toBe("NXR-1");
    expect(executiveReportAuditLogCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: "viewed" }) }));
  });
});

describe("GET /api/reports/executive/list", () => {
  beforeEach(resetAll);

  it("responde 401/403 según sesión y permisos", async () => {
    mockSession(null);
    expect((await executiveList(getRequest("http://localhost/api/reports/executive/list"))).status).toBe(401);
    mockSession({ role: "ASISTENTE_GH" });
    expect((await executiveList(getRequest("http://localhost/api/reports/executive/list"))).status).toBe(403);
  });

  it("pagina y filtra por scope del visor", async () => {
    mockSession({ role: "COORDINADOR_NACIONAL" });
    executiveReportSnapshotCount.mockResolvedValue(1);
    executiveReportSnapshotFindMany.mockResolvedValue([
      {
        reportId: "NXR-1",
        type: "MENSUAL",
        scope: "COORDINADOR",
        origin: "GENERATED",
        integrityFlag: "FULL",
        periodLabel: "Junio 2026",
        periodStatus: "CERRADO",
        collaboratorCount: 3,
        generatedAt: new Date("2026-06-30"),
        generator: { name: "Ana" },
      },
    ]);
    const res = await executiveList(getRequest("http://localhost/api/reports/executive/list"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total).toBe(1);
    expect(body.reports).toHaveLength(1);
    expect(executiveReportSnapshotFindMany.mock.calls[0][0].where).toEqual({ scope: "COORDINADOR" });
  });
});
