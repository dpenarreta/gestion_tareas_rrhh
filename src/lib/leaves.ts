import "server-only";
import { prisma } from "@/lib/prisma";

export type DayLeaveInfo = {
  medicoMinutes: number;
  medicoFullDay: boolean;
  personalMinutes: number;
  personalFullDay: boolean;
  // Vacaciones siempre son de día completo (ver validación en la API de creación).
  vacacionesFullDay: boolean;
};

/** Permisos de un usuario por día (clave: timestamp UTC-medianoche) dentro de [rangeStart, rangeEnd]. */
export async function getLeaveMinutesByDay(
  userId: string,
  rangeStart: Date,
  rangeEnd: Date
): Promise<Map<number, DayLeaveInfo>> {
  const records = await prisma.leaveRecord.findMany({
    where: { userId, date: { gte: rangeStart, lte: rangeEnd } },
  });
  const map = new Map<number, DayLeaveInfo>();
  for (const r of records) {
    const key = r.date.getTime();
    const entry = map.get(key) ?? {
      medicoMinutes: 0,
      medicoFullDay: false,
      personalMinutes: 0,
      personalFullDay: false,
      vacacionesFullDay: false,
    };
    if (r.type === "MEDICO") {
      if (r.isFullDay) entry.medicoFullDay = true;
      else entry.medicoMinutes += r.durationMinutes ?? 0;
    } else if (r.type === "PERSONAL") {
      if (r.isFullDay) entry.personalFullDay = true;
      else entry.personalMinutes += r.durationMinutes ?? 0;
    } else {
      entry.vacacionesFullDay = true;
    }
    map.set(key, entry);
  }
  return map;
}

/** Horas de base a descontar ese día por permisos — un día completo descuenta la base entera del día. */
export function leaveHoursForDay(info: DayLeaveInfo | undefined, hoursPerDay: number): number {
  if (!info) return 0;
  if (info.medicoFullDay || info.personalFullDay || info.vacacionesFullDay) return hoursPerDay;
  const hours = info.medicoMinutes / 60 + info.personalMinutes / 60;
  return Math.min(hours, hoursPerDay);
}

/** Totales de minutos de permiso médico/personal/vacaciones en un rango — para el desglose del KPI mensual. */
export function totalLeaveMinutes(
  map: Map<number, DayLeaveInfo>,
  start: Date,
  end: Date,
  hoursPerDay: number
): { medicoMinutes: number; personalMinutes: number; vacacionesMinutes: number } {
  let medico = 0;
  let personal = 0;
  let vacaciones = 0;
  for (let t = start.getTime(); t <= end.getTime(); t += 86400000) {
    const info = map.get(t);
    if (!info) continue;
    medico += info.medicoFullDay ? hoursPerDay * 60 : info.medicoMinutes;
    personal += info.personalFullDay ? hoursPerDay * 60 : info.personalMinutes;
    vacaciones += info.vacacionesFullDay ? hoursPerDay * 60 : 0;
  }
  return {
    medicoMinutes: Math.round(medico),
    personalMinutes: Math.round(personal),
    vacacionesMinutes: Math.round(vacaciones),
  };
}
