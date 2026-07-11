import "server-only";
import { prisma } from "@/lib/prisma";

export const CONFIG_KEY_HORAS_EFECTIVAS = "HORAS_EFECTIVAS_DIA";
export const DEFAULT_HORAS_EFECTIVAS = 6.5;

export const CONFIG_KEY_WORKLOAD_TOLERANCE = "workload_tolerance";
export const DEFAULT_WORKLOAD_TOLERANCE = 1.0;

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

export async function getEffectiveWorkloadTolerance(asOf: Date = new Date()): Promise<number> {
  return getEffectiveConfigValue(CONFIG_KEY_WORKLOAD_TOLERANCE, asOf, DEFAULT_WORKLOAD_TOLERANCE);
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
