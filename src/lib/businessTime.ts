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
