import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { canUseDeskNotes } from "@/lib/roles";

type Ctx = { params: Promise<{ id: string }> };

// Trazabilidad visible de la nota (§10 Auditoría) — lee DeskAuditLog, no
// duplica ningún dato. Accesible para cualquiera de los dos participantes.
export async function GET(_req: NextRequest, ctx: Ctx) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  if (!canUseDeskNotes(session.role)) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const { id } = await ctx.params;
  const note = await prisma.deskNote.findUnique({ where: { id }, select: { senderId: true, recipientId: true } });
  if (!note) {
    return NextResponse.json({ error: "Nota no encontrada" }, { status: 404 });
  }
  if (note.senderId !== session.userId && note.recipientId !== session.userId) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const events = await prisma.deskAuditLog.findMany({
    where: { entityType: "NOTE", entityId: id },
    select: { id: true, action: true, metadata: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json(events.map((e) => ({ ...e, createdAt: e.createdAt.toISOString() })));
}
