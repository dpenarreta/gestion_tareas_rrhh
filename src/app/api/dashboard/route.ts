import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { getVisibleRoles, ROLE_LEVEL } from "@/lib/roles";

function dayBounds(d: Date) {
  const start = new Date(d); start.setHours(0, 0, 0, 0);
  const end = new Date(d); end.setHours(23, 59, 59, 999);
  return { start, end };
}

function weekBounds(d: Date) {
  const start = new Date(d);
  start.setDate(d.getDate() - d.getDay() + (d.getDay() === 0 ? -6 : 1));
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

function monthBounds(d: Date) {
  const start = new Date(d.getFullYear(), d.getMonth(), 1);
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
  return { start, end };
}

function taskStatsForRange(tasks: { status: string; endDate: Date }[], start: Date, end: Date) {
  const inRange = tasks.filter((t) => t.endDate >= start && t.endDate <= end);
  return {
    pending: inRange.filter((t) => t.status === "PENDIENTE").length,
    inProgress: inRange.filter((t) => t.status === "EN_PROGRESO").length,
    completed: inRange.filter((t) => t.status === "COMPLETADA").length,
  };
}

const ACTIVITY_REASON_LABEL: Record<string, string> = {
  NOVEDADES_PAGO: "novedades de pago",
  RETENCION_PAGO: "retención de pago",
  FACTURAS: "facturas",
  CONSULTA_OPERACIONES: "consulta de operaciones",
  SOLICITUD_VACACIONES: "solicitud de vacaciones",
  SOLICITUD_PERMISO: "solicitud de permiso",
  VISITA_DOMICILIARIA: "visita domiciliaria",
  SEGUIMIENTO_AUSENTISMOS: "seguimiento de ausentismos",
  RECLUTAMIENTO_SELECCION: "reclutamiento y selección",
};

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  try {

  const now = new Date();
  const { start: monthStart, end: monthEnd } = monthBounds(now);
  const { start: todayStart, end: todayEnd } = dayBounds(now);
  const { start: weekStart, end: weekEnd } = weekBounds(now);

  const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1);
  const dayAfterTomorrow = new Date(tomorrow); dayAfterTomorrow.setDate(tomorrow.getDate() + 1);
  const nextSunday = weekEnd;

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { lastLoginAt: true, badges: true },
  });

  const allMyTasks = await prisma.task.findMany({
    where: { assignedToId: session.userId, archivedMonth: null },
    select: { id: true, title: true, status: true, endDate: true, estimatedHours: true, realHours: true },
    orderBy: { endDate: "asc" },
  });

  // Priority tasks: top 5 by urgency
  const now_ = new Date();
  const priorityTasks = [...allMyTasks]
    .filter((t) => t.status !== "COMPLETADA")
    .map((t) => {
      let urgency = 0;
      if (t.endDate < now_) urgency = 4;
      else if (t.endDate <= todayEnd) urgency = 3;
      else if (t.endDate <= dayAfterTomorrow) urgency = 2;
      else if (t.endDate <= nextSunday) urgency = 1;
      return { ...t, urgency };
    })
    .filter((t) => t.urgency > 0)
    .sort((a, b) => b.urgency - a.urgency)
    .slice(0, 5)
    .map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      endDate: t.endDate.toISOString(),
      urgency: t.urgency,
    }));

  // Stats per period
  const allWithDates = allMyTasks.map((t) => ({ ...t, endDate: new Date(t.endDate) }));
  const statsToday = taskStatsForRange(allWithDates, todayStart, todayEnd);
  const statsWeek = taskStatsForRange(allWithDates, weekStart, weekEnd);
  const statsMonth = taskStatsForRange(allWithDates, monthStart, monthEnd);

  // Workload % (month)
  const monthTasks = allWithDates.filter((t) => t.endDate >= monthStart && t.endDate <= monthEnd);
  const totalEstimated = monthTasks.reduce((s, t) => s + t.estimatedHours, 0);
  const totalReal = monthTasks.reduce((s, t) => s + t.realHours, 0);
  const workloadPct = totalEstimated > 0 ? Math.round((totalReal / totalEstimated) * 100) : 0;

  // Cumplimiento del mes
  const completed = monthTasks.filter((t) => t.status === "COMPLETADA").length;
  const completedPct = monthTasks.length > 0 ? Math.round((completed / monthTasks.length) * 100) : 0;

  // Overdue
  const overdue = allMyTasks.filter((t) => t.status !== "COMPLETADA" && new Date(t.endDate) < now_).length;

  // Area activity since lastLoginAt
  const since = user?.lastLoginAt ?? new Date(now_.getTime() - 7 * 24 * 60 * 60 * 1000);
  const visibleRoles = getVisibleRoles(session.role);
  const visibleUsers = await prisma.user.findMany({
    where: { role: { in: visibleRoles }, id: { not: session.userId } },
    select: { id: true, name: true },
  });
  const visibleIds = visibleUsers.map((u) => u.id);
  const nameMap = Object.fromEntries(visibleUsers.map((u) => [u.id, u.name]));

  type ActivityEvent = { time: Date; text: string };
  const activityEvents: ActivityEvent[] = [];

  if (visibleIds.length > 0) {
    const [recentComments, recentActivities, recentCompletions, recentAssignments] = await Promise.all([
      prisma.comment.findMany({
        where: { authorId: { in: visibleIds }, createdAt: { gte: since } },
        select: { authorId: true, task: { select: { title: true } }, createdAt: true },
        orderBy: { createdAt: "desc" },
        take: 20,
      }),
      prisma.taskActivity.findMany({
        where: { authorId: { in: visibleIds }, createdAt: { gte: since } },
        select: { authorId: true, reason: true, createdAt: true },
        orderBy: { createdAt: "desc" },
        take: 20,
      }),
      prisma.task.findMany({
        where: { assignedToId: { in: visibleIds }, status: "COMPLETADA", updatedAt: { gte: since } },
        select: { assignedToId: true, title: true, updatedAt: true },
        orderBy: { updatedAt: "desc" },
        take: 10,
      }),
      prisma.task.findMany({
        where: { assignedToId: { in: visibleIds }, createdAt: { gte: since } },
        select: { assignedToId: true, title: true, createdAt: true },
        orderBy: { createdAt: "desc" },
        take: 10,
      }),
    ]);

    for (const c of recentComments) {
      activityEvents.push({ time: c.createdAt, text: `${nameMap[c.authorId]} comentó en "${c.task.title}"` });
    }
    for (const a of recentActivities) {
      const label = ACTIVITY_REASON_LABEL[a.reason] ?? a.reason.toLowerCase();
      activityEvents.push({ time: a.createdAt, text: `${nameMap[a.authorId]} registró actividad de ${label}` });
    }
    for (const t of recentCompletions) {
      activityEvents.push({ time: t.updatedAt, text: `${nameMap[t.assignedToId]} completó "${t.title}"` });
    }
    for (const t of recentAssignments) {
      activityEvents.push({ time: t.createdAt, text: `${nameMap[t.assignedToId]} fue asignado a "${t.title}"` });
    }
  }

  const areaActivity = activityEvents
    .sort((a, b) => b.time.getTime() - a.time.getTime())
    .slice(0, 5)
    .map((e) => ({ text: e.text, time: e.time.toISOString() }));

  // Team alerts (for levels 2-4)
  let teamAlerts = 0;
  if (ROLE_LEVEL[session.role] >= 2 && visibleIds.length > 0) {
    const teamTasks = await prisma.task.findMany({
      where: { assignedToId: { in: visibleIds }, endDate: { gte: monthStart, lte: monthEnd } },
      select: { assignedToId: true, estimatedHours: true, realHours: true },
    });
    const byUser = new Map<string, { est: number; real: number }>();
    for (const t of teamTasks) {
      const cur = byUser.get(t.assignedToId) ?? { est: 0, real: 0 };
      byUser.set(t.assignedToId, { est: cur.est + t.estimatedHours, real: cur.real + t.realHours });
    }
    for (const { est, real } of byUser.values()) {
      if (est > 0 && real / est > 1) teamAlerts++;
    }
  }

  // Active announcements
  const announcements = await prisma.announcement.findMany({
    where: { expiresAt: { gt: now_ } },
    include: { author: { select: { name: true, role: true } } },
    orderBy: [{ pinned: "desc" }, { createdAt: "desc" }],
  });

  // Upcoming meetings (next 5)
  const upcomingMeetings = await prisma.meeting.findMany({
    where: {
      meetingDate: { gte: now_ },
      OR: [
        { hostId: session.userId },
        { invitees: { some: { userId: session.userId } } },
      ],
    },
    orderBy: { meetingDate: "asc" },
    take: 5,
    select: {
      id: true,
      title: true,
      meetingDate: true,
      duration: true,
      status: true,
      host: { select: { name: true } },
    },
  });

  return NextResponse.json({
    workloadPct,
    completedPct,
    overdue,
    priorityTasks,
    stats: { today: statsToday, week: statsWeek, month: statsMonth },
    areaActivity,
    teamAlerts,
    announcements: announcements.map((a) => ({
      id: a.id,
      title: a.title,
      content: a.content,
      pinned: a.pinned,
      expiresAt: a.expiresAt.toISOString(),
      createdAt: a.createdAt.toISOString(),
      authorName: a.author.name,
    })),
    lastLoginAt: user?.lastLoginAt?.toISOString() ?? null,
    badges: user?.badges ?? [],
    upcomingMeetings: upcomingMeetings.map((m: { id: string; title: string; meetingDate: Date; duration: number; status: string; host: { name: string } }) => ({
      id: m.id,
      title: m.title,
      meetingDate: m.meetingDate.toISOString(),
      duration: m.duration,
      status: m.status,
      hostName: m.host.name,
    })),
  });
  } catch (err) {
    console.error("[GET /api/dashboard]", err);
    return NextResponse.json({ error: "Error al cargar el dashboard" }, { status: 500 });
  }
}
