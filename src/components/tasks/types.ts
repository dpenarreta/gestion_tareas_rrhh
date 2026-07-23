export type ViewType = "KANBAN" | "TABLA" | "GANTT";
export type TaskStatus = "PENDIENTE" | "EN_PROGRESO" | "COMPLETADA";
export type TaskPriority = "ALTA" | "MEDIA" | "BAJA";
export type TaskFrequency = "MENSUAL" | "SEMANAL" | "DIARIA" | "QUINCENAL" | "PUNTUAL";
export type TaskType = "FIJA" | "SEGUIMIENTO";
// Los motivos son configurables por rol desde Ajustes (modelo ActivityReason en
// BD) — ya no es un enum fijo, solo un identificador (key) libre.
export type ActivityReason = string;

export type TaskUser = {
  id: string;
  name: string;
  email: string;
  role: string;
};

export type TaskComment = {
  id: string;
  text: string;
  author: { id: string; name: string; role: string };
  createdAt: string;
};

export type ActivityComment = {
  id: string;
  text: string;
  author: { id: string; name: string; role: string };
  createdAt: string;
};

export type TaskActivity = {
  id: string;
  reason: ActivityReason;
  startTime: string | null;
  endTime: string | null;
  duration: number;
  description: string | null;
  isRetroactive: boolean;
  activityDate: string | null;
  adminComment: string | null;
  modifiedByAdmin: boolean;
  modifiedAt: string | null;
  author: { id: string; name: string };
  createdAt: string;
  _count: { comments: number };
};

export type Task = {
  id: string;
  title: string;
  description: string | null;
  type: TaskType;
  status: TaskStatus;
  priority: TaskPriority;
  frequency: TaskFrequency;
  startDate: string;
  endDate: string;
  estimatedHours: number;
  realHours: number;
  // Tiempo Objetivo validado (§Sprint 6) — null hasta que un líder autorizado
  // lo valide. Mientras sea null, la referencia oficial sigue siendo
  // estimatedHours (ver src/lib/targetTime.ts § getOfficialTargetTime).
  targetTimeValidated: number | null;
  progress: number;
  color: string | null;
  corrected: boolean;
  assignedTo: TaskUser;
  createdBy: { id: string; name: string };
  _count: { comments: number };
  hasUnreadComments: boolean;
  createdAt: string;
  updatedAt: string;
};

export type AssignableUser = {
  id: string;
  name: string;
  email: string;
  role: string;
};
