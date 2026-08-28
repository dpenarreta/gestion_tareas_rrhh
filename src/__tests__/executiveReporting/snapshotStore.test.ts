import { describe, expect, it, vi, beforeEach } from "vitest";

// Cutover de stack (ver docs/AUDIT_LOG.md § 2026-08-25, Fase 56): la
// persistencia pasó de Prisma a Django (`POST /reports/executive/` +
// `POST /reports/executive/audit/`) — el cálculo del snapshot no cambió.
const djangoApiFetch = vi.fn();
vi.mock("@/lib/djangoSession", () => ({
  djangoApiFetch: (...args: unknown[]) => djangoApiFetch(...args),
}));

const { createSnapshot, logReportAudit } = await import("@/lib/executiveReporting/snapshotStore");

function djangoResponse(ok: boolean, data: unknown, status = ok ? 200 : 400) {
  return { ok, status, json: async () => data } as Response;
}

const baseInput = {
  type: "MENSUAL" as const,
  scope: "COORDINADOR" as const,
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
    djangoApiFetch.mockReset();
  });

  it("crea el snapshot en un solo intento cuando no hay colisión", async () => {
    djangoApiFetch.mockResolvedValueOnce(djangoResponse(true, { report_id: "NXR-20260728-120000-ABCD" }, 201));
    const result = await createSnapshot(baseInput);
    expect(djangoApiFetch).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ reportId: "NXR-20260728-120000-ABCD" });
    const body = JSON.parse(djangoApiFetch.mock.calls[0][1].body);
    expect(body.collaborator_ids).toEqual(["u1", "u2"]);
  });

  it("reintenta con un reportId nuevo ante colisión 409 de Django", async () => {
    djangoApiFetch
      .mockResolvedValueOnce(djangoResponse(false, { error: "report_id ya existe" }, 409))
      .mockResolvedValueOnce(djangoResponse(false, { error: "report_id ya existe" }, 409))
      .mockResolvedValueOnce(djangoResponse(true, { report_id: "NXR-20260728-120005-WXYZ" }, 201));

    const result = await createSnapshot(baseInput);

    expect(djangoApiFetch).toHaveBeenCalledTimes(3);
    const idsUsed = djangoApiFetch.mock.calls.map((c) => JSON.parse(c[1].body).report_id);
    expect(new Set(idsUsed).size).toBe(3); // cada intento generó un reportId distinto
    expect(result.reportId).toBe("NXR-20260728-120005-WXYZ");
  });

  it("agota los reintentos y lanza tras 5 colisiones seguidas", async () => {
    djangoApiFetch.mockResolvedValue(djangoResponse(false, { error: "report_id ya existe" }, 409));
    await expect(createSnapshot(baseInput)).rejects.toBeTruthy();
    expect(djangoApiFetch).toHaveBeenCalledTimes(5);
  });

  it("no reintenta ante un error que no es colisión de reportId (relanza de inmediato)", async () => {
    djangoApiFetch.mockResolvedValueOnce(djangoResponse(false, { error: "server error" }, 500));
    await expect(createSnapshot(baseInput)).rejects.toThrow("No se pudo persistir el reporte generado.");
    expect(djangoApiFetch).toHaveBeenCalledTimes(1);
  });

  it("no reintenta si el caller pasó un reportId fijo (backfill) — relanza aunque sea 409", async () => {
    djangoApiFetch.mockResolvedValueOnce(djangoResponse(false, { error: "report_id ya existe" }, 409));
    await expect(createSnapshot({ ...baseInput, reportId: "NXR-LEGACY-20260101-AAAA" })).rejects.toThrow(
      'El Report ID "NXR-LEGACY-20260101-AAAA" ya existe.'
    );
    expect(djangoApiFetch).toHaveBeenCalledTimes(1);
  });

  it("lanza si la sesión de Next.js todavía no tiene acceso a Django", async () => {
    djangoApiFetch.mockResolvedValueOnce(null);
    await expect(createSnapshot(baseInput)).rejects.toThrow(
      "Tu sesión no tiene aún acceso a este módulo. Cierra sesión y volvé a iniciar sesión."
    );
  });
});

describe("logReportAudit", () => {
  beforeEach(() => djangoApiFetch.mockReset());

  it("escribe la fila de auditoría", async () => {
    djangoApiFetch.mockResolvedValueOnce(djangoResponse(true, {}, 204));
    await logReportAudit({ reportId: "NXR-20260728-120000-ABCD", action: "generated" });
    expect(djangoApiFetch).toHaveBeenCalledWith(
      "/reports/executive/audit/",
      expect.objectContaining({ method: "POST" })
    );
    const body = JSON.parse(djangoApiFetch.mock.calls[0][1].body);
    expect(body).toMatchObject({ report_id: "NXR-20260728-120000-ABCD", action: "generated" });
  });

  it("es best-effort: un fallo de auditoría nunca se propaga", async () => {
    djangoApiFetch.mockRejectedValueOnce(new Error("db down"));
    await expect(
      logReportAudit({ reportId: "NXR-20260728-120000-ABCD", action: "generation_failed" })
    ).resolves.toBeUndefined();
  });

  it("es best-effort también cuando Django responde un error (no lanza)", async () => {
    djangoApiFetch.mockResolvedValueOnce(djangoResponse(false, { error: "bad request" }, 400));
    await expect(
      logReportAudit({ reportId: "NXR-20260728-120000-ABCD", action: "generation_failed" })
    ).resolves.toBeUndefined();
  });
});
