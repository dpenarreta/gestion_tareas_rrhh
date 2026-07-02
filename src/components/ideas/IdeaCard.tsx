"use client";

import type { Idea } from "./types";
import { AREA_LABELS, IMPACT_LABELS, IMPACT_STYLES } from "./constants";

type Props = {
  idea: Idea;
  currentUserId: string;
  onClick: (idea: Idea) => void;
};

export default function IdeaCard({ idea, currentUserId, onClick }: Props) {
  const isMine = idea.author.id === currentUserId;

  return (
    <button
      onClick={() => onClick(idea)}
      className="w-full text-left bg-white rounded-xl border border-slate-200 p-3 shadow-sm hover:shadow-md transition-all"
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <p className="text-sm font-medium text-slate-900 leading-snug line-clamp-2 flex-1">{idea.title}</p>
        {isMine && (
          <span className="shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700">
            Mi idea
          </span>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5 mb-2">
        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${IMPACT_STYLES[idea.impact]}`}>
          {IMPACT_LABELS[idea.impact]}
        </span>
        <span className="text-[10px] text-slate-500 bg-slate-50 px-1.5 py-0.5 rounded border border-slate-200">
          {AREA_LABELS[idea.area]}
        </span>
      </div>
      <p className="text-[10px] text-slate-400">{idea.author.name}</p>
    </button>
  );
}
