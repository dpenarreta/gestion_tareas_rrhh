import "server-only";

// Cutover de stack — Fase 90 (ver docs/AUDIT_LOG.md § 2026-08-28): ya no se
// importan del cliente Prisma generado (retirado del repo) — mismos
// valores que `prisma/schema.prisma` tenía, réplica exacta de
// `PersonalReminder.priority`/`.status`/`.repeat` (Django).
export type ReminderPriority = "BAJA" | "MEDIA" | "ALTA" | "URGENTE";
export type ReminderStatus = "PENDIENTE" | "COMPLETADO";
export type ReminderRepeat = "UNA_VEZ" | "DIARIO" | "SEMANAL" | "MENSUAL";

// Compartido entre las rutas de /api/desk-reminders.
export const reminderSelect = {
  id: true,
  title: true,
  description: true,
  dueAt: true,
  priority: true,
  status: true,
  repeat: true,
  completedAt: true,
  archived: true,
  attachmentName: true,
  attachmentMime: true,
  convertedToTaskId: true,
  convertedToTaskAt: true,
  createdAt: true,
} as const;

export type ReminderRow = {
  id: string;
  title: string;
  description: string | null;
  dueAt: Date;
  priority: ReminderPriority;
  status: ReminderStatus;
  repeat: ReminderRepeat;
  completedAt: Date | null;
  archived: boolean;
  attachmentName: string | null;
  attachmentMime: string | null;
  convertedToTaskId: string | null;
  convertedToTaskAt: Date | null;
  createdAt: Date;
};

export function serializeReminder(r: ReminderRow) {
  return {
    ...r,
    dueAt: r.dueAt.toISOString(),
    completedAt: r.completedAt ? r.completedAt.toISOString() : null,
    convertedToTaskAt: r.convertedToTaskAt ? r.convertedToTaskAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
  };
}
