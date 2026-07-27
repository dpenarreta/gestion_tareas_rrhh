import type { TrendDirection, Nivel, PreventiveSeverity, HistoricalReliability } from "./types";

const DIRECTION_STYLE: Record<TrendDirection, { label: string; className: string; icon: string }> = {
  positiva: { label: "Positiva", className: "bg-success/[.13] text-success", icon: "↑" },
  negativa: { label: "Negativa", className: "bg-danger/[.13] text-danger", icon: "↓" },
  estable: { label: "Estable", className: "bg-surface2 text-secondary", icon: "→" },
  variable: { label: "Variable", className: "bg-warning/[.15] text-warning", icon: "≈" },
  cambio_brusco: { label: "Cambio brusco", className: "bg-orange-500/[.15] text-orange-600 dark:text-orange-400", icon: "!" },
};

export function DirectionBadge({ direction }: { direction: TrendDirection }) {
  const s = DIRECTION_STYLE[direction];
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full ${s.className}`}>
      <span aria-hidden>{s.icon}</span>
      {s.label}
    </span>
  );
}

const NIVEL_STYLE: Record<Nivel, string> = {
  Alto: "bg-danger/[.13] text-danger",
  Medio: "bg-warning/[.15] text-warning",
  Bajo: "bg-success/[.13] text-success",
};

export function NivelBadge({ nivel }: { nivel: Nivel }) {
  return <span className={`text-[11px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full ${NIVEL_STYLE[nivel]}`}>{nivel}</span>;
}

const SEVERITY_STYLE: Record<PreventiveSeverity, { emoji: string; label: string; className: string }> = {
  roja: { emoji: "🔴", label: "Acción inmediata", className: "bg-danger/[.09] border-danger/30" },
  naranja: { emoji: "🟠", label: "Atención", className: "bg-orange-500/[.09] border-orange-500/30" },
  amarilla: { emoji: "🟡", label: "Seguimiento", className: "bg-warning/[.09] border-warning/30" },
  verde: { emoji: "🟢", label: "Sin riesgo", className: "bg-success/[.09] border-success/30" },
};

export function severityMeta(severity: PreventiveSeverity) {
  return SEVERITY_STYLE[severity];
}

const RELIABILITY_LABEL: Record<HistoricalReliability, string> = { alta: "Alta", media: "Media", baja: "Baja" };

export function ReliabilityBadge({ reliability }: { reliability: HistoricalReliability }) {
  return (
    <span className="text-[10px] font-semibold uppercase tracking-wide text-disabled" title="Confiabilidad del histórico — distinta del nivel de confianza">
      Confiabilidad: {RELIABILITY_LABEL[reliability]}
    </span>
  );
}

export function ExplainBlock({ prediction }: { prediction: { porQue: string; datosUtilizados: string[]; variablesConMayorImpacto: string[]; queHacer: string[] } }) {
  return (
    <div className="mt-2 space-y-1.5 text-xs text-secondary">
      <p>{prediction.porQue}</p>
      {prediction.variablesConMayorImpacto.length > 0 && (
        <p>
          <span className="font-semibold text-main">Variables con mayor impacto: </span>
          {prediction.variablesConMayorImpacto.join(", ")}
        </p>
      )}
      {prediction.queHacer.length > 0 && (
        <ul className="list-disc list-inside space-y-0.5">
          {prediction.queHacer.map((a, i) => (
            <li key={i}>{a}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
