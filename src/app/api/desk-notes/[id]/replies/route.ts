import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { canUseDeskNotes } from "@/lib/roles";
import { logDeskAudit } from "@/lib/deskAudit";
import { getEffectiveDeskNoteMaxReplies } from "@/lib/systemConfig";

type Ctx = { params: Promise<{ id: string }> };

const MAX_MESSAGE_LENGTH = 500;

const replySelect = {
  id: true,
  message: true,
  authorId: true,
  author: { select: { name: true } },
  createdAt: true,
} as const;

function serialize(r: { id: string; message: string; authorId: string; author: { name: string }; createdAt: Date }) {
  return { id: r.id, message: r.message, authorId: r.authorId, authorName: r.author.name, createdAt: r.createdAt.toISOString() };
}

export async function GET(_req: NextRequest, ctx: Ctx) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  if (!canUseDeskNotes(session.role)) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const { id } = await ctx.params;
  const note = await prisma.deskNote.findUnique({ where: { id }, select: { senderId: true, recipientId: true, deletedAt: true } });
  if (!note || note.deletedAt) {
    return NextResponse.json({ error: "Nota no encontrada" }, { status: 404 });
  }
  if (note.senderId !== session.userId && note.recipientId !== session.userId) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const replies = await prisma.deskNoteReply.findMany({
    where: { noteId: id },
    select: replySelect,
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json(replies.map(serialize));
}

/**
 * §4 "Respuestas cortas" — máximo 2 respuestas por nota, entre los dos únicos
 * participantes (remitente/destinatario). Deliberadamente NO es un chat: al
 * llegar al límite, la API rechaza con 409 y el mensaje exacto pedido.
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
    select: { senderId: true, recipientId: true, deletedAt: true, _count: { select: { replies: true } } },
  });
  if (!note || note.deletedAt) {
    return NextResponse.json({ error: "Nota no encontrada" }, { status: 404 });
  }
  const otherPartyId = note.senderId === session.userId ? note.recipientId : note.recipientId === session.userId ? note.senderId : null;
  if (otherPartyId === null) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }
  const maxReplies = await getEffectiveDeskNoteMaxReplies();
  if (note._count.replies >= maxReplies) {
    return NextResponse.json({ error: "Esta conversación alcanzó el límite permitido." }, { status: 409 });
  }

  const body = await request.json().catch(() => null);
  const message = typeof body?.message === "string" ? body.message.trim() : "";
  if (!message) {
    return NextResponse.json({ error: "Escribe un mensaje" }, { status: 400 });
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    return NextResponse.json({ error: `El mensaje no puede superar ${MAX_MESSAGE_LENGTH} caracteres` }, { status: 400 });
  }

  const reply = await prisma.deskNoteReply.create({
    data: { noteId: id, authorId: session.userId, message },
    select: replySelect,
  });

  await prisma.notification.create({
    data: { userId: otherPartyId, message: `${session.name} respondió tu Nota Rápida.` },
  });

  await logDeskAudit({ entityType: "NOTE", entityId: id, userId: session.userId, action: "REPLIED" });

  return NextResponse.json(serialize(reply), { status: 201 });
}
