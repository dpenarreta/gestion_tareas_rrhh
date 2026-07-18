import "server-only";
import { prisma } from "@/lib/prisma";
import type { SpecialStatusType } from "@/generated/prisma/client";

// Base diaria y límites FIJOS (no configurables) mientras un estado especial de
// maternidad/lactancia esté vigente para un usuario — sustituyen a las horas
// efectivas y límites configurados globalmente, solo para los días afectados.
export const SPECIAL_STATUS_HOURS_PER_DAY = 6;
export const SPECIAL_STATUS_LIMIT_LOW = 5;
export const SPECIAL_STATUS_LIMIT_HIGH = 7;
export const SPECIAL_STATUS_LIMIT_OVERLOAD = 8;

/** Días (timestamp UTC-medianoche) con estado especial vigente para un usuario, con su tipo. */
export type SpecialStatusDayMap = Map<number, SpecialStatusType>;

type SpecialStatusRow = { userId: string; startDate: Date; endDate: Date | null; type: SpecialStatusType };

function buildDayMap(records: SpecialStatusRow[], rangeStart: Date, rangeEnd: Date): SpecialStatusDayMap {
  const map: SpecialStatusDayMap = new Map();
  for (const r of records) {
    const from = r.startDate.getTime() > rangeStart.getTime() ? r.startDate : rangeStart;
    const to = r.endDate && r.endDate.getTime() < rangeEnd.getTime() ? r.endDate : rangeEnd;
    for (let t = from.getTime(); t <= to.getTime(); t += 86400000) {
      map.set(t, r.type);
    }
  }
  return map;
}

/** Días con estado especial vigente para UN usuario dentro de [rangeStart, rangeEnd]. */
export async function getSpecialStatusDayMap(
  userId: string,
  rangeStart: Date,
  rangeEnd: Date
): Promise<SpecialStatusDayMap> {
  const records = await prisma.specialStatus.findMany({
    where: {
      userId,
      startDate: { lte: rangeEnd },
      OR: [{ endDate: null }, { endDate: { gte: rangeStart } }],
    },
    select: { userId: true, startDate: true, endDate: true, type: true },
  });
  return buildDayMap(records, rangeStart, rangeEnd);
}

/**
 * Igual que getSpecialStatusDayMap pero para varios usuarios en una sola consulta
 * (informes de equipo) — solo devuelve entradas para usuarios que realmente tienen
 * algún estado especial superpuesto al rango, así los llamadores pueden tomar el
 * camino rápido (sin ajuste) para el resto del equipo.
 */
export async function getTeamSpecialStatusDayMap(
  userIds: string[],
  rangeStart: Date,
  rangeEnd: Date
): Promise<Map<string, SpecialStatusDayMap>> {
  if (userIds.length === 0) return new Map();
  const records = await prisma.specialStatus.findMany({
    where: {
      userId: { in: userIds },
      startDate: { lte: rangeEnd },
      OR: [{ endDate: null }, { endDate: { gte: rangeStart } }],
    },
    select: { userId: true, startDate: true, endDate: true, type: true },
  });
  const byUser = new Map<string, SpecialStatusRow[]>();
  for (const r of records) {
    const arr = byUser.get(r.userId) ?? [];
    arr.push(r);
    byUser.set(r.userId, arr);
  }
  const result = new Map<string, SpecialStatusDayMap>();
  for (const [userId, recs] of byUser) {
    result.set(userId, buildDayMap(recs, rangeStart, rangeEnd));
  }
  return result;
}
