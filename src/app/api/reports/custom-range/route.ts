import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { canAccessReports, ALL_ROLES, isLeadershipRole } from "@/lib/roles";
import { isTaskOverdue } from "@/lib/utils";
import { businessBaseForRange, computeWorkloadRange, computeWorkloadPct } from "@/lib/workload";
import { businessDayRealRange } from "@/lib/businessTime";
import { computeSimpleScore, computeEstimatedVsRealRatio, computeCompletedPctAny } from "@/lib/analytics";
import { getActivityReasonLabelMap } from "@/lib/activityReasons";
import {
  computeRiskQuadrant,
  explainMotivoDistribution,
  computeFindings,
  computeRecommendations,
  computeTeamInsights,
  explainCumplimientoIndicator,
  explainCargaIndicator,
  explainConsultasIndicator,
  computeEffectiveMemberBases,
  deriveEstadoOperativo,
  computePrincipalHallazgo,
  previousEquivalentPeriod,
} from "@/lib/reportInsights";
import type { Role } from "@/generated/prisma/client";
import type { PeriodReportData, MotivoDistributionItem, ReportMemberKpi } from "@/components/kpis/types";

/**
 * Sprint Analytics 2.1 (Bloques 4-8, Generador Inteligente de Reportes) —
 * único endpoint que cubre los presets de período que NO calzan con límites
 * de mes calendario ("Últimos 30 días", "Rango personalizado"): recibe
 * fechas exactas (`from`/`to`, YYYY-MM-DD) en vez de meses. Los presets que
 * SÍ calzan con meses completos (mes actual/anterior, trimestre, semestre,
 * año) siguen usando /api/reports/generate y /api/reports/range — no se
 * duplica esa lógica aquí (ver docs/AUDIT_LOG.md § Sprint Analytics 2.1).
 * Nunca persiste (no existe un "informe de rango personalizado guardado" —
 * mismo criterio que /api/reports/range).
 *
 * Fechas en UTC-medianoche (no locales) para el cálculo de días hábiles y
 * las consultas — el resto del motor de carga laboral (workload.ts) ya
 * opera así (ver docs/ para el detalle de por qué: servidor en UTC-5, datos
 * guardados en UTC-medianoche).
 */

function parseDayUTC(dateStr: string, endOfDay: boolean): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  return endOfDay ? new Date(Date.UTC(y, m - 1, d, 23, 59, 59, 999)) : new Date(Date.UTC(y, m - 1, d));
}

function formatPeriodLabel(from: string, to: string): string {
  const fmt = (s: string) => {
    const [y, m, d] = s.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("es-CL", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
  };
  return `${fmt(from)} — ${fmt(to)}`;
}

export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    if (!canAccessReports(session.role))
      return NextResponse.json({ error: "Sin permisos" }, { status: 403 });

    const fromParam = request.nextUrl.searchParams.get("from");
    const toParam = request.nextUrl.searchParams.get("to");
    if (!fromParam || !toParam)
      return NextResponse.json({ error: "Parámetros from y to requeridos (YYYY-MM-DD)" }, { status: 400 });

    const periodStart = parseDayUTC(fromParam, false);
    const periodEnd = parseDayUTC(toParam, true);
    if (periodStart.getTime() > periodEnd.getTime())
      return NextResponse.json({ error: "La fecha de inicio debe ser anterior a la fecha de fin" }, { status: 400 });
    const spanDays = Math.round((periodEnd.getTime() - periodStart.getTime()) / 86400000);
    if (spanDays > 366)
      return NextResponse.json({ error: "El rango no puede superar 366 días" }, { status: 400 });

    const scope = session.role === "JEFE_NACIONAL" || session.role === "ADMINISTRADOR" ? "JEFE" : "COORDINADOR";

    const userIdsParam = request.nextUrl.searchParams.get("userIds");
    const requestedUserIds = userIdsParam ? userIdsParam.split(",").filter(Boolean) : null;

    const excludedRoles: Role[] = ALL_ROLES.filter(isLeadershipRole);
    const users = await prisma.user.findMany({
      where: {
        role: { notIn: excludedRoles },
        ...(requestedUserIds ? { id: { in: requestedUserIds } } : {}),
      },
      select: { id: true, name: true, role: true },
      orderBy: { name: "asc" },
    });
    const userIds = users.map((u) => u.id);

    const { hoursPerDay, limitLowPerDay, limitHighPerDay, limitOverloadPerDay, limitLowHours, limitHighHours, limitOverloadHours, baseHours: flatBaseHours } =
      await businessBaseForRange(periodStart, periodEnd);

    // Sprint Analytics 2.1 (Bloque 1) — Base Horaria Efectiva.
    const effectiveBases = await computeEffectiveMemberBases(
      userIds,
      periodStart,
      periodEnd,
      hoursPerDay,
      limitLowPerDay,
      limitHighPerDay,
      limitOverloadPerDay,
    );

    const { start: cargaRealStart } = businessDayRealRange(periodStart);
    const { end: cargaRealEnd } = businessDayRealRange(periodEnd);

    const [allTasks, allActivities, fijaTasksForCarga, activitiesForCarga] = await Promise.all([
      prisma.task.findMany({
        where: { assignedToId: { in: userIds }, endDate: { gte: periodStart, lte: periodEnd } },
        select: { assignedToId: true, status: true, endDate: true, progress: true, estimatedHours: true, realHours: true },
      }),
      prisma.taskActivity.findMany({
        where: { authorId: { in: userIds }, createdAt: { gte: periodStart, lte: periodEnd }, task: { type: "SEGUIMIENTO" } },
        select: { authorId: true, reason: true, duration: true },
      }),
      prisma.task.findMany({
        where: { assignedToId: { in: userIds }, type: "FIJA", completedAt: { gte: cargaRealStart, lte: cargaRealEnd } },
        select: { assignedToId: true, realHours: true },
      }),
      prisma.taskActivity.findMany({
        where: { authorId: { in: userIds }, createdAt: { gte: cargaRealStart, lte: cargaRealEnd } },
        select: { authorId: true, duration: true },
      }),
    ]);

    const now = new Date();
    const refDate = periodEnd < now ? periodEnd : now;

    const members: ReportMemberKpi[] = users.map((user) => {
      const tasks = allTasks.filter((t) => t.assignedToId === user.id);
      const completed = tasks.filter((t) => t.status === "COMPLETADA").length;
      const overdue = tasks.filter((t) => isTaskOverdue(t.endDate, t.status, refDate)).length;
      const completedPct = computeCompletedPctAny(tasks);

      const fijaHours = fijaTasksForCarga.filter((t) => t.assignedToId === user.id).reduce((s, t) => s + t.realHours, 0);
      const activityHours = activitiesForCarga.filter((a) => a.authorId === user.id).reduce((s, a) => s + a.duration, 0) / 60;
      const cargaRealHours = Math.round((fijaHours + activityHours) * 100) / 100;

      const userBase = effectiveBases.get(user.id)!;
      const cargaRange = computeWorkloadRange(cargaRealHours, userBase.limitBaseHours, userBase.limitLowHours, userBase.limitHighHours, userBase.limitOverloadHours);
      const cargaPct = computeWorkloadPct(cargaRealHours, userBase.limitBaseHours, cargaRange.max);

      const inProgress = tasks.filter((t) => t.status === "EN_PROGRESO");
      const avgProgress = inProgress.length > 0 ? Math.round(inProgress.reduce((s, t) => s + t.progress, 0) / inProgress.length) : 0;
      const totalEstimated = tasks.reduce((s, t) => s + t.estimatedHours, 0);
      const totalReal = tasks.reduce((s, t) => s + t.realHours, 0);
      const cargaRatio = computeEstimatedVsRealRatio(totalReal, totalEstimated);
      const score = computeSimpleScore(completedPct, cargaRatio, avgProgress);

      const userActivities = allActivities.filter((a) => a.authorId === user.id);
      const byReasonMap: Record<string, { count: number; totalMinutes: number }> = {};
      for (const act of userActivities) {
        if (!byReasonMap[act.reason]) byReasonMap[act.reason] = { count: 0, totalMinutes: 0 };
        byReasonMap[act.reason].count++;
        byReasonMap[act.reason].totalMinutes += act.duration;
      }

      // Sprint Analytics 2.1 (Bloques 9 y 10) — sin Equilibrio Operativo/
      // consistencia real (proyección de Capacidad Futura no representativa
      // para un rango de fechas arbitrario, mismo criterio que /range).
      const estadoOperativo = deriveEstadoOperativo({ completedPct, cargaLabel: cargaRange.label, overdueCount: overdue });
      const principalHallazgo = computePrincipalHallazgo({
        cargaLabel: cargaRange.label,
        completedPct,
        overdueCount: overdue,
        totalTasks: tasks.length,
      });

      return {
        id: user.id,
        name: user.name,
        role: user.role,
        score,
        completedPct,
        cargaPct,
        cargaRealHours,
        cargaBaseHours: userBase.baseHours,
        cargaColor: cargaRange.color,
        cargaLabel: cargaRange.label,
        cargaRangeMin: Math.round(userBase.limitBaseHours * 100) / 100,
        cargaRangeMax: cargaRange.max,
        totalTasks: tasks.length,
        completedTasks: completed,
        overdueCount: overdue,
        seguimientoTotal: userActivities.length,
        byReason: Object.entries(byReasonMap).map(([reason, d]) => ({ reason, count: d.count, totalMinutes: d.totalMinutes })),
        baseWasProrated: userBase.wasProrated,
        baseEffectiveStart: userBase.wasProrated ? userBase.effectiveStart.toISOString() : undefined,
        estadoOperativo,
        principalHallazgo,
      };
    });

    const totalConsultas = allActivities.length;
    const totalTasks = allTasks.length;
    const totalCompletedTasks = allTasks.filter((t) => t.status === "COMPLETADA").length;
    const totalCargaRealHours = Math.round(members.reduce((s, m) => s + m.cargaRealHours, 0) * 100) / 100;
    const totalCargaBaseHours = Math.round(members.reduce((s, m) => s + m.cargaBaseHours, 0) * 100) / 100;
    const totalLimitBaseHours = members.reduce((s, m) => s + (effectiveBases.get(m.id)?.limitBaseHours ?? 0), 0);
    const totalLimitLowHours = members.reduce((s, m) => s + (effectiveBases.get(m.id)?.limitLowHours ?? 0), 0);
    const totalLimitHighHours = members.reduce((s, m) => s + (effectiveBases.get(m.id)?.limitHighHours ?? 0), 0);
    const totalLimitOverloadHours = members.reduce((s, m) => s + (effectiveBases.get(m.id)?.limitOverloadHours ?? 0), 0);
    const teamCargaRange = computeWorkloadRange(totalCargaRealHours, totalLimitBaseHours, totalLimitLowHours, totalLimitHighHours, totalLimitOverloadHours);
    const avgCargaPct = computeWorkloadPct(totalCargaRealHours, totalLimitBaseHours, teamCargaRange.max);
    const avgCumplimiento = members.length > 0 ? Math.round(members.reduce((s, m) => s + m.completedPct, 0) / members.length) : 0;

    // Bloque 11 — % + tendencia + interpretación por motivo, período anterior equivalente (misma duración).
    const teamReasonMap: Record<string, { count: number; totalMinutes: number }> = {};
    for (const act of allActivities) {
      if (!teamReasonMap[act.reason]) teamReasonMap[act.reason] = { count: 0, totalMinutes: 0 };
      teamReasonMap[act.reason].count++;
      teamReasonMap[act.reason].totalMinutes += act.duration;
    }
    const { start: prevStart, end: prevEnd } = previousEquivalentPeriod(periodStart, periodEnd);
    const prevActivities = await prisma.taskActivity.findMany({
      where: { authorId: { in: userIds }, createdAt: { gte: prevStart, lte: prevEnd }, task: { type: "SEGUIMIENTO" } },
      select: { reason: true },
    });
    const prevReasonCount: Record<string, number> = {};
    for (const act of prevActivities) prevReasonCount[act.reason] = (prevReasonCount[act.reason] ?? 0) + 1;
    const totalConsultasPrev = prevActivities.length;

    const reasonLabelMap = await getActivityReasonLabelMap();
    const consultasByReason: MotivoDistributionItem[] = Object.entries(teamReasonMap)
      .map(([reason, d]) => {
        const pct = totalConsultas > 0 ? Math.round((d.count / totalConsultas) * 100) : 0;
        const prevCount = prevReasonCount[reason];
        const trendPct = prevCount && prevCount > 0 ? Math.round(((d.count - prevCount) / prevCount) * 100) : null;
        return { reason, count: d.count, totalMinutes: d.totalMinutes, pct, trendPct, interpretation: explainMotivoDistribution(reason, reasonLabelMap[reason] ?? reason, pct, trendPct) };
      })
      .sort((a, b) => b.count - a.count);

    const ranking = [...members]
      .sort((a, b) => b.score - a.score || b.completedPct - a.completedPct)
      .map(({ id, name, role, score, completedPct }) => ({ id, name, role, score, completedPct }));

    const alerts: PeriodReportData["alerts"] = [];
    for (const m of members) {
      if (m.completedPct < 60 && m.totalTasks > 0) alerts.push({ userId: m.id, name: m.name, type: "cumplimiento", value: m.completedPct });
      if (m.cargaLabel === "Sobrecarga") alerts.push({ userId: m.id, name: m.name, type: "sobrecarga", value: m.cargaPct });
    }

    const riskQuadrant = computeRiskQuadrant(members.map((m) => ({ id: m.id, name: m.name, completedPct: m.completedPct, cargaPct: m.cargaPct })));
    const topReason = consultasByReason[0] ? { label: reasonLabelMap[consultasByReason[0].reason] ?? consultasByReason[0].reason, pct: consultasByReason[0].pct ?? 0 } : null;
    const totalOverdue = members.reduce((s, m) => s + m.overdueCount, 0);
    const findings = computeFindings({ avgCumplimiento, avgCumplimientoDelta: null, members, totalOverdue, topReason });
    const recommendations = computeRecommendations({ avgCumplimiento, members, topReason });
    const insights = computeTeamInsights({ members, totalCargaRealHours });
    const indicatorExplanations = {
      cumplimiento: explainCumplimientoIndicator(avgCumplimiento, members.length),
      carga: explainCargaIndicator(avgCargaPct),
      consultas: explainConsultasIndicator(totalConsultas, totalConsultasPrev),
    };

    const cargaRangePerPerson = computeWorkloadRange(0, flatBaseHours, limitLowHours, limitHighHours, limitOverloadHours);

    const reportData: PeriodReportData = {
      from: fromParam,
      to: toParam,
      periodLabel: formatPeriodLabel(fromParam, toParam),
      scope,
      teamSummary: {
        avgCumplimiento,
        avgCargaPct,
        totalCargaRealHours,
        totalCargaBaseHours,
        totalCompletedTasks,
        totalConsultas,
        totalTasks,
        hoursPerDay,
        cargaRangeMin: Math.round(flatBaseHours * 100) / 100,
        cargaRangeMax: cargaRangePerPerson.max,
      },
      members,
      ranking,
      consultasByReason,
      alerts,
      riskQuadrant,
      findings,
      recommendations,
      insights,
      indicatorExplanations,
      aiAnalysis: "",
    };

    return NextResponse.json({ report: reportData });
  } catch (err) {
    console.error("[GET /api/reports/custom-range]", err);
    return NextResponse.json({ error: "Error al generar el informe del período" }, { status: 500 });
  }
}
