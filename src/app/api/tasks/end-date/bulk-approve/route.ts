import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import type { Role } from "@/generated/prisma/client";
import { getClientIp } from "@/lib/rate-limit";
import { invalidateAnalyticsCache } from "@/lib/analytics";
import { applyEndDateAction } from "@/lib/endDateServer";

const CAN_REGULARIZE: Role[] = ["ADMINISTRADOR", "JEFE_NACIONAL"];

type BulkItem = { taskId: string; newEndDate?: string };

function isValidItems(value: unknown): value is BulkItem[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (v) =>
        typeof v === "object" &&
        v !== null &&
        typeof (v as { taskId?: unknown }).taskId === "string" &&
        ((v as { newEndDate?: unknown }).newEndDate === undefined || typeof (v as { newEndDate?: unknown }).newEndDate === "string")
    )
  );
}

/**
 * Edición/aprobación masiva de Fecha Fin — a diferencia del bulk de Tiempo
 * Objetivo (que fija el MISMO nuevo valor a varias tareas), aquí cada tarea
 * puede recibir su PROPIA fecha ajustada (mejora — antes solo aprobaba en
 * bloque la fecha ya propuesta, sin poder editarla). Si `newEndDate` no
 * viene o coincide con la fecha actual de la tarea, se aplica como APROBAR
 * (sin cambio); si difiere, se aplica como MODIFICAR — reusa
 * `applyEndDateAction` sin duplicar su lógica de transacción/auditoría/
 * notificación. Cada tarea queda auditada individualmente. Las tareas
 * asignadas al propio usuario se omiten (nunca el responsable puede validar
 * su propia Fecha Fin); las que llevan una `newEndDate` anterior a su
 * `startDate` también se omiten y se reportan aparte.
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
  const { items, observaciones } = (body ?? {}) as { items?: unknown; observaciones?: unknown };

  if (!isValidItems(items)) {
    return NextResponse.json({ error: "Debes seleccionar al menos una tarea" }, { status: 400 });
  }

  const taskIds = items.map((i) => i.taskId);
  const tasks = await prisma.task.findMany({
    where: { id: { in: taskIds } },
    select: { id: true, assignedToId: true, startDate: true, endDate: true },
  });
  const taskById = new Map(tasks.map((t) => [t.id, t]));

  const ipAddress = getClientIp(request.headers);
  const detail = typeof observaciones === "string" && observaciones.trim() ? observaciones.trim() : null;

  const skippedSelfAssigned: string[] = [];
  const skippedInvalidDate: string[] = [];
  const affectedUserIds = new Set<string>();
  let updatedCount = 0;

  for (const item of items) {
    const task = taskById.get(item.taskId);
    if (!task) continue;
    if (task.assignedToId === session.userId) {
      skippedSelfAssigned.push(item.taskId);
      continue;
    }

    let newEndDateValue: Date | null = null;
    if (item.newEndDate) {
      const parsed = new Date(item.newEndDate);
      if (Number.isNaN(parsed.getTime()) || parsed.getTime() < task.startDate.getTime()) {
        skippedInvalidDate.push(item.taskId);
        continue;
      }
      // Si coincide con la fecha ya vigente, no es realmente una modificación
      // — se aprueba tal cual (mismo criterio que "si el líder no modifica la
      // fecha, se mantiene la Fecha Fin original").
      if (parsed.getTime() !== task.endDate.getTime()) newEndDateValue = parsed;
    }

    const updated = await applyEndDateAction({
      taskId: item.taskId,
      action: newEndDateValue ? "MODIFICAR" : "APROBAR",
      newEndDate: newEndDateValue,
      observaciones: detail,
      userId: session.userId,
      userRole: session.role,
      ipAddress,
    });
    if (updated) {
      updatedCount++;
      affectedUserIds.add(task.assignedToId);
    }
  }

  invalidateAnalyticsCache([...affectedUserIds]);

  return NextResponse.json({ updatedCount, skippedSelfAssigned, skippedInvalidDate });
}
