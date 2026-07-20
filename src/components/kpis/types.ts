import type { RiskAlert } from "@/lib/riskAlerts";

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
  /** Carga laboral del mes en curso por rango (5 zonas) — usada por el balance de carga del equipo. */
  cargaPct: number;
  cargaColor: WorkloadColor;
  cargaLabel: WorkloadLabel;
  cargaRealHours: number;
  cargaBaseHours: number;
  /** % de capacidad disponible respecto a la base mensual — 0 si ya está en/sobre el límite óptimo superior. */
  capacidadDisponiblePct: number;
  /** Horas disponibles estimadas hasta el límite óptimo superior — 0 si ya está en/sobre ese límite. */
  horasDisponibles: number;
};

export type { CapacityForecast, CapacityEstado } from "@/lib/capacityForecast";

/** Fila de /api/kpis/team-capacity — ver Analytics § Capacidad para asumir nuevas tareas. */
export type CapacityMember = import("@/lib/capacityForecast").CapacityForecast & {
  id: string;
  name: string;
  role: string;
};

export type CapacitySummary = {
  total: number;
  alta: number;
  limitada: number;
  sobrecargados: number;
  sinPlanificacion: number;
};

/** Cumplimiento por nivel de prioridad de tarea — ver Analytics § cumplimiento por prioridad. */
export type PriorityCompliance = {
  priority: "ALTA" | "MEDIA" | "BAJA";
  total: number;
  completedOnTime: number;
  pct: number;
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

/** Estado especial de personal (maternidad/lactancia) — mientras esté vigente, sus límites configurados por registro reemplazan a los globales. */
export type SpecialStatusType = "MATERNIDAD" | "LACTANCIA";

/**
 * Tipo de día en el histórico mensual de carga — determina el color/etiqueta de
 * la barra en el gráfico deslizable (ver DailyCargaBarChart en KpiCharts.tsx):
 * - `normal`/`empty`: día laborable con/sin registro, usa el semáforo de color.
 * - `holiday`: feriado configurado.
 * - `leave-medico`/`leave-personal`/`leave-vacaciones`: permiso o vacaciones de día completo.
 * - `leave-generic`: igual que los anteriores pero con el tipo redactado (ver
 *   `redactSensitiveWorkloadDetail`) — dato de salud visible solo para el
 *   propio titular y el Administrador.
 * - `weekend-extra`: sábado/domingo con horas registradas (fuera de la base laboral).
 */
export type CargaDayKind =
  | "normal"
  | "empty"
  | "holiday"
  | "leave-medico"
  | "leave-personal"
  | "leave-vacaciones"
  | "leave-generic"
  | "weekend-extra";

/** Un día del histórico mensual de carga (gráfico de barras deslizable). */
export type DailyCargaPoint = {
  date: string;
  dayLabel: string;
  realHours: number;
  baseHours: number;
  color: WorkloadColor;
  label: WorkloadLabel;
  /** Estado especial vigente ese día (si alguno) — para la etiqueta "👶 Jornada especial" en el gráfico. */
  specialStatusType: SpecialStatusType | null;
  kind: CargaDayKind;
};

/** Una semana (posiblemente parcial) del mes en curso, para el gráfico de línea. */
export type WeeklyCargaPoint = {
  weekLabel: string;
  realHours: number;
  baseHours: number;
  color: WorkloadColor;
  label: WorkloadLabel;
  /** Estado especial vigente en algún día de esta semana (si alguno). */
  specialStatusType: SpecialStatusType | null;
};

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
    /** Estado especial vigente en algún día de esta semana (si alguno). */
    specialStatusType: SpecialStatusType | null;
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
    /** Estado especial vigente en algún día de este mes (si alguno). */
    specialStatusType: SpecialStatusType | null;
  };
  /** Horas efectivas GLOBALES configuradas (SystemConfigHistory) — no ajustadas por estado especial. */
  horasEfectivasPorDia: number;
  workloadLimitLow: number;
  workloadLimitHigh: number;
  workloadLimitOverload: number;
  /**
   * Base/límites REALMENTE vigentes HOY para este usuario: los del estado especial
   * activo hoy (si hay) o, si no, los mismos valores globales de arriba. Úsalos para
   * el resumen de rangos y las líneas de referencia de los gráficos en vez de asumir
   * siempre la configuración global — ver diaria.specialStatusType para saber cuál es.
   */
  effectiveHoursPerDia: number;
  effectiveLimitLow: number;
  effectiveLimitBase: number;
  effectiveLimitHigh: number;
  effectiveLimitOverload: number;
  /** Ajuste puntual del Administrador (User.kpiStartDate) vigente para este usuario, si existe. */
  kpiStartDate: string | null;
  dailyHistory: DailyCargaPoint[];
  weeklyHistory: WeeklyCargaPoint[];
  /**
   * false cuando el detalle de tipo de permiso (médico/personal/vacaciones) y de
   * estado especial (maternidad/lactancia) fue redactado para este viewer — datos de
   * salud (Art. 26 LOPDP) visibles solo para el propio titular y el Administrador.
   * Ver `redactSensitiveWorkloadDetail` en `src/lib/workload.ts` y `docs/RAT.md`.
   */
  sensitiveDetailVisible: boolean;
};

// ── Dashboard ejecutivo (JEFE_NACIONAL) ─────────────────────────────────────

export type ExecutiveAlertPerson = {
  type: "cumplimiento" | "sobrecarga";
  userId: string;
  name: string;
  value: number;
};

export type ExecutivePendingIdea = {
  id: string;
  title: string;
  status: string;
  authorName: string;
};

export type ExecutiveRankingMember = {
  id: string;
  name: string;
  role: string;
  score: number;
  /** score de este mes menos el del mes anterior (0 si no hay mes anterior con datos). */
  scoreTrend: number;
  completedPct: number;
  cargaPct: number;
  cargaRealHours: number;
  cargaBaseHours: number;
  cargaColor: WorkloadColor;
  cargaLabel: WorkloadLabel;
  totalTasks: number;
};

export type ExecutiveWorkloadPoint = {
  id: string;
  name: string;
  realHours: number;
  baseHours: number;
  color: WorkloadColor;
};

export type ExecutiveDashboardData = {
  month: string;
  overview: {
    avgCumplimiento: number;
    avgCumplimientoColor: KpiColor;
    sobrecargaCount: number;
    subutilizacionCount: number;
    totalHoras: number;
    totalConsultas: number;
  };
  trend: Array<{ month: string; label: string; avgCumplimiento: number }>;
  /** Cumplimiento promedio de este mes menos el del mes anterior. */
  trendDelta: number;
  alerts: {
    lowCumplimiento: ExecutiveAlertPerson[];
    sobrecarga: ExecutiveAlertPerson[];
    pendingIdeas: ExecutivePendingIdea[];
  };
  ranking: ExecutiveRankingMember[];
  workload: ExecutiveWorkloadPoint[];
};

export type KpiData = {
  user: { id: string; name: string; role: string };
  period: { month: string };
  cumplimiento: {
    total: number;
    completed: number;
    inProgress: number;
    pending: number;
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
  riskAlerts: RiskAlert[];
  cumplimientoPorPrioridad: PriorityCompliance[];
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
