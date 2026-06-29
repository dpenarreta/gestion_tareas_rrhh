import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import type { ActivityReason } from "@/generated/prisma/client";

type Ctx = { params: Promise<{ id: string }> };

const activitySelect = {
  id: true,
  reason: true,
  startTime: true,
  endTime: true,
  duration: true,
  description: true,
  author: { select: { id: true, name: true } },
  createdAt: true,
} as const;

async function recalcRealHours(taskId: string) {
  const activities = await prisma.taskActivity.findMany({
    where: { taskId },
    select: { duration: true },
  });
  const totalMins = activities.reduce((sum, a) => sum + a.duration, 0);
  await prisma.task.update({
    where: { id: taskId },
    data: { realHours: totalMins / 60 },
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

    const { reason, startTime, endTime, description } = body as {
      reason?: string;
      startTime?: string;
      endTime?: string;
      description?: string;
    };

    if (!reason || !startTime || !endTime) {
      return NextResponse.json({ error: "Faltan campos requeridos" }, { status: 400 });
    }

    const [sh, sm] = startTime.split(":").map(Number);
    const [eh, em] = endTime.split(":").map(Number);
    const duration = (eh * 60 + em) - (sh * 60 + sm);

    if (duration <= 0) {
      return NextResponse.json(
        { error: "La hora de fin debe ser posterior a la hora de inicio" },
        { status: 400 }
      );
    }

    const task = await prisma.task.findUnique({ where: { id: taskId } });
    if (!task) {
      return NextResponse.json({ error: "Tarea no encontrada" }, { status: 404 });
    }

    const activity = await prisma.taskActivity.create({
      data: {
        taskId,
        authorId: session.userId,
        reason: reason as ActivityReason,
        startTime,
        endTime,
        duration,
        description: description?.trim() || null,
      },
      select: activitySelect,
    });

    await recalcRealHours(taskId);

    return NextResponse.json(activity, { status: 201 });
  } catch (err) {
    console.error("POST /activities error:", err);
    return NextResponse.json({ error: "Error interno al registrar actividad" }, { status: 500 });
  }
}
