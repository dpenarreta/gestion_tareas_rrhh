"use client";

import { useTheme } from "next-themes";
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
import { hoursToDisplay } from "@/lib/timeFormat";

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
  SEGUIMIENTO_DOCUMENTACION: "Seguimiento de documentación",
  SOLICITUDES_INTERNAS: "Solicitudes internas",
};

// Recharts palette (Parte 2 del sistema de diseño): morado, azul, verde, amarillo, naranja
const CHART_COLORS = ["#6366f1", "#3b82f6", "#34d399", "#fbbf24", "#f59e0b"];

function useChartTheme() {
  const { resolvedTheme } = useTheme();
  const dark = resolvedTheme === "dark";
  return {
    dark,
    grid: dark ? "#2d3748" : "#f1f5f9",
    axis: dark ? "#9ca3af" : "#64748b",
    axisMuted: dark ? "#6b7280" : "#94a3b8",
    tooltipBg: dark ? "#1e293b" : "#ffffff",
    tooltipBorder: dark ? "#2d3748" : "#e2e8f0",
    tooltipText: dark ? "#f9fafb" : "#111827",
    track: dark ? "#2d3748" : "#e2e8f0",
    primary: dark ? "#6E72F2" : "#5155E5",
    success: dark ? "#37B884" : "#1E9E68",
    warning: dark ? "#E2A93B" : "#B27B10",
    danger: dark ? "#E15A5A" : "#D14343",
  };
}

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
  const ct = useChartTheme();
  const r = 38;
  const circ = 2 * Math.PI * r;
  const dash = Math.min(pct / 100, 1) * circ;
  const stroke = color === "green" ? ct.success : color === "yellow" ? ct.warning : ct.danger;

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative w-28 h-28">
        <svg viewBox="0 0 96 96" className="w-full h-full -rotate-90">
          <circle cx="48" cy="48" r={r} fill="none" stroke={ct.track} strokeWidth="12" />
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
          <span className="text-xl font-bold text-title">{pct}%</span>
        </div>
      </div>
      <div className="text-center">
        <p className="text-sm font-semibold text-main">{label}</p>
        {sublabel && <p className="text-[11px] text-secondary mt-0.5">{sublabel}</p>}
      </div>
    </div>
  );
}

// ── Weekly hours bar chart ───────────────────────────────────────────────────

export function WeeklyHoursChart({ data }: { data: KpiData["horasByWeek"] }) {
  const ct = useChartTheme();
  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-40 text-secondary text-sm">
        Sin datos de horas para el período
      </div>
    );
  }
  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={data} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={ct.grid} vertical={false} />
        <XAxis dataKey="week" tick={{ fontSize: 12, fill: ct.axis }} axisLine={false} tickLine={false} />
        <YAxis
          tick={{ fontSize: 11, fill: ct.axisMuted }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v: number) => `${hoursToDisplay(v)}h`}
        />
        <Tooltip
          contentStyle={{ borderRadius: 8, border: `1px solid ${ct.tooltipBorder}`, fontSize: 12, background: ct.tooltipBg, color: ct.tooltipText }}
          formatter={(v) => [`${hoursToDisplay(Number(v))}h`]}
        />
        <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8, color: ct.axis }} />
        <Bar dataKey="estimated" name="Estimado" fill={ct.track} radius={[4, 4, 0, 0]} maxBarSize={32} />
        <Bar dataKey="real" name="Real" fill={ct.primary} radius={[4, 4, 0, 0]} maxBarSize={32} />
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
  const ct = useChartTheme();
  return (
    <ResponsiveContainer width="100%" height={180}>
      <LineChart data={data} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={ct.grid} vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 11, fill: ct.axis }} axisLine={false} tickLine={false} />
        <YAxis
          domain={[0, 100]}
          tick={{ fontSize: 11, fill: ct.axisMuted }}
          axisLine={false}
          tickLine={false}
          unit="%"
        />
        <Tooltip
          contentStyle={{ borderRadius: 8, border: `1px solid ${ct.tooltipBorder}`, fontSize: 12, background: ct.tooltipBg, color: ct.tooltipText }}
          formatter={(v) => [`${v}%`, "Cumplimiento"]}
        />
        <ReferenceLine y={80} stroke={ct.success} strokeDasharray="4 4" strokeWidth={1.5} />
        <ReferenceLine y={60} stroke={ct.warning} strokeDasharray="4 4" strokeWidth={1.5} />
        <Line
          type="monotone"
          dataKey="completedPct"
          name="Cumplimiento"
          stroke={ct.primary}
          strokeWidth={2.5}
          dot={{ r: 4, fill: ct.primary, strokeWidth: 0 }}
          activeDot={{ r: 6, fill: ct.primary }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

// ── Consultas horizontal bar chart ───────────────────────────────────────────

export function ConsultasBarChart({ data }: { data: KpiData["seguimiento"]["byReason"] }) {
  const ct = useChartTheme();
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
        <CartesianGrid strokeDasharray="3 3" stroke={ct.grid} horizontal={false} />
        <XAxis
          type="number"
          tick={{ fontSize: 11, fill: ct.axisMuted }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          type="category"
          dataKey="name"
          width={148}
          tick={{ fontSize: 11, fill: ct.axis }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip
          contentStyle={{ borderRadius: 8, border: `1px solid ${ct.tooltipBorder}`, fontSize: 12, background: ct.tooltipBg, color: ct.tooltipText }}
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
