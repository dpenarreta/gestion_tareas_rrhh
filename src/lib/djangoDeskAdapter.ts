import "server-only";
import { djangoApiFetch } from "@/lib/djangoSession";
import type { DeskAuditEvent, DeskNote, DeskNoteReply, PersonalReminder, RecipientOption } from "@/components/desk/types";

/**
 * Adaptador entre la forma de Escritorio Digital de Django (Fases 7a-7g de
 * la migración de stack, ver docs/AUDIT_LOG.md § 2026-08-17/18) y
 * `src/components/desk/types.ts` (sin cambios). Mismo patrón que
 * `djangoProjectsAdapter.ts`/`djangoTasksAdapter.ts`.
 */

type DjangoDeskUserRef = { id: number; name: string };
type DjangoDeskRecipient = { id: number; name: string; role: string };

export type DjangoDeskNote = {
  id: number;
  message: string;
  priority: string;
  color: string;
  read: boolean;
  read_at: string | null;
  pinned: boolean;
  archived: boolean;
  archived_at: string | null;
  created_at: string;
  sender: DjangoDeskUserRef;
  recipient: DjangoDeskUserRef;
  is_mine: boolean;
  reply_count: number;
  has_attachment: boolean;
  attachment_name: string | null;
  attachment_mime: string | null;
  converted_to_reminder_id: number | null;
  converted_at: string | null;
};

export type DjangoDeskNoteReply = {
  id: number;
  message: string;
  author: DjangoDeskUserRef;
  created_at: string;
};

export type DjangoPersonalReminder = {
  id: number;
  title: string;
  description: string | null;
  due_at: string;
  priority: string;
  status: string;
  repeat: string;
  completed_at: string | null;
  archived: boolean;
  archived_at: string | null;
  converted_to_task_id: number | null;
  converted_to_task_at: string | null;
  has_attachment: boolean;
  attachment_name: string | null;
  attachment_mime: string | null;
  created_at: string;
};

export type DjangoDeskAuditEvent = {
  id: number;
  action: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

export function mapDjangoDeskNoteToNexoShape(note: DjangoDeskNote): DeskNote {
  return {
    id: String(note.id),
    message: note.message,
    priority: note.priority as DeskNote["priority"],
    color: note.color as DeskNote["color"],
    read: note.read,
    readAt: note.read_at,
    pinned: note.pinned,
    archived: note.archived,
    archivedAt: note.archived_at,
    createdAt: note.created_at,
    senderId: String(note.sender.id),
    senderName: note.sender.name,
    recipientId: String(note.recipient.id),
    recipientName: note.recipient.name,
    isMine: note.is_mine,
    hasAttachment: note.has_attachment,
    attachmentName: note.attachment_name,
    attachmentMime: note.attachment_mime,
    convertedToReminderId: note.converted_to_reminder_id !== null ? String(note.converted_to_reminder_id) : null,
    convertedAt: note.converted_at,
    replyCount: note.reply_count,
  };
}

export function mapDjangoDeskNoteReplyToNexoShape(reply: DjangoDeskNoteReply): DeskNoteReply {
  return {
    id: String(reply.id),
    message: reply.message,
    authorId: String(reply.author.id),
    authorName: reply.author.name,
    createdAt: reply.created_at,
  };
}

export function mapDjangoRecipientToNexoShape(recipient: DjangoDeskRecipient): RecipientOption {
  return { id: String(recipient.id), name: recipient.name, role: recipient.role };
}

export function mapDjangoReminderToNexoShape(reminder: DjangoPersonalReminder): PersonalReminder {
  return {
    id: String(reminder.id),
    title: reminder.title,
    description: reminder.description,
    dueAt: reminder.due_at,
    priority: reminder.priority as PersonalReminder["priority"],
    status: reminder.status as PersonalReminder["status"],
    repeat: reminder.repeat as PersonalReminder["repeat"],
    completedAt: reminder.completed_at,
    archived: reminder.archived,
    attachmentName: reminder.attachment_name,
    attachmentMime: reminder.attachment_mime,
    convertedToTaskId: reminder.converted_to_task_id !== null ? String(reminder.converted_to_task_id) : null,
    convertedToTaskAt: reminder.converted_to_task_at,
    createdAt: reminder.created_at,
  };
}

export function mapDjangoDeskAuditEventToNexoShape(event: DjangoDeskAuditEvent): DeskAuditEvent {
  return {
    id: String(event.id),
    action: event.action as DeskAuditEvent["action"],
    metadata: event.metadata,
    createdAt: event.created_at,
  };
}

/** `null` cuando Django rechaza (404/403/etc — sin cuerpo que distinguir
 * aquí, el llamador usa el status HTTP real) y `"no_session"` cuando no
 * hay sesión Django disponible. */
export async function fetchDjangoDeskNote(id: string): Promise<DjangoDeskNote | null | "no_session"> {
  const response = await djangoApiFetch(`/desk-notes/${id}/`);
  if (!response) return "no_session";
  if (!response.ok) return null;
  return response.json();
}

/** Mismo criterio que `extractDjangoProjectErrorMessage` (`djangoProjectsAdapter.ts`)
 * — primer error de campo del contrato uniforme de Django, con fallback al
 * mensaje genérico si no hay ninguno. */
export async function extractDjangoDeskErrorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const data = await response.json();
    const details = data?.error?.details;
    if (details && typeof details === "object") {
      for (const key of Object.keys(details)) {
        const first = (details as Record<string, unknown>)[key];
        if (Array.isArray(first) && typeof first[0] === "string") return first[0];
      }
    }
    if (typeof data?.error?.message === "string" && data.error.message !== "Error en la solicitud.") {
      return data.error.message;
    }
  } catch {
    // respuesta sin cuerpo JSON — se usa el mensaje por defecto
  }
  return fallback;
}
