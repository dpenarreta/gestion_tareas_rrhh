import "server-only";
import { prisma } from "@/lib/prisma";

export const CONFIG_KEY_HORAS_EFECTIVAS = "HORAS_EFECTIVAS_DIA";
export const DEFAULT_HORAS_EFECTIVAS = 6.5;

// Los 4 límites del semáforo de carga laboral son independientes entre sí
// (no derivados de base ± tolerancia) para evitar que un cambio en uno
// desalinee silenciosamente los demás — cada uno se guarda y edita por separado.
export const CONFIG_KEY_WORKLOAD_LIMIT_LOW = "workload_limit_low";
export const DEFAULT_WORKLOAD_LIMIT_LOW = 5.5;

export const CONFIG_KEY_WORKLOAD_LIMIT_HIGH = "workload_limit_high";
export const DEFAULT_WORKLOAD_LIMIT_HIGH = 7.5;

export const CONFIG_KEY_WORKLOAD_LIMIT_OVERLOAD = "workload_limit_overload";
export const DEFAULT_WORKLOAD_LIMIT_OVERLOAD = 8.5;

/** Value in effect for `key` at `asOf` (defaults to now). Falls back to `fallback` if no history exists yet. */
export async function getEffectiveConfigValue(
  key: string,
  asOf: Date = new Date(),
  fallback: number = 0
): Promise<number> {
  const record = await prisma.systemConfigHistory.findFirst({
    where: {
      key,
      validFrom: { lte: asOf },
      OR: [{ validUntil: null }, { validUntil: { gt: asOf } }],
    },
    orderBy: { validFrom: "desc" },
  });
  if (!record) return fallback;
  const parsed = parseFloat(record.value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export async function getEffectiveHorasEfectivas(asOf: Date = new Date()): Promise<number> {
  return getEffectiveConfigValue(CONFIG_KEY_HORAS_EFECTIVAS, asOf, DEFAULT_HORAS_EFECTIVAS);
}

export async function getEffectiveWorkloadLimitLow(asOf: Date = new Date()): Promise<number> {
  return getEffectiveConfigValue(CONFIG_KEY_WORKLOAD_LIMIT_LOW, asOf, DEFAULT_WORKLOAD_LIMIT_LOW);
}

export async function getEffectiveWorkloadLimitHigh(asOf: Date = new Date()): Promise<number> {
  return getEffectiveConfigValue(CONFIG_KEY_WORKLOAD_LIMIT_HIGH, asOf, DEFAULT_WORKLOAD_LIMIT_HIGH);
}

export async function getEffectiveWorkloadLimitOverload(asOf: Date = new Date()): Promise<number> {
  return getEffectiveConfigValue(CONFIG_KEY_WORKLOAD_LIMIT_OVERLOAD, asOf, DEFAULT_WORKLOAD_LIMIT_OVERLOAD);
}

/** Closes the currently-open history record (if any) and opens a new one, effective now. */
export async function setConfigValue(key: string, value: string, userId: string): Promise<void> {
  const now = new Date();
  await prisma.$transaction([
    prisma.systemConfigHistory.updateMany({
      where: { key, validUntil: null },
      data: { validUntil: now },
    }),
    prisma.systemConfigHistory.create({
      data: { key, value, validFrom: now, validUntil: null, updatedBy: userId },
    }),
  ]);
}
