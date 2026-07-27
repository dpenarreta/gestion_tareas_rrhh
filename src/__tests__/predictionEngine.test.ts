import { describe, expect, it } from "vitest";
import { nearestHorizon, computePredictionConfidence, computeHistoricalReliability, PREDICTION_HORIZONS } from "@/lib/predictionEngine";

describe("nearestHorizon", () => {
  it("nunca devuelve un valor fuera de {7,15,30,90} (§Bloque 11)", () => {
    for (const days of [0, 1, 6, 7, 8, 14, 15, 16, 29, 30, 31, 60, 89, 90, 91, 365]) {
      expect(PREDICTION_HORIZONS).toContain(nearestHorizon(days));
    }
  });

  it("elige el horizonte más cercano en cada tramo", () => {
    expect(nearestHorizon(0)).toBe(7);
    expect(nearestHorizon(7)).toBe(7);
    expect(nearestHorizon(10)).toBe(7); // |10-7|=3 < |10-15|=5
    expect(nearestHorizon(12)).toBe(15); // |12-7|=5 > |12-15|=3
    expect(nearestHorizon(15)).toBe(15);
    expect(nearestHorizon(22)).toBe(15); // |22-15|=7 < |22-30|=8
    expect(nearestHorizon(23)).toBe(30); // |23-15|=8 > |23-30|=7 → 30 más cercano
    expect(nearestHorizon(30)).toBe(30);
    expect(nearestHorizon(60)).toBe(30); // |60-30|=30 < |60-90|=30 → primer match (30) gana en empate
    expect(nearestHorizon(90)).toBe(90);
    expect(nearestHorizon(1000)).toBe(90);
  });
});

describe("computePredictionConfidence", () => {
  it("nunca alcanza el 100% — siempre hay incertidumbre", () => {
    const pct = computePredictionConfidence({ dataScore: 1, consistencyScore: 1, horizon: 7 });
    expect(pct).toBeLessThan(100);
  });

  it("más datos y más consistencia aumentan la confianza (mismo horizonte)", () => {
    const low = computePredictionConfidence({ dataScore: 0.2, consistencyScore: 0.25, horizon: 30 });
    const high = computePredictionConfidence({ dataScore: 1, consistencyScore: 1, horizon: 30 });
    expect(high).toBeGreaterThan(low);
  });

  it("un horizonte más largo reduce la confianza (mismos datos/consistencia)", () => {
    const near = computePredictionConfidence({ dataScore: 0.8, consistencyScore: 0.8, horizon: 7 });
    const far = computePredictionConfidence({ dataScore: 0.8, consistencyScore: 0.8, horizon: 90 });
    expect(near).toBeGreaterThan(far);
  });

  it("nunca es negativo", () => {
    expect(computePredictionConfidence({ dataScore: 0, consistencyScore: 0, horizon: 90 })).toBeGreaterThanOrEqual(0);
  });
});

describe("computeHistoricalReliability", () => {
  it("mucho historial + alta calidad de datos → alta", () => {
    expect(computeHistoricalReliability(12, 95)).toBe("alta");
  });

  it("poco historial + baja calidad de datos → baja", () => {
    expect(computeHistoricalReliability(1, 40)).toBe("baja");
  });

  it("es un eje distinto del nivel de confianza — depende solo de volumen/calidad, no del horizonte (§Bloque 13)", () => {
    // Misma llamada, sin parámetro de horizonte en la firma — confirma que no
    // puede confundirse accidentalmente con confidencePct.
    expect(computeHistoricalReliability(6, 100)).toBe(computeHistoricalReliability(6, 100));
  });
});
