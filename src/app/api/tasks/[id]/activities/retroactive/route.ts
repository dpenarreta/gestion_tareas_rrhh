import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { formatDate } from "@/lib/utils";
import { businessCalendarDay, businessDayRealRange, previousBusinessDays } from "@/lib/businessTime";
import type { ActivityReason } from "@/generated/prisma/client";

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

/** "YYYY-MM-DD" (del date picker, sin componente horario) -> Date UTC-medianoche. */
function parseDateOnly(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [y, m, d] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(y, m - 1, d));
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
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

    const { reason, hours, minutes, description, activityDate } = body as {
      reason?: string;
      hours?: number;
      minutes?: number;
      description?: string;
      activityDate?: string;
    };

    if (!reason || hours === undefined || minutes === undefined || !activityDate) {
      return NextResponse.json({ error: "Faltan campos requeridos" }, { status: 400 });
    }

    if (!description?.trim()) {
      return NextResponse.json(
        { error: "La descripción es obligatoria para un registro retroactivo" },
        { status: 400 }
      );
    }

    if (!Number.isInteger(hours) || hours < 0 || hours > 23) {
      return NextResponse.json({ error: "Las horas deben ser un número entre 0 y 23" }, { status: 400 });
    }
    if (!Number.isInteger(minutes) || minutes < 0 || minutes > 59) {
      return NextResponse.json({ error: "Los minutos deben ser un número entre 0 y 59" }, { status: 400 });
    }
    const duration = hours * 60 + minutes;
    if (duration <= 0) {
      return NextResponse.json({ error: "La duración debe ser mayor a 0" }, { status: 400 });
    }

    const parsedDate = parseDateOnly(activityDate);
    if (!parsedDate) {
      return NextResponse.json({ error: "Fecha inválida" }, { status: 400 });
    }

    const today = businessCalendarDay(new Date());
    const validDates = previousBusinessDays(today, 2);
    const isValidDate = validDates.some((d) => d.getTime() === parsedDate.getTime());
    if (!isValidDate) {
      return NextResponse.json(
        { error: "La fecha debe ser uno de los últimos 2 días laborables (no incluye hoy ni fines de semana)" },
        { status: 400 }
      );
    }

    const task = await prisma.task.findUnique({ where: { id: taskId } });
    if (!task) {
      return NextResponse.json({ error: "Tarea no encontrada" }, { status: 404 });
    }
    if (task.type !== "SEGUIMIENTO") {
      return NextResponse.json(
        { error: "El registro retroactivo solo aplica a tareas de tipo Seguimiento" },
        { status: 400 }
      );
    }

    // createdAt se fija dentro del rango horario real de activityDate (no "ahora") para que
    // todo cálculo de carga/KPI existente, que agrupa TaskActivity por createdAt, atribuya
    // estas horas al día retroactivo sin necesitar cambios en esa lógica.
    const backdatedCreatedAt = businessDayRealRange(parsedDate).start;

    const activity = await prisma.taskActivity.create({
      data: {
        taskId,
        authorId: session.userId,
        reason: reason as ActivityReason,
        duration,
        description: description.trim(),
        isRetroactive: true,
        activityDate: parsedDate,
        createdAt: backdatedCreatedAt,
      },
      select: activitySelect,
    });

    await recalcRealHours(taskId);

    const coordinadores = await prisma.user.findMany({
      where: { role: "COORDINADOR_NACIONAL" },
      select: { id: true },
    });
    if (coordinadores.length > 0) {
      await prisma.notification.createMany({
        data: coordinadores.map((u) => ({
          userId: u.id,
          message: `${session.name} registró horas retroactivas del ${formatDate(parsedDate)} en la tarea "${task.title}"`,
          taskId,
          taskTitle: task.title,
        })),
      });
    }

    return NextResponse.json(activity, { status: 201 });
  } catch (err) {
    console.error("POST /activities/retroactive error:", err);
    return NextResponse.json({ error: "Error interno al registrar la actividad retroactiva" }, { status: 500 });
  }
}
