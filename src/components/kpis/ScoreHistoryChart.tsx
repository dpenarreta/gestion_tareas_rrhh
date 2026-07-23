"use client";

import { useState, useEffect } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { useChartTheme } from "./KpiCharts";

type ScoreSeriesPoint = { date: string; score: number };
type AuditKind = "performance_score" | "operational_risk" | "health_score";

const PERIOD_OPTIONS: Array<{ months: 1 | 3 | 6 | 12; label: string }> = [
  { months: 1, label: "Último mes" },
  { months: 3, label: "Últimos 3 meses" },
  { months: 6, label: "Últimos 6 meses" },
  { months: 12, label: "Último año" },
];

/**
 * Sprint A §7 — histórico de evolución con selector de período, sobre
 * `GET /api/analytics/history/[userId]` (lectura pura de `AnalyticsAuditLog`,
 * nunca recalcula un score). Un punto por corrida del motor — no se agrega ni
 * interpola nada.
 */
export default function ScoreHistoryChart({ userId, kind, title }: { userId: string; kind: AuditKind; title: string }) {
  const [months, setMonths] = useState<1 | 3 | 6 | 12>(3);
  const [points, setPoints] = useState<ScoreSeriesPoint[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const ct = useChartTheme();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(false);
      try {
        const res = await fetch(`/api/analytics/history/${userId}?kind=${kind}&months=${months}`);
        if (!res.ok) throw new Error("failed");
        const json: { points: ScoreSeriesPoint[] } = await res.json();
        if (!cancelled) setPoints(json.points);
      } catch {
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, kind, months]);

  const chartData = (points ?? []).map((p) => ({
    label: new Date(p.date).toLocaleDateString("es-CL", { day: "2-digit", month: "2-digit" }),
    score: p.score,
  }));

  return (
    <div className="rounded-[14px] border border-border bg-surface shadow-[var(--shadow)] p-5">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <h3 className="text-sm font-semibold text-main uppercase tracking-wider">{title} — evolución</h3>
        <div className="flex gap-1 bg-background rounded-lg p-1">
          {PERIOD_OPTIONS.map((o) => (
            <button
              key={o.months}
              onClick={() => setMonths(o.months)}
              className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${
                months === o.months ? "bg-surface text-title shadow-sm" : "text-secondary hover:text-title"
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-10">
          <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      ) : error ? (
        <p className="text-sm text-disabled text-center py-8">No se pudo cargar el histórico.</p>
      ) : chartData.length === 0 ? (
        <p className="text-sm text-disabled text-center py-8">Sin historial suficiente en este período.</p>
      ) : (
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={chartData} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={ct.grid} vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: ct.axis }} axisLine={false} tickLine={false} />
            <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: ct.axisMuted }} axisLine={false} tickLine={false} />
            <Tooltip
              contentStyle={{ borderRadius: 8, border: `1px solid ${ct.tooltipBorder}`, fontSize: 12, background: ct.tooltipBg, color: ct.tooltipText }}
              formatter={(v) => [`${v} pts`, title]}
            />
            <Line type="monotone" dataKey="score" name={title} stroke={ct.primary} strokeWidth={2.5} dot={{ r: 3, fill: ct.primary, strokeWidth: 0 }} activeDot={{ r: 5, fill: ct.primary }} />
          </LineChart>
        </ResponsiveContainer>
      )}
      <p className="text-[10px] text-disabled mt-2">Un punto por cada cálculo registrado — no se interpola ni se recalcula historial.</p>
    </div>
  );
}
