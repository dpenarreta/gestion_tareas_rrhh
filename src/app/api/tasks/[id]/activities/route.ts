import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { businessCalendarDay } from "@/lib/businessTime";
import { findOverlappingActivity, overlapMessage } from "@/lib/activityOverlap";
import { timeToMinutes } from "@/lib/timeOverlap";
import { invalidateAnalyticsCache } from "@/lib/analytics";

type Ctx = { params: Promise<{ id: string }> };

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

async function recalcRealHours(taskId: string) {
  const activities = await prisma.taskActivity.findMany({
    where: { taskId },
    select: { duration: true },
  });
  const totalMins = activities.reduce((sum, a) => sum + a.duration, 0);
  await prisma.task.update({
    where: { id: taskId },
    data: { realHours: Math.round((totalMins / 60) * 100) / 100 },
  });
}

export async function GET(_req: NextRequest, ctx: Ctx) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    }

    const { id } = await ctx.params;
    const activities = await prisma.taskActivity.findMany({
      where: { taskId: id },
      select: activitySelect,
      orderBy: { createdAt: "asc" },
    });

    return NextResponse.json(activities);
  } catch (err) {
    console.error("GET /activities error:", err);
    return NextResponse.json([], { status: 200 });
  }
}

export async function POST(request: NextRequest, ctx: Ctx) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    }

    const { id: taskId } = await ctx.params;

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Cuerpo de la solicitud inválido" }, { status: 400 });
    }

    const { reason, hours, minutes, description, startTime, endTime } = body as {
      reason?: string;
      hours?: number;
      minutes?: number;
      description?: string;
      startTime?: string;
      endTime?: string;
    };

    if (!reason || hours === undefined || minutes === undefined) {
      return NextResponse.json({ error: "Faltan campos requeridos" }, { status: 400 });
    }

    const reasonRow = await prisma.activityReason.findUnique({ where: { key: reason } });
    if (!reasonRow || !reasonRow.isActive || !reasonRow.assignedRoles.includes(session.role)) {
      return NextResponse.json({ error: "Motivo inválido o no disponible para tu rol" }, { status: 400 });
    }

    if (!Number.isInteger(hours) || hours < 0 || hours > 23) {
      return NextResponse.json({ error: "Las horas deben ser un número entre 0 y 23" }, { status: 400 });
    }

    if (!Number.isInteger(minutes) || minutes < 0 || minutes > 59) {
      return NextResponse.json({ error: "Los minutos deben ser un número entre 0 y 59" }, { status: 400 });
    }

    const duration = hours * 60 + minutes;

    if (duration <= 0) {
      return NextResponse.json(
        { error: "La duración debe ser mayor a 0" },
        { status: 400 }
      );
    }

    const task = await prisma.task.findUnique({ where: { id: taskId } });
    if (!task) {
      return NextResponse.json({ error: "Tarea no encontrada" }, { status: 404 });
    }

    // El validador de solapamiento solo aplica cuando se usa el formato
    // hora inicio/hora fin (no en tareas FIJA, que no pasan por esta ruta).
    if (startTime && endTime) {
      if (timeToMinutes(startTime) === null || timeToMinutes(endTime) === null) {
        return NextResponse.json({ error: "Hora inválida" }, { status: 400 });
      }
      if (timeToMinutes(endTime)! <= timeToMinutes(startTime)!) {
        return NextResponse.json({ error: "La hora fin debe ser posterior a la hora inicio" }, { status: 400 });
      }
      const today = businessCalendarDay(new Date());
      const conflict = await findOverlappingActivity(session.userId, today, startTime, endTime);
      if (conflict) {
        return NextResponse.json({ error: overlapMessage(conflict), conflict }, { status: 409 });
      }
    }

    const activity = await prisma.taskActivity.create({
      data: {
        taskId,
        authorId: session.userId,
        reason,
        duration,
        description: description?.trim() || null,
        startTime: startTime || null,
        endTime: endTime || null,
      },
      select: activitySelect,
    });

    await recalcRealHours(taskId);
    invalidateAnalyticsCache();

    return NextResponse.json(activity, { status: 201 });
  } catch (err) {
    console.error("POST /activities error:", err);
    return NextResponse.json({ error: "Error interno al registrar actividad" }, { status: 500 });
  }
}
