"use client";

import { useState, useEffect, useCallback } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ReferenceLine,
} from "recharts";
import type { Role } from "@/generated/prisma/client";
import { ROLE_LABEL } from "@/lib/roles";
import type { MonthlyReportSummary, MonthlyReportFull, ReportData, RangeReportData } from "./types";
import * as XLSX from "xlsx";
import { formatDate } from "@/lib/utils";
import { hoursToDisplay } from "@/lib/timeFormat";

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

function colorDot(pct: number, type: "cumplimiento" | "carga" = "cumplimiento") {
  if (type === "carga") {
    if (pct <= 100) return "bg-success";
    if (pct <= 120) return "bg-warning";
    return "bg-danger";
  }
  if (pct >= 80) return "bg-success";
  if (pct >= 60) return "bg-warning";
  return "bg-danger";
}

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
    ["Fecha generación", new Date(report.createdAt).toLocaleDateString("es-CL")],
    [""],
    ["RESUMEN DEL EQUIPO", ""],
    ["Promedio de cumplimiento", `${data.teamSummary.avgCumplimiento}%`],
    ["Total tareas completadas", `${data.teamSummary.totalCompletedTasks} / ${data.teamSummary.totalTasks}`],
    ["Carga laboral del equipo", `${data.teamSummary.avgCargaPct}% (${hoursToDisplay(data.teamSummary.totalCargaRealHours)}h de ${hoursToDisplay(data.teamSummary.totalCargaBaseHours)}h base)`],
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
    ["Nombre", "Cargo", "Score", "Cumplimiento%", "Carga%", "Tareas", "Completadas", "Vencidas", "Horas reales", "Base (h)", "Consultas"],
    ...data.members.map((m) => [
      m.name,
      ROLE_LABEL[m.role as Role] ?? m.role,
      m.score,
      m.completedPct,
      m.cargaPct,
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
    <thead><tr><th>Motivo</th><th>Consultas</th><th>Total min</th></tr></thead>
    <tbody>
      ${data.consultasByReason
        .map(
          (r) => `<tr>
        <td>${REASON_LABEL[r.reason] ?? r.reason}</td>
        <td>${r.count}</td>
        <td>${r.totalMinutes}</td>
      </tr>`,
        )
        .join("")}
    </tbody>
  </table>`
      : '<p style="color:#64748b">Sin consultas SEGUIMIENTO en este período.</p>';

  const aiHtml = report.aiAnalysis
    ? `<h2>Análisis IA</h2>
  <div class="ai-analysis">${report.aiAnalysis.replace(/\n/g, "<br>").replace(/## /g, "<h3>").replace(/\*\*/g, "<strong>")}</div>`
    : "";

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>Informe Consolidado – ${periodLabel}</title>
<style>
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
  @media print{body{padding:16px}}
</style>
</head>
<body>
  <h1>Informe Mensual Consolidado</h1>
  <div class="meta">
    Período: <strong>${periodLabel}</strong> &bull;
    Generado por: <strong>${report.generatedBy}</strong> &bull;
    ${new Date(report.createdAt).toLocaleDateString("es-CL")}
  </div>

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
  </div>

  <h2>Alertas</h2>
  ${alertsHtml}

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

  <h2>Consultas SEGUIMIENTO por Motivo</h2>
  ${consultasHtml}

  ${aiHtml}
</body>
</html>`;

  const win = window.open("", "_blank");
  if (win) {
    win.document.write(html);
    win.document.close();
    setTimeout(() => win.print(), 300);
  }
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
        {new Date(report.createdAt).toLocaleDateString("es-CL")}
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
    ["Nombre", "Cargo", "Score prom.", "Cumpl.%", "Carga%", "Tareas", "Compl.", "Horas reales", "Base (h)", "Consultas"],
    ...data.aggregated.members.map((m) => [
      m.name, ROLE_LABEL[m.role as Role] ?? m.role, m.score, m.completedPct,
      m.cargaPct, m.totalTasks, m.completedTasks, hoursToDisplay(m.cargaRealHours), hoursToDisplay(m.cargaBaseHours), m.seguimientoTotal,
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

  const aiHtml = data.aiAnalysis
    ? `<h2>Análisis IA</h2><div class="ai-analysis">${data.aiAnalysis.replace(/\n/g, "<br>")}</div>`
    : "";

  const html = `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8">
<title>Informe Rango – ${periodLabel}</title>
<style>
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
  @media print{body{padding:16px}}
</style></head><body>
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
  </div>

  <h2>Alertas Persistentes</h2>${alertsHtml}

  <h2>Evolución Mensual</h2>
  <table><thead><tr><th>Mes</th><th>Cumpl.%</th><th>Tareas compl/total</th><th>Carga (real/base)</th><th>Consultas</th></tr></thead>
  <tbody>${evoRows}</tbody></table>

  <h2>Ranking del Período</h2>
  <table><thead><tr><th>#</th><th>Nombre</th><th>Cargo</th><th>Score prom.</th><th>Cumpl. prom.</th></tr></thead>
  <tbody>${rankingRows}</tbody></table>

  ${aiHtml}
</body></html>`;

  const win = window.open("", "_blank");
  if (win) { win.document.write(html); win.document.close(); setTimeout(() => win.print(), 300); }
}

// ── Main component ────────────────────────────────────────────────────────────

type Props = {
  currentUserRole: string;
};

export default function MonthlyReports({ currentUserRole }: Props) {
  const [viewMode, setViewMode] = useState<"individual" | "range">("individual");

  // ── Individual month state ─────────────────────────────────────────────────
  const [reports, setReports] = useState<MonthlyReportSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [fullReport, setFullReport] = useState<MonthlyReportFull | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generateMonth, setGenerateMonth] = useState(currentMonthParam);
  const [error, setError] = useState<string | null>(null);

  // ── Range state ────────────────────────────────────────────────────────────
  const [rangeFrom, setRangeFrom] = useState(() => addMonths(currentMonthParam(), -5));
  const [rangeTo, setRangeTo] = useState(currentMonthParam);
  const [rangeReport, setRangeReport] = useState<RangeReportData | null>(null);
  const [rangeLoading, setRangeLoading] = useState(false);
  const [rangeError, setRangeError] = useState<string | null>(null);

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
    setError(null);
    try {
      const res = await fetch(`/api/reports/generate?month=${generateMonth}`, { method: "POST" });
      if (!res.ok) {
        const err: { error?: string } = await res.json();
        setError(err.error ?? "Error al generar el informe");
        return;
      }
      const data: { report: MonthlyReportFull } = await res.json();
      await fetchReports();
      setFullReport(data.report);
      setSelectedId(data.report.id);
    } finally {
      setGenerating(false);
    }
  }

  async function handleGenerateRange() {
    if (rangeFrom >= rangeTo) {
      setRangeError("El mes de inicio debe ser anterior al mes de fin");
      return;
    }
    setRangeLoading(true);
    setRangeError(null);
    setRangeReport(null);
    try {
      const res = await fetch(`/api/reports/range?from=${rangeFrom}&to=${rangeTo}`);
      if (!res.ok) {
        const err: { error?: string } = await res.json();
        setRangeError(err.error ?? "Error al generar el informe de rango");
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
        <div className="w-7 h-7 border-2 border-primary border-t-transparent rounded-full animate-spin" />
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
            <button
              onClick={handleGenerateRange}
              disabled={rangeLoading}
              className="flex items-center gap-1.5 px-5 py-2 text-sm bg-primary rounded-lg text-white hover:bg-primary-hover transition-colors disabled:opacity-60"
            >
              {rangeLoading ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Generando...
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                  </svg>
                  Generar informe de rango
                </>
              )}
            </button>
            {rangeReport && !rangeLoading && (
              <div className="flex items-center gap-2 ml-auto">
                <button
                  onClick={() => downloadRangeExcel(rangeReport)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-border rounded-lg text-main hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  Excel
                </button>
                <button
                  onClick={() => downloadRangePDF(rangeReport)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-primary rounded-lg text-white hover:bg-primary-hover transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                  </svg>
                  PDF
                </button>
              </div>
            )}
          </div>

          {rangeError && (
            <div className="bg-danger/[.09] text-danger text-sm rounded-xl px-4 py-3">{rangeError}</div>
          )}

          {rangeLoading && (
            <div className="flex flex-col items-center justify-center py-24 gap-3 text-disabled">
              <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              <p className="text-sm">Calculando KPIs mes a mes y generando análisis IA...</p>
            </div>
          )}

          {!rangeLoading && !rangeReport && !rangeError && (
            <div className="flex flex-col items-center justify-center py-24 text-disabled">
              <svg className="w-12 h-12 mb-4 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              <p className="text-sm">Selecciona un rango y genera el informe</p>
            </div>
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
              <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
                <MetricStat label="Cumplimiento promedio" value={`${rangeReport.aggregated.teamSummary.avgCumplimiento}%`} sub={`${rangeReport.months.length} meses`} accent />
                <MetricStat label="Tareas completadas" value={`${rangeReport.aggregated.teamSummary.totalCompletedTasks}`} sub={`de ${rangeReport.aggregated.teamSummary.totalTasks} totales`} />
                <MetricStat label="Carga laboral acumulada" value={`${rangeReport.aggregated.teamSummary.avgCargaPct}%`} sub={`${hoursToDisplay(rangeReport.aggregated.teamSummary.totalCargaRealHours)}h de ${hoursToDisplay(rangeReport.aggregated.teamSummary.totalCargaBaseHours)}h base`} />
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
                <div className="overflow-x-auto -mx-5 px-5">
                  <table className="w-full text-sm min-w-[500px]">
                    <thead>
                      <tr className="border-b border-border">
                        {["Mes", "Cumpl. equipo", "Tareas", "Carga", "Consultas"].map((h) => (
                          <th key={h} className="text-left py-2 pr-4 text-xs font-semibold text-secondary uppercase tracking-wider">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {rangeReport.months.map((ms) => (
                        <tr key={ms.month} className={`hover:bg-surface2 ${ms.totalTasks > 0 && ms.teamAvgCumplimiento < 60 ? "bg-danger/[.06]" : ""}`}>
                          <td className="py-2 pr-4 text-sm font-medium text-title">{ms.label}</td>
                          <td className="py-2 pr-4">
                            <span className="flex items-center gap-1.5">
                              <div className={`w-2 h-2 rounded-full ${colorDot(ms.teamAvgCumplimiento)}`} />
                              {ms.teamAvgCumplimiento}%
                            </span>
                          </td>
                          <td className="py-2 pr-4 text-main">{ms.totalCompletedTasks}/{ms.totalTasks}</td>
                          <td className="py-2 pr-4 text-main text-xs">
                            {ms.totalCargaBaseHours > 0 ? Math.round((ms.totalCargaRealHours / ms.totalCargaBaseHours) * 100) : 0}%
                            {" "}({hoursToDisplay(ms.totalCargaRealHours)}h/{hoursToDisplay(ms.totalCargaBaseHours)}h)
                          </td>
                          <td className="py-2 pr-4 text-main">{ms.totalConsultas}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
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

              {/* AI Analysis */}
              {rangeReport.aiAnalysis ? (
                <div className="bg-surface rounded-2xl border border-border p-5">
                  <div className="flex items-center gap-2 mb-4">
                    <div className="p-1.5 bg-primary-surface rounded-lg">
                      <svg className="w-4 h-4 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                      </svg>
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
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="flex items-center gap-1.5 px-4 py-1.5 text-sm bg-primary rounded-lg text-white hover:bg-primary-hover transition-colors disabled:opacity-60"
          >
            {generating ? (
              <>
                <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Generando...
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
                Generar / Actualizar
              </>
            )}
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-danger/[.09] text-danger text-sm rounded-xl px-4 py-3">
          {error}
        </div>
      )}

      {/* Two-panel layout */}
      <div className="flex gap-5 items-start">
        {/* Left sidebar */}
        <aside className="w-[220px] shrink-0 bg-surface rounded-2xl border border-border p-3 sticky top-20">
          <p className="text-[11px] font-semibold text-disabled uppercase tracking-wider px-2 mb-2">
            Informes guardados
          </p>
          {reports.length === 0 ? (
            <p className="text-xs text-disabled px-2 py-4 text-center leading-relaxed">
              No hay informes generados aún. Usa el botón para crear el primero.
            </p>
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
              <div className="w-7 h-7 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
          )}

          {!detailLoading && !fullReport && reports.length === 0 && (
            <div className="flex flex-col items-center justify-center py-32 text-disabled">
              <svg className="w-12 h-12 mb-4 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <p className="text-sm">Aún no hay informes generados</p>
              <p className="text-xs mt-1">Selecciona un mes y haz clic en &quot;Generar / Actualizar&quot;</p>
            </div>
          )}

          {!detailLoading && fullReport && data && selectedSummary && (
            <div className="space-y-5">
              {/* Report header */}
              <div className="bg-surface rounded-2xl border border-border px-5 py-4 flex items-center justify-between gap-4">
                <div>
                  <h2 className="text-xl font-bold text-title">
                    {formatMonthYear(selectedSummary.month, selectedSummary.year)}
                  </h2>
                  <p className="text-sm text-secondary">
                    Generado por {selectedSummary.generatedBy} el{" "}
                    {formatDate(selectedSummary.createdAt)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => downloadReportExcel(fullReport)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-border rounded-lg text-main hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                    Excel consolidado
                  </button>
                  <button
                    onClick={() => downloadReportPDF(fullReport)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-primary rounded-lg text-white hover:bg-primary-hover transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                    </svg>
                    PDF consolidado
                  </button>
                </div>
              </div>

              {/* Team summary stats */}
              <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
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
                <div className="overflow-x-auto -mx-5 px-5">
                  <table className="w-full text-sm min-w-[700px]">
                    <thead>
                      <tr className="border-b border-border">
                        {["Colaborador", "Score", "Cumpl.", "Carga", "Tareas", "Vencidas", "Horas", "Consultas"].map((h) => (
                          <th key={h} className="text-left py-2 pr-4 text-xs font-semibold text-secondary uppercase tracking-wider">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {data.members.map((m) => (
                        <tr key={m.id} className="hover:bg-black/5 dark:hover:bg-white/5 transition-colors">
                          <td className="py-2.5 pr-4">
                            <p className="text-sm font-semibold text-title">{m.name}</p>
                            <p className="text-[11px] text-disabled">{ROLE_LABEL[m.role as Role] ?? m.role}</p>
                          </td>
                          <td className="py-2.5 pr-4 font-bold text-main">{m.score}<span className="text-disabled font-normal">/100</span></td>
                          <td className="py-2.5 pr-4">
                            <span className="flex items-center gap-1.5">
                              <div className={`w-2 h-2 rounded-full ${colorDot(m.completedPct)}`} />
                              {m.completedPct}%
                            </span>
                          </td>
                          <td className="py-2.5 pr-4">
                            <span className="flex items-center gap-1.5">
                              <div className={`w-2 h-2 rounded-full ${colorDot(m.cargaPct, "carga")}`} />
                              {m.cargaPct}%
                            </span>
                          </td>
                          <td className="py-2.5 pr-4 text-main">{m.completedTasks}/{m.totalTasks}</td>
                          <td className="py-2.5 pr-4">
                            {m.overdueCount > 0 ? (
                              <span className="text-danger font-medium">{m.overdueCount}</span>
                            ) : (
                              <span className="text-disabled">—</span>
                            )}
                          </td>
                          <td className="py-2.5 pr-4 text-main text-xs">{hoursToDisplay(m.cargaRealHours)}h/{hoursToDisplay(m.cargaBaseHours)}h</td>
                          <td className="py-2.5 pr-4 text-main">{m.seguimientoTotal}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Consultas by reason */}
              {data.consultasByReason.length > 0 && (
                <div className="bg-surface rounded-2xl border border-border p-5">
                  <h3 className="text-sm font-semibold text-main uppercase tracking-wider mb-4">
                    Consultas SEGUIMIENTO por Motivo (Equipo Completo)
                  </h3>
                  <div className="space-y-2">
                    {data.consultasByReason.map((r) => {
                      const maxCount = data.consultasByReason[0].count;
                      const pct = Math.round((r.count / maxCount) * 100);
                      return (
                        <div key={r.reason} className="flex items-center gap-3">
                          <span className="text-xs text-main w-44 shrink-0 truncate" title={REASON_LABEL[r.reason] ?? r.reason}>
                            {REASON_LABEL[r.reason] ?? r.reason}
                          </span>
                          <div className="flex-1 bg-black/10 dark:bg-white/10 rounded-full h-2">
                            <div className="bg-primary h-2 rounded-full" style={{ width: `${pct}%` }} />
                          </div>
                          <span className="text-xs font-semibold text-main w-8 text-right">{r.count}</span>
                          <span className="text-[11px] text-disabled w-16">{r.totalMinutes} min</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* AI Analysis */}
              {fullReport.aiAnalysis && (
                <div className="bg-surface rounded-2xl border border-border p-5">
                  <div className="flex items-center gap-2 mb-4">
                    <div className="p-1.5 bg-primary-surface rounded-lg">
                      <svg className="w-4 h-4 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                      </svg>
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
