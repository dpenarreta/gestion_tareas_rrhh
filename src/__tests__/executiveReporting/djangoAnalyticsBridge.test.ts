import { describe, expect, it, vi, beforeEach } from "vitest";

// Fase 57 de la migración de stack (ver docs/AUDIT_LOG.md § 2026-08-25):
// nunca tuvo cobertura propia — módulo nuevo.
const djangoApiFetch = vi.fn();
vi.mock("@/lib/djangoSession", () => ({
  djangoApiFetch: (...args: unknown[]) => djangoApiFetch(...args),
  ANALYTICS_BUNDLE_TIMEOUT_MS: 12000,
}));

const { fetchPerformanceAndHealth } = await import("@/lib/executiveReporting/djangoAnalyticsBridge");

function djangoResponse(ok: boolean, data: unknown, status = ok ? 200 : 400) {
  return { ok, status, json: async () => data } as Response;
}

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
    expect(djangoApiFetch.mock.calls[0][0]).toBe("/analytics/7/");
  });
});
