import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { canAccessTask } from "@/lib/taskAccess";
import { canManageUsers } from "@/lib/roles";
import { attachUnreadComments } from "@/lib/commentViews";
import { invalidateAnalyticsCache } from "@/lib/analytics";
import type { TaskStatus, TaskPriority, TaskFrequency, TaskType } from "@/generated/prisma/client";

type Ctx = { params: Promise<{ id: string }> };

const taskSelect = {
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

export async function PATCH(request: NextRequest, ctx: Ctx) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const task = await prisma.task.findUnique({
    where: { id },
    include: { assignedTo: { select: { role: true } } },
  });
  if (!task) {
    return NextResponse.json({ error: "Tarea no encontrada" }, { status: 404 });
  }

  if (!canAccessTask(session, task)) {
    return NextResponse.json({ error: "Sin permisos para editar esta tarea" }, { status: 403 });
  }

  if (task.archivedMonth) {
    return NextResponse.json({ error: "Tarea archivada, de solo lectura" }, { status: 403 });
  }

  const body = await request.json();

  if ("realHours" in body && task.assignedToId !== session.userId) {
    return NextResponse.json(
      { error: "Solo el responsable puede actualizar horas reales" },
      { status: 403 }
    );
  }

  if ("color" in body && task.assignedToId !== session.userId) {
    return NextResponse.json(
      { error: "Solo el responsable puede cambiar el color" },
      { status: 403 }
    );
  }

  if ("status" in body && task.assignedToId !== session.userId) {
    return NextResponse.json(
      { error: "Solo el responsable puede cambiar el estado" },
      { status: 403 }
    );
  }

  const data: Record<string, unknown> = {};
  if ("title" in body) data.title = body.title;
  if ("description" in body) data.description = body.description;
  if ("type" in body) data.type = body.type as TaskType;
  if ("status" in body) data.status = body.status as TaskStatus;
  if ("priority" in body) data.priority = body.priority as TaskPriority;
  if ("frequency" in body) data.frequency = body.frequency as TaskFrequency;
  if ("startDate" in body) data.startDate = new Date(body.startDate);
  if ("endDate" in body) data.endDate = new Date(body.endDate);
  if ("estimatedHours" in body) data.estimatedHours = Math.round(parseFloat(body.estimatedHours) * 100) / 100;
  if ("realHours" in body) data.realHours = Math.round(parseFloat(body.realHours) * 100) / 100;
  if ("status" in body) {
    if (body.status === "COMPLETADA") {
      data.progress = 100;
      data.completedAt = new Date();
    } else {
      if (body.status === "PENDIENTE") data.progress = 0;
      data.completedAt = null;
    }
  }
  if ("assignedToId" in body) data.assignedToId = body.assignedToId;
  if ("color" in body) data.color = body.color;

  const updated = await prisma.task.update({ where: { id }, data, select: taskSelect });
  // El responsable puede cambiar en este PATCH (reasignación) — invalidar
  // tanto al anterior como al nuevo si difieren, nunca solo uno.
  const affectedUserIds = new Set([task.assignedToId]);
  if (typeof data.assignedToId === "string") affectedUserIds.add(data.assignedToId);
  invalidateAnalyticsCache([...affectedUserIds]);
  const [updatedWithUnread] = await attachUnreadComments([updated], session.userId);
  return NextResponse.json(updatedWithUnread);
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const task = await prisma.task.findUnique({ where: { id } });
  if (!task) {
    return NextResponse.json({ error: "Tarea no encontrada" }, { status: 404 });
  }

  if (task.archivedMonth) {
    return NextResponse.json({ error: "Tarea archivada, de solo lectura" }, { status: 403 });
  }

  if (task.createdById !== session.userId && !canManageUsers(session.role)) {
    return NextResponse.json({ error: "Sin permisos para eliminar" }, { status: 403 });
  }

  await prisma.task.delete({ where: { id } });
  invalidateAnalyticsCache(task.assignedToId);
  return NextResponse.json({ ok: true });
}
