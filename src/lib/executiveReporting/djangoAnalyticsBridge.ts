// Puente hacia el motor de Analytics de Django para el Executive Reporting
// Engine (Fase 57 de la migración de stack, ver docs/AUDIT_LOG.md §
// 2026-08-25) — primer paso de portar el CÁLCULO del snapshot (hasta acá
// solo se había portado la PERSISTENCIA, Fase 56). El resto de
// `buildSnapshotData.ts` sigue contra Prisma sin cambios: este módulo
// recompone únicamente el Índice Ejecutivo (Performance Score + Equilibrio
// Operativo por colaborador, mes calendario en curso), que ya tiene
// equivalente exacto en Django desde la Fase 4e/4g/47 — no requirió portar
// ninguna fórmula nueva.
import "server-only";
import { djangoApiFetch } from "@/lib/djangoSession";
import { mapDjangoAnalyticsPayloadToNexoShape } from "@/lib/djangoAnalyticsAdapter";

/**
 * Resuelve el id numérico de Django de cada colaborador del roster a
 * partir de su `legacy_postgres_id` (cuid) — `GET /reports/user-lookup/`
 * (backend, Fase 57). El resto del builder sigue necesitando el cuid
 * (consultas Prisma de Tareas/Actividades), así que este puente NO
 * reemplaza `resolveReportRoster`, solo lo complementa para los cálculos
 * que sí ya viven en Django. Usuarios sin id de Django resuelto (nunca
 * importados desde Postgres — `migrate_users_from_postgres` diferido,
 * ver `docs/ROADMAP.md`) simplemente no aparecen en el Map devuelto.
 */
export async function resolveDjangoIdsForRoster(userIds: string[]): Promise<Map<string, number>> {
  if (userIds.length === 0) return new Map();
  const response = await djangoApiFetch(`/reports/user-lookup/?legacy_ids=${encodeURIComponent(userIds.join(","))}`);
  if (!response || !response.ok) return new Map();
  const rows = (await response.json()) as { legacy_postgres_id: string; id: number }[];
  return new Map(rows.map((r) => [r.legacy_postgres_id, r.id]));
}

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
  const response = await djangoApiFetch(`/analytics/${djangoId}/`);
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
