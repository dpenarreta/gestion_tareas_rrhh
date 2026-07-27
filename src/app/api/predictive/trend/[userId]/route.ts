import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { getVisibleRoles } from "@/lib/roles";
import { cached } from "@/lib/analytics";
import { getEffectiveAnalyticsConfig } from "@/lib/systemConfig";
import { computeTrendEngine } from "@/lib/trendEngine";

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

  // weeksBack: override opcional para Tendencias Históricas (§Bloque 9), que
  // ofrece ventanas independientes de la configurada globalmente — sin caché
  // (petición interactiva, no repetitiva) para no inflar la clave de caché
  // con una dimensión extra.
  const weeksBackParam = request.nextUrl.searchParams.get("weeksBack");
  const weeksBackOverride = weeksBackParam ? Number(weeksBackParam) : undefined;
  if (weeksBackOverride !== undefined && Number.isFinite(weeksBackOverride) && weeksBackOverride > 0 && weeksBackOverride <= 52) {
    const value = await computeTrendEngine(userId, now, weeksBackOverride);
    return NextResponse.json({ ...value, fromCache: false });
  }

  const config = await getEffectiveAnalyticsConfig(now);
  const { value, fromCache } = await cached(`trend-engine:${userId}`, config.cacheTtlMinutes, () => computeTrendEngine(userId, now));
  return NextResponse.json({ ...value, fromCache });
}
