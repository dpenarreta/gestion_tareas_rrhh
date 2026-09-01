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
// ── Cutover de stack (Fases 72/73, ver docs/AUDIT_LOG.md § 2026-08-26) ──────
// Los 3 builders ya NO calculan `ReportMemberKpi`/agregados de equipo
// localmente contra Prisma — los leen del motor de cálculo de Django
// (`apps.reports.member_kpis`/`insights`/`team_report`, Fases 64-71,
// verificado campo por campo contra este mismo módulo antes de cada
// cutover) vía `djangoReportKpisBridge.ts`. Lo que SIGUE calculándose acá:
// Índice Ejecutivo/Analytics Predictivo (Django, Fases 57/48, sin cambios),
// narrativa NOVA, y todos los metadatos de trazabilidad (Report ID, fecha
// de corte, período, versiones). `insights`/`estadoOperativo`/
// `principalHallazgo` del builder MENSUAL también se recomponen acá —
// dependen del Índice Ejecutivo (mes en curso), que el bundle de Django no
// calcula.
//
// ── Cutover de stack (Fases 87/89, ver docs/AUDIT_LOG.md § 2026-08-28) ──────
// El roster (`resolveRoster.ts`) y la comparación del Índice Ejecutivo
// contra el mes anterior (`prisma.monthlyReport.findUnique`) dejaron de
// tocar Prisma — Fase 87 (`GET /reports/roster/`) y Fase 89
// (`GET /reports/monthly-report/`, `fetchDjangoMonthlyReport`). Este
// archivo queda sin ninguna dependencia de Prisma.
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
//      reconstruye de forma aproximada vía `as_of_fecha_corte` (Django,
//      `apps.reports.member_kpis`, Fase 64): una tarea marcada COMPLETADA
//      cuyo `completedAt` es POSTERIOR a la fecha de corte se trata como si
//      aún no estuviera completada para este snapshot (no sabemos cuál era
//      su status real en ese instante, así que se asume el más
//      conservador). Es una vista de solo lectura para este cálculo —
//      nunca se persiste ni modifica la tarea real.
// Cuando `fechaCorte` no viene informado, el corte por defecto (ver
// `resolveClosureCutoff`) pasa a ser — Motor de Cierre Inteligente con Fecha
// de Corte — el `cutoffDate` del MonthClosure del período, si existe (mismo
// valor sin importar cuándo se genere el reporte, inmutabilidad real); si el
// mes/rango nunca se cerró formalmente, reproduce EXACTAMENTE el
// comportamiento histórico (fin de período o "ahora", lo que sea anterior) —
// cero cambio para reportes de meses en curso o sin cerrar.
//
// Funciones que YA aceptan un `now`/instante de referencia (computeHealthScore,
// computePerformanceScore) reciben el corte ahí — no se modifica su firma ni
// su fórmula. `computeDataQuality` y `computeTeamMonthlySnapshots` (tendencias)
// no aceptan ese parámetro hoy; extenderlas queda fuera de este Sprint —
// quedan documentadas como limitación conocida: se evalúan sobre el estado
// actual, no "a la fecha de corte". (`monthlyBusinessBase`, en cambio, SÍ
// trunca su `end` automáticamente cuando el mes tiene un MonthClosure con
// corte anticipado — ver workload.ts — así que la base de horas/días
// hábiles que consumen estas funciones ya refleja el corte incluso sin
// tocar su firma.)
import { businessDayRealRange } from "@/lib/businessTime";
import { getMonthClosurePeriod } from "@/lib/closurePeriod";
import type { DjangoMonthClosure } from "@/lib/djangoClosurePeriodAdapter";
import { cached, type DataQualityResult } from "@/lib/analytics";
import { getEffectiveAnalyticsConfig } from "@/lib/systemConfig";
import {
  classifyIndiceEjecutivo,
  computeTeamInsights,
  deriveEstadoOperativo,
  computePrincipalHallazgo,
  type TrendComparison,
  type Finding,
  type Recommendation,
  type IndicatorExplanation,
} from "@/lib/reportInsights";
import { fetchDjangoPredictionBundle, fetchDjangoTeamSubutilization, type PredictionHorizon } from "@/lib/djangoPredictionAdapter";
import { fetchPerformanceAndHealth, type DjangoPerformanceAndHealth } from "./djangoAnalyticsBridge";
import { fetchMonthlyTeamReport, fetchCustomRangeTeamReport, fetchRangeTeamReport, fetchDjangoMonthlyReport } from "./djangoReportKpisBridge";
import { verifySnapshotIntegrity } from "./verifySnapshotIntegrity";
import { generateReportId } from "./reportId";
import { currentExecutiveReportVersions } from "./version";
import { resolveMonthlyPeriodStatus, resolveCustomRangePeriodStatus } from "./periodStatus";
import { deriveExecutiveReportContext } from "./context";
import { generateExecutiveNarrative } from "./nova/generateNarrative";
import { logReportAudit } from "./snapshotStore";
import type { ExecutiveReportFilters, ExecutiveReportPeriodFilter } from "./filters";
import type { ResolvedReportRoster } from "./resolveRoster";
import type { ExecutiveReportSnapshotData, SnapshotTeamAlert, SnapshotGeneratedBy, SnapshotPredictivo, SnapshotPredictiveMember, SnapshotClosureInfo, SnapshotTeamSummary, SnapshotDistribuciones } from "./snapshotData";
import type { IndiceEjecutivoData, MonthSnapshot, ReportMemberKpi, WorkloadColor, WorkloadLabel } from "@/components/kpis/types";

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

/** Menor de dos instantes. */
function earlier(a: Date, b: Date): Date {
  return a.getTime() < b.getTime() ? a : b;
}

function closureMetaFrom(closure: DjangoMonthClosure): SnapshotClosureInfo {
  return {
    closureType: closure.closureType,
    cutoffDate: closure.cutoffDate.toISOString(),
    closedAt: closure.closedAt.toISOString(),
    calendarDaysTotal: closure.calendarDaysTotal,
    calendarDaysConsidered: closure.calendarDaysConsidered,
    workingDaysConsidered: closure.workingDaysConsidered,
    workingHoursConsidered: closure.workingHoursConsidered,
  };
}

/**
 * Motor de Cierre Inteligente con Fecha de Corte — si (year, month) tiene un
 * MonthClosure, su `cutoffDate` (día calendario, medianoche UTC) se vuelve el
 * default de `filters.fechaCorte` en vez de "fin de período o ahora, lo que
 * sea antes" — así un reporte de un mes cerrado usa SIEMPRE el mismo corte
 * persistido, sin importar cuándo se genere (inmutabilidad real, no solo "lo
 * más reciente antes de ahora"). Se convierte a instante real de fin del día
 * de negocio (`businessDayRealRange`) para no truncar a medianoche la
 * actividad del propio día de corte — mismo patrón que el resto del motor
 * usa para pasar de "día calendario" a "instante real" (ver businessTime.ts).
 * Un `filters.fechaCorte` explícito SIEMPRE gana sobre el default del cierre
 * (uso manual/excepcional, cero cambio de comportamiento para ese caso).
 */
async function resolveClosureCutoff(
  year: number,
  month: number,
  explicitFechaCorte: Date | undefined,
  fallback: Date,
  now: Date
): Promise<{ cutoff: Date; closureMeta: SnapshotClosureInfo | null }> {
  const { closure } = await getMonthClosurePeriod(year, month);
  const closureMeta = closure ? closureMetaFrom(closure) : null;
  if (explicitFechaCorte) return { cutoff: earlier(explicitFechaCorte, now), closureMeta };
  if (closure) {
    const { end: cutoffInstant } = businessDayRealRange(closure.cutoffDate);
    return { cutoff: earlier(cutoffInstant, now), closureMeta };
  }
  return { cutoff: earlier(fallback, now), closureMeta: null };
}

/**
 * FPS Parte II § Analytics Predictivo — integración visual del motor YA
 * EXISTENTE (predictionEngine.ts, por colaborador), sin fórmulas nuevas ni
 * motor de escenarios de equipo. Extraída como función independiente
 * (Parte IV §8) para poder correr en PARALELO con el cómputo de Índice
 * Ejecutivo — ambas son independientes entre sí; antes se esperaban una
 * tras otra, casi duplicando el tiempo de generación del mes en curso.
 */
async function buildPredictivoForCurrentMonth(
  userIds: string[],
  members: ReportMemberKpi[],
  cutoff: Date,
  cacheTtlMinutes: number
): Promise<SnapshotPredictivo> {
  // Cutover de stack (Fase 85, ver docs/AUDIT_LOG.md § 2026-08-27):
  // Cumplimiento/Sobrecarga/Subutilización ya no se recalculan localmente
  // (Prisma) — se leen del bundle de Django (`/predictive/predictions/<id>/`,
  // `/reports/executive/team-subutilization/`), verificado función por
  // función como réplica exacta antes del cutover. `cached()` — mismo
  // patrón/TTL que perf-bench/equilibrio-bench — evita repetir la llamada
  // HTTP en regeneraciones dentro de la ventana de caché. `userIds` ya es el
  // id numérico de Django directo (retiro del bridge cuid↔Django, decisión
  // explícita del usuario, ver docs/AUDIT_LOG.md § 2026-08-31).
  const [bundleResults, subutilizacionMap] = await Promise.all([
    Promise.all(
      userIds.map(async (id) => {
        const djangoId = Number(id);
        const result = await cached(`prediction-bundle:${djangoId}:${cutoff.toISOString()}`, cacheTtlMinutes, () =>
          fetchDjangoPredictionBundle(djangoId, cutoff)
        );
        return result.value;
      })
    ),
    fetchDjangoTeamSubutilization(userIds.map(Number), cutoff),
  ]);

  const UNAVAILABLE_CUMPLIMIENTO = { available: false as const, queOcurrira: "Sin datos de Django disponibles.", porQue: "", queHacer: [], confidencePct: 0 };
  const UNAVAILABLE_SOBRECARGA = { available: false as const, queOcurrira: "Sin datos de Django disponibles.", porQue: "", nivel: "Bajo" as const, queHacer: [], confidencePct: 0 };

  const predictiveMembers: SnapshotPredictiveMember[] = userIds.map((id, i) => {
    const member = members.find((m) => m.id === id);
    const bundle = bundleResults[i];
    const djangoId = Number(id);
    const subutilizacionResult = subutilizacionMap.get(djangoId);
    const cumplimientoResult = bundle?.cumplimiento;
    const sobrecargaResult = bundle?.sobrecarga;
    return {
      id,
      name: member?.name ?? id,
      cumplimiento:
        cumplimientoResult?.available
          ? { available: true, queOcurrira: cumplimientoResult.queOcurrira, porQue: cumplimientoResult.porQue, queHacer: cumplimientoResult.queHacer, confidencePct: cumplimientoResult.confidencePct }
          : cumplimientoResult
            ? { available: false, queOcurrira: cumplimientoResult.reason, porQue: "", queHacer: [], confidencePct: 0 }
            : UNAVAILABLE_CUMPLIMIENTO,
      sobrecarga:
        sobrecargaResult?.available
          ? { available: true, queOcurrira: sobrecargaResult.queOcurrira, porQue: sobrecargaResult.porQue, nivel: sobrecargaResult.nivel, queHacer: sobrecargaResult.queHacer, confidencePct: sobrecargaResult.confidencePct }
          : sobrecargaResult
            ? { available: false, queOcurrira: sobrecargaResult.reason, porQue: "", nivel: "Bajo", queHacer: [], confidencePct: 0 }
            : UNAVAILABLE_SOBRECARGA,
      subutilizacion: subutilizacionResult ? { nivel: subutilizacionResult.nivel, queOcurrira: subutilizacionResult.queOcurrira, queHacer: subutilizacionResult.queHacer } : null,
    };
  });

  const validCumplimientoPct: number[] = [];
  let representativeHorizon: PredictionHorizon | null = null;
  for (const bundle of bundleResults) {
    const r = bundle?.cumplimiento;
    if (r?.available) {
      validCumplimientoPct.push(r.cumplimientoEsperadoCierrePct);
      if (representativeHorizon === null) representativeHorizon = r.horizon;
    }
  }
  if (representativeHorizon === null) {
    for (const bundle of bundleResults) {
      const r = bundle?.sobrecarga;
      if (r?.available) {
        representativeHorizon = r.horizon;
        break;
      }
    }
  }
  const membersAtRiskSobrecarga = bundleResults.filter((bundle) => bundle?.sobrecarga.available && bundle.sobrecarga.nivel === "Alto").length;

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
async function attachNovaNarrative(result: ExecutiveReportSnapshotData): Promise<void> {
  const context = deriveExecutiveReportContext(result);
  const narrative = await generateExecutiveNarrative(context);
  result.nova = narrative.sections;
  result.novaDegraded = narrative.degraded;
  if (narrative.degraded) {
    await logReportAudit({
      reportId: result.meta.reportId,
      action: "nova_degraded",
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

type MonthlyTeamReportBundle = {
  teamSummary: SnapshotTeamSummary;
  members: ReportMemberKpi[];
  ranking: Array<{ id: string; name: string; role: string; score: number; completedPct: number }>;
  distribuciones: SnapshotDistribuciones;
  trends: { mesAnterior: TrendComparison; trimestre: TrendComparison; semestre: TrendComparison };
  findings: Finding[];
  recommendations: Recommendation[];
  indicatorExplanations: { cumplimiento: IndicatorExplanation; carga: IndicatorExplanation; consultas: IndicatorExplanation };
  alerts: SnapshotTeamAlert[];
  dataQuality: DataQualityResult;
};

export async function buildMonthlySnapshotData(params: BuildMonthlySnapshotDataParams): Promise<ExecutiveReportSnapshotData> {
  const t0 = Date.now();
  const { roster, filters, generatedBy } = params;
  const now = params.now ?? new Date();
  const { month, year } = filters.periodo;
  const { userIds, scope, rosterKind } = roster;
  const { start, end } = monthBounds(year, month);
  const { cutoff, closureMeta } = await resolveClosureCutoff(year, month, filters.fechaCorte, end, now);

  // Cutover de stack (Fase 72, ver docs/AUDIT_LOG.md § 2026-08-26): el
  // bloque ReportMemberKpi + agregados de equipo ya NO se calcula
  // localmente contra Prisma — se lee del bundle de Django
  // (`apps.reports.member_kpis`/`insights`/`team_report`, Fases 64-71),
  // verificado campo por campo contra este mismo builder con datos
  // sintéticos antes de este cutover (Fases 70/71, incluidos los casos de
  // borde de mes). Si Django no responde, la generación FALLA (decisión
  // explícita — a diferencia del Índice Ejecutivo, que degrada excluyendo
  // colaboradores sin romper la generación: `ReportMemberKpi` es el
  // corazón visible del reporte, no un agregado secundario). `userIds` ya
  // es el id numérico de Django directo (retiro del bridge cuid↔Django,
  // decisión explícita del usuario, ver docs/AUDIT_LOG.md § 2026-08-31).
  const bundle = (await fetchMonthlyTeamReport(userIds, year, month, filters.fechaCorte)) as unknown as MonthlyTeamReportBundle;
  const { teamSummary, members, ranking, distribuciones, trends, findings, recommendations, indicatorExplanations, alerts, dataQuality } = bundle;
  const { totalCargaRealHours } = teamSummary;
  // Generado acá (no inline en `result`, como los otros 2 builders) porque
  // Sprint R (más abajo) necesita el mismo Report ID para asociar sus
  // incidentes — un solo id por generación, nunca 2.
  const reportId = generateReportId(now);

  const isCurrentMonth = month === now.getMonth() + 1 && year === now.getFullYear();
  let indiceEjecutivo: IndiceEjecutivoData = null;
  let predictivo: SnapshotPredictivo = null;
  let integrityCheck: { performed: boolean; discrepancyCount: number } | null = null;
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
    // Sprint R — Snapshot Integrity Validation (Fase 79, ver
    // docs/AUDIT_LOG.md § 2026-08-27): solo corre SIN `fechaCorte` explícita
    // — es el único caso donde `GET /kpis/team/` (la fuente de comparación,
    // que no conoce fecha de corte) y este builder miran el mismo momento.
    // Corre en paralelo con las otras 2 ramas, mismo criterio de rendimiento
    // de arriba — nunca agrega latencia secuencial.
    const [indiceResult, predictivoResult, integrityResult] = await Promise.all([
      (async () => {
        // Cutover de stack (Fase 57, ver docs/AUDIT_LOG.md § 2026-08-25):
        // Performance Score/Equilibrio Operativo por colaborador ya no se
        // calculan localmente (computePerformanceScore/computeHealthScore,
        // Prisma) — se leen del bundle de Django (`/analytics/<id>/`, Fase
        // 4m/47), mismo patrón que Nova Insights (Fase 54).
        const resultsById = new Map<string, DjangoPerformanceAndHealth>();
        await Promise.all(
          userIds.map(async (id) => {
            const djangoId = Number(id);
            const result = await cached(`exec-report-analytics:${djangoId}`, analyticsConfig.cacheTtlMinutes, () =>
              fetchPerformanceAndHealth(djangoId),
            );
            if (result.value) resultsById.set(id, result.value);
          }),
        );

        const perfValues = [...resultsById.values()].map((r) => r.performanceScore);
        const healthValues = [...resultsById.values()].map((r) => r.healthScore);
        const avgPerformance = perfValues.length > 0 ? Math.round((perfValues.reduce((s, v) => s + v, 0) / perfValues.length) * 10) / 10 : 0;
        const avgEquilibrio = healthValues.length > 0 ? Math.round((healthValues.reduce((s, v) => s + v, 0) / healthValues.length) * 10) / 10 : 0;
        const classified = classifyIndiceEjecutivo(avgPerformance, avgEquilibrio);

        const prevMonth = month === 1 ? 12 : month - 1;
        const prevYear = month === 1 ? year - 1 : year;
        const prevReportData = await fetchDjangoMonthlyReport(prevMonth, prevYear, scope);
        const prevIndiceValor = (prevReportData as { indiceEjecutivo?: { valor: number } | null } | null)?.indiceEjecutivo?.valor;
        const variacion = typeof prevIndiceValor === "number" ? Math.round((classified.valor - prevIndiceValor) * 10) / 10 : null;

        return { indiceEjecutivo: { ...classified, avgPerformance, avgEquilibrio, variacion }, resultsById };
      })(),
      buildPredictivoForCurrentMonth(userIds, members, cutoff, analyticsConfig.cacheTtlMinutes),
      filters.fechaCorte ? Promise.resolve(null) : verifySnapshotIntegrity(reportId, month, year, members),
    ]);

    indiceEjecutivo = indiceResult.indiceEjecutivo;
    predictivo = predictivoResult;
    integrityCheck = integrityResult;

    for (const id of userIds) {
      const result = indiceResult.resultsById.get(id);
      if (!result) continue;
      const member = members.find((m) => m.id === id);
      if (member) member.equilibrioScore = result.healthScore;
      const consistenciaFactor = result.healthFactors.find((f) => f.name === "Consistencia");
      if (consistenciaFactor && (consistenciaFactor.rawLabel === "Variable" || consistenciaFactor.rawLabel === "Muy variable") && member) {
        variableConsistencyMembers.push(member.name);
      }
    }
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

  // `insights` (a diferencia de findings/recommendations/indicatorExplanations)
  // sigue calculándose en TS, no viene del bundle de Django — necesita
  // `healthByMember`/`variableConsistencyMembers` del Índice Ejecutivo, que
  // el bundle de Django no calcula (ver docstring de `djangoReportKpisBridge.ts`).
  const insights = computeTeamInsights({
    members,
    totalCargaRealHours,
    healthByMember: isCurrentMonth ? members.filter((m) => m.equilibrioScore !== undefined).map((m) => ({ name: m.name, score: m.equilibrioScore! })) : undefined,
    variableConsistencyMembers,
  });

  const periodStatus = await resolveMonthlyPeriodStatus(month, year, now);

  const result: ExecutiveReportSnapshotData = {
    meta: {
      reportId,
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
      closure: closureMeta,
      collaboratorIds: userIds,
      collaboratorCount: userIds.length,
      generatedBy,
      generatedAt: now.toISOString(),
      generationMs: Date.now() - t0,
      versions: currentExecutiveReportVersions(),
    },
    estadoGeneral: { indiceEjecutivo, dataQuality },
    teamSummary,
    members,
    ranking,
    distribuciones,
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
    integrityCheck,
  };
  await attachNovaNarrative(result);
  return deepFreeze(result);
}

// ── RANGO DE MESES ───────────────────────────────────────────────────────────

export type BuildRangeSnapshotDataParams = BaseBuildParams & {
  filters: ExecutiveReportFilters & { periodo: Extract<ExecutiveReportPeriodFilter, { tipoReporte: "RANGO_MESES" }> };
};

type RawRangeMemberSnapshot = {
  completedPct: number;
  cargaPct: number;
  cargaColor: WorkloadColor;
  cargaLabel: WorkloadLabel;
  score: number;
  totalTasks: number;
};

type RangeTeamReportBundle = {
  teamSummary: SnapshotTeamSummary;
  members: ReportMemberKpi[];
  ranking: Array<{ id: string; name: string; role: string; score: number; completedPct: number }>;
  distribuciones: SnapshotDistribuciones;
  monthlyEvolution: Array<{
    month: string;
    label: string;
    teamAvgCumplimiento: number;
    totalCompletedTasks: number;
    totalTasks: number;
    totalCargaRealHours: number;
    totalCargaBaseHours: number;
    totalConsultas: number;
    memberSnapshots: Record<string, RawRangeMemberSnapshot>;
  }>;
  rangeTrend: { cumplimientoTrend: "mejora" | "deterioro" | "estancamiento"; cumplimientoChange: number; firstMonthAvgCumplimiento: number; lastMonthAvgCumplimiento: number };
  problematicMonths: Array<{ month: string; label: string; teamAvgCumplimiento: number }>;
  findings: Finding[];
  insights: string[];
  recommendations: Recommendation[];
  indicatorExplanations: { cumplimiento: IndicatorExplanation; carga: IndicatorExplanation; consultas: IndicatorExplanation };
  alerts: SnapshotTeamAlert[];
  dataQuality: DataQualityResult;
};

export async function buildRangeSnapshotData(params: BuildRangeSnapshotDataParams): Promise<ExecutiveReportSnapshotData> {
  const t0 = Date.now();
  const { roster, filters, generatedBy } = params;
  const now = params.now ?? new Date();
  const { from: fromParam, to: toParam } = filters.periodo;
  const { userIds, scope, rosterKind } = roster;

  const [fromYear, fromMonth] = fromParam.split("-").map(Number);
  const [toYear, toMonth] = toParam.split("-").map(Number);
  const rangeStart = monthBounds(fromYear, fromMonth).start;
  const rangeEnd = monthBounds(toYear, toMonth).end;
  // El corte por defecto de un RANGO_MESES hereda el cierre del ÚLTIMO mes del
  // rango — mismo criterio que resolveRangePeriodStatus (que también evalúa
  // solo el último mes). Los meses ANTERIORES del rango que tengan su propio
  // MonthClosure con corte ya quedan truncados en su propia base de horas por
  // monthlyBusinessBase (ver workload.ts), sin depender de este `cutoff`.
  const { cutoff, closureMeta } = await resolveClosureCutoff(toYear, toMonth, filters.fechaCorte, rangeEnd, now);

  // Cutover de stack (Fase 73, ver docs/AUDIT_LOG.md § 2026-08-26) —
  // mismo patrón que MENSUAL/RANGO_PERSONALIZADO. `insights`/`estadoOperativo`/
  // `principalHallazgo` también vienen completos del bundle (mismo motivo
  // que RANGO_PERSONALIZADO: sin Índice Ejecutivo, nada que recomponer en
  // TS). Único glue code real de este builder: `monthlyEvolution[i].memberSnapshots`
  // llega como objeto `{djangoId: {...}}` (Fase 66/71, sin identidad — ver
  // `member_kpis.py`) — se reconstruye acá como array con `id`/`name`/`role`
  // (tomados de `members`, ya en id numérico de Django directo — retiro del
  // bridge cuid↔Django, decisión explícita del usuario, ver
  // docs/AUDIT_LOG.md § 2026-08-31) y se le aplica el mismo "strip" de
  // campos que hacía el TS original (sin `overdueCount`/`cargaRealHours`/
  // `cargaBaseHours`).
  const bundle = (await fetchRangeTeamReport(userIds, fromYear, fromMonth, toYear, toMonth, filters.fechaCorte)) as unknown as RangeTeamReportBundle;
  const { teamSummary, members, ranking, distribuciones, rangeTrend, problematicMonths, findings, insights, recommendations, indicatorExplanations, alerts, dataQuality } = bundle;

  const membersById = new Map(members.map((m) => [m.id, m]));
  const monthlyEvolution: MonthSnapshot[] = bundle.monthlyEvolution.map((ms) => ({
    month: ms.month,
    label: ms.label,
    teamAvgCumplimiento: ms.teamAvgCumplimiento,
    totalCompletedTasks: ms.totalCompletedTasks,
    totalTasks: ms.totalTasks,
    totalCargaRealHours: ms.totalCargaRealHours,
    totalCargaBaseHours: ms.totalCargaBaseHours,
    totalConsultas: ms.totalConsultas,
    memberSnapshots: Object.entries(ms.memberSnapshots).map(([userId, snap]) => {
      const identity = membersById.get(userId);
      return {
        id: userId,
        name: identity?.name ?? "",
        role: identity?.role ?? "",
        completedPct: snap.completedPct,
        cargaPct: snap.cargaPct,
        cargaColor: snap.cargaColor,
        cargaLabel: snap.cargaLabel,
        score: snap.score,
        totalTasks: snap.totalTasks,
      };
    }),
  }));

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
      closure: closureMeta,
      collaboratorIds: userIds,
      collaboratorCount: userIds.length,
      generatedBy,
      generatedAt: now.toISOString(),
      generationMs: Date.now() - t0,
      versions: currentExecutiveReportVersions(),
    },
    estadoGeneral: { indiceEjecutivo: null, dataQuality },
    teamSummary,
    members,
    ranking,
    distribuciones,
    trends: null,
    monthlyEvolution,
    rangeTrend,
    problematicMonths,
    findings,
    insights,
    indicatorExplanations,
    recommendations,
    alerts,
    predictivo: null,
    nova: null,
    novaDegraded: false,
    integrityCheck: null,
  };
  await attachNovaNarrative(result);
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

type CustomRangeTeamReportBundle = {
  teamSummary: SnapshotTeamSummary;
  members: ReportMemberKpi[];
  ranking: Array<{ id: string; name: string; role: string; score: number; completedPct: number }>;
  distribuciones: SnapshotDistribuciones;
  findings: Finding[];
  insights: string[];
  recommendations: Recommendation[];
  indicatorExplanations: { cumplimiento: IndicatorExplanation; carga: IndicatorExplanation; consultas: IndicatorExplanation };
  alerts: SnapshotTeamAlert[];
  dataQuality: DataQualityResult;
};

export async function buildCustomRangeSnapshotData(params: BuildCustomRangeSnapshotDataParams): Promise<ExecutiveReportSnapshotData> {
  const t0 = Date.now();
  const { roster, filters, generatedBy } = params;
  const now = params.now ?? new Date();
  const { from: fromParam, to: toParam } = filters.periodo;
  const { userIds, scope, rosterKind } = roster;

  const periodStart = parseDayUTC(fromParam, false);
  const periodEnd = parseDayUTC(toParam, true);
  const cutoff = filters.fechaCorte ? earlier(filters.fechaCorte, now) : earlier(periodEnd, now);

  // Cutover de stack (Fase 73, ver docs/AUDIT_LOG.md § 2026-08-26) —
  // mismo patrón que MENSUAL (Fase 72): ReportMemberKpi + agregados de
  // equipo se leen del bundle de Django (Fase 69), verificado campo por
  // campo desde las Fases 70/71. A diferencia de MENSUAL, acá `insights`/
  // `estadoOperativo`/`principalHallazgo` SÍ vienen completos del bundle
  // — este builder nunca tuvo Índice Ejecutivo (no hay `healthByMember`
  // del que depender), así que no hace falta recomputar nada en TS.
  const bundle = (await fetchCustomRangeTeamReport(userIds, periodStart, periodEnd, filters.fechaCorte)) as unknown as CustomRangeTeamReportBundle;
  const { teamSummary, members, ranking, distribuciones, findings, insights, recommendations, indicatorExplanations, alerts, dataQuality } = bundle;

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
      // RANGO_PERSONALIZADO no calza con un mes calendario completo — no
      // existe un MonthClosure único que atribuirle (mismo criterio que
      // resolveCustomRangePeriodStatus, que tampoco distingue CERRADO aquí).
      closure: null,
      collaboratorIds: userIds,
      collaboratorCount: userIds.length,
      generatedBy,
      generatedAt: now.toISOString(),
      generationMs: Date.now() - t0,
      versions: currentExecutiveReportVersions(),
    },
    estadoGeneral: { indiceEjecutivo: null, dataQuality },
    teamSummary,
    members,
    ranking,
    distribuciones,
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
    integrityCheck: null,
  };
  await attachNovaNarrative(result);
  return deepFreeze(result);
}

