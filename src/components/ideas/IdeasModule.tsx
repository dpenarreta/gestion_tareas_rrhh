"use client";

import { useState, useCallback } from "react";
import type { Role } from "@/generated/prisma/client";
import type { Idea } from "./types";
import IdeasBoard from "./IdeasBoard";
import MyIdeasList from "./MyIdeasList";
import IdeaDetailModal from "./IdeaDetailModal";
import NewIdeaFormModal from "./NewIdeaFormModal";

type Tab = "TABLERO" | "MIS_IDEAS";

type Props = {
  initialIdeas: Idea[];
  currentUserId: string;
  currentUserRole: Role;
};

export default function IdeasModule({ initialIdeas, currentUserId, currentUserRole }: Props) {
  const [ideas, setIdeas] = useState<Idea[]>(initialIdeas);
  const [tab, setTab] = useState<Tab>("TABLERO");
  const [selectedIdeaId, setSelectedIdeaId] = useState<string | null>(null);
  const [showNewForm, setShowNewForm] = useState(false);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/ideas");
    if (res.ok) setIdeas(await res.json());
  }, []);

  const handleIdeaUpdated = useCallback((updated: Idea) => {
    setIdeas((prev) => prev.map((i) => (i.id === updated.id ? { ...i, ...updated } : i)));
  }, []);

  const handleVoteChange = useCallback((id: string, voteCount: number, votedByMe: boolean) => {
    setIdeas((prev) => prev.map((i) => (i.id === id ? { ...i, voteCount, votedByMe } : i)));
  }, []);

  return (
    <div className="flex flex-col min-h-0">
      <div className="flex items-center justify-between border-b border-border mb-5 pb-0.5">
        <div className="flex gap-0.5">
          {(["TABLERO", "MIS_IDEAS"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2.5 border-b-2 text-sm font-medium transition-colors rounded-t-lg ${
                tab === t
                  ? "border-primary text-primary bg-primary-surface/60"
                  : "border-transparent text-secondary hover:text-title hover:bg-black/5 dark:hover:bg-white/5"
              }`}
            >
              {t === "TABLERO" ? "Tablero" : "Mis ideas"}
            </button>
          ))}
        </div>
        <button
          onClick={() => setShowNewForm(true)}
          className="mb-1.5 flex items-center gap-1.5 px-4 py-2 bg-primary text-white text-sm font-medium rounded-xl hover:bg-primary-hover transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Nueva idea
        </button>
      </div>

      {tab === "TABLERO" && (
        <IdeasBoard
          ideas={ideas}
          currentUserId={currentUserId}
          currentUserRole={currentUserRole}
          onCardClick={(idea) => setSelectedIdeaId(idea.id)}
          onVoteChange={handleVoteChange}
        />
      )}
      {tab === "MIS_IDEAS" && (
        <MyIdeasList
          ideas={ideas.filter((i) => i.author.id === currentUserId)}
          onCardClick={(idea) => setSelectedIdeaId(idea.id)}
        />
      )}

      {selectedIdeaId && (
        <IdeaDetailModal
          ideaId={selectedIdeaId}
          currentUserRole={currentUserRole}
          onClose={() => setSelectedIdeaId(null)}
          onUpdated={handleIdeaUpdated}
        />
      )}

      {showNewForm && (
        <NewIdeaFormModal
          onClose={() => setShowNewForm(false)}
          onCreated={() => { setShowNewForm(false); refresh(); }}
        />
      )}
    </div>
  );
}
