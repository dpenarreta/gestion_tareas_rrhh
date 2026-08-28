import { describe, expect, it, vi, beforeEach } from "vitest";

// Fase 57 de la migración de stack (ver docs/AUDIT_LOG.md § 2026-08-25):
// nunca tuvo cobertura propia — módulo nuevo.
const djangoApiFetch = vi.fn();
vi.mock("@/lib/djangoSession", () => ({
  djangoApiFetch: (...args: unknown[]) => djangoApiFetch(...args),
}));

const { resolveDjangoIdsForRoster, fetchPerformanceAndHealth } = await import(
  "@/lib/executiveReporting/djangoAnalyticsBridge"
);

function djangoResponse(ok: boolean, data: unknown, status = ok ? 200 : 400) {
  return { ok, status, json: async () => data } as Response;
}

describe("resolveDjangoIdsForRoster", () => {
  beforeEach(() => djangoApiFetch.mockReset());

  it("devuelve un Map vacío sin llamar a Django si el roster está vacío", async () => {
    const result = await resolveDjangoIdsForRoster([]);
    expect(result.size).toBe(0);
    expect(djangoApiFetch).not.toHaveBeenCalled();
  });

  it("devuelve un Map vacío si Django no tiene sesión disponible", async () => {
    djangoApiFetch.mockResolvedValue(null);
    const result = await resolveDjangoIdsForRoster(["cuid-1"]);
    expect(result.size).toBe(0);
  });

  it("devuelve un Map vacío si Django responde un error", async () => {
    djangoApiFetch.mockResolvedValue(djangoResponse(false, { error: "forbidden" }, 403));
    const result = await resolveDjangoIdsForRoster(["cuid-1"]);
    expect(result.size).toBe(0);
  });

  it("mapea legacy_postgres_id -> id numérico, ignorando los que no matchean", async () => {
    djangoApiFetch.mockResolvedValue(
      djangoResponse(true, [
        { legacy_postgres_id: "cuid-1", id: 7 },
        { legacy_postgres_id: "cuid-2", id: 8 },
      ])
    );
    const result = await resolveDjangoIdsForRoster(["cuid-1", "cuid-2", "cuid-3"]);
    expect(result.get("cuid-1")).toBe(7);
    expect(result.get("cuid-2")).toBe(8);
    expect(result.has("cuid-3")).toBe(false);
    expect(djangoApiFetch).toHaveBeenCalledWith("/reports/user-lookup/?legacy_ids=cuid-1%2Ccuid-2%2Ccuid-3");
  });
});

describe("fetchPerformanceAndHealth", () => {
  beforeEach(() => djangoApiFetch.mockReset());

  it("devuelve null si Django no tiene sesión disponible", async () => {
    djangoApiFetch.mockResolvedValue(null);
    const result = await fetchPerformanceAndHealth(7);
    expect(result).toBeNull();
  });

  it("devuelve null si Django responde un error (colaborador no visible)", async () => {
    djangoApiFetch.mockResolvedValue(djangoResponse(false, { error: "forbidden" }, 403));
    const result = await fetchPerformanceAndHealth(7);
    expect(result).toBeNull();
  });

  it("extrae performanceScore/healthScore/healthFactors del bundle", async () => {
    djangoApiFetch.mockResolvedValue(
      djangoResponse(true, {
        performance_score: { score: 82.5, factors: [] },
        health_score: {
          score: 74.2,
          classification: "Bueno",
          factors: [{ name: "Consistencia", detail: "...", raw_label: "Variable" }],
        },
        alerts: [],
      })
    );
    const result = await fetchPerformanceAndHealth(7);
    expect(result).toEqual({
      performanceScore: 82.5,
      healthScore: 74.2,
      healthFactors: [{ name: "Consistencia", detail: "...", rawLabel: "Variable" }],
    });
    expect(djangoApiFetch).toHaveBeenCalledWith("/analytics/7/");
  });
});
