// Executive Reporting Engine 2.0 — Fase E — único lugar donde vive el orden
// fijo de las 11 páginas del documento (FPS Parte II §6: Portada → Executive
// Summary → Estado General del Equipo → Indicadores Estratégicos → Detalle
// por Colaborador → Distribución Operativa → Executive Insights → Executive
// Assessment by NOVA → Recomendaciones → Analytics Predictivo → Metadatos).
// `buildReportPages` es una función PURA sobre un `ExecutiveReportSnapshotData`
// ya congelado — no hace I/O, no llama a Analytics ni a NOVA de nuevo. Tanto
// el render a HTML/PDF (`renderReportHtml.ts`) como el render a Excel
// (`renderReportExcel.ts`) consumen el MISMO `ReportPage[]`, así que nunca
// pueden divergir en orden o contenido entre un formato y otro.
import type { ExecutiveReportSnapshotData } from "./snapshotData";
import type { ReportMemberKpi, MotivoDistributionItem, IndiceEjecutivoNivel } from "@/components/kpis/types";
import type { RiskQuadrant, IndicatorExplanation } from "@/lib/reportInsights";
import type { NovaRecommendationEnrichment } from "./nova/types";
import { resolveEstadoGeneral } from "./estadoGeneral";

export type CoverPage = {
  kind: "cover";
  reportId: string;
  tipoReporteLabel: string;
  periodLabel: string;
  fechaCorteLabel: string;
  generatedAtLabel: string;
  generatedByName: string;
  estadoGeneralLabel: IndiceEjecutivoNivel | "Sin datos para el período";
  estadoGeneralColor: "green" | "yellow" | "red" | "gray";
  scoreGeneral: number | null;
  semaforoLabel: string | null;
  analyticsEngineVersion: string;
  formulaSetVersion: string;
  /**
   * Motor de Cierre Inteligente con Fecha de Corte — bloque metodológico de
   * portada, presente SOLO cuando el período tiene un MonthClosure con
   * closureType EARLY/MANUAL (nunca en NORMAL ni cuando el mes no está
   * cerrado formalmente — ahí el comportamiento de portada es idéntico al
   * de antes de este sprint, por requisito de compatibilidad). `null` en
   * todos los demás campos de este bloque cuando `closureStatusLabel` es null.
   */
  closureStatusLabel: string | null;
  coverageLabel: string | null;
  workingDaysConsideredLabel: string | null;
  workingHoursConsideredLabel: string | null;
  /** Párrafo completo de nota metodológica (mismo texto que se repite al final del informe) — null cuando `closureStatusLabel` es null. */
  metodologicalNoteLabel: string | null;
};

export type EstadoGeneralIndicator = {
  nombre: string;
  valor: string;
  meta: string;
  estado: string;
  interpretacion: string;
  impacto: string;
  recomendacion: string;
};

export type ExecutiveSummaryPage = {
  kind: "executiveSummary";
  situacionGeneral: string;
  fortalezas: string;
  aspectosAtencion: string;
  conclusion: string;
};

export type TeamStatusPage = {
  kind: "teamStatus";
  indicators: EstadoGeneralIndicator[];
};

export type StrategicIndicatorsPage = {
  kind: "strategicIndicators";
  kpis: Array<{ label: string; valor: string; sublabel: string }>;
  ranking: Array<{ id: string; name: string; role: string; score: number; completedPct: number }>;
};

export type MemberDetailPage = {
  kind: "memberDetail";
  members: ReportMemberKpi[];
};

export type OperationalDistributionPage = {
  kind: "operationalDistribution";
  consultasByReason: MotivoDistributionItem[];
  riskQuadrant: Array<{ id: string; name: string; completedPct: number; cargaPct: number; quadrant: RiskQuadrant }>;
};

export type InsightsPage = {
  kind: "insights";
  patrones: string[];
  cambios: string[];
  anomalias: string[];
  relacionesCruzadas: string[];
  hallazgosBase: string[];
  insightsBase: string[];
};

export type AssessmentPage = {
  kind: "assessment";
  diagnosticoGeneral: string;
  fortalezasEstrategicas: string[];
  riesgosDetectados: string[];
  oportunidades: string[];
  prioridades: string[];
  perspectivaEstrategica: string;
  opinionEjecutiva: string;
};

export type RecommendationRow = {
  id: string;
  text: string;
  priority: "alta" | "media";
  enrichment: NovaRecommendationEnrichment | null;
};

export type RecommendationsPage = {
  kind: "recommendations";
  alta: RecommendationRow[];
  media: RecommendationRow[];
};

export type PredictiveMemberRow = {
  id: string;
  name: string;
  cumplimientoLabel: string;
  sobrecargaLabel: string;
  sobrecargaNivel: "Alto" | "Medio" | "Bajo" | "—";
  subutilizacionLabel: string;
  queHacer: string[];
};

export type PredictivePage = {
  kind: "predictive";
  available: boolean;
  message: string;
  asOfLabel: string;
  horizonDays: number;
  membersAtRiskSobrecarga: number;
  avgCumplimientoEsperadoCierrePct: number | null;
  members: PredictiveMemberRow[];
};

export type MetadataPage = {
  kind: "metadata";
  reportId: string;
  generatedByName: string;
  generatedAtLabel: string;
  fechaCorteLabel: string;
  periodLabel: string;
  tipoReporteLabel: string;
  collaboratorCount: number;
  analyticsEngineVersion: string;
  formulaSetVersion: string;
  reportingEngineVersion: string;
  nexoVersion: string;
  dataQualityPct: number;
  periodStatusLabel: string;
  generationMsLabel: string;
  /** Mismo texto/condición que `CoverPage.metodologicalNoteLabel` — el spec pide la nota tanto en Portada como al final del informe. */
  metodologicalNoteLabel: string | null;
};

export type ReportPage =
  | CoverPage
  | ExecutiveSummaryPage
  | TeamStatusPage
  | StrategicIndicatorsPage
  | MemberDetailPage
  | OperationalDistributionPage
  | InsightsPage
  | AssessmentPage
  | RecommendationsPage
  | PredictivePage
  | MetadataPage;

const TIPO_REPORTE_LABEL: Record<ExecutiveReportSnapshotData["meta"]["type"], string> = {
  MENSUAL: "Informe Mensual",
  RANGO_MESES: "Informe de Rango (meses)",
  RANGO_PERSONALIZADO: "Informe de Rango Personalizado",
};

const PERIOD_STATUS_LABEL: Record<ExecutiveReportSnapshotData["meta"]["periodStatus"], string> = {
  EN_CURSO: "En curso",
  CERRADO: "Cerrado",
  HISTORICO: "Histórico",
};

function formatDateLabel(iso: string): string {
  return new Date(iso).toLocaleDateString("es-CL", { day: "2-digit", month: "long", year: "numeric" });
}

function formatDateTimeLabel(iso: string): string {
  return new Date(iso).toLocaleString("es-CL", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/**
 * "1 jul" — día + mes corto, para el rango de cobertura del bloque de cierre
 * anticipado/manual. `timeZone: "UTC"` es OBLIGATORIO aquí: `periodStart` y
 * `cutoffDate` son valores "solo fecha" (medianoche UTC, misma convención
 * que `Task.endDate` en todo el resto de la app) — sin fijar la zona, este
 * formateador dependía del huso horario LOCAL del proceso que renderiza
 * (servidor o navegador), corriendo el día calendario mostrado hacia atrás
 * en cualquier huso horario negativo respecto a UTC (p. ej. UTC-5).
 */
function formatShortDayMonth(iso: string): string {
  return new Date(iso).toLocaleDateString("es-CL", { day: "numeric", month: "short", timeZone: "UTC" }).replace(/\.$/, "");
}

/** Igual que `formatDateLabel`, pero fijando UTC — para valores "solo fecha" (medianoche UTC) como `cutoffDate`, nunca para instantes reales como `generatedAt`/`closedAt`. */
function formatDateLabelUTC(iso: string): string {
  return new Date(iso).toLocaleDateString("es-CL", { day: "2-digit", month: "long", year: "numeric", timeZone: "UTC" });
}

const CLOSURE_STATUS_LABEL: Record<"EARLY" | "MANUAL", string> = {
  EARLY: "Cerrado anticipadamente",
  MANUAL: "Cerrado — fecha de corte regularizada manualmente",
};

/**
 * Motor de Cierre Inteligente con Fecha de Corte — mismo párrafo que se
 * muestra en Portada y se repite al final del informe (MetadataPage). El
 * fraseo distingue EARLY (cierre ejecutado antes de que el período
 * terminara — `closedAt` y `cutoffDate` suelen coincidir o estar muy cerca)
 * de MANUAL (el período ya había terminado; el corte es una decisión
 * deliberada posterior, `closedAt` y `cutoffDate` pueden estar muy
 * separados) — el texto de ejemplo del spec original corresponde al caso
 * EARLY; se generaliza aquí sin inventar una tercera variante.
 */
function buildMetodologicalNote(closure: NonNullable<ExecutiveReportSnapshotData["meta"]["closure"]>): string | null {
  if (closure.closureType === "NORMAL") return null;
  const cutoffLabel = formatDateLabelUTC(closure.cutoffDate);
  // closedAt SÍ es un instante real (no "solo fecha") — se formatea con el
  // mismo criterio que generatedAtLabel/fechaCorteLabel en el resto del
  // documento (huso horario de quien renderiza), a propósito, sin forzar UTC.
  const closedAtLabel = formatDateLabel(closure.closedAt);
  const days = closure.workingDaysConsidered;
  const hours = closure.workingHoursConsidered;
  if (closure.closureType === "EARLY") {
    return `Este informe corresponde a un cierre anticipado realizado el ${closedAtLabel}, antes de finalizar el período. Todos los indicadores, KPIs y análisis fueron calculados utilizando exclusivamente la información registrada hasta esa fecha, considerando ${days} días hábiles y ${hours} horas base. Los registros posteriores al cierre no forman parte del presente análisis.`;
  }
  return `Este informe corresponde a un período cuya fecha de corte fue regularizada manualmente. El cierre se ejecutó el ${closedAtLabel}, pero toda la información fue calculada utilizando exclusivamente lo registrado hasta el ${cutoffLabel} (por motivos operativos, de auditoría o de regularización de datos), considerando ${days} días hábiles y ${hours} horas base. Los registros posteriores a la fecha de corte no forman parte del presente análisis.`;
}

/**
 * Validación defensiva — `meta` es un campo obligatorio del tipo
 * `ExecutiveReportSnapshotData`, pero llega desde una columna Json de
 * Postgres (sin chequeo de tipo en runtime); un snapshot persistido de forma
 * incompleta (ver `ensureSnapshotMeta`, `/api/reports/executive/[reportId]`)
 * nunca debe tumbar la página — se degrada a placeholders visibles en vez de
 * lanzar `Cannot read properties of undefined`.
 */
function buildCoverPage(snap: ExecutiveReportSnapshotData): CoverPage {
  const estado = resolveEstadoGeneral(snap);
  const meta = snap.meta;
  // `meta?.closure` puede ser `undefined` (no solo `null`) en snapshots
  // persistidos antes de este sprint — se trata igual que "sin cierre".
  const closure = meta?.closure && meta.closure.closureType !== "NORMAL" ? meta.closure : null;
  return {
    kind: "cover",
    reportId: meta?.reportId ?? "—",
    tipoReporteLabel: meta?.type ? TIPO_REPORTE_LABEL[meta.type] : "Informe Ejecutivo",
    periodLabel: meta?.periodLabel ?? "Período no disponible",
    fechaCorteLabel: meta?.fechaCorte ? formatDateLabel(meta.fechaCorte) : "—",
    generatedAtLabel: meta?.generatedAt ? formatDateTimeLabel(meta.generatedAt) : "—",
    generatedByName: meta?.generatedBy?.name ?? "—",
    estadoGeneralLabel: estado.nivel,
    estadoGeneralColor: estado.color,
    scoreGeneral: estado.valor,
    semaforoLabel: estado.explicacion,
    analyticsEngineVersion: meta?.versions?.analyticsEngineVersion ?? "—",
    formulaSetVersion: meta?.versions?.formulaSetVersion ?? "—",
    closureStatusLabel: closure ? CLOSURE_STATUS_LABEL[closure.closureType as "EARLY" | "MANUAL"] : null,
    coverageLabel: closure && meta?.periodStart ? `${formatShortDayMonth(meta.periodStart)} – ${formatShortDayMonth(closure.cutoffDate)}` : null,
    workingDaysConsideredLabel: closure ? `${closure.workingDaysConsidered} días hábiles` : null,
    workingHoursConsideredLabel: closure ? `${closure.workingHoursConsidered} horas` : null,
    metodologicalNoteLabel: closure ? buildMetodologicalNote(closure) : null,
  };
}

function buildExecutiveSummaryPage(snap: ExecutiveReportSnapshotData): ExecutiveSummaryPage {
  const s = snap.nova?.executiveSummary;
  return {
    kind: "executiveSummary",
    situacionGeneral: s?.situacionGeneral ?? "No disponible.",
    fortalezas: s?.fortalezas ?? "No disponible.",
    aspectosAtencion: s?.aspectosAtencion ?? "No disponible.",
    conclusion: s?.conclusion ?? "No disponible.",
  };
}

function indicatorRow(nombre: string, valor: string, meta: string, estado: string, exp: IndicatorExplanation): EstadoGeneralIndicator {
  return { nombre, valor, meta, estado, interpretacion: exp.meaning, impacto: exp.impact, recomendacion: exp.action };
}

function buildTeamStatusPage(snap: ExecutiveReportSnapshotData): TeamStatusPage {
  const { teamSummary, indicatorExplanations } = snap;
  const indicators: EstadoGeneralIndicator[] = [
    indicatorRow("Cumplimiento", `${teamSummary.avgCumplimiento}%`, "80%", teamSummary.avgCumplimiento >= 80 ? "Óptimo" : teamSummary.avgCumplimiento >= 60 ? "Aceptable" : "Bajo umbral", indicatorExplanations.cumplimiento),
    indicatorRow("Carga Laboral", `${teamSummary.avgCargaPct}%`, `${teamSummary.cargaRangeMin}h–${teamSummary.cargaRangeMax}h`, teamSummary.avgCargaPct > 100 ? "Sobre rango óptimo" : "Dentro de rango", indicatorExplanations.carga),
    indicatorRow("Consultas Atendidas", `${teamSummary.totalConsultas}`, "—", "Informativo", indicatorExplanations.consultas),
  ];

  const indice = snap.estadoGeneral.indiceEjecutivo;
  if (indice) {
    indicators.push({
      nombre: "Equilibrio Operativo (Índice Ejecutivo)",
      valor: `${indice.avgEquilibrio}/100`,
      meta: "≥ 85/100",
      estado: indice.nivel,
      interpretacion: indice.explicacion,
      impacto: "Determina si el equipo puede sostener su ritmo actual sin riesgo de desgaste.",
      recomendacion: indice.nivel === "Crítico" || indice.nivel === "Atención" ? "Revisar distribución de carga y tareas vencidas del equipo antes del próximo período." : "Mantener el seguimiento habitual.",
    });
  }

  return { kind: "teamStatus", indicators };
}

function buildStrategicIndicatorsPage(snap: ExecutiveReportSnapshotData): StrategicIndicatorsPage {
  const { teamSummary } = snap;
  const kpis = [
    { label: "Cumplimiento", valor: `${teamSummary.avgCumplimiento}%`, sublabel: `${teamSummary.totalCompletedTasks}/${teamSummary.totalTasks} tareas` },
    { label: "Carga Laboral", valor: `${teamSummary.avgCargaPct}%`, sublabel: `${teamSummary.totalCargaRealHours}h / ${teamSummary.totalCargaBaseHours}h base` },
    { label: "Consultas", valor: `${teamSummary.totalConsultas}`, sublabel: "Seguimiento atendido" },
    { label: "Colaboradores", valor: `${snap.meta?.collaboratorCount ?? snap.members.length}`, sublabel: snap.meta?.rosterKind === "POR_AREA" ? "Por área/rol" : snap.meta?.rosterKind === "INDIVIDUAL" ? "Individual" : "Equipo consolidado" },
  ];
  return { kind: "strategicIndicators", kpis, ranking: snap.ranking };
}

function buildMemberDetailPage(snap: ExecutiveReportSnapshotData): MemberDetailPage {
  return { kind: "memberDetail", members: snap.members };
}

function buildOperationalDistributionPage(snap: ExecutiveReportSnapshotData): OperationalDistributionPage {
  return { kind: "operationalDistribution", consultasByReason: snap.distribuciones.consultasByReason, riskQuadrant: snap.distribuciones.riskQuadrant };
}

function buildInsightsPage(snap: ExecutiveReportSnapshotData): InsightsPage {
  const i = snap.nova?.executiveInsights;
  return {
    kind: "insights",
    patrones: i?.patrones ?? [],
    cambios: i?.cambios ?? [],
    anomalias: i?.anomalias ?? [],
    relacionesCruzadas: i?.relacionesCruzadas ?? [],
    hallazgosBase: snap.findings.map((f) => f.text),
    insightsBase: snap.insights,
  };
}

function buildAssessmentPage(snap: ExecutiveReportSnapshotData): AssessmentPage {
  const a = snap.nova?.executiveAssessment;
  return {
    kind: "assessment",
    diagnosticoGeneral: a?.diagnosticoGeneral ?? "No disponible.",
    fortalezasEstrategicas: a?.fortalezasEstrategicas ?? [],
    riesgosDetectados: a?.riesgosDetectados ?? [],
    oportunidades: a?.oportunidades ?? [],
    prioridades: a?.prioridades ?? [],
    perspectivaEstrategica: a?.perspectivaEstrategica ?? "No disponible.",
    opinionEjecutiva: a?.opinionEjecutiva ?? "No disponible.",
  };
}

function buildRecommendationsPage(snap: ExecutiveReportSnapshotData): RecommendationsPage {
  const enrichmentById = new Map((snap.nova?.recommendationEnrichment ?? []).map((e) => [e.id, e]));
  const rows: RecommendationRow[] = snap.recommendations.map((r) => ({ id: r.id, text: r.text, priority: r.priority, enrichment: enrichmentById.get(r.id) ?? null }));
  return { kind: "recommendations", alta: rows.filter((r) => r.priority === "alta"), media: rows.filter((r) => r.priority === "media") };
}

function buildPredictivePage(snap: ExecutiveReportSnapshotData): PredictivePage {
  const p = snap.predictivo;
  if (!p) {
    return {
      kind: "predictive",
      available: false,
      message:
        "Analytics Predictivo solo proyecta hacia adelante para el mes calendario en curso — este reporte corresponde a un período distinto (o de rango), así que no aplica. Los 3 escenarios de equipo (Esperado/Preventivo/Optimista) del FPS quedan además pendientes de una fase posterior: el motor de predicción existente es por colaborador, todavía no hay una síntesis a nivel de equipo.",
      asOfLabel: "",
      horizonDays: 0,
      membersAtRiskSobrecarga: 0,
      avgCumplimientoEsperadoCierrePct: null,
      members: [],
    };
  }

  const members: PredictiveMemberRow[] = p.members.map((m) => ({
    id: m.id,
    name: m.name,
    cumplimientoLabel: m.cumplimiento?.available ? m.cumplimiento.queOcurrira : (m.cumplimiento?.queOcurrira ?? "Sin datos suficientes para proyectar."),
    sobrecargaLabel: m.sobrecarga?.available ? m.sobrecarga.queOcurrira : (m.sobrecarga?.queOcurrira ?? "Sin datos suficientes para proyectar."),
    sobrecargaNivel: m.sobrecarga?.available ? m.sobrecarga.nivel : "—",
    subutilizacionLabel: m.subutilizacion?.queOcurrira ?? "Sin datos.",
    queHacer: [...(m.cumplimiento?.queHacer ?? []), ...(m.sobrecarga?.queHacer ?? []), ...(m.subutilizacion?.queHacer ?? [])],
  }));

  return {
    kind: "predictive",
    available: true,
    message: "",
    asOfLabel: formatDateTimeLabel(p.asOf),
    horizonDays: p.horizonDays,
    membersAtRiskSobrecarga: p.membersAtRiskSobrecarga,
    avgCumplimientoEsperadoCierrePct: p.avgCumplimientoEsperadoCierrePct,
    members,
  };
}

function buildMetadataPage(snap: ExecutiveReportSnapshotData): MetadataPage {
  const meta = snap.meta;
  const closure = meta?.closure && meta.closure.closureType !== "NORMAL" ? meta.closure : null;
  return {
    kind: "metadata",
    reportId: meta?.reportId ?? "—",
    generatedByName: meta?.generatedBy?.name ?? "—",
    generatedAtLabel: meta?.generatedAt ? formatDateTimeLabel(meta.generatedAt) : "—",
    fechaCorteLabel: meta?.fechaCorte ? formatDateLabel(meta.fechaCorte) : "—",
    periodLabel: meta?.periodLabel ?? "Período no disponible",
    tipoReporteLabel: meta?.type ? TIPO_REPORTE_LABEL[meta.type] : "Informe Ejecutivo",
    collaboratorCount: meta?.collaboratorCount ?? snap.members.length,
    analyticsEngineVersion: meta?.versions?.analyticsEngineVersion ?? "—",
    formulaSetVersion: meta?.versions?.formulaSetVersion ?? "—",
    reportingEngineVersion: meta?.versions?.reportingEngineVersion ?? "—",
    nexoVersion: meta?.versions?.nexoVersion ?? "—",
    dataQualityPct: snap.estadoGeneral?.dataQuality?.pct ?? 0,
    periodStatusLabel: meta?.periodStatus ? PERIOD_STATUS_LABEL[meta.periodStatus] : "—",
    generationMsLabel: meta?.generationMs === undefined ? "—" : meta.generationMs >= 1000 ? `${(meta.generationMs / 1000).toFixed(1)} s` : `${meta.generationMs} ms`,
    metodologicalNoteLabel: closure ? buildMetodologicalNote(closure) : null,
  };
}

/** Único lugar donde vive el orden fijo de las 11 páginas (FPS Parte II §6) — nunca se altera. */
export function buildReportPages(snap: ExecutiveReportSnapshotData): ReportPage[] {
  return [
    buildCoverPage(snap),
    buildExecutiveSummaryPage(snap),
    buildTeamStatusPage(snap),
    buildStrategicIndicatorsPage(snap),
    buildMemberDetailPage(snap),
    buildOperationalDistributionPage(snap),
    buildInsightsPage(snap),
    buildAssessmentPage(snap),
    buildRecommendationsPage(snap),
    buildPredictivePage(snap),
    buildMetadataPage(snap),
  ];
}
