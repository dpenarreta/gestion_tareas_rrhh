import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { getVisibleRoles } from "@/lib/roles";
import { cached } from "@/lib/analytics";
import { getEffectiveAnalyticsConfig } from "@/lib/systemConfig";
import { computePreventiveAlerts } from "@/lib/preventiveIntelligence";

type Ctx = { params: Promise<{ userId: string }> };

export async function GET(request: NextRequest, ctx: Ctx) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const { userId } = await ctx.params;

  if (session.userId !== userId) {
    const target = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
    if (!target || !getVisibleRoles(session.role).includes(target.role)) {
      return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
    }
  }

  const now = new Date();
  const config = await getEffectiveAnalyticsConfig(now);
  const { value, fromCache } = await cached(`preventive-alerts:${userId}`, config.cacheTtlMinutes, () => computePreventiveAlerts(userId, now));
  return NextResponse.json({ alerts: value, fromCache });
}
