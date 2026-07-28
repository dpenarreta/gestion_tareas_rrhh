import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { getVisibleRoles } from "@/lib/roles";
import { isTaskOverdue } from "@/lib/utils";
import {
  computeCargaTiempo,
  computeCargaHistory,
  redactSensitiveWorkloadDetail,
  businessBaseForRange,
  computeWorkloadRange,
  computeWorkloadPct,
} from "@/lib/workload";
import { businessDayRealRange } from "@/lib/businessTime";
import { computeRiskAlerts } from "@/lib/riskAlerts";
import { computePriorityCompliance, isCompletedOnTime } from "@/lib/priorityCompliance";
import { validateCumplimientoConsistency, computeSimpleScore, computeEstimatedVsRealRatio } from "@/lib/analytics";
import { cumplimientoColor } from "@/lib/analyticsExplain";
import type { KpiColor, WorkloadColor } from "@/components/kpis/types";

// El indicador "Carga Laboral" usa la misma fuente validada que WorkloadCard
// (computeCargaTiempo → cargaTiempo.mensual), NO el ratio horas-estimadas-vs-
// reales de las tareas del período (ese ratio sigue existiendo solo como input
// del Score básico, ver `cargaRatio` más abajo) — antes de este fix mostraban
// horas/base distintas para el mismo período (bug reportado 2026-07-28).
function cargaColor(workloadColor: WorkloadColor): KpiColor {
  if (workloadColor === "green") return "green";
  if (workloadColor === "red") return "red";
  return "yellow"; // yellow (Moderado) y orange (Carga elevada) comparten el nivel intermedio
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

  const [cargaTiempoBase, cargaHistory] = await Promise.all([
    computeCargaTiempo(userId),
    computeCargaHistory(userId),
  ]);
  const cargaTiempoFull = { ...cargaTiempoBase, dailyHistory: cargaHistory.daily, weeklyHistory: cargaHistory.weekly };
  // Los permisos médicos y el estado de maternidad/lactancia son datos de salud
  // (Art. 26 LOPDP) — visibles en detalle solo para el propio titular y el
  // Administrador; un superior en la jerarquía solo ve que hay horas de ausencia
  // justificada, no el tipo (ver docs/RAT.md, sección 5 y 10).
  const canSeeSensitiveDetail = session.userId === userId || session.role === "ADMINISTRADOR";
  const cargaTiempo = canSeeSensitiveDetail
    ? cargaTiempoFull
    : redactSensitiveWorkloadDetail(cargaTiempoFull);

  const riskAlerts = await computeRiskAlerts({
    userId,
    cargaLabel: cargaTiempoBase.mensual.label,
    cargaPct: cargaTiempoBase.mensual.pct,
  });

  // ── Cumplimiento ──────────────────────────────────────────────────────────
  // "Cumplimiento" = % completado A TIEMPO (isCompletedOnTime), misma definición
  // que cumplimientoPorPrioridad — ver Analytics § Sprint 1 (cumplimiento por
  // prioridad inconsistente con el general). `completed` (status COMPLETADA,
  // sin importar si fue a tiempo) se conserva aparte para el desglose de
  // estados de tarea (completed+inProgress+pending = total).
  const completed = tasks.filter((t) => t.status === "COMPLETADA");
  const completedOnTime = tasks.filter(isCompletedOnTime);
  const inProgressTasks = tasks.filter((t) => t.status === "EN_PROGRESO");
  const pendingTasks = tasks.filter((t) => t.status === "PENDIENTE");
  const overdueTasks = tasks.filter((t) => isTaskOverdue(t.endDate, t.status, refDate));
  const completedPct =
    tasks.length > 0 ? Math.round((completedOnTime.length / tasks.length) * 100) : 0;
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
  // Ratio horas-estimadas-vs-reales de las tareas del período — usado
  // ÚNICAMENTE como input del Score básico (computeSimpleScore), no del
  // indicador "Carga Laboral" (ver cargaColor arriba y cargaLaboral abajo).
  const totalEstimated = tasks.reduce((s, t) => s + t.estimatedHours, 0);
  const totalReal = tasks.reduce((s, t) => s + t.realHours, 0);
  const cargaRatio = computeEstimatedVsRealRatio(totalReal, totalEstimated);

  const cumplimientoPorPrioridad = computePriorityCompliance(tasks);

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
  const avgProgress =
    inProgressTasks.length > 0
      ? Math.round(
          inProgressTasks.reduce((s, t) => s + t.progress, 0) / inProgressTasks.length,
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
  const score = computeSimpleScore(completedPct, cargaRatio, avgProgress, totalComments);

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
    select: { endDate: true, status: true, completedAt: true },
  });

  // Meses sin ninguna tarea se excluyen del todo (no un 0% engañoso) — ver
  // Analytics § evolución de cumplimiento. Misma definición "a tiempo" que el
  // cumplimiento del mes actual y por prioridad.
  const cumplimientoHistory = Array.from({ length: 6 }, (_, i) => {
    let m = month - 5 + i;
    let y = year;
    while (m <= 0) { m += 12; y--; }
    while (m > 12) { m -= 12; y++; }
    const { start: hs, end: he } = monthBounds(y, m);
    const mt = historyTasks.filter((t) => t.endDate >= hs && t.endDate <= he);
    const mc = mt.filter(isCompletedOnTime).length;
    const pct = mt.length > 0 ? Math.round((mc / mt.length) * 100) : 0;
    const label = new Date(y, m - 1, 1).toLocaleDateString("es-CL", {
      month: "short",
      year: "2-digit",
    });
    return { month: `${y}-${String(m).padStart(2, "0")}`, label, completedPct: pct, total: mt.length };
  }).filter((entry) => entry.total > 0)
    .map(({ total: _total, ...rest }) => rest);

  // ── Previous month ────────────────────────────────────────────────────────
  let pm = month - 1;
  let py = year;
  if (pm <= 0) { pm = 12; py--; }
  const { start: ps, end: pe } = monthBounds(py, pm);
  const { start: prevRealStart } = businessDayRealRange(ps);
  const { end: prevRealEnd } = businessDayRealRange(pe);
  const [prevTasks, prevActivities, prevBase, prevFijaTasks, prevActivitiesForCarga] = await Promise.all([
    prisma.task.findMany({
      where: { assignedToId: userId, endDate: { gte: ps, lte: pe } },
      select: { status: true, completedAt: true, endDate: true },
    }),
    prisma.taskActivity.count({
      where: { authorId: userId, createdAt: { gte: ps, lte: pe } },
    }),
    // Misma fuente que cargaTiempo.mensual (Base Horaria Efectiva), aplicada
    // al mes anterior — para que el delta de "Carga laboral" compare el mismo
    // tipo de dato mes a mes (ver reports/custom-range/route.ts para el mismo patrón).
    businessBaseForRange(ps, pe),
    prisma.task.findMany({
      where: { assignedToId: userId, type: "FIJA", archivedMonth: null, completedAt: { gte: prevRealStart, lte: prevRealEnd } },
      select: { realHours: true },
    }),
    prisma.taskActivity.findMany({
      where: { authorId: userId, createdAt: { gte: prevRealStart, lte: prevRealEnd } },
      select: { duration: true },
    }),
  ]);
  const prevCompleted = prevTasks.filter(isCompletedOnTime).length;
  const prevPct =
    prevTasks.length > 0 ? Math.round((prevCompleted / prevTasks.length) * 100) : 0;
  const prevFijaHours = prevFijaTasks.reduce((s, t) => s + t.realHours, 0);
  const prevActivityHours = prevActivitiesForCarga.reduce((s, a) => s + a.duration, 0) / 60;
  const prevCargaRealHours = Math.round((prevFijaHours + prevActivityHours) * 100) / 100;
  const prevCargaRange = computeWorkloadRange(
    prevCargaRealHours,
    prevBase.limitBaseHours,
    prevBase.limitLowHours,
    prevBase.limitHighHours,
    prevBase.limitOverloadHours,
  );
  const prevCarga = computeWorkloadPct(prevCargaRealHours, prevBase.limitBaseHours, prevCargaRange.max);

  // Validación de consistencia (§S3-C) — solo el Administrador ve el detalle;
  // para cualquier otro viewer se registra en auditoría y se oculta.
  const validationFailures = await validateCumplimientoConsistency(
    userId,
    { total: tasks.length, pct: completedPct },
    cumplimientoPorPrioridad
  );

  return NextResponse.json({
    user: { id: targetUser.id, name: targetUser.name, role: targetUser.role },
    period: { month: monthParam },
    cumplimiento: {
      total: tasks.length,
      completed: completed.length,
      completedOnTime: completedOnTime.length,
      inProgress: inProgressTasks.length,
      pending: pendingTasks.length,
      overdue: overdueTasks.length,
      completedPct,
      overduePct,
      avgDelayDays,
      color: cumplimientoColor(completedPct),
      explain: {
        formula: "completadas_a_tiempo / total_tareas × 100",
        steps: [
          `Tareas del período: ${tasks.length}`,
          `Completadas (cualquier momento): ${completed.length}`,
          `Completadas a tiempo (completedAt ≤ endDate): ${completedOnTime.length}`,
          `Cumplimiento = ${completedOnTime.length} / ${tasks.length} = ${completedPct}%`,
        ],
      },
    },
    cargaLaboral: {
      // estimatedHours conserva el nombre de campo (usado en 3 componentes de
      // UI) pero ahora contiene cargaTiempo.mensual.baseHours (Base Horaria
      // Efectiva), no la suma de estimatedHours de las tareas — ver comentario
      // sobre cargaColor arriba.
      estimatedHours: cargaTiempoBase.mensual.baseHours,
      realHours: cargaTiempoBase.mensual.realHours,
      ratio: cargaTiempoBase.mensual.pct,
      color: cargaColor(cargaTiempoBase.mensual.color),
    },
    cargaTiempo,
    riskAlerts,
    cumplimientoPorPrioridad,
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
      const isOverdue = isTaskOverdue(t.endDate, t.status, refDate);
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
    ...(session.role === "ADMINISTRADOR" && validationFailures.length > 0 ? { validationWarnings: validationFailures } : {}),
  });
}
