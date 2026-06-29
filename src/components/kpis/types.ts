export type KpiColor = "green" | "yellow" | "red";

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
