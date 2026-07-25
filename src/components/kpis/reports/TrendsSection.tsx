// Bloque 9 (Sprint Reportes Ejecutivos 2.0) — comparación automática del
// cumplimiento del equipo vs. mes anterior/trimestre/semestre.
import { TrendingUp, TrendingDown, Minus, CircleDashed } from "lucide-react";
import type { TrendComparison } from "../types";

const DIRECTION_STYLE: Record<TrendComparison["direction"], { icon: typeof TrendingUp; color: string; label: string }> = {
  mejora: { icon: TrendingUp, color: "text-success", label: "Mejora" },
  deterioro: { icon: TrendingDown, color: "text-danger", label: "Deterioro" },
  estable: { icon: Minus, color: "text-disabled", label: "Estable" },
  "sin-datos": { icon: CircleDashed, color: "text-disabled", label: "Sin datos" },
};

function TrendCard({ comparison }: { comparison: TrendComparison }) {
  const style = DIRECTION_STYLE[comparison.direction];
  const Icon = style.icon;
  return (
    <div className="bg-background rounded-xl border border-border p-4">
      <p className="text-[11px] text-disabled uppercase tracking-wider font-medium mb-1">{comparison.label}</p>
      {comparison.compareValue === null ? (
        <p className="text-sm text-disabled italic mt-1">Sin historial suficiente</p>
      ) : (
        <>
          <div className="flex items-baseline gap-2">
            <span className="text-xl font-bold text-title">{comparison.currentValue}%</span>
            <span className="text-xs text-disabled">vs. {comparison.compareValue}%</span>
          </div>
          <p className={`inline-flex items-center gap-1 text-xs font-medium mt-1 ${style.color}`}>
            <Icon className="w-3.5 h-3.5" />
            {style.label} ({comparison.delta! >= 0 ? "+" : ""}{comparison.delta} pp)
          </p>
        </>
      )}
    </div>
  );
}

export function TrendsSection({ mesAnterior, trimestre, semestre }: { mesAnterior: TrendComparison; trimestre: TrendComparison; semestre: TrendComparison }) {
  return (
    <div className="bg-surface rounded-2xl border border-border p-5">
      <h3 className="text-sm font-semibold text-main uppercase tracking-wider mb-1">Tendencias</h3>
      <p className="text-xs text-disabled mb-4">Cumplimiento del equipo comparado automáticamente</p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <TrendCard comparison={mesAnterior} />
        <TrendCard comparison={trimestre} />
        <TrendCard comparison={semestre} />
      </div>
    </div>
  );
}
