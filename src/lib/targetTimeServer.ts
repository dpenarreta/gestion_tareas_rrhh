import "server-only";
import { prisma } from "@/lib/prisma";
import type { Role, TaskType } from "@/generated/prisma/client";
import { buildHistoricalDeviationInsight, type HistoricalDeviationInsight, type TargetTimeAdjustReason } from "@/lib/targetTime";

const HISTORICAL_SAMPLE_SIZE = 40;

/**
 * Desviación histórica del proceso (§S6-E) — promedio de horas reales de los
 * últimos N casos COMPLETADOS con el mismo título (case-insensitive), la
 * aproximación más simple a "casos similares" sin una Biblioteca de Tiempos
 * Objetivo todavía (§S6-I). NUNCA sugiere reemplazar el objetivo
 * automáticamente — solo informa para que un líder decida.
 */
export async function getHistoricalDeviationForTask(taskTitle: string, officialTarget: number, excludeTaskId: string): Promise<HistoricalDeviationInsight> {
  const cases = await prisma.task.findMany({
    where: {
      title: { equals: taskTitle.trim(), mode: "insensitive" },
      status: "COMPLETADA",
      id: { not: excludeTaskId },
      realHours: { gt: 0 },
    },
    select: { realHours: true },
    orderBy: { completedAt: "desc" },
    take: HISTORICAL_SAMPLE_SIZE,
  });
  if (cases.length === 0) return buildHistoricalDeviationInsight(0, 0, officialTarget);
  const avg = cases.reduce((s, c) => s + c.realHours, 0) / cases.length;
  return buildHistoricalDeviationInsight(cases.length, avg, officialTarget);
}

export async function getTargetTimeAuditHistory(taskId: string) {
  return prisma.targetTimeAuditLog.findMany({
    where: { taskId },
    include: { user: { select: { id: true, name: true } } },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Aplica una validación del Tiempo Objetivo (§S6-C) — actualiza la tarea Y
 * crea el registro de auditoría (§S6-G) en una sola transacción, nunca uno
 * sin el otro. `previousValue` se lee dentro de la transacción para evitar
 * una condición de carrera con otra validación concurrente.
 */
export async function applyTargetTimeValidation(params: {
  taskId: string;
  newValue: number;
  reason: TargetTimeAdjustReason;
  reasonDetail: string | null;
  userId: string;
  userRole: Role;
  ipAddress: string | null;
}) {
  return prisma.$transaction(async (tx) => {
    const task = await tx.task.findUnique({ where: { id: params.taskId }, select: { targetTimeValidated: true } });
    if (!task) return null;

    const updated = await tx.task.update({
      where: { id: params.taskId },
      data: {
        targetTimeValidated: params.newValue,
        targetTimeValidatedAt: new Date(),
        targetTimeValidatedById: params.userId,
      },
    });

    await tx.targetTimeAuditLog.create({
      data: {
        taskId: params.taskId,
        userId: params.userId,
        userRole: params.userRole,
        previousValue: task.targetTimeValidated,
        newValue: params.newValue,
        reason: params.reason,
        reasonDetail: params.reasonDetail,
        ipAddress: params.ipAddress,
      },
    });

    return updated;
  });
}

// ── Regularización de tareas existentes (§S6-D) ──────────────────────────────

const REGULARIZATION_RECENT_DAYS = 60;

export type PendingTargetTimeFilters = { userId?: string; role?: Role; type?: TaskType };

/** "Activas o recientes": no archivadas, o archivadas dentro de la ventana reciente — nunca todo el histórico. */
export async function getPendingTargetTimeTasks(filters: PendingTargetTimeFilters) {
  const recentSince = new Date(Date.now() - REGULARIZATION_RECENT_DAYS * 86400000);
  return prisma.task.findMany({
    where: {
      targetTimeValidated: null,
      ...(filters.userId ? { assignedToId: filters.userId } : {}),
      ...(filters.type ? { type: filters.type } : {}),
      ...(filters.role ? { assignedTo: { role: filters.role } } : {}),
      OR: [{ archivedMonth: null }, { archivedAt: { gte: recentSince } }],
    },
    select: {
      id: true,
      title: true,
      status: true,
      type: true,
      priority: true,
      estimatedHours: true,
      realHours: true,
      endDate: true,
      archivedMonth: true,
      assignedTo: { select: { id: true, name: true, role: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 300,
  });
}

/** Indicador de calidad del dato (§S6-H) — % de tareas activas/recientes con Tiempo Objetivo validado vs. pendiente. */
export async function getTargetTimeDataQuality(filters: Pick<PendingTargetTimeFilters, "role"> = {}) {
  const recentSince = new Date(Date.now() - REGULARIZATION_RECENT_DAYS * 86400000);
  const scope = {
    ...(filters.role ? { assignedTo: { role: filters.role } } : {}),
    OR: [{ archivedMonth: null }, { archivedAt: { gte: recentSince } }],
  };
  const [validatedCount, totalCount] = await Promise.all([
    prisma.task.count({ where: { ...scope, targetTimeValidated: { not: null } } }),
    prisma.task.count({ where: scope }),
  ]);
  const pendingCount = totalCount - validatedCount;
  const validatedPct = totalCount > 0 ? Math.round((validatedCount / totalCount) * 100) : 100;
  return { validatedCount, pendingCount, totalCount, validatedPct, pendingPct: 100 - validatedPct };
}
