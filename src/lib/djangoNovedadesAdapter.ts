import "server-only";

/**
 * Adaptador del módulo Control Operativo de Novedades
 * (`/api/v1/novedades/`, `backend/apps/novedades`).
 *
 * Los payloads son mecánicos (sin renombres): snake_case→camelCase en las
 * respuestas y camelCase→snake_case en los cuerpos que se envían — mismo
 * criterio genérico que `djangoAnalyticsAdapter.ts`. Las claves que son
 * fechas ISO (las celdas de Días laborados, `"2026-10-12"`) no tienen guion
 * bajo, así que la conversión las deja intactas.
 */

function snakeToCamel(key: string): string {
  return key.replace(/_([a-z0-9])/g, (_, chr: string) => chr.toUpperCase());
}

function camelToSnake(key: string): string {
  return key.replace(/[A-Z]/g, (chr) => `_${chr.toLowerCase()}`);
}

function deepMapKeys(value: unknown, mapKey: (key: string) => string): unknown {
  if (Array.isArray(value)) return value.map((v) => deepMapKeys(v, mapKey));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, v]) => [mapKey(key), deepMapKeys(v, mapKey)]),
    );
  }
  return value;
}

export function mapDjangoNovedadesPayloadToNexoShape(payload: unknown): unknown {
  return deepMapKeys(payload, snakeToCamel);
}

export function mapNexoNovedadesBodyToDjango(body: unknown): unknown {
  return deepMapKeys(body, camelToSnake);
}

type DjangoErrorBody = { error?: { code?: string; message?: string; details?: unknown } | string };

/** Contrato uniforme de error de Django → `{ error, code, details }` plano. */
export function mapDjangoNovedadesError(body: unknown, fallback: string) {
  const error = (body as DjangoErrorBody | null)?.error;
  if (typeof error === "string") return { error, code: undefined, details: undefined };
  return {
    error: error?.message ?? fallback,
    code: error?.code,
    details: error?.details ? mapDjangoNovedadesPayloadToNexoShape(error.details) : undefined,
  };
}
