// Bloque 8 (Sprint Reportes Ejecutivos 2.0) — Mapa de Riesgo: Cumplimiento
// (eje X) vs. Carga laboral (eje Y), un punto por colaborador. Cuadrantes
// ya clasificados server-side por computeRiskQuadrant (src/lib/reportInsights.ts)
// — este componente solo dibuja.
"use client";

import {
  ScatterChart, Scatter, XAxis, YAxis, ZAxis, CartesianGrid, Tooltip,
  ReferenceLine, ResponsiveContainer, Cell,
} from "recharts";
import type { RiskQuadrant } from "../types";

const QUADRANT_COLOR: Record<RiskQuadrant, string> = {
  criticos: "#ef4444",
  "atencion-carga": "#f59e0b",
  "atencion-cumplimiento": "#f59e0b",
  saludables: "#10b981",
};

const QUADRANT_LABEL: Record<RiskQuadrant, string> = {
  criticos: "Crítico",
  "atencion-carga": "Atención (carga)",
  "atencion-cumplimiento": "Atención (cumplimiento)",
  saludables: "Saludable",
};

type Point = { id: string; name: string; completedPct: number; cargaPct: number; quadrant: RiskQuadrant };

function CustomTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: Point }> }) {
  if (!active || !payload || payload.length === 0) return null;
  const p = payload[0].payload;
  return (
    <div className="bg-surface border border-border rounded-lg px-3 py-2 shadow-lg text-xs">
      <p className="font-semibold text-title">{p.name}</p>
      <p className="text-secondary">Cumplimiento: {p.completedPct}%</p>
      <p className="text-secondary">Carga: {p.cargaPct}%</p>
      <p className="mt-0.5" style={{ color: QUADRANT_COLOR[p.quadrant] }}>{QUADRANT_LABEL[p.quadrant]}</p>
    </div>
  );
}

export function RiskMatrixChart({ points }: { points: Point[] }) {
  if (points.length === 0) return null;
  return (
    <div className="bg-surface rounded-2xl border border-border p-5">
      <h3 className="text-sm font-semibold text-main uppercase tracking-wider mb-1">Mapa de Riesgo</h3>
      <p className="text-xs text-disabled mb-4">Cumplimiento vs. Carga laboral — cada punto es un colaborador</p>
      <ResponsiveContainer width="100%" height={320}>
        <ScatterChart margin={{ top: 10, right: 20, bottom: 10, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis type="number" dataKey="completedPct" name="Cumplimiento" unit="%" domain={[0, 100]} tick={{ fontSize: 11 }} />
          <YAxis type="number" dataKey="cargaPct" name="Carga" unit="%" tick={{ fontSize: 11 }} />
          <ZAxis range={[80, 80]} />
          <ReferenceLine x={60} stroke="var(--border)" strokeDasharray="4 4" />
          <ReferenceLine y={100} stroke="var(--border)" strokeDasharray="4 4" />
          <Tooltip content={<CustomTooltip />} />
          <Scatter data={points}>
            {points.map((p) => (
              <Cell key={p.id} fill={QUADRANT_COLOR[p.quadrant]} />
            ))}
          </Scatter>
        </ScatterChart>
      </ResponsiveContainer>
      <div className="flex flex-wrap gap-3 mt-3">
        {(Object.keys(QUADRANT_LABEL) as RiskQuadrant[])
          .filter((q, i, arr) => arr.findIndex((x) => QUADRANT_LABEL[x] === QUADRANT_LABEL[q]) === i)
          .map((q) => (
            <span key={q} className="inline-flex items-center gap-1.5 text-[11px] text-secondary">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: QUADRANT_COLOR[q] }} />
              {QUADRANT_LABEL[q]}
            </span>
          ))}
      </div>
    </div>
  );
}
