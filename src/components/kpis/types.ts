export type KpiColor = "green" | "yellow" | "red";

/**
 * Semáforo de carga laboral por rango — 5 zonas, no solo 3 colores:
 * rojo (subutilización o sobrecarga), amarillo (moderado), verde (óptimo),
 * naranja (carga elevada, distinto del amarillo "moderado").
 */
export type WorkloadColor = "red" | "yellow" | "green" | "orange";

/** Etiqueta del semáforo de carga laboral por rango (4 límites independientes configurables). */
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
  updatedAt: string;
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
  /** Límites de la zona Óptima (verde): [rangeMin, rangeMax] = [base, workload_limit_high]. */
  rangeMin: number;
  rangeMax: number;
  label: WorkloadLabel;
  /** Sábado/domingo: no aplica el semáforo por rango (sin base laboral con la que comparar). */
  isWeekend: boolean;
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

/** Estado especial de personal (maternidad/lactancia) — base diaria fija de 6h mientras esté vigente. */
export type SpecialStatusType = "MATERNIDAD" | "LACTANCIA";

export type CargaTiempo = {
  diaria: WorkloadMetric & {
    /** Hoy es un feriado configurado (y no cae en fin de semana) — se muestra como "trabajo en feriado". */
    isHoliday: boolean;
    medicoLeaveMinutes: number;
    medicoLeaveFullDay: boolean;
    personalLeaveMinutes: number;
    personalLeaveFullDay: boolean;
    vacacionesFullDay: boolean;
    specialStatusType: SpecialStatusType | null;
  };
  semanal: WorkloadMetric & {
    weekStartLabel: string;
    weekEndLabel: string;
    businessDays: number;
    /** Horas reales registradas en sábado/domingo dentro de esta semana (ya incluidas en realHours). */
    weekendHours: number;
  };
  mensual: WorkloadMetric & {
    monthLabel: string;
    businessDays: number;
    /** Desglose adicional del mes — cada uno solo es relevante si es > 0. */
    weekendHours: number;
    holidayHours: number;
    medicoLeaveMinutes: number;
    personalLeaveMinutes: number;
    vacacionesMinutes: number;
  };
  horasEfectivasPorDia: number;
  workloadLimitLow: number;
  workloadLimitHigh: number;
  workloadLimitOverload: number;
  /** Ajuste puntual del Administrador (User.kpiStartDate) vigente para este usuario, si existe. */
  kpiStartDate: string | null;
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
