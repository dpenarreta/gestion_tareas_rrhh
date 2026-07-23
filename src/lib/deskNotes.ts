import "server-only";
import type { DeskNotePriority, DeskNoteColor } from "@/generated/prisma/client";

// Compartido entre las rutas de /api/desk-notes — un route.ts de Next.js solo
// puede exportar handlers HTTP y un puñado de config reconocida, así que
// estos helpers viven aquí en vez de reexportarse desde route.ts.
export const noteSelect = {
  id: true,
  message: true,
  priority: true,
  color: true,
  read: true,
  readAt: true,
  pinned: true,
  archived: true,
  archivedAt: true,
  createdAt: true,
  senderId: true,
  sender: { select: { name: true } },
  recipientId: true,
  recipient: { select: { name: true } },
  attachmentName: true,
  attachmentMime: true,
  convertedToReminderId: true,
  convertedAt: true,
  _count: { select: { replies: true } },
} as const;

export type NoteRow = {
  id: string;
  message: string;
  priority: DeskNotePriority;
  color: DeskNoteColor;
  read: boolean;
  readAt: Date | null;
  pinned: boolean;
  archived: boolean;
  archivedAt: Date | null;
  createdAt: Date;
  senderId: string;
  sender: { name: string };
  recipientId: string;
  recipient: { name: string };
  attachmentName: string | null;
  attachmentMime: string | null;
  convertedToReminderId: string | null;
  convertedAt: Date | null;
  _count: { replies: number };
};

export function serializeNote(note: NoteRow, currentUserId: string) {
  return {
    id: note.id,
    message: note.message,
    priority: note.priority,
    color: note.color,
    read: note.read,
    readAt: note.readAt ? note.readAt.toISOString() : null,
    pinned: note.pinned,
    archived: note.archived,
    archivedAt: note.archivedAt ? note.archivedAt.toISOString() : null,
    createdAt: note.createdAt.toISOString(),
    senderId: note.senderId,
    senderName: note.sender.name,
    recipientId: note.recipientId,
    recipientName: note.recipient.name,
    isMine: note.senderId === currentUserId,
    hasAttachment: Boolean(note.attachmentName),
    attachmentName: note.attachmentName,
    attachmentMime: note.attachmentMime,
    convertedToReminderId: note.convertedToReminderId,
    convertedAt: note.convertedAt ? note.convertedAt.toISOString() : null,
    replyCount: note._count.replies,
  };
}
