import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import type { ActivityReason } from "@/generated/prisma/client";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const activities = await prisma.taskActivity.findMany({
    where: { taskId: id },
    include: { author: { select: { id: true, name: true } } },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json(activities);
}

export async function POST(request: NextRequest, ctx: Ctx) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { id: taskId } = await ctx.params;
  const { reason, startTime, endTime } = await request.json();

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
    },
    include: { author: { select: { id: true, name: true } } },
  });

  return NextResponse.json(activity, { status: 201 });
}
