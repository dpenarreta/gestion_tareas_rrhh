import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { canViewTeam, getSubordinateRoles } from "@/lib/roles";
import type { KpiColor } from "@/components/kpis/types";

function monthBounds(year: number, month: number) {
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 0, 23, 59, 59, 999);
  return { start, end };
}

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (!canViewTeam(session.role))
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });

  const monthParam =
    request.nextUrl.searchParams.get("month") ??
    `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;
  const [yearStr, monthStr] = monthParam.split("-");
  const year = parseInt(yearStr);
  const month = parseInt(monthStr);
  const { start, end } = monthBounds(year, month);
  const now = new Date();
  const refDate = end < now ? end : now;

  const subordinateRoles = getSubordinateRoles(session.role);
  const subordinates = await prisma.user.findMany({
    where: { role: { in: subordinateRoles } },
    select: { id: true, name: true, role: true },
    orderBy: { name: "asc" },
  });

  if (subordinates.length === 0) {
    return NextResponse.json({ users: [] });
  }

  const subIds = subordinates.map((s) => s.id);

  const [allTasks, commentGroups] = await Promise.all([
    prisma.task.findMany({
      where: {
        assignedToId: { in: subIds },
        endDate: { gte: start, lte: end },
      },
      select: {
        assignedToId: true,
        status: true,
        estimatedHours: true,
        realHours: true,
        endDate: true,
        progress: true,
      },
    }),
    prisma.comment.groupBy({
      by: ["authorId"],
      where: {
        authorId: { in: subIds },
        createdAt: { gte: start, lte: end },
      },
      _count: { id: true },
    }),
  ]);

  const commentMap = Object.fromEntries(
    commentGroups.map((c) => [c.authorId, c._count.id]),
  );

  const users = subordinates.map((sub) => {
    const tasks = allTasks.filter((t) => t.assignedToId === sub.id);
    const completed = tasks.filter((t) => t.status === "COMPLETADA").length;
    const overdueCount = tasks.filter(
      (t) => t.status !== "COMPLETADA" && t.endDate < refDate,
    ).length;
    const completedPct =
      tasks.length > 0 ? Math.round((completed / tasks.length) * 100) : 0;
    const totalEst = tasks.reduce((s, t) => s + t.estimatedHours, 0);
    const totalReal = tasks.reduce((s, t) => s + t.realHours, 0);
    const cargaRatio =
      totalEst > 0
        ? Math.round((totalReal / totalEst) * 100)
        : totalReal > 0
          ? 200
          : 0;
    const inProgress = tasks.filter((t) => t.status === "EN_PROGRESO");
    const avgProgress =
      inProgress.length > 0
        ? Math.round(
            inProgress.reduce((s, t) => s + t.progress, 0) / inProgress.length,
          )
        : 0;
    const comments = commentMap[sub.id] ?? 0;

    const scoreC = (completedPct / 100) * 40;
    const scoreL = Math.max(0, 20 - Math.max(0, cargaRatio - 100) * 0.5);
    const scoreA = (avgProgress / 100) * 20;
    const scoreAct = Math.min(1, comments / 10) * 20;
    const score = Math.round(scoreC + scoreL + scoreA + scoreAct);

    const color: KpiColor =
      completedPct >= 80 ? "green" : completedPct >= 60 ? "yellow" : "red";

    return {
      id: sub.id,
      name: sub.name,
      role: sub.role,
      score,
      completedPct,
      cargaRatio,
      totalTasks: tasks.length,
      overdueCount,
      color,
    };
  });

  return NextResponse.json({ users });
}
