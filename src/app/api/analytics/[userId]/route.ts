import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { getVisibleRoles } from "@/lib/roles";
import { getEffectiveAnalyticsConfig } from "@/lib/systemConfig";
import {
  cached,
  computeHealthScore,
  computeAlerts,
  computeTrends,
  computeConsistency,
  detectAnomalies,
  computePrediction,
  computeDataQuality,
  ANALYTICS_ENGINE_VERSION,
} from "@/lib/analytics";

type Ctx = { params: Promise<{ userId: string }> };

/**
 * Paquete completo de Analytics para UN colaborador (Score de Salud, alertas,
 * tendencias, consistencia, anomalías, predicción, calidad de datos) — un
 * solo fetch para toda la vista individual, cacheado como unidad (ver
 * Analytics § Caché y performance).
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
  const { value, computedAt } = await cached(`bundle:${userId}`, config.cacheTtlMinutes, async () => {
    const [healthScore, alerts, trends, consistency, anomalies, prediction, dataQuality] = await Promise.all([
      computeHealthScore(userId),
      computeAlerts(userId),
      computeTrends(userId),
      computeConsistency(userId),
      detectAnomalies(userId),
      computePrediction(userId),
      computeDataQuality([userId]),
    ]);
    return { healthScore, alerts, trends, consistency, anomalies, prediction, dataQuality };
  });

  return NextResponse.json({ ...value, engineVersion: ANALYTICS_ENGINE_VERSION, lastUpdated: new Date(computedAt).toISOString() });
}
