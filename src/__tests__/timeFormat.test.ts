import { describe, expect, it } from "vitest";
import {
  displayToHours,
  hoursToDisplay,
  validateDisplayHours,
} from "@/lib/timeFormat";

describe("displayToHours (HH.MM -> horas decimales)", () => {
  it("convierte 6.30 (6h 30min) a 6.5 horas decimales", () => {
    expect(displayToHours("6.30")).toBe(6.5);
  });

  it("convierte 6.45 (6h 45min) a 6.75 horas decimales", () => {
    expect(displayToHours("6.45")).toBe(6.75);
  });

  it("convierte 0.00 a 0", () => {
    expect(displayToHours("0.00")).toBe(0);
  });

  it("convierte un valor entero sin parte decimal a esa cantidad de horas", () => {
    expect(displayToHours("8")).toBe(8);
  });
});

describe("hoursToDisplay (horas decimales -> HH.MM)", () => {
  it("convierte 6.5 horas decimales a '6.30'", () => {
    expect(hoursToDisplay(6.5)).toBe("6.30");
  });

  it("convierte 6.75 horas decimales a '6.45'", () => {
    expect(hoursToDisplay(6.75)).toBe("6.45");
  });

  it("convierte 0 a '0.00'", () => {
    expect(hoursToDisplay(0)).toBe("0.00");
  });

  it("redondea al minuto más cercano", () => {
    // 1.999 horas ~ 119.94 min -> redondea a 120 min = 2h 00min
    expect(hoursToDisplay(1.999)).toBe("2.00");
  });

  it("no produce horas negativas para entradas negativas", () => {
    expect(hoursToDisplay(-1)).toBe("0.00");
  });

  it("es la inversa de displayToHours para valores HH.MM válidos", () => {
    expect(hoursToDisplay(displayToHours("6.30"))).toBe("6.30");
    expect(hoursToDisplay(displayToHours("23.59"))).toBe("23.59");
  });
});

describe("validateDisplayHours", () => {
  it("acepta minutos válidos (0-59)", () => {
    expect(validateDisplayHours("6.30")).toBe(true);
    expect(validateDisplayHours("0.00")).toBe(true);
    expect(validateDisplayHours("23.59")).toBe(true);
  });

  it("rechaza minutos mayores a 59", () => {
    expect(validateDisplayHours("6.82")).toBe(false);
    expect(validateDisplayHours("6.60")).toBe(false);
  });

  it("acepta un valor sin parte decimal", () => {
    expect(validateDisplayHours("8")).toBe(true);
  });

  it("rechaza formatos con más de dos decimales", () => {
    expect(validateDisplayHours("6.300")).toBe(false);
  });

  it("rechaza formatos con una sola cifra decimal", () => {
    expect(validateDisplayHours("6.5")).toBe(false);
  });

  it("rechaza valores negativos o no numéricos", () => {
    expect(validateDisplayHours("-1.00")).toBe(false);
    expect(validateDisplayHours("abc")).toBe(false);
    expect(validateDisplayHours("")).toBe(false);
  });
});
