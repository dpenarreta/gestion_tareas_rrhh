import type { CargaTiempo, KpiColor, WorkloadMetric } from "./types";

const COLOR_DOT: Record<KpiColor, string> = {
  green: "bg-success",
  yellow: "bg-warning",
  red: "bg-danger",
};

const COLOR_TEXT: Record<KpiColor, string> = {
  green: "text-success",
  yellow: "text-warning",
  red: "text-danger",
};

const COLOR_BG: Record<KpiColor, string> = {
  green: "bg-success/[.13]",
  yellow: "bg-warning/[.15]",
  red: "bg-danger/[.13]",
};

function Tile({
  label,
  metric,
  budgetLabel,
}: {
  label: string;
  metric: WorkloadMetric;
  budgetLabel: string;
}) {
  return (
    <div className={`rounded-[14px] p-4 ${COLOR_BG[metric.color]}`}>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs font-medium text-secondary">{label}</span>
        <span className={`w-2 h-2 rounded-full shrink-0 ${COLOR_DOT[metric.color]}`} />
      </div>
      <p className={`text-2xl font-bold ${COLOR_TEXT[metric.color]}`}>{metric.pct}%</p>
      <p className="text-[11px] text-secondary mt-0.5">
        {metric.realHours}h / {budgetLabel}
      </p>
    </div>
  );
}

export default function WorkloadCard({ cargaTiempo }: { cargaTiempo: CargaTiempo }) {
  return (
    <div className="bg-surface rounded-[14px] border border-border shadow-[var(--shadow)] p-5">
      <h3 className="text-[11px] font-semibold text-secondary uppercase tracking-wider mb-3">
        Carga laboral (horas reales)
      </h3>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Tile label="Hoy" metric={cargaTiempo.diaria} budgetLabel="8h" />
        <Tile label="Esta semana" metric={cargaTiempo.semanal} budgetLabel="40h" />
        <Tile label="Este mes" metric={cargaTiempo.mensual} budgetLabel="160h" />
      </div>
    </div>
  );
}
