// Bloque 2 (Sprint Reportes Ejecutivos 2.0) — hallazgos generados por
// reglas fijas (src/lib/reportInsights.ts), nunca por IA.
import { CheckCircle2, AlertCircle, Info } from "lucide-react";
import type { Finding } from "../types";

const TONE_ICON: Record<Finding["tone"], typeof CheckCircle2> = {
  positive: CheckCircle2,
  risk: AlertCircle,
  neutral: Info,
};
const TONE_COLOR: Record<Finding["tone"], string> = {
  positive: "text-success",
  risk: "text-danger",
  neutral: "text-secondary",
};

export function FindingsSection({ findings }: { findings: Finding[] }) {
  if (findings.length === 0) return null;
  return (
    <div className="bg-surface rounded-2xl border border-border p-5">
      <h3 className="text-sm font-semibold text-main uppercase tracking-wider mb-4">Hallazgos Principales</h3>
      <ul className="space-y-2.5">
        {findings.map((f, i) => {
          const Icon = TONE_ICON[f.tone];
          return (
            <li key={i} className="flex items-start gap-2.5">
              <Icon className={`w-4 h-4 shrink-0 mt-0.5 ${TONE_COLOR[f.tone]}`} />
              <span className="text-sm text-title leading-relaxed">{f.text}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
