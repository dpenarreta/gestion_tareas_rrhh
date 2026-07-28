import { describe, expect, it, vi, beforeEach } from "vitest";

const create = vi.fn();
const auditCreate = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    executiveReportSnapshot: { create },
    executiveReportAuditLog: { create: auditCreate },
  },
}));

const { createSnapshot, logReportAudit } = await import("@/lib/executiveReporting/snapshotStore");

const baseInput = {
  type: "MENSUAL" as const,
  scope: "COORDINADOR" as const,
  generatedBy: "user-1",
  periodLabel: "Julio 2026",
  periodStart: new Date("2026-07-01T00:00:00.000Z"),
  periodEnd: new Date("2026-07-31T23:59:59.000Z"),
  fechaCorte: new Date("2026-07-28T00:00:00.000Z"),
  periodStatus: "EN_CURSO" as const,
  filters: {},
  collaboratorIds: ["u1", "u2"],
  analyticsEngineVersion: "1.5.0",
  formulaSetVersion: "4.4",
  reportingEngineVersion: "2.0",
  nexoVersion: "1.21.0",
  data: { ok: true },
  dataQuality: { pct: 90, issues: [] },
  generationMs: 1234,
};

describe("createSnapshot", () => {
  beforeEach(() => {
    create.mockReset();
    auditCreate.mockReset();
  });

  it("crea el snapshot en un solo intento cuando no hay colisión", async () => {
    create.mockResolvedValueOnce({ id: "snap-1", reportId: "NXR-20260728-120000-ABCD" });
    const result = await createSnapshot(baseInput);
    expect(create).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ id: "snap-1", reportId: "NXR-20260728-120000-ABCD" });
    // collaboratorCount se deriva del roster, no se pide aparte
    expect(create.mock.calls[0][0].data.collaboratorCount).toBe(2);
  });

  it("reintenta con un reportId nuevo ante colisión P2002 en reportId", async () => {
    create
      .mockRejectedValueOnce({ code: "P2002", meta: { target: ["reportId"] } })
      .mockRejectedValueOnce({ code: "P2002", meta: { target: ["reportId"] } })
      .mockResolvedValueOnce({ id: "snap-2", reportId: "NXR-20260728-120005-WXYZ" });

    const result = await createSnapshot(baseInput);

    expect(create).toHaveBeenCalledTimes(3);
    const idsUsed = create.mock.calls.map((c) => c[0].data.reportId);
    expect(new Set(idsUsed).size).toBe(3); // cada intento generó un reportId distinto
    expect(result.id).toBe("snap-2");
  });

  it("agota los reintentos y lanza el último error si siempre colisiona", async () => {
    create.mockRejectedValue({ code: "P2002", meta: { target: ["reportId"] } });
    await expect(createSnapshot(baseInput)).rejects.toBeTruthy();
    expect(create).toHaveBeenCalledTimes(5);
  });

  it("no reintenta ante un error que no es colisión de reportId (relanza de inmediato)", async () => {
    create.mockRejectedValueOnce(new Error("db down"));
    await expect(createSnapshot(baseInput)).rejects.toThrow("db down");
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("no reintenta si el caller pasó un reportId fijo (backfill) — relanza aunque sea P2002", async () => {
    create.mockRejectedValueOnce({ code: "P2002", meta: { target: ["reportId"] } });
    await expect(createSnapshot({ ...baseInput, reportId: "NXR-LEGACY-20260101-AAAA" })).rejects.toBeTruthy();
    expect(create).toHaveBeenCalledTimes(1);
  });
});

describe("logReportAudit", () => {
  beforeEach(() => auditCreate.mockReset());

  it("escribe la fila de auditoría", async () => {
    auditCreate.mockResolvedValueOnce({});
    await logReportAudit({ reportId: "NXR-20260728-120000-ABCD", action: "generated", userId: "user-1" });
    expect(auditCreate).toHaveBeenCalledTimes(1);
  });

  it("es best-effort: un fallo de auditoría nunca se propaga", async () => {
    auditCreate.mockRejectedValueOnce(new Error("db down"));
    await expect(
      logReportAudit({ reportId: "NXR-20260728-120000-ABCD", action: "generation_failed", userId: "user-1" })
    ).resolves.toBeUndefined();
  });
});
