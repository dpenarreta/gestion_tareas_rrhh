import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/systemConfig", () => ({
  getEffectivePredictionWindowWeeks: vi.fn().mockResolvedValue("3"),
}));

const { PREDICTION_WINDOW_OPTIONS, isValidPredictionWindow, getEffectivePredictionWindowWeeksNumber } = await import("@/lib/predictiveConfig");

describe("PREDICTION_WINDOW_OPTIONS", () => {
  it("incluye exactamente las 5 opciones del pedido (3/4/6/8/12 semanas), 3 como predeterminado", () => {
    expect(PREDICTION_WINDOW_OPTIONS).toEqual(["3", "4", "6", "8", "12"]);
  });
});

describe("isValidPredictionWindow", () => {
  it("acepta cada opción válida", () => {
    for (const v of PREDICTION_WINDOW_OPTIONS) expect(isValidPredictionWindow(v)).toBe(true);
  });

  it("rechaza valores fuera de la lista", () => {
    expect(isValidPredictionWindow("5")).toBe(false);
    expect(isValidPredictionWindow("0")).toBe(false);
    expect(isValidPredictionWindow("indefinite")).toBe(false);
    expect(isValidPredictionWindow("")).toBe(false);
  });
});

describe("getEffectivePredictionWindowWeeksNumber", () => {
  it("devuelve el valor efectivo parseado como número", async () => {
    expect(await getEffectivePredictionWindowWeeksNumber()).toBe(3);
  });
});
