"use client";

import { useEffect, useRef } from "react";
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
import type { KpiData, KpiColor, WorkloadColor, CargaDayKind, DailyCargaPoint, WeeklyCargaPoint } from "./types";
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
    orange: dark ? "#fb923c" : "#f97316",
    danger: dark ? "#E15A5A" : "#D14343",
    // Días especiales del gráfico mensual deslizable (permisos/vacaciones/feriado).
    leaveBlue: dark ? "#60a5fa" : "#93c5fd",
    leaveGreen: dark ? "#4ade80" : "#86efac",
    holidayGray: dark ? "#6b7280" : "#94a3b8",
  };
}

function workloadColorHex(color: WorkloadColor, ct: ReturnType<typeof useChartTheme>): string {
  switch (color) {
    case "green": return ct.success;
    case "yellow": return ct.warning;
    case "orange": return ct.orange;
    case "red": return ct.danger;
  }
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
          formatter={(v) => (v == null ? ["Sin datos", "Cumplimiento"] : [`${v}%`, "Cumplimiento"])}
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

// ── Carga laboral: barras diarias (mes en curso, deslizable) ─────────────────

const KIND_LABEL: Record<CargaDayKind, string> = {
  normal: "",
  empty: "Sin registro",
  holiday: "Feriado",
  "leave-medico": "🏥 Permiso médico",
  "leave-personal": "📋 Permiso personal",
  "leave-vacaciones": "🌴 Vacaciones",
  "leave-generic": "📋 Ausencia justificada",
  "weekend-extra": "⚡ Extra (fin de semana)",
};

/** Alto nominal (h) para que días con 0 horas reales (feriado/permiso) o valores muy pequeños se vean como una barra fina. */
const NOMINAL_BAR_HEIGHT = 0.15;

function dayBarValue(p: DailyCargaPoint): number {
  if (p.realHours > 0) return Math.max(p.realHours, NOMINAL_BAR_HEIGHT);
  // "normal"/"empty": día sin ningún registro — altura 0 clara, sin barra fantasma.
  return p.kind === "normal" || p.kind === "empty" ? 0 : NOMINAL_BAR_HEIGHT;
}

/** true si la fecha ISO (YYYY-MM-DD, UTC) cae en sábado o domingo. */
function isWeekendIso(iso: string): boolean {
  const dow = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return dow === 0 || dow === 6;
}

/** Tick del eje X: solo días laborables (lun-vie) muestran etiqueta, rotada 45° para no superponerse. */
function DayAxisTick(props: {
  x?: string | number;
  y?: string | number;
  payload?: { value?: string | number };
  index?: number;
  data: DailyCargaPoint[];
  color: string;
}) {
  const { x, y, payload, index, data, color } = props;
  if (x == null || y == null || index == null || !payload) return null;
  const point = data[index];
  if (!point || isWeekendIso(point.date)) return null;
  return (
    <text
      x={x}
      y={y}
      dy={9}
      textAnchor="end"
      fill={color}
      fontSize={11}
      transform={`rotate(-45 ${x} ${y})`}
    >
      {payload.value}
    </text>
  );
}

function dayFill(p: DailyCargaPoint, ct: ReturnType<typeof useChartTheme>): string {
  switch (p.kind) {
    case "holiday":
      return ct.holidayGray;
    case "leave-medico":
    case "leave-personal":
    case "leave-generic":
      return ct.leaveBlue;
    case "leave-vacaciones":
      return ct.leaveGreen;
    case "weekend-extra":
      return ct.primary;
    case "empty":
      return "transparent";
    default:
      return workloadColorHex(p.color, ct);
  }
}

function CargaTooltip({
  active,
  payload,
  tooltipBg,
  tooltipBorder,
  tooltipText,
}: {
  active?: boolean;
  payload?: Array<{ payload: DailyCargaPoint | WeeklyCargaPoint }>;
  tooltipBg: string;
  tooltipBorder: string;
  tooltipText: string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const p = payload[0].payload;
  const title = "dayLabel" in p ? p.dayLabel : p.weekLabel;
  const kind = "kind" in p ? p.kind : "normal";
  return (
    <div
      style={{
        borderRadius: 8,
        border: `1px solid ${tooltipBorder}`,
        fontSize: 12,
        background: tooltipBg,
        color: tooltipText,
        padding: "8px 10px",
      }}
    >
      <p style={{ fontWeight: 600, marginBottom: 4 }}>{title}</p>
      <p>{hoursToDisplay(p.realHours)}h registradas</p>
      {kind === "normal" ? (
        <p style={{ opacity: 0.75 }}>{p.label}</p>
      ) : (
        <p style={{ opacity: 0.85 }}>{KIND_LABEL[kind]}</p>
      )}
      {p.specialStatusType && <p style={{ marginTop: 2 }}>👶 Jornada especial</p>}
    </div>
  );
}

function LegendDot({ color, label, dashed }: { color: string; label: string; dashed?: boolean }) {
  return (
    <span className="flex items-center gap-1.5">
      <span
        className="w-2.5 h-2.5 rounded-sm shrink-0"
        style={{ background: dashed ? "transparent" : color, border: `1.5px ${dashed ? "dashed" : "solid"} ${color}` }}
      />
      {label}
    </span>
  );
}

const DAY_SLOT_WIDTH = 44;
const MIN_CHART_WIDTH = 320;

/**
 * Gráfico deslizable de días laborables del mes en curso (kpiStartDate o día 1
 * → hoy). Muestra scroll horizontal cuando hay más días de los que caben en el
 * ancho visible, posicionado por defecto en el extremo derecho (días más
 * recientes) — el usuario desliza hacia la izquierda para ver días anteriores.
 */
export function DailyCargaBarChart({
  points,
  baseHours,
  optimalMax,
}: {
  points: DailyCargaPoint[];
  baseHours: number;
  optimalMax: number;
}) {
  const ct = useChartTheme();
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollLeft = scrollRef.current.scrollWidth;
  }, [points.length]);

  if (points.length === 0) {
    return (
      <div className="flex items-center justify-center h-40 text-secondary text-sm">
        Sin días registrados en el período
      </div>
    );
  }

  const chartData = points.map((p) => ({ ...p, barValue: dayBarValue(p) }));
  const chartWidth = Math.max(points.length * DAY_SLOT_WIDTH, MIN_CHART_WIDTH);
  const hasSpecialKinds = points.some((p) => p.kind !== "normal" && p.kind !== "empty");

  return (
    <div>
      <div ref={scrollRef} className="overflow-x-auto">
        <BarChart width={chartWidth} height={220} data={chartData} margin={{ top: 5, right: 10, left: -10, bottom: 25 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={ct.grid} vertical={false} />
          <XAxis
            dataKey="dayLabel"
            tick={(props: { x?: string | number; y?: string | number; payload?: { value?: string | number }; index?: number }) => (
              <DayAxisTick {...props} data={chartData} color={ct.axis} />
            )}
            axisLine={false}
            tickLine={false}
            interval={0}
            height={40}
          />
          <YAxis
            tick={{ fontSize: 11, fill: ct.axisMuted }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v: number) => `${hoursToDisplay(v)}h`}
            domain={[0, (dataMax: number) => Math.ceil(Math.max(dataMax, optimalMax) * 1.15)]}
          />
          <Tooltip
            content={<CargaTooltip tooltipBg={ct.tooltipBg} tooltipBorder={ct.tooltipBorder} tooltipText={ct.tooltipText} />}
          />
          {baseHours > 0 && (
            <ReferenceLine
              y={baseHours}
              stroke={ct.axis}
              strokeDasharray="4 4"
              strokeWidth={1.5}
              label={{ value: `Base ${hoursToDisplay(baseHours)}h`, position: "insideBottomLeft", fontSize: 10, fill: ct.axis }}
            />
          )}
          {optimalMax > 0 && (
            <ReferenceLine
              y={optimalMax}
              stroke={ct.success}
              strokeDasharray="4 4"
              strokeWidth={1.5}
              label={{ value: `Límite óptimo ${hoursToDisplay(optimalMax)}h`, position: "insideTopRight", fontSize: 10, fill: ct.success }}
            />
          )}
          <Bar dataKey="barValue" radius={[4, 4, 0, 0]} maxBarSize={26}>
            {chartData.map((p, i) => (
              <Cell
                key={i}
                fill={dayFill(p, ct)}
                stroke={p.kind === "weekend-extra" ? ct.primary : p.kind === "empty" ? ct.grid : "none"}
                strokeDasharray={p.kind === "weekend-extra" || p.kind === "empty" ? "3 2" : undefined}
                strokeWidth={p.kind === "weekend-extra" || p.kind === "empty" ? 1.5 : 0}
              />
            ))}
          </Bar>
        </BarChart>
      </div>
      {hasSpecialKinds && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-[10px] text-secondary">
          <LegendDot color={ct.holidayGray} label="Feriado" />
          <LegendDot color={ct.leaveBlue} label="🏥/📋 Permiso" />
          <LegendDot color={ct.leaveGreen} label="🌴 Vacaciones" />
          <LegendDot color={ct.primary} dashed label="⚡ Extra fin de semana" />
        </div>
      )}
    </div>
  );
}

// ── Carga laboral: línea semanal (semanas del mes en curso) ──────────────────

export function WeeklyCargaLineChart({
  points,
  optimalMax,
}: {
  points: WeeklyCargaPoint[];
  optimalMax?: number;
}) {
  const ct = useChartTheme();
  if (points.length === 0) {
    return (
      <div className="flex items-center justify-center h-40 text-secondary text-sm">
        Sin semanas registradas en el período
      </div>
    );
  }
  return (
    <ResponsiveContainer width="100%" height={200}>
      <LineChart data={points} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={ct.grid} vertical={false} />
        <XAxis dataKey="weekLabel" tick={{ fontSize: 11, fill: ct.axis }} axisLine={false} tickLine={false} />
        <YAxis
          tick={{ fontSize: 11, fill: ct.axisMuted }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v: number) => `${hoursToDisplay(v)}h`}
          domain={[0, (dataMax: number) => Math.ceil(Math.max(dataMax, optimalMax ?? 0) * 1.15)]}
        />
        <Tooltip
          content={<CargaTooltip tooltipBg={ct.tooltipBg} tooltipBorder={ct.tooltipBorder} tooltipText={ct.tooltipText} />}
        />
        {optimalMax && optimalMax > 0 && (
          <ReferenceLine
            y={optimalMax}
            stroke={ct.success}
            strokeDasharray="4 4"
            strokeWidth={1.5}
            label={{ value: `Límite óptimo ${hoursToDisplay(optimalMax)}h`, position: "insideTopLeft", fontSize: 10, fill: ct.success }}
          />
        )}
        <Line
          type="monotone"
          dataKey="realHours"
          stroke={ct.primary}
          strokeWidth={2.5}
          dot={(props: { cx?: number; cy?: number; payload?: WeeklyCargaPoint; index?: number }) => {
            const { cx, cy, payload, index } = props;
            if (cx == null || cy == null || !payload) return <g key={index} />;
            return <circle key={index} cx={cx} cy={cy} r={5} fill={workloadColorHex(payload.color, ct)} stroke={ct.tooltipBg} strokeWidth={1.5} />;
          }}
          activeDot={{ r: 7 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

// ── Carga laboral del equipo: barras agrupadas por persona (real vs base) ────

const TEAM_SLOT_WIDTH = 68;
const TEAM_MIN_CHART_WIDTH = 320;

function TeamWorkloadTooltip({
  active,
  payload,
  tooltipBg,
  tooltipBorder,
  tooltipText,
}: {
  active?: boolean;
  payload?: Array<{ payload: { name: string; realHours: number; baseHours: number; color: WorkloadColor } }>;
  tooltipBg: string;
  tooltipBorder: string;
  tooltipText: string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const p = payload[0].payload;
  return (
    <div
      style={{
        borderRadius: 8,
        border: `1px solid ${tooltipBorder}`,
        fontSize: 12,
        background: tooltipBg,
        color: tooltipText,
        padding: "8px 10px",
      }}
    >
      <p style={{ fontWeight: 600, marginBottom: 4 }}>{p.name}</p>
      <p>{hoursToDisplay(p.realHours)}h reales</p>
      <p style={{ opacity: 0.75 }}>Base esperada: {hoursToDisplay(p.baseHours)}h</p>
    </div>
  );
}

/** Gráfico de carga laboral del equipo: horas reales (coloreadas por semáforo) vs base esperada, por persona. Deslizable si hay muchas personas. */
export function TeamWorkloadBarChart({
  data,
}: {
  data: Array<{ id: string; name: string; realHours: number; baseHours: number; color: WorkloadColor }>;
}) {
  const ct = useChartTheme();
  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-40 text-secondary text-sm">
        Sin colaboradores para mostrar
      </div>
    );
  }
  const chartWidth = Math.max(data.length * TEAM_SLOT_WIDTH, TEAM_MIN_CHART_WIDTH);
  return (
    <div className="overflow-x-auto">
      <BarChart width={chartWidth} height={260} data={data} margin={{ top: 5, right: 10, left: -10, bottom: 40 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={ct.grid} vertical={false} />
        <XAxis
          dataKey="name"
          tick={{ fontSize: 10, fill: ct.axis }}
          axisLine={false}
          tickLine={false}
          interval={0}
          angle={-35}
          textAnchor="end"
          height={60}
        />
        <YAxis
          tick={{ fontSize: 11, fill: ct.axisMuted }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v: number) => `${hoursToDisplay(v)}h`}
        />
        <Tooltip
          content={<TeamWorkloadTooltip tooltipBg={ct.tooltipBg} tooltipBorder={ct.tooltipBorder} tooltipText={ct.tooltipText} />}
        />
        <Legend wrapperStyle={{ fontSize: 12, paddingTop: 4, color: ct.axis }} />
        <Bar dataKey="baseHours" name="Base esperada" fill={ct.track} radius={[4, 4, 0, 0]} maxBarSize={20} />
        <Bar dataKey="realHours" name="Horas reales" radius={[4, 4, 0, 0]} maxBarSize={20}>
          {data.map((d, i) => (
            <Cell key={i} fill={workloadColorHex(d.color, ct)} />
          ))}
        </Bar>
      </BarChart>
    </div>
  );
}
