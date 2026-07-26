import { describe, expect, it } from "vitest";
import {
  businessCalendarDay,
  businessDayRealRange,
  BUSINESS_TZ_OFFSET_HOURS,
  weekendGraceDays,
  retroactiveValidDates,
} from "@/lib/businessTime";

// Semana de referencia: lunes 2024-01-08 a domingo 2024-01-14.
const MON = new Date(Date.UTC(2024, 0, 8));
const TUE = new Date(Date.UTC(2024, 0, 9));
const WED = new Date(Date.UTC(2024, 0, 10));
const THU = new Date(Date.UTC(2024, 0, 11));
const FRI = new Date(Date.UTC(2024, 0, 12));
const SAT = new Date(Date.UTC(2024, 0, 13));
const SUN = new Date(Date.UTC(2024, 0, 14));
const PREV_SAT = new Date(Date.UTC(2024, 0, 6));
const PREV_SUN = new Date(Date.UTC(2024, 0, 7));
const PREV_FRI = new Date(Date.UTC(2024, 0, 5));
const PREV_THU = new Date(Date.UTC(2024, 0, 4));

function isoDates(dates: Date[]): string[] {
  return dates.map((d) => d.toISOString().slice(0, 10));
}

describe("BUSINESS_TZ_OFFSET_HOURS", () => {
  it("es 5 (UTC-5, sin horario de verano)", () => {
    expect(BUSINESS_TZ_OFFSET_HOURS).toBe(5);
  });
});

describe("businessCalendarDay", () => {
  it("domingo 9pm hora de negocio (UTC-5) ya es lunes 2am UTC, pero el día calendario de negocio sigue siendo domingo", () => {
    const mondayEarlyUTC = new Date("2024-01-08T02:00:00.000Z");
    const result = businessCalendarDay(mondayEarlyUTC);
    expect(result.toISOString()).toBe("2024-01-07T00:00:00.000Z");
  });

  it("un instante bien entrado en el día UTC cae en el mismo día calendario de negocio", () => {
    const noonUTC = new Date("2024-01-10T12:00:00.000Z");
    const result = businessCalendarDay(noonUTC);
    expect(result.toISOString()).toBe("2024-01-10T00:00:00.000Z");
  });

  it("justo en el límite (05:00:00 UTC) ya pertenece al día calendario siguiente", () => {
    const atBoundary = new Date("2024-01-10T05:00:00.000Z");
    expect(businessCalendarDay(atBoundary).toISOString()).toBe("2024-01-10T00:00:00.000Z");
  });

  it("un instante justo antes del límite (04:59:59.999 UTC) todavía pertenece al día calendario anterior", () => {
    const beforeBoundary = new Date("2024-01-10T04:59:59.999Z");
    expect(businessCalendarDay(beforeBoundary).toISOString()).toBe("2024-01-09T00:00:00.000Z");
  });

  it("siempre devuelve una fecha en medianoche UTC exacta", () => {
    const result = businessCalendarDay(new Date("2024-03-15T17:45:23.123Z"));
    expect(result.getUTCHours()).toBe(0);
    expect(result.getUTCMinutes()).toBe(0);
    expect(result.getUTCSeconds()).toBe(0);
    expect(result.getUTCMilliseconds()).toBe(0);
  });
});

describe("businessDayRealRange", () => {
  it("devuelve el rango real UTC [05:00:00.000, 04:59:59.999 del día siguiente] para un día calendario dado", () => {
    const calDay = new Date(Date.UTC(2024, 0, 7)); // 2024-01-07 medianoche UTC
    const { start, end } = businessDayRealRange(calDay);
    expect(start.toISOString()).toBe("2024-01-07T05:00:00.000Z");
    expect(end.toISOString()).toBe("2024-01-08T04:59:59.999Z");
  });

  it("el rango abarca exactamente 24 horas", () => {
    const calDay = new Date(Date.UTC(2024, 5, 20));
    const { start, end } = businessDayRealRange(calDay);
    expect(end.getTime() - start.getTime()).toBe(24 * 3600000 - 1);
  });

  it("es la inversa de businessCalendarDay: cualquier instante dentro del rango mapea de vuelta al mismo día calendario", () => {
    const calDay = new Date(Date.UTC(2024, 2, 3));
    const { start, end } = businessDayRealRange(calDay);
    expect(businessCalendarDay(start).getTime()).toBe(calDay.getTime());
    expect(businessCalendarDay(end).getTime()).toBe(calDay.getTime());
  });
});

describe("weekendGraceDays", () => {
  it("lunes: expone el sábado y domingo inmediatos anteriores (domingo primero)", () => {
    expect(isoDates(weekendGraceDays(MON))).toEqual(["2024-01-07", "2024-01-06"]);
  });

  it("martes: expone el mismo fin de semana anterior que el lunes", () => {
    expect(isoDates(weekendGraceDays(TUE))).toEqual(["2024-01-07", "2024-01-06"]);
  });

  it("miércoles en adelante: el fin de semana ya no está disponible", () => {
    expect(weekendGraceDays(WED)).toEqual([]);
    expect(weekendGraceDays(THU)).toEqual([]);
    expect(weekendGraceDays(FRI)).toEqual([]);
  });

  it("sábado y domingo mismos no exponen ningún día (no son lunes/martes)", () => {
    expect(weekendGraceDays(SAT)).toEqual([]);
    expect(weekendGraceDays(SUN)).toEqual([]);
  });
});

describe("retroactiveValidDates", () => {
  it("lunes: 2 días laborables previos + fin de semana anterior, más reciente primero", () => {
    const result = retroactiveValidDates(MON, 2);
    expect(isoDates(result)).toEqual(["2024-01-07", "2024-01-06", "2024-01-05", "2024-01-04"]);
    expect(result.map((d) => d.getTime())).toEqual([PREV_SUN, PREV_SAT, PREV_FRI, PREV_THU].map((d) => d.getTime()));
  });

  it("martes: incluye el lunes hábil más el fin de semana previo", () => {
    expect(isoDates(retroactiveValidDates(TUE, 2))).toEqual(["2024-01-08", "2024-01-07", "2024-01-06", "2024-01-05"]);
  });

  it("miércoles: vuelve a ser solo la regla base de 2 días laborables, sin fin de semana", () => {
    expect(isoDates(retroactiveValidDates(WED, 2))).toEqual(["2024-01-09", "2024-01-08"]);
  });

  it("jueves y viernes: solo la regla base de 2 días laborables", () => {
    expect(isoDates(retroactiveValidDates(THU, 2))).toEqual(["2024-01-10", "2024-01-09"]);
    expect(isoDates(retroactiveValidDates(FRI, 2))).toEqual(["2024-01-11", "2024-01-10"]);
  });
});
