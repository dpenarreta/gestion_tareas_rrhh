import "server-only";
import type { ReminderPriority, ReminderStatus, ReminderRepeat } from "@/generated/prisma/client";

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
