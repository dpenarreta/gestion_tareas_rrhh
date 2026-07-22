import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { getSubordinateRoles, ROLE_LEVEL, isExecutorRole } from "@/lib/roles";
import { monthlyBusinessBaseForUsers, computeWorkloadRange, computeWorkloadPct, type MonthlyBusinessBase } from "@/lib/workload";
import { businessDayRealRange } from "@/lib/businessTime";
import { computeSimpleScore, computeEstimatedVsRealRatio, computeCompletedPctAny, cached, computePerformanceScore, computeOperationalRisk, classifyOperationalRisk, classifyPerformanceScore } from "@/lib/analytics";
import { getEffectiveAnalyticsConfig } from "@/lib/systemConfig";
import { cumplimientoColor } from "@/lib/analyticsExplain";
import type { ExecutiveDashboardData } from "@/components/kpis/types";
import type { WorkloadColor, WorkloadLabel } from "@/components/kpis/types";

function monthBounds(year: number, month: number) {
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 0, 23, 59, 59, 999);
  return { start, end };
}

function monthLabel(year: number, month: number) {
  return new Date(year, month - 1, 1).toLocaleDateString("es-CL", { month: "short", year: "2-digit" });
}

type MemberMonthKpi = {
  id: string;
  name: string;
  role: string;
  completedPct: number;
  completed: number;
  cargaPct: number;
  cargaRealHours: number;
  cargaBaseHours: number;
  cargaColor: WorkloadColor;
  cargaLabel: WorkloadLabel;
  totalTasks: number;
  score: number;
};

const EMPTY_RESPONSE: ExecutiveDashboardData = {
  month: "",
  overview: { avgCumplimiento: 0, avgCumplimientoColor: "red", sobrecargaCount: 0, subutilizacionCount: 0, totalHoras: 0, totalConsultas: 0 },
  trend: [],
  trendDelta: 0,
  alerts: { lowCumplimiento: [], sobrecarga: [], pendingIdeas: [] },
  ranking: [],
  workload: [],
  ceo: {
    estado: "green",
    estadoLabel: "Sin datos",
    cambios: [],
    atender: [],
    performance: { avg: 0, classification: "Crítico", color: "red" },
    operationalRisk: { avg: 0, classification: "Bajo", color: "green" },
  },
};

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  // Dashboard ejecutivo: Administrador, Jefe Nacional y Coordinador Nacional
  // (nivel >= 3) — ver Analytics § dashboard ejecutivo.
  if (ROLE_LEVEL[session.role] < 3)
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });

  // getSubordinateRoles(session.role) acota siempre al propio alcance del viewer
  // (p. ej. para Coordinador Nacional excluye a Jefe Nacional y Administrador).
  // isExecutorRole excluye además roles de liderazgo (Jefe Nacional) que sí
  // podrían aparecer como subordinados del Administrador — su responsabilidad
  // es dirigir, no ejecutar tareas, así que no deben rankearse como
  // colaboradores individuales (ver Sprint 0A).
  const subordinateRoles = getSubordinateRoles(session.role).filter(isExecutorRole);
  const users = await prisma.user.findMany({
    where: { role: { in: subordinateRoles } },
    select: { id: true, name: true, role: true },
    orderBy: { name: "asc" },
  });
  const userIds = users.map((u) => u.id);

  if (userIds.length === 0) {
    return NextResponse.json(EMPTY_RESPONSE);
  }

  const now = new Date();
  const months = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
    return { year: d.getFullYear(), month: d.getMonth() + 1 };
  });

  const rangeStart = monthBounds(months[0].year, months[0].month).start;
  const rangeEnd = monthBounds(months[months.length - 1].year, months[months.length - 1].month).end;

  const monthBusinessInfo = await Promise.all(
    months.map(async ({ year, month }) => {
      const { shared, perUser } = await monthlyBusinessBaseForUsers(userIds, year, month);
      const { start: realStart } = businessDayRealRange(shared.start);
      const { end: realEnd } = businessDayRealRange(shared.end);
      return { year, month, ...shared, realStart, realEnd, perUser };
    }),
  );
  const rangeRealStart = monthBusinessInfo[0].realStart;
  const rangeRealEnd = monthBusinessInfo[monthBusinessInfo.length - 1].realEnd;

  const [allTasks, allActivities, fijaTasksForCarga, activitiesForCarga, pendingIdeasRaw] = await Promise.all([
    prisma.task.findMany({
      where: { assignedToId: { in: userIds }, endDate: { gte: rangeStart, lte: rangeEnd } },
      select: { assignedToId: true, status: true, endDate: true, progress: true, estimatedHours: true, realHours: true },
    }),
    prisma.taskActivity.findMany({
      where: { authorId: { in: userIds }, createdAt: { gte: rangeStart, lte: rangeEnd }, task: { type: "SEGUIMIENTO" } },
      select: { authorId: true, createdAt: true },
    }),
    prisma.task.findMany({
      where: { assignedToId: { in: userIds }, type: "FIJA", archivedMonth: null, completedAt: { gte: rangeRealStart, lte: rangeRealEnd } },
      select: { assignedToId: true, realHours: true, completedAt: true },
    }),
    prisma.taskActivity.findMany({
      where: { authorId: { in: userIds }, createdAt: { gte: rangeRealStart, lte: rangeRealEnd } },
      select: { authorId: true, duration: true, createdAt: true },
    }),
    prisma.improvementIdea.findMany({
      where: { status: { in: ["PROPUESTA", "EN_REVISION"] } },
      select: { id: true, title: true, status: true, author: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
  ]);

  function bizForUser(bizInfo: (typeof monthBusinessInfo)[number], userId: string): MonthlyBusinessBase {
    return bizInfo.perUser.get(userId) ?? bizInfo;
  }

  const monthSnapshots = monthBusinessInfo.map((bizInfo) => {
    const { start, end } = monthBounds(bizInfo.year, bizInfo.month);
    const monthTasks = allTasks.filter((t) => t.endDate >= start && t.endDate <= end);
    const monthActs = allActivities.filter((a) => a.createdAt >= start && a.createdAt <= end);
    const monthFija = fijaTasksForCarga.filter((t) => t.completedAt! >= bizInfo.realStart && t.completedAt! <= bizInfo.realEnd);
    const monthCargaActs = activitiesForCarga.filter((a) => a.createdAt >= bizInfo.realStart && a.createdAt <= bizInfo.realEnd);

    const members: MemberMonthKpi[] = users.map((user) => {
      const tasks = monthTasks.filter((t) => t.assignedToId === user.id);
      const completed = tasks.filter((t) => t.status === "COMPLETADA").length;
      const completedPct = computeCompletedPctAny(tasks);

      const fijaHours = monthFija.filter((t) => t.assignedToId === user.id).reduce((s, t) => s + t.realHours, 0);
      const activityHours = monthCargaActs.filter((a) => a.authorId === user.id).reduce((s, a) => s + a.duration, 0) / 60;
      const cargaRealHours = Math.round((fijaHours + activityHours) * 100) / 100;

      const userBiz = bizForUser(bizInfo, user.id);
      const cargaRange = computeWorkloadRange(cargaRealHours, userBiz.limitBaseHours, userBiz.limitLowHours, userBiz.limitHighHours, userBiz.limitOverloadHours);
      const cargaPct = computeWorkloadPct(cargaRealHours, userBiz.limitBaseHours, cargaRange.max);

      const inProgress = tasks.filter((t) => t.status === "EN_PROGRESO");
      const avgProgress = inProgress.length > 0 ? Math.round(inProgress.reduce((s, t) => s + t.progress, 0) / inProgress.length) : 0;
      // computeSimpleScore espera el ratio estimado/real de las tareas del
      // período (ver su propia definición en analytics.ts), no el % de carga
      // vs. base laboral — antes se pasaba cargaPct aquí, dando un "Score" no
      // comparable con el de /kpis/me, /kpis/team, etc. (Analytics Calculation
      // Registry § D3).
      const totalEstimated = tasks.reduce((s, t) => s + t.estimatedHours, 0);
      const totalReal = tasks.reduce((s, t) => s + t.realHours, 0);
      const cargaRatio = computeEstimatedVsRealRatio(totalReal, totalEstimated);
      const score = computeSimpleScore(completedPct, cargaRatio, avgProgress);

      return {
        id: user.id,
        name: user.name,
        role: user.role,
        completedPct,
        completed,
        cargaPct,
        cargaRealHours,
        cargaBaseHours: userBiz.baseHours,
        cargaColor: cargaRange.color,
        cargaLabel: cargaRange.label,
        totalTasks: tasks.length,
        score,
      };
    });

    const activeMembers = members.filter((m) => m.totalTasks > 0);
    const avgCumplimiento = activeMembers.length > 0 ? Math.round(activeMembers.reduce((s, m) => s + m.completedPct, 0) / activeMembers.length) : 0;

    return {
      key: `${bizInfo.year}-${String(bizInfo.month).padStart(2, "0")}`,
      label: monthLabel(bizInfo.year, bizInfo.month),
      avgCumplimiento,
      totalHoras: Math.round(members.reduce((s, m) => s + m.cargaRealHours, 0) * 100) / 100,
      totalConsultas: monthActs.length,
      members,
    };
  });

  const current = monthSnapshots[monthSnapshots.length - 1];
  const previous = monthSnapshots[monthSnapshots.length - 2] ?? null;
  const previousByUser = new Map(previous?.members.map((m) => [m.id, m]) ?? []);

  const sobrecargaCount = current.members.filter((m) => m.cargaLabel === "Sobrecarga").length;
  const subutilizacionCount = current.members.filter((m) => m.cargaLabel === "Subutilización").length;

  // Meses sin ningún miembro activo (nadie con tareas) se excluyen del todo
  // del gráfico — no un 0% engañoso — ver Analytics § evolución de cumplimiento.
  const trend = monthSnapshots
    .filter((ms) => ms.members.some((m) => m.totalTasks > 0))
    .map((ms) => ({ month: ms.key, label: ms.label, avgCumplimiento: ms.avgCumplimiento }));
  const trendDelta = previous ? current.avgCumplimiento - previous.avgCumplimiento : 0;

  const lowCumplimiento = current.members
    .filter((m) => m.totalTasks > 0 && m.completedPct < 60)
    .map((m) => ({ type: "cumplimiento" as const, userId: m.id, name: m.name, value: m.completedPct }));
  const sobrecargaAlerts = current.members
    .filter((m) => m.cargaLabel === "Sobrecarga")
    .map((m) => ({ type: "sobrecarga" as const, userId: m.id, name: m.name, value: m.cargaPct }));

  const pendingIdeas = pendingIdeasRaw.map((i) => ({ id: i.id, title: i.title, status: i.status, authorName: i.author.name }));

  const ranking = [...current.members]
    .sort((a, b) => b.score - a.score)
    .map((m) => ({
      ...m,
      scoreTrend: m.score - (previousByUser.get(m.id)?.score ?? m.score),
    }));

  const workload = current.members.map((m) => ({ id: m.id, name: m.name, realHours: m.cargaRealHours, baseHours: m.cargaBaseHours, color: m.cargaColor }));

  // ── Bloque CEO (§S2-A, ampliado en Sprint 5 § S5-K) ──────────────────────
  // Performance Score y Operational Risk del equipo — NUNCA se mezclan en un
  // solo número, se muestran como dos índices separados (ver Sprint 5 § S5-K).
  // Reutiliza las mismas claves de caché (`perf-bench:`/`risk-bench:`) que
  // computeSmartBenchmark (§Sprint 7), así que si alguien ya vio su propio
  // benchmark hoy este fetch es prácticamente gratis.
  const analyticsConfig = await getEffectiveAnalyticsConfig();
  const [perfScores, riskScoresRaw] = await Promise.all([
    Promise.all(userIds.map((id) => cached(`perf-bench:${id}`, analyticsConfig.cacheTtlMinutes, () => computePerformanceScore(id)).then((r) => r.value.score))),
    Promise.all(userIds.map((id) => cached(`risk-bench:${id}`, analyticsConfig.cacheTtlMinutes, () => computeOperationalRisk(id)).then((r) => r.value.score))),
  ]);
  const avgPerf = perfScores.length > 0 ? Math.round((perfScores.reduce((s, v) => s + v, 0) / perfScores.length) * 10) / 10 : 0;
  const avgRisk = riskScoresRaw.length > 0 ? Math.round((riskScoresRaw.reduce((s, v) => s + v, 0) / riskScoresRaw.length) * 10) / 10 : 0;
  // Reutiliza la misma clasificación que computePerformanceScore aplica al
  // score individual (antes se reimplementaban los mismos umbrales aquí para
  // el promedio del equipo — ver Analytics Calculation Registry § D7).
  const { classification: perfClassification, classificationColor: perfColor } = classifyPerformanceScore(avgPerf);
  const riskClassified = classifyOperationalRisk(avgRisk, analyticsConfig.riskThresholdMedio, analyticsConfig.riskThresholdAlto, analyticsConfig.riskThresholdCritico);

  // ── Bloque CEO — resto (§S2-A) ────────────────────────────────────────────
  // Todo derivado de los snapshots mensuales ya calculados arriba — sin
  // consultas adicionales, sin depender de cookies/sesión (ver Sprint 2 S2-A).
  const estado: "green" | "yellow" | "red" =
    current.avgCumplimiento < 60 || sobrecargaCount >= 2
      ? "red"
      : current.avgCumplimiento < 80 || sobrecargaCount >= 1 || lowCumplimiento.length >= 1
        ? "yellow"
        : "green";
  const estadoLabel = estado === "red" ? "Crítico" : estado === "yellow" ? "Atención" : "Saludable";

  const cambios: Array<{ text: string; positive: boolean }> = [];
  if (previous) {
    cambios.push({ text: `Cumplimiento ${trendDelta >= 0 ? "+" : ""}${trendDelta}%`, positive: trendDelta >= 0 });
  }
  for (const m of current.members) {
    const prevLabel = previousByUser.get(m.id)?.cargaLabel;
    if (m.cargaLabel === "Sobrecarga" && prevLabel !== "Sobrecarga") {
      cambios.push({ text: `${m.name} quedó sobrecargado/a`, positive: false });
    } else if (prevLabel === "Sobrecarga" && m.cargaLabel !== "Sobrecarga") {
      cambios.push({ text: `${m.name} salió de sobrecarga`, positive: true });
    }
  }
  const rankingWithTrend = ranking.filter((m) => Math.abs(m.scoreTrend) >= 5);
  const topImprover = rankingWithTrend.filter((m) => m.scoreTrend > 0).sort((a, b) => b.scoreTrend - a.scoreTrend)[0];
  if (topImprover) cambios.push({ text: `${topImprover.name} mejoró su score +${topImprover.scoreTrend} pts`, positive: true });
  const topDecliner = rankingWithTrend.filter((m) => m.scoreTrend < 0).sort((a, b) => a.scoreTrend - b.scoreTrend)[0];
  if (topDecliner) cambios.push({ text: `${topDecliner.name} bajó su score ${topDecliner.scoreTrend} pts`, positive: false });
  const topCompleter = [...current.members].filter((m) => m.completed >= 3).sort((a, b) => b.completed - a.completed)[0];
  if (topCompleter) cambios.push({ text: `${topCompleter.name} completó ${topCompleter.completed} tareas este mes`, positive: true });

  const atenderCandidates: Array<{ text: string; severity: number }> = [];
  for (const a of sobrecargaAlerts) {
    atenderCandidates.push({ text: `${a.name} — sobrecarga proyectada (${a.value}%)`, severity: 100 + a.value });
  }
  for (const a of lowCumplimiento) {
    const prevPct = previousByUser.get(a.userId)?.completedPct;
    const declining = prevPct !== undefined && a.value < prevPct;
    atenderCandidates.push({
      text: declining ? `${a.name} — cumplimiento en descenso (${a.value}%, antes ${prevPct}%)` : `${a.name} — cumplimiento bajo (${a.value}%)`,
      severity: 100 - a.value,
    });
  }
  // Recomendaciones a nivel de índice — siempre indican explícitamente cuál de
  // los dos requiere atención (§Sprint 5 S5-K, nunca se mezclan).
  if (perfClassification === "Riesgo" || perfClassification === "Crítico") {
    atenderCandidates.push({ text: `Performance Score del equipo en ${perfClassification} (${avgPerf})`, severity: 100 - avgPerf });
  }
  if (riskClassified.classification === "Alto" || riskClassified.classification === "Crítico") {
    atenderCandidates.push({ text: `Operational Risk del equipo en ${riskClassified.classification} (${avgRisk})`, severity: avgRisk });
  }
  const atender = atenderCandidates
    .sort((a, b) => b.severity - a.severity)
    .slice(0, 3)
    .map(({ text }) => text);

  const response: ExecutiveDashboardData = {
    month: current.key,
    overview: {
      avgCumplimiento: current.avgCumplimiento,
      avgCumplimientoColor: cumplimientoColor(current.avgCumplimiento),
      sobrecargaCount,
      subutilizacionCount,
      totalHoras: current.totalHoras,
      totalConsultas: current.totalConsultas,
    },
    trend,
    trendDelta,
    alerts: { lowCumplimiento, sobrecarga: sobrecargaAlerts, pendingIdeas },
    ranking,
    workload,
    ceo: {
      estado,
      estadoLabel,
      cambios: cambios.slice(0, 4),
      atender,
      performance: { avg: avgPerf, classification: perfClassification, color: perfColor },
      operationalRisk: { avg: avgRisk, classification: riskClassified.classification, color: riskClassified.classificationColor },
    },
  };

  return NextResponse.json(response);
}
