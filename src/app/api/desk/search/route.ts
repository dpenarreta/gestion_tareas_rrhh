import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { canUseDeskNotes } from "@/lib/roles";
import type { DeskNotePriority, ReminderPriority } from "@/generated/prisma/client";

const NOTE_PRIORITIES: DeskNotePriority[] = ["INFORMACION", "RECORDATORIO", "IMPORTANTE", "URGENTE"];
const REMINDER_PRIORITIES: ReminderPriority[] = ["BAJA", "MEDIA", "ALTA", "URGENTE"];

// Buscador único del Escritorio Digital (§9 del refinamiento 2026-07-23) —
// localiza simultáneamente notas pendientes, archivadas, recordatorios
// activos/completados y comentarios (respuestas de notas), sin que el
// usuario deba cambiar de sección. Los filtros remitente/destinatario solo
// aplican a notas (los recordatorios no tienen ninguno de los dos, son
// personales).
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  if (!canUseDeskNotes(session.role)) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q")?.trim() || "";
  const priority = searchParams.get("priority") || "";
  const date = searchParams.get("date") || "";
  const senderName = searchParams.get("sender")?.trim() || "";
  const recipientName = searchParams.get("recipient")?.trim() || "";
  const status = searchParams.get("status") || ""; // PENDIENTE | LEIDA | ARCHIVADA | COMPLETADO

  const dateRange = date
    ? { gte: new Date(`${date}T00:00:00.000Z`), lte: new Date(`${date}T23:59:59.999Z`) }
    : undefined;

  const notes = await prisma.deskNote.findMany({
    where: {
      deletedAt: null,
      AND: [
        { OR: [{ senderId: session.userId }, { recipientId: session.userId }] },
        ...(q
          ? [{ OR: [{ message: { contains: q, mode: "insensitive" as const } }, { replies: { some: { message: { contains: q, mode: "insensitive" as const } } } }] }]
          : []),
      ],
      ...(NOTE_PRIORITIES.includes(priority as DeskNotePriority) ? { priority: priority as DeskNotePriority } : {}),
      ...(dateRange ? { createdAt: dateRange } : {}),
      ...(senderName ? { sender: { name: { contains: senderName, mode: "insensitive" } } } : {}),
      ...(recipientName ? { recipient: { name: { contains: recipientName, mode: "insensitive" } } } : {}),
      ...(status === "PENDIENTE" ? { read: false, archived: false } : {}),
      ...(status === "LEIDA" ? { read: true, archived: false } : {}),
      ...(status === "ARCHIVADA" ? { archived: true } : {}),
    },
    select: {
      id: true,
      message: true,
      priority: true,
      color: true,
      read: true,
      archived: true,
      createdAt: true,
      senderId: true,
      sender: { select: { name: true } },
      recipientId: true,
      recipient: { select: { name: true } },
      _count: { select: { replies: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  const reminders = await prisma.personalReminder.findMany({
    where: {
      userId: session.userId,
      ...(q ? { OR: [{ title: { contains: q, mode: "insensitive" } }, { description: { contains: q, mode: "insensitive" } }] } : {}),
      ...(REMINDER_PRIORITIES.includes(priority as ReminderPriority) ? { priority: priority as ReminderPriority } : {}),
      ...(dateRange ? { dueAt: dateRange } : {}),
      ...(status === "PENDIENTE" ? { status: "PENDIENTE" } : {}),
      ...(status === "COMPLETADO" ? { status: "COMPLETADO" } : {}),
    },
    select: { id: true, title: true, description: true, dueAt: true, priority: true, status: true },
    orderBy: { dueAt: "desc" },
    take: 50,
  });

  return NextResponse.json({
    notes: notes.map((n) => ({
      id: n.id,
      message: n.message,
      priority: n.priority,
      color: n.color,
      read: n.read,
      archived: n.archived,
      createdAt: n.createdAt.toISOString(),
      senderId: n.senderId,
      senderName: n.sender.name,
      recipientId: n.recipientId,
      recipientName: n.recipient.name,
      isMine: n.senderId === session.userId,
      replyCount: n._count.replies,
    })),
    reminders: reminders.map((r) => ({ ...r, dueAt: r.dueAt.toISOString() })),
  });
}
