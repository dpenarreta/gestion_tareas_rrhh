import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { SessionPayload } from "@/lib/session";
import type { NextRequest } from "next/server";

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

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: userFindUnique },
    task: { findMany: taskFindMany, findFirst: taskFindFirst },
    taskActivity: { findMany: taskActivityFindMany, findFirst: taskActivityFindFirst },
    activityReason: { findMany: activityReasonFindMany },
    specialStatus: { findMany: specialStatusFindMany },
    holiday: { findMany: holidayFindMany },
    systemConfigHistory: { count: systemConfigHistoryCount },
    monthClosure: { findUnique: monthClosureFindUnique },
  },
}));

vi.mock("@/lib/session", () => ({ getSession: vi.fn() }));

// Cutover de stack (ver docs/AUDIT_LOG.md § 2026-08-25, Fase 56): la
// PERSISTENCIA de snapshots/auditoría pasó a Django — el CÁLCULO
// (`buildSnapshotForFilters`, mockeado arriba vía Prisma) no cambió.
const djangoApiFetch = vi.fn();
vi.mock("@/lib/djangoSession", () => ({
  djangoApiFetch: (...args: unknown[]) => djangoApiFetch(...args),
}));

function djangoResponse(ok: boolean, data: unknown, status = ok ? 200 : 400) {
  return { ok, status, json: async () => data } as Response;
}

const monthlyBusinessBase = vi.fn();
vi.mock("@/lib/workload", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/workload")>();
  return {
    ...actual,
    monthlyBusinessBase: (...a: unknown[]) => monthlyBusinessBase(...a),
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
          djangoUserId: 1,
          permissions: [],
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

// Cutover de stack (Fase 72, ver docs/AUDIT_LOG.md § 2026-08-26): el
// bloque ReportMemberKpi + agregados de equipo del builder MENSUAL se
// calcula vía Django — bundle vacío coherente con el roster vacío por
// defecto de estos tests (`/reports/roster/` mockeado a `users: []`,
// Fase 87, ver docs/AUDIT_LOG.md § 2026-08-28).
async function defaultDjangoApiFetch(path: string, init?: RequestInit) {
  if (path === "/reports/executive/" && init?.method === "POST") {
    const body = JSON.parse(init.body as string);
    return djangoResponse(true, { report_id: body.report_id }, 201);
  }
  if (path === "/reports/executive/audit/") {
    return djangoResponse(true, {}, 204);
  }
  if (path.startsWith("/reports/roster/")) {
    return djangoResponse(true, { users: [], user_ids: [], scope: "JEFE", roster_kind: "CONSOLIDADO" });
  }
  if (path.startsWith("/reports/monthly-report/")) {
    return djangoResponse(false, { error: "No encontrado" }, 404);
  }
  if (path === "/reports/executive/monthly-team-kpis/") {
    return djangoResponse(true, {
      team_summary: { avg_cumplimiento: 0, avg_carga_pct: 0, total_carga_real_hours: 0, total_carga_base_hours: 0, total_completed_tasks: 0, total_consultas: 0, total_tasks: 0, hours_per_day: 6.5, carga_range_min: 100, carga_range_max: 120 },
      members: [],
      ranking: [],
      distribuciones: { consultas_by_reason: [], risk_quadrant: [] },
      trends: {
        mes_anterior: { label: "Mes anterior", current_value: 0, compare_value: null, delta: null, direction: "sin-datos" },
        trimestre: { label: "Trimestre (prom. 3 meses)", current_value: 0, compare_value: null, delta: null, direction: "sin-datos" },
        semestre: { label: "Semestre (prom. 6 meses)", current_value: 0, compare_value: null, delta: null, direction: "sin-datos" },
      },
      findings: [],
      recommendations: [],
      indicator_explanations: {
        cumplimiento: { meaning: "", why: "", impact: "", action: "" },
        carga: { meaning: "", why: "", impact: "", action: "" },
        consultas: { meaning: "", why: "", impact: "", action: "" },
      },
      alerts: [],
      data_quality: { pct: 100, issues: [] },
      period_status: "CERRADO",
    });
  }
  return djangoResponse(true, {});
}

function resetAll() {
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
  djangoApiFetch.mockReset().mockImplementation(defaultDjangoApiFetch);
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
  delete process.env.GEMINI_API_KEY;
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
    mockSession({ role: "JEFE_NACIONAL", name: "Ana" });

    const res = await executivePOST(getRequest("http://localhost/api/reports/executive?tipoReporte=MENSUAL&month=2026-06"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.reportId).toMatch(/^NXR-\d{8}-\d{6}-/);

    const createCall = djangoApiFetch.mock.calls.find((c) => c[0] === "/reports/executive/");
    expect(createCall).toBeDefined();

    const auditCalls = djangoApiFetch.mock.calls.filter((c) => c[0] === "/reports/executive/audit/");
    const generatedCall = auditCalls.find((c) => JSON.parse(c[1].body).action === "generated");
    expect(generatedCall).toBeDefined();
    // FPS Parte IV §9 — "filtros aplicados" es un campo de auditoría obligatorio, antes ausente.
    const auditBody = JSON.parse(generatedCall![1].body);
    expect(auditBody.filters_applied).toMatchObject({ periodo: { tipoReporte: "MENSUAL", month: 6, year: 2026 } });
  });

  it("responde 500 y audita 'generation_failed' con mensaje técnico (nunca expuesto al cliente) ante un error inesperado", async () => {
    mockSession({ role: "JEFE_NACIONAL", name: "Ana" });
    djangoApiFetch.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path.startsWith("/reports/roster/")) throw new Error("db down");
      return defaultDjangoApiFetch(path, init);
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await executivePOST(getRequest("http://localhost/api/reports/executive?tipoReporte=MENSUAL&month=2026-06"));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Error al generar el informe");
    expect(body.error).not.toContain("db down");

    const auditCalls = djangoApiFetch.mock.calls.filter((c) => c[0] === "/reports/executive/audit/");
    const failureCall = auditCalls.find((c) => JSON.parse(c[1].body).action === "generation_failed");
    expect(failureCall).toBeDefined();
    const failureBody = JSON.parse(failureCall![1].body);
    expect(failureBody.message).toContain("db down");
    expect(failureBody.report_id).toMatch(/^NXR-\d{8}-\d{6}-/);
  });
});

describe("GET /api/reports/executive/[reportId]", () => {
  beforeEach(resetAll);

  function ctx(reportId: string) {
    return { params: Promise.resolve({ reportId }) };
  }

  // Cutover de stack (ver docs/AUDIT_LOG.md § 2026-08-25, Fase 56): réplica
  // de `ExecutiveReportDetailView` (backend, Fase 8) — visibilidad por
  // `scope`, `ensureSnapshotMeta` y la auditoría `viewed` ya viven ahí, con
  // su propia cobertura en `backend/apps/reports/tests/`. Acá solo se
  // prueba ruteo/mapeo snake_case→camelCase.
  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await executiveGetById(getRequest("http://localhost/api/reports/executive/NXR-XX"), ctx("NXR-XX"));
    expect(res.status).toBe(401);
    expect(djangoApiFetch).not.toHaveBeenCalled();
  });

  it("responde 401 si Django no tiene sesión disponible", async () => {
    mockSession({ role: "JEFE_NACIONAL" });
    djangoApiFetch.mockResolvedValue(null);
    const res = await executiveGetById(getRequest("http://localhost/api/reports/executive/NXR-XX"), ctx("NXR-XX"));
    expect(res.status).toBe(401);
  });

  it("responde 404 si no existe", async () => {
    mockSession({ role: "JEFE_NACIONAL" });
    djangoApiFetch.mockResolvedValue(djangoResponse(false, { error: "Reporte no encontrado" }, 404));
    const res = await executiveGetById(getRequest("http://localhost/api/reports/executive/NXR-XX"), ctx("NXR-XX"));
    expect(res.status).toBe(404);
  });

  it("responde 403 si el scope del reporte no coincide con el del visor", async () => {
    mockSession({ role: "COORDINADOR_NACIONAL" });
    djangoApiFetch.mockResolvedValue(djangoResponse(false, { error: "Sin permisos" }, 403));
    const res = await executiveGetById(getRequest("http://localhost/api/reports/executive/NXR-1"), ctx("NXR-1"));
    expect(res.status).toBe(403);
  });

  it("devuelve el snapshot mapeado a camelCase cuando el scope coincide", async () => {
    mockSession({ role: "JEFE_NACIONAL" });
    djangoApiFetch.mockResolvedValue(
      djangoResponse(true, {
        report: {
          report_id: "NXR-1",
          type: "MENSUAL",
          scope: "JEFE",
          origin: "GENERATED",
          integrity_flag: "FULL",
          period_label: "Junio 2026",
          period_start: "2026-06-01T00:00:00Z",
          period_end: "2026-06-30T00:00:00Z",
          fecha_corte: "2026-06-30T00:00:00Z",
          period_status: "CERRADO",
          collaborator_count: 2,
          generated_by: "Ana",
          generated_at: "2026-06-30T00:00:00Z",
          generation_ms: 500,
          analytics_engine_version: "1.5.0",
          formula_set_version: "4.4",
          reporting_engine_version: "2.0",
          nexo_version: "1.21.0",
          data: { meta: { reportId: "NXR-1" } },
          nova: null,
          nova_degraded: false,
          data_quality: { pct: 90, issues: [] },
        },
      })
    );
    const res = await executiveGetById(getRequest("http://localhost/api/reports/executive/NXR-1"), ctx("NXR-1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.report.reportId).toBe("NXR-1");
    expect(body.report.generatedBy).toBe("Ana");
    expect(body.report.dataQuality).toEqual({ pct: 90, issues: [] });
    expect(djangoApiFetch).toHaveBeenCalledWith("/reports/executive/NXR-1/");
  });
});

describe("GET /api/reports/executive/list", () => {
  beforeEach(resetAll);

  // Cutover de stack (ver docs/AUDIT_LOG.md § 2026-08-25, Fase 56): réplica
  // de `ExecutiveReportListView` (backend, Fase 8) — paginación y filtro por
  // `scope` ya viven ahí.
  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await executiveList(getRequest("http://localhost/api/reports/executive/list"));
    expect(res.status).toBe(401);
    expect(djangoApiFetch).not.toHaveBeenCalled();
  });

  it("responde 403 si el rol no puede acceder a reportes", async () => {
    mockSession({ role: "ASISTENTE_GH" });
    djangoApiFetch.mockResolvedValue(djangoResponse(false, { error: "Sin permisos" }, 403));
    const res = await executiveList(getRequest("http://localhost/api/reports/executive/list"));
    expect(res.status).toBe(403);
  });

  it("pagina y mapea la lista a camelCase, reenviando los query params", async () => {
    mockSession({ role: "COORDINADOR_NACIONAL" });
    djangoApiFetch.mockResolvedValue(
      djangoResponse(true, {
        page: 1,
        page_size: 20,
        total: 1,
        reports: [
          {
            report_id: "NXR-1",
            type: "MENSUAL",
            scope: "COORDINADOR",
            origin: "GENERATED",
            integrity_flag: "FULL",
            period_label: "Junio 2026",
            period_status: "CERRADO",
            collaborator_count: 3,
            generated_by: "Ana",
            generated_at: "2026-06-30T00:00:00Z",
          },
        ],
      })
    );
    const res = await executiveList(getRequest("http://localhost/api/reports/executive/list?page=1&pageSize=20"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total).toBe(1);
    expect(body.reports[0].reportId).toBe("NXR-1");
    expect(body.reports[0].generatedBy).toBe("Ana");
    expect(djangoApiFetch).toHaveBeenCalledWith("/reports/executive/list/?page=1&pageSize=20");
    expect(body.reports).toHaveLength(1);
  });
});
