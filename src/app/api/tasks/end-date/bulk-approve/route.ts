import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import type { Role } from "@/generated/prisma/client";
import { getClientIp } from "@/lib/rate-limit";
import { invalidateAnalyticsCache } from "@/lib/analytics";
import { applyEndDateAction } from "@/lib/endDateServer";

const CAN_REGULARIZE: Role[] = ["ADMINISTRADOR", "JEFE_NACIONAL"];

/**
 * Edición masiva de la herramienta de regularización de Fecha Fin — a
 * diferencia del bulk de Tiempo Objetivo (que fija el MISMO nuevo valor a
 * varias tareas), aquí solo tiene sentido APROBAR en bloque la fecha YA
 * propuesta de cada tarea seleccionada (fijar la misma fecha a tareas
 * distintas no sería correcto). Cada tarea queda auditada individualmente.
 * Las tareas asignadas al propio usuario se omiten (nunca el responsable
 * puede validar su propia Fecha Fin).
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
  const { taskIds, observaciones } = (body ?? {}) as { taskIds?: unknown; observaciones?: unknown };

  if (!Array.isArray(taskIds) || taskIds.length === 0 || !taskIds.every((t) => typeof t === "string")) {
    return NextResponse.json({ error: "Debes seleccionar al menos una tarea" }, { status: 400 });
  }

  const tasks = await prisma.task.findMany({ where: { id: { in: taskIds } }, select: { id: true, assignedToId: true } });
  const skippedSelfAssigned = tasks.filter((t) => t.assignedToId === session.userId).map((t) => t.id);
  const eligible = tasks.filter((t) => t.assignedToId !== session.userId);

  const ipAddress = getClientIp(request.headers);
  const detail = typeof observaciones === "string" && observaciones.trim() ? observaciones.trim() : null;

  let updatedCount = 0;
  for (const task of eligible) {
    const updated = await applyEndDateAction({
      taskId: task.id,
      action: "APROBAR",
      newEndDate: null,
      observaciones: detail,
      userId: session.userId,
      userRole: session.role,
      ipAddress,
    });
    if (updated) updatedCount++;
  }

  invalidateAnalyticsCache(eligible.map((t) => t.assignedToId));

  return NextResponse.json({ updatedCount, skippedSelfAssigned });
}
