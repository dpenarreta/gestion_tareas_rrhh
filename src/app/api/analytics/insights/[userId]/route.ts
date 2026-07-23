import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { getVisibleRoles } from "@/lib/roles";
import { getEffectiveAnalyticsConfig } from "@/lib/systemConfig";
import { cached, runAnalyticsPipeline, computeOperationalRisk, computeMonthlyHistory, ANALYTICS_ENGINE_VERSION } from "@/lib/analytics";
import { computeCapacityForecast } from "@/lib/capacityForecast";
import {
  computeInsights,
  computeIndicatorRelations,
  computePersonalBenchmark,
  computeRecommendationReevaluation,
  prioritizeInsights,
  getScoreTrendExplanation,
  INSIGHTS_ENGINE_VERSION,
} from "@/lib/insightsEngine";

type Ctx = { params: Promise<{ userId: string }> };

/**
 * Sprint 6 — Decision Intelligence Engine. Compone ÚNICAMENTE sobre KPIs ya
 * calculados por el motor central (analytics.ts/capacityForecast.ts): motor
 * de Insights (4 bloques), relaciones entre indicadores, benchmarks contra el
 * propio historial, reevaluación de recomendaciones anteriores y priorización.
 * Mismo patrón de auth/caché que /api/analytics/[userId].
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
  const config = await getEffectiveAnalyticsConfig(now);

  const [{ value: pipeline }, { value: operationalRisk }, capacity, monthly] = await Promise.all([
    cached(`bundle:${userId}`, config.cacheTtlMinutes, () => runAnalyticsPipeline(userId, now)),
    cached(`risk:${userId}`, config.cacheTtlMinutes, () => computeOperationalRisk(userId, now)),
    computeCapacityForecast(userId, now),
    computeMonthlyHistory(userId, 6, now),
  ]);

  const [insights, personalBenchmark, reevaluations, performanceTrendExplained] = await Promise.all([
    computeInsights(userId, now, pipeline, operationalRisk),
    computePersonalBenchmark(userId, pipeline.performanceScore.score, pipeline.dataQuality.pct, now),
    computeRecommendationReevaluation(userId, pipeline.alerts, operationalRisk.score, now),
    getScoreTrendExplanation(userId, "performance_score", pipeline.performanceScore.score, pipeline.performanceScore.factors, now, 30),
  ]);
  const relations = computeIndicatorRelations(monthly, pipeline.consistency, operationalRisk, capacity);
  const prioritized = prioritizeInsights(insights);

  return NextResponse.json({
    insights,
    prioritized,
    relations,
    personalBenchmark,
    reevaluations,
    performanceTrendExplained,
    engineVersion: ANALYTICS_ENGINE_VERSION,
    insightsEngineVersion: INSIGHTS_ENGINE_VERSION,
    lastUpdated: now.toISOString(),
  });
}
