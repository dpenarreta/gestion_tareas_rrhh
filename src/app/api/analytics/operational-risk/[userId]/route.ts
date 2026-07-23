import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { getVisibleRoles, canViewOperationalRisk } from "@/lib/roles";
import { getEffectiveAnalyticsConfig } from "@/lib/systemConfig";
import { cached, computeOperationalRisk, computeConsistency, computeDataQuality, ANALYTICS_ENGINE_VERSION } from "@/lib/analytics";
import { reliabilityPctFromStars } from "@/lib/analyticsExplain";
import { getScoreTrendExplanation } from "@/lib/insightsEngine";

type Ctx = { params: Promise<{ userId: string }> };

/**
 * Índice de Riesgo Operativo individual — ver Analytics § 13. Visibilidad
 * restringida (gerencia), nunca nivel 1. `confidence` (§Sprint 6.5 S6.5-G) es
 * metadata de PRESENTACIÓN calculada aquí, en la capa de ruta — nunca altera
 * `score`/`classification`/`factors`, que siguen viniendo intactos de
 * `computeOperationalRisk`.
 */
export async function GET(request: Request, ctx: Ctx) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (!canViewOperationalRisk(session.role)) return NextResponse.json({ error: "Sin permisos" }, { status: 403 });

  const { userId } = await ctx.params;
  const targetUser = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, role: true } });
  if (!targetUser) return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 });

  const isSelf = session.userId === userId;
  if (!isSelf && !getVisibleRoles(session.role).includes(targetUser.role)) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const config = await getEffectiveAnalyticsConfig();
  const now = new Date();
  const [{ value, computedAt }, consistency, dataQuality] = await Promise.all([
    cached(`risk:${userId}`, config.cacheTtlMinutes, () => computeOperationalRisk(userId)),
    computeConsistency(userId),
    computeDataQuality([userId]),
  ]);

  const confidence = {
    dataQualityPct: dataQuality.pct,
    reliabilityPct: consistency.available ? reliabilityPctFromStars(consistency.reliability.stars) : 50,
  };

  const trendExplained = await getScoreTrendExplanation(userId, "operational_risk", value.score, value.factors, now, 30);

  return NextResponse.json({ ...value, confidence, trendExplained, engineVersion: ANALYTICS_ENGINE_VERSION, lastUpdated: new Date(computedAt).toISOString() });
}
