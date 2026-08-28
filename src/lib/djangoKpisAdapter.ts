import "server-only";

/**
 * Adaptador entre el payload de `GET /api/v1/kpis/me/` y `/kpis/<id>/` de
 * Django (Fase 4b de la migración de stack, ver docs/AUDIT_LOG.md §
 * 2026-08-11) y la forma camelCase que ya esperan
 * `src/components/kpis/**` (sin cambios).
 *
 * A diferencia del resto de los adaptadores (`djangoTasksAdapter.ts`, etc.),
 * este payload es un árbol grande (~10 secciones anidadas, 100+ campos hoja)
 * en el que CADA clave es una traducción 1:1 snake_case→camelCase sin
 * renombres ni reestructuración — verificado campo por campo contra
 * `src/lib/workload.ts`/`riskAlerts.ts`/`priorityCompliance.ts` y las 2
 * rutas legacy durante la investigación de la Fase 4b. Mapear cada campo a
 * mano aquí sería puro boilerplate mecánico sin valor (three-similar-lines
 * ×100) — se usa una transformación recursiva genérica, acotada a este único
 * archivo.
 */

function snakeToCamel(key: string): string {
  return key.replace(/_([a-z0-9])/g, (_, chr: string) => chr.toUpperCase());
}

function deepCamelCase(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(deepCamelCase);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, v]) => [snakeToCamel(key), deepCamelCase(v)]),
    );
  }
  return value;
}

export function mapDjangoKpiPayloadToNexoShape(payload: Record<string, unknown>): Record<string, unknown> {
  return deepCamelCase(payload) as Record<string, unknown>;
}
