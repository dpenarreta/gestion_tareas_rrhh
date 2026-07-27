import { describe, expect, it } from "vitest";
import { classifyTrendDirection } from "@/lib/trendEngine";

describe("classifyTrendDirection", () => {
  it("menos de 2 puntos → estable, sin pendiente ni CV", () => {
    expect(classifyTrendDirection([])).toEqual({ direction: "estable", slope: 0, cv: 0 });
    expect(classifyTrendDirection([50])).toEqual({ direction: "estable", slope: 0, cv: 0 });
  });

  it("serie plana → estable, CV 0", () => {
    const { direction, cv } = classifyTrendDirection([50, 50, 50, 50]);
    expect(direction).toBe("estable");
    expect(cv).toBe(0);
  });

  it("pendiente positiva sostenida y clara → positiva", () => {
    const { direction, slope } = classifyTrendDirection([40, 50, 60, 70, 80]);
    expect(direction).toBe("positiva");
    expect(slope).toBeGreaterThan(0);
  });

  it("pendiente negativa sostenida y clara → negativa", () => {
    const { direction, slope } = classifyTrendDirection([80, 70, 60, 50, 40]);
    expect(direction).toBe("negativa");
    expect(slope).toBeLessThan(0);
  });

  it("variación pequeña relativa a la media → estable (no ruido falso positivo)", () => {
    const { direction } = classifyTrendDirection([100, 101, 100, 102, 101]);
    expect(direction).toBe("estable");
  });

  it("alta dispersión sin tendencia clara → variable", () => {
    const { direction, cv } = classifyTrendDirection([10, 80, 15, 75, 20]);
    expect(direction).toBe("variable");
    expect(cv).toBeGreaterThanOrEqual(35);
  });

  it("un salto puntual al final rompe el patrón anterior → cambio_brusco", () => {
    const { direction } = classifyTrendDirection([50, 51, 49, 50, 150]);
    expect(direction).toBe("cambio_brusco");
  });

  it("cambio_brusco requiere al menos 4 puntos — con menos, nunca se clasifica así", () => {
    expect(classifyTrendDirection([10, 1000]).direction).not.toBe("cambio_brusco");
    expect(classifyTrendDirection([10, 20, 1000]).direction).not.toBe("cambio_brusco");
  });

  it("una tendencia sostenida y perfectamente lineal NO es un falso positivo de cambio_brusco", () => {
    // El último punto está lejos de la media plana de los anteriores, pero
    // exactamente sobre la recta esperada — no debe confundirse con un salto.
    expect(classifyTrendDirection([10, 20, 30, 40, 50]).direction).toBe("positiva");
  });
});
