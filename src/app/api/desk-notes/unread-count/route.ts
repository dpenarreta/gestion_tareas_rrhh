import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { canUseDeskNotes } from "@/lib/roles";

// Alimenta el punto rojo sobre el ícono de Escritorio Digital en el sidebar
// (§2 del sprint de evolución) — solo desaparece cuando TODAS las notas
// fueron abiertas, nunca por el simple hecho de entrar al módulo.
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  if (!canUseDeskNotes(session.role)) {
    return NextResponse.json({ unread: 0 });
  }

  const unread = await prisma.deskNote.count({
    where: { recipientId: session.userId, read: false, archived: false, deletedAt: null },
  });

  return NextResponse.json({ unread });
}
