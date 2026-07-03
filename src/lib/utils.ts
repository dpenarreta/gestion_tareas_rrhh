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
