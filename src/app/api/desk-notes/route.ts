import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { canUseDeskNotes } from "@/lib/roles";
import type { DeskNotePriority } from "@/generated/prisma/client";

const VALID_PRIORITIES: DeskNotePriority[] = ["INFORMACION", "RECORDATORIO", "IMPORTANTE", "URGENTE"];
const MAX_MESSAGE_LENGTH = 500;

type View = "desk" | "archive" | "sent";

const noteSelect = {
  id: true,
  message: true,
  priority: true,
  read: true,
  pinned: true,
  archived: true,
  createdAt: true,
  senderId: true,
  sender: { select: { name: true } },
  recipientId: true,
  recipient: { select: { name: true } },
} as const;

function serialize(note: {
  id: string;
  message: string;
  priority: DeskNotePriority;
  read: boolean;
  pinned: boolean;
  archived: boolean;
  createdAt: Date;
  senderId: string;
  sender: { name: string };
  recipientId: string;
  recipient: { name: string };
}, currentUserId: string) {
  return {
    id: note.id,
    message: note.message,
    priority: note.priority,
    read: note.read,
    pinned: note.pinned,
    archived: note.archived,
    createdAt: note.createdAt.toISOString(),
    senderId: note.senderId,
    senderName: note.sender.name,
    recipientId: note.recipientId,
    recipientName: note.recipient.name,
    isMine: note.senderId === currentUserId,
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

  const body = await request.json().catch(() => null);
  const recipientId = typeof body?.recipientId === "string" ? body.recipientId : "";
  const message = typeof body?.message === "string" ? body.message.trim() : "";
  const priority = VALID_PRIORITIES.includes(body?.priority) ? (body.priority as DeskNotePriority) : "INFORMACION";

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

  const note = await prisma.deskNote.create({
    data: { senderId: session.userId, recipientId, message, priority },
    select: noteSelect,
  });

  await prisma.notification.create({
    data: {
      userId: recipientId,
      message: `${session.name} dejó una nota en tu Escritorio Digital`,
    },
  });

  return NextResponse.json(serialize(note, session.userId), { status: 201 });
}
