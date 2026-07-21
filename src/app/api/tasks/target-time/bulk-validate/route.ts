import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import type { Role } from "@/generated/prisma/client";
import { getClientIp } from "@/lib/rate-limit";
import { invalidateAnalyticsCache } from "@/lib/analytics";
import { isValidTargetTimeReason } from "@/lib/targetTime";
import { applyTargetTimeValidation } from "@/lib/targetTimeServer";

const CAN_REGULARIZE: Role[] = ["ADMINISTRADOR", "JEFE_NACIONAL"];

/**
 * Edición masiva de la herramienta de regularización (§Sprint 6 S6-D) —
 * aplica el MISMO nuevo Tiempo Objetivo y motivo a varias tareas a la vez.
 * Cada tarea queda auditada individualmente (§S6-G), igual que una
 * validación una-por-una. Las tareas asignadas al propio usuario se omiten
 * (nunca el responsable puede validar su propio Tiempo Objetivo, §S6-B).
 */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (!CAN_REGULARIZE.includes(session.role)) return NextResponse.json({ error: "Sin permisos" }, { status: 403 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }
  const { taskIds, newValue, reason, reasonDetail } = (body ?? {}) as {
    taskIds?: unknown;
    newValue?: unknown;
    reason?: unknown;
    reasonDetail?: unknown;
  };

  if (!Array.isArray(taskIds) || taskIds.length === 0 || !taskIds.every((t) => typeof t === "string")) {
    return NextResponse.json({ error: "Debes seleccionar al menos una tarea" }, { status: 400 });
  }
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

  const tasks = await prisma.task.findMany({ where: { id: { in: taskIds } }, select: { id: true, assignedToId: true } });
  const skippedSelfAssigned = tasks.filter((t) => t.assignedToId === session.userId).map((t) => t.id);
  const eligible = tasks.filter((t) => t.assignedToId !== session.userId);

  const ipAddress = getClientIp(request.headers);
  const value = Math.round(parsedValue * 100) / 100;
  const detail = typeof reasonDetail === "string" && reasonDetail.trim() ? reasonDetail.trim() : null;

  let updatedCount = 0;
  for (const task of eligible) {
    const updated = await applyTargetTimeValidation({
      taskId: task.id,
      newValue: value,
      reason,
      reasonDetail: detail,
      userId: session.userId,
      userRole: session.role,
      ipAddress,
    });
    if (updated) updatedCount++;
  }

  invalidateAnalyticsCache(eligible.map((t) => t.assignedToId));

  return NextResponse.json({ updatedCount, skippedSelfAssigned });
}
