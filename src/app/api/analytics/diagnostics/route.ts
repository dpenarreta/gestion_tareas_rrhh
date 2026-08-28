import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { getDiagnosticsSnapshot, ANALYTICS_ENGINE_VERSION, FORMULA_SET_VERSION, FORMULA_VERSIONS, KPI_PRIORITY } from "@/lib/analytics";
import { getAllFeatureFlags } from "@/lib/featureFlags";
import { fetchDjangoAnalyticsDiagnostics } from "@/lib/djangoAnalyticsDiagnosticsAdapter";

const DJANGO_SESSION_REQUIRED_MESSAGE =
  "Tu sesión no tiene aún acceso a este módulo. Cierra sesión y volvé a iniciar sesión.";

/**
 * Diagnóstico del motor de Analytics (§S3-D) — solo Administrador. Combina
 * contadores en memoria del proceso (caché/validaciones, ver `cached()` y los
 * `validate*Consistency` en analytics.ts, intrínsecamente proceso-local, sin
 * equivalente Django) con la calidad de datos global y el versionado del
 * motor, portados a Django en la Fase 88 (ver docs/AUDIT_LOG.md §
 * 2026-08-28) — antes recalculados acá contra Prisma directo.
 */
export async function GET() {
  const startedAt = Date.now();
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (session.role !== "ADMINISTRADOR") return NextResponse.json({ error: "Sin permisos" }, { status: 403 });

  const diagnostics = await fetchDjangoAnalyticsDiagnostics(ANALYTICS_ENGINE_VERSION);
  if (!diagnostics) return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });

  const snapshot = getDiagnosticsSnapshot();
  const requestMs = Date.now() - startedAt;

  return NextResponse.json({
    kpisCalculados: snapshot.cacheHits + snapshot.cacheMisses,
    kpisDesdeCache: snapshot.cacheHits,
    kpisRecalculados: snapshot.cacheMisses,
    tiempoCalculoTotalMs: snapshot.totalComputeMs,
    validacionesEjecutadas: snapshot.validationsRun,
    validacionesFallidas: snapshot.validationsFailed,
    calidadGlobalDatos: diagnostics.data_quality_pct,
    tiempoRenderizadoMs: requestMs,
    engineVersion: ANALYTICS_ENGINE_VERSION,
    formulaSetVersion: FORMULA_SET_VERSION,
    formulaVersions: FORMULA_VERSIONS,
    kpiPriority: KPI_PRIORITY,
    featureFlags: getAllFeatureFlags(),
    versionChange: { previousVersion: diagnostics.version_change.previous_version, changed: diagnostics.version_change.changed },
    serverStartedAt: new Date(snapshot.serverStartedAt).toISOString(),
    ultimaActualizacion: new Date().toISOString(),
  });
}
