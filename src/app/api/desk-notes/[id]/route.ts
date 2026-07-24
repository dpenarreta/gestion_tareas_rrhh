import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { canUseDeskNotes } from "@/lib/roles";
import { logDeskAudit } from "@/lib/deskAudit";
import * as recoveryCenter from "@/lib/recoveryCenter";
import { noteSelect, serializeNote } from "@/lib/deskNotes";
import type { DeskAuditAction } from "@/generated/prisma/client";

type Ctx = { params: Promise<{ id: string }> };

const ACTIONS = ["read", "pin", "unpin", "archive", "unarchive"] as const;
type Action = (typeof ACTIONS)[number];

const ACTION_AUDIT: Record<Action, DeskAuditAction> = {
  read: "READ",
  pin: "PINNED",
  unpin: "UNPINNED",
  archive: "ARCHIVED",
  unarchive: "UNARCHIVED",
};

// Detalle de una nota — usado por el modal de lectura (§1: abrir la tarjeta
// es lo único que marca la nota como leída, ver PATCH más abajo). Accesible
// para cualquiera de los dos participantes de la nota.
export async function GET(_req: NextRequest, ctx: Ctx) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  if (!canUseDeskNotes(session.role)) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const { id } = await ctx.params;
  const note = await prisma.deskNote.findUnique({ where: { id }, select: { ...noteSelect, deletedAt: true } });
  if (!note || note.deletedAt) {
    return NextResponse.json({ error: "Nota no encontrada" }, { status: 404 });
  }
  if (note.senderId !== session.userId && note.recipientId !== session.userId) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  return NextResponse.json(serializeNote(note, session.userId));
}

// El estado de una nota (leída/fijada/archivada) lo controla únicamente quien
// la recibió — es su escritorio. El remitente no puede alterar la copia de
// otro colaborador, solo eliminarla (ver DELETE más abajo).
export async function PATCH(request: NextRequest, ctx: Ctx) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  if (!canUseDeskNotes(session.role)) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const { id } = await ctx.params;
  const body = await request.json().catch(() => null);
  const action = body?.action as Action;
  if (!ACTIONS.includes(action)) {
    return NextResponse.json({ error: "Acción inválida" }, { status: 400 });
  }

  const note = await prisma.deskNote.findUnique({
    where: { id },
    select: { recipientId: true, senderId: true, deletedAt: true, read: true },
  });
  if (!note || note.deletedAt) {
    return NextResponse.json({ error: "Nota no encontrada" }, { status: 404 });
  }
  if (note.recipientId !== session.userId) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }
  // Idempotente: marcar leída una nota ya leída no reescribe readAt ni genera auditoría/notificación duplicada.
  if (action === "read" && note.read) {
    return NextResponse.json({ id, read: true });
  }

  const now = new Date();
  const data =
    action === "read"
      ? { read: true, readAt: now }
      : action === "pin"
        ? { pinned: true }
        : action === "unpin"
          ? { pinned: false }
          : action === "archive"
            ? { archived: true, archivedAt: now }
            : { archived: false, archivedAt: null };

  const updated = await prisma.deskNote.update({ where: { id }, data });
  await logDeskAudit({ entityType: "NOTE", entityId: id, userId: session.userId, action: ACTION_AUDIT[action] });

  // §2 del refinamiento: confirmación de lectura para el remitente, únicamente en la Campana.
  if (action === "read") {
    await prisma.notification.create({
      data: { userId: note.senderId, message: `${session.name} leyó tu Nota Rápida.` },
    });
  }

  return NextResponse.json({ id: updated.id, read: updated.read, pinned: updated.pinned, archived: updated.archived });
}

// Dos vías de eliminación, distintas en actor y mecanismo:
// - El remitente elimina la nota que envió → papelera del Centro de Recuperación
//   (recoveryCenter.moveToTrash), reversible dentro del período de retención.
// - El destinatario elimina definitivamente una nota YA archivada → borrado
//   directo (§7/§8: "Eliminarla definitivamente" desde Archivadas), la misma
//   vía que la purga automática de 15 días usa.
export async function DELETE(_req: NextRequest, ctx: Ctx) {
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
    select: { senderId: true, recipientId: true, archived: true, deletedAt: true },
  });
  if (!note || note.deletedAt) {
    return NextResponse.json({ error: "Nota no encontrada" }, { status: 404 });
  }

  if (note.senderId === session.userId) {
    try {
      await recoveryCenter.moveToTrash({ entityType: "DESK_NOTE", entityId: id, userId: session.userId });
    } catch (err) {
      return NextResponse.json({ error: err instanceof recoveryCenter.RecoveryError ? err.message : "Error al eliminar" }, { status: 409 });
    }
    await logDeskAudit({
      entityType: "NOTE",
      entityId: id,
      userId: session.userId,
      action: "DELETED",
      metadata: { origin: "manual", actor: "sender" },
    });
    return NextResponse.json({ success: true });
  }

  if (note.recipientId === session.userId) {
    if (!note.archived) {
      return NextResponse.json({ error: "Solo puedes eliminar definitivamente una nota ya archivada" }, { status: 409 });
    }
    await prisma.deskNote.delete({ where: { id } });
    await logDeskAudit({
      entityType: "NOTE",
      entityId: id,
      userId: session.userId,
      action: "DELETED",
      metadata: { origin: "manual", actor: "recipient" },
    });
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
}
