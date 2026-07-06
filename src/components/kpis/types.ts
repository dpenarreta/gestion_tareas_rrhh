export type KpiColor = "green" | "yellow" | "red";

export type ReportMemberKpi = {
  id: string;
  name: string;
  role: string;
  score: number;
  completedPct: number;
  cargaRatio: number;
  totalTasks: number;
  completedTasks: number;
  overdueCount: number;
  estimatedHours: number;
  realHours: number;
  seguimientoTotal: number;
  byReason: Array<{ reason: string; count: number; totalMinutes: number }>;
};

export type ReportData = {
  month: string;
  scope: string;
  teamSummary: {
    avgCumplimiento: number;
    totalEstimatedHours: number;
    totalRealHours: number;
    totalCompletedTasks: number;
    totalConsultas: number;
    totalTasks: number;
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
  totalRealHours: number;
  totalEstimatedHours: number;
  totalConsultas: number;
  memberSnapshots: Array<{
    id: string;
    name: string;
    role: string;
    completedPct: number;
    cargaRatio: number;
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
      totalCompletedTasks: number;
      totalTasks: number;
      totalRealHours: number;
      totalEstimatedHours: number;
      totalConsultas: number;
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

export type WorkloadMetric = { realHours: number; baseHours: number; pct: number; color: KpiColor };
export type CargaTiempo = {
  diaria: WorkloadMetric;
  semanal: WorkloadMetric & { weekStartLabel: string; weekEndLabel: string; businessDays: number };
  mensual: WorkloadMetric & { monthLabel: string; businessDays: number };
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
