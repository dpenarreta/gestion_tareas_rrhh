import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { canUseDeskNotes } from "@/lib/roles";
import { saveAttachment, AttachmentError } from "@/lib/storage";
import { logDeskAudit } from "@/lib/deskAudit";
import { purgeExpiredArchivedNotes } from "@/lib/deskNoteRetention";
import { noteSelect, serializeNote } from "@/lib/deskNotes";
import type { DeskNotePriority, DeskNoteColor } from "@/generated/prisma/client";

const VALID_PRIORITIES: DeskNotePriority[] = ["INFORMACION", "RECORDATORIO", "IMPORTANTE", "URGENTE"];
const VALID_COLORS: DeskNoteColor[] = ["AMARILLO", "ROSADO", "CELESTE", "VERDE", "NARANJA", "LILA"];
const MAX_MESSAGE_LENGTH = 500;

type View = "desk" | "archive" | "sent";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  if (!canUseDeskNotes(session.role)) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  // Barrido perezoso de la retención de 15 días del archivo (§8) — nunca un
  // cron dedicado, mismo criterio que purgeExpiredItems/notifyDueReminders.
  await purgeExpiredArchivedNotes();

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

  return NextResponse.json(notes.map((n) => serializeNote(n, session.userId)));
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

  return NextResponse.json(serializeNote(note, session.userId), { status: 201 });
}
