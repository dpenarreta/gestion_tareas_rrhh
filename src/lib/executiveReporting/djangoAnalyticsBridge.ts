// Puente hacia el motor de Analytics de Django para el Executive Reporting
// Engine (Fase 57 de la migración de stack, ver docs/AUDIT_LOG.md §
// 2026-08-25) — recompone el Índice Ejecutivo (Performance Score +
// Equilibrio Operativo por colaborador, mes calendario en curso), que ya
// tiene equivalente exacto en Django desde la Fase 4e/4g/47. El roster de
// `resolveRoster.ts` ya expone el id numérico de Django directo (retiro del
// bridge cuid↔Django, decisión explícita del usuario, ver docs/AUDIT_LOG.md
// § 2026-08-31) — sin traducción intermedia.
import "server-only";
import { djangoApiFetch, ANALYTICS_BUNDLE_TIMEOUT_MS } from "@/lib/djangoSession";
import { mapDjangoAnalyticsPayloadToNexoShape } from "@/lib/djangoAnalyticsAdapter";

export type DjangoPerformanceAndHealth = {
  performanceScore: number;
  healthScore: number;
  healthFactors: { name: string; rawLabel: string }[];
};

/**
 * Bundle de Analytics de Django (`GET /analytics/<id>/`, Fase 4m/47) —
 * reutiliza el mismo endpoint que Nova Insights (Fase 54) en vez de portar
 * `computePerformanceScore`/`computeHealthScore` a Python: ambos valores
 * ya vienen en un único bundle por colaborador, sin necesidad de 2
 * llamadas. `null` si Django no tiene sesión disponible para esta
 * request, o si el colaborador no es visible para el actor — el caller
 * degrada excluyendo a ese miembro del promedio, nunca falla la
 * generación completa del reporte.
 *
 * Gap documentado, no corregido: a diferencia de `computePerformanceScore(id,
 * cutoff)`/`computeHealthScore(id, cutoff)` (que respetaban un
 * `filters.fechaCorte` explícito), `AnalyticsBundleView` siempre calcula
 * contra el instante real (`timezone.now()`) — sin parámetro de corte.
 * Sin efecto en el caso común (esta función solo se llama para el mes
 * calendario EN CURSO, donde `cutoff` ya es ≈ `now` salvo que el caller
 * pase un `fechaCorte` manual explícito — uso excepcional, ver
 * `buildSnapshotData.ts`).
 */
export async function fetchPerformanceAndHealth(djangoId: number): Promise<DjangoPerformanceAndHealth | null> {
  let response;
  try {
    // Timeout dedicado — ver `ANALYTICS_BUNDLE_TIMEOUT_MS` (djangoSession.ts):
    // el default de 3s ya se demostró insuficiente para este endpoint
    // específico. Un timeout que igual ocurre no debe romper la generación
    // completa del reporte (mismo contrato "nunca lanza" documentado arriba).
    response = await djangoApiFetch(`/analytics/${djangoId}/`, {}, ANALYTICS_BUNDLE_TIMEOUT_MS);
  } catch {
    return null;
  }
  if (!response || !response.ok) return null;
  const bundle = mapDjangoAnalyticsPayloadToNexoShape(await response.json()) as {
    performanceScore: { score: number };
    healthScore: { score: number; factors: { name: string; rawLabel: string }[] };
  };
  return {
    performanceScore: bundle.performanceScore.score,
    healthScore: bundle.healthScore.score,
    healthFactors: bundle.healthScore.factors,
  };
}
