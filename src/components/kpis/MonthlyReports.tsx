"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ReferenceLine,
} from "recharts";
import type { Role } from "@/generated/prisma/client";
import { ReportWizardModal } from "./reports/ReportWizardModal";
import { Sparkles, BarChart3, FileText, Download } from "lucide-react";
import { formatDate } from "@/lib/utils";
import { hoursToDisplay } from "@/lib/timeFormat";
import { openReportWindow } from "./reportWindow";
import { Button } from "@/components/ui/Button";
import { Table, TableHead, TableBody, TableRow, Th, Td } from "@/components/ui/Table";
import { Spinner } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { useToast } from "@/components/ui/Toast";
import { buildReportPages } from "@/lib/executiveReporting/documentModel";
import { buildExecutiveReportHtml, EXECUTIVE_REPORT_STYLES } from "@/lib/executiveReporting/renderReportHtml";
import { downloadExecutiveReportExcel } from "@/lib/executiveReporting/renderReportExcel";
import type { ExecutiveReportSnapshotData } from "@/lib/executiveReporting/snapshotData";

// ── Executive Reporting Engine 2.0 — MonthlyReports.tsx consume EXCLUSIVAMENTE
// el endpoint unificado (/api/reports/executive + /list + /[reportId]). No
// existe ningún otro camino de datos ni renderer propio: la vista en pantalla
// reutiliza el MISMO render a HTML (buildExecutiveReportHtml) que alimenta el
// PDF, y los paneles complementarios (Tendencias, Evolución del rango,
// Alertas) solo PRESENTAN campos que el snapshot ya trae congelados — nunca
// recalculan nada. ──

type ExecutiveReportListItem = {
  reportId: string;
  type: "MENSUAL" | "RANGO_MESES" | "RANGO_PERSONALIZADO";
  scope: string;
  origin: "GENERATED" | "LEGACY_MIGRATION";
  integrityFlag: "FULL" | "PARTIAL";
  periodLabel: string;
  periodStatus: string;
  collaboratorCount: number;
  generatedBy: string;
  generatedAt: string;
};

function currentMonthParam() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function addMonths(base: string, n: number) {
  let [y, m] = base.split("-").map(Number);
  m += n;
  while (m > 12) { m -= 12; y++; }
  while (m <= 0) { m += 12; y--; }
  return `${y}-${String(m).padStart(2, "0")}`;
}

function colorDot(pct: number) {
  if (pct >= 80) return "bg-success";
  if (pct >= 60) return "bg-warning";
  return "bg-danger";
}

// ── Documento unificado (Portada → ... → Metadatos) embebido en pantalla ────
// Misma fuente de verdad que el PDF/Excel — nunca hay dos renders distintos
// del mismo contenido.

function ExecutiveDocumentView({ snapshot }: { snapshot: ExecutiveReportSnapshotData }) {
  const html = useMemo(() => buildExecutiveReportHtml(buildReportPages(snapshot)), [snapshot]);
  return (
    <div className="bg-surface rounded-2xl border border-border p-5 overflow-x-auto">
      <style dangerouslySetInnerHTML={{ __html: EXECUTIVE_REPORT_STYLES }} />
      <div dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}

// ── Alertas — campo del snapshot que el documento fijo (11 páginas) no
// imprime; se presenta aquí para no perder la señal de gestión.

function AlertsPanel({ alerts, title }: { alerts: ExecutiveReportSnapshotData["alerts"]; title: string }) {
  if (alerts.length === 0) return null;
  return (
    <div className="bg-surface rounded-2xl border border-border p-5">
      <h3 className="text-sm font-semibold text-main uppercase tracking-wider mb-3">{title}</h3>
      <div className="space-y-2">
        {alerts.map((a, i) => (
          <div key={i} className={`flex items-start gap-3 px-4 py-3 rounded-xl border border-transparent ${a.type === "cumplimiento" ? "bg-danger/[.13]" : "bg-warning/[.15]"}`}>
            <span className="text-lg leading-none mt-0.5">⚠️</span>
            <div>
              <p className={`text-sm font-semibold ${a.type === "cumplimiento" ? "text-danger" : "text-warning"}`}>{a.name}</p>
              <p className={`text-xs ${a.type === "cumplimiento" ? "text-danger" : "text-warning"}`}>
                {a.monthsAffected
                  ? a.type === "cumplimiento"
                    ? `Cumplimiento promedio ${a.value}% en ${a.monthsAffected} de los meses analizados`
                    : `Sobrecarga promedio ${a.value}% en ${a.monthsAffected} de los meses analizados`
                  : a.type === "cumplimiento"
                    ? `Cumplimiento crítico: ${a.value}% (umbral mínimo 60%)`
                    : `Sobrecarga laboral: ${a.value}% (umbral máximo 120%)`}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Tendencias (mes anterior/trimestre/semestre) — solo MENSUAL, campo del
// snapshot que el documento fijo no imprime.

function TrendsPanel({ trends }: { trends: NonNullable<ExecutiveReportSnapshotData["trends"]> }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
      {[trends.mesAnterior, trends.trimestre, trends.semestre].map((t) => (
        <div key={t.label} className="bg-surface rounded-xl border border-border p-4">
          <p className="text-[11px] text-disabled uppercase tracking-wider font-medium mb-1">{t.label}</p>
          <p className="text-2xl font-bold text-title">{t.currentValue}%</p>
          <p className="text-xs text-disabled mt-0.5">
            {t.compareValue !== null ? `Referencia: ${t.compareValue}% · ` : ""}
            {t.delta !== null ? `${t.delta >= 0 ? "+" : ""}${t.delta} pp` : "Sin datos suficientes"}
          </p>
        </div>
      ))}
    </div>
  );
}

// ── Evolución mensual del rango (línea + tabla) — solo RANGO_MESES, campos
// del snapshot que el documento fijo no imprime.

const RANGE_LINE_COLORS = [
  "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4",
  "#f97316", "#84cc16", "#ec4899", "#0ea5e9", "#a78bfa",
];

function RangeEvolutionPanel({ snapshot }: { snapshot: ExecutiveReportSnapshotData }) {
  const evolution = snapshot.monthlyEvolution ?? [];
  const trend = snapshot.rangeTrend;
  const memberNames = evolution[0]?.memberSnapshots.map((m) => m.name) ?? [];
  const chartData = evolution.map((ms) => {
    const entry: Record<string, number | string> = { label: ms.label };
    entry["Equipo"] = ms.teamAvgCumplimiento;
    ms.memberSnapshots.forEach((m) => { entry[m.name] = m.completedPct; });
    return entry;
  });

  return (
    <div className="space-y-5">
      {trend && (
        <div className={`rounded-2xl border px-5 py-4 flex items-center gap-4 ${trend.cumplimientoTrend === "mejora" ? "bg-success/[.13] border-transparent" : trend.cumplimientoTrend === "deterioro" ? "bg-danger/[.13] border-transparent" : "bg-background border-border"}`}>
          <span className="text-3xl">{trend.cumplimientoTrend === "mejora" ? "▲" : trend.cumplimientoTrend === "deterioro" ? "▼" : "="}</span>
          <div>
            <p className={`text-lg font-bold ${trend.cumplimientoTrend === "mejora" ? "text-success" : trend.cumplimientoTrend === "deterioro" ? "text-danger" : "text-main"}`}>
              Tendencia: {trend.cumplimientoTrend.toUpperCase()}
            </p>
            <p className={`text-sm ${trend.cumplimientoTrend === "mejora" ? "text-success" : trend.cumplimientoTrend === "deterioro" ? "text-danger" : "text-secondary"}`}>
              Cumplimiento {trend.firstMonthAvgCumplimiento}% → {trend.lastMonthAvgCumplimiento}%
              {" "}({trend.cumplimientoChange > 0 ? "+" : ""}{trend.cumplimientoChange} pp en {evolution.length} meses)
            </p>
          </div>
          {(snapshot.problematicMonths?.length ?? 0) > 0 && (
            <div className="ml-auto text-right">
              <p className="text-xs text-danger font-semibold">Meses críticos (&lt;60%)</p>
              {snapshot.problematicMonths!.map((pm) => (
                <p key={pm.month} className="text-xs text-danger">{pm.label}: {pm.teamAvgCumplimiento}%</p>
              ))}
            </div>
          )}
        </div>
      )}

      {evolution.length > 0 && (
        <>
          <div className="bg-surface rounded-2xl border border-border p-5">
            <h3 className="text-sm font-semibold text-main uppercase tracking-wider mb-4">
              Evolución de Cumplimiento — {evolution.length} meses
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
                  {evolution.map((ms) => (
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
        </>
      )}
    </div>
  );
}

// ── ReportCard (sidebar) ─────────────────────────────────────────────────────

function ReportCard({ report, selected, onClick }: { report: ExecutiveReportListItem; selected: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-4 py-3 rounded-xl transition-all ${
        selected ? "bg-primary-surface ring-2 ring-primary/40" : "hover:bg-black/5 dark:hover:bg-white/5 ring-1 ring-transparent"
      }`}
    >
      <p className={`text-sm font-semibold ${selected ? "text-primary" : "text-title"}`}>{report.periodLabel}</p>
      <p className="text-[11px] text-disabled mt-0.5 flex items-center gap-1.5">
        {formatDate(report.generatedAt)}
        {report.origin === "LEGACY_MIGRATION" && (
          <span className="px-1.5 py-0.5 rounded bg-black/5 dark:bg-white/10 text-[10px] font-medium">Legacy</span>
        )}
      </p>
    </button>
  );
}

// ── Export handlers (compartidos) ────────────────────────────────────────────

function exportPdf(snapshot: ExecutiveReportSnapshotData) {
  const pages = buildReportPages(snapshot);
  openReportWindow({
    title: `Reporte Ejecutivo — ${snapshot.meta.periodLabel}`,
    styles: EXECUTIVE_REPORT_STYLES,
    bodyHtml: buildExecutiveReportHtml(pages),
    pdfFileName: `Reporte_Ejecutivo_${snapshot.meta.reportId}.pdf`,
  });
}

function exportExcel(snapshot: ExecutiveReportSnapshotData) {
  const pages = buildReportPages(snapshot);
  downloadExecutiveReportExcel(pages, `Reporte_Ejecutivo_${snapshot.meta.reportId}.xlsx`);
}

// ── Main component ────────────────────────────────────────────────────────────

type Props = {
  currentUserRole: string;
};

export default function MonthlyReports({ currentUserRole }: Props) {
  const { showToast } = useToast();
  const [viewMode, setViewMode] = useState<"individual" | "range">("individual");
  const [wizardOpen, setWizardOpen] = useState(false);

  const [reportsList, setReportsList] = useState<ExecutiveReportListItem[]>([]);
  const [listLoading, setListLoading] = useState(true);

  // ── Individual month ───────────────────────────────────────────────────────
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const [monthlySnapshot, setMonthlySnapshot] = useState<ExecutiveReportSnapshotData | null>(null);
  const [monthlyDetailLoading, setMonthlyDetailLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generateMonth, setGenerateMonth] = useState(currentMonthParam);

  // ── Range ──────────────────────────────────────────────────────────────────
  const [rangeFrom, setRangeFrom] = useState(() => addMonths(currentMonthParam(), -5));
  const [rangeTo, setRangeTo] = useState(currentMonthParam);
  const [rangeSnapshot, setRangeSnapshot] = useState<ExecutiveReportSnapshotData | null>(null);
  const [rangeLoading, setRangeLoading] = useState(false);

  const fetchList = useCallback(async () => {
    setListLoading(true);
    try {
      const res = await fetch("/api/reports/executive/list?pageSize=50");
      if (res.ok) {
        const body: { reports: ExecutiveReportListItem[] } = await res.json();
        setReportsList(body.reports);
      }
    } finally {
      setListLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const monthlyReports = reportsList.filter((r) => r.type === "MENSUAL");

  const handleSelectReport = useCallback(async (reportId: string) => {
    setSelectedReportId(reportId);
    setMonthlyDetailLoading(true);
    try {
      const res = await fetch(`/api/reports/executive/${reportId}`);
      if (!res.ok) {
        showToast("Error al cargar el informe seleccionado", "error");
        return;
      }
      const body: { report: { data: ExecutiveReportSnapshotData } } = await res.json();
      setMonthlySnapshot(body.report.data);
    } finally {
      setMonthlyDetailLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-selecciona el informe mensual más reciente una sola vez, al cargar la lista.
  useEffect(() => {
    if (selectedReportId || monthlyReports.length === 0) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    handleSelectReport(monthlyReports[0].reportId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportsList]);

  async function handleGenerate() {
    setGenerating(true);
    try {
      const res = await fetch(`/api/reports/executive?tipoReporte=MENSUAL&month=${generateMonth}`, { method: "POST" });
      if (!res.ok) {
        const err: { error?: string } = await res.json().catch(() => ({}));
        showToast(err.error ?? "Error al generar el informe", "error");
        return;
      }
      const body: { reportId: string; snapshot: ExecutiveReportSnapshotData } = await res.json();
      await fetchList();
      setSelectedReportId(body.reportId);
      setMonthlySnapshot(body.snapshot);
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
    setRangeSnapshot(null);
    try {
      const res = await fetch(`/api/reports/executive?tipoReporte=RANGO_MESES&from=${rangeFrom}&to=${rangeTo}`, { method: "POST" });
      if (!res.ok) {
        const err: { error?: string } = await res.json().catch(() => ({}));
        showToast(err.error ?? "Error al generar el informe de rango", "error");
        return;
      }
      const body: { reportId: string; snapshot: ExecutiveReportSnapshotData } = await res.json();
      setRangeSnapshot(body.snapshot);
      await fetchList();
      showToast("Informe generado.", "success");
    } finally {
      setRangeLoading(false);
    }
  }

  if (listLoading) {
    return (
      <div className="flex justify-center items-center py-32">
        <Spinner className="w-7 h-7 text-primary" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Mode toggle + Generador Inteligente */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
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
        <Button variant="secondary" size="sm" onClick={() => setWizardOpen(true)}>
          <Sparkles className="w-4 h-4" strokeWidth={2} />
          Generador Inteligente de Reportes
        </Button>
      </div>

      <ReportWizardModal
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        currentUserRole={currentUserRole as Role}
        referenceMembers={(viewMode === "individual" ? monthlySnapshot : rangeSnapshot)?.members ?? []}
      />

      {/* ── RANGE VIEW ──────────────────────────────────────────────────────── */}
      {viewMode === "range" && (
        <div className="flex flex-col gap-4">
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
            {rangeSnapshot && !rangeLoading && (
              <div className="flex items-center gap-2 ml-auto">
                <Button variant="secondary" size="sm" onClick={() => exportExcel(rangeSnapshot)}>
                  <Download className="w-4 h-4" strokeWidth={2} />
                  Excel
                </Button>
                <Button variant="primary" size="sm" onClick={() => exportPdf(rangeSnapshot)}>
                  <FileText className="w-4 h-4" strokeWidth={2} />
                  PDF
                </Button>
              </div>
            )}
          </div>

          {rangeLoading && (
            <div className="flex flex-col items-center justify-center py-24 gap-3 text-disabled">
              <Spinner className="w-8 h-8 text-primary" />
              <p className="text-sm">Calculando KPIs mes a mes y generando análisis NOVA...</p>
            </div>
          )}

          {!rangeLoading && !rangeSnapshot && (
            <EmptyState icon={BarChart3} title="Selecciona un rango y genera el informe" />
          )}

          {!rangeLoading && rangeSnapshot && (
            <div className="space-y-5">
              <RangeEvolutionPanel snapshot={rangeSnapshot} />
              <AlertsPanel alerts={rangeSnapshot.alerts} title="Alertas Persistentes" />
              <ExecutiveDocumentView snapshot={rangeSnapshot} />
            </div>
          )}
        </div>
      )}

      {/* ── INDIVIDUAL VIEW ──────────────────────────────────────────────────── */}
      {viewMode === "individual" && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <h1 className="text-2xl font-bold text-title">Informes Mensuales</h1>
              <p className="text-sm text-secondary mt-0.5">
                {currentUserRole === "JEFE_NACIONAL" || currentUserRole === "ADMINISTRADOR"
                  ? "Consolidado de todo el equipo"
                  : "Consolidado de tu equipo (excluye Jefe Nacional)"}
              </p>
            </div>

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

          <div className="flex flex-col lg:flex-row gap-5 items-stretch lg:items-start">
            <aside className="w-full lg:w-[220px] shrink-0 bg-surface rounded-2xl border border-border p-3 lg:sticky lg:top-20">
              <p className="text-[11px] font-semibold text-disabled uppercase tracking-wider px-2 mb-2">Informes guardados</p>
              {monthlyReports.length === 0 ? (
                <EmptyState title="No hay informes generados aún" description="Usa el botón para crear el primero." className="py-4" />
              ) : (
                <div className="space-y-1">
                  {monthlyReports.map((r) => (
                    <ReportCard key={r.reportId} report={r} selected={r.reportId === selectedReportId} onClick={() => handleSelectReport(r.reportId)} />
                  ))}
                </div>
              )}
            </aside>

            <div className="flex-1 min-w-0">
              {monthlyDetailLoading && (
                <div className="flex justify-center py-24">
                  <Spinner className="w-7 h-7 text-primary" />
                </div>
              )}

              {!monthlyDetailLoading && !monthlySnapshot && monthlyReports.length === 0 && (
                <EmptyState icon={FileText} title="Aún no hay informes generados" description='Selecciona un mes y haz clic en "Generar / Actualizar"' />
              )}

              {!monthlyDetailLoading && monthlySnapshot && (
                <div className="space-y-5">
                  <div className="bg-surface rounded-2xl border border-border px-5 py-4 flex flex-wrap items-center justify-between gap-4">
                    <div>
                      <h2 className="text-xl font-bold text-title">{monthlySnapshot.meta.periodLabel}</h2>
                      <p className="text-sm text-secondary">
                        Generado por {monthlySnapshot.meta.generatedBy.name} el {formatDate(monthlySnapshot.meta.generatedAt)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <Button variant="secondary" size="sm" onClick={() => exportExcel(monthlySnapshot)}>
                        <Download className="w-4 h-4" strokeWidth={2} />
                        Excel Ejecutivo
                      </Button>
                      <Button variant="primary" size="sm" onClick={() => exportPdf(monthlySnapshot)}>
                        <Sparkles className="w-4 h-4" strokeWidth={2} />
                        PDF Ejecutivo
                      </Button>
                    </div>
                  </div>

                  {monthlySnapshot.trends && <TrendsPanel trends={monthlySnapshot.trends} />}
                  <AlertsPanel alerts={monthlySnapshot.alerts} title="Alertas de Gestión" />
                  <ExecutiveDocumentView snapshot={monthlySnapshot} />
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
