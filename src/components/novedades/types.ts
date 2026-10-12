// Formas camelCase que devuelve `/api/novedades/*` (ya adaptadas desde
// Django por `src/lib/djangoNovedadesAdapter.ts`).

export type NovedadesMe = {
  role: string | null;
  permissions: string[];
  isSupervisor: boolean;
  isAssistant: boolean;
  nationalRead: boolean;
  nationalWrite: boolean;
  currentPeriod: { code: string; label: string; status: string | null };
  user: { id: number; name: string };
};

export type PeriodOption = {
  code: string;
  label: string;
  startDate: string;
  endDate: string;
  status: "OPEN" | "CLOSED" | null;
};

export type SupervisorOption = { id: number; name: string };

export type CollaboratorStatus = "ACTIVE" | "INACTIVE" | "SUSPENDED";

export type MatrixColumn = { date: string; day: number; weekday: string; isWeekend: boolean; holiday: string };

export type MatrixCell = { hours: string | null; version: number };

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
  supervisor: { id: number; name: string };
  editable: boolean;
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
  overtimeRecords: number;
  overtimeHours: string;
  saturdayHours: string;
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
  /** "danger" = el evento dejó al colaborador Inactivo o Suspendido (lo decide Django). */
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
