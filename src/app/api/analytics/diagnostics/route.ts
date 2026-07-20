import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { computeDataQuality, getDiagnosticsSnapshot, ANALYTICS_ENGINE_VERSION, FORMULA_SET_VERSION, FORMULA_VERSIONS, KPI_PRIORITY } from "@/lib/analytics";
import { getAllFeatureFlags } from "@/lib/featureFlags";
import { recordEngineVersionIfChanged } from "@/lib/systemConfig";

/**
 * Diagnóstico del motor de Analytics (§S3-D) — solo Administrador. Combina
 * contadores en memoria del proceso (caché/validaciones, ver `cached()` y los
 * `validate*Consistency` en analytics.ts) con la calidad de datos global
 * recalculada en vivo para este reporte.
 */
export async function GET() {
  const startedAt = Date.now();
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (session.role !== "ADMINISTRADOR") return NextResponse.json({ error: "Sin permisos" }, { status: 403 });

  const allUsers = await prisma.user.findMany({ select: { id: true } });
  const dataQuality = await computeDataQuality(allUsers.map((u) => u.id));

  // Versionado del motor (§Sprint 5 S5-L) — se compara perezosamente contra la
  // versión vigente del código; si cambió desde la última vez que un
  // Administrador abrió este panel, se registra el cambio (fecha/usuario/
  // versión anterior/nueva) vía el mismo historial de SystemConfigHistory.
  const versionChange = await recordEngineVersionIfChanged(ANALYTICS_ENGINE_VERSION, session.userId);

  const snapshot = getDiagnosticsSnapshot();
  const requestMs = Date.now() - startedAt;

  return NextResponse.json({
    kpisCalculados: snapshot.cacheHits + snapshot.cacheMisses,
    kpisDesdeCache: snapshot.cacheHits,
    kpisRecalculados: snapshot.cacheMisses,
    tiempoCalculoTotalMs: snapshot.totalComputeMs,
    validacionesEjecutadas: snapshot.validationsRun,
    validacionesFallidas: snapshot.validationsFailed,
    calidadGlobalDatos: dataQuality.pct,
    tiempoRenderizadoMs: requestMs,
    engineVersion: ANALYTICS_ENGINE_VERSION,
    formulaSetVersion: FORMULA_SET_VERSION,
    formulaVersions: FORMULA_VERSIONS,
    kpiPriority: KPI_PRIORITY,
    featureFlags: getAllFeatureFlags(),
    versionChange,
    serverStartedAt: new Date(snapshot.serverStartedAt).toISOString(),
    ultimaActualizacion: new Date().toISOString(),
  });
}
