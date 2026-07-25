import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { getVisibleRoles } from "@/lib/roles";
import { getEffectiveAnalyticsConfig } from "@/lib/systemConfig";
import {
  cached,
  computeHealthScore,
  computeConsistency,
  computeDataQuality,
  classifyEstadoOperativo,
  ESCALA_INTERPRETACION_EQUILIBRIO,
  ANALYTICS_ENGINE_VERSION,
  FORMULA_SET_VERSION,
} from "@/lib/analytics";
import { reliabilityPctFromStars, derivedNormalizedValue } from "@/lib/analyticsExplain";
import {
  computeConfidence,
  computeEquilibrioInsights,
  explainEquilibrioMeaning,
  explainEquilibrioImpact,
  explainEquilibrioFactor,
  getScoreTrendExplanation,
  INSIGHTS_ENGINE_VERSION,
} from "@/lib/insightsEngine";

type Ctx = { params: Promise<{ userId: string }> };

/**
 * Sprint Analytics 2.0 — capa de interpretación de Equilibrio Operativo
 * (antes "Score de Salud Laboral"). Nunca recalcula el score en sí
 * (`computeHealthScore`, sin tocar salvo la curva de Capacidad Futura del
 * Bloque 9) — solo compone estado/tendencia/insights/calidad encima, mismo
 * patrón que `/api/analytics/operational-risk/[userId]` y
 * `/api/analytics/insights/[userId]`.
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

  const config = await getEffectiveAnalyticsConfig();
  const now = new Date();

  // Bloque 14 — tiempo de procesamiento real de este cálculo específico.
  const startedAt = Date.now();
  const [{ value, computedAt, fromCache }, consistency, dataQuality] = await Promise.all([
    cached(`equilibrio:${userId}`, config.cacheTtlMinutes, () => computeHealthScore(userId, now)),
    computeConsistency(userId, now),
    computeDataQuality([userId]),
  ]);
  const tiempoCalculoMs = Date.now() - startedAt;

  const estado = classifyEstadoOperativo(value.score);
  const trend = await getScoreTrendExplanation(userId, "health_score", value.score, value.factors, now, 30);

  const confidence = computeConfidence({
    observations: consistency.available ? consistency.weeksAnalyzed : 2,
    dataQualityPct: dataQuality.pct,
    consistent: consistency.available ? consistency.level === "muy-consistente" || consistency.level === "consistente" : null,
  });

  const insights = computeEquilibrioInsights(value, confidence);
  // Bloque 4 — cada dimensión con su explicación, no solo las que llegan a
  // generar un Insight (Alto/Bajo) — "Medio" también debe explicarse.
  const dimensiones = value.factors.map((f) => {
    const normalizedValue = derivedNormalizedValue(f.points, f.weight);
    return { ...f, normalizedValue, explicacion: explainEquilibrioFactor(f.name, normalizedValue) };
  });
  const meaning = explainEquilibrioMeaning(estado, trend);
  const impact = explainEquilibrioImpact(estado);
  const strengths = insights.filter((i) => i.tone === "positive");
  const weaknesses = insights.filter((i) => i.tone === "risk");
  const recommendations = weaknesses.map((i) => i.accion).filter((a): a is NonNullable<typeof a> => a !== null);

  // Bloque 14 — advertencias estructurales conocidas (no la validación
  // completa del pipeline, que recalcularía todo el bundle innecesariamente
  // solo para este indicador).
  const advertencias: string[] = [];
  if (!consistency.available) advertencias.push("Consistencia sin historial suficiente — se usó un valor neutro (70/100) en esa dimensión.");

  return NextResponse.json({
    healthScore: value,
    dimensiones,
    estado,
    escala: ESCALA_INTERPRETACION_EQUILIBRIO,
    trend,
    meaning,
    impact,
    strengths,
    weaknesses,
    recommendations,
    confidence: { dataQualityPct: dataQuality.pct, reliabilityPct: consistency.available ? reliabilityPctFromStars(consistency.reliability.stars) : 50 },
    calidad: {
      engineVersion: ANALYTICS_ENGINE_VERSION,
      formulaSetVersion: FORMULA_SET_VERSION,
      insightsEngineVersion: INSIGHTS_ENGINE_VERSION,
      fecha: new Date(computedAt).toISOString(),
      origen: "Tareas del mes en curso, carga horaria, consistencia semanal y capacidad proyectada",
      cacheActive: fromCache,
      tiempoCalculoMs,
      registrosUtilizados: { semanasConsistencia: consistency.available ? consistency.weeksAnalyzed : 0, diasConsistencia: consistency.available ? consistency.daysAnalyzed : 0 },
      registrosDescartados: consistency.available ? consistency.explain.periodsExcluded : [],
      advertencias,
    },
  });
}
