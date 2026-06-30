"use client";

import { useState, useEffect, useCallback } from "react";
import type { Role } from "@/generated/prisma/client";
import { ROLE_LABEL } from "@/lib/roles";
import type { MonthlyReportSummary, MonthlyReportFull, ReportData } from "./types";
import * as XLSX from "xlsx";

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

function colorDot(pct: number, type: "cumplimiento" | "carga" = "cumplimiento") {
  if (type === "carga") {
    if (pct <= 100) return "bg-green-500";
    if (pct <= 120) return "bg-amber-400";
    return "bg-red-500";
  }
  if (pct >= 80) return "bg-green-500";
  if (pct >= 60) return "bg-amber-400";
  return "bg-red-500";
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
    ["Horas reales totales", `${data.teamSummary.totalRealHours}h`],
    ["Horas estimadas totales", `${data.teamSummary.totalEstimatedHours}h`],
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
    ["Nombre", "Cargo", "Score", "Cumplimiento%", "Carga%", "Tareas", "Completadas", "Vencidas", "H.Est.", "H.Real", "Consultas"],
    ...data.members.map((m) => [
      m.name,
      ROLE_LABEL[m.role as Role] ?? m.role,
      m.score,
      m.completedPct,
      m.cargaRatio,
      m.totalTasks,
      m.completedTasks,
      m.overdueCount,
      m.estimatedHours,
      m.realHours,
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
      <td>${m.cargaRatio}%</td>
      <td>${m.completedTasks}/${m.totalTasks}</td>
      <td>${m.overdueCount}</td>
      <td>${m.realHours}/${m.estimatedHours}h</td>
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
      <div class="stat-label">Horas reales / estimadas</div>
      <div class="stat-value" style="font-size:16px">${data.teamSummary.totalRealHours}h<span style="color:#94a3b8;font-size:12px">/${data.teamSummary.totalEstimatedHours}h</span></div>
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
        <th>Compl/Total</th><th>Vencidas</th><th>H.Real/Est</th><th>Consultas</th>
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
          ? "bg-indigo-50 ring-2 ring-indigo-300"
          : "hover:bg-slate-50 ring-1 ring-transparent"
      }`}
    >
      <p className={`text-sm font-semibold ${selected ? "text-indigo-700" : "text-slate-800"}`}>
        {formatMonthYear(report.month, report.year)}
      </p>
      <p className="text-[11px] text-slate-400 mt-0.5">
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
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <p className="text-[11px] text-slate-400 uppercase tracking-wider font-medium mb-1">{label}</p>
      <p className={`text-2xl font-bold ${accent ? "text-indigo-600" : "text-slate-800"}`}>{value}</p>
      {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

type Props = {
  currentUserRole: string;
};

export default function MonthlyReports({ currentUserRole }: Props) {
  const [reports, setReports] = useState<MonthlyReportSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [fullReport, setFullReport] = useState<MonthlyReportFull | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generateMonth, setGenerateMonth] = useState(currentMonthParam);
  const [error, setError] = useState<string | null>(null);

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
      const res = await fetch(`/api/reports/generate?month=${generateMonth}`, {
        method: "POST",
      });
      if (!res.ok) {
        const err: { error?: string } = await res.json();
        setError(err.error ?? "Error al generar el informe");
        return;
      }
      const data: { report: MonthlyReportFull } = await res.json();
      // Refresh list and select new report
      await fetchReports();
      setFullReport(data.report);
      setSelectedId(data.report.id);
    } finally {
      setGenerating(false);
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center items-center py-32">
        <div className="w-7 h-7 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const selectedSummary = reports.find((r) => r.id === selectedId);
  const data: ReportData | null = fullReport?.data ?? null;

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Informes Mensuales</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {currentUserRole === "JEFE_NACIONAL"
              ? "Consolidado de todo el equipo"
              : "Consolidado de tu equipo (excluye Jefe Nacional)"}
          </p>
        </div>

        {/* Generate panel */}
        <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-xl px-4 py-2">
          <label className="text-sm text-slate-500 whitespace-nowrap">Generar informe:</label>
          <input
            type="month"
            value={generateMonth}
            onChange={(e) => setGenerateMonth(e.target.value)}
            className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-300"
          />
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="flex items-center gap-1.5 px-4 py-1.5 text-sm bg-indigo-600 rounded-lg text-white hover:bg-indigo-700 transition-colors disabled:opacity-60"
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
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">
          {error}
        </div>
      )}

      {/* Two-panel layout */}
      <div className="flex gap-5 items-start">
        {/* Left sidebar */}
        <aside className="w-[220px] shrink-0 bg-white rounded-2xl border border-slate-200 p-3 sticky top-20">
          <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider px-2 mb-2">
            Informes guardados
          </p>
          {reports.length === 0 ? (
            <p className="text-xs text-slate-400 px-2 py-4 text-center leading-relaxed">
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
              <div className="w-7 h-7 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
            </div>
          )}

          {!detailLoading && !fullReport && reports.length === 0 && (
            <div className="flex flex-col items-center justify-center py-32 text-slate-400">
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
              <div className="bg-white rounded-2xl border border-slate-200 px-5 py-4 flex items-center justify-between gap-4">
                <div>
                  <h2 className="text-xl font-bold text-slate-900">
                    {formatMonthYear(selectedSummary.month, selectedSummary.year)}
                  </h2>
                  <p className="text-sm text-slate-500">
                    Generado por {selectedSummary.generatedBy} el{" "}
                    {new Date(selectedSummary.createdAt).toLocaleDateString("es-CL")}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => downloadReportExcel(fullReport)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50 transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                    Excel consolidado
                  </button>
                  <button
                    onClick={() => downloadReportPDF(fullReport)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-indigo-600 rounded-lg text-white hover:bg-indigo-700 transition-colors"
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
                  label="Horas equipo"
                  value={`${data.teamSummary.totalRealHours}h`}
                  sub={`de ${data.teamSummary.totalEstimatedHours}h estimadas`}
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
                <div className="bg-white rounded-2xl border border-slate-200 p-5">
                  <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wider mb-3">
                    Alertas de Gestión
                  </h3>
                  <div className="space-y-2">
                    {data.alerts.map((a, i) => (
                      <div
                        key={i}
                        className={`flex items-start gap-3 px-4 py-3 rounded-xl border ${
                          a.type === "cumplimiento"
                            ? "bg-red-50 border-red-200"
                            : "bg-amber-50 border-amber-200"
                        }`}
                      >
                        <span className="text-lg leading-none mt-0.5">⚠️</span>
                        <div>
                          <p className={`text-sm font-semibold ${a.type === "cumplimiento" ? "text-red-700" : "text-amber-700"}`}>
                            {a.name}
                          </p>
                          <p className={`text-xs ${a.type === "cumplimiento" ? "text-red-600" : "text-amber-600"}`}>
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
              <div className="bg-white rounded-2xl border border-slate-200 p-5">
                <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wider mb-4">
                  Ranking de Cumplimiento del Equipo
                </h3>
                <div className="space-y-2">
                  {data.ranking.map((m, i) => (
                    <div key={m.id} className="flex items-center gap-3 py-2 border-b border-slate-100 last:border-0">
                      <span
                        className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                          i === 0
                            ? "bg-amber-100 text-amber-700"
                            : i === 1
                              ? "bg-slate-100 text-slate-600"
                              : i === 2
                                ? "bg-orange-100 text-orange-600"
                                : "bg-slate-50 text-slate-400"
                        }`}
                      >
                        {i + 1}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-slate-800 truncate">{m.name}</p>
                        <p className="text-[11px] text-slate-400">{ROLE_LABEL[m.role as Role] ?? m.role}</p>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <div className="text-right">
                          <p className="text-sm font-bold text-slate-700">{m.score}<span className="text-slate-400 font-normal">/100</span></p>
                        </div>
                        <div className="w-24 bg-slate-100 rounded-full h-2">
                          <div
                            className={`h-2 rounded-full transition-all ${
                              m.completedPct >= 80
                                ? "bg-green-500"
                                : m.completedPct >= 60
                                  ? "bg-amber-400"
                                  : "bg-red-500"
                            }`}
                            style={{ width: `${m.completedPct}%` }}
                          />
                        </div>
                        <span className="text-sm text-slate-600 w-10 text-right">{m.completedPct}%</span>
                        <div className={`w-2 h-2 rounded-full ${colorDot(m.completedPct)}`} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Detail table */}
              <div className="bg-white rounded-2xl border border-slate-200 p-5">
                <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wider mb-4">
                  Detalle por Colaborador
                </h3>
                <div className="overflow-x-auto -mx-5 px-5">
                  <table className="w-full text-sm min-w-[700px]">
                    <thead>
                      <tr className="border-b border-slate-200">
                        {["Colaborador", "Score", "Cumpl.", "Carga", "Tareas", "Vencidas", "Horas", "Consultas"].map((h) => (
                          <th key={h} className="text-left py-2 pr-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {data.members.map((m) => (
                        <tr key={m.id} className="hover:bg-slate-50 transition-colors">
                          <td className="py-2.5 pr-4">
                            <p className="text-sm font-semibold text-slate-800">{m.name}</p>
                            <p className="text-[11px] text-slate-400">{ROLE_LABEL[m.role as Role] ?? m.role}</p>
                          </td>
                          <td className="py-2.5 pr-4 font-bold text-slate-700">{m.score}<span className="text-slate-400 font-normal">/100</span></td>
                          <td className="py-2.5 pr-4">
                            <span className="flex items-center gap-1.5">
                              <div className={`w-2 h-2 rounded-full ${colorDot(m.completedPct)}`} />
                              {m.completedPct}%
                            </span>
                          </td>
                          <td className="py-2.5 pr-4">
                            <span className="flex items-center gap-1.5">
                              <div className={`w-2 h-2 rounded-full ${colorDot(m.cargaRatio, "carga")}`} />
                              {m.cargaRatio}%
                            </span>
                          </td>
                          <td className="py-2.5 pr-4 text-slate-600">{m.completedTasks}/{m.totalTasks}</td>
                          <td className="py-2.5 pr-4">
                            {m.overdueCount > 0 ? (
                              <span className="text-red-600 font-medium">{m.overdueCount}</span>
                            ) : (
                              <span className="text-slate-300">—</span>
                            )}
                          </td>
                          <td className="py-2.5 pr-4 text-slate-600 text-xs">{m.realHours}h/{m.estimatedHours}h</td>
                          <td className="py-2.5 pr-4 text-slate-600">{m.seguimientoTotal}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Consultas by reason */}
              {data.consultasByReason.length > 0 && (
                <div className="bg-white rounded-2xl border border-slate-200 p-5">
                  <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wider mb-4">
                    Consultas SEGUIMIENTO por Motivo (Equipo Completo)
                  </h3>
                  <div className="space-y-2">
                    {data.consultasByReason.map((r) => {
                      const maxCount = data.consultasByReason[0].count;
                      const pct = Math.round((r.count / maxCount) * 100);
                      return (
                        <div key={r.reason} className="flex items-center gap-3">
                          <span className="text-xs text-slate-600 w-44 shrink-0 truncate" title={REASON_LABEL[r.reason] ?? r.reason}>
                            {REASON_LABEL[r.reason] ?? r.reason}
                          </span>
                          <div className="flex-1 bg-slate-100 rounded-full h-2">
                            <div className="bg-indigo-500 h-2 rounded-full" style={{ width: `${pct}%` }} />
                          </div>
                          <span className="text-xs font-semibold text-slate-700 w-8 text-right">{r.count}</span>
                          <span className="text-[11px] text-slate-400 w-16">{r.totalMinutes} min</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* AI Analysis */}
              {fullReport.aiAnalysis && (
                <div className="bg-white rounded-2xl border border-slate-200 p-5">
                  <div className="flex items-center gap-2 mb-4">
                    <div className="p-1.5 bg-indigo-50 rounded-lg">
                      <svg className="w-4 h-4 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                      </svg>
                    </div>
                    <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wider">
                      Análisis IA — Resumen Ejecutivo
                    </h3>
                    <span className="text-[11px] bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded-full font-medium">
                      llama-3.3-70b · Groq
                    </span>
                  </div>
                  <div className="prose prose-sm max-w-none text-slate-700 leading-relaxed whitespace-pre-wrap font-[system-ui,sans-serif] text-[13px]">
                    {fullReport.aiAnalysis}
                  </div>
                </div>
              )}

              {!fullReport.aiAnalysis && (
                <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5">
                  <p className="text-sm text-amber-700">
                    <strong>Análisis IA no disponible.</strong> Para activar el análisis automático, configura la variable de entorno{" "}
                    <code className="bg-amber-100 px-1 rounded">GROQ_API_KEY</code> en el archivo <code className="bg-amber-100 px-1 rounded">.env</code>. Obtén una API key gratuita en{" "}
                    <span className="font-medium">console.groq.com</span>.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
