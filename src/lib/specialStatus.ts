import "server-only";
import { prisma } from "@/lib/prisma";
import type { SpecialStatusType } from "@/generated/prisma/client";

// Valores por defecto que se pre-cargan en el formulario — el Administrador puede
// cambiarlos por registro (ver SpecialStatusSection.tsx); no son fijos globalmente.
export const DEFAULT_SPECIAL_STATUS_DAILY_HOURS = 6;
export const DEFAULT_SPECIAL_STATUS_LIMIT_LOW = 5;
export const DEFAULT_SPECIAL_STATUS_LIMIT_BASE = 6;
export const DEFAULT_SPECIAL_STATUS_LIMIT_HIGH = 7;
export const DEFAULT_SPECIAL_STATUS_LIMIT_OVERLOAD = 8;

/** Config vigente para un día con estado especial activo (por registro, no fija). */
export type SpecialStatusDayConfig = {
  type: SpecialStatusType;
  /** Horas objetivo/base del día — usada para la agregación semanal/mensual y el % de carga. */
  dailyHours: number;
  limitLow: number;
  /** Umbral real de clasificación Moderado/Óptimo del semáforo (independiente de dailyHours). */
  limitBase: number;
  limitHigh: number;
  limitOverload: number;
};

/** Días (timestamp UTC-medianoche) con estado especial vigente para un usuario, con su config. */
export type SpecialStatusDayMap = Map<number, SpecialStatusDayConfig>;

type SpecialStatusRow = {
  userId: string;
  startDate: Date;
  endDate: Date | null;
  type: SpecialStatusType;
  dailyHours: number;
  limitLow: number;
  limitBase: number;
  limitHigh: number;
  limitOverload: number;
};

const SELECT_FIELDS = {
  userId: true,
  startDate: true,
  endDate: true,
  type: true,
  dailyHours: true,
  limitLow: true,
  limitBase: true,
  limitHigh: true,
  limitOverload: true,
} as const;

function buildDayMap(records: SpecialStatusRow[], rangeStart: Date, rangeEnd: Date): SpecialStatusDayMap {
  const map: SpecialStatusDayMap = new Map();
  for (const r of records) {
    const from = r.startDate.getTime() > rangeStart.getTime() ? r.startDate : rangeStart;
    const to = r.endDate && r.endDate.getTime() < rangeEnd.getTime() ? r.endDate : rangeEnd;
    const config: SpecialStatusDayConfig = {
      type: r.type,
      dailyHours: r.dailyHours,
      limitLow: r.limitLow,
      limitBase: r.limitBase,
      limitHigh: r.limitHigh,
      limitOverload: r.limitOverload,
    };
    for (let t = from.getTime(); t <= to.getTime(); t += 86400000) {
      map.set(t, config);
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
    select: SELECT_FIELDS,
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
    select: SELECT_FIELDS,
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
