import "server-only";
import { prisma } from "@/lib/prisma";
import { monthlyBusinessBaseForUsers, computeWorkloadRange, computeWorkloadPct } from "@/lib/workload";
import { businessDayRealRange } from "@/lib/businessTime";
import { computeCompletedPctAny } from "@/lib/analytics";
import type { WorkloadLabel } from "@/components/kpis/types";

/**
 * Motor de interpretación de Informes Ejecutivos (Sprint Reportes
 * Ejecutivos 2.0) — capa de composición sobre datos ya calculados por
 * `analytics.ts` (Cumplimiento/Carga/etc.) y `workload.ts`. NUNCA recalcula
 * un KPI ni usa IA: cada función de aquí es una regla fija sobre números
 * que otro módulo ya produjo. Mismo principio que `insightsEngine.ts`,
 * pero a nivel de reporte de equipo consolidado, no de indicador
 * individual. El "Análisis IA" (Groq) del reporte es un módulo aparte,
 * independiente de este — ver `docs/DECISIONS.md` § Sprint Reportes
 * Ejecutivos 2.0.
 */

// ── Bloque 11 — Índice Ejecutivo del Equipo ─────────────────────────────────
// Promedio simple de Performance Score + Equilibrio Operativo por miembro,
// ya promediados por el caller — este archivo solo clasifica el resultado.
// Solo tiene sentido para el mes calendario en curso (Equilibrio Operativo
// incluye Capacidad Futura, una proyección hacia adelante desde "ahora";
// recalcularla para un mes pasado no es representativo) — el caller decide
// cuándo invocar esto, ver `reports/generate/route.ts`.

export type IndiceEjecutivoNivel = "Excelente" | "Bueno" | "Atención" | "Crítico";
export type IndiceEjecutivoResult = {
  valor: number;
  nivel: IndiceEjecutivoNivel;
  color: "green" | "yellow" | "red";
  explicacion: string;
};

export function classifyIndiceEjecutivo(avgPerformance: number, avgEquilibrio: number): IndiceEjecutivoResult {
  const valor = Math.round(((avgPerformance + avgEquilibrio) / 2) * 10) / 10;
  if (valor >= 85) {
    return { valor, nivel: "Excelente", color: "green", explicacion: "El equipo mantiene un desempeño y equilibrio operativo sobresalientes. Puede asumir nuevos proyectos sin riesgo." };
  }
  if (valor >= 70) {
    return { valor, nivel: "Bueno", color: "green", explicacion: "El equipo opera de forma saludable, con desempeño y equilibrio dentro de rangos aceptables." };
  }
  if (valor >= 50) {
    return { valor, nivel: "Atención", color: "yellow", explicacion: "El equipo muestra señales que conviene atender antes de que se conviertan en un problema operativo mayor." };
  }
  return { valor, nivel: "Crítico", color: "red", explicacion: "El equipo requiere intervención inmediata — el desempeño y/o el equilibrio operativo están comprometidos." };
}

// ── Bloque 9 — Tendencias (mes anterior / trimestre / semestre) ────────────
// Snapshots mensuales livianos (cumplimiento/carga/consultas, vía
// computeSimpleScore-equivalentes ya seguros para meses pasados — nada
// forward-looking) para las 3 tarjetas comparativas del Resumen Ejecutivo.
// Solo se usa desde el informe de UN mes (`reports/generate`) — el informe
// de rango ya expone su propia evolución mes a mes (`months[]`), no
// necesita esto.

export type TeamMonthlyPoint = {
  month: string;
  label: string;
  avgCumplimiento: number;
  avgCargaPct: number;
  totalConsultas: number;
  totalTasks: number;
};

function monthBoundsUtil(year: number, month: number) {
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 0, 23, 59, 59, 999);
  return { start, end };
}

function monthLabelShort(year: number, month: number) {
  return new Date(year, month - 1, 1).toLocaleDateString("es-CL", { month: "short", year: "2-digit" });
}

/** Construye hasta `monthsBack + 1` snapshots mensuales (el mes `endYear/endMonth` incluido, más los `monthsBack` anteriores), en una sola tanda de queries. */
export async function computeTeamMonthlySnapshots(
  userIds: string[],
  endYear: number,
  endMonth: number,
  monthsBack: number,
): Promise<TeamMonthlyPoint[]> {
  if (userIds.length === 0) return [];

  const months = Array.from({ length: monthsBack + 1 }, (_, i) => {
    const d = new Date(endYear, endMonth - 1 - (monthsBack - i), 1);
    return { year: d.getFullYear(), month: d.getMonth() + 1 };
  });

  const rangeStart = monthBoundsUtil(months[0].year, months[0].month).start;
  const rangeEnd = monthBoundsUtil(months[months.length - 1].year, months[months.length - 1].month).end;

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

  const [allTasks, allActivities, fijaTasksForCarga, activitiesForCarga] = await Promise.all([
    prisma.task.findMany({
      where: { assignedToId: { in: userIds }, endDate: { gte: rangeStart, lte: rangeEnd } },
      select: { assignedToId: true, status: true, endDate: true },
    }),
    prisma.taskActivity.findMany({
      where: { authorId: { in: userIds }, createdAt: { gte: rangeStart, lte: rangeEnd }, task: { type: "SEGUIMIENTO" } },
      select: { authorId: true, createdAt: true },
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

  function bizForUser(bizInfo: (typeof monthBusinessInfo)[number], userId: string) {
    return bizInfo.perUser.get(userId) ?? bizInfo;
  }

  return monthBusinessInfo.map((bizInfo) => {
    const { start, end } = monthBoundsUtil(bizInfo.year, bizInfo.month);
    const monthTasks = allTasks.filter((t) => t.endDate >= start && t.endDate <= end);
    const monthActs = allActivities.filter((a) => a.createdAt >= start && a.createdAt <= end);
    const monthFija = fijaTasksForCarga.filter((t) => t.completedAt! >= bizInfo.realStart && t.completedAt! <= bizInfo.realEnd);
    const monthCargaActs = activitiesForCarga.filter((a) => a.createdAt >= bizInfo.realStart && a.createdAt <= bizInfo.realEnd);

    const memberStats = userIds.map((userId) => {
      const tasks = monthTasks.filter((t) => t.assignedToId === userId);
      const completedPct = computeCompletedPctAny(tasks);
      const fijaHours = monthFija.filter((t) => t.assignedToId === userId).reduce((s, t) => s + t.realHours, 0);
      const activityHours = monthCargaActs.filter((a) => a.authorId === userId).reduce((s, a) => s + a.duration, 0) / 60;
      const cargaRealHours = Math.round((fijaHours + activityHours) * 100) / 100;
      const userBiz = bizForUser(bizInfo, userId);
      const cargaRange = computeWorkloadRange(cargaRealHours, userBiz.limitBaseHours, userBiz.limitLowHours, userBiz.limitHighHours, userBiz.limitOverloadHours);
      const cargaPct = computeWorkloadPct(cargaRealHours, userBiz.limitBaseHours, cargaRange.max);
      return { completedPct, cargaPct, totalTasks: tasks.length };
    });

    const activeMembers = memberStats.filter((m) => m.totalTasks > 0);
    const avgCumplimiento = activeMembers.length > 0 ? Math.round(activeMembers.reduce((s, m) => s + m.completedPct, 0) / activeMembers.length) : 0;
    const avgCargaPct = memberStats.length > 0 ? Math.round(memberStats.reduce((s, m) => s + m.cargaPct, 0) / memberStats.length) : 0;

    return {
      month: `${bizInfo.year}-${String(bizInfo.month).padStart(2, "0")}`,
      label: monthLabelShort(bizInfo.year, bizInfo.month),
      avgCumplimiento,
      avgCargaPct,
      totalConsultas: monthActs.length,
      totalTasks: monthTasks.length,
    };
  });
}

export type TrendComparison = {
  label: string;
  currentValue: number;
  compareValue: number | null;
  delta: number | null;
  direction: "mejora" | "deterioro" | "estable" | "sin-datos";
};

function classifyDelta(delta: number): "mejora" | "deterioro" | "estable" {
  if (delta >= 5) return "mejora";
  if (delta <= -5) return "deterioro";
  return "estable";
}

/** A partir de los snapshots (más antiguo → más reciente, el último es el mes del informe), arma las 3 comparaciones del Bloque 9. */
export function computeTrendComparisons(points: TeamMonthlyPoint[]): { mesAnterior: TrendComparison; trimestre: TrendComparison; semestre: TrendComparison } {
  const current = points[points.length - 1];
  const currentValue = current?.avgCumplimiento ?? 0;

  function comparisonFrom(label: string, window: TeamMonthlyPoint[]): TrendComparison {
    const withData = window.filter((p) => p.totalTasks > 0);
    if (withData.length === 0) return { label, currentValue, compareValue: null, delta: null, direction: "sin-datos" };
    const compareValue = Math.round(withData.reduce((s, p) => s + p.avgCumplimiento, 0) / withData.length);
    const delta = currentValue - compareValue;
    return { label, currentValue, compareValue, delta, direction: classifyDelta(delta) };
  }

  const priorMonths = points.slice(0, -1); // todo lo anterior al mes actual, más antiguo primero
  const mesAnterior = comparisonFrom("Mes anterior", priorMonths.slice(-1));
  const trimestre = comparisonFrom("Trimestre (prom. 3 meses)", priorMonths.slice(-3));
  const semestre = comparisonFrom("Semestre (prom. 6 meses)", priorMonths.slice(-6));
  return { mesAnterior, trimestre, semestre };
}

// ── Bloque 8 — Mapa de Riesgo (Cumplimiento vs Carga) ───────────────────────

export type RiskQuadrant = "criticos" | "atencion-carga" | "atencion-cumplimiento" | "saludables";
export type RiskQuadrantPoint<T extends { completedPct: number; cargaPct: number }> = T & { quadrant: RiskQuadrant };

export const RISK_QUADRANT_LABEL: Record<RiskQuadrant, string> = {
  criticos: "Crítico — bajo cumplimiento y sobrecarga",
  "atencion-carga": "Atención — sobrecarga con cumplimiento aceptable",
  "atencion-cumplimiento": "Atención — bajo cumplimiento sin sobrecarga",
  saludables: "Saludable — cumplimiento y carga dentro de rango",
};

/** Umbrales del mapa: cumplimiento <60% = bajo; carga >100% del rango óptimo = sobrecarga relativa (mismo umbral que usan las alertas ya existentes del reporte). */
export function computeRiskQuadrant<T extends { completedPct: number; cargaPct: number }>(members: T[]): RiskQuadrantPoint<T>[] {
  return members.map((m) => {
    const lowCumplimiento = m.completedPct < 60;
    const highCarga = m.cargaPct > 100;
    let quadrant: RiskQuadrant;
    if (lowCumplimiento && highCarga) quadrant = "criticos";
    else if (highCarga) quadrant = "atencion-carga";
    else if (lowCumplimiento) quadrant = "atencion-cumplimiento";
    else quadrant = "saludables";
    return { ...m, quadrant };
  });
}

// ── Bloque 6 — Distribución por Motivo (con %, tendencia e interpretación) ──

/** Pistas de negocio por motivo conocido (catálogo por defecto del seed) — motivos personalizados creados en Ajustes usan el texto genérico. */
const REASON_HINT: Record<string, string> = {
  NOVEDADES_PAGO: "puede indicar un incremento en ajustes de nómina o mayor demanda operativa",
  RETENCION_PAGO: "puede reflejar casos de retención salarial que requieren seguimiento legal/administrativo",
  FACTURAS: "puede indicar mayor volumen de gestión documental con proveedores o colaboradores",
  CONSULTA_OPERACIONES: "sugiere una mayor necesidad de soporte operativo del equipo",
  SOLICITUD_VACACIONES: "es esperable en períodos de alta demanda de vacaciones",
  SOLICITUD_PERMISO: "puede indicar mayor ausentismo planificado en el período",
  VISITA_DOMICILIARIA: "refleja actividad de campo — puede impactar la disponibilidad de quienes las realizan",
  SEGUIMIENTO_AUSENTISMOS: "sugiere mayor necesidad de gestión de ausentismos en el período",
  RECLUTAMIENTO_SELECCION: "puede indicar apertura de nuevas vacantes o procesos de selección activos",
  SEGUIMIENTO_DOCUMENTACION: "puede indicar pendientes documentales acumulados que requieren cierre",
  SOLICITUDES_INTERNAS: "sugiere mayor demanda de gestión interna del equipo",
};

export function explainMotivoDistribution(reasonKey: string, label: string, pctOfTotal: number, trendPct: number | null): string {
  const hint = REASON_HINT[reasonKey];
  let text = `${label} representa el ${pctOfTotal}% de las consultas del período`;
  text += pctOfTotal >= 30 ? ", convirtiéndose en el principal motivo de gestión del equipo." : ".";
  if (hint) text += ` Esto ${hint}.`;
  if (trendPct !== null) {
    if (trendPct >= 20) text += ` Aumentó ${trendPct}% respecto al período anterior.`;
    else if (trendPct <= -20) text += ` Disminuyó ${Math.abs(trendPct)}% respecto al período anterior.`;
  }
  return text;
}

// ── Bloque 2 — Hallazgos Automáticos y Bloque 3 — Recomendaciones ──────────

export type Finding = { text: string; tone: "positive" | "risk" | "neutral" };
export type Recommendation = { text: string; priority: "alta" | "media" };

export type ReportInsightMember = {
  name: string;
  cargaLabel: WorkloadLabel;
  completedPct: number;
  overdueCount: number;
};

/** Reglas fijas sobre datos ya calculados por el reporte — ninguna generada por IA (Bloque 2, "generar automáticamente"). */
export function computeFindings(input: {
  avgCumplimiento: number;
  avgCumplimientoDelta: number | null;
  members: ReportInsightMember[];
  totalOverdue: number;
  topReason: { label: string; pct: number } | null;
}): Finding[] {
  const findings: Finding[] = [];

  if (input.avgCumplimientoDelta !== null) {
    const d = input.avgCumplimientoDelta;
    if (d >= 3) findings.push({ text: `El cumplimiento del equipo aumentó ${d} puntos porcentuales respecto al mes anterior.`, tone: "positive" });
    else if (d <= -3) findings.push({ text: `El cumplimiento del equipo disminuyó ${Math.abs(d)} puntos porcentuales respecto al mes anterior.`, tone: "risk" });
  }

  const subutilizados = input.members.filter((m) => m.cargaLabel === "Subutilización");
  const sobrecargados = input.members.filter((m) => m.cargaLabel === "Sobrecarga");
  if (subutilizados.length > 0) {
    findings.push({ text: `Existen ${subutilizados.length} colaborador(es) subutilizados: ${subutilizados.map((m) => m.name).join(", ")}.`, tone: "neutral" });
  }
  if (sobrecargados.length > 0) {
    findings.push({ text: `Existen ${sobrecargados.length} colaborador(es) en sobrecarga: ${sobrecargados.map((m) => m.name).join(", ")}.`, tone: "risk" });
  } else {
    findings.push({ text: "La carga general del equipo es adecuada — nadie está en sobrecarga este período.", tone: "positive" });
  }

  if (input.totalOverdue === 0) {
    findings.push({ text: "No existen tareas vencidas en el equipo este período.", tone: "positive" });
  } else {
    findings.push({ text: `Existen ${input.totalOverdue} tarea(s) vencida(s) en el equipo.`, tone: "risk" });
  }

  if (input.topReason && input.topReason.pct >= 30) {
    findings.push({ text: `"${input.topReason.label}" concentra el ${input.topReason.pct}% de las consultas del período.`, tone: "neutral" });
  }

  return findings;
}

/** Reglas fijas, no IA (Bloque 3 lo exige explícitamente) — cada recomendación nace de una condición concreta ya presente en `computeFindings`. */
export function computeRecommendations(input: {
  avgCumplimiento: number;
  members: ReportInsightMember[];
  topReason: { label: string; pct: number } | null;
}): Recommendation[] {
  const recs: Recommendation[] = [];
  const subutilizados = input.members.filter((m) => m.cargaLabel === "Subutilización");
  const sobrecargados = input.members.filter((m) => m.cargaLabel === "Sobrecarga");
  const bajoCumplimiento = input.members.filter((m) => m.completedPct < 60);

  if (sobrecargados.length > 0 && subutilizados.length > 0) {
    recs.push({ text: `Redistribuir carga: ${sobrecargados.map((m) => m.name).join(", ")} está(n) en sobrecarga mientras ${subutilizados.map((m) => m.name).join(", ")} tiene(n) capacidad disponible.`, priority: "alta" });
  } else if (sobrecargados.length > 0) {
    recs.push({ text: `Redistribuir carga de ${sobrecargados.map((m) => m.name).join(", ")} hacia colaboradores con capacidad disponible.`, priority: "alta" });
  }

  if (bajoCumplimiento.length > 0) {
    recs.push({ text: `Revisar proyectos/tareas de ${bajoCumplimiento.map((m) => m.name).join(", ")} — cumplimiento por debajo del 60%.`, priority: "alta" });
  }

  if (input.topReason && input.topReason.pct >= 30) {
    recs.push({ text: `Evaluar capacitar o reforzar el proceso de "${input.topReason.label}" — concentra ${input.topReason.pct}% de las consultas del equipo.`, priority: "media" });
  }

  if (sobrecargados.length === 0 && bajoCumplimiento.length === 0 && input.avgCumplimiento >= 80) {
    recs.push({ text: "Mantener la planificación actual — los indicadores del equipo están dentro de rangos saludables.", priority: "media" });
  }

  return recs;
}

// ── Bloque 10 — Insights ────────────────────────────────────────────────────

export function computeTeamInsights(input: {
  members: Array<{ name: string; cargaRealHours: number }>;
  totalCargaRealHours: number;
  healthByMember?: Array<{ name: string; score: number }>;
  variableConsistencyMembers?: string[];
}): string[] {
  const insights: string[] = [];

  if (input.totalCargaRealHours > 0 && input.members.length > 0) {
    const top = [...input.members].sort((a, b) => b.cargaRealHours - a.cargaRealHours)[0];
    const pct = Math.round((top.cargaRealHours / input.totalCargaRealHours) * 100);
    if (pct >= 20) insights.push(`${top.name} concentró el ${pct}% del tiempo ejecutado por el equipo este período.`);
  }

  if (input.healthByMember && input.healthByMember.length > 0) {
    const best = [...input.healthByMember].sort((a, b) => b.score - a.score)[0];
    insights.push(`${best.name} mantiene el mayor Equilibrio Operativo del equipo (${best.score}/100).`);
  }

  for (const name of (input.variableConsistencyMembers ?? []).slice(0, 2)) {
    insights.push(`${name} presenta variaciones importantes entre semanas.`);
  }

  return insights;
}

// ── Bloque 5 — Interpretación por indicador (qué significa/por qué/impacto/acción) ──

export type IndicatorExplanation = { meaning: string; why: string; impact: string; action: string };

export function explainCumplimientoIndicator(pct: number, memberCount: number): IndicatorExplanation {
  return {
    meaning: "Porcentaje de tareas del equipo cerradas como Completada sobre el total del período.",
    why: pct >= 80
      ? `El ${pct}% de las tareas de los ${memberCount} colaboradores incluidos se completaron en el período.`
      : `Solo el ${pct}% de las tareas del equipo se completaron — por debajo del objetivo mínimo del 60%.`,
    impact: pct >= 80 ? "El equipo mantiene su capacidad de respuesta y compromisos al día." : "Los pendientes acumulados pueden derivar en retrasos operativos si la tendencia continúa.",
    action: pct >= 80 ? "Mantener el ritmo actual de cierre de tareas." : "Priorizar el cierre de tareas próximas a vencer y revisar la carga de quienes están por debajo del objetivo.",
  };
}

export function explainCargaIndicator(pct: number): IndicatorExplanation {
  return {
    meaning: "Porcentaje de horas reales registradas por el equipo frente a su base laboral esperada del período.",
    why: pct > 100
      ? `El equipo registró ${pct}% de su base laboral — por encima del rango óptimo.`
      : `El equipo registró ${pct}% de su base laboral, dentro o por debajo del rango esperado.`,
    impact: pct > 100 ? "Una carga sostenida por encima del rango óptimo eleva el riesgo de sobrecarga y desgaste." : "La carga del equipo no representa un riesgo operativo inmediato.",
    action: pct > 100 ? "Redistribuir tareas hacia colaboradores con capacidad disponible." : "Sin acción requerida — monitorear en el próximo período.",
  };
}

export function explainConsultasIndicator(total: number, prevTotal: number | null): IndicatorExplanation {
  const deltaPct = prevTotal && prevTotal > 0 ? Math.round(((total - prevTotal) / prevTotal) * 100) : null;
  return {
    meaning: "Total de consultas (actividades tipo Seguimiento) atendidas por el equipo en el período.",
    why: deltaPct === null
      ? `El equipo atendió ${total} consultas en el período.`
      : `El equipo atendió ${total} consultas, ${deltaPct >= 0 ? "un " + deltaPct + "% más" : "un " + Math.abs(deltaPct) + "% menos"} que en el período anterior.`,
    impact: deltaPct !== null && deltaPct >= 30 ? "Un aumento sostenido de consultas puede requerir más capacidad operativa dedicada a atención." : "El volumen de consultas se mantiene dentro de lo gestionable por el equipo.",
    action: deltaPct !== null && deltaPct >= 30 ? "Evaluar si el aumento requiere reforzar el equipo o ajustar procesos." : "Sin acción requerida — monitorear en el próximo período.",
  };
}
