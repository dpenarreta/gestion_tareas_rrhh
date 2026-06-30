import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { getVisibleRoles } from "@/lib/roles";
import type { KpiColor } from "@/components/kpis/types";

function cumplimientoColor(pct: number): KpiColor {
  if (pct >= 80) return "green";
  if (pct >= 60) return "yellow";
  return "red";
}

function cargaColor(ratio: number): KpiColor {
  if (ratio <= 100) return "green";
  if (ratio <= 120) return "yellow";
  return "red";
}

function monthBounds(year: number, month: number) {
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 0, 23, 59, 59, 999);
  return { start, end };
}

type Ctx = { params: Promise<{ userId: string }> };

export async function GET(request: NextRequest, ctx: Ctx) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { userId } = await ctx.params;

  const targetUser = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, role: true },
  });
  if (!targetUser) return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 });

  const visibleRoles = getVisibleRoles(session.role);
  if (!visibleRoles.includes(targetUser.role)) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const monthParam =
    request.nextUrl.searchParams.get("month") ??
    `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;
  const [yearStr, monthStr] = monthParam.split("-");
  const year = parseInt(yearStr);
  const month = parseInt(monthStr);
  const { start, end } = monthBounds(year, month);
  const now = new Date();
  const refDate = end < now ? end : now;

  // Tasks in period with activities
  const tasks = await prisma.task.findMany({
    where: { assignedToId: userId, endDate: { gte: start, lte: end } },
    include: {
      activities: { where: { createdAt: { gte: start, lte: end } } },
    },
  });

  const totalComments = await prisma.comment.count({
    where: { authorId: userId, createdAt: { gte: start, lte: end } },
  });

  // ── Cumplimiento ──────────────────────────────────────────────────────────
  const completed = tasks.filter((t) => t.status === "COMPLETADA");
  const overdueTasks = tasks.filter(
    (t) => t.status !== "COMPLETADA" && t.endDate < refDate,
  );
  const completedPct =
    tasks.length > 0 ? Math.round((completed.length / tasks.length) * 100) : 0;
  const overduePct =
    tasks.length > 0 ? Math.round((overdueTasks.length / tasks.length) * 100) : 0;
  const avgDelayDays =
    overdueTasks.length > 0
      ? Math.round(
          overdueTasks.reduce((sum, t) => {
            return (
              sum +
              Math.max(
                0,
                Math.floor((refDate.getTime() - t.endDate.getTime()) / 86400000),
              )
            );
          }, 0) / overdueTasks.length,
        )
      : 0;

  // ── Carga laboral ─────────────────────────────────────────────────────────
  const totalEstimated = tasks.reduce((s, t) => s + t.estimatedHours, 0);
  const totalReal = tasks.reduce((s, t) => s + t.realHours, 0);
  const cargaRatio =
    totalEstimated > 0
      ? Math.round((totalReal / totalEstimated) * 100)
      : totalReal > 0
        ? 200
        : 0;

  // ── Seguimiento ───────────────────────────────────────────────────────────
  const seguimientoTasks = tasks.filter((t) => t.type === "SEGUIMIENTO");
  const allActivities = seguimientoTasks.flatMap((t) => t.activities);
  const byReasonMap: Record<string, { count: number; totalMinutes: number }> = {};
  for (const act of allActivities) {
    if (!byReasonMap[act.reason]) byReasonMap[act.reason] = { count: 0, totalMinutes: 0 };
    byReasonMap[act.reason].count++;
    byReasonMap[act.reason].totalMinutes += act.duration;
  }
  const byReason = Object.entries(byReasonMap).map(([reason, data]) => ({
    reason,
    count: data.count,
    totalMinutes: data.totalMinutes,
    avgMinutes: Math.round(data.totalMinutes / data.count),
  }));

  // ── Calidad ───────────────────────────────────────────────────────────────
  const inProgress = tasks.filter((t) => t.status === "EN_PROGRESO");
  const avgProgress =
    inProgress.length > 0
      ? Math.round(
          inProgress.reduce((s, t) => s + t.progress, 0) / inProgress.length,
        )
      : 0;
  const recurringFreqs = ["MENSUAL", "SEMANAL", "DIARIA", "QUINCENAL"];
  const recurringTasks = tasks.filter((t) => recurringFreqs.includes(t.frequency));
  const recurringCompleted = recurringTasks.filter((t) => t.status === "COMPLETADA");
  const recurringPct =
    recurringTasks.length > 0
      ? Math.round((recurringCompleted.length / recurringTasks.length) * 100)
      : 0;

  // ── Actividad ─────────────────────────────────────────────────────────────
  const assignedByOthers = tasks.filter((t) => t.createdById !== userId).length;
  const ownTasks = tasks.filter((t) => t.createdById === userId).length;

  // ── Score /100 ────────────────────────────────────────────────────────────
  const scoreC = (completedPct / 100) * 40;
  const scoreL = Math.max(0, 20 - Math.max(0, cargaRatio - 100) * 0.5);
  const scoreA = (avgProgress / 100) * 20;
  const scoreAct = Math.min(1, totalComments / 10) * 20;
  const score = Math.round(scoreC + scoreL + scoreA + scoreAct);

  // ── Hours by week ─────────────────────────────────────────────────────────
  const weekMap: Record<number, { estimated: number; real: number }> = {};
  for (const task of tasks) {
    const w = Math.ceil(task.endDate.getDate() / 7);
    if (!weekMap[w]) weekMap[w] = { estimated: 0, real: 0 };
    weekMap[w].estimated += task.estimatedHours;
    weekMap[w].real += task.realHours;
  }
  const horasByWeek = Object.entries(weekMap)
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([w, d]) => ({
      week: `Sem ${w}`,
      estimated: Math.round(d.estimated * 10) / 10,
      real: Math.round(d.real * 10) / 10,
    }));

  // ── 6-month history ───────────────────────────────────────────────────────
  const historyStart = new Date(year, month - 7, 1);
  const historyTasks = await prisma.task.findMany({
    where: {
      assignedToId: userId,
      endDate: { gte: historyStart, lte: end },
    },
    select: { endDate: true, status: true },
  });

  const cumplimientoHistory = Array.from({ length: 6 }, (_, i) => {
    let m = month - 5 + i;
    let y = year;
    while (m <= 0) { m += 12; y--; }
    while (m > 12) { m -= 12; y++; }
    const { start: hs, end: he } = monthBounds(y, m);
    const mt = historyTasks.filter((t) => t.endDate >= hs && t.endDate <= he);
    const mc = mt.filter((t) => t.status === "COMPLETADA").length;
    const pct = mt.length > 0 ? Math.round((mc / mt.length) * 100) : 0;
    const label = new Date(y, m - 1, 1).toLocaleDateString("es-CL", {
      month: "short",
      year: "2-digit",
    });
    return { month: `${y}-${String(m).padStart(2, "0")}`, label, completedPct: pct };
  });

  // ── Previous month ────────────────────────────────────────────────────────
  let pm = month - 1;
  let py = year;
  if (pm <= 0) { pm = 12; py--; }
  const { start: ps, end: pe } = monthBounds(py, pm);
  const [prevTasks, prevActivities] = await Promise.all([
    prisma.task.findMany({
      where: { assignedToId: userId, endDate: { gte: ps, lte: pe } },
      select: { status: true, estimatedHours: true, realHours: true },
    }),
    prisma.taskActivity.count({
      where: { authorId: userId, createdAt: { gte: ps, lte: pe } },
    }),
  ]);
  const prevCompleted = prevTasks.filter((t) => t.status === "COMPLETADA").length;
  const prevPct =
    prevTasks.length > 0 ? Math.round((prevCompleted / prevTasks.length) * 100) : 0;
  const prevEst = prevTasks.reduce((s, t) => s + t.estimatedHours, 0);
  const prevReal = prevTasks.reduce((s, t) => s + t.realHours, 0);
  const prevCarga = prevEst > 0 ? Math.round((prevReal / prevEst) * 100) : 0;

  return NextResponse.json({
    user: { id: targetUser.id, name: targetUser.name, role: targetUser.role },
    period: { month: monthParam },
    cumplimiento: {
      total: tasks.length,
      completed: completed.length,
      overdue: overdueTasks.length,
      completedPct,
      overduePct,
      avgDelayDays,
      color: cumplimientoColor(completedPct),
    },
    cargaLaboral: {
      estimatedHours: Math.round(totalEstimated * 100) / 100,
      realHours: Math.round(totalReal * 100) / 100,
      ratio: cargaRatio,
      color: cargaColor(cargaRatio),
    },
    seguimiento: { total: allActivities.length, byReason },
    calidad: {
      avgProgress,
      recurringCompleted: recurringCompleted.length,
      recurringTotal: recurringTasks.length,
      recurringPct,
    },
    actividad: { totalComments, assignedByOthers, ownTasks },
    score,
    horasByWeek,
    cumplimientoHistory,
    tasks: tasks.map((t) => {
      const isOverdue = t.status !== "COMPLETADA" && t.endDate < refDate;
      const delayDays = isOverdue
        ? Math.max(
            0,
            Math.floor((refDate.getTime() - t.endDate.getTime()) / 86400000),
          )
        : 0;
      const color: KpiColor =
        t.status === "COMPLETADA" ? "green" : isOverdue ? "red" : "yellow";
      return {
        id: t.id,
        title: t.title,
        type: t.type,
        status: t.status,
        endDate: t.endDate.toISOString(),
        delayDays,
        color,
      };
    }),
    prevMonth: {
      completedPct: prevPct,
      cargaRatio: prevCarga,
      totalTasks: prevTasks.length,
      seguimientoTotal: prevActivities,
    },
  });
}
