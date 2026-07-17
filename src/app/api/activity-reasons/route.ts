import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";

// Lista completa (activos e inactivos) — cualquier usuario autenticado la
// necesita: el selector de actividades filtra por rol+activo en el cliente,
// y el histórico necesita resolver labels de motivos ya desactivados.
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const reasons = await prisma.activityReason.findMany({
    orderBy: { createdAt: "asc" },
    select: { id: true, key: true, label: true, description: true, isActive: true, assignedRoles: true },
  });
  return NextResponse.json(reasons);
}
