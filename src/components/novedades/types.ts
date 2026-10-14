import type { DeadlineRules } from "@/lib/novedadesAutosave";

// Formas camelCase que devuelve `/api/novedades/*` (ya adaptadas desde
// Django por `src/lib/djangoNovedadesAdapter.ts`).

export type NovedadesMe = {
  role: string | null;
  permissions: string[];
  isSupervisor: boolean;
  isAssistant: boolean;
  /** Jefe de Operaciones: consulta y depura (Horas depuradas). */
  isJefe?: boolean;
  /** Edita la base de Horas depuradas (solo el Jefe). */
  canDepurate?: boolean;
  /** Ve la pestaña Horas Depuradas (Jefe y Administrador). */
  canViewDepuration?: boolean;
  nationalRead: boolean;
  nationalWrite: boolean;
  /** Historial de registros: Administrador y Asistente; nunca el Supervisor (lo decide Django). */
  canViewHistory?: boolean;
  currentPeriod: { code: string; label: string; status: string | null };
  /** Mes calendario vigente de Horas extras (distinto del corte 23 → 22). */
  currentMonth?: { code: string; label: string };
  user: { id: number; name: string };
  /** Plazo de registro por fecha (lo calcula Django). */
  deadlineRules?: DeadlineRules;
};

export type PeriodOption = {
  code: string;
  label: string;
  startDate: string;
  endDate: string;
  status: "OPEN" | "CLOSED" | null;
};

/** Estado del mes de Horas extras (lo calcula Django; solo CLOSED bloquea). */
export type OvertimeMonthStatus = "OPEN" | "GRACE" | "OVERDUE" | "CLOSED" | "FUTURE";

/** Mes calendario de Horas extras con su plazo de cierre (48–72 h laborables). */
export type OvertimeMonth = {
  code: string;
  label: string;
  startDate: string;
  endDate: string;
  status: OvertimeMonthStatus;
  graceHours: number;
  /** Fin exclusivo del plazo (ISO, UTC). */
  deadline: string;
  /** Último minuto incluido, ya en hora de Ecuador (p. ej. "martes 03/11/2026 23:59"). */
  deadlineLabel: string;
  remainingSeconds: number;
  /** Segundos hasta el próximo cambio de estado (fin de mes o fin de plazo). */
  refreshInSeconds?: number;
  closingSoon: boolean;
  closedAt: string | null;
  closedBy: string;
  supervisorsClosed?: number;
  supervisorsTotal?: number;
};

export const OVERTIME_STATUS_LABEL: Record<OvertimeMonthStatus, string> = {
  OPEN: "en curso",
  GRACE: "en plazo de cierre",
  OVERDUE: "plazo vencido, sin cerrar",
  CLOSED: "cerrado",
  FUTURE: "no iniciado",
};

export type SupervisorOption = { id: number; name: string };

export type CollaboratorStatus = "ACTIVE" | "INACTIVE" | "SUSPENDED";

export type MatrixColumn = {
  date: string;
  day: number;
  weekday: string;
  isWeekend: boolean;
  holiday: string;
  /** Plazo por fecha ya resuelto por Django para este usuario: "" = en plazo,
   * "future" = fecha futura, "expired" = vencida (bloqueada), "late" = vencida
   * pero editable por excepción (Asistente/Administrador). */
  deadlineState?: "" | "future" | "expired" | "late";
  deadlineLabel?: string;
};

/** `otherTeam`: la celda la registró el equipo anterior (colaborador reasignado):
 * se muestra pero no se edita desde este equipo ni suma en su total. */
export type MatrixCell = { hours: string | null; version: number; otherTeam?: string };

export type MatrixRow = {
  collaboratorId: number;
  cedula: string;
  fullName: string;
  cargo: string;
  area: string;
  regional: string;
  status: CollaboratorStatus;
  isCurrentMember: boolean;
  cells: Record<string, MatrixCell>;
  totalHours: string;
  /** Solo en la vista "Todos los supervisores": equipo de la fila, si se
   * puede editar y el estado del período de ese equipo. */
  supervisorId?: number;
  supervisorName?: string;
  editable?: boolean;
  periodStatus?: "OPEN" | "CLOSED" | "NOT_STARTED";
};

export type WorkedDaysMatrix = {
  period: {
    code: string;
    label: string;
    startDate: string;
    endDate: string;
    status: "OPEN" | "CLOSED" | "NOT_STARTED";
    closedAt: string | null;
    closedBy: string;
  };
  /** null = vista "Todos los supervisores" (alcance nacional). */
  supervisor: { id: number; name: string } | null;
  editable: boolean;
  supervisorsTotal?: number;
  supervisorsClosed?: number;
  /** Se puede cerrar (permiso de cierre + equipo propio + período abierto), aun sin permiso de registro. */
  closable?: boolean;
  columns: MatrixColumn[];
  rows: MatrixRow[];
};

export type Collaborator = {
  id: number;
  cedula: string;
  fullName: string;
  regional: string;
  area: string;
  cargo: string;
  status: CollaboratorStatus;
  statusLabel: string;
  supervisorId: number;
  supervisorName: string;
  createdAt: string;
  updatedAt: string;
};

export type OvertimeRecord = {
  id: number;
  collaboratorId: number;
  date: string;
  cedula: string;
  fullName: string;
  regional: string;
  area: string;
  cargo: string;
  supervisorId: number;
  supervisorName: string;
  period: string;
  overtimeHours: string;
  saturdayHours: string;
  isSaturday: boolean;
  isSunday: boolean;
  isHoliday: boolean;
  workDone: string;
  observations: string;
  version: number;
  createdByName: string;
  updatedByName: string;
  createdAt: string;
  updatedAt: string;
};

export type OvertimeIndicators = {
  records: number;
  overtimeHours: string;
  saturdayHours: string;
  supervisorsReporting: number;
};

export type CloseSummary = {
  period: string;
  periodLabel: string;
  supervisorId: number;
  supervisorName: string;
  collaborators: number;
  activeCollaborators: number;
  workedDayCells: number;
  zeroCells: number;
  pendingCells: number;
  workedHours: string;
  /** Solo en cierres anteriores a v1.173.0 (contaban horas extras del corte 23 → 22). */
  overtimeRecords?: number;
  overtimeHours?: string;
  saturdayHours?: string;
};

export type SupervisorStatus = {
  supervisorId: number;
  supervisorName: string;
  status: "OPEN" | "CLOSED" | "NOT_STARTED";
  closedAt: string | null;
  closedBy: string;
  collaborators: number;
};

export type NovedadEvent = {
  id: number;
  action: string;
  actorName: string;
  actorRole: string;
  supervisorId: number | null;
  supervisorName: string;
  period: string | null;
  targetType: string;
  targetId: string;
  targetLabel: string;
  field: string;
  oldValue: string;
  newValue: string;
  reason: string;
  sourceFile: string;
  createdAt: string;
  /** "danger" = dejó al colaborador Inactivo o Suspendido; "info" = nuevo ingreso a la base (lo decide Django). */
  highlight?: string;
};

export type RepositoryPeriod = {
  code: string;
  label: string;
  startDate: string;
  endDate: string;
  supervisors: {
    supervisorId: number;
    supervisorName: string;
    status: "OPEN" | "CLOSED";
    closedAt: string | null;
    closedBy: string;
    summary: Partial<CloseSummary>;
  }[];
  corrections: {
    id: number;
    target: "WORKED_DAY" | "OVERTIME";
    supervisorName: string;
    originalValues: Record<string, unknown>;
    newValues: Record<string, unknown>;
    reason: string;
    correctedBy: string;
    createdAt: string;
  }[];
};

export type ImportBatch = {
  id: number;
  kind: "WORKED_DAYS" | "OVERTIME" | "COLLABORATORS";
  status: "PREVIEW" | "CONFIRMED" | "CANCELLED";
  period: string | null;
  fileName: string;
  rows: Record<string, unknown>[];
  errors: { row: number; column?: string; message: string }[];
  summary: {
    totalRows: number;
    validRows: number;
    invalidRows: number;
    existingItems: number;
    newItems: number;
    alreadyImported?: boolean;
    applied?: number;
    skipped?: number;
    warnings?: { row: number; column?: string; message: string }[];
    // Importación de la base de colaboradores
    toUpdate?: number;
    unchanged?: number;
    duplicatesInFile?: number;
    ignoredColumns?: string[];
    supervisorId?: number;
    supervisorName?: string;
    created?: number;
    updated?: number;
    rejected?: number;
  };
  strategy: string;
  createdAt: string;
};

export const PERM = {
  acceder: "novedades.acceder",
  colaboradores: "novedades.colaboradores_gestionar",
  registrar: "novedades.registrar",
  consolidado: "novedades.consolidado_ver",
  historial: "novedades.historial_ver",
  importar: "novedades.importar",
  exportar: "novedades.exportar",
  cerrar: "novedades.cerrar_periodo",
  corregir: "novedades.corregir_cerrado",
  administrar: "novedades.administrar",
  permisos: "novedades.permisos_gestionar",
} as const;

export const STATUS_LABEL: Record<CollaboratorStatus, string> = {
  ACTIVE: "Activo",
  INACTIVE: "Inactivo",
  SUSPENDED: "Suspendido",
};
