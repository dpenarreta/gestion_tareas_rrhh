import "server-only";
import { djangoApiFetch } from "@/lib/djangoSession";

/**
 * Longitud mínima de contraseña configurable — Fase 61 de la migración de
 * stack (ver docs/AUDIT_LOG.md § 2026-08-25). Lee `GET
 * /settings/seguridad-config/` (Django, `SeguridadConfigView`, completa
 * desde la Fase 32) en vez de `getEffectivePasswordMinLength`
 * (`src/lib/systemConfig.ts`, Prisma). Mismo default que el backend (10,
 * desde la Fase 75) — si Django no está disponible se degrada al default
 * en vez de fallar: el validador real y autoritativo sigue siendo Django
 * (`AUTH_PASSWORD_VALIDATORS`, `MinimumLengthValidator(min_length=10)`,
 * hardcodeado e independiente de este valor) — esta pre-validación en
 * Next.js es solo UX (mensaje de error más específico antes de llamar a
 * Django), nunca la única defensa. El rango configurable en Ajustes tiene
 * un piso de 10 (`seguridad-config/route.ts`) para que ese valor nunca
 * prometa un mínimo más permisivo del que Django realmente aplica.
 */
const DEFAULT_PASSWORD_MIN_LENGTH = 10;

export async function fetchDjangoPasswordMinLength(): Promise<number> {
  const response = await djangoApiFetch("/settings/seguridad-config/");
  if (!response || !response.ok) return DEFAULT_PASSWORD_MIN_LENGTH;
  const data = (await response.json()) as { password_min_length: number };
  return Number.isFinite(data.password_min_length) ? data.password_min_length : DEFAULT_PASSWORD_MIN_LENGTH;
}
