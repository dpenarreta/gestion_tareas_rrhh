import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { canViewTeam, getSubordinateRoles } from "@/lib/roles";
import { computeDataQuality } from "@/lib/analytics";

/** Calidad de los datos usados por Analytics — ver § 15. scope=self (cualquier usuario) o scope=team (nivel >= 2, acotado a subordinados). */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const scope = request.nextUrl.searchParams.get("scope") === "team" ? "team" : "self";

  if (scope === "self") {
    const result = await computeDataQuality([session.userId]);
    return NextResponse.json(result);
  }

  if (!canViewTeam(session.role)) return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  const subordinateRoles = getSubordinateRoles(session.role);
  const subordinates = await prisma.user.findMany({ where: { role: { in: subordinateRoles } }, select: { id: true } });
  const result = await computeDataQuality(subordinates.map((s) => s.id));
  return NextResponse.json(result);
}
