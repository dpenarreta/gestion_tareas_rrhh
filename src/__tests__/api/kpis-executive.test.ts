import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SessionPayload } from "@/lib/session";

// Cutover de stack (ver docs/AUDIT_LOG.md § 2026-08-24): esta ruta pasó de
// ~15 líneas de composición sobre el motor central (ya portado a Django
// desde la Fase 21) a un reenvío directo. La lógica de negocio
// (overview/ranking/alertas/trend/bloque CEO) ya la cubre la suite de
// Django — acá solo se prueba ruteo y el mapeo genérico snake_case→camelCase.
vi.mock("@/lib/session", () => ({ getSession: vi.fn() }));

const djangoApiFetch = vi.fn();
vi.mock("@/lib/djangoSession", () => ({
  djangoApiFetch: (...args: unknown[]) => djangoApiFetch(...args),
}));

const { getSession } = await import("@/lib/session");
const { GET: executiveGET } = await import("@/app/api/kpis/executive/route");

function mockSession(overrides: Partial<SessionPayload> | null) {
  vi.mocked(getSession).mockResolvedValue(
    overrides === null
      ? null
      : {
          userId: "jefe-1",
          role: "JEFE_NACIONAL",
          name: "Jefe",
          email: "jefe@nexo.com",
          expiresAt: new Date(Date.now() + 100000).toISOString(),
          ...overrides,
        }
  );
}

function resetAll() {
  vi.mocked(getSession).mockReset();
  djangoApiFetch.mockReset();
}

function djangoResponse(ok: boolean, data: unknown, status = ok ? 200 : 400) {
  return { ok, status, json: async () => data } as Response;
}

describe("GET /api/kpis/executive", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await executiveGET();
    expect(res.status).toBe(401);
    expect(djangoApiFetch).not.toHaveBeenCalled();
  });

  it("responde 403 si Django rechaza por nivel jerárquico insuficiente", async () => {
    mockSession({ role: "ASISTENTE_GH" });
    djangoApiFetch.mockResolvedValue(djangoResponse(false, { error: "Sin permisos" }, 403));
    const res = await executiveGET();
    expect(res.status).toBe(403);
  });

  it("mapea el payload de Django a camelCase (recursivo, incluidas listas anidadas)", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(
      djangoResponse(true, {
        overview: { avg_cumplimiento: 62 },
        ranking: [{ id: "sub1", low_cumplimiento: false }],
        alerts: {
          low_cumplimiento: [{ user_id: "sub2", value: 25 }],
          pending_ideas: [{ title: "Idea pendiente", author_name: "Carla" }],
        },
        workload: [{ user_id: "sub1", carga_pct: 80 }],
        trend: [{ month: "2026-08" }],
      })
    );
    const res = await executiveGET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.overview.avgCumplimiento).toBe(62);
    expect(body.ranking[0]).toMatchObject({ id: "sub1", lowCumplimiento: false });
    expect(body.alerts.lowCumplimiento[0]).toMatchObject({ userId: "sub2", value: 25 });
    expect(body.alerts.pendingIdeas[0]).toMatchObject({ title: "Idea pendiente", authorName: "Carla" });
    expect(body.workload[0]).toMatchObject({ userId: "sub1", cargaPct: 80 });
    expect(djangoApiFetch).toHaveBeenCalledWith("/kpis/executive/");
  });
});
