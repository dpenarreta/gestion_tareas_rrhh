import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { getVisibleRoles } from "@/lib/roles";
import { getEffectiveAnalyticsConfig } from "@/lib/systemConfig";
import { cached, computeTargetTimePrecision, ANALYTICS_ENGINE_VERSION } from "@/lib/analytics";

type Ctx = { params: Promise<{ userId: string }> };

/** Precisión del Tiempo Objetivo (§Sprint 6 S6-F) — nuevo KPI, no reemplaza ningún indicador existente. */
export async function GET(_req: Request, ctx: Ctx) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { userId } = await ctx.params;
  const targetUser = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, role: true } });
  if (!targetUser) return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 });

  const isSelf = session.userId === userId;
  if (!isSelf && !getVisibleRoles(session.role).includes(targetUser.role)) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const config = await getEffectiveAnalyticsConfig();
  const { value, computedAt } = await cached(`target-time-precision:${userId}`, config.cacheTtlMinutes, () => computeTargetTimePrecision(userId));

  return NextResponse.json({ ...value, engineVersion: ANALYTICS_ENGINE_VERSION, lastUpdated: new Date(computedAt).toISOString() });
}
