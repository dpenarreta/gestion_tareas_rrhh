import "server-only";
import { prisma } from "@/lib/prisma";
import { logDeskAudit } from "@/lib/deskAudit";

/** §8 del refinamiento (2026-07-23): una nota archivada vive 15 días calendario antes de purgarse en duro. */
export const ARCHIVE_RETENTION_DAYS = 15;

/**
 * Barrido perezoso (mismo criterio que purgeExpiredItems en recoveryCenter.ts
 * y notifyDueReminders en deskReminders.ts) — se dispara al listar notas, no
 * por un cron dedicado. Esta purga es intencionalmente independiente del
 * Centro de Recuperación: es la retención propia del archivo del
 * destinatario (§7/§8), no la papelera del remitente (ver comentario en
 * DeskNote.deletedAt del schema).
 */
export async function purgeExpiredArchivedNotes(): Promise<{ purged: number }> {
  const cutoff = new Date(Date.now() - ARCHIVE_RETENTION_DAYS * 86400000);
  const expired = await prisma.deskNote.findMany({
    where: { archived: true, archivedAt: { lte: cutoff }, deletedAt: null },
    select: { id: true, recipientId: true },
  });

  for (const note of expired) {
    await prisma.deskNote.delete({ where: { id: note.id } });
    await logDeskAudit({
      entityType: "NOTE",
      entityId: note.id,
      userId: note.recipientId,
      action: "DELETED",
      metadata: { origin: "automatic", reason: "archive_retention_expired" },
    });
  }

  return { purged: expired.length };
}
