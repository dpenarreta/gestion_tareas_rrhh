import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const [notifications, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where: { userId: session.userId },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    prisma.notification.count({
      where: { userId: session.userId, read: false },
    }),
  ]);

  // Notification.taskId no es una relación FK (sobrevive aunque la tarea se
  // borre) — se resuelve el dueño actual de la tarea aparte para que el
  // cliente sepa a dónde navegar al hacer clic (/tasks si es propia, /team si no).
  const taskIds = Array.from(new Set(notifications.map((n) => n.taskId).filter((id): id is string => !!id)));
  const tasks = taskIds.length > 0
    ? await prisma.task.findMany({ where: { id: { in: taskIds } }, select: { id: true, assignedToId: true } })
    : [];
  const taskOwnerMap = new Map(tasks.map((t) => [t.id, t.assignedToId]));

  return NextResponse.json({
    notifications: notifications.map((n) => ({
      ...n,
      taskAssignedToId: n.taskId ? taskOwnerMap.get(n.taskId) ?? null : null,
    })),
    unreadCount,
  });
}

export async function PATCH() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  await prisma.notification.updateMany({
    where: { userId: session.userId, read: false },
    data: { read: true },
  });

  return NextResponse.json({ ok: true });
}
