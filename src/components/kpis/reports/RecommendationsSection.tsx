// Bloque 3 (Sprint Reportes Ejecutivos 2.0) — "No utilizar IA. Utilizar
// reglas del motor" — cada recomendación viene de una regla fija en
// src/lib/reportInsights.ts, condicionada a datos ya calculados.
import { Target } from "lucide-react";
import type { Recommendation } from "../types";

const PRIORITY_LABEL: Record<Recommendation["priority"], string> = {
  alta: "Prioridad alta",
  media: "Prioridad media",
};
const PRIORITY_BADGE: Record<Recommendation["priority"], string> = {
  alta: "bg-danger/[.13] text-danger",
  media: "bg-warning/[.15] text-warning",
};

export function RecommendationsSection({ recommendations }: { recommendations: Recommendation[] }) {
  if (recommendations.length === 0) return null;
  return (
    <div className="bg-surface rounded-2xl border border-border p-5">
      <h3 className="text-sm font-semibold text-main uppercase tracking-wider mb-4">Acciones Sugeridas</h3>
      <div className="space-y-2">
        {recommendations.map((r, i) => (
          <div key={i} className="flex items-start gap-3 px-4 py-3 rounded-xl bg-background">
            <Target className="w-4 h-4 text-primary shrink-0 mt-0.5" />
            <div className="flex-1">
              <span className={`inline-block text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full mb-1 ${PRIORITY_BADGE[r.priority]}`}>
                {PRIORITY_LABEL[r.priority]}
              </span>
              <p className="text-sm text-title leading-relaxed">{r.text}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
