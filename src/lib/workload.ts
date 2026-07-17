import "server-only";
import { prisma } from "@/lib/prisma";
import { businessCalendarDay, businessDayRealRange, isBusinessDay } from "@/lib/businessTime";
import { getHolidaySet } from "@/lib/holidays";
import { getLeaveMinutesByDay, leaveHoursForDay, totalLeaveMinutes, type DayLeaveInfo } from "@/lib/leaves";
import {
  getEffectiveHorasEfectivas,
  getEffectiveWorkloadLimitLow,
  getEffectiveWorkloadLimitHigh,
  getEffectiveWorkloadLimitOverload,
} from "@/lib/systemConfig";
import type {
  WorkloadColor,
  WorkloadMetric,
  WorkloadLabel,
  CargaTiempo,
  DailyCargaPoint,
  WeeklyCargaPoint,
} from "@/components/kpis/types";

export type { WorkloadMetric, CargaTiempo, DailyCargaPoint, WeeklyCargaPoint };

const MONTH_NAMES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

const DAY_ABBR = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

/** Lunes a viernes Y no feriado configurado. */
function isWorkingDay(d: Date, holidays: Set<number>): boolean {
  return isBusinessDay(d) && !holidays.has(d.getTime());
}

function countBusinessDays(start: Date, end: Date, holidays: Set<number>): number {
  let count = 0;
  for (let t = start.getTime(); t <= end.getTime(); t += 86400000) {
    if (isWorkingDay(new Date(t), holidays)) count++;
  }
  return count;
}

function firstBusinessDay(start: Date, end: Date, holidays: Set<number>): Date | null {
  for (let t = start.getTime(); t <= end.getTime(); t += 86400000) {
    const d = new Date(t);
    if (isWorkingDay(d, holidays)) return d;
  }
  return null;
}

function lastBusinessDay(start: Date, end: Date, holidays: Set<number>): Date | null {
  for (let t = end.getTime(); t >= start.getTime(); t -= 86400000) {
    const d = new Date(t);
    if (isWorkingDay(d, holidays)) return d;
  }
  return null;
}

/** Suma, día a día, la base efectiva (horasPorDía - permisos ese día) de los días laborables del rango. */
function sumWeightedBaseHours(
  start: Date,
  end: Date,
  hoursPerDay: number,
  holidays: Set<number>,
  leaveMap: Map<number, DayLeaveInfo>
): number {
  let total = 0;
  for (let t = start.getTime(); t <= end.getTime(); t += 86400000) {
    const d = new Date(t);
    if (!isWorkingDay(d, holidays)) continue;
    const leaveHours = leaveHoursForDay(leaveMap.get(d.getTime()), hoursPerDay);
    total += Math.max(0, hoursPerDay - leaveHours);
  }
  return Math.round(total * 100) / 100;
}

function formatShortDate(d: Date): string {
  const day = String(d.getUTCDate()).padStart(2, "0");
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${day}/${month}`;
}

function formatMonthLabel(d: Date): string {
  return `${MONTH_NAMES[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export type WorkloadRange = {
  /** Límite entre Subutilización y Moderado (= workload_limit_low, escalado). */
  min: number;
  /** Límite entre Óptimo y Carga elevada (= workload_limit_high, escalado). */
  max: number;
  /** Límite entre Carga elevada y Sobrecarga (= workload_limit_overload, escalado). */
  elevatedMax: number;
  color: WorkloadColor;
  label: WorkloadLabel;
};

/**
 * Semáforo de carga laboral por RANGO (no un punto exacto de 100%), 5 zonas,
 * definidas por 4 límites INDEPENDIENTES (no derivados de base ± tolerancia
 * — eso generaba desalineación cuando la tolerancia configurada no coincidía
 * con los límites fijos esperados):
 *   🔴 Subutilización : realHours <  limitLow
 *   🟡 Moderado       : limitLow <= realHours < baseHours
 *   🟢 Óptimo         : baseHours <= realHours <= limitHigh
 *   🟠 Carga elevada  : limitHigh <  realHours <= limitOverload
 *   🔴 Sobrecarga     : realHours > limitOverload
 *
 * `limitLow`/`limitHigh`/`limitOverload` ya vienen escalados por quien llama
 * (p. ej. límite diario × días hábiles del período), para que el rango
 * crezca proporcionalmente en vistas semanales/mensuales.
 */
export function computeWorkloadRange(
  realHours: number,
  baseHours: number,
  limitLow: number,
  limitHigh: number,
  limitOverload: number,
): WorkloadRange {
  if (baseHours <= 0) {
    return realHours > 0
      ? { min: 0, max: 0, elevatedMax: 0, color: "orange", label: "Carga elevada" }
      : { min: 0, max: 0, elevatedMax: 0, color: "green", label: "Óptimo" };
  }
  const min = Math.round(limitLow * 100) / 100;
  const max = Math.round(limitHigh * 100) / 100;
  const elevatedMax = Math.round(limitOverload * 100) / 100;
  if (realHours < min) return { min, max, elevatedMax, color: "red", label: "Subutilización" };
  if (realHours < baseHours) return { min, max, elevatedMax, color: "yellow", label: "Moderado" };
  if (realHours <= max) return { min, max, elevatedMax, color: "green", label: "Óptimo" };
  if (realHours <= elevatedMax) return { min, max, elevatedMax, color: "orange", label: "Carga elevada" };
  return { min, max, elevatedMax, color: "red", label: "Sobrecarga" };
}

/**
 * Porcentaje de carga con techo en 100% dentro del rango óptimo: el % sube
 * linealmente hasta llegar a la base (100%), se mantiene en 100% mientras
 * las horas reales queden dentro de la zona Óptima (hasta `optimalMax` =
 * límite superior óptimo), y al superar `optimalMax` retoma un crecimiento
 * lineal usando `optimalMax` (no la base) como referencia del 100% — así
 * 7.667h con límite óptimo 7.5h da ~102%, no un salto brusco.
 */
export function computeWorkloadPct(realHours: number, baseHours: number, optimalMax: number): number {
  if (baseHours <= 0) return 0;
  if (realHours <= baseHours) return Math.round((realHours / baseHours) * 100);
  if (realHours <= optimalMax) return 100;
  if (optimalMax <= 0) return 100;
  return Math.round(100 + ((realHours - optimalMax) / optimalMax) * 100);
}

function utcDayStart(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function utcWeekStart(d: Date) {
  const day = utcDayStart(d);
  const dow = day.getUTCDay(); // 0=Sun..6=Sat
  const diffToMonday = dow === 0 ? -6 : 1 - dow;
  return new Date(day.getTime() + diffToMonday * 86400000);
}
function utcWeekEnd(d: Date) {
  return new Date(utcWeekStart(d).getTime() + 7 * 86400000 - 1);
}
function utcMonthStart(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}
function utcMonthEnd(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) - 1);
}

/**
 * The dynamic business-day base (días lunes-viernes, excluidos feriados, × horas
 * efectivas configuradas) for an explicit calendar month — for historical/report
 * contexts where the month is given directly (no "now" ambiguity, so no
 * business-timezone shift is needed). No es por usuario — los permisos (que sí
 * son por persona) se aplican aparte, por miembro, donde se consuma este valor.
 */
export async function monthlyBusinessBase(year: number, month: number): Promise<{
  start: Date;
  end: Date;
  businessDays: number;
  baseHours: number;
  hoursPerDay: number;
  limitLowPerDay: number;
  limitHighPerDay: number;
  limitOverloadPerDay: number;
  limitLowHours: number;
  limitHighHours: number;
  limitOverloadHours: number;
}> {
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 1) - 1);
  const holidays = await getHolidaySet();
  const businessDays = countBusinessDays(start, end, holidays);
  // El valor vigente al INICIO del mes es el que rigió ese período — así cambios
  // de configuración posteriores no alteran KPIs de meses ya cerrados.
  const [hoursPerDay, limitLowPerDay, limitHighPerDay, limitOverloadPerDay] = await Promise.all([
    getEffectiveHorasEfectivas(start),
    getEffectiveWorkloadLimitLow(start),
    getEffectiveWorkloadLimitHigh(start),
    getEffectiveWorkloadLimitOverload(start),
  ]);
  return {
    start,
    end,
    businessDays,
    baseHours: businessDays * hoursPerDay,
    hoursPerDay,
    limitLowPerDay,
    limitHighPerDay,
    limitOverloadPerDay,
    limitLowHours: businessDays * limitLowPerDay,
    limitHighHours: businessDays * limitHighPerDay,
    limitOverloadHours: businessDays * limitOverloadPerDay,
  };
}

async function realHoursInWindow(userId: string, calStart: Date, calEnd: Date): Promise<number> {
  const { start: realStart } = businessDayRealRange(calStart);
  const { end: realEnd } = businessDayRealRange(calEnd);

  const [fijaTasks, activities] = await Promise.all([
    prisma.task.findMany({
      where: {
        assignedToId: userId,
        type: "FIJA",
        archivedMonth: null,
        completedAt: { gte: realStart, lte: realEnd },
      },
      select: { realHours: true },
    }),
    prisma.taskActivity.findMany({
      where: { authorId: userId, createdAt: { gte: realStart, lte: realEnd } },
      select: { duration: true },
    }),
  ]);

  const fijaHours = fijaTasks.reduce((s, t) => s + t.realHours, 0);
  const activityHours = activities.reduce((s, a) => s + a.duration, 0) / 60;
  return Math.round((fijaHours + activityHours) * 100) / 100;
}

/** Suma solo las horas reales de los días sábado/domingo dentro de [rangeStart, rangeEnd]. */
async function weekendHoursInRange(userId: string, rangeStart: Date, rangeEnd: Date): Promise<number> {
  let total = 0;
  for (let t = rangeStart.getTime(); t <= rangeEnd.getTime(); t += 86400000) {
    const day = new Date(t);
    if (isBusinessDay(day)) continue;
    total += await realHoursInWindow(userId, day, day);
  }
  return Math.round(total * 100) / 100;
}

/** Suma solo las horas reales de días feriados que NO caen en fin de semana (para no duplicar con weekendHoursInRange). */
async function holidayHoursInRange(userId: string, rangeStart: Date, rangeEnd: Date, holidays: Set<number>): Promise<number> {
  let total = 0;
  for (let t = rangeStart.getTime(); t <= rangeEnd.getTime(); t += 86400000) {
    const day = new Date(t);
    if (!isBusinessDay(day)) continue; // ya contado como fin de semana
    if (!holidays.has(day.getTime())) continue;
    total += await realHoursInWindow(userId, day, day);
  }
  return Math.round(total * 100) / 100;
}

function toMetric(
  realHours: number,
  baseHours: number,
  hoursPerDay: number,
  limitLow: number,
  limitHigh: number,
  limitOverload: number,
): WorkloadMetric {
  const range = computeWorkloadRange(realHours, baseHours, limitLow, limitHigh, limitOverload);
  const pct =
    baseHours > 0
      ? computeWorkloadPct(realHours, baseHours, range.max)
      : Math.round((realHours / hoursPerDay) * 100);
  return {
    realHours,
    baseHours,
    pct,
    color: range.color,
    // rangeMin/rangeMax describen la zona Óptima (verde) en sí: [base, limitHigh].
    rangeMin: baseHours > 0 ? Math.round(baseHours * 100) / 100 : 0,
    rangeMax: range.max,
    label: range.label,
    isWeekend: false,
  };
}

export async function computeCargaTiempo(userId: string, now: Date = new Date()): Promise<CargaTiempo> {
  const today = businessCalendarDay(now);
  const monthStart = utcMonthStart(today);
  const monthEnd = utcMonthEnd(today);

  const weekStartRaw = utcWeekStart(today);
  const weekEndRaw = utcWeekEnd(today);
  const weekStart = weekStartRaw < monthStart ? monthStart : weekStartRaw;
  const weekEnd = weekEndRaw > monthEnd ? monthEnd : weekEndRaw;

  // diaria/semanal/mensual son siempre relativas al momento actual (no a un mes
  // histórico), así que las tres usan el valor vigente ahora mismo — comparar
  // contra el instante real (no medianoche del día) para que un cambio de
  // configuración hecho hoy se refleje de inmediato.
  const [hoursPerDay, limitLowPerDay, limitHighPerDay, limitOverloadPerDay, holidays, leaveMap, user] = await Promise.all([
    getEffectiveHorasEfectivas(now),
    getEffectiveWorkloadLimitLow(now),
    getEffectiveWorkloadLimitHigh(now),
    getEffectiveWorkloadLimitOverload(now),
    getHolidaySet(),
    getLeaveMinutesByDay(userId, monthStart, monthEnd),
    prisma.user.findUnique({ where: { id: userId }, select: { kpiStartDate: true } }),
  ]);

  // Ajuste puntual del Administrador (User.kpiStartDate): si cae dentro del mes
  // en curso, los días anteriores a esa fecha no cuentan para la base laboral
  // ni para las horas reales de la semana/mes — solo aplica si realmente recorta
  // el mes que se está mostrando (una fecha de un mes ya pasado no tiene efecto).
  const kpiStartDate = user?.kpiStartDate ?? null;
  const kpiStartApplies = !!kpiStartDate && kpiStartDate.getTime() > monthStart.getTime();
  const effectiveMonthStart = kpiStartApplies ? kpiStartDate! : monthStart;
  const effectiveWeekStart = kpiStartDate && kpiStartDate.getTime() > weekStart.getTime() ? kpiStartDate : weekStart;

  const todayIsWeekendDay = !isBusinessDay(today);
  const todayIsHolidayDay = !todayIsWeekendDay && holidays.has(today.getTime());
  const todayLeaveInfo = leaveMap.get(today.getTime());
  const todayLeaveHours = leaveHoursForDay(todayLeaveInfo, hoursPerDay);
  // Un permiso (parcial o completo) reduce proporcionalmente TODA la envolvente
  // del día (base y los 3 límites) — así un permiso de 3h en un día de 6.5h no
  // marca falsamente "Subutilización" solo porque el límite bajo (p. ej. 5.5h)
  // quedó por encima de la base ya reducida (3.5h).
  const dayFactor = hoursPerDay > 0 ? Math.max(0, 1 - todayLeaveHours / hoursPerDay) : 1;
  const dailyBaseHours = todayIsWeekendDay || todayIsHolidayDay ? 0 : hoursPerDay * dayFactor;
  const dailyLimitLow = limitLowPerDay * dayFactor;
  const dailyLimitHigh = limitHighPerDay * dayFactor;
  const dailyLimitOverload = limitOverloadPerDay * dayFactor;

  const weeklyBusinessDays = countBusinessDays(effectiveWeekStart, weekEnd, holidays);
  const weeklyBaseHours = sumWeightedBaseHours(effectiveWeekStart, weekEnd, hoursPerDay, holidays, leaveMap);
  const monthlyBusinessDays = countBusinessDays(effectiveMonthStart, monthEnd, holidays);
  const monthlyBaseHours = sumWeightedBaseHours(effectiveMonthStart, monthEnd, hoursPerDay, holidays, leaveMap);

  const [diariaHours, semanalHours, mensualHours, weekendHours, monthlyWeekendHours, monthlyHolidayHours] = await Promise.all([
    realHoursInWindow(userId, today, today),
    realHoursInWindow(userId, effectiveWeekStart, weekEnd),
    realHoursInWindow(userId, effectiveMonthStart, monthEnd),
    weekendHoursInRange(userId, effectiveWeekStart, weekEnd),
    weekendHoursInRange(userId, effectiveMonthStart, monthEnd),
    holidayHoursInRange(userId, effectiveMonthStart, monthEnd, holidays),
  ]);
  const monthlyLeaveTotals = totalLeaveMinutes(leaveMap, effectiveMonthStart, monthEnd, hoursPerDay);

  const weekBizStart = firstBusinessDay(weekStart, weekEnd, holidays) ?? weekStart;
  const weekBizEnd = lastBusinessDay(weekStart, weekEnd, holidays) ?? weekEnd;

  // Fin de semana o feriado: el semáforo de rango no aplica al día (no hay base
  // laboral con la que comparar) — se muestra como "trabajo en fin de semana" /
  // "trabajo en feriado" en vez de forzar una clasificación sin sentido.
  const diariaMetric = todayIsWeekendDay || todayIsHolidayDay
    ? {
        realHours: diariaHours,
        baseHours: 0,
        pct: 0,
        color: "green" as WorkloadColor,
        rangeMin: 0,
        rangeMax: 0,
        label: "Óptimo" as WorkloadLabel,
        isWeekend: todayIsWeekendDay,
        isHoliday: todayIsHolidayDay,
        medicoLeaveMinutes: todayLeaveInfo?.medicoMinutes ?? 0,
        medicoLeaveFullDay: todayLeaveInfo?.medicoFullDay ?? false,
        personalLeaveMinutes: todayLeaveInfo?.personalMinutes ?? 0,
        personalLeaveFullDay: todayLeaveInfo?.personalFullDay ?? false,
        vacacionesFullDay: todayLeaveInfo?.vacacionesFullDay ?? false,
      }
    : {
        ...toMetric(diariaHours, dailyBaseHours, hoursPerDay, dailyLimitLow, dailyLimitHigh, dailyLimitOverload),
        isHoliday: false,
        medicoLeaveMinutes: todayLeaveInfo?.medicoMinutes ?? 0,
        medicoLeaveFullDay: todayLeaveInfo?.medicoFullDay ?? false,
        personalLeaveMinutes: todayLeaveInfo?.personalMinutes ?? 0,
        personalLeaveFullDay: todayLeaveInfo?.personalFullDay ?? false,
        vacacionesFullDay: todayLeaveInfo?.vacacionesFullDay ?? false,
      };

  return {
    diaria: diariaMetric,
    semanal: {
      ...toMetric(
        semanalHours,
        weeklyBaseHours,
        hoursPerDay,
        limitLowPerDay * weeklyBusinessDays,
        limitHighPerDay * weeklyBusinessDays,
        limitOverloadPerDay * weeklyBusinessDays,
      ),
      weekStartLabel: formatShortDate(weekBizStart),
      weekEndLabel: formatShortDate(weekBizEnd),
      businessDays: weeklyBusinessDays,
      weekendHours,
    },
    mensual: {
      ...toMetric(
        mensualHours,
        monthlyBaseHours,
        hoursPerDay,
        limitLowPerDay * monthlyBusinessDays,
        limitHighPerDay * monthlyBusinessDays,
        limitOverloadPerDay * monthlyBusinessDays,
      ),
      monthLabel: formatMonthLabel(today),
      businessDays: monthlyBusinessDays,
      weekendHours: monthlyWeekendHours,
      holidayHours: monthlyHolidayHours,
      medicoLeaveMinutes: monthlyLeaveTotals.medicoMinutes,
      personalLeaveMinutes: monthlyLeaveTotals.personalMinutes,
      vacacionesMinutes: monthlyLeaveTotals.vacacionesMinutes,
    },
    horasEfectivasPorDia: hoursPerDay,
    workloadLimitLow: limitLowPerDay,
    workloadLimitHigh: limitHighPerDay,
    workloadLimitOverload: limitOverloadPerDay,
    kpiStartDate: kpiStartApplies ? kpiStartDate!.toISOString() : null,
    // El histórico (para los gráficos) es una consulta aparte y más cara
    // (computeCargaHistory) — se deja vacío aquí para que llamadores que solo
    // necesitan el snapshot actual (p. ej. el mensaje diario de Nova) no paguen
    // ese costo. Las rutas de KPI que sí muestran gráficos la completan aparte.
    dailyHistory: [],
    weeklyHistory: [],
  };
}

/**
 * Histórico para los gráficos de carga laboral: últimos `dailyCount` días
 * hábiles (barras) y las semanas del mes en curso hasta hoy (línea). Aparte
 * de computeCargaTiempo a propósito — es una consulta más cara y solo la
 * necesitan las vistas de Analytics/Mi actividad que renderizan los gráficos.
 */
export async function computeCargaHistory(
  userId: string,
  now: Date = new Date(),
  dailyCount = 7,
): Promise<{ daily: DailyCargaPoint[]; weekly: WeeklyCargaPoint[] }> {
  const today = businessCalendarDay(now);
  const [hoursPerDay, limitLowPerDay, limitHighPerDay, limitOverloadPerDay, holidays, user] = await Promise.all([
    getEffectiveHorasEfectivas(now),
    getEffectiveWorkloadLimitLow(now),
    getEffectiveWorkloadLimitHigh(now),
    getEffectiveWorkloadLimitOverload(now),
    getHolidaySet(),
    prisma.user.findUnique({ where: { id: userId }, select: { kpiStartDate: true } }),
  ]);
  const kpiStartDate = user?.kpiStartDate ?? null;

  // ── Diario: últimos `dailyCount` días hábiles (incluye hoy si es hábil) ──
  // Un kpiStartDate por usuario detiene la búsqueda hacia atrás en esa fecha:
  // los días anteriores no cuentan para su histórico.
  const businessDaysDesc: Date[] = [];
  for (
    let cursor = new Date(today);
    businessDaysDesc.length < dailyCount && (!kpiStartDate || cursor.getTime() >= kpiStartDate.getTime());
    cursor = new Date(cursor.getTime() - 86400000)
  ) {
    if (isWorkingDay(cursor, holidays)) businessDaysDesc.push(new Date(cursor));
  }
  const businessDaysAsc = businessDaysDesc.reverse();

  if (businessDaysAsc.length === 0) {
    return { daily: [], weekly: [] };
  }

  const dailyRangeStart = businessDaysAsc[0];
  const dailyRangeEnd = businessDaysAsc[businessDaysAsc.length - 1];
  const { start: dailyRealStart } = businessDayRealRange(dailyRangeStart);
  const { end: dailyRealEnd } = businessDayRealRange(dailyRangeEnd);

  const [dailyFijaTasks, dailyActivities] = await Promise.all([
    prisma.task.findMany({
      where: { assignedToId: userId, type: "FIJA", archivedMonth: null, completedAt: { gte: dailyRealStart, lte: dailyRealEnd } },
      select: { completedAt: true, realHours: true },
    }),
    prisma.taskActivity.findMany({
      where: { authorId: userId, createdAt: { gte: dailyRealStart, lte: dailyRealEnd } },
      select: { createdAt: true, duration: true },
    }),
  ]);

  const daily: DailyCargaPoint[] = businessDaysAsc.map((day) => {
    const { start, end } = businessDayRealRange(day);
    const fijaHours = dailyFijaTasks
      .filter((t) => t.completedAt! >= start && t.completedAt! <= end)
      .reduce((s, t) => s + t.realHours, 0);
    const activityHours =
      dailyActivities.filter((a) => a.createdAt >= start && a.createdAt <= end).reduce((s, a) => s + a.duration, 0) / 60;
    const realHours = Math.round((fijaHours + activityHours) * 100) / 100;
    const range = computeWorkloadRange(realHours, hoursPerDay, limitLowPerDay, limitHighPerDay, limitOverloadPerDay);
    return {
      date: `${day.getUTCFullYear()}-${String(day.getUTCMonth() + 1).padStart(2, "0")}-${String(day.getUTCDate()).padStart(2, "0")}`,
      dayLabel: `${DAY_ABBR[day.getUTCDay()]} ${formatShortDate(day)}`,
      realHours,
      baseHours: hoursPerDay,
      color: range.color,
      label: range.label,
    };
  });

  // ── Semanal: semanas del mes en curso, hasta la semana de hoy ──
  const monthStart = utcMonthStart(today);
  const monthEnd = utcMonthEnd(today);
  const flooredMonthStart = kpiStartDate && kpiStartDate.getTime() > monthStart.getTime() ? kpiStartDate : monthStart;
  const weekSlices: { start: Date; end: Date }[] = [];
  for (let cursor = flooredMonthStart; cursor <= monthEnd && cursor <= today; ) {
    const weekStartRaw = utcWeekStart(cursor);
    const weekEndRaw = utcWeekEnd(cursor);
    const sliceStart = weekStartRaw < flooredMonthStart ? flooredMonthStart : weekStartRaw;
    const sliceEndRaw = weekEndRaw > monthEnd ? monthEnd : weekEndRaw;
    const sliceEnd = sliceEndRaw > today ? today : sliceEndRaw;
    weekSlices.push({ start: sliceStart, end: sliceEnd });
    cursor = new Date(weekEndRaw.getTime() + 86400000);
  }
  if (weekSlices.length === 0) {
    return { daily, weekly: [] };
  }

  const weeklyRangeStart = weekSlices[0].start;
  const weeklyRangeEnd = weekSlices[weekSlices.length - 1].end;
  const { start: weeklyRealStart } = businessDayRealRange(weeklyRangeStart);
  const { end: weeklyRealEnd } = businessDayRealRange(weeklyRangeEnd);

  const [weeklyFijaTasks, weeklyActivities] = await Promise.all([
    prisma.task.findMany({
      where: { assignedToId: userId, type: "FIJA", archivedMonth: null, completedAt: { gte: weeklyRealStart, lte: weeklyRealEnd } },
      select: { completedAt: true, realHours: true },
    }),
    prisma.taskActivity.findMany({
      where: { authorId: userId, createdAt: { gte: weeklyRealStart, lte: weeklyRealEnd } },
      select: { createdAt: true, duration: true },
    }),
  ]);

  const weekly: WeeklyCargaPoint[] = weekSlices.map((slice, i) => {
    const businessDays = countBusinessDays(slice.start, slice.end, holidays);
    const baseHours = businessDays * hoursPerDay;
    const { start: realStart } = businessDayRealRange(slice.start);
    const { end: realEnd } = businessDayRealRange(slice.end);
    const fijaHours = weeklyFijaTasks
      .filter((t) => t.completedAt! >= realStart && t.completedAt! <= realEnd)
      .reduce((s, t) => s + t.realHours, 0);
    const activityHours =
      weeklyActivities.filter((a) => a.createdAt >= realStart && a.createdAt <= realEnd).reduce((s, a) => s + a.duration, 0) / 60;
    const realHours = Math.round((fijaHours + activityHours) * 100) / 100;
    const range = computeWorkloadRange(
      realHours,
      baseHours,
      limitLowPerDay * businessDays,
      limitHighPerDay * businessDays,
      limitOverloadPerDay * businessDays,
    );
    return {
      weekLabel: `Sem ${i + 1}`,
      realHours,
      baseHours: Math.round(baseHours * 100) / 100,
      color: range.color,
      label: range.label,
    };
  });

  return { daily, weekly };
}
