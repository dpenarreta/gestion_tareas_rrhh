import "server-only";
import { prisma } from "@/lib/prisma";

/** key -> label para TODOS los motivos (activos e inactivos) — usado en reportes/resúmenes server-side. */
export async function getActivityReasonLabelMap(): Promise<Record<string, string>> {
  const reasons = await prisma.activityReason.findMany({ select: { key: true, label: true } });
  return Object.fromEntries(reasons.map((r) => [r.key, r.label]));
}
