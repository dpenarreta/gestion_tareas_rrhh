import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ReportMemberKpi } from "@/components/kpis/types";

const djangoApiFetch = vi.fn();
vi.mock("@/lib/djangoSession", () => ({
  djangoApiFetch: (...args: unknown[]) => djangoApiFetch(...args),
}));

const { verifySnapshotIntegrity } = await import("@/lib/executiveReporting/verifySnapshotIntegrity");

function djangoResponse(ok: boolean, data: unknown, status = ok ? 200 : 400) {
  return { ok, status, json: async () => data } as Response;
}

function member(overrides: Partial<ReportMemberKpi> = {}): ReportMemberKpi {
  return {
    id: "1",
    name: "Ana",
    role: "ASISTENTE_GH",
    score: 80,
    completedPct: 90,
    cargaPct: 100,
    cargaRealHours: 150,
    cargaBaseHours: 150,
    cargaColor: "green",
    cargaLabel: "Óptimo",
    cargaRangeMin: 90,
    cargaRangeMax: 130,
    totalTasks: 10,
    completedTasks: 9,
    overdueCount: 0,
    seguimientoTotal: 0,
    byReason: [],
    ...overrides,
  };
}

beforeEach(() => djangoApiFetch.mockReset());

describe("verifySnapshotIntegrity", () => {
  it("consulta /kpis/team/ con el mes correcto y no reporta nada cuando los valores coinciden", async () => {
    djangoApiFetch.mockResolvedValue(
      djangoResponse(true, { users: [{ id: 1, completed_pct: 90, carga_pct: 100 }] }),
    );

    const result = await verifySnapshotIntegrity("NXR-20260827-000000-AAAA", 8, 2026, [member()]);

    expect(djangoApiFetch).toHaveBeenCalledWith("/kpis/team/?month=2026-08");
    expect(result).toEqual({ performed: true, discrepancyCount: 0 });
    // No se llamó ninguna vez más allá de la consulta de comparación — no hubo incidentes que registrar.
    expect(djangoApiFetch).toHaveBeenCalledTimes(1);
  });

  it("no reporta una discrepancia dentro de la tolerancia de redondeo", async () => {
    djangoApiFetch.mockResolvedValue(
      djangoResponse(true, { users: [{ id: 1, completed_pct: 90.3, carga_pct: 100 }] }),
    );

    const result = await verifySnapshotIntegrity("NXR-20260827-000000-AAAA", 8, 2026, [
      member({ completedPct: 90 }),
    ]);

    expect(result).toEqual({ performed: true, discrepancyCount: 0 });
    expect(djangoApiFetch).toHaveBeenCalledTimes(1);
  });

  it("registra un incidente por cada campo con una discrepancia real, fuera de tolerancia", async () => {
    djangoApiFetch.mockResolvedValueOnce(
      djangoResponse(true, { users: [{ id: 1, completed_pct: 70, carga_pct: 120 }] }),
    );
    djangoApiFetch.mockResolvedValue(djangoResponse(true, { ok: true }));

    const result = await verifySnapshotIntegrity("NXR-20260827-000000-AAAA", 8, 2026, [
      member({ completedPct: 90, cargaPct: 100 }),
    ]);

    expect(result).toEqual({ performed: true, discrepancyCount: 2 });
    expect(djangoApiFetch).toHaveBeenCalledTimes(3); // 1 consulta + 2 incidentes (completedPct y cargaPct)
    expect(djangoApiFetch).toHaveBeenCalledWith(
      "/reports/executive/integrity-incidents/",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          report_id: "NXR-20260827-000000-AAAA",
          field_path: "members[1].completedPct",
          expected_value: 90,
          actual_value: 70,
          source: "kpis_team",
          user_id: 1,
        }),
      }),
    );
  });

  it("degrada sin lanzar cuando Django no responde", async () => {
    djangoApiFetch.mockResolvedValue(null);

    const result = await verifySnapshotIntegrity("NXR-20260827-000000-AAAA", 8, 2026, [member()]);

    expect(result).toEqual({ performed: false, discrepancyCount: 0 });
  });

  it("degrada sin lanzar si el registro de un incidente falla", async () => {
    djangoApiFetch.mockResolvedValueOnce(
      djangoResponse(true, { users: [{ id: 1, completed_pct: 70, carga_pct: 100 }] }),
    );
    djangoApiFetch.mockRejectedValueOnce(new Error("Django no disponible"));

    const result = await verifySnapshotIntegrity("NXR-20260827-000000-AAAA", 8, 2026, [
      member({ completedPct: 90, cargaPct: 100 }),
    ]);

    expect(result).toEqual({ performed: true, discrepancyCount: 1 });
  });

  it("ignora filas de Django sin colaborador correspondiente en el roster", async () => {
    djangoApiFetch.mockResolvedValue(
      djangoResponse(true, { users: [{ id: 999, completed_pct: 0, carga_pct: 0 }] }),
    );

    const result = await verifySnapshotIntegrity("NXR-20260827-000000-AAAA", 8, 2026, [member()]);

    expect(result).toEqual({ performed: true, discrepancyCount: 0 });
    expect(djangoApiFetch).toHaveBeenCalledTimes(1);
  });
});
