import { describe, expect, it } from "vitest";
import { AUTO_SCROLL_MAX, AUTO_SCROLL_ZONE, autoScrollStep, clampToBox, dragTargets } from "@/lib/dragFill";

// Cálculo del desplazamiento automático del arrastre tipo Excel (Horas extras
// y Días laborados), ver docs/CHANGELOG.md § v1.181.0.

const box = { left: 0, top: 100, right: 600, bottom: 400 };

describe("autoScrollStep", () => {
  it("no desplaza con el puntero lejos de los bordes", () => {
    expect(autoScrollStep({ x: 300, y: 250 }, box)).toEqual({ dx: 0, dy: 0 });
  });

  it("baja cerca del borde inferior y sube cerca del superior", () => {
    expect(autoScrollStep({ x: 300, y: 395 }, box).dy).toBeGreaterThan(0);
    expect(autoScrollStep({ x: 300, y: 105 }, box).dy).toBeLessThan(0);
  });

  it("desplaza en horizontal cerca de los bordes izquierdo y derecho", () => {
    expect(autoScrollStep({ x: 595, y: 250 }, box).dx).toBeGreaterThan(0);
    expect(autoScrollStep({ x: 5, y: 250 }, box).dx).toBeLessThan(0);
  });

  it("es progresivo: más rápido cuanto más cerca del borde, con tope", () => {
    const entering = autoScrollStep({ x: 300, y: 400 - AUTO_SCROLL_ZONE + 2 }, box).dy;
    const middle = autoScrollStep({ x: 300, y: 400 - AUTO_SCROLL_ZONE / 2 }, box).dy;
    const edge = autoScrollStep({ x: 300, y: 399 }, box).dy;
    expect(entering).toBeGreaterThanOrEqual(1);
    expect(entering).toBeLessThan(middle);
    expect(middle).toBeLessThan(edge);
    expect(edge).toBeLessThanOrEqual(AUTO_SCROLL_MAX);
  });

  it("sigue a velocidad máxima con el puntero fuera del contenedor", () => {
    expect(autoScrollStep({ x: 300, y: 900 }, box).dy).toBe(AUTO_SCROLL_MAX);
    expect(autoScrollStep({ x: 300, y: -50 }, box).dy).toBe(-AUTO_SCROLL_MAX);
  });

  it("en contenedores chicos la zona no tapa el centro", () => {
    const small = { left: 0, top: 0, right: 90, bottom: 90 };
    expect(autoScrollStep({ x: 45, y: 45 }, small)).toEqual({ dx: 0, dy: 0 });
  });
});

describe("clampToBox", () => {
  it("lleva el puntero de fuera al borde interior del contenedor", () => {
    expect(clampToBox({ x: 300, y: 900 }, box)).toEqual({ x: 300, y: 398 });
    expect(clampToBox({ x: -20, y: 10 }, box)).toEqual({ x: 2, y: 102 });
    expect(clampToBox({ x: 300, y: 250 }, box)).toEqual({ x: 300, y: 250 });
  });
});

describe("dragTargets", () => {
  it("devuelve las filas del rango sin la de origen, hacia abajo y hacia arriba", () => {
    expect(dragTargets(2, 5)).toEqual([3, 4, 5]);
    expect(dragTargets(5, 2)).toEqual([2, 3, 4]);
    expect(dragTargets(4, 4)).toEqual([]);
  });
});
