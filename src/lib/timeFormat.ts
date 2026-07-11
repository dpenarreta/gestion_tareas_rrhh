/**
 * Formato HH.MM para horas en toda la app: el usuario escribe y ve "6.45"
 * queriendo decir 6 horas 45 minutos, no 6.45 horas decimales. Internamente
 * (BD, sumas, cargaRatio, etc.) las horas siguen siendo decimales reales
 * (6.45 display → 6.75 decimal) — esto es puramente de presentación/parseo,
 * no cambia el significado de lo ya almacenado.
 */

export const INVALID_HOURS_MESSAGE =
  "Formato inválido. Usa HH.MM (ej: 6.30 = 6h 30min, 6.45 = 6h 45min)";

const DISPLAY_HOURS_PATTERN = /^\d+(\.\d{2})?$/;

/** Horas decimales reales (6.75) → texto HH.MM para mostrar ("6.45"). */
export function hoursToDisplay(decimalHours: number): string {
  const totalMinutes = Math.max(0, Math.round(decimalHours * 60));
  const wholeHours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${wholeHours}.${String(minutes).padStart(2, "0")}`;
}

/**
 * Texto HH.MM ingresado por el usuario ("6.45") → horas decimales reales
 * (6.75) para guardar. Asume un formato ya válido (ver validateDisplayHours)
 * — con una sola cifra decimal ("6.5") interpreta esa cifra como minutos
 * literales (5 min), no como décimas, por eso siempre hay que validar antes.
 */
export function displayToHours(display: string): number {
  const trimmed = display.trim();
  const [hoursPart, minutesPart = "0"] = trimmed.split(".");
  const hours = parseInt(hoursPart, 10) || 0;
  const minutes = parseInt(minutesPart, 10) || 0;
  return Math.round((hours + minutes / 60) * 1000) / 1000;
}

/** Valida el formato HH.MM: los "minutos" (parte decimal) no pueden superar 59. */
export function validateDisplayHours(display: string): boolean {
  const trimmed = display.trim();
  if (!DISPLAY_HOURS_PATTERN.test(trimmed)) return false;
  const minutesPart = trimmed.split(".")[1];
  if (minutesPart === undefined) return true;
  return parseInt(minutesPart, 10) <= 59;
}
