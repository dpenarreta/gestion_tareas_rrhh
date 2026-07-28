// Executive Reporting Engine 2.0 — Fase E — render a Excel de las 11 páginas
// (FPS Parte II), sobre el MISMO `ReportPage[]` que alimenta el HTML/PDF —
// consolida la lógica que hoy vive duplicada en MonthlyReports.tsx y
// wizardExport.ts en un solo lugar.
import * as XLSX from "xlsx";
import type {
  ReportPage,
  CoverPage,
  TeamStatusPage,
  StrategicIndicatorsPage,
  MemberDetailPage,
  OperationalDistributionPage,
  InsightsPage,
  AssessmentPage,
  RecommendationsPage,
  RecommendationRow,
  PredictivePage,
  MetadataPage,
  ExecutiveSummaryPage,
} from "./documentModel";

function findPage<T extends ReportPage["kind"]>(pages: ReportPage[], kind: T): Extract<ReportPage, { kind: T }> | undefined {
  return pages.find((p) => p.kind === kind) as Extract<ReportPage, { kind: T }> | undefined;
}

function appendAoa(wb: XLSX.WorkBook, name: string, rows: unknown[][]) {
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, sheet, name.slice(0, 31));
}

function appendCoverAndSummarySheet(wb: XLSX.WorkBook, cover: CoverPage | undefined, summary: ExecutiveSummaryPage | undefined) {
  if (!cover) return;
  const rows: unknown[][] = [
    ["Executive Reporting Engine — NEXO"],
    ["Tipo de reporte", cover.tipoReporteLabel],
    ["Período", cover.periodLabel],
    ["Fecha de corte", cover.fechaCorteLabel],
    ["Generado", cover.generatedAtLabel],
    ["Generado por", cover.generatedByName],
    ["Report ID", cover.reportId],
    ["Estado General", cover.estadoGeneralLabel],
    ["Score General", cover.scoreGeneral ?? "—"],
    ["Analytics Engine", `v${cover.analyticsEngineVersion}`],
    ["Formula Set", `v${cover.formulaSetVersion}`],
    [],
  ];
  if (summary) {
    rows.push(["EXECUTIVE SUMMARY"], ["Situación General", summary.situacionGeneral], ["Fortalezas", summary.fortalezas], ["Aspectos de Atención", summary.aspectosAtencion], ["Conclusión", summary.conclusion]);
  }
  appendAoa(wb, "Resumen", rows);
}

function appendTeamStatusSheet(wb: XLSX.WorkBook, page: TeamStatusPage | undefined) {
  if (!page) return;
  const rows: unknown[][] = [["Indicador", "Valor", "Meta", "Estado", "Interpretación", "Impacto", "Recomendación"]];
  for (const i of page.indicators) rows.push([i.nombre, i.valor, i.meta, i.estado, i.interpretacion, i.impacto, i.recomendacion]);
  appendAoa(wb, "Estado General", rows);
}

function appendStrategicIndicatorsSheet(wb: XLSX.WorkBook, page: StrategicIndicatorsPage | undefined) {
  if (!page) return;
  const rows: unknown[][] = [["KPI", "Valor", "Detalle"]];
  for (const k of page.kpis) rows.push([k.label, k.valor, k.sublabel]);
  rows.push([], ["RANKING"], ["#", "Nombre", "Rol", "Score", "Cumplimiento"]);
  page.ranking.forEach((r, i) => rows.push([i + 1, r.name, r.role, r.score, `${r.completedPct}%`]));
  appendAoa(wb, "Indicadores Estrategicos", rows);
}

function appendMemberDetailSheet(wb: XLSX.WorkBook, page: MemberDetailPage | undefined) {
  if (!page) return;
  const rows: unknown[][] = [["Nombre", "Rol", "Score", "Cumplimiento", "Carga %", "Carga (h)", "Vencidas", "Consultas", "Equilibrio Operativo", "Acción sugerida"]];
  for (const m of page.members) {
    rows.push([m.name, m.role, m.score, `${m.completedPct}%`, `${m.cargaPct}%`, `${m.cargaRealHours}h / ${m.cargaBaseHours}h`, m.overdueCount, m.seguimientoTotal, m.estadoOperativo?.estado ?? "—", m.principalHallazgo ?? "—"]);
  }
  appendAoa(wb, "Detalle por Colaborador", rows);
}

function appendOperationalDistributionSheet(wb: XLSX.WorkBook, page: OperationalDistributionPage | undefined) {
  if (!page) return;
  const rows: unknown[][] = [["Motivo", "Cantidad", "Minutos", "%", "Tendencia %", "Interpretación"]];
  for (const m of page.consultasByReason) rows.push([m.reason, m.count, m.totalMinutes, m.pct ?? "", m.trendPct ?? "", m.interpretation ?? ""]);
  rows.push([], ["MATRIZ DE RIESGO"], ["Nombre", "Cumplimiento", "Carga %", "Cuadrante"]);
  for (const q of page.riskQuadrant) rows.push([q.name, `${q.completedPct}%`, `${q.cargaPct}%`, q.quadrant]);
  appendAoa(wb, "Distribucion Operativa", rows);
}

function appendInsightsSheet(wb: XLSX.WorkBook, page: InsightsPage | undefined) {
  if (!page) return;
  const rows: unknown[][] = [["EXECUTIVE INSIGHTS"], [], ["Patrones"], ...page.patrones.map((p) => [p]), [], ["Cambios"], ...page.cambios.map((p) => [p]), [], ["Anomalías"], ...page.anomalias.map((p) => [p]), [], ["Relaciones Cruzadas"], ...page.relacionesCruzadas.map((p) => [p])];
  appendAoa(wb, "Insights", rows);
}

function appendAssessmentSheet(wb: XLSX.WorkBook, page: AssessmentPage | undefined) {
  if (!page) return;
  const rows: unknown[][] = [
    ["EXECUTIVE ASSESSMENT BY NOVA"],
    [],
    ["Diagnóstico General"],
    [page.diagnosticoGeneral],
    [],
    ["Fortalezas Estratégicas"],
    ...page.fortalezasEstrategicas.map((f) => [f]),
    [],
    ["Riesgos Detectados"],
    ...page.riesgosDetectados.map((r) => [r]),
    [],
    ["Oportunidades"],
    ...page.oportunidades.map((o) => [o]),
    [],
    ["Prioridades"],
    ...page.prioridades.map((p) => [p]),
    [],
    ["Perspectiva Estratégica"],
    [page.perspectivaEstrategica],
    [],
    ["Opinión Ejecutiva"],
    [page.opinionEjecutiva],
  ];
  appendAoa(wb, "Executive Assessment", rows);
}

function recommendationRow(r: RecommendationRow): unknown[] {
  return [
    r.priority === "alta" ? "ALTA" : "MEDIA",
    r.text,
    r.enrichment?.justificacion ?? "",
    r.enrichment?.impactoEsperado ?? "",
    r.enrichment?.areaAfectada ?? "",
    r.enrichment?.beneficio ?? "",
    r.enrichment?.complejidadEstimada ?? "",
    r.enrichment?.tiempoEstimado ?? "",
    r.enrichment?.responsableSugerido ?? "",
  ];
}

function appendRecommendationsSheet(wb: XLSX.WorkBook, page: RecommendationsPage | undefined) {
  if (!page) return;
  const rows: unknown[][] = [["Prioridad", "Recomendación", "Justificación", "Impacto Esperado", "Área Afectada", "Beneficio", "Complejidad Estimada", "Tiempo Estimado", "Responsable Sugerido"]];
  for (const r of page.alta) rows.push(recommendationRow(r));
  for (const r of page.media) rows.push(recommendationRow(r));
  appendAoa(wb, "Recomendaciones", rows);
}

function appendPredictiveSheet(wb: XLSX.WorkBook, page: PredictivePage | undefined) {
  if (!page) return;
  if (!page.available) {
    appendAoa(wb, "Analytics Predictivo", [["ANALYTICS PREDICTIVO"], [page.message]]);
    return;
  }
  const rows: unknown[][] = [
    ["ANALYTICS PREDICTIVO", `Proyección al ${page.asOfLabel}`],
    ["Horizonte (días)", page.horizonDays],
    ["Cumplimiento esperado al cierre", page.avgCumplimientoEsperadoCierrePct !== null ? `${page.avgCumplimientoEsperadoCierrePct}%` : "—"],
    ["Colaboradores en riesgo de sobrecarga", page.membersAtRiskSobrecarga],
    [],
    ["Colaborador", "Cumplimiento", "Carga", "Nivel Sobrecarga", "Subutilización", "Qué hacer"],
  ];
  for (const m of page.members) rows.push([m.name, m.cumplimientoLabel, m.sobrecargaLabel, m.sobrecargaNivel, m.subutilizacionLabel, m.queHacer.join(" · ")]);
  appendAoa(wb, "Analytics Predictivo", rows);
}

function appendMetadataSheet(wb: XLSX.WorkBook, page: MetadataPage | undefined) {
  if (!page) return;
  const rows: unknown[][] = [
    ["Report ID", page.reportId],
    ["Generado por", page.generatedByName],
    ["Fecha de generación", page.generatedAtLabel],
    ["Fecha de corte", page.fechaCorteLabel],
    ["Período", page.periodLabel],
    ["Tipo de reporte", page.tipoReporteLabel],
    ["Estado del período", page.periodStatusLabel],
    ["Colaboradores incluidos", page.collaboratorCount],
    ["Versión Analytics Engine", `v${page.analyticsEngineVersion}`],
    ["Versión Formula Set", `v${page.formulaSetVersion}`],
    ["Versión Executive Reporting Engine", `v${page.reportingEngineVersion}`],
    ["Versión NEXO", `v${page.nexoVersion}`],
    ["Calidad del dato", `${page.dataQualityPct}%`],
    ["Tiempo de generación", page.generationMsLabel],
  ];
  appendAoa(wb, "Metadatos", rows);
}

export function buildExecutiveReportWorkbook(pages: ReportPage[]): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  appendCoverAndSummarySheet(wb, findPage(pages, "cover"), findPage(pages, "executiveSummary"));
  appendTeamStatusSheet(wb, findPage(pages, "teamStatus"));
  appendStrategicIndicatorsSheet(wb, findPage(pages, "strategicIndicators"));
  appendMemberDetailSheet(wb, findPage(pages, "memberDetail"));
  appendOperationalDistributionSheet(wb, findPage(pages, "operationalDistribution"));
  appendInsightsSheet(wb, findPage(pages, "insights"));
  appendAssessmentSheet(wb, findPage(pages, "assessment"));
  appendRecommendationsSheet(wb, findPage(pages, "recommendations"));
  appendPredictiveSheet(wb, findPage(pages, "predictive"));
  appendMetadataSheet(wb, findPage(pages, "metadata"));
  return wb;
}

export function downloadExecutiveReportExcel(pages: ReportPage[], fileName: string): void {
  const wb = buildExecutiveReportWorkbook(pages);
  XLSX.writeFile(wb, fileName);
}
