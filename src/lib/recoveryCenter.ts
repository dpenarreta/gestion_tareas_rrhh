import "server-only";
import { prisma } from "@/lib/prisma";
import { getEffectiveRecoveryRetentionHours } from "@/lib/systemConfig";
import type { RecoveryItem, RecoveryOperation, RecoveryOrigin } from "@/generated/prisma/client";

/**
 * Centro de Recuperación (§14 del pedido — arquitectura corporativa interna,
 * el usuario solo ve "Papelera" en cada módulo). Único mecanismo oficial de
 * eliminación temporal/restauración de NEXO: ningún módulo nuevo debe
 * implementar su propia papelera — debe llamar a las funciones de este
 * archivo.
 *
 * Diseño abierto/cerrado: las funciones exportadas de aquí (moveToTrash,
 * restore, deletePermanently, purgeExpiredItems, getRemainingRetentionTime,
 * registerAuditEvent) NUNCA cambian para dar de alta un módulo nuevo — solo
 * se agrega una entrada de datos a ENTITY_REGISTRY más abajo (adaptador con
 * 3 funciones puente hacia la tabla propia del módulo). Cero migraciones de
 * schema y cero cambios de lógica al escalar a Trabajo, Escritorio Digital,
 * Documentos, Repositorios, Plantillas o Comunicados.
 */

type EntityAdapter = {
  /** Etiqueta legible del módulo (para auditoría y la futura consola administrativa). */
  moduleLabel: string;
  /** Nombre/título legible de la entidad al momento de eliminar, para listar la papelera sin resolver la fila original. */
  getDisplayName: (entityId: string) => Promise<string | null>;
  /** Alterna la bandera local de conveniencia de la tabla propia del módulo (ej. Project.deletedAt). */
  setTrashed: (entityId: string, trashed: boolean) => Promise<void>;
  /** Eliminación física — invocada únicamente desde deletePermanently()/purgeExpiredItems(). */
  hardDelete: (entityId: string) => Promise<void>;
};

// Registro de módulos compatibles con el Centro de Recuperación. Agregar un
// módulo nuevo = agregar una entrada aquí (datos, no lógica) — ver el
// comentario de arriba. Proyectos y Escritorio Digital están integrados;
// Trabajo, Documentos, Repositorios y Plantillas quedan como "módulos
// compatibles, no implementados todavía" (§14 pide dejar la arquitectura
// preparada, no migrarlos a todos en este sprint).
const ENTITY_REGISTRY: Record<string, EntityAdapter> = {
  PROJECT: {
    moduleLabel: "Proyectos",
    getDisplayName: async (entityId) => {
      const project = await prisma.project.findUnique({ where: { id: entityId }, select: { name: true } });
      return project?.name ?? null;
    },
    setTrashed: async (entityId, trashed) => {
      await prisma.project.update({ where: { id: entityId }, data: { deletedAt: trashed ? new Date() : null } });
    },
    hardDelete: async (entityId) => {
      await prisma.project.delete({ where: { id: entityId } });
    },
  },
  DESK_NOTE: {
    moduleLabel: "Escritorio Digital",
    getDisplayName: async (entityId) => {
      const note = await prisma.deskNote.findUnique({ where: { id: entityId }, select: { message: true } });
      if (!note) return null;
      return note.message.length > 60 ? `${note.message.slice(0, 60)}…` : note.message;
    },
    setTrashed: async (entityId, trashed) => {
      await prisma.deskNote.update({ where: { id: entityId }, data: { deletedAt: trashed ? new Date() : null } });
    },
    hardDelete: async (entityId) => {
      await prisma.deskNote.delete({ where: { id: entityId } });
    },
  },
};

export type RecoveryEntityType = keyof typeof ENTITY_REGISTRY;

function getAdapter(entityType: string): EntityAdapter {
  const adapter = ENTITY_REGISTRY[entityType];
  if (!adapter) {
    throw new Error(`Tipo de entidad no registrada en el Centro de Recuperación: ${entityType}`);
  }
  return adapter;
}

/** Auditoría central — una fila por operación, para cualquier módulo (nunca una tabla de auditoría por módulo). */
export async function registerAuditEvent(params: {
  entityType: string;
  entityId: string;
  moduleLabel: string;
  userId: string | null;
  operation: RecoveryOperation;
  origin: RecoveryOrigin;
}): Promise<void> {
  await prisma.recoveryAuditLog.create({
    data: {
      entityType: params.entityType,
      entityId: params.entityId,
      moduleLabel: params.moduleLabel,
      userId: params.userId,
      operation: params.operation,
      origin: params.origin,
    },
  });
}

/** Mueve una entidad a la papelera. Lanza si el tipo no está registrado o si ya está en la papelera. */
export async function moveToTrash(params: {
  entityType: string;
  entityId: string;
  userId: string;
}): Promise<RecoveryItem> {
  const adapter = getAdapter(params.entityType);

  const existingActive = await prisma.recoveryItem.findFirst({
    where: { entityType: params.entityType, entityId: params.entityId, status: "ACTIVE" },
  });
  if (existingActive) {
    throw new Error("Este elemento ya está en la papelera");
  }

  const retentionHours = await getEffectiveRecoveryRetentionHours();
  const deletedAt = new Date();
  const expiresAt = new Date(deletedAt.getTime() + retentionHours * 3600000);
  const entityLabel = await adapter.getDisplayName(params.entityId);

  const item = await prisma.recoveryItem.create({
    data: {
      entityType: params.entityType,
      entityId: params.entityId,
      entityLabel,
      moduleLabel: adapter.moduleLabel,
      status: "ACTIVE",
      deletedById: params.userId,
      deletedAt,
      retentionHours,
      expiresAt,
    },
  });

  await adapter.setTrashed(params.entityId, true);
  await registerAuditEvent({
    entityType: params.entityType,
    entityId: params.entityId,
    moduleLabel: adapter.moduleLabel,
    userId: params.userId,
    operation: "MOVE_TO_TRASH",
    origin: "MANUAL",
  });

  return item;
}

/** Restaura una entidad activa en la papelera. Lanza si no está en la papelera o si ya expiró. */
export async function restore(params: {
  entityType: string;
  entityId: string;
  userId: string;
}): Promise<RecoveryItem> {
  const adapter = getAdapter(params.entityType);

  const item = await prisma.recoveryItem.findFirst({
    where: { entityType: params.entityType, entityId: params.entityId, status: "ACTIVE" },
    orderBy: { deletedAt: "desc" },
  });
  if (!item) {
    throw new Error("Este elemento no está en la papelera");
  }
  if (item.expiresAt.getTime() <= Date.now()) {
    throw new Error("El período de retención de este elemento ya expiró");
  }

  const updated = await prisma.recoveryItem.update({
    where: { id: item.id },
    data: { status: "RESTORED", restoredAt: new Date(), restoredById: params.userId },
  });

  await adapter.setTrashed(params.entityId, false);
  await registerAuditEvent({
    entityType: params.entityType,
    entityId: params.entityId,
    moduleLabel: adapter.moduleLabel,
    userId: params.userId,
    operation: "RESTORE",
    origin: "MANUAL",
  });

  return updated;
}

/** Elimina definitivamente una entidad que está en la papelera (acción manual, "Eliminar para siempre"). */
export async function deletePermanently(params: {
  entityType: string;
  entityId: string;
  userId: string;
}): Promise<void> {
  const adapter = getAdapter(params.entityType);

  const item = await prisma.recoveryItem.findFirst({
    where: { entityType: params.entityType, entityId: params.entityId, status: "ACTIVE" },
    orderBy: { deletedAt: "desc" },
  });
  if (!item) {
    throw new Error("Este elemento no está en la papelera");
  }

  await adapter.hardDelete(params.entityId);
  await prisma.recoveryItem.update({
    where: { id: item.id },
    data: { status: "PURGED", purgedAt: new Date(), purgedById: params.userId, purgeOrigin: "MANUAL" },
  });

  await registerAuditEvent({
    entityType: params.entityType,
    entityId: params.entityId,
    moduleLabel: adapter.moduleLabel,
    userId: params.userId,
    operation: "DELETE_PERMANENTLY",
    origin: "MANUAL",
  });
}

/**
 * Purga automática de elementos cuyo período de retención expiró. Idempotente
 * y sin script masivo dedicado — se invoca de forma perezosa cada vez que se
 * abre una papelera (mismo criterio que la migración perezosa de historial de
 * tareas Fijas, ver docs/AUDIT_LOG.md § 2026-07-21) y también queda disponible
 * como acción manual desde Ajustes para un barrido bajo demanda.
 */
export async function purgeExpiredItems(): Promise<{ purged: number }> {
  const expired = await prisma.recoveryItem.findMany({
    where: { status: "ACTIVE", expiresAt: { lte: new Date() } },
  });

  let purged = 0;
  for (const item of expired) {
    const adapter = ENTITY_REGISTRY[item.entityType];
    if (!adapter) continue; // Tipo desregistrado (ej. módulo retirado) — se deja para revisión manual, no se pierde el registro.

    try {
      await adapter.hardDelete(item.entityId);
    } catch {
      // La fila ya pudo eliminarse por otra vía — igual se marca purgada abajo.
    }

    await prisma.recoveryItem.update({
      where: { id: item.id },
      data: { status: "PURGED", purgedAt: new Date(), purgeOrigin: "AUTOMATIC" },
    });

    await registerAuditEvent({
      entityType: item.entityType,
      entityId: item.entityId,
      moduleLabel: item.moduleLabel,
      userId: null,
      operation: "PURGE_EXPIRED",
      origin: "AUTOMATIC",
    });

    purged++;
  }

  return { purged };
}

export async function getRemainingRetentionTime(
  entityType: string,
  entityId: string
): Promise<{ expiresAt: Date; msRemaining: number } | null> {
  const item = await prisma.recoveryItem.findFirst({
    where: { entityType, entityId, status: "ACTIVE" },
    orderBy: { deletedAt: "desc" },
  });
  if (!item) return null;
  return { expiresAt: item.expiresAt, msRemaining: Math.max(0, item.expiresAt.getTime() - Date.now()) };
}

/** Elementos actualmente en la papelera para un tipo de entidad — la autorización de quién puede verlos queda a cargo del módulo llamante. */
export async function listActiveTrash(entityType: string): Promise<RecoveryItem[]> {
  return prisma.recoveryItem.findMany({
    where: { entityType, status: "ACTIVE" },
    orderBy: { deletedAt: "desc" },
  });
}
