import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { getVisibleRoles } from "@/lib/roles";
import {
  computeBenchmark,
  computePerformanceScore,
  computeOperationalRisk,
  getScoreTrendHistory,
} from "@/lib/analytics";

type Ctx = { params: Promise<{ userId: string }> };

/**
 * Benchmarks (§Sprint 5 S5-H) y tendencias de score (§S5-I) para Performance
 * Score y Operational Risk — comparación contra pares del mismo rol +
 * variación vs semana/mes/promedio 6 meses. Respeta los mismos permisos que
 * el resto de Analytics: propio usuario o gerencia con visibilidad sobre el rol.
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

  const now = new Date();
  const [benchmark, performanceScore, operationalRisk] = await Promise.all([
    computeBenchmark(userId, targetUser.role, now),
    computePerformanceScore(userId, now),
    computeOperationalRisk(userId, now),
  ]);

  const [performanceTrend, riskTrend] = await Promise.all([
    getScoreTrendHistory(userId, "performance_score", performanceScore.score, true, now),
    getScoreTrendHistory(userId, "operational_risk", operationalRisk.score, false, now),
  ]);

  return NextResponse.json({
    benchmark,
    trends: { performance: performanceTrend, operationalRisk: riskTrend },
  });
}
