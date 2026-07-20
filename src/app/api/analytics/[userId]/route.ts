import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { getVisibleRoles } from "@/lib/roles";
import { getEffectiveAnalyticsConfig } from "@/lib/systemConfig";
import { cached, runAnalyticsPipeline, ANALYTICS_ENGINE_VERSION, FORMULA_SET_VERSION } from "@/lib/analytics";

type Ctx = { params: Promise<{ userId: string }> };

/**
 * Paquete completo de Analytics para UN colaborador (Score de Salud, alertas,
 * tendencias, consistencia, anomalías, predicción, calidad de datos) — un
 * solo fetch para toda la vista individual, cacheado como unidad (ver
 * Analytics § Caché y performance). El cálculo en sí sigue el pipeline único
 * del motor (`runAnalyticsPipeline`, ver Sprint 4 § S4-F) — este endpoint
 * solo autentica, cachea y renderiza (pasos 7-8 del pipeline).
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
  const { value, computedAt, fromCache } = await cached(`bundle:${userId}`, config.cacheTtlMinutes, () => runAnalyticsPipeline(userId));

  // El detalle de la validación de consistencia (§S3-C) solo se expone al
  // Administrador; para cualquier otro viewer se oculta por completo (ya
  // quedó registrado en auditoría dentro del pipeline).
  const { validationFailures, ...bundle } = value;

  return NextResponse.json({
    ...bundle,
    engineVersion: ANALYTICS_ENGINE_VERSION,
    formulaSetVersion: FORMULA_SET_VERSION,
    lastUpdated: new Date(computedAt).toISOString(),
    cacheActive: fromCache,
    ...(session.role === "ADMINISTRADOR" && validationFailures.length > 0 ? { validationWarnings: validationFailures } : {}),
  });
}
