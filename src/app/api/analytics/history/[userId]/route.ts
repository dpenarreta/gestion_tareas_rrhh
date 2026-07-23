import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { getVisibleRoles } from "@/lib/roles";
import { getScoreSeries, type AuditKind } from "@/lib/analyticsAuditHistory";

type Ctx = { params: Promise<{ userId: string }> };

const VALID_KINDS: AuditKind[] = ["performance_score", "operational_risk", "health_score"];
const VALID_MONTHS = [1, 3, 6, 12] as const;

/**
 * Sprint A §7 — histórico de evolución con selector de período. Lectura pura
 * sobre `AnalyticsAuditLog` vía `analyticsAuditHistory.ts` (capa complementaria,
 * no el motor) — nunca recalcula un score, solo lee lo que el motor ya
 * persistió en cada corrida.
 */
export async function GET(request: Request, ctx: Ctx) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { userId } = await ctx.params;
  const targetUser = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, role: true } });
  if (!targetUser) return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 });

  const isSelf = session.userId === userId;
  if (!isSelf && !getVisibleRoles(session.role).includes(targetUser.role)) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const kindParam = searchParams.get("kind");
  const monthsParam = Number(searchParams.get("months"));

  const kind = VALID_KINDS.includes(kindParam as AuditKind) ? (kindParam as AuditKind) : "performance_score";
  const months = (VALID_MONTHS as readonly number[]).includes(monthsParam) ? monthsParam : 3;

  const now = new Date();
  const points = await getScoreSeries(userId, kind, now, months * 31);

  return NextResponse.json({ kind, months, points });
}
