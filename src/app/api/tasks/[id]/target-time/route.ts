import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { getVisibleRoles } from "@/lib/roles";
import { getClientIp } from "@/lib/rate-limit";
import { invalidateAnalyticsCache } from "@/lib/analytics";
import {
  getOfficialTargetTime,
  isTargetTimeValidated,
  computeDeviation,
  canValidateTargetTime,
  isValidTargetTimeReason,
} from "@/lib/targetTime";
import { getHistoricalDeviationForTask, getTargetTimeAuditHistory, applyTargetTimeValidation } from "@/lib/targetTimeServer";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Tiempo Objetivo de una tarea (§Sprint 6) — GET expone el estado actual
 * (inicial/validado/desviación/desviación histórica del proceso/auditoría);
 * POST aplica una validación (§S6-C), siempre auditada (§S6-G). NUNCA toca
 * `realHours` — las horas reales solo se editan desde /activities.
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
      estimatedHours: true,
      realHours: true,
      targetTimeValidated: true,
      targetTimeValidatedAt: true,
      targetTimeValidator: { select: { id: true, name: true } },
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

  const officialTarget = getOfficialTargetTime(task);
  const deviation = computeDeviation(task.realHours, officialTarget);
  const [auditHistory, historicalDeviation] = await Promise.all([
    getTargetTimeAuditHistory(id),
    getHistoricalDeviationForTask(task.title, officialTarget, id),
  ]);

  return NextResponse.json({
    estimatedHours: task.estimatedHours,
    targetTimeValidated: task.targetTimeValidated,
    targetTimeValidatedAt: task.targetTimeValidatedAt,
    validatedBy: task.targetTimeValidator,
    isValidated: isTargetTimeValidated(task),
    officialTarget,
    realHours: task.realHours,
    deviation,
    canValidate: canValidateTargetTime(session.role, task.assignedToId, session.userId),
    auditHistory: auditHistory.map((a) => ({
      id: a.id,
      previousValue: a.previousValue,
      newValue: a.newValue,
      reason: a.reason,
      reasonDetail: a.reasonDetail,
      user: a.user,
      userRole: a.userRole,
      createdAt: a.createdAt,
    })),
    historicalDeviation,
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
  if (!canSeeTask || !canValidateTargetTime(session.role, task.assignedToId, session.userId)) {
    return NextResponse.json({ error: "Sin permisos para validar el Tiempo Objetivo de esta tarea" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }
  const { newValue, reason, reasonDetail } = (body ?? {}) as { newValue?: unknown; reason?: unknown; reasonDetail?: unknown };

  const parsedValue = typeof newValue === "number" ? newValue : parseFloat(String(newValue));
  if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
    return NextResponse.json({ error: "El nuevo tiempo objetivo debe ser un número mayor a 0" }, { status: 400 });
  }
  if (!isValidTargetTimeReason(reason)) {
    return NextResponse.json({ error: "Motivo de ajuste inválido" }, { status: 400 });
  }
  if (reason === "OTRO" && !(typeof reasonDetail === "string" && reasonDetail.trim())) {
    return NextResponse.json({ error: "Debes indicar el detalle del motivo cuando eliges \"Otro\"" }, { status: 400 });
  }

  const updated = await applyTargetTimeValidation({
    taskId: id,
    newValue: Math.round(parsedValue * 100) / 100,
    reason,
    reasonDetail: typeof reasonDetail === "string" && reasonDetail.trim() ? reasonDetail.trim() : null,
    userId: session.userId,
    userRole: session.role,
    ipAddress: getClientIp(request.headers),
  });
  if (!updated) return NextResponse.json({ error: "Tarea no encontrada" }, { status: 404 });

  invalidateAnalyticsCache();

  return NextResponse.json({
    targetTimeValidated: updated.targetTimeValidated,
    targetTimeValidatedAt: updated.targetTimeValidatedAt,
  });
}
