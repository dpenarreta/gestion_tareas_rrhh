"use client";

import { useState, useEffect, useCallback } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ReferenceLine,
} from "recharts";
import type { Role } from "@/generated/prisma/client";
import { ROLE_LABEL } from "@/lib/roles";
import type { MonthlyReportSummary, MonthlyReportFull, ReportData, RangeReportData, WorkloadColor } from "./types";
import * as XLSX from "xlsx";
import { formatDate } from "@/lib/utils";
import { hoursToDisplay } from "@/lib/timeFormat";
import { openReportWindow } from "./reportWindow";
import { Button } from "@/components/ui/Button";
import { Table, TableHead, TableBody, TableRow, Th, Td } from "@/components/ui/Table";
import { Spinner } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { useToast } from "@/components/ui/Toast";
import { BarChart3, FileText, Download, Lightbulb } from "lucide-react";
import { ExecutiveSummarySection } from "./reports/ExecutiveSummarySection";
import { FindingsSection } from "./reports/FindingsSection";
import { RecommendationsSection } from "./reports/RecommendationsSection";
import { RiskMatrixChart } from "./reports/RiskMatrixChart";
import { TrendsSection } from "./reports/TrendsSection";
import { TeamInsightsSection } from "./reports/TeamInsightsSection";
import { IndicatorInterpretation } from "./reports/IndicatorInterpretation";

// ── Helpers ──────────────────────────────────────────────────────────────────

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

const MONTH_NAMES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

function formatMonthYear(month: number, year: number) {
  return `${MONTH_NAMES[month - 1]} ${year}`;
}

function currentMonthParam() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function formatMonthLabel(monthParam: string) {
  const [y, m] = monthParam.split("-").map(Number);
  return formatMonthYear(m, y);
}

function colorDot(pct: number) {
  if (pct >= 80) return "bg-success";
  if (pct >= 60) return "bg-warning";
  return "bg-danger";
}

const KPI_COLOR_DOT: Record<WorkloadColor, string> = {
  green: "bg-success",
  yellow: "bg-warning",
  orange: "bg-orange-500",
  red: "bg-danger",
};

// ── Excel export ──────────────────────────────────────────────────────────────

function downloadReportExcel(report: MonthlyReportFull) {
  const data = report.data;
  const periodLabel = formatMonthYear(report.month, report.year);
  const wb = XLSX.utils.book_new();

  // Sheet 1: Summary
  const summaryRows = [
    ["Informe Mensual Consolidado", ""],
    ["Período", periodLabel],
    ["Generado por", report.generatedBy],
    ["Fecha generación", new Date(report.updatedAt).toLocaleDateString("es-CL")],
    [""],
    ["RESUMEN DEL EQUIPO", ""],
    ["Promedio de cumplimiento", `${data.teamSummary.avgCumplimiento}%`],
    ["Total tareas completadas", `${data.teamSummary.totalCompletedTasks} / ${data.teamSummary.totalTasks}`],
    ["Carga laboral del equipo", `${data.teamSummary.avgCargaPct}% (${hoursToDisplay(data.teamSummary.totalCargaRealHours)}h de ${hoursToDisplay(data.teamSummary.totalCargaBaseHours)}h base)`],
    ["Rango óptimo configurado (por persona)", `${hoursToDisplay(data.teamSummary.cargaRangeMin)}h a ${hoursToDisplay(data.teamSummary.cargaRangeMax)}h`],
    ["Total consultas SEGUIMIENTO", data.teamSummary.totalConsultas],
    [""],
    ["ALERTAS", ""],
    ...data.alerts.map((a) => [
      a.name,
      a.type === "cumplimiento" ? `Cumplimiento crítico: ${a.value}%` : `Sobrecarga laboral: ${a.value}%`,
    ]),
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summaryRows), "Resumen");

  // Sheet 2: Ranking
  const rankingRows = [
    ["#", "Nombre", "Cargo", "Score /100", "Cumplimiento %"],
    ...data.ranking.map((m, i) => [
      i + 1,
      m.name,
      ROLE_LABEL[m.role as Role] ?? m.role,
      m.score,
      `${m.completedPct}%`,
    ]),
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rankingRows), "Ranking");

  // Sheet 3: Detail per person
  const detailRows = [
    ["Nombre", "Cargo", "Score", "Cumplimiento%", "Carga%", "Carga (rango)", "Tareas", "Completadas", "Vencidas", "Horas reales", "Base (h)", "Consultas"],
    ...data.members.map((m) => [
      m.name,
      ROLE_LABEL[m.role as Role] ?? m.role,
      m.score,
      m.completedPct,
      m.cargaPct,
      m.cargaLabel,
      m.totalTasks,
      m.completedTasks,
      m.overdueCount,
      hoursToDisplay(m.cargaRealHours),
      hoursToDisplay(m.cargaBaseHours),
      m.seguimientoTotal,
    ]),
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(detailRows), "Detalle");

  // Sheet 4: Consultas by reason
  if (data.consultasByReason.length > 0) {
    const consultasRows = [
      ["Motivo", "Total Consultas", "Total Minutos"],
      ...data.consultasByReason.map((r) => [
        REASON_LABEL[r.reason] ?? r.reason,
        r.count,
        r.totalMinutes,
      ]),
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(consultasRows), "Consultas");
  }

  // Sheet 5: AI Analysis
  if (report.aiAnalysis) {
    const aiRows = [["Análisis IA"], [report.aiAnalysis]];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aiRows), "Análisis IA");
  }

  XLSX.writeFile(wb, `Informe_Consolidado_${periodLabel.replace(/\s/g, "_")}.xlsx`);
}

// ── PDF export ────────────────────────────────────────────────────────────────

function downloadReportPDF(report: MonthlyReportFull) {
  const data = report.data;
  const periodLabel = formatMonthYear(report.month, report.year);

  const rankingRows = data.ranking
    .map(
      (m, i) => `<tr>
      <td>${i + 1}</td>
      <td>${m.name}</td>
      <td>${ROLE_LABEL[m.role as Role] ?? m.role}</td>
      <td><strong>${m.score}/100</strong></td>
      <td>${m.completedPct}%</td>
    </tr>`,
    )
    .join("");

  const memberRows = data.members
    .map(
      (m) => `<tr>
      <td>${m.name}</td>
      <td style="font-size:11px">${ROLE_LABEL[m.role as Role] ?? m.role}</td>
      <td><strong>${m.score}</strong></td>
      <td>${m.completedPct}%</td>
      <td>${m.cargaPct}%</td>
      <td>${m.completedTasks}/${m.totalTasks}</td>
      <td>${m.overdueCount}</td>
      <td>${hoursToDisplay(m.cargaRealHours)}h/${hoursToDisplay(m.cargaBaseHours)}h</td>
      <td>${m.seguimientoTotal}</td>
    </tr>`,
    )
    .join("");

  const alertsHtml =
    data.alerts.length > 0
      ? data.alerts
          .map(
            (a) =>
              `<div class="alert">⚠️ <strong>${a.name}</strong>: ${
                a.type === "cumplimiento"
                  ? `Cumplimiento crítico (${a.value}%)`
                  : `Sobrecarga laboral (${a.value}%)`
              }</div>`,
          )
          .join("")
      : '<p style="color:#64748b">Sin alertas críticas este mes.</p>';

  const consultasHtml =
    data.consultasByReason.length > 0
      ? `<table>
    <thead><tr><th>Motivo</th><th>Consultas</th><th>%</th><th>Total min</th></tr></thead>
    <tbody>
      ${data.consultasByReason
        .map(
          (r) => `<tr>
        <td>${REASON_LABEL[r.reason] ?? r.reason}${r.interpretation ? `<div style="font-size:10px;color:#64748b;margin-top:2px">${r.interpretation}</div>` : ""}</td>
        <td>${r.count}</td>
        <td>${typeof r.pct === "number" ? `${r.pct}%` : "—"}</td>
        <td>${r.totalMinutes}</td>
      </tr>`,
        )
        .join("")}
    </tbody>
  </table>`
      : '<p style="color:#64748b">Sin consultas SEGUIMIENTO en este período.</p>';

  // Sprint Reportes Ejecutivos 2.0 — Resumen Ejecutivo / Hallazgos /
  // Recomendaciones / Tendencias / Mapa de Riesgo para la versión impresa
  // (HTML estático — un scatter de recharts no es viable aquí, se
  // representa como tabla por cuadrante).
  const indiceHtml = data.indiceEjecutivo
    ? `<div class="stat" style="text-align:left"><div class="stat-label">Índice Ejecutivo del Equipo</div>
      <div class="stat-value" style="font-size:22px">${data.indiceEjecutivo.valor}/100 — ${data.indiceEjecutivo.nivel}</div>
      <div style="font-size:11px;color:#64748b">${data.indiceEjecutivo.explicacion}${data.indiceEjecutivo.variacion !== null ? ` (${data.indiceEjecutivo.variacion >= 0 ? "+" : ""}${data.indiceEjecutivo.variacion} pts vs. mes anterior)` : ""}</div></div>`
    : `<p style="color:#64748b">Índice Ejecutivo disponible solo al generar el informe del mes en curso.</p>`;

  const findingsHtml =
    data.findings && data.findings.length > 0
      ? `<ul>${data.findings.map((f) => `<li>${f.text}</li>`).join("")}</ul>`
      : '<p style="color:#64748b">Sin hallazgos relevantes este período.</p>';

  const recommendationsHtml =
    data.recommendations && data.recommendations.length > 0
      ? `<ul>${data.recommendations.map((r) => `<li><strong>[${r.priority === "alta" ? "Prioridad alta" : "Prioridad media"}]</strong> ${r.text}</li>`).join("")}</ul>`
      : '<p style="color:#64748b">Sin recomendaciones adicionales este período.</p>';

  const trendsHtml = data.trends
    ? `<table>
    <thead><tr><th>Comparación</th><th>Actual</th><th>Referencia</th><th>Variación</th></tr></thead>
    <tbody>
      ${[data.trends.mesAnterior, data.trends.trimestre, data.trends.semestre]
        .map(
          (t) => `<tr>
        <td>${t.label}</td><td>${t.currentValue}%</td>
        <td>${t.compareValue !== null ? `${t.compareValue}%` : "—"}</td>
        <td>${t.delta !== null ? `${t.delta >= 0 ? "+" : ""}${t.delta} pp` : "Sin datos"}</td>
      </tr>`,
        )
        .join("")}
    </tbody>
  </table>`
    : "";

  const riskQuadrantHtml =
    data.riskQuadrant && data.riskQuadrant.length > 0
      ? `<table>
    <thead><tr><th>Colaborador</th><th>Cumplimiento</th><th>Carga</th><th>Cuadrante</th></tr></thead>
    <tbody>
      ${data.riskQuadrant
        .map(
          (p) => `<tr>
        <td>${p.name}</td><td>${p.completedPct}%</td><td>${p.cargaPct}%</td>
        <td>${{ criticos: "Crítico", "atencion-carga": "Atención (carga)", "atencion-cumplimiento": "Atención (cumplimiento)", saludables: "Saludable" }[p.quadrant]}</td>
      </tr>`,
        )
        .join("")}
    </tbody>
  </table>`
      : "";

  const insightsHtml =
    data.insights && data.insights.length > 0 ? `<ul>${data.insights.map((i) => `<li>${i}</li>`).join("")}</ul>` : "";

  const aiHtml = report.aiAnalysis
    ? `<h2>Análisis IA</h2>
  <div class="ai-analysis">${report.aiAnalysis.replace(/\n/g, "<br>").replace(/## /g, "<h3>").replace(/\*\*/g, "<strong>")}</div>`
    : "";

  const styles = `
  body{font-family:system-ui,sans-serif;padding:32px;color:#1e293b;max-width:900px;margin:0 auto;font-size:13px}
  h1{color:#4f46e5;margin-bottom:4px;font-size:22px}
  h2{margin-top:28px;margin-bottom:8px;font-size:13px;text-transform:uppercase;letter-spacing:.06em;color:#475569;border-bottom:1px solid #e2e8f0;padding-bottom:6px}
  h3{color:#334155;margin-top:16px;margin-bottom:4px;font-size:14px}
  .meta{color:#64748b;font-size:12px;margin-bottom:20px}
  .stats{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:12px 0}
  .stat{border:1px solid #e2e8f0;border-radius:8px;padding:12px;text-align:center}
  .stat-label{font-size:10px;text-transform:uppercase;color:#94a3b8;letter-spacing:.04em}
  .stat-value{font-size:22px;font-weight:700;color:#4f46e5;margin:4px 0}
  .alert{background:#fef2f2;border:1px solid #fecaca;border-radius:6px;padding:8px 12px;margin:4px 0;font-size:12px}
  .ai-analysis{background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px;font-size:12px;line-height:1.7;white-space:pre-wrap}
  table{width:100%;border-collapse:collapse;font-size:11px;margin-top:8px}
  th{background:#f8fafc;text-align:left;padding:7px 8px;border:1px solid #e2e8f0;font-size:10px;text-transform:uppercase;letter-spacing:.04em;color:#64748b}
  td{padding:7px 8px;border:1px solid #e2e8f0}
  tr:nth-child(even) td{background:#fafafa}
  @media print{body{padding:16px}}`;

  const bodyHtml = `
  <h1>Informe Mensual Consolidado</h1>
  <div class="meta">
    Período: <strong>${periodLabel}</strong> &bull;
    Generado por: <strong>${report.generatedBy}</strong> &bull;
    ${new Date(report.updatedAt).toLocaleDateString("es-CL")}
  </div>

  <h2>Resumen Ejecutivo</h2>
  <div class="stats" style="grid-template-columns:1fr">
    ${indiceHtml}
  </div>

  <h2>Hallazgos Principales</h2>
  ${findingsHtml}

  <h2>Resumen del Equipo</h2>
  <div class="stats">
    <div class="stat">
      <div class="stat-label">Cumplimiento promedio</div>
      <div class="stat-value">${data.teamSummary.avgCumplimiento}%</div>
    </div>
    <div class="stat">
      <div class="stat-label">Tareas completadas</div>
      <div class="stat-value">${data.teamSummary.totalCompletedTasks}<span style="font-size:14px;color:#94a3b8">/${data.teamSummary.totalTasks}</span></div>
    </div>
    <div class="stat">
      <div class="stat-label">Carga laboral del equipo</div>
      <div class="stat-value" style="font-size:16px">${data.teamSummary.avgCargaPct}%<span style="color:#94a3b8;font-size:12px"> (${hoursToDisplay(data.teamSummary.totalCargaRealHours)}h/${hoursToDisplay(data.teamSummary.totalCargaBaseHours)}h)</span></div>
    </div>
    <div class="stat">
      <div class="stat-label">Rango óptimo (por persona)</div>
      <div class="stat-value" style="font-size:14px">${hoursToDisplay(data.teamSummary.cargaRangeMin)}h-${hoursToDisplay(data.teamSummary.cargaRangeMax)}h</div>
    </div>
  </div>

  <h2>Alertas</h2>
  ${alertsHtml}

  ${riskQuadrantHtml ? `<h2>Mapa de Riesgo</h2>${riskQuadrantHtml}` : ""}

  <h2>Ranking de Cumplimiento</h2>
  <table>
    <thead><tr><th>#</th><th>Nombre</th><th>Cargo</th><th>Score</th><th>Cumplimiento</th></tr></thead>
    <tbody>${rankingRows}</tbody>
  </table>

  <h2>Detalle por Colaborador</h2>
  <table>
    <thead>
      <tr>
        <th>Nombre</th><th>Cargo</th><th>Score</th><th>Cumpl%</th><th>Carga%</th>
        <th>Compl/Total</th><th>Vencidas</th><th>Horas (real/base)</th><th>Consultas</th>
      </tr>
    </thead>
    <tbody>${memberRows}</tbody>
  </table>

  <h2>Distribución por Motivo</h2>
  ${consultasHtml}

  ${trendsHtml ? `<h2>Tendencias</h2>${trendsHtml}` : ""}

  ${insightsHtml ? `<h2>Insights</h2>${insightsHtml}` : ""}

  <h2>Acciones Sugeridas</h2>
  ${recommendationsHtml}

  ${aiHtml}`;

  openReportWindow({
    title: `Informe Consolidado – ${periodLabel}`,
    styles,
    bodyHtml,
    pdfFileName: `Informe_Consolidado_${periodLabel.replace(/\s/g, "_")}.pdf`,
  });
}

// ── ReportCard ────────────────────────────────────────────────────────────────

function ReportCard({
  report,
  selected,
  onClick,
}: {
  report: MonthlyReportSummary;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-4 py-3 rounded-xl transition-all ${
        selected
          ? "bg-primary-surface ring-2 ring-primary/40"
          : "hover:bg-black/5 dark:hover:bg-white/5 ring-1 ring-transparent"
      }`}
    >
      <p className={`text-sm font-semibold ${selected ? "text-primary" : "text-title"}`}>
        {formatMonthYear(report.month, report.year)}
      </p>
      <p className="text-[11px] text-disabled mt-0.5">
        {new Date(report.updatedAt).toLocaleDateString("es-CL")}
      </p>
    </button>
  );
}

// ── MetricStat ────────────────────────────────────────────────────────────────

function MetricStat({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <div className="bg-surface rounded-xl border border-border p-4">
      <p className="text-[11px] text-disabled uppercase tracking-wider font-medium mb-1">{label}</p>
      <p className={`text-2xl font-bold ${accent ? "text-primary" : "text-title"}`}>{value}</p>
      {sub && <p className="text-xs text-disabled mt-0.5">{sub}</p>}
    </div>
  );
}

// ── Range report helpers ──────────────────────────────────────────────────────

const RANGE_LINE_COLORS = [
  "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4",
  "#f97316", "#84cc16", "#ec4899", "#0ea5e9", "#a78bfa",
];

function addMonths(base: string, n: number) {
  let [y, m] = base.split("-").map(Number);
  m += n;
  while (m > 12) { m -= 12; y++; }
  while (m <= 0) { m += 12; y--; }
  return `${y}-${String(m).padStart(2, "0")}`;
}

function downloadRangeExcel(data: RangeReportData) {
  const wb = XLSX.utils.book_new();
  const fromLabel = formatMonthLabel(data.from);
  const toLabel = formatMonthLabel(data.to);
  const periodLabel = `${fromLabel} — ${toLabel}`;

  // Sheet 1: Summary
  const trendArrow = data.trends.cumplimientoTrend === "mejora" ? "▲" : data.trends.cumplimientoTrend === "deterioro" ? "▼" : "=";
  const summaryRows = [
    ["Informe de Rango Consolidado", ""],
    ["Período", periodLabel],
    ["Meses analizados", data.months.length],
    [""],
    ["RESUMEN ACUMULADO", ""],
    ["Cumplimiento promedio", `${data.aggregated.teamSummary.avgCumplimiento}%`],
    ["Tareas completadas", `${data.aggregated.teamSummary.totalCompletedTasks} / ${data.aggregated.teamSummary.totalTasks}`],
    ["Carga laboral acumulada", `${data.aggregated.teamSummary.avgCargaPct}% (${hoursToDisplay(data.aggregated.teamSummary.totalCargaRealHours)}h de ${hoursToDisplay(data.aggregated.teamSummary.totalCargaBaseHours)}h base)`],
    ["Rango óptimo configurado (por persona)", `${hoursToDisplay(data.aggregated.teamSummary.cargaRangeMin)}h a ${hoursToDisplay(data.aggregated.teamSummary.cargaRangeMax)}h`],
    ["Total consultas SEGUIMIENTO", data.aggregated.teamSummary.totalConsultas],
    [""],
    ["TENDENCIA", ""],
    ["Dirección", `${trendArrow} ${data.trends.cumplimientoTrend.toUpperCase()}`],
    ["Cumplimiento inicial", `${data.trends.firstMonthAvgCumplimiento}%`],
    ["Cumplimiento final", `${data.trends.lastMonthAvgCumplimiento}%`],
    ["Cambio", `${data.trends.cumplimientoChange > 0 ? "+" : ""}${data.trends.cumplimientoChange} pp`],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summaryRows), "Resumen");

  // Sheet 2: Evolution
  const evoRows = [
    ["Mes", "Cumpl. equipo %", "Tareas compl.", "Total tareas", "Carga % equipo", "Horas reales", "Base (h)", "Consultas"],
    ...data.months.map((ms) => [
      ms.label, ms.teamAvgCumplimiento, ms.totalCompletedTasks, ms.totalTasks,
      ms.totalCargaBaseHours > 0 ? Math.round((ms.totalCargaRealHours / ms.totalCargaBaseHours) * 100) : 0,
      hoursToDisplay(ms.totalCargaRealHours), hoursToDisplay(ms.totalCargaBaseHours), ms.totalConsultas,
    ]),
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(evoRows), "Evolución mensual");

  // Sheet 3: Ranking
  const rankingRows = [
    ["#", "Nombre", "Cargo", "Score prom.", "Cumplimiento prom."],
    ...data.aggregated.ranking.map((m, i) => [
      i + 1, m.name, ROLE_LABEL[m.role as Role] ?? m.role, m.avgScore, `${m.avgCumplimiento}%`,
    ]),
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rankingRows), "Ranking");

  // Sheet 4: Detail per person
  const detailRows = [
    ["Nombre", "Cargo", "Score prom.", "Cumpl.%", "Carga%", "Carga (rango)", "Tareas", "Compl.", "Horas reales", "Base (h)", "Consultas"],
    ...data.aggregated.members.map((m) => [
      m.name, ROLE_LABEL[m.role as Role] ?? m.role, m.score, m.completedPct,
      m.cargaPct, m.cargaLabel, m.totalTasks, m.completedTasks, hoursToDisplay(m.cargaRealHours), hoursToDisplay(m.cargaBaseHours), m.seguimientoTotal,
    ]),
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(detailRows), "Detalle");

  if (data.aggregated.consultasByReason.length > 0) {
    const consultasRows = [
      ["Motivo", "Total consultas", "Total minutos"],
      ...data.aggregated.consultasByReason.map((r) => [
        REASON_LABEL[r.reason] ?? r.reason, r.count, r.totalMinutes,
      ]),
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(consultasRows), "Consultas");
  }

  if (data.aiAnalysis) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Análisis IA"], [data.aiAnalysis]]), "Análisis IA");
  }

  XLSX.writeFile(wb, `Informe_Rango_${fromLabel.replace(/\s/g, "_")}_${toLabel.replace(/\s/g, "_")}.xlsx`);
}

function downloadRangePDF(data: RangeReportData) {
  const fromLabel = formatMonthLabel(data.from);
  const toLabel = formatMonthLabel(data.to);
  const periodLabel = `${fromLabel} — ${toLabel}`;
  const trendArrow = data.trends.cumplimientoTrend === "mejora" ? "▲ Mejora" : data.trends.cumplimientoTrend === "deterioro" ? "▼ Deterioro" : "= Estancamiento";

  const evoRows = data.months.map(
    (ms) => `<tr>
      <td>${ms.label}</td>
      <td>${ms.teamAvgCumplimiento}%</td>
      <td>${ms.totalCompletedTasks}/${ms.totalTasks}</td>
      <td>${ms.totalCargaBaseHours > 0 ? Math.round((ms.totalCargaRealHours / ms.totalCargaBaseHours) * 100) : 0}% (${hoursToDisplay(ms.totalCargaRealHours)}h/${hoursToDisplay(ms.totalCargaBaseHours)}h)</td>
      <td>${ms.totalConsultas}</td>
    </tr>`,
  ).join("");

  const rankingRows = data.aggregated.ranking.map(
    (m, i) => `<tr>
      <td>${i + 1}</td><td>${m.name}</td>
      <td style="font-size:11px">${ROLE_LABEL[m.role as Role] ?? m.role}</td>
      <td><strong>${m.avgScore}/100</strong></td>
      <td>${m.avgCumplimiento}%</td>
    </tr>`,
  ).join("");

  const alertsHtml = data.aggregated.alerts.length > 0
    ? data.aggregated.alerts.map((a) =>
        `<div class="alert">⚠️ <strong>${a.name}</strong>: ${
          a.type === "cumplimiento"
            ? `Cumplimiento promedio ${a.avgValue}% en ${a.monthsAffected} meses`
            : `Sobrecarga promedio ${a.avgValue}% en ${a.monthsAffected} meses`
        }</div>`,
      ).join("")
    : '<p style="color:#64748b">Sin alertas persistentes.</p>';

  const findingsHtml =
    data.aggregated.findings && data.aggregated.findings.length > 0
      ? `<ul>${data.aggregated.findings.map((f) => `<li>${f.text}</li>`).join("")}</ul>`
      : "";
  const recommendationsHtml =
    data.aggregated.recommendations && data.aggregated.recommendations.length > 0
      ? `<ul>${data.aggregated.recommendations.map((r) => `<li><strong>[${r.priority === "alta" ? "Prioridad alta" : "Prioridad media"}]</strong> ${r.text}</li>`).join("")}</ul>`
      : "";
  const insightsHtml =
    data.aggregated.insights && data.aggregated.insights.length > 0
      ? `<ul>${data.aggregated.insights.map((i) => `<li>${i}</li>`).join("")}</ul>`
      : "";
  const riskQuadrantHtml =
    data.aggregated.riskQuadrant && data.aggregated.riskQuadrant.length > 0
      ? `<table>
    <thead><tr><th>Colaborador</th><th>Cumplimiento</th><th>Carga</th><th>Cuadrante</th></tr></thead>
    <tbody>
      ${data.aggregated.riskQuadrant
        .map(
          (p) => `<tr>
        <td>${p.name}</td><td>${p.completedPct}%</td><td>${p.cargaPct}%</td>
        <td>${{ criticos: "Crítico", "atencion-carga": "Atención (carga)", "atencion-cumplimiento": "Atención (cumplimiento)", saludables: "Saludable" }[p.quadrant]}</td>
      </tr>`,
        )
        .join("")}
    </tbody>
  </table>`
      : "";

  const aiHtml = data.aiAnalysis
    ? `<h2>Análisis IA</h2><div class="ai-analysis">${data.aiAnalysis.replace(/\n/g, "<br>")}</div>`
    : "";

  const styles = `
  body{font-family:system-ui,sans-serif;padding:32px;color:#1e293b;max-width:900px;margin:0 auto;font-size:13px}
  h1{color:#4f46e5;font-size:20px;margin-bottom:4px}
  h2{margin-top:24px;margin-bottom:8px;font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#475569;border-bottom:1px solid #e2e8f0;padding-bottom:5px}
  .meta{color:#64748b;font-size:12px;margin-bottom:16px}
  .trend{display:inline-block;padding:6px 14px;border-radius:8px;font-weight:700;font-size:13px;margin-bottom:12px}
  .stats{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:10px 0}
  .stat{border:1px solid #e2e8f0;border-radius:8px;padding:10px;text-align:center}
  .stat-label{font-size:10px;text-transform:uppercase;color:#94a3b8}
  .stat-value{font-size:18px;font-weight:700;color:#4f46e5;margin:3px 0}
  .alert{background:#fef2f2;border:1px solid #fecaca;border-radius:6px;padding:7px 12px;margin:3px 0;font-size:12px}
  .ai-analysis{background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:14px;font-size:12px;line-height:1.7;white-space:pre-wrap}
  table{width:100%;border-collapse:collapse;font-size:11px;margin-top:6px}
  th{background:#f8fafc;text-align:left;padding:6px 8px;border:1px solid #e2e8f0;font-size:10px;text-transform:uppercase;color:#64748b}
  td{padding:6px 8px;border:1px solid #e2e8f0}
  tr:nth-child(even) td{background:#fafafa}
  @media print{body{padding:16px}}`;

  const bodyHtml = `
  <h1>Informe de Rango Consolidado</h1>
  <div class="meta">Período: <strong>${periodLabel}</strong> (${data.months.length} meses)</div>

  <div class="trend" style="background:${data.trends.cumplimientoTrend === "mejora" ? "#dcfce7;color:#166534" : data.trends.cumplimientoTrend === "deterioro" ? "#fee2e2;color:#991b1b" : "#f1f5f9;color:#475569"}">
    ${trendArrow} — ${data.trends.firstMonthAvgCumplimiento}% → ${data.trends.lastMonthAvgCumplimiento}% (${data.trends.cumplimientoChange > 0 ? "+" : ""}${data.trends.cumplimientoChange} pp)
  </div>

  <h2>Resumen Acumulado</h2>
  <div class="stats">
    <div class="stat"><div class="stat-label">Cumplimiento prom.</div><div class="stat-value">${data.aggregated.teamSummary.avgCumplimiento}%</div></div>
    <div class="stat"><div class="stat-label">Tareas completadas</div><div class="stat-value">${data.aggregated.teamSummary.totalCompletedTasks}<span style="font-size:12px;color:#94a3b8">/${data.aggregated.teamSummary.totalTasks}</span></div></div>
    <div class="stat"><div class="stat-label">Carga laboral acumulada</div><div class="stat-value" style="font-size:14px">${data.aggregated.teamSummary.avgCargaPct}%<span style="color:#94a3b8;font-size:11px"> (${hoursToDisplay(data.aggregated.teamSummary.totalCargaRealHours)}h/${hoursToDisplay(data.aggregated.teamSummary.totalCargaBaseHours)}h)</span></div></div>
    <div class="stat"><div class="stat-label">Rango óptimo (por persona)</div><div class="stat-value" style="font-size:13px">${hoursToDisplay(data.aggregated.teamSummary.cargaRangeMin)}h-${hoursToDisplay(data.aggregated.teamSummary.cargaRangeMax)}h</div></div>
  </div>

  ${findingsHtml ? `<h2>Hallazgos Principales</h2>${findingsHtml}` : ""}

  <h2>Alertas Persistentes</h2>${alertsHtml}

  ${riskQuadrantHtml ? `<h2>Mapa de Riesgo</h2>${riskQuadrantHtml}` : ""}

  <h2>Evolución Mensual</h2>
  <table><thead><tr><th>Mes</th><th>Cumpl.%</th><th>Tareas compl/total</th><th>Carga (real/base)</th><th>Consultas</th></tr></thead>
  <tbody>${evoRows}</tbody></table>

  <h2>Ranking del Período</h2>
  <table><thead><tr><th>#</th><th>Nombre</th><th>Cargo</th><th>Score prom.</th><th>Cumpl. prom.</th></tr></thead>
  <tbody>${rankingRows}</tbody></table>

  ${insightsHtml ? `<h2>Insights</h2>${insightsHtml}` : ""}

  ${recommendationsHtml ? `<h2>Acciones Sugeridas</h2>${recommendationsHtml}` : ""}

  ${aiHtml}`;

  openReportWindow({
    title: `Informe Rango – ${periodLabel}`,
    styles,
    bodyHtml,
    pdfFileName: `Informe_Rango_${periodLabel.replace(/\s/g, "_")}.pdf`,
  });
}

// ── Main component ────────────────────────────────────────────────────────────

type Props = {
  currentUserRole: string;
};

export default function MonthlyReports({ currentUserRole }: Props) {
  const { showToast } = useToast();
  const [viewMode, setViewMode] = useState<"individual" | "range">("individual");

  // ── Individual month state ─────────────────────────────────────────────────
  const [reports, setReports] = useState<MonthlyReportSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [fullReport, setFullReport] = useState<MonthlyReportFull | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generateMonth, setGenerateMonth] = useState(currentMonthParam);

  // ── Range state ────────────────────────────────────────────────────────────
  const [rangeFrom, setRangeFrom] = useState(() => addMonths(currentMonthParam(), -5));
  const [rangeTo, setRangeTo] = useState(currentMonthParam);
  const [rangeReport, setRangeReport] = useState<RangeReportData | null>(null);
  const [rangeLoading, setRangeLoading] = useState(false);

  const fetchReports = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/reports");
    if (res.ok) {
      const data: { reports: MonthlyReportSummary[] } = await res.json();
      setReports(data.reports);
      if (data.reports.length > 0 && !selectedId) {
        setSelectedId(data.reports[0].id);
      }
    }
    setLoading(false);
  }, [selectedId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchReports();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch full report when a summary is selected
  useEffect(() => {
    if (!selectedId) return;
    const summary = reports.find((r) => r.id === selectedId);
    if (!summary) return;

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDetailLoading(true);
    const monthStr = `${summary.year}-${String(summary.month).padStart(2, "0")}`;
    fetch(`/api/reports?month=${monthStr}`)
      .then((r) => r.json())
      .then((data: { report: MonthlyReportFull | null }) => {
        setFullReport(data.report);
        setDetailLoading(false);
      });
  }, [selectedId, reports]);

  async function handleGenerate() {
    setGenerating(true);
    try {
      const res = await fetch(`/api/reports/generate?month=${generateMonth}`, { method: "POST" });
      if (!res.ok) {
        const err: { error?: string } = await res.json();
        showToast(err.error ?? "Error al generar el informe", "error");
        return;
      }
      const data: { report: MonthlyReportFull } = await res.json();
      await fetchReports();
      setFullReport(data.report);
      setSelectedId(data.report.id);
      showToast("Informe generado.", "success");
    } finally {
      setGenerating(false);
    }
  }

  async function handleGenerateRange() {
    if (rangeFrom >= rangeTo) {
      showToast("El mes de inicio debe ser anterior al mes de fin", "error");
      return;
    }
    setRangeLoading(true);
    setRangeReport(null);
    try {
      const res = await fetch(`/api/reports/range?from=${rangeFrom}&to=${rangeTo}`);
      if (!res.ok) {
        const err: { error?: string } = await res.json();
        showToast(err.error ?? "Error al generar el informe de rango", "error");
        return;
      }
      const data: { report: RangeReportData } = await res.json();
      setRangeReport(data.report);
    } finally {
      setRangeLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center items-center py-32">
        <Spinner className="w-7 h-7 text-primary" />
      </div>
    );
  }

  const selectedSummary = reports.find((r) => r.id === selectedId);
  const data: ReportData | null = fullReport?.data ?? null;

  // ── Evolution chart data for range report ─────────────────────────────────
  const memberNames = rangeReport?.months[0]?.memberSnapshots.map((m) => m.name) ?? [];
  const chartData = rangeReport?.months.map((ms) => {
    const entry: Record<string, number | string> = { label: ms.label };
    entry["Equipo"] = ms.teamAvgCumplimiento;
    ms.memberSnapshots.forEach((m) => { entry[m.name] = m.completedPct; });
    return entry;
  }) ?? [];

  return (
    <div className="flex flex-col gap-4">
      {/* Mode toggle */}
      <div className="flex gap-1 bg-black/5 dark:bg-white/5 rounded-xl p-1 w-fit self-start">
        <button
          onClick={() => setViewMode("individual")}
          className={`px-4 py-2 text-sm font-medium rounded-lg transition-all ${viewMode === "individual" ? "bg-surface text-title shadow-sm" : "text-secondary hover:text-main"}`}
        >
          Mes individual
        </button>
        <button
          onClick={() => setViewMode("range")}
          className={`px-4 py-2 text-sm font-medium rounded-lg transition-all ${viewMode === "range" ? "bg-surface text-title shadow-sm" : "text-secondary hover:text-main"}`}
        >
          Rango personalizado
        </button>
      </div>

      {/* ── RANGE VIEW ──────────────────────────────────────────────────────── */}
      {viewMode === "range" && (
        <div className="flex flex-col gap-4">
          {/* Range selector */}
          <div className="bg-surface rounded-2xl border border-border p-4 flex flex-wrap items-end gap-4">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-secondary font-medium">Desde</label>
              <input
                type="month"
                value={rangeFrom}
                onChange={(e) => setRangeFrom(e.target.value)}
                className="text-sm border border-border rounded-lg px-3 py-1.5 bg-surface text-main focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-secondary font-medium">Hasta</label>
              <input
                type="month"
                value={rangeTo}
                onChange={(e) => setRangeTo(e.target.value)}
                className="text-sm border border-border rounded-lg px-3 py-1.5 bg-surface text-main focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <Button onClick={handleGenerateRange} disabled={rangeLoading}>
              {rangeLoading ? (
                <>
                  <Spinner className="w-3.5 h-3.5 text-white" />
                  Generando...
                </>
              ) : (
                <>
                  <BarChart3 className="w-4 h-4" strokeWidth={2} />
                  Generar informe de rango
                </>
              )}
            </Button>
            {rangeReport && !rangeLoading && (
              <div className="flex items-center gap-2 ml-auto">
                <Button variant="secondary" size="sm" onClick={() => downloadRangeExcel(rangeReport)}>
                  <Download className="w-4 h-4" strokeWidth={2} />
                  Excel
                </Button>
                <Button variant="primary" size="sm" onClick={() => downloadRangePDF(rangeReport)}>
                  <FileText className="w-4 h-4" strokeWidth={2} />
                  PDF
                </Button>
              </div>
            )}
          </div>

          {rangeLoading && (
            <div className="flex flex-col items-center justify-center py-24 gap-3 text-disabled">
              <Spinner className="w-8 h-8 text-primary" />
              <p className="text-sm">Calculando KPIs mes a mes y generando análisis IA...</p>
            </div>
          )}

          {!rangeLoading && !rangeReport && (
            <EmptyState icon={BarChart3} title="Selecciona un rango y genera el informe" />
          )}

          {!rangeLoading && rangeReport && (
            <div className="space-y-5">
              {/* Trend banner */}
              {(() => {
                const t = rangeReport.trends;
                const isUp = t.cumplimientoTrend === "mejora";
                const isDown = t.cumplimientoTrend === "deterioro";
                return (
                  <div className={`rounded-2xl border px-5 py-4 flex items-center gap-4 ${isUp ? "bg-success/[.13] border-transparent" : isDown ? "bg-danger/[.13] border-transparent" : "bg-background border-border"}`}>
                    <span className="text-3xl">{isUp ? "▲" : isDown ? "▼" : "="}</span>
                    <div>
                      <p className={`text-lg font-bold ${isUp ? "text-success" : isDown ? "text-danger" : "text-main"}`}>
                        Tendencia: {t.cumplimientoTrend.toUpperCase()}
                      </p>
                      <p className={`text-sm ${isUp ? "text-success" : isDown ? "text-danger" : "text-secondary"}`}>
                        Cumplimiento {t.firstMonthAvgCumplimiento}% → {t.lastMonthAvgCumplimiento}%
                        {" "}({t.cumplimientoChange > 0 ? "+" : ""}{t.cumplimientoChange} pp en {rangeReport.months.length} meses)
                      </p>
                    </div>
                    {rangeReport.aggregated.problematicMonths.length > 0 && (
                      <div className="ml-auto text-right">
                        <p className="text-xs text-danger font-semibold">Meses críticos (&lt;60%)</p>
                        {rangeReport.aggregated.problematicMonths.map((pm) => (
                          <p key={pm.month} className="text-xs text-danger">{pm.label}: {pm.teamAvgCumplimiento}%</p>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Summary stats */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <MetricStat label="Cumplimiento promedio" value={`${rangeReport.aggregated.teamSummary.avgCumplimiento}%`} sub={`${rangeReport.months.length} meses`} accent />
                <MetricStat label="Tareas completadas" value={`${rangeReport.aggregated.teamSummary.totalCompletedTasks}`} sub={`de ${rangeReport.aggregated.teamSummary.totalTasks} totales`} />
                <MetricStat label="Carga laboral acumulada" value={`${rangeReport.aggregated.teamSummary.avgCargaPct}%`} sub={`${hoursToDisplay(rangeReport.aggregated.teamSummary.totalCargaRealHours)}h de ${hoursToDisplay(rangeReport.aggregated.teamSummary.totalCargaBaseHours)}h base`} />
                <MetricStat label="Rango óptimo (por persona)" value={`${hoursToDisplay(rangeReport.aggregated.teamSummary.cargaRangeMin)}-${hoursToDisplay(rangeReport.aggregated.teamSummary.cargaRangeMax)}h`} />
                <MetricStat label="Total consultas" value={`${rangeReport.aggregated.teamSummary.totalConsultas}`} sub="SEGUIMIENTO acumuladas" />
                <MetricStat label="Alertas persistentes" value={`${rangeReport.aggregated.alerts.length}`} sub="personas con incidencia recurrente" />
                <MetricStat label="Colaboradores" value={`${rangeReport.aggregated.members.length}`} sub="incluidos en el rango" />
              </div>

              {/* Persistent alerts */}
              {rangeReport.aggregated.alerts.length > 0 && (
                <div className="bg-surface rounded-2xl border border-border p-5">
                  <h3 className="text-sm font-semibold text-main uppercase tracking-wider mb-3">Alertas Persistentes</h3>
                  <div className="space-y-2">
                    {rangeReport.aggregated.alerts.map((a, i) => (
                      <div key={i} className={`flex items-start gap-3 px-4 py-3 rounded-xl border border-transparent ${a.type === "cumplimiento" ? "bg-danger/[.13]" : "bg-warning/[.15]"}`}>
                        <span className="text-lg leading-none mt-0.5">⚠️</span>
                        <div>
                          <p className={`text-sm font-semibold ${a.type === "cumplimiento" ? "text-danger" : "text-warning"}`}>{a.name}</p>
                          <p className={`text-xs ${a.type === "cumplimiento" ? "text-danger" : "text-warning"}`}>
                            {a.type === "cumplimiento"
                              ? `Cumplimiento promedio ${a.avgValue}% en ${a.monthsAffected} de los meses analizados`
                              : `Sobrecarga promedio ${a.avgValue}% en ${a.monthsAffected} de los meses analizados`}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Bloque 2 — Hallazgos automáticos */}
              {rangeReport.aggregated.findings && <FindingsSection findings={rangeReport.aggregated.findings} />}

              {/* Bloque 8 — Mapa de Riesgo */}
              {rangeReport.aggregated.riskQuadrant && <RiskMatrixChart points={rangeReport.aggregated.riskQuadrant} />}

              {/* Evolution line chart */}
              <div className="bg-surface rounded-2xl border border-border p-5">
                <h3 className="text-sm font-semibold text-main uppercase tracking-wider mb-4">
                  Evolución de Cumplimiento — {rangeReport.months.length} meses
                </h3>
                <ResponsiveContainer width="100%" height={260}>
                  <LineChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} tickFormatter={(v: string) => v.split(" ")[0].substring(0, 3) + " " + v.split(" ").slice(-1)[0].slice(-2)} />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} unit="%" />
                    <Tooltip formatter={(v) => (v != null ? `${v}%` : "")} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <ReferenceLine y={80} stroke="#22c55e" strokeDasharray="4 2" label={{ value: "80%", fontSize: 10, fill: "#16a34a" }} />
                    <ReferenceLine y={60} stroke="#f59e0b" strokeDasharray="4 2" label={{ value: "60%", fontSize: 10, fill: "#b45309" }} />
                    <Line type="monotone" dataKey="Equipo" stroke="#4f46e5" strokeWidth={3} dot={{ r: 4 }} activeDot={{ r: 6 }} />
                    {memberNames.map((name, i) => (
                      <Line key={name} type="monotone" dataKey={name} stroke={RANGE_LINE_COLORS[i % RANGE_LINE_COLORS.length]} strokeWidth={1.5} strokeDasharray="4 2" dot={{ r: 2 }} />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>

              {/* Monthly breakdown table */}
              <div className="bg-surface rounded-2xl border border-border p-5">
                <h3 className="text-sm font-semibold text-main uppercase tracking-wider mb-4">Detalle Mensual</h3>
                <div className="-mx-5 px-5">
                  <Table className="min-w-[500px]">
                    <TableHead>
                      <TableRow>
                        {["Mes", "Cumpl. equipo", "Tareas", "Carga", "Consultas"].map((h) => (
                          <Th key={h}>{h}</Th>
                        ))}
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {rangeReport.months.map((ms) => (
                        <TableRow key={ms.month} className={ms.totalTasks > 0 && ms.teamAvgCumplimiento < 60 ? "bg-danger/[.06]" : ""}>
                          <Td className="font-medium text-title">{ms.label}</Td>
                          <Td>
                            <span className="flex items-center gap-1.5">
                              <div className={`w-2 h-2 rounded-full ${colorDot(ms.teamAvgCumplimiento)}`} />
                              {ms.teamAvgCumplimiento}%
                            </span>
                          </Td>
                          <Td>{ms.totalCompletedTasks}/{ms.totalTasks}</Td>
                          <Td className="text-xs">
                            {ms.totalCargaBaseHours > 0 ? Math.round((ms.totalCargaRealHours / ms.totalCargaBaseHours) * 100) : 0}%
                            {" "}({hoursToDisplay(ms.totalCargaRealHours)}h/{hoursToDisplay(ms.totalCargaBaseHours)}h)
                          </Td>
                          <Td>{ms.totalConsultas}</Td>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>

              {/* Ranking */}
              <div className="bg-surface rounded-2xl border border-border p-5">
                <h3 className="text-sm font-semibold text-main uppercase tracking-wider mb-4">Ranking del Período (Promedio)</h3>
                <div className="space-y-2">
                  {rangeReport.aggregated.ranking.map((m, i) => (
                    <div key={m.id} className="flex items-center gap-3 py-2 border-b border-border last:border-0">
                      <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${i === 0 ? "bg-warning/[.15] text-warning" : i === 1 ? "bg-surface2 text-secondary" : i === 2 ? "bg-primary-surface text-primary" : "bg-background text-disabled"}`}>{i + 1}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-title truncate">{m.name}</p>
                        <p className="text-[11px] text-disabled">{ROLE_LABEL[m.role as Role] ?? m.role}</p>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <p className="text-sm font-bold text-main">{m.avgScore}<span className="text-disabled font-normal">/100</span></p>
                        <div className="w-24 bg-black/10 dark:bg-white/10 rounded-full h-2">
                          <div className={`h-2 rounded-full ${m.avgCumplimiento >= 80 ? "bg-success" : m.avgCumplimiento >= 60 ? "bg-warning" : "bg-danger"}`} style={{ width: `${m.avgCumplimiento}%` }} />
                        </div>
                        <span className="text-sm text-main w-10 text-right">{m.avgCumplimiento}%</span>
                        <div className={`w-2 h-2 rounded-full ${colorDot(m.avgCumplimiento)}`} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Bloque 10 — Insights */}
              {rangeReport.aggregated.insights && <TeamInsightsSection insights={rangeReport.aggregated.insights} />}

              {/* Bloque 3 — Recomendaciones ejecutivas */}
              {rangeReport.aggregated.recommendations && <RecommendationsSection recommendations={rangeReport.aggregated.recommendations} />}

              {/* AI Analysis */}
              {rangeReport.aiAnalysis ? (
                <div className="bg-surface rounded-2xl border border-border p-5">
                  <div className="flex items-center gap-2 mb-4">
                    <div className="p-1.5 bg-primary-surface rounded-lg">
                      <Lightbulb className="w-4 h-4 text-primary" strokeWidth={2} />
                    </div>
                    <h3 className="text-sm font-semibold text-main uppercase tracking-wider">Análisis IA — Rango Personalizado</h3>
                    <span className="text-[11px] bg-primary-surface text-primary px-2 py-0.5 rounded-full font-medium">llama-3.3-70b · Groq</span>
                  </div>
                  <div className="text-main leading-relaxed whitespace-pre-wrap text-[13px]">{rangeReport.aiAnalysis}</div>
                </div>
              ) : (
                <div className="bg-warning/[.15] rounded-2xl p-5">
                  <p className="text-sm text-warning">
                    <strong>Análisis IA no disponible.</strong> Configura <code className="bg-warning/20 px-1 rounded">GROQ_API_KEY</code> en <code className="bg-warning/20 px-1 rounded">.env</code>.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── INDIVIDUAL VIEW ──────────────────────────────────────────────────── */}
      {viewMode === "individual" && (
      <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-title">Informes Mensuales</h1>
          <p className="text-sm text-secondary mt-0.5">
            {currentUserRole === "JEFE_NACIONAL" || currentUserRole === "ADMINISTRADOR"
              ? "Consolidado de todo el equipo"
              : "Consolidado de tu equipo (excluye Jefe Nacional)"}
          </p>
        </div>

        {/* Generate panel */}
        <div className="flex items-center gap-2 bg-surface border border-border rounded-xl px-4 py-2">
          <label className="text-sm text-secondary whitespace-nowrap">Generar informe:</label>
          <input
            type="month"
            value={generateMonth}
            onChange={(e) => setGenerateMonth(e.target.value)}
            className="text-sm border border-border rounded-lg px-3 py-1.5 bg-surface text-main focus:outline-none focus:ring-2 focus:ring-primary"
          />
          <Button variant="primary" size="sm" onClick={handleGenerate} disabled={generating}>
            {generating ? (
              <>
                <Spinner className="w-3.5 h-3.5 text-white" />
                Generando...
              </>
            ) : (
              <>
                <BarChart3 className="w-4 h-4" strokeWidth={2} />
                Generar / Actualizar
              </>
            )}
          </Button>
        </div>
      </div>


      {/* Two-panel layout */}
      <div className="flex flex-col lg:flex-row gap-5 items-stretch lg:items-start">
        {/* Left sidebar */}
        <aside className="w-full lg:w-[220px] shrink-0 bg-surface rounded-2xl border border-border p-3 lg:sticky lg:top-20">
          <p className="text-[11px] font-semibold text-disabled uppercase tracking-wider px-2 mb-2">
            Informes guardados
          </p>
          {reports.length === 0 ? (
            <EmptyState
              title="No hay informes generados aún"
              description="Usa el botón para crear el primero."
              className="py-4"
            />
          ) : (
            <div className="space-y-1">
              {reports.map((r) => (
                <ReportCard
                  key={r.id}
                  report={r}
                  selected={r.id === selectedId}
                  onClick={() => setSelectedId(r.id)}
                />
              ))}
            </div>
          )}
        </aside>

        {/* Right panel */}
        <div className="flex-1 min-w-0">
          {detailLoading && (
            <div className="flex justify-center py-24">
              <Spinner className="w-7 h-7 text-primary" />
            </div>
          )}

          {!detailLoading && !fullReport && reports.length === 0 && (
            <EmptyState
              icon={FileText}
              title="Aún no hay informes generados"
              description='Selecciona un mes y haz clic en "Generar / Actualizar"'
            />
          )}

          {!detailLoading && fullReport && data && selectedSummary && (
            <div className="space-y-5">
              {/* Report header */}
              <div className="bg-surface rounded-2xl border border-border px-5 py-4 flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h2 className="text-xl font-bold text-title">
                    {formatMonthYear(selectedSummary.month, selectedSummary.year)}
                  </h2>
                  <p className="text-sm text-secondary">
                    Generado por {selectedSummary.generatedBy} el{" "}
                    {formatDate(selectedSummary.updatedAt)}
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <Button variant="secondary" size="sm" onClick={() => downloadReportExcel(fullReport)}>
                    <Download className="w-4 h-4" strokeWidth={2} />
                    Excel consolidado
                  </Button>
                  <Button variant="primary" size="sm" onClick={() => downloadReportPDF(fullReport)}>
                    <FileText className="w-4 h-4" strokeWidth={2} />
                    PDF consolidado
                  </Button>
                </div>
              </div>

              {/* Bloque 1 — Resumen Ejecutivo (primera "página" del informe) */}
              <ExecutiveSummarySection
                indiceEjecutivo={data.indiceEjecutivo ?? null}
                riskQuadrant={data.riskQuadrant}
                alerts={data.alerts}
                ranking={data.ranking}
              />

              {/* Team summary stats */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <MetricStat
                  label="Cumplimiento promedio"
                  value={`${data.teamSummary.avgCumplimiento}%`}
                  sub={`${data.members.length} colaboradores`}
                  accent
                />
                <MetricStat
                  label="Tareas completadas"
                  value={`${data.teamSummary.totalCompletedTasks}`}
                  sub={`de ${data.teamSummary.totalTasks} tareas en total`}
                />
                <MetricStat
                  label="Carga laboral equipo"
                  value={`${data.teamSummary.avgCargaPct}%`}
                  sub={`${hoursToDisplay(data.teamSummary.totalCargaRealHours)}h de ${hoursToDisplay(data.teamSummary.totalCargaBaseHours)}h base`}
                />
                <MetricStat
                  label="Rango óptimo (por persona)"
                  value={`${hoursToDisplay(data.teamSummary.cargaRangeMin)}-${hoursToDisplay(data.teamSummary.cargaRangeMax)}h`}
                />
                <MetricStat
                  label="Total consultas"
                  value={`${data.teamSummary.totalConsultas}`}
                  sub="SEGUIMIENTO acumuladas"
                />
                <MetricStat
                  label="Alertas activas"
                  value={`${data.alerts.length}`}
                  sub="personas con incidencia"
                />
                <MetricStat
                  label="Colaboradores"
                  value={`${data.members.length}`}
                  sub="incluidos en el informe"
                />
              </div>

              {/* Bloque 5 — Interpretación de indicadores (qué significa/por qué/impacto/acción) */}
              {data.indicatorExplanations && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <IndicatorInterpretation title="Cumplimiento" value={`${data.teamSummary.avgCumplimiento}%`} explanation={data.indicatorExplanations.cumplimiento} />
                  <IndicatorInterpretation title="Carga laboral" value={`${data.teamSummary.avgCargaPct}%`} explanation={data.indicatorExplanations.carga} />
                  <IndicatorInterpretation title="Consultas" value={`${data.teamSummary.totalConsultas}`} explanation={data.indicatorExplanations.consultas} />
                </div>
              )}

              {/* Bloque 2 — Hallazgos automáticos */}
              {data.findings && <FindingsSection findings={data.findings} />}

              {/* Bloque 8 — Mapa de Riesgo */}
              {data.riskQuadrant && <RiskMatrixChart points={data.riskQuadrant} />}

              {/* Alerts */}
              {data.alerts.length > 0 && (
                <div className="bg-surface rounded-2xl border border-border p-5">
                  <h3 className="text-sm font-semibold text-main uppercase tracking-wider mb-3">
                    Alertas de Gestión
                  </h3>
                  <div className="space-y-2">
                    {data.alerts.map((a, i) => (
                      <div
                        key={i}
                        className={`flex items-start gap-3 px-4 py-3 rounded-xl border border-transparent ${
                          a.type === "cumplimiento"
                            ? "bg-danger/[.13]"
                            : "bg-warning/[.15]"
                        }`}
                      >
                        <span className="text-lg leading-none mt-0.5">⚠️</span>
                        <div>
                          <p className={`text-sm font-semibold ${a.type === "cumplimiento" ? "text-danger" : "text-warning"}`}>
                            {a.name}
                          </p>
                          <p className={`text-xs ${a.type === "cumplimiento" ? "text-danger" : "text-warning"}`}>
                            {a.type === "cumplimiento"
                              ? `Cumplimiento crítico: ${a.value}% (umbral mínimo 60%)`
                              : `Sobrecarga laboral: ${a.value}% (umbral máximo 120%)`}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Ranking */}
              <div className="bg-surface rounded-2xl border border-border p-5">
                <h3 className="text-sm font-semibold text-main uppercase tracking-wider mb-4">
                  Ranking de Cumplimiento del Equipo
                </h3>
                <div className="space-y-2">
                  {data.ranking.map((m, i) => (
                    <div key={m.id} className="flex items-center gap-3 py-2 border-b border-border last:border-0">
                      <span
                        className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                          i === 0
                            ? "bg-warning/[.15] text-warning"
                            : i === 1
                              ? "bg-surface2 text-secondary"
                              : i === 2
                                ? "bg-primary-surface text-primary"
                                : "bg-background text-disabled"
                        }`}
                      >
                        {i + 1}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-title truncate">{m.name}</p>
                        <p className="text-[11px] text-disabled">{ROLE_LABEL[m.role as Role] ?? m.role}</p>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <div className="text-right">
                          <p className="text-sm font-bold text-main">{m.score}<span className="text-disabled font-normal">/100</span></p>
                        </div>
                        <div className="w-24 bg-black/10 dark:bg-white/10 rounded-full h-2">
                          <div
                            className={`h-2 rounded-full transition-all ${
                              m.completedPct >= 80
                                ? "bg-success"
                                : m.completedPct >= 60
                                  ? "bg-warning"
                                  : "bg-danger"
                            }`}
                            style={{ width: `${m.completedPct}%` }}
                          />
                        </div>
                        <span className="text-sm text-main w-10 text-right">{m.completedPct}%</span>
                        <div className={`w-2 h-2 rounded-full ${colorDot(m.completedPct)}`} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Detail table */}
              <div className="bg-surface rounded-2xl border border-border p-5">
                <h3 className="text-sm font-semibold text-main uppercase tracking-wider mb-4">
                  Detalle por Colaborador
                </h3>
                <div className="-mx-5 px-5">
                  <Table className="min-w-[700px]">
                    <TableHead>
                      <TableRow>
                        {["Colaborador", "Score", "Cumpl.", "Carga", "Tareas", "Vencidas", "Horas", "Consultas"].map((h) => (
                          <Th key={h}>
                            {h}
                          </Th>
                        ))}
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {data.members.map((m) => (
                        <TableRow key={m.id}>
                          <Td>
                            <p className="text-sm font-semibold text-title">{m.name}</p>
                            <p className="text-[11px] text-disabled">{ROLE_LABEL[m.role as Role] ?? m.role}</p>
                          </Td>
                          <Td className="font-bold text-main">{m.score}<span className="text-disabled font-normal">/100</span></Td>
                          <Td>
                            <span className="flex items-center gap-1.5">
                              <div className={`w-2 h-2 rounded-full ${colorDot(m.completedPct)}`} />
                              {m.completedPct}%
                            </span>
                          </Td>
                          <Td>
                            <span className="flex items-center gap-1.5" title={`Rango óptimo ${hoursToDisplay(m.cargaRangeMin)}-${hoursToDisplay(m.cargaRangeMax)}h`}>
                              <div className={`w-2 h-2 rounded-full ${KPI_COLOR_DOT[m.cargaColor]}`} />
                              {m.cargaPct}% <span className="text-disabled font-normal">· {m.cargaLabel}</span>
                            </span>
                          </Td>
                          <Td>{m.completedTasks}/{m.totalTasks}</Td>
                          <Td>
                            {m.overdueCount > 0 ? (
                              <span className="text-danger font-medium">{m.overdueCount}</span>
                            ) : (
                              <span className="text-disabled">—</span>
                            )}
                          </Td>
                          <Td className="text-xs">{hoursToDisplay(m.cargaRealHours)}h/{hoursToDisplay(m.cargaBaseHours)}h</Td>
                          <Td>{m.seguimientoTotal}</Td>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>

              {/* Bloque 6 — Consultas por Motivo, con %/tendencia/interpretación */}
              {data.consultasByReason.length > 0 && (
                <div className="bg-surface rounded-2xl border border-border p-5">
                  <h3 className="text-sm font-semibold text-main uppercase tracking-wider mb-4">
                    Distribución por Motivo (Equipo Completo)
                  </h3>
                  <div className="space-y-3">
                    {data.consultasByReason.map((r) => {
                      const maxCount = data.consultasByReason[0].count;
                      const barWidthPct = Math.round((r.count / maxCount) * 100);
                      return (
                        <div key={r.reason}>
                          <div className="flex items-center gap-3">
                            <span className="text-xs text-main w-44 shrink-0 truncate" title={REASON_LABEL[r.reason] ?? r.reason}>
                              {REASON_LABEL[r.reason] ?? r.reason}
                            </span>
                            <div className="flex-1 bg-black/10 dark:bg-white/10 rounded-full h-2">
                              <div className="bg-primary h-2 rounded-full" style={{ width: `${barWidthPct}%` }} />
                            </div>
                            <span className="text-xs font-semibold text-main w-8 text-right">{r.count}</span>
                            {typeof r.pct === "number" && <span className="text-[11px] text-primary font-medium w-10 text-right">{r.pct}%</span>}
                            <span className="text-[11px] text-disabled w-16">{r.totalMinutes} min</span>
                          </div>
                          {r.interpretation && (
                            <p className="text-[11px] text-secondary mt-1 ml-0 sm:ml-[188px] leading-relaxed">{r.interpretation}</p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Bloque 9 — Tendencias */}
              {data.trends && <TrendsSection mesAnterior={data.trends.mesAnterior} trimestre={data.trends.trimestre} semestre={data.trends.semestre} />}

              {/* Bloque 10 — Insights */}
              {data.insights && <TeamInsightsSection insights={data.insights} />}

              {/* Bloque 3 — Recomendaciones ejecutivas */}
              {data.recommendations && <RecommendationsSection recommendations={data.recommendations} />}

              {/* AI Analysis */}
              {fullReport.aiAnalysis && (
                <div className="bg-surface rounded-2xl border border-border p-5">
                  <div className="flex items-center gap-2 mb-4">
                    <div className="p-1.5 bg-primary-surface rounded-lg">
                      <Lightbulb className="w-4 h-4 text-primary" strokeWidth={2} />
                    </div>
                    <h3 className="text-sm font-semibold text-main uppercase tracking-wider">
                      Análisis IA — Resumen Ejecutivo
                    </h3>
                    <span className="text-[11px] bg-primary-surface text-primary px-2 py-0.5 rounded-full font-medium">
                      llama-3.3-70b · Groq
                    </span>
                  </div>
                  <div className="prose prose-sm max-w-none text-main leading-relaxed whitespace-pre-wrap font-[system-ui,sans-serif] text-[13px]">
                    {fullReport.aiAnalysis}
                  </div>
                </div>
              )}

              {!fullReport.aiAnalysis && (
                <div className="bg-warning/[.15] rounded-2xl p-5">
                  <p className="text-sm text-warning">
                    <strong>Análisis IA no disponible.</strong> Para activar el análisis automático, configura la variable de entorno{" "}
                    <code className="bg-warning/20 px-1 rounded">GROQ_API_KEY</code> en el archivo <code className="bg-warning/20 px-1 rounded">.env</code>. Obtén una API key gratuita en{" "}
                    <span className="font-medium">console.groq.com</span>.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      </div>
      )}
    </div>
  );
}
