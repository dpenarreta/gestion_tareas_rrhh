export type ProjectStatus =
  | "PENDIENTE"
  | "PLANIFICACION"
  | "EN_EJECUCION"
  | "EN_REVISION"
  | "SUSPENDIDO"
  | "COMPLETADO"
  | "CANCELADO";

export type ProjectPriority = "ALTA" | "MEDIA" | "BAJA";
export type ProjectPhaseStatus = "PENDIENTE" | "EN_PROGRESO" | "COMPLETADA";
export type ProjectDocumentCategory = "PDF" | "EXCEL" | "WORD" | "IMAGEN" | "CORREO" | "ACTA" | "OTRO";

export type ProjectHistoryEvent =
  | "CREADO"
  | "ACTUALIZADO"
  | "PARTICIPANTE_AGREGADO"
  | "PARTICIPANTE_ELIMINADO"
  | "RESPONSABLE_CAMBIADO"
  | "ESTADO_CAMBIADO"
  | "FASE_AGREGADA"
  | "FASE_ACTUALIZADA"
  | "FASE_ELIMINADA"
  | "COMENTARIO_AGREGADO"
  | "ACTIVIDAD_REGISTRADA"
  | "DOCUMENTO_AGREGADO"
  | "ELIMINADO"
  | "RESTAURADO";

export type ProjectUserRef = { id: string; name: string; email?: string; role?: string };

export type ProjectListItem = {
  id: string;
  name: string;
  description: string | null;
  status: ProjectStatus;
  priority: ProjectPriority;
  area: string | null;
  tags: string[];
  startDate: string;
  targetDate: string;
  targetTimeHours: number;
  realHours: number;
  completedAt: string | null;
  responsible: ProjectUserRef;
  createdBy: { id: string; name: string };
  _count: { participants: number; phases: number; comments: number; documents: number };
  createdAt: string;
  updatedAt: string;
};

export type ProjectParticipant = {
  id: string;
  userId: string;
  user: ProjectUserRef;
  addedAt: string;
  addedBy: { id: string; name: string };
};

export type ProjectPhase = {
  id: string;
  name: string;
  status: ProjectPhaseStatus;
  responsible: { id: string; name: string } | null;
  startDate: string | null;
  targetDate: string | null;
  progress: number;
  notes: string | null;
  targetTimeHours: number | null;
  order: number;
};

export type ProjectDetail = Omit<ProjectListItem, "_count"> & {
  observations: string | null;
  participants: ProjectParticipant[];
  phases: ProjectPhase[];
  _count: { comments: number; documents: number; activities: number };
};

export type ProjectActivity = {
  id: string;
  phaseId: string | null;
  description: string;
  comments: string | null;
  time: string | null;
  duration: number;
  isRetroactive: boolean;
  activityDate: string | null;
  author: { id: string; name: string };
  createdAt: string;
};

export type ProjectComment = {
  id: string;
  text: string;
  author: { id: string; name: string; role: string };
  createdAt: string;
};

export type ProjectDocument = {
  id: string;
  category: ProjectDocumentCategory;
  fileName: string;
  mimeType: string | null;
  version: number;
  previousVersionId: string | null;
  activityId: string | null;
  uploadedBy: { id: string; name: string };
  createdAt: string;
};

export type ProjectHistoryEntry = {
  id: string;
  event: ProjectHistoryEvent;
  description: string;
  previousValue: unknown;
  newValue: unknown;
  actor: { id: string; name: string };
  createdAt: string;
};

export const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = {
  PENDIENTE: "Pendiente",
  PLANIFICACION: "Planificación",
  EN_EJECUCION: "En ejecución",
  EN_REVISION: "En revisión",
  SUSPENDIDO: "Suspendido",
  COMPLETADO: "Completado",
  CANCELADO: "Cancelado",
};

export const PROJECT_STATUS_COLOR: Record<ProjectStatus, string> = {
  PENDIENTE: "bg-gray-500/[.12] text-gray-500",
  PLANIFICACION: "bg-sky-500/[.12] text-sky-500",
  EN_EJECUCION: "bg-primary/[.12] text-primary",
  EN_REVISION: "bg-amber-500/[.12] text-amber-500",
  SUSPENDIDO: "bg-warning/[.13] text-warning",
  COMPLETADO: "bg-success/[.13] text-success",
  CANCELADO: "bg-danger/[.12] text-danger",
};

export const PROJECT_PRIORITY_LABEL: Record<ProjectPriority, string> = {
  ALTA: "Alta",
  MEDIA: "Media",
  BAJA: "Baja",
};

export const PHASE_STATUS_LABEL: Record<ProjectPhaseStatus, string> = {
  PENDIENTE: "Pendiente",
  EN_PROGRESO: "En progreso",
  COMPLETADA: "Completada",
};

export const DOCUMENT_CATEGORY_LABEL: Record<ProjectDocumentCategory, string> = {
  PDF: "PDF",
  EXCEL: "Excel",
  WORD: "Word",
  IMAGEN: "Imagen",
  CORREO: "Correo",
  ACTA: "Acta",
  OTRO: "Otro",
};

export const HISTORY_EVENT_LABEL: Record<ProjectHistoryEvent, string> = {
  CREADO: "Proyecto creado",
  ACTUALIZADO: "Proyecto actualizado",
  PARTICIPANTE_AGREGADO: "Participante agregado",
  PARTICIPANTE_ELIMINADO: "Participante eliminado",
  RESPONSABLE_CAMBIADO: "Responsable cambiado",
  ESTADO_CAMBIADO: "Cambio de estado",
  FASE_AGREGADA: "Fase agregada",
  FASE_ACTUALIZADA: "Fase actualizada",
  FASE_ELIMINADA: "Fase eliminada",
  COMENTARIO_AGREGADO: "Comentario",
  ACTIVIDAD_REGISTRADA: "Actividad registrada",
  DOCUMENTO_AGREGADO: "Documento agregado",
  ELIMINADO: "Movido a la papelera",
  RESTAURADO: "Restaurado desde la papelera",
};
