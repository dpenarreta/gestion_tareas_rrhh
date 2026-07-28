import "server-only";
import { prisma } from "@/lib/prisma";
import { businessCalendarDay, businessDayRealRange, BUSINESS_TZ_OFFSET_HOURS } from "@/lib/businessTime";
import { getHolidaySet } from "@/lib/holidays";
import { leaveHoursForDay, type DayLeaveInfo } from "@/lib/leaves";
import { getEffectiveHorasEfectivas, getEffectiveWorkdayEndHour } from "@/lib/systemConfig";
import { getTeamSpecialStatusDayMap, type SpecialStatusDayMap } from "@/lib/specialStatus";
import { isWorkingDay, countBusinessDays, sumWeightedBaseHours } from "@/lib/workload";
import { getOfficialTargetTime } from "@/lib/targetTime";


export type CapacityEstado = "alta" | "limitada" | "no-asignar" | "sobrecarga" | "sin-planificacion";

export type CapacityForecast = {
  userId: string;
  horasRestantesHoy: number;
  diasLaborablesRestantes: number;
  baseFuturaTotal: number;
  comprometidoEnProgreso: number;
  comprometidoPendiente: number;
  comprometidoFuturo: number;
  disponible: number;
  disponiblePct: number;
  estado: CapacityEstado;
  estadoColor: "green" | "yellow" | "red" | "gray";
  estadoLabel: string;
  tasksSinEstimar: number;
  confiabilidad: {
    pct: number;
    holidaysConfigured: boolean;
    tasksWithoutEstimate: number;
  };
};

/**
 * Semáforo de capacidad disponible a partir de horas disponibles/base futura —
 * extraído como función pura (sin acceso a datos) para que tanto el motor real
 * como el simulador (§9, `/api/analytics/simulate`) usen la MISMA
 * clasificación en vez de reimplementar el árbol de decisión por separado.
 */
export function classifyCapacity(
  disponible: number,
  baseFuturaTotal: number,
  disponiblePct: number
): { estado: CapacityEstado; estadoColor: CapacityForecast["estadoColor"]; estadoLabel: string } {
  if (baseFuturaTotal <= 0) {
    return { estado: "sin-planificacion", estadoColor: "gray", estadoLabel: "Sin planificación disponible este mes" };
  }
  if (disponible < 0) {
    return { estado: "sobrecarga", estadoColor: "red", estadoLabel: `Sobrecarga proyectada: ${disponible}h` };
  }
  if (disponiblePct > 20) {
    return { estado: "alta", estadoColor: "green", estadoLabel: "Puede asumir proyectos" };
  }
  if (disponiblePct >= 10) {
    return { estado: "limitada", estadoColor: "yellow", estadoLabel: "Capacidad limitada" };
  }
  return { estado: "no-asignar", estadoColor: "red", estadoLabel: "No asignar nuevas tareas" };
}

function utcMonthStart(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}
function utcMonthEnd(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) - 1);
}
function addDays(d: Date, n: number) {
  return new Date(d.getTime() + n * 86400000);
}

function buildLeaveMaps(
  records: Array<{ userId: string; type: string; date: Date; isFullDay: boolean; durationMinutes: number | null }>
): Map<string, Map<number, DayLeaveInfo>> {
  const byUser = new Map<string, Map<number, DayLeaveInfo>>();
  for (const r of records) {
    const userMap = byUser.get(r.userId) ?? new Map<number, DayLeaveInfo>();
    const key = r.date.getTime();
    const entry = userMap.get(key) ?? {
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
    userMap.set(key, entry);
    byUser.set(r.userId, userMap);
  }
  return byUser;
}

/**
 * Capacidad disponible para asumir NUEVAS tareas — proyección hacia adelante
 * (desde ahora hasta fin de mes), no un balance del mes ya transcurrido (a
 * diferencia de TeamMemberKpi.capacidadDisponiblePct, que mide cuánto de la
 * base mensual completa queda por debajo del límite óptimo). Ver Analytics
 * § Capacidad para asumir nuevas tareas.
 */
export async function computeTeamCapacityForecast(
  userIds: string[],
  now: Date = new Date()
): Promise<Map<string, CapacityForecast>> {
  const result = new Map<string, CapacityForecast>();
  if (userIds.length === 0) return result;

  const today = businessCalendarDay(now);
  const monthStart = utcMonthStart(today);
  const monthEnd = utcMonthEnd(today);
  const tomorrow = addDays(today, 1);

  const localHour = new Date(now.getTime() - BUSINESS_TZ_OFFSET_HOURS * 3600000).getUTCHours();

  const [hoursPerDay, workdayEndHour, holidays, holidaysThisYearCount, leaveRecords, specialMapByUser, openTasks, realHoursRecords] =
    await Promise.all([
      getEffectiveHorasEfectivas(now),
      // Hora local (huso de negocio) a la que se asume terminada la jornada — antes de
      // esta hora "hoy" cuenta como parcial, después la proyección arranca desde el
      // siguiente día laborable. Configurable desde Sprint O (antes: literal 17 fijo).
      getEffectiveWorkdayEndHour(now),
      getHolidaySet(),
      prisma.holiday.count({ where: { year: today.getUTCFullYear() } }),
      prisma.leaveRecord.findMany({
        where: { userId: { in: userIds }, date: { gte: monthStart, lte: monthEnd } },
        select: { userId: true, type: true, date: true, isFullDay: true, durationMinutes: true },
      }),
      getTeamSpecialStatusDayMap(userIds, monthStart, monthEnd),
      prisma.task.findMany({
        where: { assignedToId: { in: userIds }, status: { in: ["PENDIENTE", "EN_PROGRESO"] }, archivedMonth: null },
        select: {
          assignedToId: true,
          status: true,
          estimatedHours: true,
          targetTimeValidated: true,
          realHours: true,
          startDate: true,
          endDate: true,
        },
      }),
      (async () => {
        const { start: realStart } = businessDayRealRange(monthStart);
        const { end: realEnd } = businessDayRealRange(today);
        const [fijaTasks, activities] = await Promise.all([
          prisma.task.findMany({
            where: { assignedToId: { in: userIds }, type: "FIJA", archivedMonth: null, completedAt: { gte: realStart, lte: realEnd } },
            select: { assignedToId: true, completedAt: true, realHours: true },
          }),
          prisma.taskActivity.findMany({
            where: { authorId: { in: userIds }, createdAt: { gte: realStart, lte: realEnd } },
            select: { authorId: true, createdAt: true, duration: true },
          }),
        ]);
        const byUserDay = new Map<string, Map<number, number>>();
        const add = (userId: string, date: Date, hours: number) => {
          const dayKey = businessCalendarDay(date).getTime();
          const userMap = byUserDay.get(userId) ?? new Map<number, number>();
          userMap.set(dayKey, (userMap.get(dayKey) ?? 0) + hours);
          byUserDay.set(userId, userMap);
        };
        for (const t of fijaTasks) if (t.completedAt) add(t.assignedToId, t.completedAt, t.realHours);
        for (const a of activities) add(a.authorId, a.createdAt, a.duration / 60);
        return byUserDay;
      })(),
    ]);

  const workdayEnded = localHour >= workdayEndHour;
  const leaveMapByUser = buildLeaveMaps(leaveRecords);
  const holidaysConfigured = holidaysThisYearCount > 0;

  for (const userId of userIds) {
    const leaveMap = leaveMapByUser.get(userId) ?? new Map<number, DayLeaveInfo>();
    const specialMap: SpecialStatusDayMap = specialMapByUser.get(userId) ?? new Map();
    const dayHoursMap = realHoursRecords.get(userId) ?? new Map<number, number>();

    // ── Horas restantes hoy (parcial) ──
    const todayCfg = specialMap.get(today.getTime());
    const todayDailyHours = todayCfg ? todayCfg.dailyHours : hoursPerDay;
    const todayIsBizDay = isWorkingDay(today, holidays);
    let horasRestantesHoy = 0;
    if (todayIsBizDay && !workdayEnded) {
      const todayLeaveHours = leaveHoursForDay(leaveMap.get(today.getTime()), todayDailyHours);
      const todayEffectiveHours = Math.max(0, todayDailyHours - todayLeaveHours);
      const horasYaTrabajadasHoy = dayHoursMap.get(today.getTime()) ?? 0;
      horasRestantesHoy = Math.max(0, Math.round((todayEffectiveHours - horasYaTrabajadasHoy) * 100) / 100);
    }

    // ── Días laborables restantes (futuros, sin contar hoy) ──
    const diasLaborablesRestantes = countBusinessDays(tomorrow, monthEnd, holidays);
    const baseFuturaFullDays = sumWeightedBaseHours(tomorrow, monthEnd, hoursPerDay, holidays, leaveMap, specialMap, "dailyHours");
    const baseFuturaTotal = Math.round((horasRestantesHoy + baseFuturaFullDays) * 100) / 100;

    // ── Comprometido futuro ──
    // El Tiempo Objetivo Validado es la referencia OFICIAL cuando existe
    // (§Sprint 6 S6-H) — nunca el estimado inicial obsoleto una vez que un
    // líder lo validó. getOfficialTargetTime() aplica el mismo fallback que
    // el resto del motor: validado ?? inicial.
    const userTasks = openTasks.filter((t) => t.assignedToId === userId);
    const enProgreso = userTasks.filter((t) => t.status === "EN_PROGRESO");
    const enProgresoEstimadas = enProgreso.filter((t) => getOfficialTargetTime(t) > 0);
    const enProgresoSinEstimar = enProgreso.length - enProgresoEstimadas.length;
    const comprometidoEnProgreso = Math.round(
      enProgresoEstimadas.reduce((s, t) => s + Math.max(0, getOfficialTargetTime(t) - t.realHours), 0) * 100
    ) / 100;

    const pendientes = userTasks.filter(
      (t) => t.status === "PENDIENTE" && t.startDate.getTime() <= monthEnd.getTime() && t.endDate.getTime() >= today.getTime()
    );
    const pendientesEstimadas = pendientes.filter((t) => getOfficialTargetTime(t) > 0);
    const pendientesSinEstimar = pendientes.length - pendientesEstimadas.length;
    const comprometidoPendiente = Math.round(pendientesEstimadas.reduce((s, t) => s + getOfficialTargetTime(t), 0) * 100) / 100;

    const comprometidoFuturo = Math.round((comprometidoEnProgreso + comprometidoPendiente) * 100) / 100;
    const tasksSinEstimar = enProgresoSinEstimar + pendientesSinEstimar;

    // ── Disponible ──
    const disponible = Math.round((baseFuturaTotal - comprometidoFuturo) * 100) / 100;
    const disponiblePct = baseFuturaTotal > 0 ? Math.round((disponible / baseFuturaTotal) * 100) : 0;

    const { estado, estadoColor, estadoLabel } = classifyCapacity(disponible, baseFuturaTotal, disponiblePct);

    // Confiabilidad: NO se infieren permisos/ausencias por falta de actividad
    // registrada — un colaborador puede estar en entrevistas, capacitaciones,
    // visitas o reuniones sin registrar TaskActivity ese día, así que esa
    // inferencia generaría falsos positivos (ver Analytics § Calidad de los
    // datos). Solo se penaliza por señales verificables: tareas sin estimar
    // y ausencia de feriados configurados para el año.
    const confiabilidadPct = Math.max(0, Math.min(100, 100 - tasksSinEstimar * 5 - (holidaysConfigured ? 0 : 3)));

    result.set(userId, {
      userId,
      horasRestantesHoy,
      diasLaborablesRestantes,
      baseFuturaTotal,
      comprometidoEnProgreso,
      comprometidoPendiente,
      comprometidoFuturo,
      disponible,
      disponiblePct,
      estado,
      estadoColor,
      estadoLabel,
      tasksSinEstimar,
      confiabilidad: {
        pct: confiabilidadPct,
        holidaysConfigured,
        tasksWithoutEstimate: tasksSinEstimar,
      },
    });
  }

  return result;
}

export async function computeCapacityForecast(userId: string, now: Date = new Date()): Promise<CapacityForecast> {
  const map = await computeTeamCapacityForecast([userId], now);
  return (
    map.get(userId) ?? {
      userId,
      horasRestantesHoy: 0,
      diasLaborablesRestantes: 0,
      baseFuturaTotal: 0,
      comprometidoEnProgreso: 0,
      comprometidoPendiente: 0,
      comprometidoFuturo: 0,
      disponible: 0,
      disponiblePct: 0,
      estado: "sin-planificacion",
      estadoColor: "gray",
      estadoLabel: "Sin planificación disponible este mes",
      tasksSinEstimar: 0,
      confiabilidad: { pct: 100, holidaysConfigured: true, tasksWithoutEstimate: 0 },
    }
  );
}
