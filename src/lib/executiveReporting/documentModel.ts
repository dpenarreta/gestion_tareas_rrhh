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

const ESTADO_GENERAL_COLOR: Record<IndiceEjecutivoNivel, "green" | "yellow" | "red"> = {
  Excelente: "green",
  Bueno: "green",
  Atención: "yellow",
  Crítico: "red",
};

function buildCoverPage(snap: ExecutiveReportSnapshotData): CoverPage {
  const indice = snap.estadoGeneral.indiceEjecutivo;
  return {
    kind: "cover",
    reportId: snap.meta.reportId,
    tipoReporteLabel: TIPO_REPORTE_LABEL[snap.meta.type],
    periodLabel: snap.meta.periodLabel,
    fechaCorteLabel: formatDateLabel(snap.meta.fechaCorte),
    generatedAtLabel: formatDateTimeLabel(snap.meta.generatedAt),
    generatedByName: snap.meta.generatedBy.name,
    estadoGeneralLabel: indice?.nivel ?? "Sin datos para el período",
    estadoGeneralColor: indice ? ESTADO_GENERAL_COLOR[indice.nivel] : "gray",
    scoreGeneral: indice?.valor ?? null,
    semaforoLabel: indice?.explicacion ?? null,
    analyticsEngineVersion: snap.meta.versions.analyticsEngineVersion,
    formulaSetVersion: snap.meta.versions.formulaSetVersion,
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
    { label: "Colaboradores", valor: `${snap.meta.collaboratorCount}`, sublabel: snap.meta.rosterKind === "CONSOLIDADO" ? "Equipo consolidado" : snap.meta.rosterKind === "POR_AREA" ? "Por área/rol" : "Individual" },
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
  return {
    kind: "metadata",
    reportId: snap.meta.reportId,
    generatedByName: snap.meta.generatedBy.name,
    generatedAtLabel: formatDateTimeLabel(snap.meta.generatedAt),
    fechaCorteLabel: formatDateLabel(snap.meta.fechaCorte),
    periodLabel: snap.meta.periodLabel,
    tipoReporteLabel: TIPO_REPORTE_LABEL[snap.meta.type],
    collaboratorCount: snap.meta.collaboratorCount,
    analyticsEngineVersion: snap.meta.versions.analyticsEngineVersion,
    formulaSetVersion: snap.meta.versions.formulaSetVersion,
    reportingEngineVersion: snap.meta.versions.reportingEngineVersion,
    nexoVersion: snap.meta.versions.nexoVersion,
    dataQualityPct: snap.estadoGeneral.dataQuality.pct,
    periodStatusLabel: PERIOD_STATUS_LABEL[snap.meta.periodStatus],
    generationMsLabel: snap.meta.generationMs >= 1000 ? `${(snap.meta.generationMs / 1000).toFixed(1)} s` : `${snap.meta.generationMs} ms`,
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
