"use client";

import { useState, useEffect } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from "recharts";
import * as XLSX from "xlsx";
import type { Role } from "@/generated/prisma/client";
import { ROLE_LABEL, isLeadershipRole } from "@/lib/roles";
import type { KpiData, KpiColor, WorkloadColor, WorkloadLabel } from "./types";
import { DonutChart, CumplimientoLineChart, HistorySparklineList, REASON_LABEL } from "./KpiCharts";
import WorkloadCard from "./WorkloadCard";
import { TaskBreakdownCard, PriorityComplianceCard, NovaInsightsCard } from "./InsightCards";
import { AdvancedAnalyticsPanel, ExplainModal, KpiSectionNav, MaturityStars } from "./AdvancedAnalytics";
import { maturityFromCount } from "@/lib/analyticsExplain";
import { InsightsPanel } from "./InsightsPanel";
import ScoreHistoryChart from "./ScoreHistoryChart";
import WhatIfSimulator from "./WhatIfSimulator";
import { formatDate } from "@/lib/utils";
import { hoursToDisplay } from "@/lib/timeFormat";
import { openReportWindow, fetchAnalyticsExportMeta } from "./reportWindow";
import { Button } from "@/components/ui/Button";
import { StatusChip } from "@/components/ui/Chip";
import { TASK_STATUS_CONFIG } from "@/lib/chipConfig";
import { Table, TableHead, TableBody, TableRow, Th, Td } from "@/components/ui/Table";
import { Spinner } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { BarChart3 } from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

type PersonalMonthSnapshot = {
  month: string;
  label: string;
  completedPct: number;
  totalTasks: number;
  completedTasks: number;
  overdueCount: number;
  realHours: number;
  estimatedHours: number;
  seguimientoTotal: number;
  score: number;
  cargaRealHours: number;
  cargaBaseHours: number;
  cargaPct: number;
  cargaColor: WorkloadColor;
  cargaLabel: WorkloadLabel;
  cargaRangeMin: number;
  cargaRangeMax: number;
};

type PersonalRangeReport = {
  from: string;
  to: string;
  months: PersonalMonthSnapshot[];
  aggregated: {
    avgCumplimiento: number;
    avgScore: number;
    totalTasks: number;
    totalCompletedTasks: number;
    totalRealHours: number;
    totalEstimatedHours: number;
    totalSeguimiento: number;
    consultasByReason: Array<{ reason: string; count: number; totalMinutes: number }>;
    totalCargaRealHours: number;
    totalCargaBaseHours: number;
    avgCargaPct: number;
    cargaColor: WorkloadColor;
    cargaLabel: WorkloadLabel;
    cargaRangeMin: number;
    cargaRangeMax: number;
  };
  trends: {
    cumplimientoTrend: "mejora" | "deterioro" | "estancamiento";
    cumplimientoChange: number;
    firstMonthCumplimiento: number;
    lastMonthCumplimiento: number;
  };
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function currentMonthParam() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function formatMonthLabel(m: string) {
  const [y, mo] = m.split("-");
  return new Date(parseInt(y), parseInt(mo) - 1, 1).toLocaleDateString("es-CL", {
    month: "long",
    year: "numeric",
  });
}

function addMonths(base: string, n: number) {
  let [y, m] = base.split("-").map(Number);
  m += n;
  while (m > 12) { m -= 12; y++; }
  while (m <= 0) { m += 12; y--; }
  return `${y}-${String(m).padStart(2, "0")}`;
}

const DOT_CLASS: Record<WorkloadColor, string> = {
  green: "bg-success",
  yellow: "bg-warning",
  orange: "bg-orange-500",
  red: "bg-danger",
};

const CARD_BG: Record<KpiColor | "gray", string> = {
  green: "bg-success/[.13] border-transparent",
  yellow: "bg-warning/[.15] border-transparent",
  red: "bg-danger/[.13] border-transparent",
  gray: "bg-background border-border",
};

const STATUS_LABEL: Record<string, string> = {
  PENDIENTE: "Pendiente",
  EN_PROGRESO: "En progreso",
  COMPLETADA: "Completada",
  CANCELADA: "Cancelada",
};

const TYPE_LABEL: Record<string, string> = {
  SEGUIMIENTO: "Seguimiento",
  ADMINISTRATIVO: "Administrativo",
  OPERATIVO: "Operativo",
  PROYECTO: "Proyecto",
  REUNION: "Reunión",
  CAPACITACION: "Capacitación",
  FIJA: "Fija",
};

function motivationalMessage(
  pct: number,
  tasks: number,
  trend?: "mejora" | "deterioro" | "estancamiento",
): { icon: string; text: string; bg: string } {
  if (tasks === 0) {
    return {
      icon: "📋",
      text: "No hay tareas registradas en este período. Consulta con tu coordinador si hay actividades pendientes de asignar.",
      bg: "bg-background border-border",
    };
  }
  const trendSuffix =
    trend === "mejora"
      ? " La tendencia general es positiva."
      : trend === "deterioro"
        ? " Se observa una baja en la tendencia. Identifica qué meses fueron más exigentes."
        : "";

  if (pct >= 90) {
    return {
      icon: "🌟",
      text: `Desempeño sobresaliente en el período analizado.${trendSuffix}`,
      bg: "bg-success/[.13] border-transparent",
    };
  }
  if (pct >= 80) {
    return {
      icon: "✅",
      text: `Buen desempeño. Estás cumpliendo con el objetivo en este período.${trendSuffix}`,
      bg: "bg-success/[.13] border-transparent",
    };
  }
  if (pct >= 60) {
    return {
      icon: "📈",
      text: `Cumplimiento dentro del rango aceptable, con margen para mejorar.${trendSuffix}`,
      bg: "bg-warning/[.15] border-transparent",
    };
  }
  return {
    icon: "⚠️",
    text: `El cumplimiento promedio del período está por debajo del mínimo esperado (60%). Revisa las tareas vencidas y coordina con tu supervisor si necesitas apoyo.${trendSuffix}`,
    bg: "bg-danger/[.13] border-transparent",
  };
}

// ── PDF/Excel — individual month ──────────────────────────────────────────────

function downloadKpisExcel(kpi: KpiData, month: string, name: string, role: string) {
  const wb = XLSX.utils.book_new();
  const period = formatMonthLabel(month);

  const summaryRows = [
    ["Mis KPIs personales", ""],
    ["Nombre", name],
    ["Cargo", ROLE_LABEL[role as Role] ?? role],
    ["Período", period],
    [""],
    ["INDICADORES CLAVE", ""],
    ["Score global", `${kpi.score}/100`],
    ["Cumplimiento", `${kpi.cumplimiento.completedPct}%`],
    ["Carga laboral", `${kpi.cargaLaboral.ratio}%`],
    ["Horas reales / Tiempo objetivo", `${hoursToDisplay(kpi.cargaLaboral.realHours)}h / ${hoursToDisplay(kpi.cargaLaboral.estimatedHours)}h`],
    ["Total tareas", kpi.cumplimiento.total],
    ["Completadas", kpi.cumplimiento.completed],
    ["Vencidas", kpi.cumplimiento.overdue],
    ["Consultas SEGUIMIENTO", kpi.seguimiento.total],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summaryRows), "Resumen");

  if (kpi.tasks.length > 0) {
    const taskRows = [
      ["Tarea", "Tipo", "Estado", "Fecha venc.", "Retraso (días)"],
      ...kpi.tasks.map((t) => [
        t.title,
        TYPE_LABEL[t.type] ?? t.type,
        STATUS_LABEL[t.status] ?? t.status,
        new Date(t.endDate).toLocaleDateString("es-CL"),
        t.delayDays > 0 ? t.delayDays : "—",
      ]),
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(taskRows), "Tareas");
  }

  if (kpi.seguimiento.byReason.length > 0) {
    const reasonRows = [
      ["Motivo", "Consultas", "Total minutos"],
      ...kpi.seguimiento.byReason.map((r) => [
        REASON_LABEL[r.reason] ?? r.reason,
        r.count,
        r.totalMinutes,
      ]),
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(reasonRows), "Consultas");
  }

  if (kpi.horasByWeek.length > 0) {
    const horasRows = [
      ["Semana", "Tiempo objetivo", "Horas reales"],
      ...kpi.horasByWeek.map((w) => [w.week, w.estimated, w.real]),
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(horasRows), "Horas semanales");
  }

  XLSX.writeFile(wb, `MisKPIs_${period.replace(/\s/g, "_")}.xlsx`);
}

async function downloadKpisPDF(kpi: KpiData, month: string, name: string, role: string, userId: string) {
  const analyticsMeta = await fetchAnalyticsExportMeta(userId);
  const period = formatMonthLabel(month);
  const msg = motivationalMessage(kpi.cumplimiento.completedPct, kpi.cumplimiento.total);

  const taskRows = kpi.tasks
    .sort((a, b) => {
      const o = { red: 0, yellow: 1, green: 2 } as Record<KpiColor, number>;
      return o[a.color] - o[b.color];
    })
    .map(
      (t) => `<tr>
        <td>${t.title}</td>
        <td style="font-size:11px">${TYPE_LABEL[t.type] ?? t.type}</td>
        <td><span style="font-size:11px">${STATUS_LABEL[t.status] ?? t.status}</span></td>
        <td>${new Date(t.endDate).toLocaleDateString("es-CL", { day: "2-digit", month: "short" })}</td>
        <td>${t.delayDays > 0 ? `<span style="color:#dc2626">${t.delayDays}d</span>` : "—"}</td>
      </tr>`,
    )
    .join("");

  const reasonRows = kpi.seguimiento.byReason
    .sort((a, b) => b.count - a.count)
    .map(
      (r) => `<tr>
        <td>${REASON_LABEL[r.reason] ?? r.reason}</td>
        <td>${r.count}</td>
        <td>${r.totalMinutes} min</td>
      </tr>`,
    )
    .join("");

  const styles = `
  body{font-family:system-ui,sans-serif;padding:32px;color:#1e293b;max-width:820px;margin:0 auto;font-size:13px}
  h1{color:#4f46e5;font-size:20px;margin-bottom:2px}
  .meta{color:#64748b;font-size:12px;margin-bottom:20px}
  h2{margin-top:22px;margin-bottom:8px;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#475569;border-bottom:1px solid #e2e8f0;padding-bottom:4px}
  .stats{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:10px 0}
  .stat{border:1px solid #e2e8f0;border-radius:8px;padding:10px;text-align:center}
  .stat-label{font-size:10px;text-transform:uppercase;color:#94a3b8}
  .stat-value{font-size:20px;font-weight:700;color:#4f46e5;margin:2px 0}
  .msg{border-radius:8px;padding:10px 14px;font-size:12px;margin-top:10px}
  table{width:100%;border-collapse:collapse;font-size:11px;margin-top:6px}
  th{background:#f8fafc;text-align:left;padding:6px 8px;border:1px solid #e2e8f0;font-size:10px;text-transform:uppercase;color:#64748b}
  td{padding:6px 8px;border:1px solid #e2e8f0}
  tr:nth-child(even) td{background:#fafafa}
  @media print{body{padding:16px}}`;

  const bodyHtml = `
  <h1>Mis KPIs personales</h1>
  <div class="meta">${name} — ${ROLE_LABEL[role as Role] ?? role} &bull; Período: <strong>${period}</strong>${analyticsMeta}</div>

  <h2>Indicadores clave</h2>
  <div class="stats">
    <div class="stat"><div class="stat-label">Score global</div><div class="stat-value">${kpi.score}<span style="font-size:13px;color:#94a3b8">/100</span></div></div>
    <div class="stat"><div class="stat-label">Cumplimiento</div><div class="stat-value">${kpi.cumplimiento.completedPct}%</div></div>
    <div class="stat"><div class="stat-label">Carga laboral</div><div class="stat-value">${kpi.cargaLaboral.ratio}%</div></div>
  </div>
  <div class="stats">
    <div class="stat"><div class="stat-label">Tareas</div><div class="stat-value">${kpi.cumplimiento.completed}<span style="font-size:13px;color:#94a3b8">/${kpi.cumplimiento.total}</span></div></div>
    <div class="stat"><div class="stat-label">Horas real/est.</div><div class="stat-value" style="font-size:15px">${hoursToDisplay(kpi.cargaLaboral.realHours)}h<span style="font-size:11px;color:#94a3b8">/${hoursToDisplay(kpi.cargaLaboral.estimatedHours)}h</span></div></div>
    <div class="stat"><div class="stat-label">Consultas</div><div class="stat-value">${kpi.seguimiento.total}</div></div>
  </div>

  <div class="msg" style="background:${kpi.cumplimiento.completedPct >= 80 ? "#f0fdf4;border:1px solid #bbf7d0" : kpi.cumplimiento.completedPct >= 60 ? "#fffbeb;border:1px solid #fde68a" : "#fef2f2;border:1px solid #fecaca"}">
    ${msg.icon} ${msg.text}
  </div>

  ${kpi.tasks.length > 0 ? `
  <h2>Mis tareas</h2>
  <table>
    <thead><tr><th>Tarea</th><th>Tipo</th><th>Estado</th><th>Vence</th><th>Retraso</th></tr></thead>
    <tbody>${taskRows}</tbody>
  </table>` : ""}

  ${kpi.seguimiento.byReason.length > 0 ? `
  <h2>Consultas SEGUIMIENTO por motivo</h2>
  <table>
    <thead><tr><th>Motivo</th><th>Consultas</th><th>Tiempo</th></tr></thead>
    <tbody>${reasonRows}</tbody>
  </table>` : ""}`;

  openReportWindow({
    title: `Mis KPIs — ${period}`,
    styles,
    bodyHtml,
    pdfFileName: `Mis_KPIs_${period.replace(/\s/g, "_")}.pdf`,
  });
}

// ── PDF/Excel — range ─────────────────────────────────────────────────────────

function downloadRangeExcel(
  data: PersonalRangeReport,
  name: string,
  role: string,
) {
  const wb = XLSX.utils.book_new();
  const fromLabel = formatMonthLabel(data.from);
  const toLabel = formatMonthLabel(data.to);
  const trendArrow =
    data.trends.cumplimientoTrend === "mejora"
      ? "▲"
      : data.trends.cumplimientoTrend === "deterioro"
        ? "▼"
        : "=";

  const summaryRows = [
    ["Informe de Rango Personal", ""],
    ["Nombre", name],
    ["Cargo", ROLE_LABEL[role as Role] ?? role],
    ["Período", `${fromLabel} — ${toLabel}`],
    ["Meses analizados", data.months.length],
    [""],
    ["RESUMEN ACUMULADO", ""],
    ["Cumplimiento promedio", `${data.aggregated.avgCumplimiento}%`],
    ["Score promedio", `${data.aggregated.avgScore}/100`],
    ["Tareas completadas", `${data.aggregated.totalCompletedTasks} / ${data.aggregated.totalTasks}`],
    ["Horas reales", `${hoursToDisplay(data.aggregated.totalRealHours)}h`],
    ["Tiempo objetivo", `${hoursToDisplay(data.aggregated.totalEstimatedHours)}h`],
    [
      "Carga laboral (rango)",
      `${data.aggregated.cargaLabel} — ${hoursToDisplay(data.aggregated.totalCargaRealHours)}h (rango óptimo ${hoursToDisplay(data.aggregated.cargaRangeMin)}-${hoursToDisplay(data.aggregated.cargaRangeMax)}h)`,
    ],
    ["Total consultas SEGUIMIENTO", data.aggregated.totalSeguimiento],
    [""],
    ["TENDENCIA", ""],
    ["Dirección", `${trendArrow} ${data.trends.cumplimientoTrend.toUpperCase()}`],
    ["Cumplimiento inicial", `${data.trends.firstMonthCumplimiento}%`],
    ["Cumplimiento final", `${data.trends.lastMonthCumplimiento}%`],
    ["Cambio", `${data.trends.cumplimientoChange > 0 ? "+" : ""}${data.trends.cumplimientoChange} pp`],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summaryRows), "Resumen");

  const evoRows = [
    ["Mes", "Cumpl.%", "Score", "Completadas", "Total tareas", "H. reales", "H. estim.", "Carga (rango)", "Consultas"],
    ...data.months.map((m) => [
      m.label, m.completedPct, m.score, m.completedTasks,
      m.totalTasks, hoursToDisplay(m.realHours), hoursToDisplay(m.estimatedHours), m.cargaLabel, m.seguimientoTotal,
    ]),
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(evoRows), "Evolución mensual");

  if (data.aggregated.consultasByReason.length > 0) {
    const consultasRows = [
      ["Motivo", "Total consultas", "Total minutos"],
      ...data.aggregated.consultasByReason.map((r) => [
        REASON_LABEL[r.reason] ?? r.reason, r.count, r.totalMinutes,
      ]),
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(consultasRows), "Consultas");
  }

  XLSX.writeFile(
    wb,
    `MisKPIs_Rango_${fromLabel.replace(/\s/g, "_")}_${toLabel.replace(/\s/g, "_")}.xlsx`,
  );
}

function downloadRangePDF(data: PersonalRangeReport, name: string, role: string) {
  const fromLabel = formatMonthLabel(data.from);
  const toLabel = formatMonthLabel(data.to);
  const trendArrow =
    data.trends.cumplimientoTrend === "mejora"
      ? "▲ Mejora"
      : data.trends.cumplimientoTrend === "deterioro"
        ? "▼ Deterioro"
        : "= Estancamiento";

  const msg = motivationalMessage(
    data.aggregated.avgCumplimiento,
    data.aggregated.totalTasks,
    data.trends.cumplimientoTrend,
  );

  const evoRows = data.months
    .map(
      (m) => `<tr>
        <td>${m.label}</td>
        <td>${m.completedPct}%</td>
        <td>${m.score}/100</td>
        <td>${m.completedTasks}/${m.totalTasks}</td>
        <td>${hoursToDisplay(m.realHours)}h/${hoursToDisplay(m.estimatedHours)}h</td>
        <td>${m.cargaLabel}</td>
        <td>${m.seguimientoTotal}</td>
      </tr>`,
    )
    .join("");

  const reasonRows = data.aggregated.consultasByReason
    .map(
      (r) => `<tr>
        <td>${REASON_LABEL[r.reason] ?? r.reason}</td>
        <td>${r.count}</td>
        <td>${r.totalMinutes} min</td>
      </tr>`,
    )
    .join("");

  const trendBg =
    data.trends.cumplimientoTrend === "mejora"
      ? "#dcfce7;color:#166534"
      : data.trends.cumplimientoTrend === "deterioro"
        ? "#fee2e2;color:#991b1b"
        : "#f1f5f9;color:#475569";

  const styles = `
  body{font-family:system-ui,sans-serif;padding:32px;color:#1e293b;max-width:820px;margin:0 auto;font-size:13px}
  h1{color:#4f46e5;font-size:20px;margin-bottom:2px}
  .meta{color:#64748b;font-size:12px;margin-bottom:16px}
  h2{margin-top:22px;margin-bottom:8px;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#475569;border-bottom:1px solid #e2e8f0;padding-bottom:4px}
  .trend{display:inline-block;padding:5px 14px;border-radius:8px;font-weight:700;font-size:13px;margin-bottom:10px}
  .stats{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:10px 0}
  .stat{border:1px solid #e2e8f0;border-radius:8px;padding:10px;text-align:center}
  .stat-label{font-size:10px;text-transform:uppercase;color:#94a3b8}
  .stat-value{font-size:18px;font-weight:700;color:#4f46e5;margin:2px 0}
  .msg{border-radius:8px;padding:10px 14px;font-size:12px;margin-top:10px}
  table{width:100%;border-collapse:collapse;font-size:11px;margin-top:6px}
  th{background:#f8fafc;text-align:left;padding:6px 8px;border:1px solid #e2e8f0;font-size:10px;text-transform:uppercase;color:#64748b}
  td{padding:6px 8px;border:1px solid #e2e8f0}
  tr:nth-child(even) td{background:#fafafa}
  @media print{body{padding:16px}}`;

  const bodyHtml = `
  <h1>Informe de Rango Personal</h1>
  <div class="meta">${name} — ${ROLE_LABEL[role as Role] ?? role} &bull; ${fromLabel} — ${toLabel} (${data.months.length} meses)</div>

  <div class="trend" style="background:${trendBg}">${trendArrow} — ${data.trends.firstMonthCumplimiento}% → ${data.trends.lastMonthCumplimiento}% (${data.trends.cumplimientoChange > 0 ? "+" : ""}${data.trends.cumplimientoChange} pp)</div>

  <h2>Resumen acumulado</h2>
  <div class="stats">
    <div class="stat"><div class="stat-label">Cumplimiento prom.</div><div class="stat-value">${data.aggregated.avgCumplimiento}%</div></div>
    <div class="stat"><div class="stat-label">Score promedio</div><div class="stat-value">${data.aggregated.avgScore}<span style="font-size:13px;color:#94a3b8">/100</span></div></div>
    <div class="stat"><div class="stat-label">Tareas completadas</div><div class="stat-value">${data.aggregated.totalCompletedTasks}<span style="font-size:13px;color:#94a3b8">/${data.aggregated.totalTasks}</span></div></div>
  </div>
  <div class="stats">
    <div class="stat"><div class="stat-label">Horas real/est.</div><div class="stat-value" style="font-size:14px">${hoursToDisplay(data.aggregated.totalRealHours)}h<span style="font-size:11px;color:#94a3b8">/${hoursToDisplay(data.aggregated.totalEstimatedHours)}h</span></div></div>
    <div class="stat"><div class="stat-label">Consultas SEGUIMIENTO</div><div class="stat-value">${data.aggregated.totalSeguimiento}</div></div>
    <div class="stat"><div class="stat-label">Meses analizados</div><div class="stat-value">${data.months.length}</div></div>
  </div>
  <div class="stats">
    <div class="stat"><div class="stat-label">Carga laboral (rango)</div><div class="stat-value" style="font-size:14px">${data.aggregated.cargaLabel}<span style="font-size:11px;color:#94a3b8"> — ${hoursToDisplay(data.aggregated.totalCargaRealHours)}h (óptimo ${hoursToDisplay(data.aggregated.cargaRangeMin)}-${hoursToDisplay(data.aggregated.cargaRangeMax)}h)</span></div></div>
  </div>

  <div class="msg" style="background:${data.aggregated.avgCumplimiento >= 80 ? "#f0fdf4;border:1px solid #bbf7d0" : data.aggregated.avgCumplimiento >= 60 ? "#fffbeb;border:1px solid #fde68a" : "#fef2f2;border:1px solid #fecaca"}">
    ${msg.icon} ${msg.text}
  </div>

  <h2>Evolución mensual</h2>
  <table>
    <thead><tr><th>Mes</th><th>Cumpl.%</th><th>Score</th><th>Compl./Total</th><th>Horas</th><th>Carga</th><th>Consultas</th></tr></thead>
    <tbody>${evoRows}</tbody>
  </table>

  ${
    reasonRows
      ? `<h2>Consultas SEGUIMIENTO por motivo</h2>
  <table>
    <thead><tr><th>Motivo</th><th>Consultas</th><th>Tiempo</th></tr></thead>
    <tbody>${reasonRows}</tbody>
  </table>`
      : ""
  }`;

  openReportWindow({
    title: `Mis KPIs Rango — ${fromLabel} / ${toLabel}`,
    styles,
    bodyHtml,
    pdfFileName: `Mis_KPIs_Rango_${fromLabel.replace(/\s/g, "_")}_${toLabel.replace(/\s/g, "_")}.pdf`,
  });
}

// ── Stat card ─────────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string | number;
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

function DeltaBadge({ current, prev, suffix = "%" }: { current: number; prev: number; suffix?: string }) {
  if (prev === 0 && current === 0) return null;
  const delta = current - prev;
  if (delta === 0) return <span className="text-[11px] text-disabled">sin cambio</span>;
  const positive = delta > 0;
  return (
    <span className={`text-[11px] font-medium ${positive ? "text-success" : "text-danger"}`}>
      {positive ? "▲" : "▼"} {Math.abs(delta)}{suffix} vs mes anterior
    </span>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

type Props = { currentUserId: string; currentUserName: string; currentUserRole: string };

export default function MyKpisModule({ currentUserId, currentUserName, currentUserRole }: Props) {
  // ── Individual state ──────────────────────────────────────────────────────
  const [viewMode, setViewMode] = useState<"individual" | "range">("individual");
  const [month, setMonth] = useState(currentMonthParam);
  const [kpi, setKpi] = useState<KpiData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ── Range state ───────────────────────────────────────────────────────────
  const [rangeFrom, setRangeFrom] = useState(() => addMonths(currentMonthParam(), -5));
  const [rangeTo, setRangeTo] = useState(currentMonthParam);
  const [rangeReport, setRangeReport] = useState<PersonalRangeReport | null>(null);
  const [rangeLoading, setRangeLoading] = useState(false);
  const [rangeError, setRangeError] = useState<string | null>(null);
  const [explainCumplimientoOpen, setExplainCumplimientoOpen] = useState(false);

  useEffect(() => {
    // Roles de dirección no ejecutan tareas operativas — su panel individual
    // se reemplaza por un mensaje explicativo (ver el return anticipado más
    // abajo), así que no vale la pena calcular/pedir KPIs personales para ellos.
    if (isLeadershipRole(currentUserRole as Role)) {
      queueMicrotask(() => setLoading(false));
      return;
    }
    queueMicrotask(() => {
      setLoading(true);
      setError(null);
      fetch(`/api/kpis/me?month=${month}`)
        .then((r) => r.json())
        .then((data: KpiData | { error: string }) => {
          if ("error" in data) { setError(data.error); setKpi(null); }
          else setKpi(data);
        })
        .catch(() => setError("Error de conexión"))
        .finally(() => setLoading(false));
    });
  }, [month, currentUserRole]);

  async function handleGenerateRange() {
    if (rangeFrom >= rangeTo) {
      setRangeError("El mes de inicio debe ser anterior al mes de fin");
      return;
    }
    setRangeLoading(true);
    setRangeError(null);
    setRangeReport(null);
    try {
      const res = await fetch(`/api/kpis/me/range?from=${rangeFrom}&to=${rangeTo}`);
      if (!res.ok) {
        const err: { error?: string } = await res.json();
        setRangeError(err.error ?? "Error al generar el informe");
        return;
      }
      const data: { report: PersonalRangeReport } = await res.json();
      setRangeReport(data.report);
    } finally {
      setRangeLoading(false);
    }
  }

  // ── Chart data for range ──────────────────────────────────────────────────
  const rangeChartData =
    rangeReport?.months.map((m) => ({ label: m.label, Cumplimiento: m.completedPct })) ?? [];

  // ── Roles de liderazgo (Sprint 0A) ────────────────────────────────────────
  // Su responsabilidad principal es dirigir equipos, no ejecutar tareas —
  // Tiempo Objetivo, Horas reales, Cumplimiento personal y Performance
  // individual no son representativos para este rol. Se reemplaza todo el
  // panel de "Mi actividad" por un mensaje explicativo; los KPIs del equipo
  // siguen disponibles en la pestaña "Equipo"/"Resumen ejecutivo". La
  // clasificación depende únicamente de la jerarquía de roles existente
  // (ver isLeadershipRole en roles.ts) — sin nuevas categorías.
  if (isLeadershipRole(currentUserRole as Role)) {
    return (
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-2xl font-bold text-title">Mis KPIs</h1>
          <p className="text-sm text-secondary mt-0.5">
            {currentUserName} — {ROLE_LABEL[currentUserRole as Role] ?? currentUserRole}
          </p>
        </div>
        <div className="rounded-2xl border border-border bg-surface p-8 text-center">
          <p className="text-sm text-secondary max-w-md mx-auto leading-relaxed">
            Este rol posee funciones principalmente de supervisión y dirección.
            <br />
            Sus indicadores individuales de ejecución no son representativos.
            <br />
            Consulte los KPIs del equipo para evaluar el desempeño de su área.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold text-title">Mis KPIs</h1>
        <p className="text-sm text-secondary mt-0.5">
          {currentUserName} — {ROLE_LABEL[currentUserRole as Role] ?? currentUserRole}
        </p>
      </div>

      {/* Mode toggle */}
      <div className="flex gap-1 bg-black/5 dark:bg-white/5 rounded-xl p-1 w-fit">
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

      {/* ── INDIVIDUAL VIEW ─────────────────────────────────────────────────── */}
      {viewMode === "individual" && (
        <div className="flex flex-col gap-5">
          {/* Month picker + downloads */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 bg-surface border border-border rounded-xl px-4 py-2">
              <label className="text-sm text-secondary whitespace-nowrap">Mes:</label>
              <input
                type="month"
                value={month}
                onChange={(e) => setMonth(e.target.value)}
                className="text-sm border border-border rounded-lg px-3 py-1.5 bg-surface text-main focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            {kpi && !loading && (
              <>
                <Button variant="secondary" onClick={() => downloadKpisExcel(kpi, month, currentUserName, currentUserRole)}>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  Excel
                </Button>
                <Button variant="primary" onClick={() => downloadKpisPDF(kpi, month, currentUserName, currentUserRole, currentUserId)}>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                  </svg>
                  PDF
                </Button>
                <WhatIfSimulator userId={currentUserId} />
              </>
            )}
          </div>

          {error && (
            <div className="bg-danger/[.09] text-danger text-sm rounded-xl px-4 py-3">{error}</div>
          )}

          {loading && (
            <div className="flex justify-center py-32">
              <Spinner className="w-7 h-7 text-primary" />
            </div>
          )}

          {!loading && kpi && (
            <div className="space-y-5">
              <p className="text-sm font-medium text-secondary">
                Período: <span className="text-title">{formatMonthLabel(month)}</span>
              </p>

              {kpi.validationWarnings && kpi.validationWarnings.length > 0 && (
                <div className="rounded-xl border border-warning/30 bg-warning/[.08] px-3.5 py-2.5">
                  <p className="text-xs font-semibold text-warning mb-1">
                    ⚠ Solo visible para Administrador — validación de consistencia detectó {kpi.validationWarnings.length} {kpi.validationWarnings.length === 1 ? "problema" : "problemas"}
                  </p>
                  <ul className="text-[11px] text-secondary space-y-0.5">
                    {kpi.validationWarnings.map((f, i) => (
                      <li key={i}><span className="font-mono text-disabled">{f.rule}</span> — {f.detail}</li>
                    ))}
                  </ul>
                </div>
              )}

              <KpiSectionNav />

              {/* ── 1. Resumen ejecutivo (Hoy/Semana/Mes) ────────────────── */}
              <div id="carga" className="scroll-mt-16">
                <div className="flex items-center gap-1.5 mb-1.5">
                  <span className="text-[11px] text-disabled uppercase tracking-wider font-medium">Carga laboral</span>
                  <MaturityStars
                    level={maturityFromCount(kpi.cargaTiempo.dailyHistory.filter((d) => d.realHours > 0).length)}
                    title={`Madurez del dato: ${kpi.cargaTiempo.dailyHistory.filter((d) => d.realHours > 0).length} días con registro`}
                  />
                </div>
                <WorkloadCard cargaTiempo={kpi.cargaTiempo} />
              </div>

              {/* Score + Donuts */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-surface rounded-2xl border border-border p-5 flex flex-col items-center justify-center gap-2">
                  <p className="text-[11px] text-disabled uppercase tracking-wider font-medium">Score global</p>
                  <div className="relative w-28 h-28 flex items-center justify-center">
                    <svg className="w-28 h-28 -rotate-90" viewBox="0 0 100 100">
                      <circle cx="50" cy="50" r="42" fill="none" stroke="#f1f5f9" strokeWidth="10" />
                      <circle
                        cx="50" cy="50" r="42" fill="none"
                        stroke={kpi.score >= 80 ? "#22c55e" : kpi.score >= 60 ? "#f59e0b" : "#ef4444"}
                        strokeWidth="10"
                        strokeDasharray={`${(kpi.score / 100) * 2 * Math.PI * 42} ${2 * Math.PI * 42}`}
                        strokeLinecap="round"
                      />
                    </svg>
                    <span className="absolute text-3xl font-bold text-title">{kpi.score}</span>
                  </div>
                  <p className="text-xs text-disabled">/ 100 puntos</p>
                  {kpi.prevMonth && (
                    <DeltaBadge
                      current={kpi.score}
                      prev={Math.round(
                        (kpi.prevMonth.completedPct / 100) * 40 +
                        Math.max(0, 20 - Math.max(0, kpi.prevMonth.cargaRatio - 100) * 0.5),
                      )}
                      suffix=" pts"
                    />
                  )}
                </div>

                <div id="cumplimiento" className={`scroll-mt-16 rounded-2xl border p-5 flex flex-col items-center gap-3 ${CARD_BG[kpi.cumplimiento.color]}`}>
                  <div className="w-full flex items-center justify-between self-start">
                    <span className="flex items-center gap-1.5">
                      <p className="text-[11px] text-secondary uppercase tracking-wider font-medium">Cumplimiento</p>
                      <MaturityStars
                        level={maturityFromCount(kpi.cumplimiento.total)}
                        title={`Madurez del dato: ${kpi.cumplimiento.total} tareas en el período`}
                      />
                    </span>
                    <Button variant="tertiary" size="sm" onClick={() => setExplainCumplimientoOpen(true)}>
                      ¿Cómo se obtuvo este resultado?
                    </Button>
                  </div>
                  <DonutChart
                    pct={kpi.cumplimiento.completedPct}
                    color={kpi.cumplimiento.color}
                    label={`${kpi.cumplimiento.completedPct}%`}
                    sublabel={`${kpi.cumplimiento.completedOnTime}/${kpi.cumplimiento.total} a tiempo`}
                  />
                  <div className="w-full space-y-1 text-xs text-main">
                    <div className="flex justify-between">
                      <span>Vencidas</span>
                      <span className={kpi.cumplimiento.overdue > 0 ? "text-danger font-semibold" : "text-disabled"}>
                        {kpi.cumplimiento.overdue}
                        {kpi.cumplimiento.overdue > 0 && kpi.cumplimiento.avgDelayDays > 0
                          ? ` (${kpi.cumplimiento.avgDelayDays}d prom.)`
                          : ""}
                      </span>
                    </div>
                  </div>
                  {kpi.prevMonth && (
                    <DeltaBadge current={kpi.cumplimiento.completedPct} prev={kpi.prevMonth.completedPct} />
                  )}
                </div>

                <div className={`rounded-2xl border p-5 flex flex-col items-center gap-3 ${CARD_BG[kpi.cargaLaboral.color]}`}>
                  <p className="text-[11px] text-secondary uppercase tracking-wider font-medium self-start">Carga laboral</p>
                  <DonutChart
                    pct={Math.min(kpi.cargaLaboral.ratio, 200)}
                    color={kpi.cargaLaboral.color}
                    label={`${kpi.cargaLaboral.ratio}%`}
                    sublabel={`${hoursToDisplay(kpi.cargaLaboral.realHours)}h / ${hoursToDisplay(kpi.cargaLaboral.estimatedHours)}h est.`}
                  />
                  {kpi.prevMonth && (
                    <DeltaBadge current={kpi.cargaLaboral.ratio} prev={kpi.prevMonth.cargaRatio} />
                  )}
                </div>
              </div>

              {/* ── 2. KPIs principales ───────────────────────────────────── */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <TaskBreakdownCard
                  total={kpi.cumplimiento.total}
                  completed={kpi.cumplimiento.completed}
                  inProgress={kpi.cumplimiento.inProgress}
                  pending={kpi.cumplimiento.pending}
                />
                <StatCard label="Completadas" value={kpi.cumplimiento.completed} sub={`${kpi.cumplimiento.completedOnTime} a tiempo (${kpi.cumplimiento.completedPct}%)`} accent />
                <StatCard
                  label="Vencidas"
                  value={kpi.cumplimiento.overdue}
                  sub={kpi.cumplimiento.overdue > 0 ? `Prom. ${kpi.cumplimiento.avgDelayDays}d retraso` : "Sin retrasos"}
                />
                <StatCard label="Consultas SEGUIMIENTO" value={kpi.seguimiento.total} sub={`${kpi.seguimiento.byReason.length} motivos distintos`} />
              </div>

              {/* Motivational message */}
              {(() => {
                const msg = motivationalMessage(kpi.cumplimiento.completedPct, kpi.cumplimiento.total);
                return (
                  <div className={`rounded-2xl border px-5 py-4 flex items-start gap-3 ${msg.bg}`}>
                    <span className="text-2xl leading-none mt-0.5">{msg.icon}</span>
                    <p className="text-sm text-main leading-relaxed">{msg.text}</p>
                  </div>
                );
              })()}

              {/* ── Cumplimiento por prioridad + Insights de Nova ─────────── */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                <PriorityComplianceCard data={kpi.cumplimientoPorPrioridad} />
                <NovaInsightsCard userId={currentUserId} month={month} />
              </div>

              {explainCumplimientoOpen && (
                <ExplainModal
                  title="Cumplimiento"
                  formula={kpi.cumplimiento.explain.formula}
                  steps={kpi.cumplimiento.explain.steps}
                  onClose={() => setExplainCumplimientoOpen(false)}
                />
              )}

              {/* ── 4. Analytics avanzado: Score de Salud, alertas, tendencias, consistencia, anomalías, predicción ── */}
              <AdvancedAnalyticsPanel userId={currentUserId} />

              {/* ── Sprint 6: Decision Intelligence Engine ──────────────────── */}
              <InsightsPanel userId={currentUserId} />

              {/* ── Sprint A: histórico de evolución con selector de período ── */}
              <ScoreHistoryChart userId={currentUserId} kind="performance_score" title="Performance Score" />

              {/* ── 5. Tendencias ─────────────────────────────────────────── */}
              {kpi.cumplimientoHistory.length > 0 && (
                <div className="bg-surface rounded-2xl border border-border p-5">
                  <p className="text-[11px] font-semibold text-main uppercase tracking-wider mb-4">Evolución cumplimiento (6 meses)</p>
                  <HistorySparklineList data={kpi.cumplimientoHistory} />
                  <div className="mt-4 pt-4 border-t border-border">
                    <CumplimientoLineChart data={kpi.cumplimientoHistory} />
                  </div>
                </div>
              )}

              {/* Seguimiento by reason */}
              {kpi.seguimiento.byReason.length > 0 && (
                <div className="bg-surface rounded-2xl border border-border p-5">
                  <h3 className="text-[11px] font-semibold text-main uppercase tracking-wider mb-4">Consultas SEGUIMIENTO por motivo</h3>
                  <div className="space-y-2">
                    {kpi.seguimiento.byReason
                      .sort((a, b) => b.count - a.count)
                      .map((r) => {
                        const maxCount = Math.max(...kpi.seguimiento.byReason.map((x) => x.count));
                        const pct = Math.round((r.count / maxCount) * 100);
                        return (
                          <div key={r.reason} className="flex items-center gap-3">
                            <span className="text-xs text-main w-44 shrink-0 truncate" title={REASON_LABEL[r.reason] ?? r.reason}>
                              {REASON_LABEL[r.reason] ?? r.reason}
                            </span>
                            <div className="flex-1 bg-black/10 dark:bg-white/10 rounded-full h-2">
                              <div className="bg-primary h-2 rounded-full" style={{ width: `${pct}%` }} />
                            </div>
                            <span className="text-xs font-semibold text-main w-6 text-right">{r.count}</span>
                            <span className="text-[11px] text-disabled w-20 text-right">{r.totalMinutes} min total</span>
                          </div>
                        );
                      })}
                  </div>
                </div>
              )}

              {/* Calidad + actividad */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="bg-surface rounded-xl border border-border p-4">
                  <p className="text-[11px] text-disabled uppercase tracking-wider font-medium mb-1">Tareas recurrentes</p>
                  <p className="text-2xl font-bold text-title">{kpi.calidad.recurringPct}%</p>
                  <p className="text-xs text-disabled mt-0.5">{kpi.calidad.recurringCompleted}/{kpi.calidad.recurringTotal} completadas</p>
                </div>
                <div className="bg-surface rounded-xl border border-border p-4">
                  <p className="text-[11px] text-disabled uppercase tracking-wider font-medium mb-1">Asignadas por otros</p>
                  <p className="text-2xl font-bold text-title">{kpi.actividad.assignedByOthers}</p>
                  <p className="text-xs text-disabled mt-0.5">de {kpi.cumplimiento.total} tareas</p>
                </div>
                <div className="bg-surface rounded-xl border border-border p-4">
                  <p className="text-[11px] text-disabled uppercase tracking-wider font-medium mb-1">Comentarios</p>
                  <p className="text-2xl font-bold text-title">{kpi.actividad.totalComments}</p>
                  <p className="text-xs text-disabled mt-0.5">registrados en el período</p>
                </div>
              </div>

              {/* Task table */}
              {kpi.tasks.length > 0 ? (
                <div id="tareas" className="scroll-mt-16 bg-surface rounded-2xl border border-border p-5">
                  <h3 className="text-[11px] font-semibold text-main uppercase tracking-wider mb-4">
                    Mis tareas — {formatMonthLabel(month)}
                  </h3>
                  <div className="-mx-5 px-5">
                    <Table className="min-w-[580px]">
                      <TableHead>
                        <TableRow>
                          {["Tarea", "Tipo", "Estado", "Vence", "Retraso"].map((h) => (
                            <Th key={h}>{h}</Th>
                          ))}
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {kpi.tasks
                          .sort((a, b) => {
                            const o = { red: 0, yellow: 1, green: 2 } as Record<KpiColor, number>;
                            return o[a.color] - o[b.color];
                          })
                          .map((t) => (
                            <TableRow key={t.id}>
                              <Td>
                                <div className="flex items-center gap-2">
                                  <div className={`w-2 h-2 rounded-full shrink-0 ${DOT_CLASS[t.color]}`} />
                                  <span className="text-sm text-title leading-snug">{t.title}</span>
                                </div>
                              </Td>
                              <Td>
                                <span className="text-[11px] bg-surface2 text-secondary px-2 py-0.5 rounded-full">
                                  {TYPE_LABEL[t.type] ?? t.type}
                                </span>
                              </Td>
                              <Td>
                                <StatusChip value={t.status} config={TASK_STATUS_CONFIG} />
                              </Td>
                              <Td className="text-xs text-secondary">
                                {formatDate(t.endDate)}
                              </Td>
                              <Td>
                                {t.delayDays > 0 ? (
                                  <span className="text-xs text-danger font-medium">{t.delayDays}d</span>
                                ) : (
                                  <span className="text-disabled text-xs">—</span>
                                )}
                              </Td>
                            </TableRow>
                          ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-16 text-disabled">
                  <svg className="w-10 h-10 mb-3 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                  </svg>
                  <p className="text-sm">Sin tareas asignadas en este período</p>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── RANGE VIEW ──────────────────────────────────────────────────────── */}
      {viewMode === "range" && (
        <div className="flex flex-col gap-5">
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
                  Calculando...
                </>
              ) : (
                "Generar informe de rango"
              )}
            </Button>
            {rangeReport && !rangeLoading && (
              <div className="flex items-center gap-2 ml-auto">
                <Button variant="secondary" size="sm" onClick={() => downloadRangeExcel(rangeReport, currentUserName, currentUserRole)}>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  Excel
                </Button>
                <Button variant="primary" size="sm" onClick={() => downloadRangePDF(rangeReport, currentUserName, currentUserRole)}>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                  </svg>
                  PDF
                </Button>
              </div>
            )}
          </div>

          {rangeError && (
            <div className="bg-danger/[.09] text-danger text-sm rounded-xl px-4 py-3">{rangeError}</div>
          )}

          {rangeLoading && (
            <div className="flex flex-col items-center justify-center py-24 gap-3 text-disabled">
              <Spinner className="w-8 h-8 text-primary" />
              <p className="text-sm">Calculando KPIs mes a mes...</p>
            </div>
          )}

          {!rangeLoading && !rangeReport && !rangeError && (
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
                        {t.firstMonthCumplimiento}% → {t.lastMonthCumplimiento}%
                        {" "}({t.cumplimientoChange > 0 ? "+" : ""}{t.cumplimientoChange} pp en {rangeReport.months.length} meses)
                      </p>
                    </div>
                  </div>
                );
              })()}

              {/* Summary stats */}
              <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
                <StatCard label="Cumplimiento promedio" value={`${rangeReport.aggregated.avgCumplimiento}%`} sub={`${rangeReport.months.length} meses`} accent />
                <StatCard label="Score promedio" value={`${rangeReport.aggregated.avgScore}/100`} sub="sin considerar comentarios" />
                <StatCard label="Tareas completadas" value={`${rangeReport.aggregated.totalCompletedTasks}`} sub={`de ${rangeReport.aggregated.totalTasks} totales`} />
                <StatCard label="Horas acumuladas" value={`${hoursToDisplay(rangeReport.aggregated.totalRealHours)}h`} sub={`de ${hoursToDisplay(rangeReport.aggregated.totalEstimatedHours)}h de tiempo objetivo`} />
                <StatCard
                  label="Carga laboral (rango)"
                  value={`${hoursToDisplay(rangeReport.aggregated.totalCargaRealHours)}h`}
                  sub={`${rangeReport.aggregated.cargaLabel} · rango óptimo ${hoursToDisplay(rangeReport.aggregated.cargaRangeMin)}-${hoursToDisplay(rangeReport.aggregated.cargaRangeMax)}h`}
                />
                <StatCard label="Consultas SEGUIMIENTO" value={`${rangeReport.aggregated.totalSeguimiento}`} sub="acumuladas en el período" />
                <StatCard label="Meses analizados" value={rangeReport.months.length} sub={`${formatMonthLabel(rangeReport.from)} — ${formatMonthLabel(rangeReport.to)}`} />
              </div>

              {/* Motivational message */}
              {(() => {
                const msg = motivationalMessage(
                  rangeReport.aggregated.avgCumplimiento,
                  rangeReport.aggregated.totalTasks,
                  rangeReport.trends.cumplimientoTrend,
                );
                return (
                  <div className={`rounded-2xl border px-5 py-4 flex items-start gap-3 ${msg.bg}`}>
                    <span className="text-2xl leading-none mt-0.5">{msg.icon}</span>
                    <p className="text-sm text-main leading-relaxed">{msg.text}</p>
                  </div>
                );
              })()}

              {/* Line chart */}
              <div className="bg-surface rounded-2xl border border-border p-5">
                <h3 className="text-[11px] font-semibold text-main uppercase tracking-wider mb-4">
                  Evolución de cumplimiento — {rangeReport.months.length} meses
                </h3>
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={rangeChartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: 11 }}
                      tickFormatter={(v: string) => {
                        const parts = v.split(" ");
                        return parts[0].substring(0, 3) + " " + parts[parts.length - 1].slice(-2);
                      }}
                    />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} unit="%" />
                    <Tooltip formatter={(v) => (v != null ? `${v}%` : "")} />
                    <ReferenceLine y={80} stroke="#22c55e" strokeDasharray="4 2" label={{ value: "80%", fontSize: 10, fill: "#16a34a" }} />
                    <ReferenceLine y={60} stroke="#f59e0b" strokeDasharray="4 2" label={{ value: "60%", fontSize: 10, fill: "#b45309" }} />
                    <Line
                      type="monotone"
                      dataKey="Cumplimiento"
                      stroke="#4f46e5"
                      strokeWidth={2.5}
                      dot={{ r: 4 }}
                      activeDot={{ r: 6 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              {/* Monthly table */}
              <div className="bg-surface rounded-2xl border border-border p-5">
                <h3 className="text-[11px] font-semibold text-main uppercase tracking-wider mb-4">Detalle mensual</h3>
                <div className="-mx-5 px-5">
                  <Table className="min-w-[520px]">
                    <TableHead>
                      <TableRow>
                        {["Mes", "Cumpl.", "Score", "Tareas", "Horas", "Carga", "Consultas"].map((h) => (
                          <Th key={h}>{h}</Th>
                        ))}
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {rangeReport.months.map((m) => (
                        <TableRow key={m.month} className={m.totalTasks > 0 && m.completedPct < 60 ? "bg-danger/[.06]" : ""}>
                          <Td className="font-medium text-title">{m.label}</Td>
                          <Td>
                            <span className="flex items-center gap-1.5">
                              <div className={`w-2 h-2 rounded-full ${m.completedPct >= 80 ? "bg-success" : m.completedPct >= 60 ? "bg-warning" : "bg-danger"}`} />
                              {m.completedPct}%
                            </span>
                          </Td>
                          <Td>{m.score}/100</Td>
                          <Td>{m.completedTasks}/{m.totalTasks}</Td>
                          <Td className="text-xs">{hoursToDisplay(m.realHours)}h/{hoursToDisplay(m.estimatedHours)}h</Td>
                          <Td>
                            <span className="flex items-center gap-1.5 text-xs text-main">
                              <div className={`w-2 h-2 rounded-full shrink-0 ${DOT_CLASS[m.cargaColor]}`} />
                              {m.cargaLabel}
                            </span>
                          </Td>
                          <Td>{m.seguimientoTotal}</Td>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>

              {/* Seguimiento by reason (range) */}
              {rangeReport.aggregated.consultasByReason.length > 0 && (
                <div className="bg-surface rounded-2xl border border-border p-5">
                  <h3 className="text-[11px] font-semibold text-main uppercase tracking-wider mb-4">
                    Consultas SEGUIMIENTO acumuladas por motivo
                  </h3>
                  <div className="space-y-2">
                    {rangeReport.aggregated.consultasByReason.map((r) => {
                      const maxCount = rangeReport.aggregated.consultasByReason[0].count;
                      const pct = Math.round((r.count / maxCount) * 100);
                      return (
                        <div key={r.reason} className="flex items-center gap-3">
                          <span className="text-xs text-main w-44 shrink-0 truncate" title={REASON_LABEL[r.reason] ?? r.reason}>
                            {REASON_LABEL[r.reason] ?? r.reason}
                          </span>
                          <div className="flex-1 bg-black/10 dark:bg-white/10 rounded-full h-2">
                            <div className="bg-primary h-2 rounded-full" style={{ width: `${pct}%` }} />
                          </div>
                          <span className="text-xs font-semibold text-main w-6 text-right">{r.count}</span>
                          <span className="text-[11px] text-disabled w-20 text-right">{r.totalMinutes} min</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
