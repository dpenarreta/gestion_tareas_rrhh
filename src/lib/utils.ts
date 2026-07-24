import { businessCalendarDay } from "@/lib/businessTime";

/**
 * Formats a date as YYYY-MM-DD using UTC getters.
 *
 * Task.startDate/endDate (and similar date-only fields) are stored as
 * UTC-midnight calendar days. Reading them with local getters/toLocaleDateString
 * shifts the calendar day whenever the viewer's timezone is behind UTC (e.g.
 * America/Bogota, UTC-5) — see project memory on date handling. UTC getters
 * recover the calendar day that was actually entered, regardless of viewer
 * timezone.
 */
export function formatDate(date: string | Date): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Formats the time-of-day portion of a Date/ISO string as HH:mm, 24h (Sprint
 * B §5 — formato único de hora en toda la plataforma, sin AM/PM). Centraliza
 * el patrón `toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit",
 * hour12: false })` que hoy se repite suelto en varios componentes.
 */
export function formatTime(date: string | Date, locale = "es-CL"): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", hour12: false });
}

/**
 * UTC-midnight timestamp (ms) for the calendar day of a UTC-midnight date
 * field (e.g. Task.endDate). Exported so any comparison against a pure
 * calendar-day field reuses this instead of reimplementing it — see
 * `isCompletedOnTime` (`src/lib/priorityCompliance.ts`) for a second caller.
 */
export function utcCalendarDay(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

/**
 * A task is overdue only once the current calendar day is strictly AFTER its
 * end date's calendar day — a task due 2026-07-05 stays vigente through all
 * of 2026-07-05 and only becomes overdue starting 2026-07-06 00:00:00.
 * Comparing raw Date/timestamps (endDate < now) marks a task overdue on its
 * own due day, since endDate is UTC-midnight but "now" almost always has a
 * later time-of-day component.
 *
 * `referenceDate` ("now") is read in Nexo's business timezone (UTC-5, see
 * `businessCalendarDay`) since servers commonly run their clock in UTC —
 * without this shift, a task could be marked overdue up to 5 hours before
 * its due day actually ends for the user. `endDate` is a pure calendar date
 * (UTC-midnight by storage convention) and is read as-is, unshifted.
 *
 * `referenceDate` defaults to the real current time (for live views); pass a
 * capped reference (e.g. a past month's end) when computing historical KPIs.
 */
export function isTaskOverdue(
  endDate: string | Date,
  status: string,
  referenceDate: Date = new Date()
): boolean {
  if (status === "COMPLETADA") return false;
  const end = typeof endDate === "string" ? new Date(endDate) : endDate;
  return businessCalendarDay(referenceDate).getTime() > utcCalendarDay(end);
}
