/**
 * NormalizationEngine (§Sprint 5 S5-D) — servicio central único de
 * normalización para el motor de Analytics. Toda métrica que deba
 * convertirse en un puntaje 0-100 pasa por aquí; ningún componente ni ruta
 * de API debe reimplementar su propia tabla de puntos de corte.
 *
 * Usa interpolación lineal por tramos (piecewise-linear) entre puntos de
 * control configurables — es la opción más simple de las recomendadas
 * (interpolación lineal / spline / logística) que YA elimina por
 * construcción los saltos abruptos (89%→85, 90%→95): el resultado varía de
 * forma continua y proporcional entre cada punto de control, y se puede
 * mantener equivalente a las reglas actuales calibrando esos puntos, y a la
 * vez habilita la curva "campana" de carga (§S5-F) simplemente definiendo un
 * punto de control por cada una de las 7 zonas (Subutilización extrema →
 * ... → Óptimo → ... → Sobrecarga extrema) — sin necesidad de una spline
 * cúbica ni de una librería nueva.
 */

export type CurvePoint = { x: number; y: number };

export type CurveName = "cumplimiento" | "vencidas" | "carga" | "capacidad" | "consistencia" | "trazabilidad";

/**
 * Puntos de control por defecto — calibrados para reproducir el resultado
 * de las fórmulas actuales en los casos representativos (ver
 * src/__tests__/normalizationEngine.test.ts), de modo que activar el motor
 * de normalización no cambie ningún número ya validado (§S5-E "mantener
 * valores por defecto equivalentes a las reglas actuales").
 */
export const DEFAULT_CURVES: Record<CurveName, CurvePoint[]> = {
  // Identidad: el % de cumplimiento ya es 0-100, sin transformación (igual que hoy).
  cumplimiento: [
    { x: 0, y: 0 },
    { x: 100, y: 100 },
  ],
  // x = conteo ponderado de tareas vencidas (normal=1, prioridad Alta=2) —
  // reproduce 100 - 10×normal - 20×alta de la fórmula legacy en su tramo lineal.
  vencidas: [
    { x: 0, y: 100 },
    { x: 10, y: 0 },
  ],
  // x = % de horas reales sobre la base (100% = óptimo). Curva tipo campana:
  // el máximo ocurre en el rango óptimo configurado y la penalización crece
  // gradualmente hacia ambos extremos (§S5-F). Zonas: Subutilización extrema
  // → Subutilización → Moderado → Óptimo (máximo) → Carga elevada →
  // Sobrecarga → Sobrecarga extrema.
  carga: [
    { x: 0, y: 15 },
    { x: 50, y: 35 },
    { x: 85, y: 75 },
    { x: 100, y: 100 },
    { x: 115, y: 75 },
    { x: 130, y: 40 },
    { x: 160, y: 10 },
  ],
  // x = % de capacidad disponible proyectada. Rampa continua que preserva el
  // orden de magnitud de los 4 estados actuales (alta/limitada/no-asignar/sobrecarga).
  capacidad: [
    { x: -50, y: 0 },
    { x: 0, y: 20 },
    { x: 10, y: 40 },
    { x: 20, y: 70 },
    { x: 40, y: 100 },
    { x: 100, y: 100 },
  ],
  // x = consistencyPct (ya continuo desde Sprint 1 S1-B, 100/(1+CV)) — identidad.
  consistencia: [
    { x: 0, y: 0 },
    { x: 100, y: 100 },
  ],
  // x = índice compuesto de trazabilidad (ya escalado 0-100) — identidad.
  trazabilidad: [
    { x: 0, y: 0 },
    { x: 100, y: 100 },
  ],
};

/** Interpolación lineal por tramos, clamada en los extremos — pura, sin efectos secundarios. */
export function interpolateCurve(x: number, points: CurvePoint[]): number {
  if (points.length === 0) return 0;
  const sorted = [...points].sort((a, b) => a.x - b.x);
  if (!Number.isFinite(x)) return sorted[0].y;
  if (x <= sorted[0].x) return sorted[0].y;
  if (x >= sorted[sorted.length - 1].x) return sorted[sorted.length - 1].y;
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    if (x >= a.x && x <= b.x) {
      if (b.x === a.x) return a.y;
      const t = (x - a.x) / (b.x - a.x);
      return a.y + t * (b.y - a.y);
    }
  }
  return sorted[sorted.length - 1].y;
}

/** Normaliza `rawValue` a un puntaje 0-100 según la curva `curveName`, usando `points` (o el default si no se pasan). Resultado siempre acotado a [0,100] y redondeado a 1 decimal. */
export function normalize(curveName: CurveName, rawValue: number, points?: CurvePoint[]): number {
  const curve = points && points.length >= 2 ? points : DEFAULT_CURVES[curveName];
  const y = interpolateCurve(rawValue, curve);
  const clamped = Math.max(0, Math.min(100, y));
  return Math.round(clamped * 10) / 10;
}

/** Valida que un set de puntos de control sea usable (≥2 puntos, x/y finitos, y en [0,100]) — usado al guardar configuración desde Ajustes. */
export function isValidCurve(points: unknown): points is CurvePoint[] {
  if (!Array.isArray(points) || points.length < 2) return false;
  return points.every(
    (p) =>
      p && typeof p === "object" &&
      typeof (p as CurvePoint).x === "number" && Number.isFinite((p as CurvePoint).x) &&
      typeof (p as CurvePoint).y === "number" && Number.isFinite((p as CurvePoint).y) &&
      (p as CurvePoint).y >= 0 && (p as CurvePoint).y <= 100
  );
}
