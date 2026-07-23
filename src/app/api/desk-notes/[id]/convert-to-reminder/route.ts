import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { canUseDeskNotes } from "@/lib/roles";
import { logDeskAudit } from "@/lib/deskAudit";
import type { DeskNotePriority, ReminderPriority } from "@/generated/prisma/client";

type Ctx = { params: Promise<{ id: string }> };

const MAX_TITLE_LENGTH = 150;

// Escala de la nota (4 niveles) mapea 1:1 a la escala de recordatorios (4 niveles).
const PRIORITY_MAP: Record<DeskNotePriority, ReminderPriority> = {
  INFORMACION: "BAJA",
  RECORDATORIO: "MEDIA",
  IMPORTANTE: "ALTA",
  URGENTE: "URGENTE",
};

const VALID_PRIORITIES: ReminderPriority[] = ["BAJA", "MEDIA", "ALTA", "URGENTE"];

/**
 * §5 "Convertir en Recordatorio" — completamente opcional. La nota original
 * permanece intacta y visible, solo queda marcada `convertedToReminderId`/
 * `convertedAt`. El adjunto (si existe) se COPIA al recordatorio en vez de
 * referenciarse, para que sobreviva aunque la nota se archive y se purgue
 * a los 15 días (§8) — ver docs/AUDIT_LOG.md.
 */
export async function POST(request: NextRequest, ctx: Ctx) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  if (!canUseDeskNotes(session.role)) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const { id } = await ctx.params;
  const note = await prisma.deskNote.findUnique({
    where: { id },
    select: {
      recipientId: true,
      deletedAt: true,
      message: true,
      priority: true,
      attachmentName: true,
      attachmentMime: true,
      attachmentData: true,
      convertedToReminderId: true,
    },
  });
  if (!note || note.deletedAt) {
    return NextResponse.json({ error: "Nota no encontrada" }, { status: 404 });
  }
  if (note.recipientId !== session.userId) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }
  if (note.convertedToReminderId) {
    return NextResponse.json({ error: "Esta nota ya fue convertida en recordatorio" }, { status: 409 });
  }

  const body = await request.json().catch(() => null);
  const titleRaw = typeof body?.title === "string" ? body.title.trim() : "";
  const title = titleRaw || (note.message.length > MAX_TITLE_LENGTH ? `${note.message.slice(0, MAX_TITLE_LENGTH)}…` : note.message);
  const dueAtRaw = typeof body?.dueAt === "string" ? body.dueAt : "";
  const priority = VALID_PRIORITIES.includes(body?.priority) ? (body.priority as ReminderPriority) : PRIORITY_MAP[note.priority];

  if (!dueAtRaw) {
    return NextResponse.json({ error: "Falta la fecha/hora del recordatorio" }, { status: 400 });
  }
  const dueAt = new Date(dueAtRaw);
  if (Number.isNaN(dueAt.getTime())) {
    return NextResponse.json({ error: "Fecha/hora inválida" }, { status: 400 });
  }

  const reminder = await prisma.personalReminder.create({
    data: {
      userId: session.userId,
      title,
      description: note.message,
      dueAt,
      priority,
      attachmentName: note.attachmentName,
      attachmentMime: note.attachmentMime,
      attachmentData: note.attachmentData,
    },
    select: { id: true, title: true },
  });

  await prisma.deskNote.update({
    where: { id },
    data: { convertedToReminderId: reminder.id, convertedAt: new Date() },
  });

  await logDeskAudit({
    entityType: "NOTE",
    entityId: id,
    userId: session.userId,
    action: "CONVERTED_TO_REMINDER",
    metadata: { reminderId: reminder.id },
  });
  await logDeskAudit({
    entityType: "REMINDER",
    entityId: reminder.id,
    userId: session.userId,
    action: "CREATED",
    metadata: { convertedFromNoteId: id },
  });

  return NextResponse.json({ reminderId: reminder.id, reminderTitle: reminder.title }, { status: 201 });
}
