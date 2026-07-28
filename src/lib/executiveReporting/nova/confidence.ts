// Nivel de confianza interno de NOVA (FPS Parte III) — determinista, sin
// Groq. No es visible necesariamente en el documento; gobierna cuánto puede
// profundizar/extrapolar el texto generado (instruido en los prompts).
import type { ExecutiveReportContext } from "../context";
import type { NovaConfidence } from "./types";

export function computeNovaConfidence(context: ExecutiveReportContext): NovaConfidence {
  const { dataQualityPct } = context.resumen;
  const { collaboratorCount } = context.meta;

  if (collaboratorCount === 0) return "Baja";
  if (dataQualityPct >= 90 && collaboratorCount >= 5) return "Muy Alta";
  if (dataQualityPct >= 75 && collaboratorCount >= 3) return "Alta";
  if (dataQualityPct >= 50) return "Media";
  return "Baja";
}
