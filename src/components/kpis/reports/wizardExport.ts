import type { Role } from "@/generated/prisma/client";
import { ROLE_LABEL } from "@/lib/roles";
import { hoursToDisplay } from "@/lib/timeFormat";
import { openReportWindow } from "../reportWindow";
import * as XLSX from "xlsx";
import type {
  ReportData,
  RangeReportData,
  PeriodReportData,
  ReportMemberKpi,
  MotivoDistributionItem,
  IndiceEjecutivoData,
  Finding,
  Recommendation,
} from "../types";

/**
 * Sprint Analytics 2.1 (Bloques 4-8) — Generador Inteligente de Reportes.
 * Normaliza las 3 formas de datos que puede devolver el backend (informe de
 * un mes / de un rango de meses / de un rango de fechas arbitrario) a una
 * única forma, y arma la exportación (PDF Ejecutivo, PDF Completo o Excel)
 * respetando exactamente los colaboradores/período/secciones que el usuario
 * eligió en el asistente. No recalcula ningún KPI — solo reorganiza datos
 * que las rutas /api/reports/* ya devuelven.
 */

export type WizardSectionKey =
  | "resumen"
  | "kpis"
  | "equilibrio"
  | "ranking"
  | "tendencias"
  | "consultas"
  | "hallazgos"
  | "recomendaciones"
  | "detalle"
  | "anexos";

export const WIZARD_SECTION_LABEL: Record<WizardSectionKey, string> = {
  resumen: "Resumen Ejecutivo",
  kpis: "KPIs",
  equilibrio: "Equilibrio Operativo",
  ranking: "Ranking",
  tendencias: "Tendencias",
  consultas: "Consultas",
  hallazgos: "Hallazgos",
  recomendaciones: "Recomendaciones",
  detalle: "Detalle por colaborador",
  anexos: "Anexos",
};

export const ALL_WIZARD_SECTIONS = Object.keys(WIZARD_SECTION_LABEL) as WizardSectionKey[];

/** Secciones que siempre incluye el PDF Ejecutivo (Bloque 8) — versión condensada para dirección, sin importar qué haya tildado el usuario. */
const EJECUTIVO_SECTIONS: WizardSectionKey[] = ["resumen", "kpis", "equilibrio", "ranking", "hallazgos", "recomendaciones"];

export type WizardFormat = "pdf-ejecutivo" | "pdf-completo" | "excel";

export type NormalizedReport = {
  periodLabel: string;
  teamSummary: {
    avgCumplimiento: number;
    avgCargaPct: number;
    totalCargaRealHours: number;
    totalCargaBaseHours: number;
    totalCompletedTasks: number;
    totalTasks: number;
    totalConsultas: number;
    cargaRangeMin: number;
    cargaRangeMax: number;
  };
  members: ReportMemberKpi[];
  ranking: Array<{ id: string; name: string; role: string; score: number; completedPct: number }>;
  consultasByReason: MotivoDistributionItem[];
  alerts: Array<{ name: string; text: string }>;
  indiceEjecutivo: IndiceEjecutivoData;
  findings?: Finding[];
  recommendations?: Recommendation[];
  insights?: string[];
  aiAnalysis: string;
};

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
  SEGUIMIENTO_DOCUMENTACION: "Seguimiento de documentación",
  SOLICITUDES_INTERNAS: "Solicitudes internas",
};

export function normalizeMonthReport(data: ReportData, periodLabel: string): NormalizedReport {
  return {
    periodLabel,
    teamSummary: data.teamSummary,
    members: data.members,
    ranking: data.ranking,
    consultasByReason: data.consultasByReason,
    alerts: data.alerts.map((a) => ({ name: a.name, text: a.type === "cumplimiento" ? `Cumplimiento crítico: ${a.value}%` : `Sobrecarga laboral: ${a.value}%` })),
    indiceEjecutivo: data.indiceEjecutivo ?? null,
    findings: data.findings,
    recommendations: data.recommendations,
    insights: data.insights,
    aiAnalysis: "",
  };
}

export function normalizeRangeReport(data: RangeReportData, periodLabel: string): NormalizedReport {
  return {
    periodLabel,
    teamSummary: { ...data.aggregated.teamSummary, totalConsultas: data.aggregated.teamSummary.totalConsultas },
    members: data.aggregated.members,
    ranking: data.aggregated.ranking.map((m) => ({ id: m.id, name: m.name, role: m.role, score: m.avgScore, completedPct: m.avgCumplimiento })),
    consultasByReason: data.aggregated.consultasByReason,
    alerts: data.aggregated.alerts.map((a) => ({ name: a.name, text: a.type === "cumplimiento" ? `Cumplimiento promedio ${a.avgValue}% en ${a.monthsAffected} meses` : `Sobrecarga promedio ${a.avgValue}% en ${a.monthsAffected} meses` })),
    indiceEjecutivo: null,
    findings: data.aggregated.findings,
    recommendations: data.aggregated.recommendations,
    insights: data.aggregated.insights,
    aiAnalysis: "",
  };
}

export function normalizeCustomReport(data: PeriodReportData): NormalizedReport {
  return {
    periodLabel: data.periodLabel,
    teamSummary: data.teamSummary,
    members: data.members,
    ranking: data.ranking,
    consultasByReason: data.consultasByReason,
    alerts: data.alerts.map((a) => ({ name: a.name, text: a.type === "cumplimiento" ? `Cumplimiento crítico: ${a.value}%` : `Sobrecarga laboral: ${a.value}%` })),
    indiceEjecutivo: null,
    findings: data.findings,
    recommendations: data.recommendations,
    insights: data.insights,
    aiAnalysis: "",
  };
}

function sectionsFor(sections: Set<WizardSectionKey>, variant: "ejecutivo" | "completo"): Set<WizardSectionKey> {
  if (variant === "completo") return sections;
  return new Set(EJECUTIVO_SECTIONS.filter((s) => sections.has(s)));
}

function horasCellText(real: number, base: number): string {
  const pct = base > 0 ? Math.round((real / base) * 100) : 0;
  return `${hoursToDisplay(real)}h / ${hoursToDisplay(base)}h — ${pct}%`;
}

// ── PDF ──────────────────────────────────────────────────────────────────────

export function buildWizardPdfHtml(n: NormalizedReport, sectionsIn: Set<WizardSectionKey>, variant: "ejecutivo" | "completo"): { styles: string; bodyHtml: string } {
  const sections = sectionsFor(sectionsIn, variant);
  const blocks: string[] = [];

  if (sections.has("resumen")) {
    const indiceHtml = n.indiceEjecutivo
      ? `<div class="stat" style="text-align:left"><div class="stat-label">Índice Ejecutivo del Equipo</div><div class="stat-value" style="font-size:22px">${n.indiceEjecutivo.valor}/100 — ${n.indiceEjecutivo.nivel}</div><div style="font-size:11px;color:#64748b">${n.indiceEjecutivo.explicacion}</div></div>`
      : `<p style="color:#64748b">Índice Ejecutivo disponible solo al generar el informe del mes calendario en curso.</p>`;
    blocks.push(`<h2>Resumen Ejecutivo</h2><div class="stats" style="grid-template-columns:1fr">${indiceHtml}</div>`);
    const alertsHtml = n.alerts.length > 0
      ? n.alerts.map((a) => `<div class="alert">⚠️ <strong>${a.name}</strong>: ${a.text}</div>`).join("")
      : '<p style="color:#64748b">Sin alertas críticas este período.</p>';
    blocks.push(`<h2>Alertas</h2>${alertsHtml}`);
  }

  if (sections.has("kpis")) {
    blocks.push(`<h2>KPIs del Equipo</h2>
    <div class="stats">
      <div class="stat"><div class="stat-label">Cumplimiento promedio</div><div class="stat-value">${n.teamSummary.avgCumplimiento}%</div></div>
      <div class="stat"><div class="stat-label">Tareas completadas</div><div class="stat-value">${n.teamSummary.totalCompletedTasks}<span style="font-size:14px;color:#94a3b8">/${n.teamSummary.totalTasks}</span></div></div>
      <div class="stat"><div class="stat-label">Carga laboral</div><div class="stat-value" style="font-size:16px">${n.teamSummary.avgCargaPct}%<span style="color:#94a3b8;font-size:12px"> (${hoursToDisplay(n.teamSummary.totalCargaRealHours)}h/${hoursToDisplay(n.teamSummary.totalCargaBaseHours)}h)</span></div></div>
      <div class="stat"><div class="stat-label">Consultas</div><div class="stat-value" style="font-size:16px">${n.teamSummary.totalConsultas}</div></div>
    </div>`);
  }

  if (sections.has("equilibrio")) {
    const rows = n.members
      .map((m) => `<tr><td>${m.name}</td><td>${m.estadoOperativo ? `${m.estadoOperativo.emoji} ${m.estadoOperativo.estado}` : "—"}</td></tr>`)
      .join("");
    blocks.push(`<h2>Equilibrio Operativo por Colaborador</h2><table><thead><tr><th>Colaborador</th><th>Estado</th></tr></thead><tbody>${rows}</tbody></table>`);
  }

  if (sections.has("ranking")) {
    const rows = n.ranking.map((m, i) => `<tr><td>${i + 1}</td><td>${m.name}</td><td style="font-size:11px">${ROLE_LABEL[m.role as Role] ?? m.role}</td><td><strong>${m.score}/100</strong></td><td>${m.completedPct}%</td></tr>`).join("");
    blocks.push(`<h2>Ranking</h2><table><thead><tr><th>#</th><th>Nombre</th><th>Cargo</th><th>Score</th><th>Cumplimiento</th></tr></thead><tbody>${rows}</tbody></table>`);
  }

  if (sections.has("detalle")) {
    const anyProrated = n.members.some((m) => m.baseWasProrated);
    const rows = n.members
      .map(
        (m) => `<tr>
        <td>${m.name}</td><td style="font-size:11px">${ROLE_LABEL[m.role as Role] ?? m.role}</td>
        <td><strong>${m.score}</strong></td><td>${m.completedPct}%</td><td>${m.cargaPct}%</td>
        <td>${m.completedTasks}/${m.totalTasks}</td><td>${m.overdueCount}</td>
        <td>${horasCellText(m.cargaRealHours, m.cargaBaseHours)}${m.baseWasProrated ? " *" : ""}</td>
        <td>${m.seguimientoTotal}</td>
        <td>${m.estadoOperativo ? `${m.estadoOperativo.emoji} ${m.estadoOperativo.estado}` : "—"}</td>
        <td style="font-size:11px">${m.principalHallazgo ?? "—"}</td>
      </tr>`,
      )
      .join("");
    blocks.push(`<h2>Detalle por Colaborador</h2>
    <table><thead><tr><th>Nombre</th><th>Cargo</th><th>Score</th><th>Cumpl%</th><th>Carga%</th><th>Compl/Total</th><th>Vencidas</th><th>Horas (real / base — %)</th><th>Consultas</th><th>Estado</th><th>Principal Hallazgo</th></tr></thead><tbody>${rows}</tbody></table>
    ${anyProrated ? `<p style="font-size:11px;color:#64748b;margin-top:6px"><strong>*</strong> Base Horaria Efectiva: la base de este colaborador corresponde únicamente al período en que tuvo disponibilidad real para registrar actividades en NEXO.</p>` : ""}`);
  }

  if (sections.has("consultas") && n.consultasByReason.length > 0) {
    const rows = n.consultasByReason
      .map((r) => `<tr><td>${REASON_LABEL[r.reason] ?? r.reason}${r.interpretation ? `<div style="font-size:10px;color:#64748b;margin-top:2px">${r.interpretation}</div>` : ""}</td><td>${r.count}</td><td>${typeof r.pct === "number" ? `${r.pct}%` : "—"}</td><td>${typeof r.trendPct === "number" ? `${r.trendPct > 0 ? "+" : ""}${r.trendPct}%` : "—"}</td></tr>`)
      .join("");
    blocks.push(`<h2>Consultas por Motivo</h2><table><thead><tr><th>Motivo</th><th>Consultas</th><th>%</th><th>Tendencia</th></tr></thead><tbody>${rows}</tbody></table>`);
  }

  if (sections.has("hallazgos") && n.findings && n.findings.length > 0) {
    blocks.push(`<h2>Hallazgos</h2><ul>${n.findings.map((f) => `<li>${f.text}</li>`).join("")}</ul>`);
  }

  if (sections.has("recomendaciones") && n.recommendations && n.recommendations.length > 0) {
    blocks.push(`<h2>Recomendaciones</h2><ul>${n.recommendations.map((r) => `<li><strong>[${r.priority === "alta" ? "Prioridad alta" : "Prioridad media"}]</strong> ${r.text}</li>`).join("")}</ul>`);
  }

  if (sections.has("anexos")) {
    const rows = n.members
      .filter((m) => m.byReason.length > 0)
      .map(
        (m) => `<tr><td colspan="3" style="background:#f8fafc;font-weight:700">${m.name}</td></tr>` +
          m.byReason.map((r) => `<tr><td></td><td>${REASON_LABEL[r.reason] ?? r.reason}</td><td>${r.count} (${r.totalMinutes} min)</td></tr>`).join(""),
      )
      .join("");
    blocks.push(`<h2>Anexos — Consultas por Motivo y Colaborador</h2><table><thead><tr><th></th><th>Motivo</th><th>Consultas</th></tr></thead><tbody>${rows}</tbody></table>`);
  }

  const styles = `
  body{font-family:system-ui,sans-serif;padding:32px;color:#1e293b;max-width:900px;margin:0 auto;font-size:13px}
  h1{color:#4f46e5;margin-bottom:4px;font-size:22px}
  h2{margin-top:28px;margin-bottom:8px;font-size:13px;text-transform:uppercase;letter-spacing:.06em;color:#475569;border-bottom:1px solid #e2e8f0;padding-bottom:6px}
  .meta{color:#64748b;font-size:12px;margin-bottom:20px}
  .stats{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:12px 0}
  .stat{border:1px solid #e2e8f0;border-radius:8px;padding:12px;text-align:center}
  .stat-label{font-size:10px;text-transform:uppercase;color:#94a3b8;letter-spacing:.04em}
  .stat-value{font-size:22px;font-weight:700;color:#4f46e5;margin:4px 0}
  .alert{background:#fef2f2;border:1px solid #fecaca;border-radius:6px;padding:8px 12px;margin:4px 0;font-size:12px}
  table{width:100%;border-collapse:collapse;font-size:11px;margin-top:8px}
  th{background:#f8fafc;text-align:left;padding:7px 8px;border:1px solid #e2e8f0;font-size:10px;text-transform:uppercase;letter-spacing:.04em;color:#64748b}
  td{padding:7px 8px;border:1px solid #e2e8f0}
  tr:nth-child(even) td{background:#fafafa}
  @media print{body{padding:16px}}`;

  const bodyHtml = `
  <h1>Informe Ejecutivo — ${variant === "ejecutivo" ? "Versión Ejecutiva" : "Versión Completa"}</h1>
  <div class="meta">Período: <strong>${n.periodLabel}</strong> &bull; Generado el ${new Date().toLocaleDateString("es-CL")}</div>
  ${blocks.join("\n")}`;

  return { styles, bodyHtml };
}

export function downloadWizardPDF(n: NormalizedReport, sections: Set<WizardSectionKey>, variant: "ejecutivo" | "completo") {
  const { styles, bodyHtml } = buildWizardPdfHtml(n, sections, variant);
  const fileSuffix = variant === "ejecutivo" ? "Ejecutivo" : "Completo";
  openReportWindow({
    title: `Informe ${fileSuffix} — ${n.periodLabel}`,
    styles,
    bodyHtml,
    pdfFileName: `Informe_${fileSuffix}_${n.periodLabel.replace(/[\s,—]+/g, "_")}.pdf`,
  });
}

// ── Excel ────────────────────────────────────────────────────────────────────

export function downloadWizardExcel(n: NormalizedReport, sections: Set<WizardSectionKey>) {
  const wb = XLSX.utils.book_new();

  if (sections.has("resumen") || sections.has("kpis")) {
    const rows = [
      ["Informe Personalizado", ""],
      ["Período", n.periodLabel],
      ["Generado", new Date().toLocaleDateString("es-CL")],
      [""],
      ["RESUMEN DEL EQUIPO", ""],
      ["Cumplimiento promedio", `${n.teamSummary.avgCumplimiento}%`],
      ["Tareas completadas", `${n.teamSummary.totalCompletedTasks} / ${n.teamSummary.totalTasks}`],
      ["Carga laboral", `${n.teamSummary.avgCargaPct}% (${hoursToDisplay(n.teamSummary.totalCargaRealHours)}h de ${hoursToDisplay(n.teamSummary.totalCargaBaseHours)}h base)`],
      ["Total consultas", n.teamSummary.totalConsultas],
      ...(n.indiceEjecutivo ? [[""], ["Índice Ejecutivo", `${n.indiceEjecutivo.valor}/100 — ${n.indiceEjecutivo.nivel}`]] : []),
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "Resumen");
  }

  if (sections.has("ranking")) {
    const rows = [["#", "Nombre", "Cargo", "Score", "Cumplimiento%"], ...n.ranking.map((m, i) => [i + 1, m.name, ROLE_LABEL[m.role as Role] ?? m.role, m.score, `${m.completedPct}%`])];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "Ranking");
  }

  if (sections.has("detalle")) {
    const rows = [
      ["Nombre", "Cargo", "Score", "Cumplimiento%", "Carga%", "Tareas", "Completadas", "Vencidas", "Horas reales", "Base efectiva (h)", "Base prorrateada", "Consultas", "Estado", "Principal Hallazgo"],
      ...n.members.map((m) => [
        m.name, ROLE_LABEL[m.role as Role] ?? m.role, m.score, m.completedPct, m.cargaPct,
        m.totalTasks, m.completedTasks, m.overdueCount, hoursToDisplay(m.cargaRealHours), hoursToDisplay(m.cargaBaseHours),
        m.baseWasProrated ? "Sí" : "No", m.seguimientoTotal,
        m.estadoOperativo ? `${m.estadoOperativo.emoji} ${m.estadoOperativo.estado}` : "",
        m.principalHallazgo ?? "",
      ]),
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "Detalle");
  }

  if (sections.has("consultas") && n.consultasByReason.length > 0) {
    const rows = [
      ["Motivo", "Consultas", "%", "Tendencia", "Interpretación"],
      ...n.consultasByReason.map((r) => [REASON_LABEL[r.reason] ?? r.reason, r.count, typeof r.pct === "number" ? `${r.pct}%` : "", typeof r.trendPct === "number" ? `${r.trendPct}%` : "", r.interpretation ?? ""]),
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "Consultas");
  }

  if ((sections.has("hallazgos") && (n.findings?.length ?? 0) > 0) || (sections.has("recomendaciones") && (n.recommendations?.length ?? 0) > 0)) {
    const rows = [
      ...(sections.has("hallazgos") ? [["HALLAZGOS", ""], ...(n.findings ?? []).map((f) => ["", f.text])] : []),
      [""],
      ...(sections.has("recomendaciones") ? [["RECOMENDACIONES", ""], ...(n.recommendations ?? []).map((r) => [r.priority === "alta" ? "Prioridad alta" : "Prioridad media", r.text])] : []),
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "Hallazgos y Recomendaciones");
  }

  if (sections.has("anexos")) {
    const rows = [
      ["Colaborador", "Motivo", "Consultas", "Minutos"],
      ...n.members.flatMap((m) => m.byReason.map((r) => [m.name, REASON_LABEL[r.reason] ?? r.reason, r.count, r.totalMinutes])),
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "Anexos");
  }

  XLSX.writeFile(wb, `Informe_Personalizado_${n.periodLabel.replace(/[\s,—]+/g, "_")}.xlsx`);
}
