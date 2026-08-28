import "server-only";
import { fetchDjangoHolidaySet } from "@/lib/djangoHolidaysAdapter";

/** Set de timestamps (getTime()) de días feriados UTC-medianoche — para lookup O(1) por día. */
export async function getHolidaySet(): Promise<Set<number>> {
  return fetchDjangoHolidaySet();
}
