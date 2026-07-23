import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { canUseDeskNotes } from "@/lib/roles";
import { todayRange, notifyDueReminders } from "@/lib/deskReminders";

const UPCOMING_TASK_DAYS = 7;
const RECENT_PROJECT_DAYS = 7;
const BLOCK_LIMIT = 8;

/**
 * "Bandeja Hoy" (mejora recomendada, adoptada) — resumen de 4 bloques al
 * entrar al Escritorio Digital. Los bloques de Trabajo/Proyectos son
 * consultas de solo lectura contra esos módulos (§15: no se modifican).
 * "Proyectos con actividad reciente" usa una ventana fija de
 * RECENT_PROJECT_DAYS en vez de "desde la última visita" real — el modelo
 * User no guarda un timestamp de última visita al Escritorio y agregarlo
 * quedó fuera de alcance de este sprint (ver docs/AUDIT_LOG.md).
 */
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  if (!canUseDeskNotes(session.role)) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  await notifyDueReminders(session.userId);

  const { end: todayEnd } = todayRange();
  const now = new Date();
  const upcomingTaskCutoff = new Date(now.getTime() + UPCOMING_TASK_DAYS * 86400000);
  const recentProjectCutoff = new Date(now.getTime() - RECENT_PROJECT_DAYS * 86400000);

  const [pendingNotes, todayReminders, upcomingTasks, recentProjects] = await Promise.all([
    prisma.deskNote.findMany({
      where: { recipientId: session.userId, read: false, archived: false, deletedAt: null },
      select: { id: true, message: true, priority: true, color: true, createdAt: true, sender: { select: { name: true } } },
      orderBy: [{ pinned: "desc" }, { createdAt: "desc" }],
      take: BLOCK_LIMIT,
    }),
    prisma.personalReminder.findMany({
      where: { userId: session.userId, status: "PENDIENTE", dueAt: { lte: todayEnd } },
      select: { id: true, title: true, dueAt: true, priority: true },
      orderBy: { dueAt: "asc" },
      take: BLOCK_LIMIT,
    }),
    prisma.task.findMany({
      where: {
        assignedToId: session.userId,
        archivedMonth: null,
        status: { not: "COMPLETADA" },
        endDate: { lte: upcomingTaskCutoff },
      },
      select: { id: true, title: true, endDate: true, priority: true, status: true },
      orderBy: { endDate: "asc" },
      take: BLOCK_LIMIT,
    }),
    prisma.project.findMany({
      where: {
        deletedAt: null,
        OR: [{ responsibleId: session.userId }, { participants: { some: { userId: session.userId } } }],
        AND: [
          {
            OR: [
              { activities: { some: { createdAt: { gte: recentProjectCutoff } } } },
              { comments: { some: { createdAt: { gte: recentProjectCutoff } } } },
              { history: { some: { createdAt: { gte: recentProjectCutoff } } } },
            ],
          },
        ],
      },
      select: { id: true, name: true, status: true, updatedAt: true },
      orderBy: { updatedAt: "desc" },
      take: BLOCK_LIMIT,
    }),
  ]);

  return NextResponse.json({
    pendingNotes: pendingNotes.map((n) => ({
      id: n.id,
      message: n.message,
      priority: n.priority,
      color: n.color,
      createdAt: n.createdAt.toISOString(),
      senderName: n.sender.name,
    })),
    todayReminders: todayReminders.map((r) => ({
      id: r.id,
      title: r.title,
      dueAt: r.dueAt.toISOString(),
      priority: r.priority,
      overdue: r.dueAt.getTime() < now.getTime(),
    })),
    upcomingTasks: upcomingTasks.map((t) => ({
      id: t.id,
      title: t.title,
      endDate: t.endDate.toISOString(),
      priority: t.priority,
      status: t.status,
    })),
    recentProjects: recentProjects.map((p) => ({
      id: p.id,
      name: p.name,
      status: p.status,
      updatedAt: p.updatedAt.toISOString(),
    })),
  });
}
