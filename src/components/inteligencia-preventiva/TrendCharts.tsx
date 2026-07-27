"use client";

import { useEffect, useMemo, useState } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { useChartTheme } from "@/components/kpis/KpiCharts";
import { Spinner } from "@/components/ui/Skeleton";
import type { TrendEngineResponse, TrendIndicatorKey } from "./types";

const WINDOW_OPTIONS: Array<{ weeksBack: number; label: string }> = [
  { weeksBack: 3, label: "3 semanas" },
  { weeksBack: 4, label: "4 semanas" },
  { weeksBack: 8, label: "8 semanas" },
  { weeksBack: 13, label: "3 meses" },
  { weeksBack: 26, label: "6 meses" },
  { weeksBack: 52, label: "1 año" },
];

const INDICATOR_OPTIONS: Array<{ key: TrendIndicatorKey; label: string }> = [
  { key: "cumplimiento", label: "Cumplimiento" },
  { key: "productividad", label: "Productividad" },
  { key: "equilibrio_operativo", label: "Equilibrio Operativo" },
  { key: "capacidad_disponible", label: "Capacidad Disponible" },
  { key: "horas_registradas", label: "Horas registradas" },
  { key: "consistencia_operativa", label: "Consistencia Operativa" },
  { key: "proyectos", label: "Proyectos" },
  { key: "actividades", label: "Actividades" },
];

/** Bloque 9 — Tendencias Históricas: ventanas independientes de la configuración global de predicción. */
export default function TrendCharts({ userId }: { userId: string }) {
  const [weeksBack, setWeeksBack] = useState(WINDOW_OPTIONS[0].weeksBack);
  const [indicator, setIndicator] = useState<TrendIndicatorKey>("cumplimiento");
  const [data, setData] = useState<TrendEngineResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const ct = useChartTheme();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/predictive/trend/${userId}?weeksBack=${weeksBack}`);
        const json = res.ok ? await res.json() : null;
        if (!cancelled) setData(json);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, weeksBack]);

  const selected = data?.indicators[indicator];
  const chartData = useMemo(() => selected?.dataPoints.map((p) => ({ label: p.label, value: p.value })) ?? [], [selected]);

  return (
    <div className="rounded-[14px] border border-border bg-surface shadow-[var(--shadow)] p-5">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
        <h3 className="text-sm font-semibold text-main uppercase tracking-wider">Tendencias Históricas</h3>
        <div className="flex gap-2 flex-wrap">
          <select
            value={indicator}
            onChange={(e) => setIndicator(e.target.value as TrendIndicatorKey)}
            className="border border-border rounded-lg px-2 py-1 text-[11px] text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary"
          >
            {INDICATOR_OPTIONS.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
          <div className="flex gap-1 bg-background rounded-lg p-1">
            {WINDOW_OPTIONS.map((o) => (
              <button
                key={o.weeksBack}
                onClick={() => setWeeksBack(o.weeksBack)}
                className={`px-2 py-1 rounded-md text-[11px] font-medium transition-colors ${
                  weeksBack === o.weeksBack ? "bg-surface text-title shadow-sm" : "text-secondary hover:text-title"
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-10">
          <Spinner className="w-5 h-5 text-primary" />
        </div>
      ) : !selected?.available || chartData.length === 0 ? (
        <p className="text-sm text-disabled text-center py-8">{selected?.reason ?? "Sin historial suficiente en este período."}</p>
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={chartData} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={ct.grid} vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: ct.axis }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 11, fill: ct.axisMuted }} axisLine={false} tickLine={false} />
            <Tooltip
              contentStyle={{ borderRadius: 8, border: `1px solid ${ct.tooltipBorder}`, fontSize: 12, background: ct.tooltipBg, color: ct.tooltipText }}
              formatter={(v) => [v, INDICATOR_OPTIONS.find((o) => o.key === indicator)?.label]}
            />
            <Line type="monotone" dataKey="value" stroke={ct.primary} strokeWidth={2.5} dot={{ r: 3, fill: ct.primary, strokeWidth: 0 }} activeDot={{ r: 5, fill: ct.primary }} />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
