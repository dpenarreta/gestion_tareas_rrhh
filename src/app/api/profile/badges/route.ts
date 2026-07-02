import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";

type Badge = {
  id: string;
  icon: string;
  name: string;
  description: string;
  earned: boolean;
  earnedAt?: string | null;
};

function monthBounds(d: Date) {
  const start = new Date(d.getFullYear(), d.getMonth(), 1);
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
  return { start, end };
}

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const userId = session.userId;
  const now = new Date();
  const { start: monthStart, end: monthEnd } = monthBounds(now);

  const [user, monthTasks, totalComments, allActivities] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { badges: true, createdAt: true },
    }),
    prisma.task.findMany({
      where: { assignedToId: userId, endDate: { gte: monthStart, lte: monthEnd } },
      select: { status: true, endDate: true },
    }),
    prisma.comment.count({ where: { authorId: userId } }),
    prisma.taskActivity.findMany({
      where: { authorId: userId },
      select: { createdAt: true },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  // Cumplidor: 80%+ on time this month
  const completed = monthTasks.filter((t) => t.status === "COMPLETADA").length;
  const completedPct = monthTasks.length > 0 ? (completed / monthTasks.length) * 100 : 0;
  const isCumplidor = completedPct >= 80;

  // Confiable: 95%+ cumplimiento
  const isConfiable = completedPct >= 95;

  // Colaborador: 20+ comments total
  const isColaborador = totalComments >= 20;

  // Mentor: user has comments on tasks where other users also commented
  const userCommentTaskIds = await prisma.comment.findMany({
    where: { authorId: userId },
    select: { taskId: true },
    distinct: ["taskId"],
  });
  const taskIdsWithUserComments = userCommentTaskIds.map((c) => c.taskId);
  let isMentor = false;
  if (taskIdsWithUserComments.length > 0) {
    const otherComments = await prisma.comment.count({
      where: { taskId: { in: taskIdsWithUserComments }, authorId: { not: userId } },
    });
    isMentor = otherComments >= 5;
  }

  // Constante: activities registered for 15+ consecutive days
  let isConstante = false;
  if (allActivities.length >= 15) {
    const activityDays = [...new Set(allActivities.map((a) => a.createdAt.toISOString().slice(0, 10)))].sort();
    let maxStreak = 1; let streak = 1;
    for (let i = 1; i < activityDays.length; i++) {
      const prev = new Date(activityDays[i - 1]);
      const curr = new Date(activityDays[i]);
      const diff = (curr.getTime() - prev.getTime()) / 86400000;
      if (diff === 1) { streak++; maxStreak = Math.max(maxStreak, streak); }
      else streak = 1;
    }
    isConstante = maxStreak >= 15;
  }

  const existingBadges = user?.badges ?? [];

  const badges: Badge[] = [
    {
      id: "cumplidor",
      icon: "🎯",
      name: "Cumplidor",
      description: "Completó 80%+ de tareas a tiempo en un mes",
      earned: isCumplidor,
    },
    {
      id: "innovador",
      icon: "💡",
      name: "Innovador",
      description: "Tiene una idea implementada",
      earned: existingBadges.includes("innovador"),
    },
    {
      id: "colaborador",
      icon: "🤝",
      name: "Colaborador",
      description: "Registró 20 o más comentarios en tareas",
      earned: isColaborador,
    },
    {
      id: "confiable",
      icon: "🏅",
      name: "Confiable",
      description: "Más del 95% de cumplimiento sostenido",
      earned: isConfiable,
    },
    {
      id: "constante",
      icon: "📋",
      name: "Constante",
      description: "Registró actividades por 15 días consecutivos",
      earned: isConstante,
    },
    {
      id: "mentor",
      icon: "🌟",
      name: "Mentor",
      description: "Sus comentarios generaron respuestas en tareas",
      earned: isMentor,
    },
  ];

  // Update stored badges in DB
  const earnedIds = badges.filter((b) => b.earned).map((b) => b.id);
  const newBadges = [...new Set([...existingBadges, ...earnedIds])];
  if (newBadges.length !== existingBadges.length || newBadges.some((b) => !existingBadges.includes(b))) {
    await prisma.user.update({ where: { id: userId }, data: { badges: newBadges } });
  }

  // Stats
  const [totalCompleted, totalCommentsAll, currentStreak] = await Promise.all([
    prisma.task.count({ where: { assignedToId: userId, status: "COMPLETADA" } }),
    prisma.comment.count({ where: { authorId: userId } }),
    Promise.resolve(0), // streak calc already done above
  ]);

  const activityDaysAll = [...new Set(allActivities.map((a) => a.createdAt.toISOString().slice(0, 10)))].sort();
  let currentStreakDays = 0;
  if (activityDaysAll.length > 0) {
    const today = now.toISOString().slice(0, 10);
    const yesterday = new Date(now.getTime() - 86400000).toISOString().slice(0, 10);
    const lastDay = activityDaysAll[activityDaysAll.length - 1];
    if (lastDay === today || lastDay === yesterday) {
      currentStreakDays = 1;
      for (let i = activityDaysAll.length - 2; i >= 0; i--) {
        const curr = new Date(activityDaysAll[i + 1]);
        const prev = new Date(activityDaysAll[i]);
        if ((curr.getTime() - prev.getTime()) / 86400000 === 1) currentStreakDays++;
        else break;
      }
    }
  }

  return NextResponse.json({
    badges,
    stats: {
      totalCompleted,
      totalComments: totalCommentsAll,
      currentStreak: currentStreakDays,
      earnedCount: earnedIds.length,
    },
  });
}
