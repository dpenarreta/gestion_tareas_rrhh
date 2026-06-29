export type ViewType = "KANBAN" | "TABLA" | "GANTT";
export type TaskStatus = "PENDIENTE" | "EN_PROGRESO" | "COMPLETADA";
export type TaskPriority = "ALTA" | "MEDIA" | "BAJA";
export type TaskFrequency = "MENSUAL" | "SEMANAL" | "DIARIA" | "QUINCENAL" | "PUNTUAL";

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

export type Task = {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  frequency: TaskFrequency;
  startDate: string;
  endDate: string;
  estimatedHours: number;
  realHours: number;
  progress: number;
  assignedTo: TaskUser;
  createdBy: { id: string; name: string };
  _count: { comments: number };
  createdAt: string;
  updatedAt: string;
};

export type AssignableUser = {
  id: string;
  name: string;
  email: string;
  role: string;
};
