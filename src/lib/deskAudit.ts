import "server-only";
import { prisma } from "@/lib/prisma";
import type { DeskAuditAction, Prisma } from "@/generated/prisma/client";

export type DeskAuditEntityType = "NOTE" | "REMINDER";

/**
 * Auditoría central de Escritorio Digital (notas + recordatorios) — un solo
 * registro (DeskAuditLog) para ambas entidades, mismo criterio que
 * RecoveryAuditLog. Nunca lanza: la auditoría no debe poder tumbar la acción
 * que audita, se registra en consola y se sigue de largo.
 */
export async function logDeskAudit(params: {
  entityType: DeskAuditEntityType;
  entityId: string;
  userId: string;
  action: DeskAuditAction;
  metadata?: Prisma.InputJsonValue;
}): Promise<void> {
  try {
    await prisma.deskAuditLog.create({
      data: {
        entityType: params.entityType,
        entityId: params.entityId,
        userId: params.userId,
        action: params.action,
        metadata: params.metadata,
      },
    });
  } catch (err) {
    console.error("[deskAudit] no se pudo registrar el evento de auditoría", err);
  }
}
