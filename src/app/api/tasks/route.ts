import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { attachUnreadComments } from "@/lib/commentViews";
import { invalidateAnalyticsCache } from "@/lib/analytics";
import type { TaskStatus, TaskPriority, TaskFrequency, TaskType } from "@/generated/prisma/client";

export const taskSelect = {
  id: true,
  title: true,
  description: true,
  type: true,
  status: true,
  priority: true,
  frequency: true,
  startDate: true,
  endDate: true,
  estimatedHours: true,
  realHours: true,
  targetTimeValidated: true,
  progress: true,
  color: true,
  corrected: true,
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
    where: { assignedToId: session.userId, archivedMonth: null },
    select: taskSelect,
    orderBy: { createdAt: "desc" },
  });

  const tasksWithUnread = await attachUnreadComments(tasks, session.userId);
  return NextResponse.json(tasksWithUnread);
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const body = await request.json();
  const { title, description, type, status, priority, frequency, startDate, endDate, estimatedHours, assignedToId } = body;

  if (!title || !priority || !frequency || !startDate || !endDate || estimatedHours == null || !assignedToId) {
    return NextResponse.json({ error: "Faltan campos requeridos" }, { status: 400 });
  }

  const initialStatus = (status as TaskStatus) ?? "PENDIENTE";

  const task = await prisma.task.create({
    data: {
      title,
      description: description || null,
      type: (type as TaskType) ?? "FIJA",
      status: initialStatus,
      priority: priority as TaskPriority,
      frequency: frequency as TaskFrequency,
      startDate: new Date(startDate),
      endDate: new Date(endDate),
      estimatedHours: parseFloat(estimatedHours),
      progress: initialStatus === "COMPLETADA" ? 100 : 0,
      // Prevención (docs/AUDIT_LOG.md § 2026-07-24, backfill histórico de
      // completedAt): crear una tarea directamente en estado Completada
      // dejaba completedAt en null — el mismo problema que motivó el
      // backfill, pero reproduciéndose hacia adelante en vez de ser solo
      // histórico. PATCH /api/tasks/[id] ya lo hacía bien al editar.
      completedAt: initialStatus === "COMPLETADA" ? new Date() : null,
      assignedToId,
      createdById: session.userId,
    },
    select: taskSelect,
  });

  invalidateAnalyticsCache(assignedToId);

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

  const [taskWithUnread] = await attachUnreadComments([task], session.userId);
  return NextResponse.json(taskWithUnread, { status: 201 });
}
