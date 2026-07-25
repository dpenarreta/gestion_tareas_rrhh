// Bloque 1 (Sprint Reportes Ejecutivos 2.0) — primera "página" del informe:
// score + estado del equipo, variación, riesgos críticos, alertas,
// destacados y en riesgo, todo resumido en una sola pantalla.
import { TrendingUp, TrendingDown, Minus, AlertTriangle, Award, ShieldAlert } from "lucide-react";
import type { IndiceEjecutivoData, RiskQuadrant } from "../types";

const NIVEL_RING: Record<string, string> = {
  green: "ring-success/25",
  yellow: "ring-warning/25",
  red: "ring-danger/25",
};
const NIVEL_TEXT: Record<string, string> = {
  green: "text-success",
  yellow: "text-warning",
  red: "text-danger",
};

function VariationBadge({ variacion }: { variacion: number | null }) {
  if (variacion === null) {
    return <span className="text-xs text-disabled italic">Sin comparación disponible</span>;
  }
  if (variacion === 0) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-disabled">
        <Minus className="w-3.5 h-3.5" /> Sin variación vs. mes anterior
      </span>
    );
  }
  const positive = variacion > 0;
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium ${positive ? "text-success" : "text-danger"}`}>
      {positive ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
      {positive ? "+" : ""}{variacion} pts vs. mes anterior
    </span>
  );
}

export function ExecutiveSummarySection({
  indiceEjecutivo,
  riskQuadrant,
  alerts,
  ranking,
}: {
  indiceEjecutivo: IndiceEjecutivoData;
  riskQuadrant?: Array<{ id: string; name: string; quadrant: RiskQuadrant }>;
  alerts: Array<{ name: string; type: "cumplimiento" | "sobrecarga"; value: number }>;
  ranking: Array<{ id: string; name: string; score: number; completedPct: number }>;
}) {
  const criticos = (riskQuadrant ?? []).filter((r) => r.quadrant === "criticos");
  const destacados = [...ranking].sort((a, b) => b.score - a.score).slice(0, 3);
  const enRiesgo = [...ranking].sort((a, b) => a.completedPct - b.completedPct).slice(0, 3).filter((m) => m.completedPct < 70);

  return (
    <div className="bg-surface rounded-2xl border border-border p-5">
      <h3 className="text-sm font-semibold text-main uppercase tracking-wider mb-4">Resumen Ejecutivo</h3>

      <div className="flex flex-wrap items-start gap-6">
        {/* Score + estado */}
        <div className="flex items-center gap-4 shrink-0">
          {indiceEjecutivo ? (
            <>
              <div className={`w-20 h-20 rounded-full ring-4 ${NIVEL_RING[indiceEjecutivo.color]} bg-background flex flex-col items-center justify-center`}>
                <span className="text-2xl font-extrabold text-title leading-none">{indiceEjecutivo.valor}</span>
                <span className="text-[10px] text-disabled leading-none mt-0.5">/100</span>
              </div>
              <div>
                <p className={`text-lg font-bold ${NIVEL_TEXT[indiceEjecutivo.color]}`}>{indiceEjecutivo.nivel}</p>
                <VariationBadge variacion={indiceEjecutivo.variacion} />
                <p className="text-xs text-secondary mt-1 max-w-sm">{indiceEjecutivo.explicacion}</p>
              </div>
            </>
          ) : (
            <div className="text-sm text-disabled italic max-w-md">
              El Índice Ejecutivo del Equipo solo está disponible al generar el informe del mes calendario en curso — Capacidad Futura (parte de Equilibrio Operativo) es una proyección hacia adelante, no aplicable a un mes pasado.
            </div>
          )}
        </div>

        <div className="flex-1 min-w-[260px] grid grid-cols-1 sm:grid-cols-2 gap-3">
          {/* Riesgos críticos */}
          <div className="flex items-start gap-2">
            <ShieldAlert className="w-4 h-4 text-danger shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-semibold text-title">{criticos.length} riesgo(s) crítico(s)</p>
              <p className="text-[11px] text-disabled">{criticos.length > 0 ? criticos.map((c) => c.name).join(", ") : "Ningún colaborador en el cuadrante crítico"}</p>
            </div>
          </div>
          {/* Alertas */}
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-warning shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-semibold text-title">{alerts.length} alerta(s) de gestión</p>
              <p className="text-[11px] text-disabled">{alerts.length > 0 ? alerts.map((a) => a.name).join(", ") : "Ninguna alerta activa"}</p>
            </div>
          </div>
          {/* Destacados */}
          <div className="flex items-start gap-2">
            <Award className="w-4 h-4 text-success shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-semibold text-title">Personas destacadas</p>
              <p className="text-[11px] text-disabled">{destacados.length > 0 ? destacados.map((m) => m.name).join(", ") : "Sin datos suficientes"}</p>
            </div>
          </div>
          {/* En riesgo */}
          <div className="flex items-start gap-2">
            <TrendingDown className="w-4 h-4 text-danger shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-semibold text-title">Personas en riesgo</p>
              <p className="text-[11px] text-disabled">{enRiesgo.length > 0 ? enRiesgo.map((m) => m.name).join(", ") : "Nadie por debajo del umbral"}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
