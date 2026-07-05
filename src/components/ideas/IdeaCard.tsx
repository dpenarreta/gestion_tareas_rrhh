"use client";

import { useState } from "react";
import { ChevronUp } from "lucide-react";
import type { Idea } from "./types";
import { IMPACT_LABELS, IMPACT_STYLES } from "./constants";

type Props = {
  idea: Idea;
  currentUserId: string;
  onClick: (idea: Idea) => void;
  onVoteChange: (id: string, voteCount: number, votedByMe: boolean) => void;
};

export default function IdeaCard({ idea, currentUserId, onClick, onVoteChange }: Props) {
  const isMine = idea.author.id === currentUserId;
  const [voting, setVoting] = useState(false);

  async function handleVote(e: React.MouseEvent) {
    e.stopPropagation();
    if (voting) return;
    setVoting(true);
    try {
      const res = await fetch(`/api/ideas/${idea.id}/vote`, { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        onVoteChange(idea.id, data.voteCount, data.votedByMe);
      }
    } finally {
      setVoting(false);
    }
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onClick(idea)}
      onKeyDown={(e) => {
        if (e.key === "Enter") onClick(idea);
      }}
      className="w-full text-left bg-surface rounded-xl border border-border p-3 shadow-[var(--shadow)] hover:border-border2 transition-all cursor-pointer"
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <p className="text-sm font-medium text-title leading-snug line-clamp-2 flex-1">{idea.title}</p>
        {isMine && (
          <span className="shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-primary-surface text-primary">
            Mi idea
          </span>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5 mb-2">
        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${IMPACT_STYLES[idea.impact]}`}>
          {IMPACT_LABELS[idea.impact]}
        </span>
      </div>

      {idea.status === "EN_DESARROLLO" && (
        <div className="mb-2">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] text-secondary">Progreso</span>
            <span className="text-[10px] font-medium text-main">{idea.progress}%</span>
          </div>
          <div className="h-1.5 bg-black/10 dark:bg-white/10 rounded-full overflow-hidden">
            <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${idea.progress}%` }} />
          </div>
        </div>
      )}

      <div className="flex items-center justify-between">
        <p className="text-[10px] text-disabled">{idea.author.name}</p>
        <button
          onClick={handleVote}
          disabled={voting}
          className={`flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[11px] font-semibold transition-colors disabled:opacity-50 ${
            idea.votedByMe ? "bg-primary-surface text-primary" : "bg-surface2 text-secondary hover:text-primary"
          }`}
          aria-label="Votar por esta idea"
        >
          <ChevronUp className="w-3 h-3" strokeWidth={2.5} />
          {idea.voteCount}
        </button>
      </div>
    </div>
  );
}
