import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { canUseDeskNotes } from "@/lib/roles";

// Destinatarios válidos para una nota nueva: cualquier colaborador
// no-Administrador salvo uno mismo. A propósito NO se filtra por jerarquía
// (VISIBLE_ROLES) — el Escritorio Digital simula un escritorio físico
// compartido, no un canal jerárquico.
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  if (!canUseDeskNotes(session.role)) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const users = await prisma.user.findMany({
    where: { role: { not: "ADMINISTRADOR" }, id: { not: session.userId } },
    select: { id: true, name: true, role: true },
    orderBy: { name: "asc" },
  });

  return NextResponse.json(users);
}
