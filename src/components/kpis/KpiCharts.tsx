"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  LineChart,
  Line,
  ReferenceLine,
  Cell,
} from "recharts";
import type { KpiData, KpiColor } from "./types";

export const REASON_LABEL: Record<string, string> = {
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

const CHART_COLORS = [
  "#6366f1", "#8b5cf6", "#ec4899", "#f59e0b", "#10b981",
  "#3b82f6", "#ef4444", "#84cc16", "#f97316",
];

const DONUT_COLORS: Record<KpiColor, string> = {
  green: "#22c55e",
  yellow: "#f59e0b",
  red: "#ef4444",
};

// ── Donut (SVG) ──────────────────────────────────────────────────────────────

export function DonutChart({
  pct,
  color,
  label,
  sublabel,
}: {
  pct: number;
  color: KpiColor;
  label: string;
  sublabel?: string;
}) {
  const r = 38;
  const circ = 2 * Math.PI * r;
  const dash = Math.min(pct / 100, 1) * circ;
  const stroke = DONUT_COLORS[color];

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative w-28 h-28">
        <svg viewBox="0 0 96 96" className="w-full h-full -rotate-90">
          <circle cx="48" cy="48" r={r} fill="none" stroke="#e2e8f0" strokeWidth="12" />
          <circle
            cx="48"
            cy="48"
            r={r}
            fill="none"
            stroke={stroke}
            strokeWidth="12"
            strokeDasharray={`${dash} ${circ - dash}`}
            strokeLinecap="round"
            style={{ transition: "stroke-dasharray 0.9s ease" }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-0.5">
          <span className="text-xl font-bold text-slate-800">{pct}%</span>
        </div>
      </div>
      <div className="text-center">
        <p className="text-sm font-semibold text-slate-700">{label}</p>
        {sublabel && <p className="text-[11px] text-slate-500 mt-0.5">{sublabel}</p>}
      </div>
    </div>
  );
}

// ── Weekly hours bar chart ───────────────────────────────────────────────────

export function WeeklyHoursChart({ data }: { data: KpiData["horasByWeek"] }) {
  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-40 text-slate-400 text-sm">
        Sin datos de horas para el período
      </div>
    );
  }
  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={data} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
        <XAxis dataKey="week" tick={{ fontSize: 12, fill: "#64748b" }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} unit="h" />
        <Tooltip
          contentStyle={{ borderRadius: 8, border: "1px solid #e2e8f0", fontSize: 12 }}
          formatter={(v) => [`${v}h`]}
        />
        <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
        <Bar dataKey="estimated" name="Estimado" fill="#a5b4fc" radius={[4, 4, 0, 0]} maxBarSize={32} />
        <Bar dataKey="real" name="Real" fill="#6366f1" radius={[4, 4, 0, 0]} maxBarSize={32} />
      </BarChart>
    </ResponsiveContainer>
  );
}

// ── Cumplimiento line chart (6 months) ───────────────────────────────────────

export function CumplimientoLineChart({
  data,
}: {
  data: KpiData["cumplimientoHistory"];
}) {
  return (
    <ResponsiveContainer width="100%" height={180}>
      <LineChart data={data} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} />
        <YAxis
          domain={[0, 100]}
          tick={{ fontSize: 11, fill: "#94a3b8" }}
          axisLine={false}
          tickLine={false}
          unit="%"
        />
        <Tooltip
          contentStyle={{ borderRadius: 8, border: "1px solid #e2e8f0", fontSize: 12 }}
          formatter={(v) => [`${v}%`, "Cumplimiento"]}
        />
        <ReferenceLine y={80} stroke="#22c55e" strokeDasharray="4 4" strokeWidth={1.5} />
        <ReferenceLine y={60} stroke="#f59e0b" strokeDasharray="4 4" strokeWidth={1.5} />
        <Line
          type="monotone"
          dataKey="completedPct"
          name="Cumplimiento"
          stroke="#6366f1"
          strokeWidth={2.5}
          dot={{ r: 4, fill: "#6366f1", strokeWidth: 0 }}
          activeDot={{ r: 6, fill: "#4f46e5" }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

// ── Consultas horizontal bar chart ───────────────────────────────────────────

export function ConsultasBarChart({ data }: { data: KpiData["seguimiento"]["byReason"] }) {
  const chartData = data
    .sort((a, b) => b.count - a.count)
    .map((r) => ({
      name: REASON_LABEL[r.reason] ?? r.reason,
      consultas: r.count,
      minutos: r.totalMinutes,
    }));

  return (
    <ResponsiveContainer width="100%" height={Math.max(180, chartData.length * 38)}>
      <BarChart
        layout="vertical"
        data={chartData}
        margin={{ top: 5, right: 30, left: 8, bottom: 5 }}
      >
        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
        <XAxis
          type="number"
          tick={{ fontSize: 11, fill: "#94a3b8" }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          type="category"
          dataKey="name"
          width={148}
          tick={{ fontSize: 11, fill: "#64748b" }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip
          contentStyle={{ borderRadius: 8, border: "1px solid #e2e8f0", fontSize: 12 }}
          formatter={(v, name) => [
            name === "consultas" ? `${v} consultas` : `${v} min`,
            name === "consultas" ? "Consultas" : "Total minutos",
          ]}
        />
        <Bar dataKey="consultas" radius={[0, 4, 4, 0]} maxBarSize={24}>
          {chartData.map((_, i) => (
            <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
