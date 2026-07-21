import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { canAccessReports, ROLE_LABEL } from "@/lib/roles";
import { isTaskOverdue } from "@/lib/utils";
import { monthlyBusinessBaseForUsers, computeWorkloadRange, computeWorkloadPct } from "@/lib/workload";
import { businessDayRealRange } from "@/lib/businessTime";
import { getActivityReasonLabelMap } from "@/lib/activityReasons";
import { computeSimpleScore, computeEstimatedVsRealRatio } from "@/lib/analytics";
import Groq from "groq-sdk";
import type { Role, ReportScope } from "@/generated/prisma/client";
import type { KpiColor, WorkloadLabel } from "@/components/kpis/types";

function monthBounds(year: number, month: number) {
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 0, 23, 59, 59, 999);
  return { start, end };
}

function monthLabel(year: number, month: number) {
  return new Date(year, month - 1, 1).toLocaleDateString("es-CL", {
    month: "long",
    year: "numeric",
  });
}

type MemberKpi = {
  id: string;
  name: string;
  role: string;
  score: number;
  completedPct: number;
  cargaPct: number;
  cargaRealHours: number;
  cargaBaseHours: number;
  cargaColor: KpiColor;
  cargaLabel: WorkloadLabel;
  cargaRangeMin: number;
  cargaRangeMax: number;
  totalTasks: number;
  completedTasks: number;
  overdueCount: number;
  seguimientoTotal: number;
  byReason: Array<{ reason: string; count: number; totalMinutes: number }>;
};

type ReportData = {
  month: string;
  scope: string;
  teamSummary: {
    avgCumplimiento: number;
    avgCargaPct: number;
    totalCargaRealHours: number;
    totalCargaBaseHours: number;
    totalCompletedTasks: number;
    totalConsultas: number;
    totalTasks: number;
    hoursPerDay: number;
    cargaRangeMin: number;
    cargaRangeMax: number;
  };
  members: MemberKpi[];
  ranking: Array<{ id: string; name: string; role: string; score: number; completedPct: number }>;
  consultasByReason: Array<{ reason: string; count: number; totalMinutes: number }>;
  alerts: Array<{ userId: string; name: string; type: "cumplimiento" | "sobrecarga"; value: number }>;
};

const SYSTEM_PROMPT_OBJECTIVITY = `Eres un analista de Recursos Humanos que genera informes ejecutivos estrictamente basados en datos.

REGLAS OBLIGATORIAS — aplica todas sin excepción:
1. Sé directo y objetivo. Si el cumplimiento es bajo, nómbralo sin minimizar. Ejemplo correcto: "El cumplimiento del 25% está muy por debajo del umbral mínimo del 60% y representa un riesgo operativo concreto." Ejemplo incorrecto: "Hay espacio para crecer."
2. No uses lenguaje motivacional vacío ni frases condescendientes como "el equipo tiene potencial" si los números no lo respaldan.
3. Cada fortaleza debe estar respaldada por un número real del informe. Si no hay fortalezas reales, di "No se identifican fortalezas destacables en el período analizado."
4. Si los datos son insuficientes (0 tareas, 0 horas), dilo explícitamente en lugar de generar conclusiones vagas.
5. Las recomendaciones deben ser específicas y accionables con un responsable o área clara. No generes generalidades.
6. Si hay personas con 0 tareas asignadas, señálalo como un posible problema de planificación o registro, no lo ignores.
7. El tono es profesional y directo. No es ni alarmista ni condescendiente. Es honesto.`;

async function buildAiAnalysis(data: ReportData, reasonLabelMap: Record<string, string>): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return "";

  const period = monthLabel(parseInt(data.month.split("-")[0]), parseInt(data.month.split("-")[1]));

  const rankingText = data.ranking
    .map((m, i) => `${i + 1}. ${m.name} (${ROLE_LABEL[m.role as Role] ?? m.role}): Score ${m.score}/100, Cumplimiento ${m.completedPct}%`)
    .join("\n");

  const membersText = data.members
    .map(
      (m) =>
        `- ${m.name} (${ROLE_LABEL[m.role as Role] ?? m.role}): Score ${m.score}/100 | Cumplimiento ${m.completedPct}% | Carga ${m.cargaPct}% (${m.cargaRealHours}h de ${m.cargaBaseHours}h base) — ${m.cargaLabel} (rango óptimo ${m.cargaRangeMin}h-${m.cargaRangeMax}h) | Tareas ${m.completedTasks}/${m.totalTasks} | Vencidas ${m.overdueCount} | Consultas SEGUIMIENTO ${m.seguimientoTotal}`,
    )
    .join("\n");

  const consultasText = data.consultasByReason.length > 0
    ? data.consultasByReason
        .map((r) => `  - ${reasonLabelMap[r.reason] ?? r.reason}: ${r.count} consultas, ${r.totalMinutes} min totales`)
        .join("\n")
    : "  Sin consultas SEGUIMIENTO registradas.";

  const alertsText = data.alerts.length > 0
    ? data.alerts
        .map((a) =>
          a.type === "cumplimiento"
            ? `  - ${a.name}: cumplimiento ${a.value}% (umbral: 60%)`
            : `  - ${a.name}: carga laboral ${a.value}% (Sobrecarga, por encima del rango óptimo configurado)`,
        )
        .join("\n")
    : "  Ninguna.";

  const userPrompt = `Analiza los KPIs consolidados del equipo para el período: ${period}.

RESUMEN DEL EQUIPO:
- Promedio de cumplimiento: ${data.teamSummary.avgCumplimiento}% (objetivo mínimo: 60%, objetivo ideal: 80%)
- Total tareas completadas: ${data.teamSummary.totalCompletedTasks} de ${data.teamSummary.totalTasks}
- Carga laboral del equipo: ${data.teamSummary.avgCargaPct}% (${data.teamSummary.totalCargaRealHours}h reales de ${data.teamSummary.totalCargaBaseHours}h base — la base es dinámica, calculada como días hábiles lunes-viernes del mes × ${data.teamSummary.hoursPerDay}h efectivas configuradas por persona; el Tiempo Objetivo por tarea es solo referencia y no forma parte de este cálculo). El rango óptimo configurado por persona este mes es de ${data.teamSummary.cargaRangeMin}h a ${data.teamSummary.cargaRangeMax}h — usa ese rango, no un 100% exacto, para juzgar si alguien está en carga óptima, elevada o sobrecarga.
- Total consultas SEGUIMIENTO atendidas: ${data.teamSummary.totalConsultas}

RANKING DE CUMPLIMIENTO (de mayor a menor):
${rankingText}

DETALLE POR PERSONA:
${membersText}

CONSULTAS SEGUIMIENTO POR MOTIVO:
${consultasText}

ALERTAS (personas bajo umbral):
${alertsText}

Genera el análisis con exactamente este formato:

## Resumen Ejecutivo
[2-3 párrafos. Nombra el porcentaje de cumplimiento real y evalúa si es aceptable o no. Si hay 0 tareas, dilo.]

## Fortalezas Identificadas
[Solo fortalezas respaldadas por números reales. Si no hay, escribe "No se identifican fortalezas destacables en este período."]

## Áreas de Mejora por Persona
[Una línea por persona con cumplimiento < 80% o carga > 100%. Incluye el número específico y una acción concreta.]

## Alertas de Gestión
[Una línea por alerta. Si no hay, escribe "Sin alertas críticas."]

## Recomendaciones para el Próximo Mes
[3-5 recomendaciones concretas, con acción específica y responsable o área clara.]`;

  try {
    const client = new Groq({ apiKey });
    const response = await client.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      max_tokens: 2048,
      messages: [
        { role: "system", content: SYSTEM_PROMPT_OBJECTIVITY },
        { role: "user", content: userPrompt },
      ],
    });

    return response.choices[0]?.message?.content ?? "";
  } catch {
    return "";
  }
}

export async function POST(request: NextRequest) {
  try {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (!canAccessReports(session.role))
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });

  const monthParam =
    request.nextUrl.searchParams.get("month") ??
    `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;
  const [yearStr, monthStr] = monthParam.split("-");
  const year = parseInt(yearStr);
  const month = parseInt(monthStr);
  const { start, end } = monthBounds(year, month);

  const scope: ReportScope =
    session.role === "JEFE_NACIONAL" || session.role === "ADMINISTRADOR" ? "JEFE" : "COORDINADOR";

  // El Administrador nunca aparece en informes consolidados, sin importar el scope.
  const excludedRoles: Role[] = scope === "JEFE" ? ["ADMINISTRADOR"] : ["ADMINISTRADOR", "JEFE_NACIONAL"];
  const users = await prisma.user.findMany({
    where: { role: { notIn: excludedRoles } },
    select: { id: true, name: true, role: true },
    orderBy: { name: "asc" },
  });

  const userIds = users.map((u) => u.id);

  // `shared` aplica a todo el equipo salvo a quienes tengan un estado especial
  // (maternidad/lactancia) vigente ese mes — esos usuarios usan su propia base/
  // límites (6h/5h/7h/8h) desde `perUser`.
  const {
    shared: {
      start: cargaStart,
      end: cargaEnd,
      baseHours: monthlyBaseHours,
      hoursPerDay,
      limitLowHours,
      limitHighHours,
      limitOverloadHours,
    },
    perUser: businessBasePerUser,
  } = await monthlyBusinessBaseForUsers(userIds, year, month);
  const { start: cargaRealStart } = businessDayRealRange(cargaStart);
  const { end: cargaRealEnd } = businessDayRealRange(cargaEnd);

  // Fetch all tasks and activities for the month in one go
  const [allTasks, allActivities, fijaTasksForCarga, activitiesForCarga] = await Promise.all([
    prisma.task.findMany({
      where: { assignedToId: { in: userIds }, endDate: { gte: start, lte: end } },
      select: {
        assignedToId: true,
        createdById: true,
        status: true,
        endDate: true,
        progress: true,
        type: true,
        frequency: true,
        estimatedHours: true,
        realHours: true,
      },
    }),
    prisma.taskActivity.findMany({
      where: {
        authorId: { in: userIds },
        createdAt: { gte: start, lte: end },
        task: { type: "SEGUIMIENTO" },
      },
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
  const refDate = end < now ? end : now;
  const recurringFreqs = ["MENSUAL", "SEMANAL", "DIARIA", "QUINCENAL"];

  const members: MemberKpi[] = users.map((user) => {
    const tasks = allTasks.filter((t) => t.assignedToId === user.id);
    const completed = tasks.filter((t) => t.status === "COMPLETADA").length;
    const overdue = tasks.filter((t) => isTaskOverdue(t.endDate, t.status, refDate)).length;
    const completedPct = tasks.length > 0 ? Math.round((completed / tasks.length) * 100) : 0;

    const fijaHours = fijaTasksForCarga
      .filter((t) => t.assignedToId === user.id)
      .reduce((s, t) => s + t.realHours, 0);
    const activityHours =
      activitiesForCarga.filter((a) => a.authorId === user.id).reduce((s, a) => s + a.duration, 0) / 60;
    const cargaRealHours = Math.round((fijaHours + activityHours) * 100) / 100;
    const userBase = businessBasePerUser.get(user.id);
    const userBaseHours = userBase?.baseHours ?? monthlyBaseHours;
    // limitBaseHours es el umbral real de clasificación Moderado/Óptimo — puede
    // diferir de userBaseHours (dailyHours) si el registro configuró valores distintos.
    const userLimitBaseHours = userBase?.limitBaseHours ?? monthlyBaseHours;
    const userLimitLowHours = userBase?.limitLowHours ?? limitLowHours;
    const userLimitHighHours = userBase?.limitHighHours ?? limitHighHours;
    const userLimitOverloadHours = userBase?.limitOverloadHours ?? limitOverloadHours;
    const cargaRange = computeWorkloadRange(cargaRealHours, userLimitBaseHours, userLimitLowHours, userLimitHighHours, userLimitOverloadHours);
    const cargaPct = computeWorkloadPct(cargaRealHours, userLimitBaseHours, cargaRange.max);

    const inProgress = tasks.filter((t) => t.status === "EN_PROGRESO");
    const avgProgress =
      inProgress.length > 0
        ? Math.round(inProgress.reduce((s, t) => s + t.progress, 0) / inProgress.length)
        : 0;

    const recurring = tasks.filter((t) => recurringFreqs.includes(t.frequency));
    const recurringCompleted = recurring.filter((t) => t.status === "COMPLETADA").length;

    // computeSimpleScore espera el ratio estimado/real de las tareas del
    // período, no el % de carga vs. base laboral (ver Analytics Calculation
    // Registry § D3) — antes se pasaba cargaPct, dando un "Score" no
    // comparable con el de /kpis/me, /kpis/team, etc.
    const totalEstimated = tasks.reduce((s, t) => s + t.estimatedHours, 0);
    const totalReal = tasks.reduce((s, t) => s + t.realHours, 0);
    const cargaRatio = computeEstimatedVsRealRatio(totalReal, totalEstimated);
    // Sin conteo de comentarios en el consolidado (varía según contexto, igual que antes).
    const score = computeSimpleScore(completedPct, cargaRatio, avgProgress);

    const userActivities = allActivities.filter((a) => a.authorId === user.id);
    const byReasonMap: Record<string, { count: number; totalMinutes: number }> = {};
    for (const act of userActivities) {
      if (!byReasonMap[act.reason]) byReasonMap[act.reason] = { count: 0, totalMinutes: 0 };
      byReasonMap[act.reason].count++;
      byReasonMap[act.reason].totalMinutes += act.duration;
    }
    const byReason = Object.entries(byReasonMap).map(([reason, d]) => ({
      reason,
      count: d.count,
      totalMinutes: d.totalMinutes,
    }));

    return {
      id: user.id,
      name: user.name,
      role: user.role,
      score,
      completedPct,
      cargaPct,
      cargaRealHours,
      cargaBaseHours: userBaseHours,
      cargaColor: cargaRange.color,
      cargaLabel: cargaRange.label,
      // cargaRangeMin/Max = límites de la zona Óptima (verde): [limitBase, workload_limit_high].
      cargaRangeMin: Math.round(userLimitBaseHours * 100) / 100,
      cargaRangeMax: cargaRange.max,
      totalTasks: tasks.length,
      completedTasks: completed,
      overdueCount: overdue,
      seguimientoTotal: userActivities.length,
      byReason,
      // Extra fields for report
      recurringCompleted,
      recurringTotal: recurring.length,
    } as MemberKpi & { recurringCompleted: number; recurringTotal: number };
  });

  // Aggregate team summary
  const totalConsultas = allActivities.length;
  const totalTasks = allTasks.length;
  const totalCompletedTasks = allTasks.filter((t) => t.status === "COMPLETADA").length;
  const totalCargaRealHours = Math.round(members.reduce((s, m) => s + m.cargaRealHours, 0) * 100) / 100;
  // Suma la base real de cada miembro (la de quienes tienen estado especial vigente
  // ya viene ajustada a 6h/día en cargaBaseHours) en vez de asumir la misma base
  // compartida para todos.
  const totalCargaBaseHours = Math.round(members.reduce((s, m) => s + m.cargaBaseHours, 0) * 100) / 100;
  const totalLimitBaseHours = members.reduce((s, m) => s + (businessBasePerUser.get(m.id)?.limitBaseHours ?? monthlyBaseHours), 0);
  const totalLimitLowHours = members.reduce((s, m) => s + (businessBasePerUser.get(m.id)?.limitLowHours ?? limitLowHours), 0);
  const totalLimitHighHours = members.reduce((s, m) => s + (businessBasePerUser.get(m.id)?.limitHighHours ?? limitHighHours), 0);
  const totalLimitOverloadHours = members.reduce((s, m) => s + (businessBasePerUser.get(m.id)?.limitOverloadHours ?? limitOverloadHours), 0);
  const teamCargaRange = computeWorkloadRange(
    totalCargaRealHours,
    totalLimitBaseHours,
    totalLimitLowHours,
    totalLimitHighHours,
    totalLimitOverloadHours,
  );
  const avgCargaPct = computeWorkloadPct(totalCargaRealHours, totalLimitBaseHours, teamCargaRange.max);
  const avgCumplimiento =
    members.length > 0
      ? Math.round(members.reduce((s, m) => s + m.completedPct, 0) / members.length)
      : 0;

  // Consultas by reason (team-wide)
  const teamReasonMap: Record<string, { count: number; totalMinutes: number }> = {};
  for (const act of allActivities) {
    if (!teamReasonMap[act.reason]) teamReasonMap[act.reason] = { count: 0, totalMinutes: 0 };
    teamReasonMap[act.reason].count++;
    teamReasonMap[act.reason].totalMinutes += act.duration;
  }
  const consultasByReason = Object.entries(teamReasonMap)
    .map(([reason, d]) => ({ reason, count: d.count, totalMinutes: d.totalMinutes }))
    .sort((a, b) => b.count - a.count);

  // Ranking
  const ranking = [...members]
    .sort((a, b) => b.score - a.score || b.completedPct - a.completedPct)
    .map(({ id, name, role, score, completedPct }) => ({ id, name, role, score, completedPct }));

  // Alerts
  const alerts: ReportData["alerts"] = [];
  for (const m of members) {
    if (m.completedPct < 60 && m.totalTasks > 0) {
      alerts.push({ userId: m.id, name: m.name, type: "cumplimiento", value: m.completedPct });
    }
    if (m.cargaLabel === "Sobrecarga") {
      alerts.push({ userId: m.id, name: m.name, type: "sobrecarga", value: m.cargaPct });
    }
  }

  // Rango óptimo configurado (por persona, no sumado al equipo) para que la
  // UI y el análisis de IA den contexto de qué significa el % de carga.
  const cargaRangePerPerson = computeWorkloadRange(0, monthlyBaseHours, limitLowHours, limitHighHours, limitOverloadHours);

  const reportData: ReportData = {
    month: monthParam,
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
      cargaRangeMin: Math.round(monthlyBaseHours * 100) / 100,
      cargaRangeMax: cargaRangePerPerson.max,
    },
    members,
    ranking,
    consultasByReason,
    alerts,
  };

  // Generate AI analysis
  const reasonLabelMap = await getActivityReasonLabelMap();
  const aiAnalysis = await buildAiAnalysis(reportData, reasonLabelMap);

  // Upsert report
  const report = await prisma.monthlyReport.upsert({
    where: { month_year_scope: { month, year, scope } },
    create: {
      month,
      year,
      generatedBy: session.userId,
      scope,
      data: reportData as object,
      aiAnalysis,
    },
    update: {
      generatedBy: session.userId,
      data: reportData as object,
      aiAnalysis,
    },
    include: { generator: { select: { name: true } } },
  });

  return NextResponse.json({
    report: {
      id: report.id,
      month: report.month,
      year: report.year,
      scope: report.scope,
      data: report.data,
      aiAnalysis: report.aiAnalysis,
      generatedBy: report.generator.name,
      createdAt: report.createdAt.toISOString(),
      updatedAt: report.updatedAt.toISOString(),
    },
  });
  } catch (err) {
    console.error("[POST /api/reports/generate]", err);
    return NextResponse.json({ error: "Error al generar el informe" }, { status: 500 });
  }
}
