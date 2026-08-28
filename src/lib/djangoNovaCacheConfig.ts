import "server-only";
import { djangoApiFetch } from "@/lib/djangoSession";

/**
 * TTL de caché de mensajes de Nova (Dashboard + Insights) — Fase 59 de la
 * migración de stack (ver docs/AUDIT_LOG.md § 2026-08-25). Lee `GET
 * /settings/nova-cache/` (Django, `NovaCacheView`, completa desde la Fase
 * 34) en vez de `getEffectiveNovaCacheTtlMinutes` (`src/lib/systemConfig.ts`,
 * Prisma). Mismo valor por defecto que el backend (`DEFAULT_NOVA_CACHE_TTL_MINUTES`
 * en ambos lados, 240 minutos) — si Django no está disponible se degrada al
 * default en vez de fallar: es solo la duración de una caché en memoria de
 * Next.js, nunca un dato que pueda romper la generación del mensaje en sí.
 */
const DEFAULT_NOVA_CACHE_TTL_MINUTES = 240;

export async function fetchDjangoNovaCacheTtlMinutes(): Promise<number> {
  const response = await djangoApiFetch("/settings/nova-cache/");
  if (!response || !response.ok) return DEFAULT_NOVA_CACHE_TTL_MINUTES;
  const data = (await response.json()) as { cache_ttl_minutes: number };
  return Number.isFinite(data.cache_ttl_minutes) ? data.cache_ttl_minutes : DEFAULT_NOVA_CACHE_TTL_MINUTES;
}
