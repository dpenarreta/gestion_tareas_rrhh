// Bloque 5 (Sprint Reportes Ejecutivos 2.0) — cada indicador de equipo
// responde las 4 preguntas: qué significa / por qué / impacto / acción.
// Plantilla reusable; el texto lo arma src/lib/reportInsights.ts (reglas
// fijas sobre el valor ya calculado, sin IA).
import type { IndicatorExplanation } from "../types";

export function IndicatorInterpretation({ title, value, explanation }: { title: string; value: string; explanation: IndicatorExplanation }) {
  return (
    <div className="bg-background rounded-xl border border-border p-4">
      <div className="flex items-baseline justify-between mb-2">
        <p className="text-xs font-semibold text-title">{title}</p>
        <p className="text-lg font-bold text-primary">{value}</p>
      </div>
      <dl className="space-y-1.5 text-[11px]">
        <div>
          <dt className="text-disabled uppercase tracking-wider font-medium">¿Qué significa?</dt>
          <dd className="text-secondary">{explanation.meaning}</dd>
        </div>
        <div>
          <dt className="text-disabled uppercase tracking-wider font-medium">¿Por qué este resultado?</dt>
          <dd className="text-secondary">{explanation.why}</dd>
        </div>
        <div>
          <dt className="text-disabled uppercase tracking-wider font-medium">¿Qué impacto tiene?</dt>
          <dd className="text-secondary">{explanation.impact}</dd>
        </div>
        <div>
          <dt className="text-disabled uppercase tracking-wider font-medium">¿Qué acción recomienda?</dt>
          <dd className="text-secondary">{explanation.action}</dd>
        </div>
      </dl>
    </div>
  );
}
