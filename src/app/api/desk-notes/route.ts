import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { canUseDeskNotes } from "@/lib/roles";
import { saveAttachment, AttachmentError } from "@/lib/storage";
import { logDeskAudit } from "@/lib/deskAudit";
import type { DeskNotePriority, DeskNoteColor } from "@/generated/prisma/client";

const VALID_PRIORITIES: DeskNotePriority[] = ["INFORMACION", "RECORDATORIO", "IMPORTANTE", "URGENTE"];
const VALID_COLORS: DeskNoteColor[] = ["AMARILLO", "ROSADO", "CELESTE", "VERDE", "NARANJA", "LILA"];
const MAX_MESSAGE_LENGTH = 500;

type View = "desk" | "archive" | "sent";

const noteSelect = {
  id: true,
  message: true,
  priority: true,
  color: true,
  read: true,
  readAt: true,
  pinned: true,
  archived: true,
  createdAt: true,
  senderId: true,
  sender: { select: { name: true } },
  recipientId: true,
  recipient: { select: { name: true } },
  attachmentName: true,
  attachmentMime: true,
  convertedToTaskId: true,
  convertedAt: true,
} as const;

type NoteRow = {
  id: string;
  message: string;
  priority: DeskNotePriority;
  color: DeskNoteColor;
  read: boolean;
  readAt: Date | null;
  pinned: boolean;
  archived: boolean;
  createdAt: Date;
  senderId: string;
  sender: { name: string };
  recipientId: string;
  recipient: { name: string };
  attachmentName: string | null;
  attachmentMime: string | null;
  convertedToTaskId: string | null;
  convertedAt: Date | null;
};

function serialize(note: NoteRow, currentUserId: string) {
  return {
    id: note.id,
    message: note.message,
    priority: note.priority,
    color: note.color,
    read: note.read,
    readAt: note.readAt ? note.readAt.toISOString() : null,
    pinned: note.pinned,
    archived: note.archived,
    createdAt: note.createdAt.toISOString(),
    senderId: note.senderId,
    senderName: note.sender.name,
    recipientId: note.recipientId,
    recipientName: note.recipient.name,
    isMine: note.senderId === currentUserId,
    hasAttachment: Boolean(note.attachmentName),
    attachmentName: note.attachmentName,
    attachmentMime: note.attachmentMime,
    convertedToTaskId: note.convertedToTaskId,
    convertedAt: note.convertedAt ? note.convertedAt.toISOString() : null,
  };
}

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  if (!canUseDeskNotes(session.role)) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const view = (searchParams.get("view") ?? "desk") as View;
  const limitParam = searchParams.get("limit");
  const limit = limitParam ? Math.max(1, Math.min(100, Number(limitParam))) : undefined;

  const where =
    view === "sent"
      ? { senderId: session.userId, deletedAt: null }
      : view === "archive"
        ? { recipientId: session.userId, archived: true, deletedAt: null }
        : { recipientId: session.userId, archived: false, deletedAt: null };

  const notes = await prisma.deskNote.findMany({
    where,
    select: noteSelect,
    orderBy: [{ pinned: "desc" }, { createdAt: "desc" }],
    ...(limit ? { take: limit } : {}),
  });

  return NextResponse.json(notes.map((n) => serialize(n, session.userId)));
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  if (!canUseDeskNotes(session.role)) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const formData = await request.formData();
  const recipientId = String(formData.get("recipientId") ?? "");
  const message = String(formData.get("message") ?? "").trim();
  const priorityRaw = String(formData.get("priority") ?? "");
  const colorRaw = String(formData.get("color") ?? "");
  const priority = VALID_PRIORITIES.includes(priorityRaw as DeskNotePriority) ? (priorityRaw as DeskNotePriority) : "INFORMACION";
  const color = VALID_COLORS.includes(colorRaw as DeskNoteColor) ? (colorRaw as DeskNoteColor) : "AMARILLO";
  const file = formData.get("file");

  if (!recipientId || !message) {
    return NextResponse.json({ error: "Faltan campos requeridos" }, { status: 400 });
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    return NextResponse.json({ error: `El mensaje no puede superar ${MAX_MESSAGE_LENGTH} caracteres` }, { status: 400 });
  }
  if (recipientId === session.userId) {
    return NextResponse.json({ error: "No puedes dejarte una nota a ti mismo" }, { status: 400 });
  }

  const recipient = await prisma.user.findUnique({ where: { id: recipientId }, select: { id: true, role: true } });
  if (!recipient || recipient.role === "ADMINISTRADOR") {
    return NextResponse.json({ error: "Destinatario inválido" }, { status: 400 });
  }

  let attachmentName: string | null = null;
  let attachmentMime: string | null = null;
  let attachmentData: string | null = null;
  if (file instanceof File && file.size > 0) {
    try {
      const saved = await saveAttachment(file);
      attachmentName = saved.fileName;
      attachmentMime = file.type || "application/octet-stream";
      attachmentData = saved.attachmentData;
    } catch (err) {
      if (err instanceof AttachmentError) {
        return NextResponse.json({ error: err.message }, { status: 400 });
      }
      throw err;
    }
  }

  const note = await prisma.deskNote.create({
    data: { senderId: session.userId, recipientId, message, priority, color, attachmentName, attachmentMime, attachmentData },
    select: noteSelect,
  });

  await prisma.notification.create({
    data: {
      userId: recipientId,
      message: `${session.name} dejó una nota en tu Escritorio Digital`,
    },
  });

  await logDeskAudit({ entityType: "NOTE", entityId: note.id, userId: session.userId, action: "CREATED" });

  return NextResponse.json(serialize(note, session.userId), { status: 201 });
}
