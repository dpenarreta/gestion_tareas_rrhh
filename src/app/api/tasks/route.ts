import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import type { TaskStatus, TaskPriority, TaskFrequency } from "@/generated/prisma/client";

const taskSelect = {
  id: true,
  title: true,
  description: true,
  status: true,
  priority: true,
  frequency: true,
  startDate: true,
  endDate: true,
  estimatedHours: true,
  realHours: true,
  progress: true,
  assignedTo: { select: { id: true, name: true, email: true, role: true } },
  createdBy: { select: { id: true, name: true } },
  _count: { select: { comments: true } },
  createdAt: true,
  updatedAt: true,
} as const;

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const tasks = await prisma.task.findMany({
    where: { assignedToId: session.userId },
    select: taskSelect,
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(tasks);
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const body = await request.json();
  const { title, description, status, priority, frequency, startDate, endDate, estimatedHours, progress, assignedToId } = body;

  if (!title || !priority || !frequency || !startDate || !endDate || estimatedHours == null || !assignedToId) {
    return NextResponse.json({ error: "Faltan campos requeridos" }, { status: 400 });
  }

  const task = await prisma.task.create({
    data: {
      title,
      description: description || null,
      status: (status as TaskStatus) ?? "PENDIENTE",
      priority: priority as TaskPriority,
      frequency: frequency as TaskFrequency,
      startDate: new Date(startDate),
      endDate: new Date(endDate),
      estimatedHours: parseFloat(estimatedHours),
      progress: progress ?? 0,
      assignedToId,
      createdById: session.userId,
    },
    select: taskSelect,
  });

  if (assignedToId !== session.userId) {
    await prisma.notification.create({
      data: {
        userId: assignedToId,
        message: `${session.name} te asignó la tarea "${title}"`,
        taskId: task.id,
        taskTitle: title,
      },
    });
  }

  return NextResponse.json(task, { status: 201 });
}
