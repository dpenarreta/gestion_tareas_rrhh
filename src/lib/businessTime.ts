/**
 * Nexo opera en horario de Ecuador/Colombia (America/Guayaquil o Bogotá,
 * UTC-5, sin horario de verano). Los servidores (p. ej. Vercel) suelen
 * correr con reloj en UTC, así que cualquier cálculo de "qué día es hoy" en
 * tiempo real debe desplazar el instante actual a este huso ANTES de leer
 * el día calendario — de lo contrario "hoy" puede adelantarse hasta 5 horas
 * respecto al día real del usuario (p. ej. domingo 9pm local ya es lunes
 * 2am UTC).
 *
 * Esto NO aplica a campos de fecha pura (p. ej. Task.endDate, almacenados
 * como medianoche UTC por convención) — esos ya representan un día
 * calendario sin ambigüedad y no deben desplazarse.
 */
export const BUSINESS_TZ_OFFSET_HOURS = 5;

/** UTC-midnight Date for the business-timezone calendar day that `instant` falls on. */
export function businessCalendarDay(instant: Date): Date {
  const shifted = new Date(instant.getTime() - BUSINESS_TZ_OFFSET_HOURS * 3600000);
  return new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()));
}

/**
 * The real UTC instant range spanning a business-timezone calendar day —
 * for comparing against genuine timestamps (e.g. TaskActivity.createdAt),
 * as opposed to date-only fields like Task.endDate.
 */
export function businessDayRealRange(calDay: Date): { start: Date; end: Date } {
  const start = new Date(
    Date.UTC(calDay.getUTCFullYear(), calDay.getUTCMonth(), calDay.getUTCDate(), BUSINESS_TZ_OFFSET_HOURS)
  );
  return { start, end: new Date(start.getTime() + 86400000 - 1) };
}

/** Lunes a viernes, evaluado sobre un Date UTC-medianoche (ver businessCalendarDay). */
export function isBusinessDay(calDay: Date): boolean {
  const dow = calDay.getUTCDay();
  return dow !== 0 && dow !== 6;
}

/**
 * Los `count` días laborables (lun-vie) más recientes, estrictamente anteriores a
 * `today`, en orden descendente (el más reciente primero). `today` debe ser un
 * Date UTC-medianoche (ver businessCalendarDay) — usado para acotar la ventana de
 * registro retroactivo de horas a los últimos N días laborables.
 */
export function previousBusinessDays(today: Date, count: number): Date[] {
  const days: Date[] = [];
  const cursor = new Date(today);
  while (days.length < count) {
    cursor.setUTCDate(cursor.getUTCDate() - 1);
    if (isBusinessDay(cursor)) days.push(new Date(cursor));
  }
  return days;
}

/**
 * "YYYY-MM-DD" (de un `<input type="date">`, sin componente horario) -> Date
 * UTC-medianoche. Antes de Sprint D estaba duplicado idéntico en el registro
 * retroactivo de Tareas y en las actividades de Proyectos — ver
 * docs/AUDIT_LOG.md § Sprint D.
 */
export function parseDateOnly(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [y, m, d] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(y, m - 1, d));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
