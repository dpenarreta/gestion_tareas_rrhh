// Executive Reporting Engine 2.0 — único lugar donde se CONSTRUYE el objeto
// de dominio `ExecutiveReportSnapshotData` (ver snapshotData.ts) para cada
// uno de los 3 tipos de reporte. Las fórmulas de aquí son EXACTAMENTE las que
// ya vivían, duplicadas, en los 3 endpoints (`reports/generate`,
// `reports/range`, `reports/custom-range`) — este módulo las reubica, no las
// reinventa: cero cambios de cálculo (FPS Parte I §5 — este Sprint no toca
// Analytics ni fórmulas). Lo nuevo, exigido por el FPS y no presente antes en
// ninguno de los 3 endpoints: `computeDataQuality` (Parte IV §11), estado de
// período (Parte IV §6), fecha de corte real (Parte IV §5), Report ID y
// metadatos de trazabilidad completos generados aquí mismo (Parte IV §3/§4/
// §9/§10), e inmutabilidad en tiempo de ejecución (Object.freeze profundo).
//
// ── Integridad (FPS Parte IV §15) ────────────────────────────────────────────
// El FPS exige que los valores del reporte coincidan exactamente con
// Dashboard/Analytics para la misma fecha de corte, y que una discrepancia
// quede registrada como incidente. Este builder resuelve la causa RAÍZ del
// problema (antes de la Fase B, el reporte de equipo recalculaba KPIs con
// consultas Prisma propias en vez de llamar a analytics.ts — la fuente real
// de discrepancias históricas): todo cálculo pasa por las mismas funciones
// canónicas que Dashboard/Analytics ya usan (computeHealthScore,
// computePerformanceScore, computeDataQuality, etc.) — dos superficies no
// pueden divergir si comparten la misma función. Lo que NO existe todavía es
// un mecanismo de validación EN TIEMPO DE EJECUCIÓN que vuelva a consultar
// Dashboard/Analytics al momento de generar y compare/registre una
// discrepancia puntual — sería una funcionalidad nueva (qué comparar, con
// qué tolerancia, dónde registrar el incidente), no una corrección de este
// builder. Decisión explícita, no un olvido — ver docs/AUDIT_LOG.md § FPS
// Parte IV.
//
// ── Fecha de corte (FPS Parte IV §5) ─────────────────────────────────────────
// `filters.fechaCorte` acota qué información entra al cálculo. Se aplica en
// dos frentes:
//   1. Consultas/carga real (TaskActivity.createdAt, Task.completedAt de
//      tareas FIJA) — se acota directamente el límite superior de la
//      consulta: son campos con marca de tiempo real, sin ambigüedad.
//   2. Estado de cumplimiento de una tarea — NEXO no lleva historial de
//      status por tarea (solo el status ACTUAL en Task.status), así que se
//      reconstruye de forma aproximada vía `asOfFechaCorte`: una tarea
//      marcada COMPLETADA cuyo `completedAt` es POSTERIOR a la fecha de
//      corte se trata como si aún no estuviera completada para este
//      snapshot (no sabemos cuál era su status real en ese instante, así que
//      se asume el más conservador). Es una vista de solo lectura para este
//      cálculo — nunca se persiste ni modifica la tarea real.
// Cuando `fechaCorte` no viene informado, el corte por defecto reproduce
// EXACTAMENTE el comportamiento histórico (fin de período o "ahora", lo que
// sea anterior) — cero cambio para los llamadores que aún no exponen un
// selector de fecha de corte.
//
// Funciones que YA aceptan un `now`/instante de referencia (computeHealthScore,
// computePerformanceScore) reciben el corte ahí — no se modifica su firma ni
// su fórmula. `computeDataQuality` y `computeTeamMonthlySnapshots` (tendencias)
// no aceptan ese parámetro hoy; extenderlas queda fuera de este Sprint (no se
// toca `analytics.ts`/`reportInsights.ts`) — quedan documentadas como
// limitación conocida: se evalúan sobre el estado actual, no "a la fecha de
// corte".
import { prisma } from "@/lib/prisma";
import { isTaskOverdue } from "@/lib/utils";
import {
  monthlyBusinessBase,
  monthlyBusinessBaseForUsers,
  businessBaseForRange,
  computeWorkloadRange,
  computeWorkloadPct,
} from "@/lib/workload";
import { businessDayRealRange } from "@/lib/businessTime";
import { getActivityReasonLabelMap } from "@/lib/activityReasons";
import {
  computeSimpleScore,
  computeEstimatedVsRealRatio,
  computeCompletedPctAny,
  cached,
  computeHealthScore,
  computePerformanceScore,
  computeDataQuality,
} from "@/lib/analytics";
import { getEffectiveAnalyticsConfig } from "@/lib/systemConfig";
import {
  classifyIndiceEjecutivo,
  computeTeamMonthlySnapshots,
  computeTrendComparisons,
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
import { computeCumplimientoProjection, computeSobrecargaProbability, computeSubutilizacionPredictions, type PredictionHorizon } from "@/lib/predictionEngine";
import { generateReportId } from "./reportId";
import { currentExecutiveReportVersions } from "./version";
import { resolveMonthlyPeriodStatus, resolveCustomRangePeriodStatus } from "./periodStatus";
import { deriveExecutiveReportContext } from "./context";
import { generateExecutiveNarrative } from "./nova/generateNarrative";
import { logReportAudit } from "./snapshotStore";
import type { ExecutiveReportFilters, ExecutiveReportPeriodFilter } from "./filters";
import type { ResolvedReportRoster } from "./resolveRoster";
import type { ExecutiveReportSnapshotData, SnapshotTeamAlert, SnapshotGeneratedBy, SnapshotPredictivo, SnapshotPredictiveMember } from "./snapshotData";
import type { IndiceEjecutivoData, MotivoDistributionItem, MonthSnapshot, ReportMemberKpi } from "@/components/kpis/types";

function monthBounds(year: number, month: number) {
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 0, 23, 59, 59, 999);
  return { start, end };
}

function monthLabelEs(year: number, month: number): string {
  return new Date(year, month - 1, 1).toLocaleDateString("es-CL", { month: "long", year: "numeric" });
}

function monthLabelFromKey(monthStr: string): string {
  const [y, mo] = monthStr.split("-").map(Number);
  return monthLabelEs(y, mo);
}

function getMonthsInRange(from: string, to: string): string[] {
  const months: string[] = [];
  let [y, m] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    months.push(`${y}-${String(m).padStart(2, "0")}`);
    if (++m > 12) {
      m = 1;
      y++;
    }
  }
  return months;
}

/** Menor de dos instantes. */
function earlier(a: Date, b: Date): Date {
  return a.getTime() < b.getTime() ? a : b;
}

/**
 * Vista "a la fecha de corte" del estado de cumplimiento de una tarea — ver
 * nota de módulo. Nunca escribe en BD; es una transformación de solo lectura
 * sobre el arreglo ya obtenido, aplicada antes de cualquier cómputo aguas abajo.
 */
function asOfFechaCorte<T extends { status: string; completedAt: Date | null }>(tasks: T[], cutoff: Date): T[] {
  return tasks.map((t) => (t.status === "COMPLETADA" && t.completedAt && t.completedAt.getTime() > cutoff.getTime() ? { ...t, status: "PENDIENTE" } : t));
}

/**
 * FPS Parte II § Analytics Predictivo — integración visual del motor YA
 * EXISTENTE (predictionEngine.ts, por colaborador), sin fórmulas nuevas ni
 * motor de escenarios de equipo. Extraída como función independiente
 * (Parte IV §8) para poder correr en PARALELO con el cómputo de Índice
 * Ejecutivo — ambas son independientes entre sí; antes se esperaban una
 * tras otra, casi duplicando el tiempo de generación del mes en curso.
 */
async function buildPredictivoForCurrentMonth(userIds: string[], members: ReportMemberKpi[], cutoff: Date, cacheTtlMinutes: number): Promise<SnapshotPredictivo> {
  // cached() — mismo patrón/TTL que perf-bench/equilibrio-bench: no acorta la
  // primera generación (miss real), pero evita recalcular en regeneraciones
  // dentro de la ventana de caché (antes, estas 2 llamadas eran las únicas de
  // la rama sin caché — ver hallazgo de rendimiento, FPS Parte IV §8).
  const [cumplimientoResults, sobrecargaResults, subutilizacionMap] = await Promise.all([
    Promise.all(userIds.map((id) => cached(`cumplimiento-proj:${id}`, cacheTtlMinutes, () => computeCumplimientoProjection(id, cutoff)).then((r) => r.value))),
    Promise.all(userIds.map((id) => cached(`sobrecarga-prob:${id}`, cacheTtlMinutes, () => computeSobrecargaProbability(id, cutoff)).then((r) => r.value))),
    computeSubutilizacionPredictions(userIds, cutoff),
  ]);

  const predictiveMembers: SnapshotPredictiveMember[] = userIds.map((id, i) => {
    const member = members.find((m) => m.id === id);
    const cumplimientoResult = cumplimientoResults[i];
    const sobrecargaResult = sobrecargaResults[i];
    const subutilizacionResult = subutilizacionMap.get(id);
    return {
      id,
      name: member?.name ?? id,
      cumplimiento: cumplimientoResult.available
        ? { available: true, queOcurrira: cumplimientoResult.queOcurrira, porQue: cumplimientoResult.porQue, queHacer: cumplimientoResult.queHacer, confidencePct: cumplimientoResult.confidencePct }
        : { available: false, queOcurrira: cumplimientoResult.reason, porQue: "", queHacer: [], confidencePct: 0 },
      sobrecarga: sobrecargaResult.available
        ? { available: true, queOcurrira: sobrecargaResult.queOcurrira, porQue: sobrecargaResult.porQue, nivel: sobrecargaResult.nivel, queHacer: sobrecargaResult.queHacer, confidencePct: sobrecargaResult.confidencePct }
        : { available: false, queOcurrira: sobrecargaResult.reason, porQue: "", nivel: "Bajo", queHacer: [], confidencePct: 0 },
      subutilizacion: subutilizacionResult ? { nivel: subutilizacionResult.nivel, queOcurrira: subutilizacionResult.queOcurrira, queHacer: subutilizacionResult.queHacer } : null,
    };
  });

  const validCumplimientoPct: number[] = [];
  let representativeHorizon: PredictionHorizon | null = null;
  for (const r of cumplimientoResults) {
    if (r.available) {
      validCumplimientoPct.push(r.cumplimientoEsperadoCierrePct);
      if (representativeHorizon === null) representativeHorizon = r.horizon;
    }
  }
  if (representativeHorizon === null) {
    for (const r of sobrecargaResults) {
      if (r.available) {
        representativeHorizon = r.horizon;
        break;
      }
    }
  }
  const membersAtRiskSobrecarga = sobrecargaResults.filter((r) => r.available && r.nivel === "Alto").length;

  return {
    asOf: cutoff.toISOString(),
    horizonDays: representativeHorizon ?? 30,
    membersAtRiskSobrecarga,
    avgCumplimientoEsperadoCierrePct: validCumplimientoPct.length > 0 ? Math.round(validCumplimientoPct.reduce((s, v) => s + v, 0) / validCumplimientoPct.length) : null,
    members: predictiveMembers,
  };
}

/**
 * Genera la narrativa NOVA (Fase C) a partir del snapshot YA COMPLETO (sin
 * `nova`/`novaDegraded` aún) y la adjunta in-place — el snapshot sigue siendo
 * mutable en este punto, se congela recién en el `return deepFreeze(result)`
 * de cada builder. Si cualquier sección degradó a fallback determinista,
 * queda auditado (best-effort, nunca bloquea) vía `logReportAudit` — nunca
 * lanza ni impide que la generación continúe (FPS Parte IV §8).
 */
async function attachNovaNarrative(result: ExecutiveReportSnapshotData, generatedBy: SnapshotGeneratedBy): Promise<void> {
  const context = deriveExecutiveReportContext(result);
  const narrative = await generateExecutiveNarrative(context);
  result.nova = narrative.sections;
  result.novaDegraded = narrative.degraded;
  if (narrative.degraded) {
    await logReportAudit({
      reportId: result.meta.reportId,
      action: "nova_degraded",
      userId: generatedBy.userId,
      step: "nova",
      message: `Secciones degradadas a fallback determinista: ${narrative.degradedSections.join(", ")}`,
    });
  }
}

/** Congela profundamente el snapshot antes de devolverlo — ningún consumidor puede modificar su contenido (FPS Parte IV §2). */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.getOwnPropertyNames(value as object)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
  }
  return value;
}

type BaseBuildParams = {
  roster: ResolvedReportRoster;
  generatedBy: SnapshotGeneratedBy;
  /** Instante real ("ahora") — distinto de la fecha de corte efectiva, que nunca puede superarlo. */
  now?: Date;
};

// ── MENSUAL ──────────────────────────────────────────────────────────────────

export type BuildMonthlySnapshotDataParams = BaseBuildParams & {
  filters: ExecutiveReportFilters & { periodo: Extract<ExecutiveReportPeriodFilter, { tipoReporte: "MENSUAL" }> };
};

export async function buildMonthlySnapshotData(params: BuildMonthlySnapshotDataParams): Promise<ExecutiveReportSnapshotData> {
  const t0 = Date.now();
  const { roster, filters, generatedBy } = params;
  const now = params.now ?? new Date();
  const { month, year } = filters.periodo;
  const { users, userIds, scope, rosterKind } = roster;
  const { start, end } = monthBounds(year, month);
  const cutoff = filters.fechaCorte ? earlier(filters.fechaCorte, now) : earlier(end, now);
  const dataUpperBound = earlier(end, cutoff);

  const {
    start: cargaStart,
    end: cargaEnd,
    hoursPerDay,
    limitLowPerDay,
    limitHighPerDay,
    limitOverloadPerDay,
    limitLowHours,
    limitHighHours,
    limitOverloadHours,
    baseHours: monthlyBaseHours,
  } = await monthlyBusinessBase(year, month);
  const { start: cargaRealStart } = businessDayRealRange(cargaStart);
  const { end: cargaRealEndRaw } = businessDayRealRange(cargaEnd);
  const cargaRealEnd = earlier(cargaRealEndRaw, cutoff);

  const effectiveBases = await computeEffectiveMemberBases(userIds, cargaStart, cargaEnd, hoursPerDay, limitLowPerDay, limitHighPerDay, limitOverloadPerDay);

  const [allTasksRaw, allActivities, fijaTasksForCarga, activitiesForCarga, dataQuality] = await Promise.all([
    prisma.task.findMany({
      where: { assignedToId: { in: userIds }, endDate: { gte: start, lte: end } },
      select: { assignedToId: true, createdById: true, status: true, endDate: true, progress: true, type: true, frequency: true, estimatedHours: true, realHours: true, completedAt: true },
    }),
    prisma.taskActivity.findMany({
      where: { authorId: { in: userIds }, createdAt: { gte: start, lte: dataUpperBound }, task: { type: "SEGUIMIENTO" } },
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
    computeDataQuality(userIds),
  ]);

  const allTasks = asOfFechaCorte(allTasksRaw, cutoff);
  const refDate = dataUpperBound;
  const recurringFreqs = ["MENSUAL", "SEMANAL", "DIARIA", "QUINCENAL"];

  const members: ReportMemberKpi[] = users.map((user) => {
    const tasks = allTasks.filter((t) => t.assignedToId === user.id);
    const completed = tasks.filter((t) => t.status === "COMPLETADA").length;
    const overdue = tasks.filter((t) => isTaskOverdue(t.endDate, t.status, refDate)).length;
    const completedPct = computeCompletedPctAny(tasks);

    const fijaHours = fijaTasksForCarga.filter((t) => t.assignedToId === user.id).reduce((s, t) => s + t.realHours, 0);
    const activityHours = activitiesForCarga.filter((a) => a.authorId === user.id).reduce((s, a) => s + a.duration, 0) / 60;
    const cargaRealHours = Math.round((fijaHours + activityHours) * 100) / 100;
    const userBase = effectiveBases.get(user.id)!;
    const userBaseHours = userBase.baseHours;
    const userLimitBaseHours = userBase.limitBaseHours;
    const userLimitLowHours = userBase.limitLowHours;
    const userLimitHighHours = userBase.limitHighHours;
    const userLimitOverloadHours = userBase.limitOverloadHours;
    const cargaRange = computeWorkloadRange(cargaRealHours, userLimitBaseHours, userLimitLowHours, userLimitHighHours, userLimitOverloadHours);
    const cargaPct = computeWorkloadPct(cargaRealHours, userLimitBaseHours, cargaRange.max);

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

    void recurringFreqs; // conservado por paridad con el endpoint original (recurringCompleted/recurringTotal no forman parte de ningún consumidor actual, ver docs/AUDIT_LOG.md § Executive Reporting Engine 2.0 Fase B).

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
      cargaRangeMin: Math.round(userLimitBaseHours * 100) / 100,
      cargaRangeMax: cargaRange.max,
      totalTasks: tasks.length,
      completedTasks: completed,
      overdueCount: overdue,
      seguimientoTotal: userActivities.length,
      byReason: Object.entries(byReasonMap).map(([reason, d]) => ({ reason, count: d.count, totalMinutes: d.totalMinutes })),
      baseWasProrated: userBase.wasProrated,
      baseEffectiveStart: userBase.wasProrated ? userBase.effectiveStart.toISOString() : undefined,
    };
  });

  const totalConsultas = allActivities.length;
  const totalTasks = allTasks.length;
  const totalCompletedTasks = allTasks.filter((t) => t.status === "COMPLETADA").length;
  const totalCargaRealHours = Math.round(members.reduce((s, m) => s + m.cargaRealHours, 0) * 100) / 100;
  const totalCargaBaseHours = Math.round(members.reduce((s, m) => s + m.cargaBaseHours, 0) * 100) / 100;
  const totalLimitBaseHours = members.reduce((s, m) => s + (effectiveBases.get(m.id)?.limitBaseHours ?? monthlyBaseHours), 0);
  const totalLimitLowHours = members.reduce((s, m) => s + (effectiveBases.get(m.id)?.limitLowHours ?? limitLowHours), 0);
  const totalLimitHighHours = members.reduce((s, m) => s + (effectiveBases.get(m.id)?.limitHighHours ?? limitHighHours), 0);
  const totalLimitOverloadHours = members.reduce((s, m) => s + (effectiveBases.get(m.id)?.limitOverloadHours ?? limitOverloadHours), 0);
  const teamCargaRange = computeWorkloadRange(totalCargaRealHours, totalLimitBaseHours, totalLimitLowHours, totalLimitHighHours, totalLimitOverloadHours);
  const avgCargaPct = computeWorkloadPct(totalCargaRealHours, totalLimitBaseHours, teamCargaRange.max);
  const avgCumplimiento = members.length > 0 ? Math.round(members.reduce((s, m) => s + m.completedPct, 0) / members.length) : 0;

  const teamReasonMap: Record<string, { count: number; totalMinutes: number }> = {};
  for (const act of allActivities) {
    if (!teamReasonMap[act.reason]) teamReasonMap[act.reason] = { count: 0, totalMinutes: 0 };
    teamReasonMap[act.reason].count++;
    teamReasonMap[act.reason].totalMinutes += act.duration;
  }

  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;
  const { start: prevStart, end: prevEnd } = monthBounds(prevYear, prevMonth);
  const prevActivities = await prisma.taskActivity.findMany({
    where: { authorId: { in: userIds }, createdAt: { gte: prevStart, lte: prevEnd }, task: { type: "SEGUIMIENTO" } },
    select: { reason: true },
  });
  const prevReasonCount: Record<string, number> = {};
  for (const act of prevActivities) prevReasonCount[act.reason] = (prevReasonCount[act.reason] ?? 0) + 1;
  const totalConsultasPrev = prevActivities.length;

  const reasonLabelMap = await getActivityReasonLabelMap();
  const consultasByReason: MotivoDistributionItem[] = Object.entries(teamReasonMap)
    .map(([reason, d]) => ({ reason, count: d.count, totalMinutes: d.totalMinutes }))
    .sort((a, b) => b.count - a.count);
  for (const item of consultasByReason) {
    const pct = totalConsultas > 0 ? Math.round((item.count / totalConsultas) * 100) : 0;
    const prevCount = prevReasonCount[item.reason];
    const trendPct = prevCount && prevCount > 0 ? Math.round(((item.count - prevCount) / prevCount) * 100) : null;
    item.pct = pct;
    item.trendPct = trendPct;
    item.interpretation = explainMotivoDistribution(item.reason, reasonLabelMap[item.reason] ?? item.reason, pct, trendPct);
  }

  const ranking = [...members]
    .sort((a, b) => b.score - a.score || b.completedPct - a.completedPct)
    .map(({ id, name, role, score, completedPct }) => ({ id, name, role, score, completedPct }));

  const alerts: SnapshotTeamAlert[] = [];
  for (const m of members) {
    if (m.completedPct < 60 && m.totalTasks > 0) alerts.push({ userId: m.id, name: m.name, type: "cumplimiento", value: m.completedPct });
    if (m.cargaLabel === "Sobrecarga") alerts.push({ userId: m.id, name: m.name, type: "sobrecarga", value: m.cargaPct });
  }

  const riskQuadrant = computeRiskQuadrant(members.map((m) => ({ id: m.id, name: m.name, completedPct: m.completedPct, cargaPct: m.cargaPct })));

  const teamSnapshots = await computeTeamMonthlySnapshots(userIds, year, month, 6);
  const trends = computeTrendComparisons(teamSnapshots);

  const isCurrentMonth = month === now.getMonth() + 1 && year === now.getFullYear();
  let indiceEjecutivo: IndiceEjecutivoData = null;
  let predictivo: SnapshotPredictivo = null;
  const variableConsistencyMembers: string[] = [];

  // Rendimiento (FPS Parte IV §8) — Índice Ejecutivo y Analytics Predictivo
  // son computaciones INDEPENDIENTES entre sí (ninguna necesita el resultado
  // de la otra); antes se esperaban una tras otra de forma secuencial, lo que
  // en un equipo real casi duplicaba el tiempo del mes en curso (medido:
  // ~22s, sobre el presupuesto de 15s de un reporte consolidado). Corren en
  // paralelo — mismas llamadas, mismas fórmulas, solo reordenadas.
  if (isCurrentMonth && userIds.length > 0) {
    // Config compartida por ambas ramas — antes se pedía dos veces (una por
    // rama, cuando corrían secuenciales); una sola vez ahora que corren en paralelo.
    const analyticsConfig = await getEffectiveAnalyticsConfig();
    const [indiceResult, predictivoResult] = await Promise.all([
      (async () => {
        const [perfResults, healthResults] = await Promise.all([
          Promise.all(userIds.map((id) => cached(`perf-bench:${id}`, analyticsConfig.cacheTtlMinutes, () => computePerformanceScore(id, cutoff)).then((r) => r.value))),
          Promise.all(userIds.map((id) => cached(`equilibrio-bench:${id}`, analyticsConfig.cacheTtlMinutes, () => computeHealthScore(id, cutoff)).then((r) => r.value))),
        ]);
        const avgPerformance = Math.round((perfResults.reduce((s, r) => s + r.score, 0) / perfResults.length) * 10) / 10;
        const avgEquilibrio = Math.round((healthResults.reduce((s, r) => s + r.score, 0) / healthResults.length) * 10) / 10;
        const classified = classifyIndiceEjecutivo(avgPerformance, avgEquilibrio);

        const prevReport = await prisma.monthlyReport.findUnique({ where: { month_year_scope: { month: prevMonth, year: prevYear, scope } } });
        const prevIndiceValor = (prevReport?.data as { indiceEjecutivo?: { valor: number } | null } | null)?.indiceEjecutivo?.valor;
        const variacion = typeof prevIndiceValor === "number" ? Math.round((classified.valor - prevIndiceValor) * 10) / 10 : null;

        return { indiceEjecutivo: { ...classified, avgPerformance, avgEquilibrio, variacion }, healthResults };
      })(),
      buildPredictivoForCurrentMonth(userIds, members, cutoff, analyticsConfig.cacheTtlMinutes),
    ]);

    indiceEjecutivo = indiceResult.indiceEjecutivo;
    predictivo = predictivoResult;

    userIds.forEach((id, i) => {
      const member = members.find((m) => m.id === id);
      if (member) member.equilibrioScore = indiceResult.healthResults[i].score;
      const consistenciaFactor = indiceResult.healthResults[i].factors.find((f) => f.name === "Consistencia");
      if (consistenciaFactor && (consistenciaFactor.rawLabel === "Variable" || consistenciaFactor.rawLabel === "Muy variable") && member) {
        variableConsistencyMembers.push(member.name);
      }
    });
  }

  for (const member of members) {
    member.estadoOperativo = deriveEstadoOperativo({
      completedPct: member.completedPct,
      cargaLabel: member.cargaLabel,
      overdueCount: member.overdueCount,
      equilibrioScore: member.equilibrioScore,
    });
    member.principalHallazgo = computePrincipalHallazgo({
      cargaLabel: member.cargaLabel,
      completedPct: member.completedPct,
      overdueCount: member.overdueCount,
      totalTasks: member.totalTasks,
      consistencyVariable: variableConsistencyMembers.includes(member.name),
    });
  }

  const topReason = consultasByReason[0] ? { label: reasonLabelMap[consultasByReason[0].reason] ?? consultasByReason[0].reason, pct: consultasByReason[0].pct ?? 0 } : null;
  const totalOverdue = members.reduce((s, m) => s + m.overdueCount, 0);
  const findings = computeFindings({ avgCumplimiento, avgCumplimientoDelta: trends.mesAnterior.delta, members, totalOverdue, topReason });
  const recommendations = computeRecommendations({ avgCumplimiento, members, topReason });
  const insights = computeTeamInsights({
    members,
    totalCargaRealHours,
    healthByMember: isCurrentMonth ? members.filter((m) => m.equilibrioScore !== undefined).map((m) => ({ name: m.name, score: m.equilibrioScore! })) : undefined,
    variableConsistencyMembers,
  });
  const indicatorExplanations = {
    cumplimiento: explainCumplimientoIndicator(avgCumplimiento, members.length),
    carga: explainCargaIndicator(avgCargaPct),
    consultas: explainConsultasIndicator(totalConsultas, totalConsultasPrev),
  };

  const cargaRangePerPerson = computeWorkloadRange(0, monthlyBaseHours, limitLowHours, limitHighHours, limitOverloadHours);
  const periodStatus = await resolveMonthlyPeriodStatus(month, year, now);

  const result: ExecutiveReportSnapshotData = {
    meta: {
      reportId: generateReportId(now),
      origin: "GENERATED",
      integrityFlag: "FULL",
      type: "MENSUAL",
      rosterKind,
      scope,
      periodLabel: monthLabelEs(year, month),
      periodStart: start.toISOString(),
      periodEnd: end.toISOString(),
      fechaCorte: cutoff.toISOString(),
      periodStatus,
      collaboratorIds: userIds,
      collaboratorCount: userIds.length,
      generatedBy,
      generatedAt: now.toISOString(),
      generationMs: Date.now() - t0,
      versions: currentExecutiveReportVersions(),
    },
    estadoGeneral: { indiceEjecutivo, dataQuality },
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
    distribuciones: { consultasByReason, riskQuadrant },
    trends,
    monthlyEvolution: null,
    rangeTrend: null,
    problematicMonths: null,
    findings,
    insights,
    indicatorExplanations,
    recommendations,
    alerts,
    predictivo,
    nova: null,
    novaDegraded: false,
  };
  await attachNovaNarrative(result, generatedBy);
  return deepFreeze(result);
}

// ── RANGO DE MESES ───────────────────────────────────────────────────────────

export type BuildRangeSnapshotDataParams = BaseBuildParams & {
  filters: ExecutiveReportFilters & { periodo: Extract<ExecutiveReportPeriodFilter, { tipoReporte: "RANGO_MESES" }> };
};

export async function buildRangeSnapshotData(params: BuildRangeSnapshotDataParams): Promise<ExecutiveReportSnapshotData> {
  const t0 = Date.now();
  const { roster, filters, generatedBy } = params;
  const now = params.now ?? new Date();
  const { from: fromParam, to: toParam } = filters.periodo;
  const { users, userIds, scope, rosterKind } = roster;
  const months = getMonthsInRange(fromParam, toParam);

  const [fromYear, fromMonth] = fromParam.split("-").map(Number);
  const [toYear, toMonth] = toParam.split("-").map(Number);
  const rangeStart = monthBounds(fromYear, fromMonth).start;
  const rangeEnd = monthBounds(toYear, toMonth).end;
  const cutoff = filters.fechaCorte ? earlier(filters.fechaCorte, now) : earlier(rangeEnd, now);
  const dataUpperBound = earlier(rangeEnd, cutoff);

  const rangeStartRate = await monthlyBusinessBase(fromYear, fromMonth);
  const effectiveBases = await computeEffectiveMemberBases(
    userIds,
    rangeStart,
    rangeEnd,
    rangeStartRate.hoursPerDay,
    rangeStartRate.limitLowPerDay,
    rangeStartRate.limitHighPerDay,
    rangeStartRate.limitOverloadPerDay,
  );

  const monthBusinessInfo = await Promise.all(
    months.map(async (monthStr) => {
      const [y, mo] = monthStr.split("-").map(Number);
      const { shared, perUser } = await monthlyBusinessBaseForUsers(userIds, y, mo);
      const { start: cargaStart, end: cargaEnd, baseHours, hoursPerDay, limitBaseHours, limitLowHours, limitHighHours, limitOverloadHours } = shared;
      const { start: realStart } = businessDayRealRange(cargaStart);
      const { end: realEnd } = businessDayRealRange(cargaEnd);
      return { monthStr, cargaStart, cargaEnd, realStart, realEnd, baseHours, hoursPerDay, limitBaseHours, limitLowHours, limitHighHours, limitOverloadHours, perUser };
    }),
  );

  function bizInfoForUser(bizInfo: (typeof monthBusinessInfo)[number], userId: string) {
    return bizInfo.perUser.get(userId) ?? bizInfo;
  }
  const rangeRealStart = monthBusinessInfo[0].realStart;
  const rangeRealEnd = earlier(monthBusinessInfo[monthBusinessInfo.length - 1].realEnd, cutoff);

  const [allTasksRaw, allActivities, fijaTasksForCarga, activitiesForCarga, dataQuality] = await Promise.all([
    prisma.task.findMany({
      where: { assignedToId: { in: userIds }, endDate: { gte: rangeStart, lte: rangeEnd } },
      select: { assignedToId: true, status: true, endDate: true, progress: true, type: true, frequency: true, estimatedHours: true, realHours: true, completedAt: true },
    }),
    prisma.taskActivity.findMany({
      where: { authorId: { in: userIds }, createdAt: { gte: rangeStart, lte: dataUpperBound }, task: { type: "SEGUIMIENTO" } },
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
    computeDataQuality(userIds),
  ]);

  const allTasks = asOfFechaCorte(allTasksRaw, cutoff);

  const monthSnapshots: MonthSnapshot[] = months.map((monthStr) => {
    const [y, mo] = monthStr.split("-").map(Number);
    const { start, end } = monthBounds(y, mo);
    const refDate = earlier(end, cutoff);
    const bizInfo = monthBusinessInfo.find((b) => b.monthStr === monthStr)!;

    const monthTasks = allTasks.filter((t) => t.endDate >= start && t.endDate <= end);
    const monthActs = allActivities.filter((a) => a.createdAt >= start && a.createdAt <= end);
    const monthFija = fijaTasksForCarga.filter((t) => t.completedAt! >= bizInfo.realStart && t.completedAt! <= bizInfo.realEnd);
    const monthCargaActs = activitiesForCarga.filter((a) => a.createdAt >= bizInfo.realStart && a.createdAt <= bizInfo.realEnd);

    const memberSnapshots = users.map((user) => {
      const tasks = monthTasks.filter((t) => t.assignedToId === user.id);
      const completedPct = computeCompletedPctAny(tasks);

      const fijaHours = monthFija.filter((t) => t.assignedToId === user.id).reduce((s, t) => s + t.realHours, 0);
      const activityHours = monthCargaActs.filter((a) => a.authorId === user.id).reduce((s, a) => s + a.duration, 0) / 60;
      const cargaRealHours = Math.round((fijaHours + activityHours) * 100) / 100;
      const userBiz = bizInfoForUser(bizInfo, user.id);
      const cargaRange = computeWorkloadRange(cargaRealHours, userBiz.limitBaseHours, userBiz.limitLowHours, userBiz.limitHighHours, userBiz.limitOverloadHours);
      const cargaPct = computeWorkloadPct(cargaRealHours, userBiz.limitBaseHours, cargaRange.max);

      const inProgress = tasks.filter((t) => t.status === "EN_PROGRESO");
      const avgProgress = inProgress.length > 0 ? Math.round(inProgress.reduce((s, t) => s + t.progress, 0) / inProgress.length) : 0;
      const overdue = tasks.filter((t) => isTaskOverdue(t.endDate, t.status, refDate)).length;
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
    const teamAvgCumplimiento = activeMemberSnapshots.length > 0 ? Math.round(activeMemberSnapshots.reduce((s, m) => s + m.completedPct, 0) / activeMemberSnapshots.length) : 0;

    return {
      month: monthStr,
      label: monthLabelFromKey(monthStr),
      teamAvgCumplimiento,
      totalCompletedTasks: monthTasks.filter((t) => t.status === "COMPLETADA").length,
      totalTasks: monthTasks.length,
      totalCargaRealHours: Math.round(memberSnapshots.reduce((s, m) => s + m.cargaRealHours, 0) * 100) / 100,
      totalCargaBaseHours: Math.round(memberSnapshots.reduce((s, m) => s + m.cargaBaseHours, 0) * 100) / 100,
      totalConsultas: monthActs.length,
      memberSnapshots: memberSnapshots.map(({ overdueCount: _oc, cargaRealHours: _crh, cargaBaseHours: _cbh, ...rest }) => rest),
    };
  });

  const aggregatedMembers: ReportMemberKpi[] = users.map((user) => {
    const userTasks = allTasks.filter((t) => t.assignedToId === user.id);
    const userActs = allActivities.filter((a) => a.authorId === user.id);
    const completedTasks = userTasks.filter((t) => t.status === "COMPLETADA").length;

    const fijaHours = fijaTasksForCarga.filter((t) => t.assignedToId === user.id).reduce((s, t) => s + t.realHours, 0);
    const activityHours = activitiesForCarga.filter((a) => a.authorId === user.id).reduce((s, a) => s + a.duration, 0) / 60;
    const cargaRealHours = Math.round((fijaHours + activityHours) * 100) / 100;
    const userRangeBiz = effectiveBases.get(user.id)!;
    const cargaBaseHours = userRangeBiz.baseHours;
    const cargaRange = computeWorkloadRange(cargaRealHours, userRangeBiz.limitBaseHours, userRangeBiz.limitLowHours, userRangeBiz.limitHighHours, userRangeBiz.limitOverloadHours);
    const cargaPct = computeWorkloadPct(cargaRealHours, userRangeBiz.limitBaseHours, cargaRange.max);

    const activeSnaps = monthSnapshots.filter((ms) => ms.memberSnapshots.find((m) => m.id === user.id)!.totalTasks > 0);
    const avgCumplimiento = activeSnaps.length > 0 ? Math.round(activeSnaps.reduce((s, ms) => s + ms.memberSnapshots.find((m) => m.id === user.id)!.completedPct, 0) / activeSnaps.length) : 0;
    const avgScore = activeSnaps.length > 0 ? Math.round(activeSnaps.reduce((s, ms) => s + ms.memberSnapshots.find((m) => m.id === user.id)!.score, 0) / activeSnaps.length) : 0;

    const byReasonMap: Record<string, { count: number; totalMinutes: number }> = {};
    for (const act of userActs) {
      if (!byReasonMap[act.reason]) byReasonMap[act.reason] = { count: 0, totalMinutes: 0 };
      byReasonMap[act.reason].count++;
      byReasonMap[act.reason].totalMinutes += act.duration;
    }

    const estadoOperativo = deriveEstadoOperativo({ completedPct: avgCumplimiento, cargaLabel: cargaRange.label, overdueCount: 0 });
    const principalHallazgo = computePrincipalHallazgo({ cargaLabel: cargaRange.label, completedPct: avgCumplimiento, overdueCount: 0, totalTasks: userTasks.length });

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
      byReason: Object.entries(byReasonMap).map(([reason, d]) => ({ reason, count: d.count, totalMinutes: d.totalMinutes })),
      baseWasProrated: userRangeBiz.wasProrated,
      baseEffectiveStart: userRangeBiz.wasProrated ? userRangeBiz.effectiveStart.toISOString() : undefined,
      estadoOperativo,
      principalHallazgo,
    };
  });

  const activeMonths = monthSnapshots.filter((ms) => ms.totalTasks > 0);
  const avgCumplimiento = activeMonths.length > 0 ? Math.round(activeMonths.reduce((s, ms) => s + ms.teamAvgCumplimiento, 0) / activeMonths.length) : 0;
  const totalCargaRealHours = Math.round(aggregatedMembers.reduce((s, m) => s + m.cargaRealHours, 0) * 100) / 100;
  const totalCargaBaseHours = Math.round(aggregatedMembers.reduce((s, m) => s + m.cargaBaseHours, 0) * 100) / 100;
  const totalLimitBaseHours = users.reduce((s, u) => s + (effectiveBases.get(u.id)?.limitBaseHours ?? 0), 0);
  const totalLimitLowHours = users.reduce((s, u) => s + (effectiveBases.get(u.id)?.limitLowHours ?? 0), 0);
  const totalLimitHighHours = users.reduce((s, u) => s + (effectiveBases.get(u.id)?.limitHighHours ?? 0), 0);
  const totalLimitOverloadHours = users.reduce((s, u) => s + (effectiveBases.get(u.id)?.limitOverloadHours ?? 0), 0);
  const teamCargaRange = computeWorkloadRange(totalCargaRealHours, totalLimitBaseHours, totalLimitLowHours, totalLimitHighHours, totalLimitOverloadHours);
  const avgCargaPct = computeWorkloadPct(totalCargaRealHours, totalLimitBaseHours, teamCargaRange.max);

  const lastMonthBizInfo = monthBusinessInfo[monthBusinessInfo.length - 1];
  const cargaRangeLastMonth = computeWorkloadRange(0, lastMonthBizInfo.limitBaseHours, lastMonthBizInfo.limitLowHours, lastMonthBizInfo.limitHighHours, lastMonthBizInfo.limitOverloadHours);

  const reasonMap: Record<string, { count: number; totalMinutes: number }> = {};
  for (const act of allActivities) {
    if (!reasonMap[act.reason]) reasonMap[act.reason] = { count: 0, totalMinutes: 0 };
    reasonMap[act.reason].count++;
    reasonMap[act.reason].totalMinutes += act.duration;
  }
  const totalConsultasRange = allActivities.length;
  const { start: prevPeriodStart, end: prevPeriodEnd } = previousEquivalentPeriod(rangeStart, rangeEnd);
  const prevPeriodActivities = await prisma.taskActivity.findMany({
    where: { authorId: { in: userIds }, createdAt: { gte: prevPeriodStart, lte: prevPeriodEnd }, task: { type: "SEGUIMIENTO" } },
    select: { reason: true },
  });
  const prevPeriodReasonCount: Record<string, number> = {};
  for (const act of prevPeriodActivities) prevPeriodReasonCount[act.reason] = (prevPeriodReasonCount[act.reason] ?? 0) + 1;

  const reasonLabelMap = await getActivityReasonLabelMap();
  const consultasByReason: MotivoDistributionItem[] = Object.entries(reasonMap)
    .map(([reason, d]) => {
      const pct = totalConsultasRange > 0 ? Math.round((d.count / totalConsultasRange) * 100) : 0;
      const prevCount = prevPeriodReasonCount[reason];
      const trendPct = prevCount && prevCount > 0 ? Math.round(((d.count - prevCount) / prevCount) * 100) : null;
      return { reason, count: d.count, totalMinutes: d.totalMinutes, pct, trendPct, interpretation: explainMotivoDistribution(reason, reasonLabelMap[reason] ?? reason, pct, trendPct) };
    })
    .sort((a, b) => b.count - a.count);

  const ranking = [...aggregatedMembers]
    .sort((a, b) => b.completedPct - a.completedPct || b.score - a.score)
    .map(({ id, name, role, score, completedPct }) => ({ id, name, role, score, completedPct }));

  const alerts: SnapshotTeamAlert[] = [];
  for (const user of users) {
    const activeMSnaps = monthSnapshots.filter((ms) => ms.memberSnapshots.find((m) => m.id === user.id)!.totalTasks > 0);
    if (activeMSnaps.length === 0) continue;
    const threshold = Math.ceil(activeMSnaps.length / 2);

    const lowCumpl = activeMSnaps.filter((ms) => ms.memberSnapshots.find((m) => m.id === user.id)!.completedPct < 60);
    if (lowCumpl.length >= threshold) {
      const avgValue = Math.round(lowCumpl.reduce((s, ms) => s + ms.memberSnapshots.find((m) => m.id === user.id)!.completedPct, 0) / lowCumpl.length);
      alerts.push({ userId: user.id, name: user.name, type: "cumplimiento", value: avgValue, monthsAffected: lowCumpl.length });
    }

    const overloaded = activeMSnaps.filter((ms) => ms.memberSnapshots.find((m) => m.id === user.id)!.cargaLabel === "Sobrecarga");
    if (overloaded.length >= threshold) {
      const avgValue = Math.round(overloaded.reduce((s, ms) => s + ms.memberSnapshots.find((m) => m.id === user.id)!.cargaPct, 0) / overloaded.length);
      alerts.push({ userId: user.id, name: user.name, type: "sobrecarga", value: avgValue, monthsAffected: overloaded.length });
    }
  }

  const problematicMonths = monthSnapshots.filter((ms) => ms.totalTasks > 0 && ms.teamAvgCumplimiento < 60).map(({ month, label, teamAvgCumplimiento }) => ({ month, label, teamAvgCumplimiento }));

  const firstActive = monthSnapshots.find((ms) => ms.totalTasks > 0);
  const lastActive = [...monthSnapshots].reverse().find((ms) => ms.totalTasks > 0);
  const firstMonthAvgCumplimiento = firstActive?.teamAvgCumplimiento ?? 0;
  const lastMonthAvgCumplimiento = lastActive?.teamAvgCumplimiento ?? 0;
  const cumplimientoChange = lastMonthAvgCumplimiento - firstMonthAvgCumplimiento;
  const cumplimientoTrend = cumplimientoChange > 5 ? "mejora" : cumplimientoChange < -5 ? "deterioro" : "estancamiento";

  const riskQuadrant = computeRiskQuadrant(aggregatedMembers.map((m) => ({ id: m.id, name: m.name, completedPct: m.completedPct, cargaPct: m.cargaPct })));
  const topReason = consultasByReason[0] ? { label: reasonLabelMap[consultasByReason[0].reason] ?? consultasByReason[0].reason, pct: consultasByReason[0].pct ?? 0 } : null;
  const totalOverdueRange = 0; // limitación preexistente a este sprint (no se rastrea overdue por miembro en la agregación de rango) — ver docs/AUDIT_LOG.md.
  const findings = computeFindings({ avgCumplimiento, avgCumplimientoDelta: cumplimientoChange, members: aggregatedMembers, totalOverdue: totalOverdueRange, topReason });
  const recommendations = computeRecommendations({ avgCumplimiento, members: aggregatedMembers, topReason });
  const insights = computeTeamInsights({ members: aggregatedMembers, totalCargaRealHours });

  const periodStatus = await resolveMonthlyPeriodStatus(toMonth, toYear, now);

  const result: ExecutiveReportSnapshotData = {
    meta: {
      reportId: generateReportId(now),
      origin: "GENERATED",
      integrityFlag: "FULL",
      type: "RANGO_MESES",
      rosterKind,
      scope,
      periodLabel: `${monthLabelFromKey(fromParam)} a ${monthLabelFromKey(toParam)}`,
      periodStart: rangeStart.toISOString(),
      periodEnd: rangeEnd.toISOString(),
      fechaCorte: cutoff.toISOString(),
      periodStatus,
      collaboratorIds: userIds,
      collaboratorCount: userIds.length,
      generatedBy,
      generatedAt: now.toISOString(),
      generationMs: Date.now() - t0,
      versions: currentExecutiveReportVersions(),
    },
    estadoGeneral: { indiceEjecutivo: null, dataQuality },
    teamSummary: {
      avgCumplimiento,
      avgCargaPct,
      totalCompletedTasks: allTasks.filter((t) => t.status === "COMPLETADA").length,
      totalTasks: allTasks.length,
      totalCargaRealHours,
      totalCargaBaseHours,
      totalConsultas: allActivities.length,
      hoursPerDay: lastMonthBizInfo.hoursPerDay,
      cargaRangeMin: Math.round(lastMonthBizInfo.limitBaseHours * 100) / 100,
      cargaRangeMax: cargaRangeLastMonth.max,
    },
    members: aggregatedMembers,
    ranking,
    distribuciones: { consultasByReason, riskQuadrant },
    trends: null,
    monthlyEvolution: monthSnapshots,
    rangeTrend: { cumplimientoTrend, cumplimientoChange, firstMonthAvgCumplimiento, lastMonthAvgCumplimiento },
    problematicMonths,
    findings,
    insights,
    indicatorExplanations: {
      cumplimiento: explainCumplimientoIndicator(avgCumplimiento, aggregatedMembers.length),
      carga: explainCargaIndicator(avgCargaPct),
      consultas: explainConsultasIndicator(allActivities.length, prevPeriodActivities.length),
    },
    recommendations,
    alerts,
    predictivo: null,
    nova: null,
    novaDegraded: false,
  };
  await attachNovaNarrative(result, generatedBy);
  return deepFreeze(result);
}

// ── RANGO PERSONALIZADO ──────────────────────────────────────────────────────

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

export type BuildCustomRangeSnapshotDataParams = BaseBuildParams & {
  filters: ExecutiveReportFilters & { periodo: Extract<ExecutiveReportPeriodFilter, { tipoReporte: "RANGO_PERSONALIZADO" }> };
};

export async function buildCustomRangeSnapshotData(params: BuildCustomRangeSnapshotDataParams): Promise<ExecutiveReportSnapshotData> {
  const t0 = Date.now();
  const { roster, filters, generatedBy } = params;
  const now = params.now ?? new Date();
  const { from: fromParam, to: toParam } = filters.periodo;
  const { users, userIds, scope, rosterKind } = roster;

  const periodStart = parseDayUTC(fromParam, false);
  const periodEnd = parseDayUTC(toParam, true);
  const cutoff = filters.fechaCorte ? earlier(filters.fechaCorte, now) : earlier(periodEnd, now);
  const dataUpperBound = earlier(periodEnd, cutoff);

  const { hoursPerDay, limitLowPerDay, limitHighPerDay, limitOverloadPerDay, limitLowHours, limitHighHours, limitOverloadHours, baseHours: flatBaseHours } = await businessBaseForRange(
    periodStart,
    periodEnd,
  );

  const effectiveBases = await computeEffectiveMemberBases(userIds, periodStart, periodEnd, hoursPerDay, limitLowPerDay, limitHighPerDay, limitOverloadPerDay);
  const { start: cargaRealStart } = businessDayRealRange(periodStart);
  const { end: cargaRealEndRaw } = businessDayRealRange(periodEnd);
  const cargaRealEnd = earlier(cargaRealEndRaw, cutoff);

  const [allTasksRaw, allActivities, fijaTasksForCarga, activitiesForCarga, dataQuality] = await Promise.all([
    prisma.task.findMany({
      where: { assignedToId: { in: userIds }, endDate: { gte: periodStart, lte: periodEnd } },
      select: { assignedToId: true, status: true, endDate: true, progress: true, estimatedHours: true, realHours: true, completedAt: true },
    }),
    prisma.taskActivity.findMany({
      where: { authorId: { in: userIds }, createdAt: { gte: periodStart, lte: dataUpperBound }, task: { type: "SEGUIMIENTO" } },
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
    computeDataQuality(userIds),
  ]);

  const allTasks = asOfFechaCorte(allTasksRaw, cutoff);
  const refDate = dataUpperBound;

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

    const estadoOperativo = deriveEstadoOperativo({ completedPct, cargaLabel: cargaRange.label, overdueCount: overdue });
    const principalHallazgo = computePrincipalHallazgo({ cargaLabel: cargaRange.label, completedPct, overdueCount: overdue, totalTasks: tasks.length });

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

  const alerts: SnapshotTeamAlert[] = [];
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
  const periodStatus = resolveCustomRangePeriodStatus(periodEnd, now);

  const result: ExecutiveReportSnapshotData = {
    meta: {
      reportId: generateReportId(now),
      origin: "GENERATED",
      integrityFlag: "FULL",
      type: "RANGO_PERSONALIZADO",
      rosterKind,
      scope,
      periodLabel: formatPeriodLabel(fromParam, toParam),
      periodStart: periodStart.toISOString(),
      periodEnd: periodEnd.toISOString(),
      fechaCorte: cutoff.toISOString(),
      periodStatus,
      collaboratorIds: userIds,
      collaboratorCount: userIds.length,
      generatedBy,
      generatedAt: now.toISOString(),
      generationMs: Date.now() - t0,
      versions: currentExecutiveReportVersions(),
    },
    estadoGeneral: { indiceEjecutivo: null, dataQuality },
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
    distribuciones: { consultasByReason, riskQuadrant },
    trends: null,
    monthlyEvolution: null,
    rangeTrend: null,
    problematicMonths: null,
    findings,
    insights,
    indicatorExplanations,
    recommendations,
    alerts,
    predictivo: null,
    nova: null,
    novaDegraded: false,
  };
  await attachNovaNarrative(result, generatedBy);
  return deepFreeze(result);
}
