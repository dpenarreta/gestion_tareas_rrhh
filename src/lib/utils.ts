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

function utcCalendarDay(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

/**
 * A task is overdue only once the current calendar day is strictly AFTER its
 * end date's calendar day — a task due 2026-07-03 is not overdue until
 * 2026-07-04. Comparing raw Date/timestamps (endDate < now) marks a task
 * overdue on its own due day, since endDate is UTC-midnight but "now" almost
 * always has a later time-of-day component.
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
  return utcCalendarDay(referenceDate) > utcCalendarDay(end);
}
