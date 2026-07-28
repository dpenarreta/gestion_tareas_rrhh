import "server-only";
import { prisma } from "@/lib/prisma";
import { getEffectiveRetentionLoginAttempts } from "@/lib/systemConfig";

const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;

export async function isRateLimited(ip: string): Promise<boolean> {
  const record = await prisma.loginAttempt.findUnique({ where: { ip } });
  if (!record) return false;
  return record.attempts >= MAX_ATTEMPTS && !!record.blockedUntil && record.blockedUntil > new Date();
}

/** Minutos restantes de bloqueo para `ip`, o 0 si no está bloqueada. */
export async function getBlockedMinutesRemaining(ip: string): Promise<number> {
  const record = await prisma.loginAttempt.findUnique({ where: { ip } });
  if (!record?.blockedUntil) return 0;
  const remainingMs = record.blockedUntil.getTime() - Date.now();
  return remainingMs > 0 ? Math.ceil(remainingMs / 60_000) : 0;
}

export async function registerFailedAttempt(ip: string): Promise<void> {
  const now = new Date();
  const existing = await prisma.loginAttempt.findUnique({ where: { ip } });

  // Sin registro previo, o el bloqueo anterior ya expiró: arrancar el conteo desde 1.
  const blockExpired = !!existing?.blockedUntil && existing.blockedUntil <= now;
  if (!existing || blockExpired) {
    await prisma.loginAttempt.upsert({
      where: { ip },
      create: { ip, attempts: 1, lastAttemptAt: now, blockedUntil: null },
      update: { attempts: 1, lastAttemptAt: now, blockedUntil: null },
    });
    return;
  }

  const attempts = existing.attempts + 1;
  await prisma.loginAttempt.update({
    where: { ip },
    data: {
      attempts,
      lastAttemptAt: now,
      // El bloqueo dura 15 minutos desde el intento fallido número 5. Como isRateLimited
      // rechaza las siguientes peticiones antes de llegar aquí, este valor no se reescribe
      // mientras la IP siga bloqueada.
      blockedUntil: attempts >= MAX_ATTEMPTS ? new Date(now.getTime() + WINDOW_MS) : existing.blockedUntil,
    },
  });
}

export async function clearAttempts(ip: string): Promise<void> {
  await prisma.loginAttempt.deleteMany({ where: { ip } });
}

// Registros ya no bloqueantes (sin blockedUntil o con blockedUntil vencido)
// y con más antigüedad que la retención configurada (Sprint O — antes: literal
// 30 días fijo, ver DEFAULT_RETENTION_LOGIN_ATTEMPTS en systemConfig.ts) desde
// el último intento: ya no aportan nada al rate limiting y se pueden purgar
// con seguridad. `maxAgeMs` se calcula una sola vez por cada caller (evita
// hacer async este helper síncrono).
function expiredAttemptsWhere(now: Date, maxAgeMs: number) {
  return {
    OR: [{ blockedUntil: null }, { blockedUntil: { lt: now } }],
    lastAttemptAt: { lt: new Date(now.getTime() - maxAgeMs) },
  };
}

async function retentionMaxAgeMs(): Promise<number> {
  const days = parseInt(await getEffectiveRetentionLoginAttempts(), 10);
  return days * 24 * 60 * 60 * 1000;
}

/** Cuenta los registros de LoginAttempt elegibles para limpieza, sin borrar nada. */
export async function countExpiredLoginAttempts(): Promise<number> {
  const maxAgeMs = await retentionMaxAgeMs();
  return prisma.loginAttempt.count({ where: expiredAttemptsWhere(new Date(), maxAgeMs) });
}

/** Elimina los registros de LoginAttempt expirados (no bloqueantes y más antiguos que la retención configurada). */
export async function cleanupExpiredLoginAttempts(): Promise<number> {
  const maxAgeMs = await retentionMaxAgeMs();
  const result = await prisma.loginAttempt.deleteMany({ where: expiredAttemptsWhere(new Date(), maxAgeMs) });
  return result.count;
}

export function getClientIp(headers: Headers): string {
  const forwardedFor = headers.get("x-forwarded-for");
  if (forwardedFor) return forwardedFor.split(",")[0].trim();
  const realIp = headers.get("x-real-ip");
  if (realIp) return realIp.trim();
  return "unknown";
}
