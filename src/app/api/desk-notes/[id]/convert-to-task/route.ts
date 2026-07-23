import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { canUseDeskNotes } from "@/lib/roles";
import { invalidateAnalyticsCache } from "@/lib/analytics";
import { logDeskAudit } from "@/lib/deskAudit";
import type { DeskNotePriority, TaskPriority, TaskFrequency, TaskType } from "@/generated/prisma/client";

type Ctx = { params: Promise<{ id: string }> };

const VALID_TYPES: TaskType[] = ["FIJA", "SEGUIMIENTO"];
const VALID_FREQUENCIES: TaskFrequency[] = ["MENSUAL", "SEMANAL", "DIARIA", "QUINCENAL", "PUNTUAL"];

// La nota no tiene "prioridad de tarea" propia — se traduce a la escala de
// Trabajo (ALTA/MEDIA/BAJA). URGENTE e IMPORTANTE colapsan en ALTA a
// propósito: Trabajo no tiene un cuarto nivel.
const PRIORITY_MAP: Record<DeskNotePriority, TaskPriority> = {
  URGENTE: "ALTA",
  IMPORTANTE: "ALTA",
  RECORDATORIO: "MEDIA",
  INFORMACION: "BAJA",
};

/**
 * §4 "Convertir en tarea" — completamente opcional, reutiliza el flujo de
 * creación existente de Trabajo (mismos campos requeridos que POST
 * /api/tasks) SIN modificar el módulo Trabajo (§15 Restricciones): Task no
 * tiene campo de adjunto, así que el archivo de la nota se referencia por
 * nombre en la descripción en vez de duplicarse en una tabla que no lo
 * soporta. La nota original nunca se edita ni se elimina — solo queda
 * marcada `convertedToTaskId`/`convertedAt`.
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
  const note = await prisma.deskNote.findUnique({
    where: { id },
    select: {
      recipientId: true,
      deletedAt: true,
      message: true,
      priority: true,
      attachmentName: true,
      convertedToTaskId: true,
    },
  });
  if (!note || note.deletedAt) {
    return NextResponse.json({ error: "Nota no encontrada" }, { status: 404 });
  }
  if (note.recipientId !== session.userId) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }
  if (note.convertedToTaskId) {
    return NextResponse.json({ error: "Esta nota ya fue convertida en tarea" }, { status: 409 });
  }

  const body = await request.json().catch(() => null);
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  const type = VALID_TYPES.includes(body?.type) ? (body.type as TaskType) : "SEGUIMIENTO";
  const frequency = VALID_FREQUENCIES.includes(body?.frequency) ? (body.frequency as TaskFrequency) : "PUNTUAL";
  const startDate = typeof body?.startDate === "string" ? body.startDate : "";
  const endDate = typeof body?.endDate === "string" ? body.endDate : "";
  const estimatedHours = Number(body?.estimatedHours);

  if (!title || !startDate || !endDate || !Number.isFinite(estimatedHours) || estimatedHours <= 0) {
    return NextResponse.json({ error: "Faltan campos requeridos" }, { status: 400 });
  }

  const description = [
    note.message,
    note.attachmentName ? `(Adjunto en la nota original: ${note.attachmentName})` : null,
  ]
    .filter(Boolean)
    .join("\n\n");

  const task = await prisma.task.create({
    data: {
      title,
      description,
      type,
      status: "PENDIENTE",
      priority: PRIORITY_MAP[note.priority],
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

  await prisma.deskNote.update({
    where: { id },
    data: { convertedToTaskId: task.id, convertedAt: new Date() },
  });

  invalidateAnalyticsCache(session.userId);

  await logDeskAudit({
    entityType: "NOTE",
    entityId: id,
    userId: session.userId,
    action: "CONVERTED_TO_TASK",
    metadata: { taskId: task.id },
  });

  return NextResponse.json({ taskId: task.id, taskTitle: task.title }, { status: 201 });
}
