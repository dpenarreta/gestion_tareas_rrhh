import { describe, expect, it } from "vitest";
import { computeWorkloadPct, computeWorkloadRange } from "@/lib/workload";

// Límites de referencia usados en toda la suite (equivalentes a los valores
// por defecto de src/lib/systemConfig.ts para una jornada de 6.5h):
// base=6.5, limitLow=5.5, limitHigh=7.5, limitOverload=8.5
const BASE = 6.5;
const LOW = 5.5;
const HIGH = 7.5;
const OVERLOAD = 8.5;

describe("computeWorkloadRange", () => {
  it("clasifica como Subutilización por debajo del límite bajo", () => {
    const r = computeWorkloadRange(5, BASE, LOW, HIGH, OVERLOAD);
    expect(r.label).toBe("Subutilización");
    expect(r.color).toBe("red");
  });

  it("clasifica como Moderado entre el límite bajo y la base", () => {
    const r = computeWorkloadRange(6, BASE, LOW, HIGH, OVERLOAD);
    expect(r.label).toBe("Moderado");
    expect(r.color).toBe("yellow");
  });

  it("clasifica como Óptimo justo en la base", () => {
    const r = computeWorkloadRange(BASE, BASE, LOW, HIGH, OVERLOAD);
    expect(r.label).toBe("Óptimo");
    expect(r.color).toBe("green");
  });

  it("clasifica como Óptimo entre la base y el límite alto (inclusive)", () => {
    expect(computeWorkloadRange(7, BASE, LOW, HIGH, OVERLOAD).label).toBe("Óptimo");
    expect(computeWorkloadRange(HIGH, BASE, LOW, HIGH, OVERLOAD).label).toBe("Óptimo");
  });

  it("clasifica como Carga elevada entre el límite alto y el de sobrecarga", () => {
    const r = computeWorkloadRange(8, BASE, LOW, HIGH, OVERLOAD);
    expect(r.label).toBe("Carga elevada");
    expect(r.color).toBe("orange");
  });

  it("clasifica como Carga elevada justo en el límite de sobrecarga (inclusive)", () => {
    expect(computeWorkloadRange(OVERLOAD, BASE, LOW, HIGH, OVERLOAD).label).toBe("Carga elevada");
  });

  it("clasifica como Sobrecarga por encima del límite de sobrecarga", () => {
    const r = computeWorkloadRange(9, BASE, LOW, HIGH, OVERLOAD);
    expect(r.label).toBe("Sobrecarga");
    expect(r.color).toBe("red");
  });

  it("sin base laboral (baseHours <= 0) y sin horas reales es Óptimo", () => {
    const r = computeWorkloadRange(0, 0, 0, 0, 0);
    expect(r.label).toBe("Óptimo");
    expect(r.color).toBe("green");
  });

  it("sin base laboral (baseHours <= 0) pero con horas reales es Carga elevada", () => {
    const r = computeWorkloadRange(2, 0, 0, 0, 0);
    expect(r.label).toBe("Carga elevada");
    expect(r.color).toBe("orange");
  });
});

describe("computeWorkloadPct", () => {
  it("sube linealmente hacia 100% mientras las horas reales no alcanzan la base", () => {
    expect(computeWorkloadPct(0, BASE, HIGH)).toBe(0);
    expect(computeWorkloadPct(3.25, BASE, HIGH)).toBe(50);
  });

  it("es exactamente 100% al llegar a la base", () => {
    expect(computeWorkloadPct(BASE, BASE, HIGH)).toBe(100);
  });

  it("se mantiene en 100% dentro de toda la zona óptima (hasta el límite alto)", () => {
    expect(computeWorkloadPct(7, BASE, HIGH)).toBe(100);
    expect(computeWorkloadPct(HIGH, BASE, HIGH)).toBe(100);
  });

  it("sube gradualmente (no de golpe) al superar el límite óptimo superior", () => {
    // 7.5 es 100%; un poco más allá debe subir de forma proporcional y suave
    const justOver = computeWorkloadPct(HIGH + 0.1, BASE, HIGH);
    expect(justOver).toBeGreaterThan(100);
    expect(justOver).toBeLessThan(105);

    const wayOver = computeWorkloadPct(HIGH * 2, BASE, HIGH);
    expect(wayOver).toBe(200);
  });

  it("devuelve 0 cuando no hay base laboral", () => {
    expect(computeWorkloadPct(5, 0, HIGH)).toBe(0);
  });

  it("no supera 100% si optimalMax es 0 pero ya se superó la base", () => {
    expect(computeWorkloadPct(BASE + 1, BASE, 0)).toBe(100);
  });
});
