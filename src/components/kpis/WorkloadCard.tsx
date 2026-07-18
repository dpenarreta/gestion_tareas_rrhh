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
  leaveLines,
}: {
  label: string;
  metric: WorkloadMetric & { isHoliday?: boolean };
  periodLabel: string;
  extraNotes?: string[];
  /** Cuando el día tiene un permiso registrado: reemplaza la barra/semáforo por texto descriptivo. */
  leaveLines?: string[];
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
  if (leaveLines && leaveLines.length > 0) {
    return (
      <div className="rounded-[14px] p-4 bg-primary-surface">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs font-medium text-secondary">{label}</span>
        </div>
        {leaveLines.map((line) => (
          <p key={line} className="text-lg font-bold text-primary leading-snug">{line}</p>
        ))}
        {extraNotes && extraNotes.map((note) => (
          <p key={note} className="text-[10px] text-primary font-medium mt-0.5">{note}</p>
        ))}
        <p className="text-[10px] text-disabled mt-1">{periodLabel}</p>
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

/**
 * Líneas descriptivas del permiso del día — reemplazan la barra/semáforo cuando hay
 * alguno registrado. Cuando el detalle fue redactado (viewer distinto del titular y
 * no Administrador — dato de salud, Art. 26 LOPDP), se usa una única línea genérica
 * sin especificar el tipo de permiso.
 */
function dailyLeaveLines(diaria: CargaTiempo["diaria"], sensitiveDetailVisible: boolean): string[] {
  if (!sensitiveDetailVisible) {
    if (diaria.personalLeaveFullDay) return ["📋 Ausencia justificada"];
    if (diaria.personalLeaveMinutes > 0) return [`📋 Ausencia justificada (${hoursToDisplay(diaria.personalLeaveMinutes / 60)}h)`];
    return [];
  }
  const lines: string[] = [];
  if (diaria.vacacionesFullDay) lines.push("🌴 Vacaciones");
  if (diaria.medicoLeaveFullDay) lines.push("🏥 Permiso médico");
  else if (diaria.medicoLeaveMinutes > 0) lines.push(`🏥 Permiso médico (${hoursToDisplay(diaria.medicoLeaveMinutes / 60)}h)`);
  if (diaria.personalLeaveFullDay) lines.push("📋 Permiso personal");
  else if (diaria.personalLeaveMinutes > 0) lines.push(`📋 Permiso personal (${hoursToDisplay(diaria.personalLeaveMinutes / 60)}h)`);
  return lines;
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
    effectiveHoursPerDia,
    effectiveLimitLow,
    effectiveLimitBase,
    effectiveLimitHigh,
    effectiveLimitOverload,
    kpiStartDate,
    dailyHistory,
    weeklyHistory,
    sensitiveDetailVisible,
  } = cargaTiempo;

  const dailyChartHasSpecial = diaria.specialStatusType != null || dailyHistory.some((p) => p.specialStatusType != null);
  const weeklyChartHasSpecial = diaria.specialStatusType != null || weeklyHistory.some((p) => p.specialStatusType != null);

  return (
    <div className="bg-surface rounded-[14px] border border-border shadow-[var(--shadow)] p-5">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1 mb-1">
        <h3 className="text-[11px] font-semibold text-secondary uppercase tracking-wider">
          Carga laboral (horas reales)
        </h3>
        <span className="flex items-center gap-1.5 shrink-0">
          {diaria.specialStatusType && (
            <span className="text-[10px] text-primary bg-primary-surface px-2 py-0.5 rounded-full font-medium">
              👶 Jornada especial
            </span>
          )}
          <span className="text-[10px] text-disabled bg-background border border-border px-2 py-0.5 rounded-full">
            {hoursToDisplay(effectiveHoursPerDia)}h efectivas/día
          </span>
        </span>
      </div>
      <p className={`text-[10px] text-disabled leading-relaxed ${kpiStartDate ? "mb-1" : "mb-3"}`}>
        {rangesSummary(effectiveLimitBase, effectiveLimitLow, effectiveLimitHigh, effectiveLimitOverload)}
      </p>
      {kpiStartDate && (
        <p className="text-[10px] text-primary font-medium mb-3">
          KPIs calculados desde {new Date(kpiStartDate).toLocaleDateString("es-EC", { day: "2-digit", month: "long", year: "numeric", timeZone: "UTC" })} por configuración de administrador
        </p>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Tile
          label="Hoy"
          metric={diaria}
          periodLabel="hoy"
          leaveLines={dailyLeaveLines(diaria, sensitiveDetailVisible)}
          extraNotes={diaria.specialStatusType ? ["👶 Maternidad/Lactancia"] : undefined}
        />
        <Tile
          label="Esta semana"
          metric={semanal}
          periodLabel={`semana del ${semanal.weekStartLabel} al ${semanal.weekEndLabel}`}
          extraNotes={[
            ...(semanal.specialStatusType ? ["👶 Maternidad/Lactancia"] : []),
            ...(semanal.weekendHours > 0 && semanal.realHours > semanal.baseHours
              ? [`incluye ${hoursToDisplay(semanal.weekendHours)}h de fin de semana`]
              : []),
          ]}
        />
        <Tile
          label="Este mes"
          metric={mensual}
          periodLabel={`${mensual.monthLabel}, ${mensual.businessDays} ${
            mensual.businessDays === 1 ? "día laborable" : "días laborables"
          }`}
          extraNotes={[
            ...(mensual.specialStatusType ? ["👶 Maternidad/Lactancia"] : []),
            ...(mensual.weekendHours > 0 ? [`⚡ Fines de semana: ${hoursToDisplay(mensual.weekendHours)}h`] : []),
            ...(mensual.holidayHours > 0 ? [`⚡ Feriados trabajados: ${hoursToDisplay(mensual.holidayHours)}h`] : []),
            ...(sensitiveDetailVisible
              ? [
                  ...(mensual.medicoLeaveMinutes > 0 ? [`🏥 Permisos médicos: ${formatMinutesAsHours(mensual.medicoLeaveMinutes)}`] : []),
                  ...(mensual.personalLeaveMinutes > 0 ? [`📋 Permisos personales: ${formatMinutesAsHours(mensual.personalLeaveMinutes)}`] : []),
                  ...(mensual.vacacionesMinutes > 0 ? [`🌴 Vacaciones: ${formatMinutesAsHours(mensual.vacacionesMinutes)}`] : []),
                ]
              : mensual.personalLeaveMinutes > 0
                ? [`📋 Ausencias justificadas: ${formatMinutesAsHours(mensual.personalLeaveMinutes)}`]
                : []),
          ]}
        />
      </div>

      {dailyHistory.length > 0 && (
        <div className="mt-5 pt-4 border-t border-border">
          <div className="flex items-center gap-2 mb-2">
            <h4 className="text-[11px] font-semibold text-secondary uppercase tracking-wider">
              Días laborables del mes
            </h4>
            {dailyChartHasSpecial && (
              <span className="text-[10px] text-primary bg-primary-surface px-2 py-0.5 rounded-full font-medium">
                👶 Jornada especial
              </span>
            )}
          </div>
          <DailyCargaBarChart points={dailyHistory} baseHours={effectiveHoursPerDia} optimalMax={effectiveLimitHigh} />
        </div>
      )}

      {weeklyHistory.length > 0 && (
        <div className="mt-5 pt-4 border-t border-border">
          <div className="flex items-center gap-2 mb-2">
            <h4 className="text-[11px] font-semibold text-secondary uppercase tracking-wider">
              Semanas de este mes
            </h4>
            {weeklyChartHasSpecial && (
              <span className="text-[10px] text-primary bg-primary-surface px-2 py-0.5 rounded-full font-medium">
                👶 Jornada especial
              </span>
            )}
          </div>
          <WeeklyCargaLineChart points={weeklyHistory} optimalMax={effectiveLimitHigh * 5} />
        </div>
      )}
    </div>
  );
}
