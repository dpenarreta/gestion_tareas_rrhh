// Mapas de configuración visual para PriorityChip/StatusChip (Sprint B — Design
// System). Un mapa por enum real de prisma/schema.prisma: cada dominio conserva
// sus propios valores de negocio, pero el *significado* (urgente, en progreso,
// completado, etc.) siempre usa el mismo tono en toda la plataforma —
// danger = urgente/crítico/cancelado/rechazado; warning = medio/en revisión;
// success = completado/aprobado/bajo riesgo; neutral = pendiente/backlog;
// info = en progreso/activo.

export type ChipTone = "danger" | "warning" | "success" | "neutral" | "info" | "nova";

export type ChipConfig = Record<string, { label: string; tone: ChipTone }>;

// ── Prioridad ────────────────────────────────────────────────────────────────

export const TASK_PRIORITY_CONFIG: ChipConfig = {
  ALTA: { label: "Alta", tone: "danger" },
  MEDIA: { label: "Media", tone: "warning" },
  BAJA: { label: "Baja", tone: "success" },
};

export const REMINDER_PRIORITY_CONFIG: ChipConfig = {
  URGENTE: { label: "Urgente", tone: "danger" },
  ALTA: { label: "Alta", tone: "danger" },
  MEDIA: { label: "Media", tone: "warning" },
  BAJA: { label: "Baja", tone: "success" },
};

export const DESK_NOTE_PRIORITY_CONFIG: ChipConfig = {
  URGENTE: { label: "Urgente", tone: "danger" },
  IMPORTANTE: { label: "Importante", tone: "warning" },
  RECORDATORIO: { label: "Recordatorio", tone: "info" },
  INFORMACION: { label: "Información", tone: "neutral" },
};

export const IDEA_IMPACT_CONFIG: ChipConfig = {
  ALTO: { label: "Alto", tone: "danger" },
  MEDIO: { label: "Medio", tone: "warning" },
  BAJO: { label: "Bajo", tone: "success" },
};

// ── Estado ───────────────────────────────────────────────────────────────────

export const TASK_STATUS_CONFIG: ChipConfig = {
  PENDIENTE: { label: "Pendiente", tone: "neutral" },
  EN_PROGRESO: { label: "En progreso", tone: "info" },
  COMPLETADA: { label: "Completada", tone: "success" },
};

export const PROJECT_STATUS_CONFIG: ChipConfig = {
  PENDIENTE: { label: "Pendiente", tone: "neutral" },
  PLANIFICACION: { label: "Planificación", tone: "neutral" },
  EN_EJECUCION: { label: "En ejecución", tone: "info" },
  EN_REVISION: { label: "En revisión", tone: "warning" },
  SUSPENDIDO: { label: "Suspendido", tone: "warning" },
  COMPLETADO: { label: "Completado", tone: "success" },
  CANCELADO: { label: "Cancelado", tone: "danger" },
};

export const REMINDER_STATUS_CONFIG: ChipConfig = {
  PENDIENTE: { label: "Pendiente", tone: "neutral" },
  COMPLETADO: { label: "Completado", tone: "success" },
};

export const IDEA_STATUS_CONFIG: ChipConfig = {
  PROPUESTA: { label: "Propuesta", tone: "neutral" },
  EN_REVISION: { label: "En revisión", tone: "warning" },
  APROBADA: { label: "Aprobada", tone: "info" },
  EN_DESARROLLO: { label: "En desarrollo", tone: "info" },
  EN_PRUEBAS: { label: "En pruebas", tone: "warning" },
  IMPLEMENTADA: { label: "Implementada", tone: "success" },
  RECHAZADA: { label: "Rechazada", tone: "danger" },
};

export const MEETING_STATUS_CONFIG: ChipConfig = {
  PROGRAMADA: { label: "Programada", tone: "neutral" },
  EN_CURSO: { label: "En curso", tone: "info" },
  FINALIZADA: { label: "Finalizada", tone: "success" },
};

export const DATA_REQUEST_STATUS_CONFIG: ChipConfig = {
  PENDIENTE: { label: "Pendiente", tone: "neutral" },
  EN_PROCESO: { label: "En proceso", tone: "info" },
  RESUELTA: { label: "Resuelta", tone: "success" },
};
