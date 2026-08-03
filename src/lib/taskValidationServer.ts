import "server-only";
import { prisma } from "@/lib/prisma";
import type { Role, TaskType } from "@/generated/prisma/client";

// Mismo valor que REGULARIZATION_RECENT_DAYS en targetTimeServer.ts/
// endDateServer.ts — "activas o recientes": no archivadas, o archivadas
// dentro de la ventana reciente, nunca todo el histórico. Configuración
// pura (no lógica de negocio a reutilizar vía import), documentada aquí
// para que quede explícito que debe mantenerse igual que sus 2 hermanos.
const REGULARIZATION_RECENT_DAYS = 60;

export type PendingTaskValidationFilters = { userId?: string; role?: Role; type?: TaskType };

/**
 * Pantalla "Tiempo Objetivo" (Menú lateral → Gestión) — lista ÚNICA que
 * combina ambas validaciones de líder: aparece una tarea si necesita
 * atención en Tiempo Objetivo (`targetTimeValidated === null`) O en Fecha
 * Fin (`endDateApprovalStatus === "PENDIENTE"`), o ambas — así el líder
 * puede "validar integralmente la planificación" desde una sola pantalla,
 * sin que una tarea pendiente solo en una de las 2 dimensiones quede
 * invisible. No reemplaza `applyTargetTimeValidation`/`applyEndDateAction`
 * (la lógica de validación en sí sigue siendo 100% de cada módulo) — esta
 * es solo la capa de listado combinado.
 */
export async function getPendingTaskValidations(filters: PendingTaskValidationFilters) {
  const recentSince = new Date(Date.now() - REGULARIZATION_RECENT_DAYS * 86400000);
  return prisma.task.findMany({
    where: {
      AND: [
        { OR: [{ targetTimeValidated: null }, { endDateApprovalStatus: "PENDIENTE" }] },
        { OR: [{ archivedMonth: null }, { archivedAt: { gte: recentSince } }] },
      ],
      ...(filters.userId ? { assignedToId: filters.userId } : {}),
      ...(filters.type ? { type: filters.type } : {}),
      ...(filters.role ? { assignedTo: { role: filters.role } } : {}),
    },
    select: {
      id: true,
      title: true,
      status: true,
      type: true,
      priority: true,
      startDate: true,
      estimatedHours: true,
      realHours: true,
      targetTimeValidated: true,
      endDate: true,
      endDateApprovalStatus: true,
      archivedMonth: true,
      assignedTo: { select: { id: true, name: true, role: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 300,
  });
}
