import { describe, expect, it, vi, beforeEach } from "vitest";

const deskNoteFindMany = vi.fn();
const deskNoteDelete = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: { deskNote: { findMany: deskNoteFindMany, delete: deskNoteDelete } },
}));

const logDeskAudit = vi.fn();
vi.mock("@/lib/deskAudit", () => ({ logDeskAudit: (...args: unknown[]) => logDeskAudit(...args) }));

const { purgeExpiredArchivedNotes, ARCHIVE_RETENTION_DAYS } = await import("@/lib/deskNoteRetention");

beforeEach(() => {
  deskNoteFindMany.mockReset();
  deskNoteDelete.mockReset();
  logDeskAudit.mockReset();
});

describe("purgeExpiredArchivedNotes", () => {
  it("la retención es de 15 días calendario", () => {
    expect(ARCHIVE_RETENTION_DAYS).toBe(15);
  });

  it("consulta solo notas archivadas, activas, con archivedAt vencido", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-01T00:00:00Z"));
    deskNoteFindMany.mockResolvedValue([]);

    await purgeExpiredArchivedNotes();

    expect(deskNoteFindMany).toHaveBeenCalledWith({
      where: { archived: true, archivedAt: { lte: new Date("2026-07-17T00:00:00Z") }, deletedAt: null },
      select: { id: true, recipientId: true },
    });
    vi.useRealTimers();
  });

  it("elimina en duro cada nota vencida y audita DELETED con origin automatic", async () => {
    deskNoteFindMany.mockResolvedValue([
      { id: "n1", recipientId: "u1" },
      { id: "n2", recipientId: "u2" },
    ]);
    deskNoteDelete.mockResolvedValue({});

    const result = await purgeExpiredArchivedNotes();

    expect(result).toEqual({ purged: 2 });
    expect(deskNoteDelete).toHaveBeenCalledWith({ where: { id: "n1" } });
    expect(deskNoteDelete).toHaveBeenCalledWith({ where: { id: "n2" } });
    expect(logDeskAudit).toHaveBeenCalledWith({
      entityType: "NOTE",
      entityId: "n1",
      userId: "u1",
      action: "DELETED",
      metadata: { origin: "automatic", reason: "archive_retention_expired" },
    });
  });

  it("sin notas vencidas, no elimina nada", async () => {
    deskNoteFindMany.mockResolvedValue([]);
    const result = await purgeExpiredArchivedNotes();
    expect(result).toEqual({ purged: 0 });
    expect(deskNoteDelete).not.toHaveBeenCalled();
  });
});
