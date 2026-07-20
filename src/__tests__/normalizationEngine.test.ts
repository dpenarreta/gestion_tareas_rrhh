import { describe, expect, it } from "vitest";
import { interpolateCurve, normalize, isValidCurve, DEFAULT_CURVES } from "@/lib/normalizationEngine";

describe("interpolateCurve (motor de normalización — Sprint 5 S5-D)", () => {
  const points = [
    { x: 0, y: 0 },
    { x: 50, y: 80 },
    { x: 100, y: 100 },
  ];

  it("caso normal: interpola linealmente entre dos puntos de control", () => {
    expect(interpolateCurve(25, points)).toBe(40); // punto medio entre (0,0) y (50,80)
  });

  it("caso límite: exactamente en un punto de control devuelve su y sin interpolar", () => {
    expect(interpolateCurve(50, points)).toBe(80);
  });

  it("caso sin datos: array vacío no lanza, devuelve 0", () => {
    expect(interpolateCurve(50, [])).toBe(0);
  });

  it("caso extremo: x fuera de rango se clama al extremo más cercano (sin extrapolar)", () => {
    expect(interpolateCurve(-100, points)).toBe(0);
    expect(interpolateCurve(1000, points)).toBe(100);
  });

  it("nunca produce saltos abruptos: valores de x cercanos producen y cercanos (continuidad)", () => {
    const y1 = interpolateCurve(89, points);
    const y2 = interpolateCurve(90, points);
    expect(Math.abs(y2 - y1)).toBeLessThan(1);
  });

  it("es determinista sin importar el orden de los puntos de control", () => {
    const shuffled = [points[2], points[0], points[1]];
    expect(interpolateCurve(25, shuffled)).toBe(interpolateCurve(25, points));
  });
});

describe("normalize (acotado 0-100, defaults calibrados)", () => {
  it("cumplimiento: identidad (default equivalente a la fórmula actual, que usa el % directo)", () => {
    expect(normalize("cumplimiento", 73)).toBe(73);
    expect(normalize("cumplimiento", 0)).toBe(0);
    expect(normalize("cumplimiento", 100)).toBe(100);
  });

  it("vencidas: reproduce 100 - 10×normal - 20×alta de la fórmula legacy en su tramo lineal", () => {
    // 1 tarea vencida normal → weightedCount=1 → 100-10=90 (igual que overdueScore legacy).
    expect(normalize("vencidas", 1)).toBe(90);
    // 1 tarea vencida de prioridad Alta → weightedCount=2 → 100-20=80.
    expect(normalize("vencidas", 2)).toBe(80);
  });

  it("vencidas: caso extremo, muchas tareas vencidas nunca da negativo (clamado a 0)", () => {
    expect(normalize("vencidas", 500)).toBe(0);
  });

  it("carga: el máximo (100) ocurre en el 100% de la base (rango óptimo)", () => {
    expect(normalize("carga", 100)).toBe(100);
  });

  it("carga: caso límite, penaliza gradualmente hacia ambos extremos (subutilización y sobrecarga)", () => {
    const bajo = normalize("carga", 50);
    const alto = normalize("carga", 150);
    expect(bajo).toBeLessThan(100);
    expect(alto).toBeLessThan(100);
  });

  it("carga: caso extremo (0% o muy por encima de sobrecarga) nunca es NaN ni negativo", () => {
    expect(Number.isFinite(normalize("carga", 0))).toBe(true);
    expect(normalize("carga", 0)).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(normalize("carga", 1000))).toBe(true);
    expect(normalize("carga", 1000)).toBeGreaterThanOrEqual(0);
  });

  it("capacidad: capacidad alta (>=40% disponible) → 100, igual orden de magnitud que el estado 'alta' legacy", () => {
    expect(normalize("capacidad", 50)).toBe(100);
  });

  it("capacidad: sin datos (0% disponible) → puntaje intermedio bajo, no 0 salvo sobrecarga real", () => {
    const score = normalize("capacidad", 0);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(100);
  });

  it("capacidad: caso extremo, sobrecarga severa → tiende a 0 sin ser negativo", () => {
    expect(normalize("capacidad", -1000)).toBe(0);
  });

  it("consistencia: identidad (recibe consistencyPct ya continuo desde Sprint 1 S1-B)", () => {
    expect(normalize("consistencia", 87)).toBe(87);
  });

  it("trazabilidad: identidad sobre el índice compuesto 0-100", () => {
    expect(normalize("trazabilidad", 60)).toBe(60);
  });

  it("todas las curvas por defecto: cualquier entrada produce un resultado acotado [0,100] y finito", () => {
    const names = Object.keys(DEFAULT_CURVES) as Array<keyof typeof DEFAULT_CURVES>;
    for (const name of names) {
      for (const raw of [-99999, -1, 0, 1, 50, 99, 100, 101, 99999]) {
        const score = normalize(name, raw);
        expect(Number.isFinite(score)).toBe(true);
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(100);
      }
    }
  });

  it("acepta curvas personalizadas en vez del default", () => {
    const custom = [
      { x: 0, y: 100 },
      { x: 100, y: 0 },
    ];
    expect(normalize("cumplimiento", 0, custom)).toBe(100);
    expect(normalize("cumplimiento", 100, custom)).toBe(0);
  });

  it("ignora curvas personalizadas inválidas (menos de 2 puntos) y usa el default", () => {
    expect(normalize("cumplimiento", 50, [{ x: 0, y: 100 }])).toBe(50);
  });
});

describe("isValidCurve", () => {
  it("caso normal: acepta un array de ≥2 puntos con x/y finitos y y en [0,100]", () => {
    expect(isValidCurve([{ x: 0, y: 0 }, { x: 100, y: 100 }])).toBe(true);
  });

  it("caso límite: rechaza un solo punto", () => {
    expect(isValidCurve([{ x: 0, y: 0 }])).toBe(false);
  });

  it("caso sin datos: rechaza array vacío, null, undefined", () => {
    expect(isValidCurve([])).toBe(false);
    expect(isValidCurve(null)).toBe(false);
    expect(isValidCurve(undefined)).toBe(false);
  });

  it("caso extremo: rechaza y fuera de [0,100] o valores no numéricos", () => {
    expect(isValidCurve([{ x: 0, y: -1 }, { x: 100, y: 100 }])).toBe(false);
    expect(isValidCurve([{ x: 0, y: 0 }, { x: 100, y: 101 }])).toBe(false);
    expect(isValidCurve([{ x: 0, y: "a" }, { x: 100, y: 100 }])).toBe(false);
  });
});
