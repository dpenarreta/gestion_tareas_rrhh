import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { canUseDeskNotes } from "@/lib/roles";
import { invalidateAnalyticsCache } from "@/lib/analytics";
import { logDeskAudit } from "@/lib/deskAudit";
import type { ReminderPriority, TaskPriority, TaskFrequency, TaskType } from "@/generated/prisma/client";

type Ctx = { params: Promise<{ id: string }> };

const VALID_TYPES: TaskType[] = ["FIJA", "SEGUIMIENTO"];
const VALID_FREQUENCIES: TaskFrequency[] = ["MENSUAL", "SEMANAL", "DIARIA", "QUINCENAL", "PUNTUAL"];

// El recordatorio no tiene "prioridad de tarea" propia — se traduce a la
// escala de Trabajo (ALTA/MEDIA/BAJA). URGENTE colapsa en ALTA a propósito:
// Trabajo no tiene un cuarto nivel.
const PRIORITY_MAP: Record<ReminderPriority, TaskPriority> = {
  URGENTE: "ALTA",
  ALTA: "ALTA",
  MEDIA: "MEDIA",
  BAJA: "BAJA",
};

/**
 * §6 "Crear tarea" — completamente opcional, reutiliza el flujo de creación
 * existente de Trabajo (mismos campos requeridos que POST /api/tasks) sin
 * modificar el módulo Trabajo: Task no tiene campo de adjunto, así que el
 * archivo del recordatorio (copiado a su vez desde la nota de origen, si
 * aplica) se referencia por nombre en la descripción en vez de duplicarse en
 * una tabla que no lo soporta. El recordatorio original nunca se edita ni se
 * elimina — solo queda marcado `convertedToTaskId`/`convertedToTaskAt`.
 */
export async function POST(request: NextRequest, ctx: Ctx) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  if (!canUseDeskNotes(session.role)) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const { id } = await ctx.params;
  const reminder = await prisma.personalReminder.findUnique({
    where: { id },
    select: {
      userId: true,
      title: true,
      description: true,
      priority: true,
      attachmentName: true,
      convertedToTaskId: true,
    },
  });
  if (!reminder) {
    return NextResponse.json({ error: "Recordatorio no encontrado" }, { status: 404 });
  }
  if (reminder.userId !== session.userId) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }
  if (reminder.convertedToTaskId) {
    return NextResponse.json({ error: "Este recordatorio ya fue convertido en tarea" }, { status: 409 });
  }

  const body = await request.json().catch(() => null);
  const titleRaw = typeof body?.title === "string" ? body.title.trim() : "";
  const title = titleRaw || reminder.title;
  const type = VALID_TYPES.includes(body?.type) ? (body.type as TaskType) : "SEGUIMIENTO";
  const frequency = VALID_FREQUENCIES.includes(body?.frequency) ? (body.frequency as TaskFrequency) : "PUNTUAL";
  const startDate = typeof body?.startDate === "string" ? body.startDate : "";
  const endDate = typeof body?.endDate === "string" ? body.endDate : "";
  const estimatedHours = Number(body?.estimatedHours);

  if (!startDate || !endDate || !Number.isFinite(estimatedHours) || estimatedHours <= 0) {
    return NextResponse.json({ error: "Faltan campos requeridos" }, { status: 400 });
  }

  const description = [
    reminder.description,
    reminder.attachmentName ? `(Adjunto en el recordatorio original: ${reminder.attachmentName})` : null,
  ]
    .filter(Boolean)
    .join("\n\n") || null;

  const task = await prisma.task.create({
    data: {
      title,
      description,
      type,
      status: "PENDIENTE",
      priority: PRIORITY_MAP[reminder.priority],
      frequency,
      startDate: new Date(startDate),
      endDate: new Date(endDate),
      estimatedHours,
      progress: 0,
      assignedToId: session.userId,
      createdById: session.userId,
    },
    select: { id: true, title: true },
  });

  await prisma.personalReminder.update({
    where: { id },
    data: { convertedToTaskId: task.id, convertedToTaskAt: new Date() },
  });

  invalidateAnalyticsCache(session.userId);

  await logDeskAudit({
    entityType: "REMINDER",
    entityId: id,
    userId: session.userId,
    action: "CONVERTED_TO_TASK",
    metadata: { taskId: task.id },
  });

  return NextResponse.json({ taskId: task.id, taskTitle: task.title }, { status: 201 });
}
