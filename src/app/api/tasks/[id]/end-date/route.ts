import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { getVisibleRoles } from "@/lib/roles";
import { getClientIp } from "@/lib/rate-limit";
import { invalidateAnalyticsCache } from "@/lib/analytics";
import { canValidateEndDate, isValidEndDateAction } from "@/lib/endDate";
import { getEndDateAuditHistory, applyEndDateAction } from "@/lib/endDateServer";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Fecha Fin de una tarea (validación por líderes) — GET expone el estado
 * actual (aprobación/auditoría); POST aplica una decisión (Aprobar/
 * Modificar/Rechazar), siempre auditada. Mismo esqueleto de permisos que
 * [id]/target-time/route.ts.
 */
export async function GET(_req: NextRequest, ctx: Ctx) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { id } = await ctx.params;
  const task = await prisma.task.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      endDate: true,
      endDateApprovalStatus: true,
      endDateApprovedAt: true,
      endDateApprover: { select: { id: true, name: true } },
      assignedToId: true,
      createdById: true,
      assignedTo: { select: { role: true } },
    },
  });
  if (!task) return NextResponse.json({ error: "Tarea no encontrada" }, { status: 404 });

  const canView =
    task.assignedToId === session.userId ||
    task.createdById === session.userId ||
    getVisibleRoles(session.role).includes(task.assignedTo.role);
  if (!canView) return NextResponse.json({ error: "Sin permisos" }, { status: 403 });

  const auditHistory = await getEndDateAuditHistory(id);

  return NextResponse.json({
    endDate: task.endDate,
    endDateApprovalStatus: task.endDateApprovalStatus,
    endDateApprovedAt: task.endDateApprovedAt,
    approvedBy: task.endDateApprover,
    canValidate: canValidateEndDate(session.role, task.assignedToId, session.userId),
    auditHistory: auditHistory.map((a) => ({
      id: a.id,
      action: a.action,
      previousValue: a.previousValue,
      newValue: a.newValue,
      observaciones: a.observaciones,
      user: a.user,
      userRole: a.userRole,
      createdAt: a.createdAt,
    })),
  });
}

export async function POST(request: NextRequest, ctx: Ctx) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { id } = await ctx.params;
  const task = await prisma.task.findUnique({
    where: { id },
    select: { id: true, assignedToId: true, assignedTo: { select: { role: true } } },
  });
  if (!task) return NextResponse.json({ error: "Tarea no encontrada" }, { status: 404 });

  const canSeeTask = getVisibleRoles(session.role).includes(task.assignedTo.role);
  if (!canSeeTask || !canValidateEndDate(session.role, task.assignedToId, session.userId)) {
    return NextResponse.json({ error: "Sin permisos para validar la Fecha Fin de esta tarea" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }
  const { action, newEndDate, observaciones } = (body ?? {}) as { action?: unknown; newEndDate?: unknown; observaciones?: unknown };

  if (!isValidEndDateAction(action)) {
    return NextResponse.json({ error: "Acción inválida" }, { status: 400 });
  }
  let parsedNewEndDate: Date | null = null;
  if (action === "MODIFICAR") {
    const d = new Date(String(newEndDate));
    if (!newEndDate || Number.isNaN(d.getTime())) {
      return NextResponse.json({ error: "Debes indicar una nueva fecha fin válida" }, { status: 400 });
    }
    parsedNewEndDate = d;
  }

  const updated = await applyEndDateAction({
    taskId: id,
    action,
    newEndDate: parsedNewEndDate,
    observaciones: typeof observaciones === "string" && observaciones.trim() ? observaciones.trim() : null,
    userId: session.userId,
    userRole: session.role,
    ipAddress: getClientIp(request.headers),
  });
  if (!updated) return NextResponse.json({ error: "Tarea no encontrada" }, { status: 404 });

  invalidateAnalyticsCache(task.assignedToId);

  return NextResponse.json({
    endDate: updated.endDate,
    endDateApprovalStatus: updated.endDateApprovalStatus,
    endDateApprovedAt: updated.endDateApprovedAt,
  });
}
