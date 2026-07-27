import "server-only";
import { getEffectivePredictionWindowWeeks } from "@/lib/systemConfig";

export const PREDICTION_WINDOW_OPTIONS = ["3", "4", "6", "8", "12"] as const;
export type PredictionWindowOption = (typeof PREDICTION_WINDOW_OPTIONS)[number];

export function isValidPredictionWindow(value: string): value is PredictionWindowOption {
  return (PREDICTION_WINDOW_OPTIONS as readonly string[]).includes(value);
}

export { getEffectivePredictionWindowWeeks };

/** Ventana efectiva como número de semanas (parseada, nunca NaN — cae al default si el valor guardado es inválido). */
export async function getEffectivePredictionWindowWeeksNumber(asOf: Date = new Date()): Promise<number> {
  const raw = await getEffectivePredictionWindowWeeks(asOf);
  const parsed = Number(raw);
  return isValidPredictionWindow(raw) && Number.isFinite(parsed) ? parsed : 3;
}
