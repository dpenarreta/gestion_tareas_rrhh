import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { canUseDeskNotes } from "@/lib/roles";

type Ctx = { params: Promise<{ id: string }> };

// Trazabilidad visible del recordatorio (§4 Auditoría) — lee DeskAuditLog,
// no duplica ningún dato: la tabla de auditoría ya es la fuente de verdad.
export async function GET(_req: NextRequest, ctx: Ctx) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  if (!canUseDeskNotes(session.role)) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const { id } = await ctx.params;
  const reminder = await prisma.personalReminder.findUnique({ where: { id }, select: { userId: true } });
  if (!reminder || reminder.userId !== session.userId) {
    return NextResponse.json({ error: "Recordatorio no encontrado" }, { status: 404 });
  }

  const events = await prisma.deskAuditLog.findMany({
    where: { entityType: "REMINDER", entityId: id },
    select: { id: true, action: true, metadata: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json(events.map((e) => ({ ...e, createdAt: e.createdAt.toISOString() })));
}
