import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { canViewTeam, getSubordinateRoles, isExecutorRole } from "@/lib/roles";
import { isTaskOverdue } from "@/lib/utils";
import { monthlyBusinessBaseForUsers, computeWorkloadRange, computeWorkloadPct, type MonthlyBusinessBase } from "@/lib/workload";
import { businessDayRealRange } from "@/lib/businessTime";
import { computeSimpleScore, computeEstimatedVsRealRatio, computeCompletedPctAny } from "@/lib/analytics";
import { cumplimientoColor } from "@/lib/analyticsExplain";

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

  // Roles de liderazgo (Jefe Nacional/Administrador) excluidos como sujetos de
  // KPIs individuales de equipo — su responsabilidad es dirigir, no ejecutar
  // tareas (ver Sprint 0A). No afecta getVisibleRoles/permisos de tareas.
  const subordinateRoles = getSubordinateRoles(session.role).filter(isExecutorRole);
  const subordinates = await prisma.user.findMany({
    where: { role: { in: subordinateRoles } },
    select: { id: true, name: true, role: true },
    orderBy: { name: "asc" },
  });

  if (subordinates.length === 0) {
    return NextResponse.json({ users: [] });
  }

  const subIds = subordinates.map((s) => s.id);

  // Base laboral (y sus 4 límites) del mes, por usuario — misma fuente que el
  // dashboard ejecutivo (respeta estado especial vigente por persona).
  const { shared: sharedBiz, perUser: perUserBiz } = await monthlyBusinessBaseForUsers(subIds, year, month);
  const { start: realStart } = businessDayRealRange(sharedBiz.start);
  const { end: realEndOfMonth } = businessDayRealRange(sharedBiz.end);

  const [allTasks, commentGroups, fijaTasksForCarga, activitiesForCarga] = await Promise.all([
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
    prisma.task.findMany({
      where: { assignedToId: { in: subIds }, type: "FIJA", archivedMonth: null, completedAt: { gte: realStart, lte: realEndOfMonth } },
      select: { assignedToId: true, realHours: true, completedAt: true },
    }),
    prisma.taskActivity.findMany({
      where: { authorId: { in: subIds }, createdAt: { gte: realStart, lte: realEndOfMonth } },
      select: { authorId: true, duration: true, createdAt: true },
    }),
  ]);

  const commentMap = Object.fromEntries(
    commentGroups.map((c) => [c.authorId, c._count.id]),
  );

  function bizForUser(userId: string): MonthlyBusinessBase {
    return perUserBiz.get(userId) ?? sharedBiz;
  }

  const users = subordinates.map((sub) => {
    const tasks = allTasks.filter((t) => t.assignedToId === sub.id);
    const overdueCount = tasks.filter((t) => isTaskOverdue(t.endDate, t.status, refDate)).length;
    const completedPct = computeCompletedPctAny(tasks);
    const totalEst = tasks.reduce((s, t) => s + t.estimatedHours, 0);
    const totalReal = tasks.reduce((s, t) => s + t.realHours, 0);
    const cargaRatio = computeEstimatedVsRealRatio(totalReal, totalEst);
    const inProgress = tasks.filter((t) => t.status === "EN_PROGRESO");
    const avgProgress =
      inProgress.length > 0
        ? Math.round(
            inProgress.reduce((s, t) => s + t.progress, 0) / inProgress.length,
          )
        : 0;
    const comments = commentMap[sub.id] ?? 0;

    const score = computeSimpleScore(completedPct, cargaRatio, avgProgress, comments);

    const color = cumplimientoColor(completedPct);

    // ── Carga laboral por rango (5 zonas) — balance de carga y capacidad disponible ──
    const fijaHours = fijaTasksForCarga
      .filter((t) => t.assignedToId === sub.id)
      .reduce((s, t) => s + t.realHours, 0);
    const activityHours =
      activitiesForCarga.filter((a) => a.authorId === sub.id).reduce((s, a) => s + a.duration, 0) / 60;
    const cargaRealHours = Math.round((fijaHours + activityHours) * 100) / 100;

    const userBiz = bizForUser(sub.id);
    const cargaRange = computeWorkloadRange(
      cargaRealHours,
      userBiz.limitBaseHours,
      userBiz.limitLowHours,
      userBiz.limitHighHours,
      userBiz.limitOverloadHours,
    );
    const cargaPct = computeWorkloadPct(cargaRealHours, userBiz.limitBaseHours, cargaRange.max);

    // Capacidad disponible = MAX(0, límite óptimo superior - horas reales) / base mensual × 100.
    const horasDisponibles = Math.max(0, Math.round((userBiz.limitHighHours - cargaRealHours) * 100) / 100);
    const capacidadDisponiblePct =
      userBiz.baseHours > 0 ? Math.max(0, Math.round((horasDisponibles / userBiz.baseHours) * 100)) : 0;

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
      cargaPct,
      cargaColor: cargaRange.color,
      cargaLabel: cargaRange.label,
      cargaRealHours,
      cargaBaseHours: userBiz.baseHours,
      capacidadDisponiblePct,
      horasDisponibles,
    };
  });

  return NextResponse.json({ users });
}
