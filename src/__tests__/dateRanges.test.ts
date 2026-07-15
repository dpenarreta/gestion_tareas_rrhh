import { describe, expect, it } from "vitest";
import { dayBounds, weekBounds, monthBounds } from "@/lib/dateRanges";

describe("dayBounds", () => {
  it("start es medianoche y end es el último milisegundo del mismo día calendario (hora local)", () => {
    const d = new Date(2024, 5, 15, 14, 30, 0);
    const { start, end } = dayBounds(d);
    expect(start.toDateString()).toBe(d.toDateString());
    expect(end.toDateString()).toBe(d.toDateString());
    expect([start.getHours(), start.getMinutes(), start.getSeconds(), start.getMilliseconds()]).toEqual([0, 0, 0, 0]);
    expect([end.getHours(), end.getMinutes(), end.getSeconds(), end.getMilliseconds()]).toEqual([23, 59, 59, 999]);
  });
});

describe("weekBounds", () => {
  it("start cae en lunes y end en domingo de la misma semana", () => {
    const d = new Date(2024, 5, 19); // miércoles
    const { start, end } = weekBounds(d);
    expect(start.getDay()).toBe(1);
    expect(end.getDay()).toBe(0);
  });

  it("abarca exactamente 7 días calendario (lunes 00:00 a domingo 23:59:59.999)", () => {
    const d = new Date(2024, 5, 19);
    const { start, end } = weekBounds(d);
    const diffMs = end.getTime() - start.getTime();
    expect(diffMs).toBe(7 * 86400000 - 1);
  });

  it("un domingo pertenece a la semana que termina ese mismo día (no a la siguiente)", () => {
    const sunday = new Date(2024, 5, 23); // domingo
    const { start, end } = weekBounds(sunday);
    expect(end.toDateString()).toBe(sunday.toDateString());
    expect(start.getDay()).toBe(1);
  });

  it("un lunes es el propio inicio de su semana", () => {
    const monday = new Date(2024, 5, 17);
    const { start } = weekBounds(monday);
    expect(start.toDateString()).toBe(monday.toDateString());
  });
});

describe("monthBounds", () => {
  it("start es el día 1 del mes y end es el último día, a las 23:59:59.999", () => {
    const d = new Date(2024, 1, 10); // febrero (bisiesto en 2024)
    const { start, end } = monthBounds(d);
    expect(start.getDate()).toBe(1);
    expect(start.getMonth()).toBe(1);
    expect(end.getDate()).toBe(29); // 2024 es bisiesto
    expect(end.getMonth()).toBe(1);
    expect([end.getHours(), end.getMinutes(), end.getSeconds(), end.getMilliseconds()]).toEqual([23, 59, 59, 999]);
  });

  it("calcula correctamente el último día en un mes no bisiesto (febrero 2023 = 28 días)", () => {
    const { end } = monthBounds(new Date(2023, 1, 5));
    expect(end.getDate()).toBe(28);
  });

  it("calcula correctamente el último día de un mes de 31 días", () => {
    const { end } = monthBounds(new Date(2024, 0, 15)); // enero
    expect(end.getDate()).toBe(31);
  });
});
