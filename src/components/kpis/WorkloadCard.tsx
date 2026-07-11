import type { CargaTiempo, KpiColor, WorkloadMetric } from "./types";
import { hoursToDisplay } from "@/lib/timeFormat";

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
  periodLabel,
}: {
  label: string;
  metric: WorkloadMetric;
  periodLabel: string;
}) {
  return (
    <div className={`rounded-[14px] p-4 ${COLOR_BG[metric.color]}`}>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs font-medium text-secondary">{label}</span>
        <span className={`w-2 h-2 rounded-full shrink-0 ${COLOR_DOT[metric.color]}`} />
      </div>
      <p className={`text-lg font-bold ${COLOR_TEXT[metric.color]}`}>
        {hoursToDisplay(metric.realHours)}h <span className="text-sm font-semibold">— {metric.label}</span>
      </p>
      <p className="text-[11px] text-secondary mt-1">
        {metric.baseHours > 0
          ? `rango óptimo ${hoursToDisplay(metric.rangeMin)}-${hoursToDisplay(metric.rangeMax)}h · ${metric.pct}%`
          : `${metric.pct}%`}
      </p>
      <p className="text-[10px] text-disabled mt-0.5">{periodLabel}</p>
    </div>
  );
}

export default function WorkloadCard({ cargaTiempo }: { cargaTiempo: CargaTiempo }) {
  const { diaria, semanal, mensual, horasEfectivasPorDia, workloadTolerance } = cargaTiempo;

  return (
    <div className="bg-surface rounded-[14px] border border-border shadow-[var(--shadow)] p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[11px] font-semibold text-secondary uppercase tracking-wider">
          Carga laboral (horas reales)
        </h3>
        <span className="text-[10px] text-disabled bg-background border border-border px-2 py-0.5 rounded-full">
          {hoursToDisplay(horasEfectivasPorDia)}h efectivas/día · tolerancia ±{hoursToDisplay(workloadTolerance)}h
        </span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Tile label="Hoy" metric={diaria} periodLabel="hoy" />
        <Tile
          label="Esta semana"
          metric={semanal}
          periodLabel={`semana del ${semanal.weekStartLabel} al ${semanal.weekEndLabel}`}
        />
        <Tile
          label="Este mes"
          metric={mensual}
          periodLabel={`${mensual.monthLabel}, ${mensual.businessDays} ${
            mensual.businessDays === 1 ? "día laborable" : "días laborables"
          }`}
        />
      </div>
    </div>
  );
}
