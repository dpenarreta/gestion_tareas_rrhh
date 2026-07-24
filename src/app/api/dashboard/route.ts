import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { getVisibleRoles, ROLE_LEVEL, isExecutorRole } from "@/lib/roles";
import { getVisibleIdeaAuthorIds } from "@/lib/ideas";
import { isTaskOverdue } from "@/lib/utils";
import { dayBounds, weekBounds, monthBounds } from "@/lib/dateRanges";
import { getActivityReasonLabelMap } from "@/lib/activityReasons";
import { getEffectiveWelcomeMessage, getEffectiveWelcomeMessageActive } from "@/lib/systemConfig";
import { computeCargaTiempo, monthlyBusinessBaseForUsers, computeWorkloadRange } from "@/lib/workload";
import { computeMonthlyHistory } from "@/lib/analytics";
import { businessDayRealRange } from "@/lib/businessTime";

function taskStatsForRange(tasks: { status: string; endDate: Date }[], start: Date, end: Date) {
  const inRange = tasks.filter((t) => t.endDate >= start && t.endDate <= end);
  return {
    pending: inRange.filter((t) => t.status === "PENDIENTE").length,
    inProgress: inRange.filter((t) => t.status === "EN_PROGRESO").length,
    completed: inRange.filter((t) => t.status === "COMPLETADA").length,
  };
}

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

  const visibleRoles = getVisibleRoles(session.role);

  // Sprint D (Bloque 2): las consultas de abajo son independientes entre sí
  // (ninguna depende del resultado de otra) — antes se esperaban una por una
  // en serie, agregando ~9 idas y vueltas secuenciales a Postgres en cada
  // carga del Dashboard. Agrupadas en un solo Promise.all.
  const [
    user,
    allMyTasks,
    cargaTiempo,
    monthlyHistory,
    visibleUsers,
    announcements,
    upcomingMeetings,
    welcomeMessage,
    welcomeMessageActive,
    myProjects,
    ideaVisibleIdsRaw,
  ] = await Promise.all([
    prisma.user.findUnique({
      where: { id: session.userId },
      select: { lastLoginAt: true, badges: true },
    }),
    prisma.task.findMany({
      where: { assignedToId: session.userId, archivedMonth: null },
      select: { id: true, title: true, status: true, endDate: true, estimatedHours: true, realHours: true },
      orderBy: { endDate: "asc" },
    }),
    computeCargaTiempo(session.userId, now),
    computeMonthlyHistory(session.userId, 1, now),
    prisma.user.findMany({
      where: { role: { in: visibleRoles }, id: { not: session.userId } },
      select: { id: true, name: true, role: true },
    }),
    prisma.announcement.findMany({
      where: { expiresAt: { gt: now } },
      include: { author: { select: { name: true, role: true } } },
      orderBy: [{ pinned: "desc" }, { createdAt: "desc" }],
    }),
    prisma.meeting.findMany({
      where: {
        meetingDate: { gte: now },
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
    }),
    getEffectiveWelcomeMessage(),
    getEffectiveWelcomeMessageActive(),
    // Sprint C §11: "Proyectos" no aparecía en el Dashboard en absoluto —
    // misma regla de "mis proyectos" (responsable/creador/participante) que
    // ya usa GET /api/projects para roles no-liderazgo, aplicada aquí
    // siempre (un widget personal debe mostrar los proyectos propios de
    // cualquier rol, no "todos los proyectos visibles" — eso ya existe en
    // /projects). Sin cambios al modelo de datos ni a las reglas de acceso
    // existentes.
    prisma.project.findMany({
      where: {
        deletedAt: null,
        status: { notIn: ["COMPLETADO", "CANCELADO"] },
        OR: [
          { responsibleId: session.userId },
          { createdById: session.userId },
          { participants: { some: { userId: session.userId } } },
        ],
      },
      select: { id: true, name: true, status: true, priority: true, targetDate: true },
      orderBy: { targetDate: "asc" },
      take: 5,
    }),
    getVisibleIdeaAuthorIds(session),
  ]);

  // Priority tasks: top 5 by urgency
  const now_ = new Date();
  const priorityTasks = [...allMyTasks]
    .filter((t) => t.status !== "COMPLETADA")
    .map((t) => {
      let urgency = 0;
      if (isTaskOverdue(t.endDate, t.status, now_)) urgency = 4;
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

  // Carga laboral y cumplimiento del mes — reutilizan el motor central en vez
  // de recalcularse aquí (ver Analytics Calculation Registry § D6): antes
  // "workloadPct" medía horas estimadas vs. reales de las tareas (un concepto
  // distinto, sin relación con la base laboral) aunque el frontend lo trata
  // como el semáforo de carga laboral real (workloadLabel en DashboardModule.tsx).
  const workloadPct = cargaTiempo.mensual.pct;
  const completedPct = monthlyHistory[monthlyHistory.length - 1].completedPct;

  // Overdue
  const overdue = allMyTasks.filter((t) => isTaskOverdue(t.endDate, t.status, now_)).length;

  // Area activity since lastLoginAt
  const since = user?.lastLoginAt ?? new Date(now_.getTime() - 7 * 24 * 60 * 60 * 1000);
  const visibleIds = visibleUsers.map((u) => u.id);
  const nameMap = Object.fromEntries(visibleUsers.map((u) => [u.id, u.name]));
  // Roles de liderazgo excluidos de "quién requiere atención" — su carga
  // laboral individual no es representativa (ver Sprint 0A).
  const executorIds = visibleUsers.filter((u) => isExecutorRole(u.role)).map((u) => u.id);

  type ActivityEvent = { time: Date; text: string };
  const activityEvents: ActivityEvent[] = [];

  if (visibleIds.length > 0) {
    const activityReasonLabelMap = await getActivityReasonLabelMap();
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
      const label = (activityReasonLabelMap[a.reason] ?? a.reason).toLowerCase();
      activityEvents.push({ time: a.createdAt, text: `${nameMap[a.authorId]} registró actividad de ${label}` });
    }
    for (const t of recentCompletions) {
      activityEvents.push({ time: t.updatedAt, text: `${nameMap[t.assignedToId]} completó "${t.title}"` });
    }
    for (const t of recentAssignments) {
      activityEvents.push({ time: t.createdAt, text: `${nameMap[t.assignedToId]} fue asignado a "${t.title}"` });
    }
  }

  const ideaVisibleIds = ideaVisibleIdsRaw.filter((id) => id !== session.userId);

  if (ideaVisibleIds.length > 0) {
    const [recentIdeas, recentImplemented] = await Promise.all([
      prisma.improvementIdea.findMany({
        where: { authorId: { in: ideaVisibleIds }, createdAt: { gte: since } },
        select: { authorId: true, title: true, createdAt: true },
        orderBy: { createdAt: "desc" },
        take: 10,
      }),
      prisma.improvementIdea.findMany({
        where: { authorId: { in: ideaVisibleIds }, status: "IMPLEMENTADA", updatedAt: { gte: since } },
        select: { authorId: true, title: true, updatedAt: true },
        orderBy: { updatedAt: "desc" },
        take: 10,
      }),
    ]);

    for (const i of recentIdeas) {
      activityEvents.push({ time: i.createdAt, text: `${nameMap[i.authorId]} propuso la idea "${i.title}"` });
    }
    for (const i of recentImplemented) {
      activityEvents.push({ time: i.updatedAt, text: `${nameMap[i.authorId]} implementó la idea "${i.title}"` });
    }
  }

  const areaActivity = activityEvents
    .sort((a, b) => b.time.getTime() - a.time.getTime())
    .slice(0, 5)
    .map((e) => ({ text: e.text, time: e.time.toISOString() }));

  // Team alerts (for levels 2-4) — quién está en Carga elevada/Sobrecarga este
  // mes, según el mismo semáforo de 5 zonas usado en todo el resto de la app
  // (computeWorkloadRange), en vez del ratio estimado/real de tareas (ver
  // Analytics Calculation Registry § D6). Mismo patrón que
  // /api/kpis/executive: base laboral por usuario en bloque (sin N+1) +
  // horas reales desde tareas FIJA completadas y actividades del mes.
  let teamAlerts = 0;
  if (ROLE_LEVEL[session.role] >= 2 && executorIds.length > 0) {
    const { shared, perUser } = await monthlyBusinessBaseForUsers(executorIds, now.getFullYear(), now.getMonth() + 1);
    const { start: realStart } = businessDayRealRange(shared.start);
    const { end: realEnd } = businessDayRealRange(shared.end);
    const [fijaTasksForCarga, activitiesForCarga] = await Promise.all([
      prisma.task.findMany({
        where: { assignedToId: { in: executorIds }, type: "FIJA", archivedMonth: null, completedAt: { gte: realStart, lte: realEnd } },
        select: { assignedToId: true, realHours: true },
      }),
      prisma.taskActivity.findMany({
        where: { authorId: { in: executorIds }, createdAt: { gte: realStart, lte: realEnd } },
        select: { authorId: true, duration: true },
      }),
    ]);
    for (const id of executorIds) {
      const fijaHours = fijaTasksForCarga.filter((t) => t.assignedToId === id).reduce((s, t) => s + t.realHours, 0);
      const activityHours = activitiesForCarga.filter((a) => a.authorId === id).reduce((s, a) => s + a.duration, 0) / 60;
      const cargaRealHours = Math.round((fijaHours + activityHours) * 100) / 100;
      const userBiz = perUser.get(id) ?? shared;
      const range = computeWorkloadRange(cargaRealHours, userBiz.limitBaseHours, userBiz.limitLowHours, userBiz.limitHighHours, userBiz.limitOverloadHours);
      if (range.label === "Carga elevada" || range.label === "Sobrecarga") teamAlerts++;
    }
  }

  return NextResponse.json({
    workloadPct,
    completedPct,
    overdue,
    priorityTasks,
    stats: { today: statsToday, week: statsWeek, month: statsMonth },
    areaActivity,
    teamAlerts,
    welcomeMessage,
    welcomeMessageActive,
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
    myProjects: myProjects.map((p) => ({
      id: p.id,
      name: p.name,
      status: p.status,
      priority: p.priority,
      targetDate: p.targetDate.toISOString(),
    })),
  });
  } catch (err) {
    console.error("[GET /api/dashboard]", err);
    return NextResponse.json({ error: "Error al cargar el dashboard" }, { status: 500 });
  }
}
