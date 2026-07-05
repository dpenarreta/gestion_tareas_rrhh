"use client";

import type { Idea } from "./types";
import { IMPACT_LABELS, IMPACT_STYLES, STATUS_INFO } from "./constants";

type Props = {
  ideas: Idea[];
  onCardClick: (idea: Idea) => void;
};

export default function MyIdeasList({ ideas, onCardClick }: Props) {
  if (ideas.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-disabled text-sm rounded-2xl border border-border bg-surface">
        Todavía no has propuesto ninguna idea.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2.5">
      {ideas.map((idea) => {
        const info = STATUS_INFO[idea.status];
        return (
          <button
            key={idea.id}
            onClick={() => onCardClick(idea)}
            className="w-full text-left bg-surface rounded-2xl border border-border p-4 hover:border-primary/40 hover:bg-primary-surface/30 transition-colors"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-title truncate">{idea.title}</p>
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${IMPACT_STYLES[idea.impact]}`}>
                    {IMPACT_LABELS[idea.impact]}
                  </span>
                </div>
                {idea.status === "RECHAZADA" && idea.latestRejectionComment && (
                  <p className="text-xs text-danger mt-2">Motivo: {idea.latestRejectionComment}</p>
                )}
              </div>
              <span className={`shrink-0 inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full ${info.headerBg} ${info.headerText}`}>
                {info.emoji} {info.label}
              </span>
            </div>
          </button>
        );
      })}
    </div>
  );
}
