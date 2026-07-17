import "server-only";
import { prisma } from "@/lib/prisma";

/** Set de timestamps (getTime()) de días feriados UTC-medianoche — para lookup O(1) por día. */
export async function getHolidaySet(): Promise<Set<number>> {
  const holidays = await prisma.holiday.findMany({ select: { date: true } });
  return new Set(holidays.map((h) => h.date.getTime()));
}
