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
import { getSpecialStatusDayMap, getTeamSpecialStatusDayMap, type SpecialStatusDayMap } from "@/lib/specialStatus";
import type { SpecialStatusType } from "@/generated/prisma/client";
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

type SpecialStatusBaseField = "dailyHours" | "limitBase";

/**
 * Suma, día a día, una base "leave-aware" (horasPorDía - permisos ese día) de los
 * días laborables del rango — `field` decide qué usar como horas del día en días
 * con estado especial vigente: `dailyHours` da el `baseHours` "de exhibición" (horas
 * objetivo/denominador del %); `limitBase` da el umbral real de clasificación
 * Moderado/Óptimo (ver computeWorkloadRange). Ambos son sensibles a permisos (igual
 * que el sistema global, donde ambos roles históricamente los cumplía una sola
 * variable, `hoursPerDay`) — a diferencia de limitLow/High/Overload (sumWeightedLimit),
 * que nunca se ajustan por permisos.
 */
function sumWeightedBaseHours(
  start: Date,
  end: Date,
  hoursPerDay: number,
  holidays: Set<number>,
  leaveMap: Map<number, DayLeaveInfo>,
  specialMap: SpecialStatusDayMap = new Map(),
  field: SpecialStatusBaseField = "dailyHours"
): number {
  let total = 0;
  for (let t = start.getTime(); t <= end.getTime(); t += 86400000) {
    const d = new Date(t);
    if (!isWorkingDay(d, holidays)) continue;
    const cfg = specialMap.get(t);
    const dayValue = cfg ? cfg[field] : hoursPerDay;
    const leaveHours = leaveHoursForDay(leaveMap.get(t), dayValue);
    total += Math.max(0, dayValue - leaveHours);
  }
  return Math.round(total * 100) / 100;
}

type SpecialStatusLimitField = "limitLow" | "limitHigh" | "limitOverload";

/**
 * Suma, día a día, uno de los 3 límites externos del semáforo (low/high/overload,
 * NUNCA ajustados por permisos — igual que el sistema global) de los días laborables
 * del rango — usa el valor configurado por registro en días con estado especial
 * vigente (`specialMap`), y el límite global (per-día) el resto de días.
 */
function sumWeightedLimit(
  start: Date,
  end: Date,
  holidays: Set<number>,
  specialMap: SpecialStatusDayMap,
  globalLimitPerDay: number,
  field: SpecialStatusLimitField
): number {
  let total = 0;
  for (let t = start.getTime(); t <= end.getTime(); t += 86400000) {
    const d = new Date(t);
    if (!isWorkingDay(d, holidays)) continue;
    const cfg = specialMap.get(t);
    total += cfg ? cfg[field] : globalLimitPerDay;
  }
  return Math.round(total * 100) / 100;
}

/** Tipo de estado especial (si alguno) vigente en cualquier día dentro de [start, end]. */
function specialStatusTypeInRange(
  specialMap: SpecialStatusDayMap,
  start: Date,
  end: Date
): SpecialStatusType | null {
  for (let t = start.getTime(); t <= end.getTime(); t += 86400000) {
    const cfg = specialMap.get(t);
    if (cfg) return cfg.type;
  }
  return null;
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
  // Umbral de clasificación Moderado/Óptimo, ya escalado — para el equipo global
  // coincide siempre con `baseHours` (mismo hoursPerDay), pero se expone aparte
  // porque monthlyBusinessBaseForUsers sí puede diferenciarlo por usuario.
  limitBaseHours: number;
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
  const baseHours = businessDays * hoursPerDay;
  return {
    start,
    end,
    businessDays,
    baseHours,
    hoursPerDay,
    limitLowPerDay,
    limitHighPerDay,
    limitOverloadPerDay,
    limitLowHours: businessDays * limitLowPerDay,
    limitBaseHours: baseHours,
    limitHighHours: businessDays * limitHighPerDay,
    limitOverloadHours: businessDays * limitOverloadPerDay,
  };
}

export type MonthlyBusinessBase = Awaited<ReturnType<typeof monthlyBusinessBase>>;

/**
 * Igual que monthlyBusinessBase, pero devuelve además overrides por usuario para
 * quienes tengan un estado especial (maternidad/lactancia) vigente en algún día del
 * mes — usado por los informes de equipo, donde por defecto todos comparten la
 * misma base/límites (`shared`), salvo los usuarios presentes en `perUser`. Una sola
 * consulta a SpecialStatus para todo el equipo (no N+1 por usuario). `baseHours`
 * (dailyHours-ponderado) es la base de exhibición/denominador del %; `limitBaseHours`
 * (limitBase-ponderado) es el umbral real de clasificación Moderado/Óptimo — pueden
 * diferir si el registro configuró dailyHours ≠ limitBase.
 */
export async function monthlyBusinessBaseForUsers(
  userIds: string[],
  year: number,
  month: number
): Promise<{ shared: MonthlyBusinessBase; perUser: Map<string, MonthlyBusinessBase> }> {
  const shared = await monthlyBusinessBase(year, month);
  const perUser = new Map<string, MonthlyBusinessBase>();
  const teamSpecialMap = await getTeamSpecialStatusDayMap(userIds, shared.start, shared.end);
  if (teamSpecialMap.size === 0) return { shared, perUser };

  const holidays = await getHolidaySet();
  for (const [userId, dayMap] of teamSpecialMap) {
    if (dayMap.size === 0) continue;
    const baseHours = sumWeightedBaseHours(shared.start, shared.end, shared.hoursPerDay, holidays, new Map(), dayMap, "dailyHours");
    const limitBaseHours = sumWeightedBaseHours(shared.start, shared.end, shared.hoursPerDay, holidays, new Map(), dayMap, "limitBase");
    const limitLowHours = sumWeightedLimit(shared.start, shared.end, holidays, dayMap, shared.limitLowPerDay, "limitLow");
    const limitHighHours = sumWeightedLimit(shared.start, shared.end, holidays, dayMap, shared.limitHighPerDay, "limitHigh");
    const limitOverloadHours = sumWeightedLimit(shared.start, shared.end, holidays, dayMap, shared.limitOverloadPerDay, "limitOverload");
    perUser.set(userId, { ...shared, baseHours, limitBaseHours, limitLowHours, limitHighHours, limitOverloadHours });
  }
  return { shared, perUser };
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

/**
 * `baseHours` es la base de exhibición (horas objetivo — dailyHours-derivada, usada
 * para narrativa/comparaciones como "X horas reales de Y horas base") y
 * `classificationBase` es el umbral real de clasificación Moderado/Óptimo
 * (limitBase-derivado). El techo de 100% del % de carga se mide TAMBIÉN sobre
 * `classificationBase` (no sobre `baseHours`) para que el % nunca contradiga al
 * semáforo — p. ej. si dailyHours < limitBase, alcanzar el 100% antes de tiempo
 * mientras el semáforo aún marca "Moderado" sería inconsistente. Para todo período
 * SIN estado especial ambos valores son idénticos (los dos vienen de `hoursPerDay`),
 * así que el comportamiento no cambia; solo se separan para permitir que un registro
 * de estado especial configure dailyHours y limitBase de forma independiente.
 */
function toMetric(
  realHours: number,
  baseHours: number,
  classificationBase: number,
  hoursPerDay: number,
  limitLow: number,
  limitHigh: number,
  limitOverload: number,
): WorkloadMetric {
  const range = computeWorkloadRange(realHours, classificationBase, limitLow, limitHigh, limitOverload);
  const pct =
    classificationBase > 0
      ? computeWorkloadPct(realHours, classificationBase, range.max)
      : Math.round((realHours / hoursPerDay) * 100);
  return {
    realHours,
    baseHours,
    pct,
    color: range.color,
    // rangeMin/rangeMax describen la zona Óptima (verde) en sí: [classificationBase, limitHigh].
    rangeMin: classificationBase > 0 ? Math.round(classificationBase * 100) / 100 : 0,
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
  const [hoursPerDay, limitLowPerDay, limitHighPerDay, limitOverloadPerDay, holidays, leaveMap, specialMap, user] = await Promise.all([
    getEffectiveHorasEfectivas(now),
    getEffectiveWorkloadLimitLow(now),
    getEffectiveWorkloadLimitHigh(now),
    getEffectiveWorkloadLimitOverload(now),
    getHolidaySet(),
    getLeaveMinutesByDay(userId, monthStart, monthEnd),
    getSpecialStatusDayMap(userId, monthStart, monthEnd),
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
  const todayCfg = specialMap.get(today.getTime()) ?? null;
  const todaySpecialStatusType = todayCfg?.type ?? null;
  // Estado especial vigente (maternidad/lactancia): la envolvente del día usa la
  // base/límites configurados en el registro (dailyHours/limitLow/limitBase/
  // limitHigh/limitOverload) en vez de los configurados globalmente.
  const todayDailyHours = todayCfg ? todayCfg.dailyHours : hoursPerDay;
  const todayClassificationBase = todayCfg ? todayCfg.limitBase : hoursPerDay;
  const todayLimitLowPerDay = todayCfg ? todayCfg.limitLow : limitLowPerDay;
  const todayLimitHighPerDay = todayCfg ? todayCfg.limitHigh : limitHighPerDay;
  const todayLimitOverloadPerDay = todayCfg ? todayCfg.limitOverload : limitOverloadPerDay;
  const todayLeaveHours = leaveHoursForDay(todayLeaveInfo, todayDailyHours);
  // Un permiso (parcial o completo) reduce proporcionalmente TODA la envolvente
  // del día (base y los 4 límites) — así un permiso de 3h en un día de 6.5h no
  // marca falsamente "Subutilización" solo porque el límite bajo (p. ej. 5.5h)
  // quedó por encima de la base ya reducida (3.5h).
  const dayFactor = todayDailyHours > 0 ? Math.max(0, 1 - todayLeaveHours / todayDailyHours) : 1;
  const dailyBaseHours = todayIsWeekendDay || todayIsHolidayDay ? 0 : todayDailyHours * dayFactor;
  const dailyClassificationBase = todayClassificationBase * dayFactor;
  const dailyLimitLow = todayLimitLowPerDay * dayFactor;
  const dailyLimitHigh = todayLimitHighPerDay * dayFactor;
  const dailyLimitOverload = todayLimitOverloadPerDay * dayFactor;

  const weeklyBusinessDays = countBusinessDays(effectiveWeekStart, weekEnd, holidays);
  const weeklyBaseHours = sumWeightedBaseHours(effectiveWeekStart, weekEnd, hoursPerDay, holidays, leaveMap, specialMap, "dailyHours");
  const weeklyClassificationBase = sumWeightedBaseHours(effectiveWeekStart, weekEnd, hoursPerDay, holidays, leaveMap, specialMap, "limitBase");
  const weeklyLimitLowHours = sumWeightedLimit(effectiveWeekStart, weekEnd, holidays, specialMap, limitLowPerDay, "limitLow");
  const weeklyLimitHighHours = sumWeightedLimit(effectiveWeekStart, weekEnd, holidays, specialMap, limitHighPerDay, "limitHigh");
  const weeklyLimitOverloadHours = sumWeightedLimit(effectiveWeekStart, weekEnd, holidays, specialMap, limitOverloadPerDay, "limitOverload");
  const weeklySpecialStatusType = specialStatusTypeInRange(specialMap, effectiveWeekStart, weekEnd);
  const monthlyBusinessDays = countBusinessDays(effectiveMonthStart, monthEnd, holidays);
  const monthlyBaseHours = sumWeightedBaseHours(effectiveMonthStart, monthEnd, hoursPerDay, holidays, leaveMap, specialMap, "dailyHours");
  const monthlyClassificationBase = sumWeightedBaseHours(effectiveMonthStart, monthEnd, hoursPerDay, holidays, leaveMap, specialMap, "limitBase");
  const monthlyLimitLowHours = sumWeightedLimit(effectiveMonthStart, monthEnd, holidays, specialMap, limitLowPerDay, "limitLow");
  const monthlyLimitHighHours = sumWeightedLimit(effectiveMonthStart, monthEnd, holidays, specialMap, limitHighPerDay, "limitHigh");
  const monthlyLimitOverloadHours = sumWeightedLimit(effectiveMonthStart, monthEnd, holidays, specialMap, limitOverloadPerDay, "limitOverload");
  const monthlySpecialStatusType = specialStatusTypeInRange(specialMap, effectiveMonthStart, monthEnd);

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
        specialStatusType: todaySpecialStatusType,
      }
    : {
        ...toMetric(diariaHours, dailyBaseHours, dailyClassificationBase, todayDailyHours, dailyLimitLow, dailyLimitHigh, dailyLimitOverload),
        isHoliday: false,
        medicoLeaveMinutes: todayLeaveInfo?.medicoMinutes ?? 0,
        medicoLeaveFullDay: todayLeaveInfo?.medicoFullDay ?? false,
        personalLeaveMinutes: todayLeaveInfo?.personalMinutes ?? 0,
        personalLeaveFullDay: todayLeaveInfo?.personalFullDay ?? false,
        vacacionesFullDay: todayLeaveInfo?.vacacionesFullDay ?? false,
        specialStatusType: todaySpecialStatusType,
      };

  return {
    diaria: diariaMetric,
    semanal: {
      ...toMetric(
        semanalHours,
        weeklyBaseHours,
        weeklyClassificationBase,
        hoursPerDay,
        weeklyLimitLowHours,
        weeklyLimitHighHours,
        weeklyLimitOverloadHours,
      ),
      weekStartLabel: formatShortDate(weekBizStart),
      weekEndLabel: formatShortDate(weekBizEnd),
      businessDays: weeklyBusinessDays,
      weekendHours,
      specialStatusType: weeklySpecialStatusType,
    },
    mensual: {
      ...toMetric(
        mensualHours,
        monthlyBaseHours,
        monthlyClassificationBase,
        hoursPerDay,
        monthlyLimitLowHours,
        monthlyLimitHighHours,
        monthlyLimitOverloadHours,
      ),
      monthLabel: formatMonthLabel(today),
      businessDays: monthlyBusinessDays,
      weekendHours: monthlyWeekendHours,
      holidayHours: monthlyHolidayHours,
      medicoLeaveMinutes: monthlyLeaveTotals.medicoMinutes,
      personalLeaveMinutes: monthlyLeaveTotals.personalMinutes,
      vacacionesMinutes: monthlyLeaveTotals.vacacionesMinutes,
      specialStatusType: monthlySpecialStatusType,
    },
    horasEfectivasPorDia: hoursPerDay,
    workloadLimitLow: limitLowPerDay,
    workloadLimitHigh: limitHighPerDay,
    workloadLimitOverload: limitOverloadPerDay,
    // "Efectivos hoy": el estado especial vigente HOY (si hay) o, si no, los valores
    // globales — usados para el resumen de rangos y las líneas de referencia de los
    // gráficos, en vez de asumir siempre la configuración global (ver WorkloadCard.tsx).
    effectiveHoursPerDia: todayDailyHours,
    effectiveLimitLow: todayLimitLowPerDay,
    effectiveLimitBase: todayClassificationBase,
    effectiveLimitHigh: todayLimitHighPerDay,
    effectiveLimitOverload: todayLimitOverloadPerDay,
    kpiStartDate: kpiStartApplies ? kpiStartDate!.toISOString() : null,
    // El histórico (para los gráficos) es una consulta aparte y más cara
    // (computeCargaHistory) — se deja vacío aquí para que llamadores que solo
    // necesitan el snapshot actual (p. ej. el mensaje diario de Nova) no paguen
    // ese costo. Las rutas de KPI que sí muestran gráficos la completan aparte.
    dailyHistory: [],
    weeklyHistory: [],
    // Siempre true aquí: esta función no conoce quién es el viewer. Los endpoints
    // que exponen datos de OTRO usuario (no el propio) aplican
    // redactSensitiveWorkloadDetail antes de responder — ver /api/kpis/[userId].
    sensitiveDetailVisible: true,
  };
}

/**
 * Reduce el detalle de tipo de permiso (médico/personal/vacaciones) y de estado
 * especial (maternidad/lactancia) a un indicador genérico de "ausencia
 * justificada" — para viewers que no son el propio titular ni el Administrador.
 * Los permisos médicos y el estado de maternidad/lactancia son datos de salud,
 * categoría especial bajo el Art. 26 LOPDP (ver docs/RAT.md, sección 5 y 10):
 * un superior en la jerarquía puede ver que hay horas de ausencia justificada
 * (para interpretar la carga laboral correctamente) pero no el tipo específico.
 */
export function redactSensitiveWorkloadDetail(cargaTiempo: CargaTiempo): CargaTiempo {
  const diaria = cargaTiempo.diaria;
  const diariaLeaveMinutes = (diaria.medicoLeaveMinutes ?? 0) + (diaria.personalLeaveMinutes ?? 0);
  const diariaFullDay =
    (diaria.medicoLeaveFullDay ?? false) ||
    (diaria.personalLeaveFullDay ?? false) ||
    (diaria.vacacionesFullDay ?? false);

  const mensual = cargaTiempo.mensual;
  const mensualLeaveMinutes =
    (mensual.medicoLeaveMinutes ?? 0) + (mensual.personalLeaveMinutes ?? 0) + (mensual.vacacionesMinutes ?? 0);

  return {
    ...cargaTiempo,
    diaria: {
      ...diaria,
      medicoLeaveMinutes: 0,
      medicoLeaveFullDay: false,
      personalLeaveMinutes: diariaLeaveMinutes,
      personalLeaveFullDay: diariaFullDay,
      vacacionesFullDay: false,
      specialStatusType: null,
    },
    semanal: { ...cargaTiempo.semanal, specialStatusType: null },
    mensual: {
      ...mensual,
      medicoLeaveMinutes: 0,
      personalLeaveMinutes: mensualLeaveMinutes,
      vacacionesMinutes: 0,
      specialStatusType: null,
    },
    dailyHistory: cargaTiempo.dailyHistory.map((p) => ({
      ...p,
      specialStatusType: null,
      kind:
        p.kind === "leave-medico" || p.kind === "leave-personal" || p.kind === "leave-vacaciones"
          ? "leave-generic"
          : p.kind,
    })),
    weeklyHistory: cargaTiempo.weeklyHistory.map((p) => ({ ...p, specialStatusType: null })),
    sensitiveDetailVisible: false,
  };
}

function formatIsoDate(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

/**
 * Histórico para los gráficos de carga laboral: TODOS los días del mes en
 * curso desde `kpiStartDate` (si está configurado) o el día 1, hasta HOY
 * (nunca días futuros) — para el gráfico deslizable de "Días laborables del
 * mes" — y las semanas del mes en curso hasta hoy (línea). Aparte de
 * computeCargaTiempo a propósito — es una consulta más cara y solo la
 * necesitan las vistas de Analytics/Mi actividad que renderizan los gráficos.
 */
export async function computeCargaHistory(
  userId: string,
  now: Date = new Date(),
): Promise<{ daily: DailyCargaPoint[]; weekly: WeeklyCargaPoint[] }> {
  const today = businessCalendarDay(now);
  const monthStart = utcMonthStart(today);
  const [hoursPerDay, limitLowPerDay, limitHighPerDay, limitOverloadPerDay, holidays, user] = await Promise.all([
    getEffectiveHorasEfectivas(now),
    getEffectiveWorkloadLimitLow(now),
    getEffectiveWorkloadLimitHigh(now),
    getEffectiveWorkloadLimitOverload(now),
    getHolidaySet(),
    prisma.user.findUnique({ where: { id: userId }, select: { kpiStartDate: true } }),
  ]);
  const kpiStartDate = user?.kpiStartDate ?? null;

  // ── Diario: todo el rango kpiStartDate/día 1 → hoy (nunca futuro) ──
  const effectiveMonthStart = kpiStartDate && kpiStartDate.getTime() > monthStart.getTime() ? kpiStartDate : monthStart;
  const rangeEnd = today;

  const daily: DailyCargaPoint[] = [];
  if (effectiveMonthStart.getTime() <= rangeEnd.getTime()) {
    const [leaveMap, dailySpecialMap] = await Promise.all([
      getLeaveMinutesByDay(userId, effectiveMonthStart, rangeEnd),
      getSpecialStatusDayMap(userId, effectiveMonthStart, rangeEnd),
    ]);
    const { start: dailyRealStart } = businessDayRealRange(effectiveMonthStart);
    const { end: dailyRealEnd } = businessDayRealRange(rangeEnd);
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

    const realHoursForDay = (day: Date): number => {
      const { start, end } = businessDayRealRange(day);
      const fijaHours = dailyFijaTasks
        .filter((t) => t.completedAt! >= start && t.completedAt! <= end)
        .reduce((s, t) => s + t.realHours, 0);
      const activityHours =
        dailyActivities.filter((a) => a.createdAt >= start && a.createdAt <= end).reduce((s, a) => s + a.duration, 0) / 60;
      return Math.round((fijaHours + activityHours) * 100) / 100;
    };

    for (let t = effectiveMonthStart.getTime(); t <= rangeEnd.getTime(); t += 86400000) {
      const day = new Date(t);
      const realHours = realHoursForDay(day);
      const dayCfg = dailySpecialMap.get(t) ?? null;
      const specialStatusType = dayCfg?.type ?? null;
      const base = {
        date: formatIsoDate(day),
        dayLabel: `${DAY_ABBR[day.getUTCDay()]} ${formatShortDate(day)}`,
        specialStatusType,
      };

      // Fin de semana: sin base laboral — solo aparece si se trabajó ese día (extra).
      if (!isBusinessDay(day)) {
        if (realHours > 0) {
          daily.push({ ...base, realHours, baseHours: 0, color: "orange", label: "Carga elevada", kind: "weekend-extra" });
        }
        continue;
      }

      // Feriado configurado: sin base laboral, se muestra igual (barra gris).
      if (holidays.has(t)) {
        daily.push({ ...base, realHours, baseHours: 0, color: "green", label: "Óptimo", kind: "holiday" });
        continue;
      }

      const leaveInfo = leaveMap.get(t);
      if (leaveInfo?.medicoFullDay) {
        daily.push({ ...base, realHours, baseHours: 0, color: "green", label: "Óptimo", kind: "leave-medico" });
        continue;
      }
      if (leaveInfo?.personalFullDay) {
        daily.push({ ...base, realHours, baseHours: 0, color: "green", label: "Óptimo", kind: "leave-personal" });
        continue;
      }
      if (leaveInfo?.vacacionesFullDay) {
        daily.push({ ...base, realHours, baseHours: 0, color: "green", label: "Óptimo", kind: "leave-vacaciones" });
        continue;
      }

      // Día laborable normal — un permiso parcial (médico/personal) reduce
      // proporcionalmente la base y los 4 límites del día, igual que en
      // computeCargaTiempo (ver dayFactor allí).
      const dayDailyHours = dayCfg ? dayCfg.dailyHours : hoursPerDay;
      const dayClassificationBase = dayCfg ? dayCfg.limitBase : hoursPerDay;
      const dayLimitLow = dayCfg ? dayCfg.limitLow : limitLowPerDay;
      const dayLimitHigh = dayCfg ? dayCfg.limitHigh : limitHighPerDay;
      const dayLimitOverload = dayCfg ? dayCfg.limitOverload : limitOverloadPerDay;
      const leaveHours = leaveHoursForDay(leaveInfo, dayDailyHours);
      const dayFactor = dayDailyHours > 0 ? Math.max(0, 1 - leaveHours / dayDailyHours) : 1;
      const dayBaseHours = dayDailyHours * dayFactor;
      const dayClassBase = dayClassificationBase * dayFactor;
      const range = computeWorkloadRange(
        realHours,
        dayClassBase,
        dayLimitLow * dayFactor,
        dayLimitHigh * dayFactor,
        dayLimitOverload * dayFactor,
      );
      const isEmpty = realHours === 0 && leaveHours === 0;
      daily.push({
        ...base,
        realHours,
        baseHours: dayBaseHours,
        color: range.color,
        label: range.label,
        kind: isEmpty ? "empty" : "normal",
      });
    }
  }

  // ── Semanal: semanas del mes en curso, hasta la semana de hoy ──
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
  const weeklySpecialMap = await getSpecialStatusDayMap(userId, weeklyRangeStart, weeklyRangeEnd);

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
    // sumWeightedBaseHours/sumWeightedLimit ponderan día a día por si la semana mezcla
    // días con estado especial y días con las horas efectivas/límites globales.
    const baseHours = sumWeightedBaseHours(slice.start, slice.end, hoursPerDay, holidays, new Map(), weeklySpecialMap, "dailyHours");
    const classificationBase = sumWeightedBaseHours(slice.start, slice.end, hoursPerDay, holidays, new Map(), weeklySpecialMap, "limitBase");
    const limitLowHours = sumWeightedLimit(slice.start, slice.end, holidays, weeklySpecialMap, limitLowPerDay, "limitLow");
    const limitHighHours = sumWeightedLimit(slice.start, slice.end, holidays, weeklySpecialMap, limitHighPerDay, "limitHigh");
    const limitOverloadHours = sumWeightedLimit(slice.start, slice.end, holidays, weeklySpecialMap, limitOverloadPerDay, "limitOverload");
    const { start: realStart } = businessDayRealRange(slice.start);
    const { end: realEnd } = businessDayRealRange(slice.end);
    const fijaHours = weeklyFijaTasks
      .filter((t) => t.completedAt! >= realStart && t.completedAt! <= realEnd)
      .reduce((s, t) => s + t.realHours, 0);
    const activityHours =
      weeklyActivities.filter((a) => a.createdAt >= realStart && a.createdAt <= realEnd).reduce((s, a) => s + a.duration, 0) / 60;
    const realHours = Math.round((fijaHours + activityHours) * 100) / 100;
    const range = computeWorkloadRange(realHours, classificationBase, limitLowHours, limitHighHours, limitOverloadHours);
    return {
      weekLabel: `Sem ${i + 1}`,
      realHours,
      baseHours: Math.round(baseHours * 100) / 100,
      color: range.color,
      label: range.label,
      specialStatusType: specialStatusTypeInRange(weeklySpecialMap, slice.start, slice.end),
    };
  });

  return { daily, weekly };
}
