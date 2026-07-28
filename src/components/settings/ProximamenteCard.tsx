import { Clock } from "lucide-react";

/**
 * Placeholder estándar para funcionalidad fuera de alcance de este sprint —
 * evita UI muerta/editable-pero-sin-efecto: solo comunica qué falta y por qué,
 * con referencia al sprint futuro correspondiente (ver docs/ROADMAP.md).
 */
export default function ProximamenteCard({
  title,
  reason,
  futureSprintLabel,
}: {
  title: string;
  reason: string;
  futureSprintLabel?: string;
}) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-surface2/50 p-5 flex gap-3">
      <Clock className="w-5 h-5 text-disabled shrink-0 mt-0.5" strokeWidth={1.8} />
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <h3 className="font-semibold text-title">{title}</h3>
          <span className="text-[10px] font-medium text-secondary bg-surface border border-border px-2 py-0.5 rounded-full">
            Próximamente
          </span>
        </div>
        <p className="text-sm text-secondary">{reason}</p>
        {futureSprintLabel && (
          <p className="text-xs text-disabled">Planificado para: {futureSprintLabel} — ver docs/ROADMAP.md.</p>
        )}
      </div>
    </div>
  );
}
