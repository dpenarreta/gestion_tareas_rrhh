import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { canAccessReports, ROLE_LABEL } from "@/lib/roles";
import { isTaskOverdue } from "@/lib/utils";
import { monthlyBusinessBaseForUsers, computeWorkloadRange, computeWorkloadPct } from "@/lib/workload";
import { businessDayRealRange } from "@/lib/businessTime";
import { computeSimpleScore, computeEstimatedVsRealRatio, computeCompletedPctAny } from "@/lib/analytics";
import Groq from "groq-sdk";
import type { Role } from "@/generated/prisma/client";
import type { MonthSnapshot, RangeReportData, ReportMemberKpi } from "@/components/kpis/types";

const SYSTEM_PROMPT_OBJECTIVITY = `Eres un analista de Recursos Humanos que genera informes ejecutivos estrictamente basados en datos.

REGLAS OBLIGATORIAS — aplica todas sin excepción:
1. Sé directo y objetivo. Si el cumplimiento es bajo, nómbralo sin minimizar. Ejemplo correcto: "El cumplimiento del 25% está muy por debajo del umbral mínimo del 60% y representa un riesgo operativo concreto." Ejemplo incorrecto: "Hay espacio para crecer."
2. No uses lenguaje motivacional vacío ni frases condescendientes sin respaldo numérico.
3. Cada fortaleza debe estar respaldada por un número real del informe. Si no hay fortalezas, di "No se identifican fortalezas destacables en el período analizado."
4. Si los datos son insuficientes (0 tareas, 0 horas), dilo explícitamente en lugar de generar conclusiones vagas.
5. Las recomendaciones deben ser específicas y accionables con un responsable o área clara.
6. Para análisis de RANGO: identifica si hay tendencia de mejora, deterioro o estancamiento con números concretos. Nombra los meses problemáticos específicamente. Las recomendaciones deben ser a mediano plazo basadas en la trayectoria, no solo en el promedio.`;

function monthBounds(year: number, month: number) {
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 0, 23, 59, 59, 999);
  return { start, end };
}

function getMonthsInRange(from: string, to: string): string[] {
  const months: string[] = [];
  let [y, m] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    months.push(`${y}-${String(m).padStart(2, "0")}`);
    if (++m > 12) { m = 1; y++; }
  }
  return months;
}

function monthLabel(monthStr: string) {
  const [y, mo] = monthStr.split("-").map(Number);
  return new Date(y, mo - 1, 1).toLocaleDateString("es-CL", { month: "long", year: "numeric" });
}

async function buildRangeAiAnalysis(data: RangeReportData): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return "";

  const periodLabel = `${monthLabel(data.from)} a ${monthLabel(data.to)}`;

  const evolutionText = data.months
    .map((ms) => `  ${ms.label}: cumplimiento ${ms.teamAvgCumplimiento}% | tareas ${ms.totalCompletedTasks}/${ms.totalTasks} | consultas ${ms.totalConsultas}`)
    .join("\n");

  const rankingText = data.aggregated.ranking
    .map((m, i) => `${i + 1}. ${m.name} (${ROLE_LABEL[m.role as Role] ?? m.role}): Score prom. ${m.avgScore}/100, Cumplimiento prom. ${m.avgCumplimiento}%`)
    .join("\n");

  const membersText = data.aggregated.members
    .map(
      (m) =>
        `- ${m.name} (${ROLE_LABEL[m.role as Role] ?? m.role}): Cumpl. prom. ${m.completedPct}% | Carga ${m.cargaPct}% (${m.cargaRealHours}h de ${m.cargaBaseHours}h base) — ${m.cargaLabel} (rango óptimo ${m.cargaRangeMin}h-${m.cargaRangeMax}h) | Tareas ${m.completedTasks}/${m.totalTasks} | Consultas ${m.seguimientoTotal}`,
    )
    .join("\n");

  const trendText = `Tendencia: ${
    data.trends.cumplimientoTrend === "mejora" ? "MEJORA" : data.trends.cumplimientoTrend === "deterioro" ? "DETERIORO" : "ESTANCAMIENTO"
  } (${data.trends.firstMonthAvgCumplimiento}% → ${data.trends.lastMonthAvgCumplimiento}%, cambio: ${data.trends.cumplimientoChange > 0 ? "+" : ""}${data.trends.cumplimientoChange} pp)`;

  const problematicText = data.aggregated.problematicMonths.length > 0
    ? data.aggregated.problematicMonths.map((ms) => `  - ${ms.label}: ${ms.teamAvgCumplimiento}%`).join("\n")
    : "  Ninguno (cumplimiento ≥ 60% en todos los meses con tareas).";

  const alertsText = data.aggregated.alerts.length > 0
    ? data.aggregated.alerts
        .map((a) =>
          a.type === "cumplimiento"
            ? `  - ${a.name}: cumplimiento prom. ${a.avgValue}% en ${a.monthsAffected} meses`
            : `  - ${a.name}: sobrecarga (por encima del rango óptimo) en ${a.monthsAffected} meses, carga prom. ${a.avgValue}%`,
        )
        .join("\n")
    : "  Ninguna.";

  const userPrompt = `Analiza los KPIs consolidados del equipo para el RANGO: ${periodLabel} (${data.months.length} meses).

EVOLUCIÓN MES A MES:
${evolutionText}

TENDENCIA GENERAL:
${trendText}

MESES PROBLEMÁTICOS (cumplimiento equipo < 60%):
${problematicText}

RESUMEN ACUMULADO DEL PERÍODO:
- Cumplimiento promedio: ${data.aggregated.teamSummary.avgCumplimiento}% (objetivo mínimo: 60%, objetivo ideal: 80%)
- Total tareas completadas: ${data.aggregated.teamSummary.totalCompletedTasks} de ${data.aggregated.teamSummary.totalTasks}
- Carga laboral acumulada: ${data.aggregated.teamSummary.avgCargaPct}% (${data.aggregated.teamSummary.totalCargaRealHours}h reales de ${data.aggregated.teamSummary.totalCargaBaseHours}h base — base dinámica: días hábiles lunes-viernes de cada mes × horas efectivas configuradas por persona (según lo vigente en cada mes del rango); el Tiempo Objetivo por tarea es solo referencia y no forma parte de este cálculo). Rango óptimo configurado por persona en el último mes del rango: ${data.aggregated.teamSummary.cargaRangeMin}h a ${data.aggregated.teamSummary.cargaRangeMax}h — usa ese rango, no un 100% exacto, para juzgar carga óptima vs. sobrecarga.
- Total consultas SEGUIMIENTO: ${data.aggregated.teamSummary.totalConsultas}

RANKING PROMEDIO DEL PERÍODO:
${rankingText}

DETALLE ACUMULADO POR PERSONA:
${membersText}

ALERTAS PERSISTENTES (problema en ≥50% de los meses activos):
${alertsText}

Genera el análisis con exactamente este formato:

## Resumen Ejecutivo del Período
[2-3 párrafos. Describe la situación general con los números reales. Evalúa la tendencia: si mejoró, empeoró o se estancó con los valores concretos. Nombra los meses problemáticos si los hay.]

## Fortalezas Identificadas
[Solo fortalezas respaldadas por números reales del período. Si no hay, escribe "No se identifican fortalezas destacables en este período."]

## Análisis de Tendencias
[Párrafo específico sobre si el equipo mejoró, empeoró o se estancó. Usa los datos mes a mes para respaldar la conclusión. Si hay meses particularmente malos, nombrarlos.]

## Áreas de Mejora por Persona
[Una línea por persona con cumplimiento promedio < 80% o sobrecarga. Incluye el número y una acción concreta para el siguiente período.]

## Alertas de Gestión
[Una línea por alerta persistente. Si no hay, escribe "Sin alertas de carácter persistente."]

## Recomendaciones Estratégicas a Mediano Plazo
[3-5 recomendaciones basadas en la trayectoria observada, no solo en el promedio. Deben ser accionables con responsable o área específica.]`;

  try {
    const client = new Groq({ apiKey });
    const response = await client.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      max_tokens: 3000,
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

export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    if (!canAccessReports(session.role))
      return NextResponse.json({ error: "Sin permisos" }, { status: 403 });

    const fromParam = request.nextUrl.searchParams.get("from");
    const toParam = request.nextUrl.searchParams.get("to");
    if (!fromParam || !toParam)
      return NextResponse.json({ error: "Parámetros from y to requeridos" }, { status: 400 });

    const months = getMonthsInRange(fromParam, toParam);
    if (months.length < 2)
      return NextResponse.json({ error: "El rango debe incluir al menos 2 meses" }, { status: 400 });
    if (months.length > 24)
      return NextResponse.json({ error: "El rango no puede superar 24 meses" }, { status: 400 });

    const scope = session.role === "JEFE_NACIONAL" || session.role === "ADMINISTRADOR" ? "JEFE" : "COORDINADOR";

    // El Administrador nunca aparece en informes consolidados, sin importar el scope.
    const excludedRoles: Role[] = scope === "JEFE" ? ["ADMINISTRADOR"] : ["ADMINISTRADOR", "JEFE_NACIONAL"];
    const users = await prisma.user.findMany({
      where: { role: { notIn: excludedRoles } },
      select: { id: true, name: true, role: true },
      orderBy: { name: "asc" },
    });
    const userIds = users.map((u) => u.id);

    // Bounds for the entire range
    const [fromYear, fromMonth] = fromParam.split("-").map(Number);
    const [toYear, toMonth] = toParam.split("-").map(Number);
    const rangeStart = monthBounds(fromYear, fromMonth).start;
    const rangeEnd = monthBounds(toYear, toMonth).end;

    // Dynamic business-day base per month (días lunes-viernes × horas efectivas vigentes ese mes).
    // `perUser` trae overrides (base 6h/límites 5-7-8) para quienes tengan un estado
    // especial (maternidad/lactancia) vigente ese mes — el resto del equipo usa los
    // campos compartidos de este mismo objeto.
    const monthBusinessInfo = await Promise.all(
      months.map(async (monthStr) => {
        const [y, mo] = monthStr.split("-").map(Number);
        const { shared, perUser } = await monthlyBusinessBaseForUsers(userIds, y, mo);
        const { start: cargaStart, end: cargaEnd, baseHours, limitBaseHours, limitLowHours, limitHighHours, limitOverloadHours } = shared;
        const { start: realStart } = businessDayRealRange(cargaStart);
        const { end: realEnd } = businessDayRealRange(cargaEnd);
        return { monthStr, cargaStart, cargaEnd, realStart, realEnd, baseHours, limitBaseHours, limitLowHours, limitHighHours, limitOverloadHours, perUser };
      }),
    );

    function bizInfoForUser(bizInfo: (typeof monthBusinessInfo)[number], userId: string) {
      return bizInfo.perUser.get(userId) ?? bizInfo;
    }
    const rangeRealStart = monthBusinessInfo[0].realStart;
    const rangeRealEnd = monthBusinessInfo[monthBusinessInfo.length - 1].realEnd;

    // Bulk queries for the entire range
    const [allTasks, allActivities, fijaTasksForCarga, activitiesForCarga] = await Promise.all([
      prisma.task.findMany({
        where: { assignedToId: { in: userIds }, endDate: { gte: rangeStart, lte: rangeEnd } },
        select: {
          assignedToId: true,
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
          createdAt: { gte: rangeStart, lte: rangeEnd },
          task: { type: "SEGUIMIENTO" },
        },
        select: { authorId: true, reason: true, duration: true, createdAt: true },
      }),
      prisma.task.findMany({
        where: { assignedToId: { in: userIds }, type: "FIJA", completedAt: { gte: rangeRealStart, lte: rangeRealEnd } },
        select: { assignedToId: true, realHours: true, completedAt: true },
      }),
      prisma.taskActivity.findMany({
        where: { authorId: { in: userIds }, createdAt: { gte: rangeRealStart, lte: rangeRealEnd } },
        select: { authorId: true, duration: true, createdAt: true },
      }),
    ]);

    const now = new Date();

    // Build per-month snapshots
    const monthSnapshots: MonthSnapshot[] = months.map((monthStr) => {
      const [y, mo] = monthStr.split("-").map(Number);
      const { start, end } = monthBounds(y, mo);
      const refDate = end < now ? end : now;
      const bizInfo = monthBusinessInfo.find((b) => b.monthStr === monthStr)!;

      const monthTasks = allTasks.filter((t) => t.endDate >= start && t.endDate <= end);
      const monthActs = allActivities.filter((a) => a.createdAt >= start && a.createdAt <= end);
      const monthFija = fijaTasksForCarga.filter(
        (t) => t.completedAt! >= bizInfo.realStart && t.completedAt! <= bizInfo.realEnd,
      );
      const monthCargaActs = activitiesForCarga.filter(
        (a) => a.createdAt >= bizInfo.realStart && a.createdAt <= bizInfo.realEnd,
      );

      const memberSnapshots = users.map((user) => {
        const tasks = monthTasks.filter((t) => t.assignedToId === user.id);
        const completedPct = computeCompletedPctAny(tasks);

        const fijaHours = monthFija
          .filter((t) => t.assignedToId === user.id)
          .reduce((s, t) => s + t.realHours, 0);
        const activityHours =
          monthCargaActs.filter((a) => a.authorId === user.id).reduce((s, a) => s + a.duration, 0) / 60;
        const cargaRealHours = Math.round((fijaHours + activityHours) * 100) / 100;
        const userBiz = bizInfoForUser(bizInfo, user.id);
        const cargaRange = computeWorkloadRange(
          cargaRealHours,
          userBiz.limitBaseHours,
          userBiz.limitLowHours,
          userBiz.limitHighHours,
          userBiz.limitOverloadHours,
        );
        const cargaPct = computeWorkloadPct(cargaRealHours, userBiz.limitBaseHours, cargaRange.max);

        const inProgress = tasks.filter((t) => t.status === "EN_PROGRESO");
        const avgProgress =
          inProgress.length > 0
            ? Math.round(inProgress.reduce((s, t) => s + t.progress, 0) / inProgress.length)
            : 0;
        const overdue = tasks.filter((t) => isTaskOverdue(t.endDate, t.status, refDate)).length;
        // computeSimpleScore espera el ratio estimado/real de las tareas del
        // período, no el % de carga vs. base laboral (ver Analytics
        // Calculation Registry § D3) — antes se pasaba cargaPct aquí.
        const totalEstimated = tasks.reduce((s, t) => s + t.estimatedHours, 0);
        const totalReal = tasks.reduce((s, t) => s + t.realHours, 0);
        const cargaRatio = computeEstimatedVsRealRatio(totalReal, totalEstimated);
        const score = computeSimpleScore(completedPct, cargaRatio, avgProgress);
        return {
          id: user.id,
          name: user.name,
          role: user.role,
          completedPct,
          cargaPct,
          cargaRealHours,
          cargaBaseHours: userBiz.baseHours,
          cargaColor: cargaRange.color,
          cargaLabel: cargaRange.label,
          score,
          totalTasks: tasks.length,
          overdueCount: overdue,
        };
      });

      const activeMemberSnapshots = memberSnapshots.filter((m) => m.totalTasks > 0);
      const teamAvgCumplimiento =
        activeMemberSnapshots.length > 0
          ? Math.round(activeMemberSnapshots.reduce((s, m) => s + m.completedPct, 0) / activeMemberSnapshots.length)
          : 0;

      return {
        month: monthStr,
        label: monthLabel(monthStr),
        teamAvgCumplimiento,
        totalCompletedTasks: monthTasks.filter((t) => t.status === "COMPLETADA").length,
        totalTasks: monthTasks.length,
        totalCargaRealHours: Math.round(memberSnapshots.reduce((s, m) => s + m.cargaRealHours, 0) * 100) / 100,
        totalCargaBaseHours: Math.round(memberSnapshots.reduce((s, m) => s + m.cargaBaseHours, 0) * 100) / 100,
        totalConsultas: monthActs.length,
        memberSnapshots: memberSnapshots.map(({ overdueCount: _oc, cargaRealHours: _crh, cargaBaseHours: _cbh, ...rest }) => rest),
      };
    });

    // Suma la base/límites de cada mes del rango PARA ESE usuario en particular
    // (los meses en que tuvo estado especial vigente aportan su override de 6h/5-7-8).
    function rangeBizForUser(userId: string) {
      return monthBusinessInfo.reduce(
        (acc, b) => {
          const u = bizInfoForUser(b, userId);
          return {
            baseHours: acc.baseHours + u.baseHours,
            limitBaseHours: acc.limitBaseHours + u.limitBaseHours,
            limitLowHours: acc.limitLowHours + u.limitLowHours,
            limitHighHours: acc.limitHighHours + u.limitHighHours,
            limitOverloadHours: acc.limitOverloadHours + u.limitOverloadHours,
          };
        },
        { baseHours: 0, limitBaseHours: 0, limitLowHours: 0, limitHighHours: 0, limitOverloadHours: 0 },
      );
    }

    // Aggregate per member across full range
    const aggregatedMembers: ReportMemberKpi[] = users.map((user) => {
      const userTasks = allTasks.filter((t) => t.assignedToId === user.id);
      const userActs = allActivities.filter((a) => a.authorId === user.id);

      const completedTasks = userTasks.filter((t) => t.status === "COMPLETADA").length;

      const fijaHours = fijaTasksForCarga
        .filter((t) => t.assignedToId === user.id)
        .reduce((s, t) => s + t.realHours, 0);
      const activityHours =
        activitiesForCarga.filter((a) => a.authorId === user.id).reduce((s, a) => s + a.duration, 0) / 60;
      const cargaRealHours = Math.round((fijaHours + activityHours) * 100) / 100;
      const userRangeBiz = rangeBizForUser(user.id);
      const cargaBaseHours = userRangeBiz.baseHours;
      const cargaRange = computeWorkloadRange(
        cargaRealHours,
        userRangeBiz.limitBaseHours,
        userRangeBiz.limitLowHours,
        userRangeBiz.limitHighHours,
        userRangeBiz.limitOverloadHours,
      );
      const cargaPct = computeWorkloadPct(cargaRealHours, userRangeBiz.limitBaseHours, cargaRange.max);

      // Average cumplimiento across months where user had tasks
      const activeSnaps = monthSnapshots.filter(
        (ms) => ms.memberSnapshots.find((m) => m.id === user.id)!.totalTasks > 0,
      );
      const avgCumplimiento =
        activeSnaps.length > 0
          ? Math.round(
              activeSnaps.reduce(
                (s, ms) => s + ms.memberSnapshots.find((m) => m.id === user.id)!.completedPct,
                0,
              ) / activeSnaps.length,
            )
          : 0;
      const avgScore =
        activeSnaps.length > 0
          ? Math.round(
              activeSnaps.reduce(
                (s, ms) => s + ms.memberSnapshots.find((m) => m.id === user.id)!.score,
                0,
              ) / activeSnaps.length,
            )
          : 0;

      const byReasonMap: Record<string, { count: number; totalMinutes: number }> = {};
      for (const act of userActs) {
        if (!byReasonMap[act.reason]) byReasonMap[act.reason] = { count: 0, totalMinutes: 0 };
        byReasonMap[act.reason].count++;
        byReasonMap[act.reason].totalMinutes += act.duration;
      }

      return {
        id: user.id,
        name: user.name,
        role: user.role,
        score: avgScore,
        completedPct: avgCumplimiento,
        cargaPct,
        cargaRealHours,
        cargaBaseHours,
        cargaColor: cargaRange.color,
        cargaLabel: cargaRange.label,
        cargaRangeMin: Math.round(userRangeBiz.limitBaseHours * 100) / 100,
        cargaRangeMax: cargaRange.max,
        totalTasks: userTasks.length,
        completedTasks,
        overdueCount: 0,
        seguimientoTotal: userActs.length,
        byReason: Object.entries(byReasonMap).map(([reason, d]) => ({
          reason,
          count: d.count,
          totalMinutes: d.totalMinutes,
        })),
      };
    });

    // Team summary
    const activeMonths = monthSnapshots.filter((ms) => ms.totalTasks > 0);
    const avgCumplimiento =
      activeMonths.length > 0
        ? Math.round(activeMonths.reduce((s, ms) => s + ms.teamAvgCumplimiento, 0) / activeMonths.length)
        : 0;
    const totalCargaRealHours = Math.round(aggregatedMembers.reduce((s, m) => s + m.cargaRealHours, 0) * 100) / 100;
    const totalCargaBaseHours = Math.round(aggregatedMembers.reduce((s, m) => s + m.cargaBaseHours, 0) * 100) / 100;
    const totalLimitBaseHours = users.reduce((s, u) => s + rangeBizForUser(u.id).limitBaseHours, 0);
    const totalLimitLowHours = users.reduce((s, u) => s + rangeBizForUser(u.id).limitLowHours, 0);
    const totalLimitHighHours = users.reduce((s, u) => s + rangeBizForUser(u.id).limitHighHours, 0);
    const totalLimitOverloadHours = users.reduce((s, u) => s + rangeBizForUser(u.id).limitOverloadHours, 0);
    const teamCargaRange = computeWorkloadRange(
      totalCargaRealHours,
      totalLimitBaseHours,
      totalLimitLowHours,
      totalLimitHighHours,
      totalLimitOverloadHours,
    );
    const avgCargaPct = computeWorkloadPct(totalCargaRealHours, totalLimitBaseHours, teamCargaRange.max);

    // Rango óptimo configurado por persona (no sumado al equipo), usando lo
    // vigente en el último mes del rango, para dar contexto en la UI/IA.
    const lastMonthBizInfo = monthBusinessInfo[monthBusinessInfo.length - 1];
    const cargaRangeLastMonth = computeWorkloadRange(
      0,
      lastMonthBizInfo.limitBaseHours,
      lastMonthBizInfo.limitLowHours,
      lastMonthBizInfo.limitHighHours,
      lastMonthBizInfo.limitOverloadHours,
    );

    // Consultas by reason
    const reasonMap: Record<string, { count: number; totalMinutes: number }> = {};
    for (const act of allActivities) {
      if (!reasonMap[act.reason]) reasonMap[act.reason] = { count: 0, totalMinutes: 0 };
      reasonMap[act.reason].count++;
      reasonMap[act.reason].totalMinutes += act.duration;
    }
    const consultasByReason = Object.entries(reasonMap)
      .map(([reason, d]) => ({ reason, count: d.count, totalMinutes: d.totalMinutes }))
      .sort((a, b) => b.count - a.count);

    // Ranking
    const ranking = [...aggregatedMembers]
      .sort((a, b) => b.completedPct - a.completedPct || b.score - a.score)
      .map(({ id, name, role, score, completedPct }) => ({
        id, name, role, avgScore: score, avgCumplimiento: completedPct,
      }));

    // Alerts: members with persistent issues (≥50% active months affected)
    const alerts: RangeReportData["aggregated"]["alerts"] = [];
    for (const user of users) {
      const activeMSnaps = monthSnapshots.filter(
        (ms) => ms.memberSnapshots.find((m) => m.id === user.id)!.totalTasks > 0,
      );
      if (activeMSnaps.length === 0) continue;
      const threshold = Math.ceil(activeMSnaps.length / 2);

      const lowCumpl = activeMSnaps.filter(
        (ms) => ms.memberSnapshots.find((m) => m.id === user.id)!.completedPct < 60,
      );
      if (lowCumpl.length >= threshold) {
        const avgValue = Math.round(
          lowCumpl.reduce((s, ms) => s + ms.memberSnapshots.find((m) => m.id === user.id)!.completedPct, 0) /
            lowCumpl.length,
        );
        alerts.push({ userId: user.id, name: user.name, type: "cumplimiento", avgValue, monthsAffected: lowCumpl.length });
      }

      const overloaded = activeMSnaps.filter(
        (ms) => ms.memberSnapshots.find((m) => m.id === user.id)!.cargaLabel === "Sobrecarga",
      );
      if (overloaded.length >= threshold) {
        const avgValue = Math.round(
          overloaded.reduce((s, ms) => s + ms.memberSnapshots.find((m) => m.id === user.id)!.cargaPct, 0) /
            overloaded.length,
        );
        alerts.push({ userId: user.id, name: user.name, type: "sobrecarga", avgValue, monthsAffected: overloaded.length });
      }
    }

    // Problematic months
    const problematicMonths = monthSnapshots
      .filter((ms) => ms.totalTasks > 0 && ms.teamAvgCumplimiento < 60)
      .map(({ month, label, teamAvgCumplimiento }) => ({ month, label, teamAvgCumplimiento }));

    // Trends
    const firstActive = monthSnapshots.find((ms) => ms.totalTasks > 0);
    const lastActive = [...monthSnapshots].reverse().find((ms) => ms.totalTasks > 0);
    const firstMonthAvgCumplimiento = firstActive?.teamAvgCumplimiento ?? 0;
    const lastMonthAvgCumplimiento = lastActive?.teamAvgCumplimiento ?? 0;
    const cumplimientoChange = lastMonthAvgCumplimiento - firstMonthAvgCumplimiento;
    const cumplimientoTrend =
      cumplimientoChange > 5 ? "mejora" : cumplimientoChange < -5 ? "deterioro" : "estancamiento";

    const reportData: RangeReportData = {
      from: fromParam,
      to: toParam,
      scope,
      months: monthSnapshots,
      aggregated: {
        teamSummary: {
          avgCumplimiento,
          avgCargaPct,
          totalCompletedTasks: allTasks.filter((t) => t.status === "COMPLETADA").length,
          totalTasks: allTasks.length,
          totalCargaRealHours,
          totalCargaBaseHours,
          totalConsultas: allActivities.length,
          cargaRangeMin: Math.round(lastMonthBizInfo.limitBaseHours * 100) / 100,
          cargaRangeMax: cargaRangeLastMonth.max,
        },
        members: aggregatedMembers,
        ranking,
        consultasByReason,
        alerts,
        problematicMonths,
      },
      trends: { cumplimientoTrend, cumplimientoChange, firstMonthAvgCumplimiento, lastMonthAvgCumplimiento },
      aiAnalysis: "",
    };

    const aiAnalysis = await buildRangeAiAnalysis(reportData);
    reportData.aiAnalysis = aiAnalysis;

    return NextResponse.json({ report: reportData });
  } catch (err) {
    console.error("[GET /api/reports/range]", err);
    return NextResponse.json({ error: "Error al generar el informe de rango" }, { status: 500 });
  }
}
