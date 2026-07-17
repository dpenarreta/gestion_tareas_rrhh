import type { CargaTiempo, WorkloadColor, WorkloadMetric } from "./types";
import { hoursToDisplay } from "@/lib/timeFormat";
import { DailyCargaBarChart, WeeklyCargaLineChart } from "./KpiCharts";

export const WORKLOAD_COLOR_DOT: Record<WorkloadColor, string> = {
  green: "bg-success",
  yellow: "bg-warning",
  orange: "bg-orange-500",
  red: "bg-danger",
};

const COLOR_TEXT: Record<WorkloadColor, string> = {
  green: "text-success",
  yellow: "text-warning",
  orange: "text-orange-600 dark:text-orange-400",
  red: "text-danger",
};

const COLOR_BG: Record<WorkloadColor, string> = {
  green: "bg-success/[.13]",
  yellow: "bg-warning/[.15]",
  orange: "bg-orange-500/[.13]",
  red: "bg-danger/[.13]",
};

function Tile({
  label,
  metric,
  periodLabel,
  extraNotes,
}: {
  label: string;
  metric: WorkloadMetric & { isHoliday?: boolean };
  periodLabel: string;
  extraNotes?: string[];
}) {
  if (metric.isWeekend || metric.isHoliday) {
    return (
      <div className="rounded-[14px] p-4 bg-primary-surface">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs font-medium text-secondary">{label}</span>
        </div>
        <p className="text-lg font-bold text-primary">
          ⚡ {hoursToDisplay(metric.realHours)}h{" "}
          <span className="text-sm font-semibold">
            — Trabajo en {metric.isHoliday ? "feriado" : "fin de semana"}
          </span>
        </p>
        {extraNotes && extraNotes.map((note) => (
          <p key={note} className="text-[10px] text-primary font-medium mt-0.5">{note}</p>
        ))}
        <p className="text-[10px] text-disabled mt-0.5">{periodLabel}</p>
      </div>
    );
  }
  return (
    <div className={`rounded-[14px] p-4 ${COLOR_BG[metric.color]}`}>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs font-medium text-secondary">{label}</span>
        <span className={`w-2 h-2 rounded-full shrink-0 ${WORKLOAD_COLOR_DOT[metric.color]}`} />
      </div>
      <p className={`text-lg font-bold ${COLOR_TEXT[metric.color]}`}>
        {hoursToDisplay(metric.realHours)}h <span className="text-sm font-semibold">— {metric.label}</span>
      </p>
      <p className="text-[11px] text-secondary mt-1">
        {metric.baseHours > 0
          ? `rango óptimo ${hoursToDisplay(metric.rangeMin)}-${hoursToDisplay(metric.rangeMax)}h · ${metric.pct}%`
          : `${metric.pct}%`}
      </p>
      {extraNotes && extraNotes.map((note) => (
        <p key={note} className="text-[10px] text-primary font-medium mt-0.5">{note}</p>
      ))}
      <p className="text-[10px] text-disabled mt-0.5">{periodLabel}</p>
    </div>
  );
}

function formatMinutesAsHours(mins: number): string {
  return `${hoursToDisplay(mins / 60)}h`;
}

/** "Rangos: Subutilización <5.30 | Moderado 5.30-6.30 | Óptimo 6.30-7.30 | Elevada 7.30-8.30 | Sobrecarga >8.30" */
function rangesSummary(base: number, limitLow: number, limitHigh: number, limitOverload: number): string {
  const low = hoursToDisplay(limitLow);
  const baseDisplay = hoursToDisplay(base);
  const high = hoursToDisplay(limitHigh);
  const overload = hoursToDisplay(limitOverload);
  return (
    `Rangos: Subutilización <${low} | Moderado ${low}-${baseDisplay} | ` +
    `Óptimo ${baseDisplay}-${high} | Elevada ${high}-${overload} | Sobrecarga >${overload}`
  );
}

export default function WorkloadCard({ cargaTiempo }: { cargaTiempo: CargaTiempo }) {
  const {
    diaria,
    semanal,
    mensual,
    horasEfectivasPorDia,
    workloadLimitLow,
    workloadLimitHigh,
    workloadLimitOverload,
    dailyHistory,
    weeklyHistory,
  } = cargaTiempo;

  return (
    <div className="bg-surface rounded-[14px] border border-border shadow-[var(--shadow)] p-5">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1 mb-1">
        <h3 className="text-[11px] font-semibold text-secondary uppercase tracking-wider">
          Carga laboral (horas reales)
        </h3>
        <span className="text-[10px] text-disabled bg-background border border-border px-2 py-0.5 rounded-full shrink-0">
          {hoursToDisplay(horasEfectivasPorDia)}h efectivas/día
        </span>
      </div>
      <p className="text-[10px] text-disabled mb-3 leading-relaxed">
        {rangesSummary(horasEfectivasPorDia, workloadLimitLow, workloadLimitHigh, workloadLimitOverload)}
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Tile
          label="Hoy"
          metric={diaria}
          periodLabel="hoy"
          extraNotes={[
            ...(diaria.medicoLeaveFullDay
              ? ["🏥 Permiso médico: día completo"]
              : diaria.medicoLeaveMinutes > 0
                ? [`🏥 Permiso médico: ${formatMinutesAsHours(diaria.medicoLeaveMinutes)}`]
                : []),
            ...(diaria.personalLeaveFullDay
              ? ["📋 Permiso personal: día completo"]
              : diaria.personalLeaveMinutes > 0
                ? [`📋 Permiso personal: ${formatMinutesAsHours(diaria.personalLeaveMinutes)}`]
                : []),
          ]}
        />
        <Tile
          label="Esta semana"
          metric={semanal}
          periodLabel={`semana del ${semanal.weekStartLabel} al ${semanal.weekEndLabel}`}
          extraNotes={
            semanal.weekendHours > 0 && semanal.realHours > semanal.baseHours
              ? [`incluye ${hoursToDisplay(semanal.weekendHours)}h de fin de semana`]
              : undefined
          }
        />
        <Tile
          label="Este mes"
          metric={mensual}
          periodLabel={`${mensual.monthLabel}, ${mensual.businessDays} ${
            mensual.businessDays === 1 ? "día laborable" : "días laborables"
          }`}
          extraNotes={[
            ...(mensual.weekendHours > 0 ? [`⚡ Fines de semana: ${hoursToDisplay(mensual.weekendHours)}h`] : []),
            ...(mensual.holidayHours > 0 ? [`⚡ Feriados trabajados: ${hoursToDisplay(mensual.holidayHours)}h`] : []),
            ...(mensual.medicoLeaveMinutes > 0 ? [`🏥 Permisos médicos: ${formatMinutesAsHours(mensual.medicoLeaveMinutes)}`] : []),
            ...(mensual.personalLeaveMinutes > 0 ? [`📋 Permisos personales: ${formatMinutesAsHours(mensual.personalLeaveMinutes)}`] : []),
          ]}
        />
      </div>

      {dailyHistory.length > 0 && (
        <div className="mt-5 pt-4 border-t border-border">
          <h4 className="text-[11px] font-semibold text-secondary uppercase tracking-wider mb-2">
            Últimos días laborables
          </h4>
          <DailyCargaBarChart points={dailyHistory} baseHours={horasEfectivasPorDia} optimalMax={workloadLimitHigh} />
        </div>
      )}

      {weeklyHistory.length > 0 && (
        <div className="mt-5 pt-4 border-t border-border">
          <h4 className="text-[11px] font-semibold text-secondary uppercase tracking-wider mb-2">
            Semanas de este mes
          </h4>
          <WeeklyCargaLineChart points={weeklyHistory} optimalMax={workloadLimitHigh * 5} />
        </div>
      )}
    </div>
  );
}
