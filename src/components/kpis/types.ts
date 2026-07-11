export type KpiColor = "green" | "yellow" | "red";

/**
 * Semáforo de carga laboral por rango — 5 zonas, no solo 3 colores:
 * rojo (subutilización o sobrecarga), amarillo (moderado), verde (óptimo),
 * naranja (carga elevada, distinto del amarillo "moderado").
 */
export type WorkloadColor = "red" | "yellow" | "green" | "orange";

/** Etiqueta del semáforo de carga laboral por rango (base ± tolerancia configurable). */
export type WorkloadLabel = "Subutilización" | "Moderado" | "Óptimo" | "Carga elevada" | "Sobrecarga";

export type ReportMemberKpi = {
  id: string;
  name: string;
  role: string;
  score: number;
  completedPct: number;
  cargaPct: number;
  cargaRealHours: number;
  cargaBaseHours: number;
  cargaColor: WorkloadColor;
  cargaLabel: WorkloadLabel;
  cargaRangeMin: number;
  cargaRangeMax: number;
  totalTasks: number;
  completedTasks: number;
  overdueCount: number;
  seguimientoTotal: number;
  byReason: Array<{ reason: string; count: number; totalMinutes: number }>;
};

export type ReportData = {
  month: string;
  scope: string;
  teamSummary: {
    avgCumplimiento: number;
    avgCargaPct: number;
    totalCargaRealHours: number;
    totalCargaBaseHours: number;
    totalCompletedTasks: number;
    totalConsultas: number;
    totalTasks: number;
    hoursPerDay: number;
    workloadTolerance: number;
    cargaRangeMin: number;
    cargaRangeMax: number;
  };
  members: ReportMemberKpi[];
  ranking: Array<{ id: string; name: string; role: string; score: number; completedPct: number }>;
  consultasByReason: Array<{ reason: string; count: number; totalMinutes: number }>;
  alerts: Array<{ userId: string; name: string; type: "cumplimiento" | "sobrecarga"; value: number }>;
};

export type MonthlyReportSummary = {
  id: string;
  month: number;
  year: number;
  scope: string;
  generatedBy: string;
  createdAt: string;
};

export type MonthlyReportFull = MonthlyReportSummary & {
  data: ReportData;
  aiAnalysis: string | null;
};

export type MonthSnapshot = {
  month: string;
  label: string;
  teamAvgCumplimiento: number;
  totalCompletedTasks: number;
  totalTasks: number;
  totalCargaRealHours: number;
  totalCargaBaseHours: number;
  totalConsultas: number;
  memberSnapshots: Array<{
    id: string;
    name: string;
    role: string;
    completedPct: number;
    cargaPct: number;
    cargaColor: WorkloadColor;
    cargaLabel: WorkloadLabel;
    score: number;
    totalTasks: number;
  }>;
};

export type RangeReportData = {
  from: string;
  to: string;
  scope: string;
  months: MonthSnapshot[];
  aggregated: {
    teamSummary: {
      avgCumplimiento: number;
      avgCargaPct: number;
      totalCompletedTasks: number;
      totalTasks: number;
      totalCargaRealHours: number;
      totalCargaBaseHours: number;
      totalConsultas: number;
      workloadTolerance: number;
      cargaRangeMin: number;
      cargaRangeMax: number;
    };
    members: ReportMemberKpi[];
    ranking: Array<{ id: string; name: string; role: string; avgScore: number; avgCumplimiento: number }>;
    consultasByReason: Array<{ reason: string; count: number; totalMinutes: number }>;
    alerts: Array<{ userId: string; name: string; type: "cumplimiento" | "sobrecarga"; avgValue: number; monthsAffected: number }>;
    problematicMonths: Array<{ month: string; label: string; teamAvgCumplimiento: number }>;
  };
  trends: {
    cumplimientoTrend: "mejora" | "deterioro" | "estancamiento";
    cumplimientoChange: number;
    firstMonthAvgCumplimiento: number;
    lastMonthAvgCumplimiento: number;
  };
  aiAnalysis: string;
};

export type TeamMemberKpi = {
  id: string;
  name: string;
  role: string;
  score: number;
  completedPct: number;
  cargaRatio: number;
  totalTasks: number;
  overdueCount: number;
  color: KpiColor;
};

export type KpiByReason = {
  reason: string;
  count: number;
  totalMinutes: number;
  avgMinutes: number;
};

export type WorkloadMetric = {
  realHours: number;
  baseHours: number;
  pct: number;
  color: WorkloadColor;
  /** Límites de la zona Óptima (verde): [rangeMin, rangeMax] = [base, base + tolerancia]. */
  rangeMin: number;
  rangeMax: number;
  label: WorkloadLabel;
};

/** Un día laborable en el histórico de carga (gráfico de barras). */
export type DailyCargaPoint = {
  date: string;
  dayLabel: string;
  realHours: number;
  baseHours: number;
  color: WorkloadColor;
  label: WorkloadLabel;
};

/** Una semana (posiblemente parcial) del mes en curso, para el gráfico de línea. */
export type WeeklyCargaPoint = {
  weekLabel: string;
  realHours: number;
  baseHours: number;
  color: WorkloadColor;
  label: WorkloadLabel;
};

export type CargaTiempo = {
  diaria: WorkloadMetric;
  semanal: WorkloadMetric & { weekStartLabel: string; weekEndLabel: string; businessDays: number };
  mensual: WorkloadMetric & { monthLabel: string; businessDays: number };
  horasEfectivasPorDia: number;
  workloadTolerance: number;
  dailyHistory: DailyCargaPoint[];
  weeklyHistory: WeeklyCargaPoint[];
};

export type KpiData = {
  user: { id: string; name: string; role: string };
  period: { month: string };
  cumplimiento: {
    total: number;
    completed: number;
    overdue: number;
    completedPct: number;
    overduePct: number;
    avgDelayDays: number;
    color: KpiColor;
  };
  cargaLaboral: {
    estimatedHours: number;
    realHours: number;
    ratio: number;
    color: KpiColor;
  };
  cargaTiempo: CargaTiempo;
  seguimiento: {
    total: number;
    byReason: KpiByReason[];
  };
  calidad: {
    avgProgress: number;
    recurringCompleted: number;
    recurringTotal: number;
    recurringPct: number;
  };
  actividad: {
    totalComments: number;
    assignedByOthers: number;
    ownTasks: number;
  };
  score: number;
  horasByWeek: Array<{ week: string; estimated: number; real: number }>;
  cumplimientoHistory: Array<{ month: string; label: string; completedPct: number }>;
  tasks: Array<{
    id: string;
    title: string;
    type: string;
    status: string;
    endDate: string;
    delayDays: number;
    color: KpiColor;
  }>;
  prevMonth: {
    completedPct: number;
    cargaRatio: number;
    totalTasks: number;
    seguimientoTotal: number;
  } | null;
};
