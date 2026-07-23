import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { canUseDeskNotes } from "@/lib/roles";
import * as recoveryCenter from "@/lib/recoveryCenter";

type Ctx = { params: Promise<{ id: string }> };

const ACTIONS = ["read", "pin", "unpin", "archive", "unarchive"] as const;
type Action = (typeof ACTIONS)[number];

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

  const note = await prisma.deskNote.findUnique({ where: { id }, select: { recipientId: true, deletedAt: true } });
  if (!note || note.deletedAt) {
    return NextResponse.json({ error: "Nota no encontrada" }, { status: 404 });
  }
  if (note.recipientId !== session.userId) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
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
  return NextResponse.json({ id: updated.id, read: updated.read, pinned: updated.pinned, archived: updated.archived });
}

// Solo el remitente puede eliminar la nota que creó. Va a la papelera del
// Centro de Recuperación (recoveryCenter.moveToTrash), nunca un borrado
// directo — mismo mecanismo que Proyectos.
export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  if (!canUseDeskNotes(session.role)) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const { id } = await ctx.params;
  const note = await prisma.deskNote.findUnique({ where: { id }, select: { senderId: true, deletedAt: true } });
  if (!note || note.deletedAt) {
    return NextResponse.json({ error: "Nota no encontrada" }, { status: 404 });
  }
  if (note.senderId !== session.userId) {
    return NextResponse.json({ error: "Solo quien creó la nota puede eliminarla" }, { status: 403 });
  }

  try {
    await recoveryCenter.moveToTrash({ entityType: "DESK_NOTE", entityId: id, userId: session.userId });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Error al eliminar" }, { status: 409 });
  }

  return NextResponse.json({ success: true });
}
