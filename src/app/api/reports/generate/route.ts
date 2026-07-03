import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { canAccessReports, ROLE_LABEL } from "@/lib/roles";
import { isTaskOverdue } from "@/lib/utils";
import Groq from "groq-sdk";
import type { Role, ReportScope } from "@/generated/prisma/client";

const REASON_LABEL: Record<string, string> = {
  NOVEDADES_PAGO: "Novedades de pago",
  RETENCION_PAGO: "Retención de pago",
  FACTURAS: "Facturas",
  CONSULTA_OPERACIONES: "Consulta operaciones",
  SOLICITUD_VACACIONES: "Solicitud vacaciones",
  SOLICITUD_PERMISO: "Solicitud permiso",
  VISITA_DOMICILIARIA: "Visita domiciliaria",
  SEGUIMIENTO_AUSENTISMOS: "Seg. ausentismos",
  RECLUTAMIENTO_SELECCION: "Reclutamiento/Selección",
};

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
  cargaRatio: number;
  totalTasks: number;
  completedTasks: number;
  overdueCount: number;
  estimatedHours: number;
  realHours: number;
  seguimientoTotal: number;
  byReason: Array<{ reason: string; count: number; totalMinutes: number }>;
};

type ReportData = {
  month: string;
  scope: string;
  teamSummary: {
    avgCumplimiento: number;
    totalEstimatedHours: number;
    totalRealHours: number;
    totalCompletedTasks: number;
    totalConsultas: number;
    totalTasks: number;
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

async function buildAiAnalysis(data: ReportData): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return "";

  const period = monthLabel(parseInt(data.month.split("-")[0]), parseInt(data.month.split("-")[1]));

  const rankingText = data.ranking
    .map((m, i) => `${i + 1}. ${m.name} (${ROLE_LABEL[m.role as Role] ?? m.role}): Score ${m.score}/100, Cumplimiento ${m.completedPct}%`)
    .join("\n");

  const membersText = data.members
    .map(
      (m) =>
        `- ${m.name} (${ROLE_LABEL[m.role as Role] ?? m.role}): Score ${m.score}/100 | Cumplimiento ${m.completedPct}% | Carga ${m.cargaRatio}% | Tareas ${m.completedTasks}/${m.totalTasks} | Vencidas ${m.overdueCount} | Horas ${m.realHours}h/${m.estimatedHours}h est. | Consultas SEGUIMIENTO ${m.seguimientoTotal}`,
    )
    .join("\n");

  const consultasText = data.consultasByReason.length > 0
    ? data.consultasByReason
        .map((r) => `  - ${REASON_LABEL[r.reason] ?? r.reason}: ${r.count} consultas, ${r.totalMinutes} min totales`)
        .join("\n")
    : "  Sin consultas SEGUIMIENTO registradas.";

  const alertsText = data.alerts.length > 0
    ? data.alerts
        .map((a) =>
          a.type === "cumplimiento"
            ? `  - ${a.name}: cumplimiento ${a.value}% (umbral: 60%)`
            : `  - ${a.name}: carga laboral ${a.value}% (umbral: 120%)`,
        )
        .join("\n")
    : "  Ninguna.";

  const userPrompt = `Analiza los KPIs consolidados del equipo para el período: ${period}.

RESUMEN DEL EQUIPO:
- Promedio de cumplimiento: ${data.teamSummary.avgCumplimiento}% (objetivo mínimo: 60%, objetivo ideal: 80%)
- Total tareas completadas: ${data.teamSummary.totalCompletedTasks} de ${data.teamSummary.totalTasks}
- Horas totales: ${data.teamSummary.totalRealHours}h reales / ${data.teamSummary.totalEstimatedHours}h estimadas
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

  const scope: ReportScope = session.role === "JEFE_NACIONAL" ? "JEFE" : "COORDINADOR";

  // Avoid passing empty object as role filter — use conditional where clause
  const users = await prisma.user.findMany({
    where: scope === "JEFE" ? {} : { role: { not: "JEFE_NACIONAL" as Role } },
    select: { id: true, name: true, role: true },
    orderBy: { name: "asc" },
  });

  const userIds = users.map((u) => u.id);

  // Fetch all tasks and activities for the month in one go
  const [allTasks, allActivities] = await Promise.all([
    prisma.task.findMany({
      where: { assignedToId: { in: userIds }, endDate: { gte: start, lte: end } },
      select: {
        assignedToId: true,
        createdById: true,
        status: true,
        estimatedHours: true,
        realHours: true,
        endDate: true,
        progress: true,
        type: true,
        frequency: true,
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
  ]);

  const now = new Date();
  const refDate = end < now ? end : now;
  const recurringFreqs = ["MENSUAL", "SEMANAL", "DIARIA", "QUINCENAL"];

  const members: MemberKpi[] = users.map((user) => {
    const tasks = allTasks.filter((t) => t.assignedToId === user.id);
    const completed = tasks.filter((t) => t.status === "COMPLETADA").length;
    const overdue = tasks.filter((t) => isTaskOverdue(t.endDate, t.status, refDate)).length;
    const completedPct = tasks.length > 0 ? Math.round((completed / tasks.length) * 100) : 0;
    const totalEst = Math.round(tasks.reduce((s, t) => s + t.estimatedHours, 0) * 100) / 100;
    const totalReal = Math.round(tasks.reduce((s, t) => s + t.realHours, 0) * 100) / 100;
    const cargaRatio =
      totalEst > 0 ? Math.round((totalReal / totalEst) * 100) : totalReal > 0 ? 200 : 0;

    const inProgress = tasks.filter((t) => t.status === "EN_PROGRESO");
    const avgProgress =
      inProgress.length > 0
        ? Math.round(inProgress.reduce((s, t) => s + t.progress, 0) / inProgress.length)
        : 0;

    const recurring = tasks.filter((t) => recurringFreqs.includes(t.frequency));
    const recurringCompleted = recurring.filter((t) => t.status === "COMPLETADA").length;

    // Score (same formula as individual route)
    const scoreC = (completedPct / 100) * 40;
    const scoreL = Math.max(0, 20 - Math.max(0, cargaRatio - 100) * 0.5);
    const scoreA = (avgProgress / 100) * 20;
    // For consolidated, we skip comment scoring since it varies per context
    const score = Math.round(scoreC + scoreL + scoreA);

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
      cargaRatio,
      totalTasks: tasks.length,
      completedTasks: completed,
      overdueCount: overdue,
      estimatedHours: totalEst,
      realHours: totalReal,
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
  const totalEstimatedHours =
    Math.round(allTasks.reduce((s, t) => s + t.estimatedHours, 0) * 100) / 100;
  const totalRealHours =
    Math.round(allTasks.reduce((s, t) => s + t.realHours, 0) * 100) / 100;
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
    if (m.cargaRatio > 120 && m.estimatedHours > 0) {
      alerts.push({ userId: m.id, name: m.name, type: "sobrecarga", value: m.cargaRatio });
    }
  }

  const reportData: ReportData = {
    month: monthParam,
    scope,
    teamSummary: {
      avgCumplimiento,
      totalEstimatedHours,
      totalRealHours,
      totalCompletedTasks,
      totalConsultas,
      totalTasks,
    },
    members,
    ranking,
    consultasByReason,
    alerts,
  };

  // Generate AI analysis
  const aiAnalysis = await buildAiAnalysis(reportData);

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
    },
  });
  } catch (err) {
    console.error("[POST /api/reports/generate]", err);
    return NextResponse.json({ error: "Error al generar el informe" }, { status: 500 });
  }
}
