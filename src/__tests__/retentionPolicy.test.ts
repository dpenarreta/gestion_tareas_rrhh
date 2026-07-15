import { describe, expect, it, vi, beforeEach } from "vitest";

const monthlyReportFindMany = vi.fn();
const taskFindMany = vi.fn();
const knowledgeDocumentFindMany = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    monthlyReport: { findMany: monthlyReportFindMany },
    task: { findMany: taskFindMany },
    knowledgeDocument: { findMany: knowledgeDocumentFindMany },
  },
}));

vi.mock("@/lib/systemConfig", () => ({
  getEffectiveRetentionMonthlyReports: vi.fn().mockResolvedValue("12"),
  getEffectiveRetentionArchivedTasks: vi.fn().mockResolvedValue("6"),
  getEffectiveRetentionKnowledgeDocs: vi.fn().mockResolvedValue("indefinite"),
}));

const { findPurgeCandidates, getEffectivePolicy } = await import("@/lib/retentionPolicy");

const ASOF = new Date("2026-07-15T00:00:00Z");

describe("getEffectivePolicy", () => {
  it("agrega la política vigente de los tres tipos de retención", async () => {
    const policy = await getEffectivePolicy(ASOF);
    expect(policy).toEqual({
      monthlyReportsMonths: "12",
      archivedTasksMonths: "6",
      knowledgeDocsMonths: "indefinite",
    });
  });
});

describe("findPurgeCandidates", () => {
  beforeEach(() => {
    monthlyReportFindMany.mockReset();
    taskFindMany.mockReset();
    knowledgeDocumentFindMany.mockReset();
  });

  it("incluye solo informes anteriores al corte de 12 meses", async () => {
    monthlyReportFindMany.mockResolvedValue([
      { id: "old", year: 2024, month: 1 }, // > 12 meses antes de 2026-07
      { id: "recent", year: 2026, month: 6 }, // dentro de los últimos 12 meses
    ]);
    taskFindMany.mockResolvedValue([]);

    const { reportIds } = await findPurgeCandidates(ASOF);
    expect(reportIds).toEqual(["old"]);
  });

  it("incluye solo tareas archivadas antes del corte de 6 meses", async () => {
    monthlyReportFindMany.mockResolvedValue([]);
    taskFindMany.mockResolvedValue([{ id: "task-old" }]);

    const { taskIds } = await findPurgeCandidates(ASOF);
    expect(taskIds).toEqual(["task-old"]);
    expect(taskFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          archivedMonth: { not: null },
          archivedAt: { lt: expect.any(Date) },
        }),
      })
    );
    const cutoffUsed: Date = taskFindMany.mock.calls[0][0].where.archivedAt.lt;
    // cutoffDate() usa setMonth() en hora local; se replica el mismo cálculo
    // aquí para no asumir la zona horaria de la máquina donde corre el test.
    const expectedCutoff = new Date(ASOF);
    expectedCutoff.setMonth(expectedCutoff.getMonth() - 6);
    expect(cutoffUsed.getTime()).toBe(expectedCutoff.getTime());
  });

  it("no consulta documentos ni genera candidatos cuando la política es 'indefinite'", async () => {
    monthlyReportFindMany.mockResolvedValue([]);
    taskFindMany.mockResolvedValue([]);

    const { docIds } = await findPurgeCandidates(ASOF);
    expect(docIds).toEqual([]);
    expect(knowledgeDocumentFindMany).not.toHaveBeenCalled();
  });

  it("devuelve la política efectiva usada junto con los candidatos", async () => {
    monthlyReportFindMany.mockResolvedValue([]);
    taskFindMany.mockResolvedValue([]);

    const { policy } = await findPurgeCandidates(ASOF);
    expect(policy.monthlyReportsMonths).toBe("12");
    expect(policy.archivedTasksMonths).toBe("6");
    expect(policy.knowledgeDocsMonths).toBe("indefinite");
  });
});
