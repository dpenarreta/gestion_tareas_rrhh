// Bloque 10 (Sprint Reportes Ejecutivos 2.0) — observaciones automáticas
// tipo "X concentró el N% del tiempo ejecutado" (computeTeamInsights,
// src/lib/reportInsights.ts) — reglas fijas, no IA.
import { Sparkles } from "lucide-react";

export function TeamInsightsSection({ insights }: { insights: string[] }) {
  if (insights.length === 0) return null;
  return (
    <div className="bg-surface rounded-2xl border border-border p-5">
      <h3 className="text-sm font-semibold text-main uppercase tracking-wider mb-4">Insights</h3>
      <ul className="space-y-2">
        {insights.map((text, i) => (
          <li key={i} className="flex items-start gap-2.5">
            <Sparkles className="w-4 h-4 text-primary shrink-0 mt-0.5" />
            <span className="text-sm text-title leading-relaxed">{text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
