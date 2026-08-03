import "server-only";
import { prisma } from "@/lib/prisma";
import { Prisma, type Role, type TaskType } from "@/generated/prisma/client";
import type { EndDateAction } from "@/lib/endDate";

const REGULARIZATION_RECENT_DAYS = 60;

export async function getEndDateAuditHistory(taskId: string) {
  return prisma.endDateAuditLog.findMany({
    where: { taskId },
    include: { user: { select: { id: true, name: true } } },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Notifica al colaborador cuando su Fecha Fin fue MODIFICADA o RECHAZADA por
 * un líder — nunca en APROBADA (no requiere ninguna acción del colaborador).
 * Reusa el modelo Notification genérico (mismo patrón que la notificación de
 * asignación en POST /api/tasks) — corre dentro de la misma transacción que
 * applyEndDateAction para que nunca quede huérfana si la operación falla.
 */
async function notifyEndDateChange(
  tx: Prisma.TransactionClient,
  params: { assignedToId: string; taskId: string; taskTitle: string; action: "MODIFICADA" | "RECHAZADA"; previousValue: Date; newValue: Date; observaciones: string | null }
) {
  // DD/MM/YYYY explícito, sin depender de Intl/locale — toLocaleDateString("es-CL", ...)
  // produce "DD-MM-YYYY" (con guiones) según el ICU del runtime, no las
  // barras "/" del ejemplo del spec.
  const fmt = (d: Date) => `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;
  const message =
    params.action === "MODIFICADA"
      ? `Tu fecha de finalización para la actividad "${params.taskTitle}" fue ajustada por tu jefe de ${fmt(params.previousValue)} a ${fmt(params.newValue)}.${params.observaciones ? ` Observación: ${params.observaciones}` : ""}`
      : `Tu jefe rechazó la fecha de finalización propuesta (${fmt(params.previousValue)}) para la actividad "${params.taskTitle}". Debes proponer una nueva fecha.${params.observaciones ? ` Observación: ${params.observaciones}` : ""}`;

  await tx.notification.create({
    data: { userId: params.assignedToId, message, taskId: params.taskId, taskTitle: params.taskTitle },
  });
}

/**
 * Aplica una decisión del líder sobre la Fecha Fin (Aprobar/Modificar/
 * Rechazar) — actualiza la tarea, crea el registro de auditoría y notifica
 * al colaborador cuando corresponde, todo en una sola transacción (nunca uno
 * sin el otro). `previousValue` se lee dentro de la transacción para evitar
 * una condición de carrera con otra decisión concurrente.
 */
export async function applyEndDateAction(params: {
  taskId: string;
  action: EndDateAction;
  newEndDate: Date | null;
  observaciones: string | null;
  userId: string;
  userRole: Role;
  ipAddress: string | null;
}) {
  return prisma.$transaction(async (tx) => {
    const task = await tx.task.findUnique({ where: { id: params.taskId }, select: { endDate: true, title: true, assignedToId: true } });
    if (!task) return null;

    const resultStatus = params.action === "APROBAR" ? "APROBADA" : params.action === "MODIFICAR" ? "MODIFICADA" : "RECHAZADA";
    const newEndDateValue = params.action === "MODIFICAR" ? params.newEndDate! : task.endDate;

    const updated = await tx.task.update({
      where: { id: params.taskId },
      data: {
        endDate: newEndDateValue,
        endDateApprovalStatus: resultStatus,
        endDateApprovedAt: new Date(),
        endDateApprovedById: params.userId,
      },
    });

    await tx.endDateAuditLog.create({
      data: {
        taskId: params.taskId,
        userId: params.userId,
        userRole: params.userRole,
        action: resultStatus,
        previousValue: task.endDate,
        newValue: newEndDateValue,
        observaciones: params.observaciones,
        ipAddress: params.ipAddress,
      },
    });

    if (resultStatus === "MODIFICADA" || resultStatus === "RECHAZADA") {
      await notifyEndDateChange(tx, {
        assignedToId: task.assignedToId,
        taskId: params.taskId,
        taskTitle: task.title,
        action: resultStatus,
        previousValue: task.endDate,
        newValue: newEndDateValue,
        observaciones: params.observaciones,
      });
    }

    return updated;
  });
}

/**
 * Campos a fusionar en un `prisma.task.update({ data: ... })` cuando el
 * colaborador (o cualquiera con acceso) reedita `endDate` de una tarea cuya
 * Fecha Fin ya había sido decidida (Aprobada/Modificada/Rechazada) — esa
 * edición ES la "nueva solicitud de aprobación" que pide el spec, sin UI ni
 * endpoint dedicado: simplemente vuelve a Pendiente.
 */
export function pendingResetTaskData() {
  return { endDateApprovalStatus: "PENDIENTE" as const, endDateApprovedAt: null, endDateApprovedById: null };
}

/** Registro de auditoría del evento "PROPUESTA" — ver pendingResetTaskData. Se crea DENTRO de la misma transacción que el PATCH de la tarea (ver PATCH /api/tasks/[id]). */
export async function createEndDateProposalAuditLog(
  tx: Prisma.TransactionClient,
  params: { taskId: string; userId: string; userRole: Role; previousValue: Date; newValue: Date; ipAddress: string | null }
) {
  return tx.endDateAuditLog.create({
    data: {
      taskId: params.taskId,
      userId: params.userId,
      userRole: params.userRole,
      action: "PROPUESTA",
      previousValue: params.previousValue,
      newValue: params.newValue,
      observaciones: null,
      ipAddress: params.ipAddress,
    },
  });
}

// ── Regularización de tareas existentes (mirror de targetTimeServer.ts) ─────

export type PendingEndDateFilters = { userId?: string; role?: Role; type?: TaskType };

/** % de tareas activas/recientes con Fecha Fin aprobada/modificada (no pendiente ni rechazada) vs. pendiente. */
export async function getEndDateDataQuality(filters: Pick<PendingEndDateFilters, "role"> = {}) {
  const recentSince = new Date(Date.now() - REGULARIZATION_RECENT_DAYS * 86400000);
  const scope = {
    ...(filters.role ? { assignedTo: { role: filters.role } } : {}),
    OR: [{ archivedMonth: null }, { archivedAt: { gte: recentSince } }],
  };
  const [pendingCount, totalCount] = await Promise.all([
    prisma.task.count({ where: { ...scope, endDateApprovalStatus: "PENDIENTE" } }),
    prisma.task.count({ where: scope }),
  ]);
  const validatedCount = totalCount - pendingCount;
  const validatedPct = totalCount > 0 ? Math.round((validatedCount / totalCount) * 100) : 100;
  return { validatedCount, pendingCount, totalCount, validatedPct, pendingPct: 100 - validatedPct };
}
