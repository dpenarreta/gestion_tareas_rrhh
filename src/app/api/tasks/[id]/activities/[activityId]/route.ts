import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { invalidateAnalyticsCache } from "@/lib/analytics";
import { recalcTaskRealHours } from "@/lib/recalcHours";

type Ctx = { params: Promise<{ id: string; activityId: string }> };

const activitySelect = {
  id: true,
  reason: true,
  startTime: true,
  endTime: true,
  duration: true,
  description: true,
  isRetroactive: true,
  activityDate: true,
  adminComment: true,
  modifiedByAdmin: true,
  modifiedAt: true,
  author: { select: { id: true, name: true } },
  createdAt: true,
  _count: { select: { comments: true } },
} as const;

export async function PATCH(request: NextRequest, ctx: Ctx) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    }
    if (session.role !== "ADMINISTRADOR") {
      return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
    }

    const { id: taskId, activityId } = await ctx.params;

    const activity = await prisma.taskActivity.findUnique({ where: { id: activityId } });
    if (!activity || activity.taskId !== taskId) {
      return NextResponse.json({ error: "Actividad no encontrada" }, { status: 404 });
    }

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Cuerpo de la solicitud inválido" }, { status: 400 });
    }

    const { hours, minutes, comment } = body as {
      hours?: number;
      minutes?: number;
      comment?: string;
    };

    if (hours === undefined || minutes === undefined) {
      return NextResponse.json({ error: "Faltan campos requeridos" }, { status: 400 });
    }
    if (!comment?.trim()) {
      return NextResponse.json(
        { error: "El comentario de modificación es obligatorio" },
        { status: 400 }
      );
    }
    if (!Number.isInteger(hours) || hours < 0 || hours > 23) {
      return NextResponse.json({ error: "Las horas deben ser un número entre 0 y 23" }, { status: 400 });
    }
    if (!Number.isInteger(minutes) || minutes < 0 || minutes > 59) {
      return NextResponse.json({ error: "Los minutos deben ser un número entre 0 y 59" }, { status: 400 });
    }
    const newDuration = hours * 60 + minutes;
    if (newDuration <= 0) {
      return NextResponse.json({ error: "La duración debe ser mayor a 0" }, { status: 400 });
    }

    const task = await prisma.task.findUnique({ where: { id: taskId } });
    if (!task) {
      return NextResponse.json({ error: "Tarea no encontrada" }, { status: 404 });
    }

    const oldDuration = activity.duration;
    const modifiedAt = new Date();
    const trimmedComment = comment.trim();

    const updated = await prisma.taskActivity.update({
      where: { id: activityId },
      data: {
        duration: newDuration,
        adminComment: trimmedComment,
        modifiedByAdmin: true,
        modifiedAt,
      },
      select: activitySelect,
    });

    await recalcTaskRealHours(taskId);
    invalidateAnalyticsCache(task.assignedToId);

    await prisma.activityAuditLog.create({
      data: {
        activityId,
        adminId: session.userId,
        oldDuration,
        newDuration,
        comment: trimmedComment,
        modifiedAt,
      },
    });

    await prisma.notification.create({
      data: {
        userId: task.assignedToId,
        message: `El Administrador modificó una actividad en "${task.title}": ${trimmedComment}`,
        taskId,
        taskTitle: task.title,
      },
    });

    return NextResponse.json(updated);
  } catch (err) {
    console.error("PATCH /activities/[activityId] error:", err);
    return NextResponse.json({ error: "Error interno al modificar la actividad" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    }

    const { id: taskId, activityId } = await ctx.params;

    const activity = await prisma.taskActivity.findUnique({
      where: { id: activityId },
    });

    if (!activity || activity.taskId !== taskId) {
      return NextResponse.json({ error: "Actividad no encontrada" }, { status: 404 });
    }

    if (activity.authorId !== session.userId) {
      return NextResponse.json({ error: "Sin permiso para eliminar" }, { status: 403 });
    }

    await prisma.taskActivity.delete({ where: { id: activityId } });
    await recalcTaskRealHours(taskId);
    // El autor de la actividad puede ser distinto del responsable de la
    // tarea (tareas SEGUIMIENTO compartidas) — las horas reales se atribuyen
    // al responsable, así que hay que invalidar su caché, no el del autor.
    const task = await prisma.task.findUnique({ where: { id: taskId }, select: { assignedToId: true } });
    invalidateAnalyticsCache(task?.assignedToId);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("DELETE /activities/[activityId] error:", err);
    return NextResponse.json({ error: "Error interno al eliminar actividad" }, { status: 500 });
  }
}
