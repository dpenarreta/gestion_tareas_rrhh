import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { isTaskOverdue } from "@/lib/utils";
import { monthlyBusinessBaseForUsers, computeWorkloadRange, computeWorkloadPct } from "@/lib/workload";
import { businessDayRealRange } from "@/lib/businessTime";

function monthBounds(year: number, month: number) {
  return {
    start: new Date(year, month - 1, 1),
    end: new Date(year, month, 0, 23, 59, 59, 999),
  };
}

function monthLabel(year: number, month: number) {
  return new Date(year, month - 1, 1).toLocaleDateString("es-CL", {
    month: "long",
    year: "numeric",
  });
}

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const from = request.nextUrl.searchParams.get("from");
  const to = request.nextUrl.searchParams.get("to");

  if (!from || !to)
    return NextResponse.json({ error: "Parámetros from y to requeridos" }, { status: 400 });
  if (from >= to)
    return NextResponse.json(
      { error: "El mes de inicio debe ser anterior al de fin" },
      { status: 400 },
    );

  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);

  const months: Array<{ year: number; month: number }> = [];
  let cy = fy, cm = fm;
  while (cy < ty || (cy === ty && cm <= tm)) {
    months.push({ year: cy, month: cm });
    cm++;
    if (cm > 12) { cm = 1; cy++; }
  }

  if (months.length < 2)
    return NextResponse.json({ error: "El rango debe incluir al menos 2 meses" }, { status: 400 });
  if (months.length > 24)
    return NextResponse.json({ error: "El rango no puede superar 24 meses" }, { status: 400 });

  const userId = session.userId;
  const rangeStart = monthBounds(fy, fm).start;
  const rangeEnd = monthBounds(ty, tm).end;

  // Base dinámica de carga (días hábiles × horas efectivas/límites vigentes
  // en cada mes) — el mismo mecanismo que /api/reports/range, para que "Mi
  // actividad" muestre el semáforo por rango, no solo el ratio real/estimado.
  // monthlyBusinessBaseForUsers (no monthlyBusinessBase) para que un estado especial
  // (maternidad/lactancia) vigente en ESTE usuario reemplace la base/límites globales
  // en los meses donde aplique — antes esta ruta ignoraba el estado especial.
  const monthBusinessInfo = await Promise.all(
    months.map(async ({ year, month }) => {
      const monthStr = `${year}-${String(month).padStart(2, "0")}`;
      const { shared, perUser } = await monthlyBusinessBaseForUsers([userId], year, month);
      const { start: cargaStart, end: cargaEnd, baseHours, limitBaseHours, limitLowHours, limitHighHours, limitOverloadHours } =
        perUser.get(userId) ?? shared;
      const { start: realStart } = businessDayRealRange(cargaStart);
      const { end: realEnd } = businessDayRealRange(cargaEnd);
      return { monthStr, realStart, realEnd, baseHours, limitBaseHours, limitLowHours, limitHighHours, limitOverloadHours };
    }),
  );
  const rangeRealStart = monthBusinessInfo[0].realStart;
  const rangeRealEnd = monthBusinessInfo[monthBusinessInfo.length - 1].realEnd;

  const [allTasks, allActivities, fijaCompletedTasks, fijaTasksForCarga, activitiesForCarga] = await Promise.all([
    prisma.task.findMany({
      where: { assignedToId: userId, endDate: { gte: rangeStart, lte: rangeEnd } },
      select: {
        endDate: true,
        status: true,
        type: true,
        estimatedHours: true,
        realHours: true,
        progress: true,
      },
    }),
    prisma.taskActivity.findMany({
      where: {
        authorId: userId,
        createdAt: { gte: rangeStart, lte: rangeEnd },
        task: { type: "SEGUIMIENTO" },
      },
      select: { reason: true, duration: true, createdAt: true },
    }),
    prisma.task.findMany({
      where: { assignedToId: userId, type: "FIJA", completedAt: { gte: rangeStart, lte: rangeEnd } },
      select: { completedAt: true, realHours: true },
    }),
    prisma.task.findMany({
      where: { assignedToId: userId, type: "FIJA", completedAt: { gte: rangeRealStart, lte: rangeRealEnd } },
      select: { completedAt: true, realHours: true },
    }),
    prisma.taskActivity.findMany({
      where: { authorId: userId, createdAt: { gte: rangeRealStart, lte: rangeRealEnd } },
      select: { duration: true, createdAt: true },
    }),
  ]);

  const now = new Date();

  const monthSnapshots = months.map(({ year, month }) => {
    const { start, end } = monthBounds(year, month);
    const refDate = end < now ? end : now;
    const monthStr = `${year}-${String(month).padStart(2, "0")}`;
    const bizInfo = monthBusinessInfo.find((b) => b.monthStr === monthStr)!;

    const tasks = allTasks.filter((t) => t.endDate >= start && t.endDate <= end);
    const activities = allActivities.filter((a) => a.createdAt >= start && a.createdAt <= end);

    const completed = tasks.filter((t) => t.status === "COMPLETADA").length;
    const completedPct = tasks.length > 0 ? Math.round((completed / tasks.length) * 100) : 0;

    const totalEstimated = tasks.reduce((s, t) => s + t.estimatedHours, 0);
    const nonFijaReal = tasks.filter((t) => t.type !== "FIJA").reduce((s, t) => s + t.realHours, 0);
    const fijaReal = fijaCompletedTasks
      .filter((t) => t.completedAt! >= start && t.completedAt! <= end)
      .reduce((s, t) => s + t.realHours, 0);
    const totalReal = nonFijaReal + fijaReal;
    const cargaRatio =
      totalEstimated > 0
        ? Math.round((totalReal / totalEstimated) * 100)
        : totalReal > 0
          ? 200
          : 0;

    const inProgress = tasks.filter((t) => t.status === "EN_PROGRESO");
    const avgProgress =
      inProgress.length > 0
        ? Math.round(inProgress.reduce((s, t) => s + t.progress, 0) / inProgress.length)
        : 0;

    // Simplified score without comment count for bulk range queries
    const scoreC = (completedPct / 100) * 40;
    const scoreL = Math.max(0, 20 - Math.max(0, cargaRatio - 100) * 0.5);
    const scoreA = (avgProgress / 100) * 20;
    const score = Math.round(scoreC + scoreL + scoreA);

    // Flag if this month had no real deadline tasks
    const overdueCount = tasks.filter((t) => isTaskOverdue(t.endDate, t.status, refDate)).length;

    // Carga laboral por rango (base = días hábiles × horas efectivas vigentes ese mes)
    const monthFijaCarga = fijaTasksForCarga.filter(
      (t) => t.completedAt! >= bizInfo.realStart && t.completedAt! <= bizInfo.realEnd,
    );
    const monthActsCarga = activitiesForCarga.filter(
      (a) => a.createdAt >= bizInfo.realStart && a.createdAt <= bizInfo.realEnd,
    );
    const cargaRealHours = Math.round(
      (monthFijaCarga.reduce((s, t) => s + t.realHours, 0) +
        monthActsCarga.reduce((s, a) => s + a.duration, 0) / 60) *
        100,
    ) / 100;
    const cargaBaseHours = bizInfo.baseHours;
    const cargaRange = computeWorkloadRange(
      cargaRealHours,
      bizInfo.limitBaseHours,
      bizInfo.limitLowHours,
      bizInfo.limitHighHours,
      bizInfo.limitOverloadHours,
    );
    const cargaPct = computeWorkloadPct(cargaRealHours, bizInfo.limitBaseHours, cargaRange.max);

    return {
      month: monthStr,
      label: monthLabel(year, month),
      completedPct,
      totalTasks: tasks.length,
      completedTasks: completed,
      overdueCount,
      realHours: Math.round(totalReal * 100) / 100,
      estimatedHours: Math.round(totalEstimated * 100) / 100,
      seguimientoTotal: activities.length,
      score,
      cargaRealHours,
      cargaBaseHours,
      cargaPct,
      cargaColor: cargaRange.color,
      cargaLabel: cargaRange.label,
      cargaRangeMin: Math.round(bizInfo.limitBaseHours * 100) / 100,
      cargaRangeMax: cargaRange.max,
    };
  });

  // Aggregated across active months
  const activeMonths = monthSnapshots.filter((m) => m.totalTasks > 0);
  const avgCumplimiento =
    activeMonths.length > 0
      ? Math.round(activeMonths.reduce((s, m) => s + m.completedPct, 0) / activeMonths.length)
      : 0;
  const avgScore =
    activeMonths.length > 0
      ? Math.round(activeMonths.reduce((s, m) => s + m.score, 0) / activeMonths.length)
      : 0;
  const totalTasks = monthSnapshots.reduce((s, m) => s + m.totalTasks, 0);
  const totalCompletedTasks = monthSnapshots.reduce((s, m) => s + m.completedTasks, 0);
  const totalRealHours =
    Math.round(monthSnapshots.reduce((s, m) => s + m.realHours, 0) * 100) / 100;
  const totalEstimatedHours =
    Math.round(monthSnapshots.reduce((s, m) => s + m.estimatedHours, 0) * 100) / 100;
  const totalSeguimiento = monthSnapshots.reduce((s, m) => s + m.seguimientoTotal, 0);

  // Carga laboral acumulada del rango (base/límites sumados mes a mes, ya
  // que pueden variar de un mes a otro si cambió la configuración).
  const totalCargaRealHours = Math.round(monthSnapshots.reduce((s, m) => s + m.cargaRealHours, 0) * 100) / 100;
  const totalCargaBaseHours = Math.round(monthBusinessInfo.reduce((s, b) => s + b.baseHours, 0) * 100) / 100;
  const totalLimitBaseHours = monthBusinessInfo.reduce((s, b) => s + b.limitBaseHours, 0);
  const totalLimitLowHours = monthBusinessInfo.reduce((s, b) => s + b.limitLowHours, 0);
  const totalLimitHighHours = monthBusinessInfo.reduce((s, b) => s + b.limitHighHours, 0);
  const totalLimitOverloadHours = monthBusinessInfo.reduce((s, b) => s + b.limitOverloadHours, 0);
  const cargaRangeAgg = computeWorkloadRange(totalCargaRealHours, totalLimitBaseHours, totalLimitLowHours, totalLimitHighHours, totalLimitOverloadHours);
  const avgCargaPct = computeWorkloadPct(totalCargaRealHours, totalLimitBaseHours, cargaRangeAgg.max);

  const byReasonMap: Record<string, { count: number; totalMinutes: number }> = {};
  for (const act of allActivities) {
    if (!byReasonMap[act.reason]) byReasonMap[act.reason] = { count: 0, totalMinutes: 0 };
    byReasonMap[act.reason].count++;
    byReasonMap[act.reason].totalMinutes += act.duration;
  }
  const consultasByReason = Object.entries(byReasonMap)
    .map(([reason, d]) => ({ reason, count: d.count, totalMinutes: d.totalMinutes }))
    .sort((a, b) => b.count - a.count);

  // Trend: compare first vs last active month
  const firstActive = monthSnapshots.find((m) => m.totalTasks > 0);
  const lastActive = [...monthSnapshots].reverse().find((m) => m.totalTasks > 0);
  const firstPct = firstActive?.completedPct ?? 0;
  const lastPct = lastActive?.completedPct ?? 0;
  const change = lastPct - firstPct;
  const trend =
    Math.abs(change) > 5 ? (change > 0 ? "mejora" : "deterioro") : "estancamiento";

  return NextResponse.json({
    report: {
      from,
      to,
      months: monthSnapshots,
      aggregated: {
        avgCumplimiento,
        avgScore,
        totalTasks,
        totalCompletedTasks,
        totalRealHours,
        totalEstimatedHours,
        totalSeguimiento,
        consultasByReason,
        totalCargaRealHours,
        totalCargaBaseHours,
        avgCargaPct,
        cargaColor: cargaRangeAgg.color,
        cargaLabel: cargaRangeAgg.label,
        cargaRangeMin: Math.round(totalLimitBaseHours * 100) / 100,
        cargaRangeMax: cargaRangeAgg.max,
      },
      trends: {
        cumplimientoTrend: trend as "mejora" | "deterioro" | "estancamiento",
        cumplimientoChange: change,
        firstMonthCumplimiento: firstPct,
        lastMonthCumplimiento: lastPct,
      },
    },
  });
}
