"use client";

import { useMemo, useState } from "react";
import type { Role } from "@/generated/prisma/client";
import { ROLE_LEVEL } from "@/lib/roles";
import type { Idea, IdeaArea, IdeaImpact } from "./types";
import { AREA_LABELS, IMPACT_LABELS, STATUS_INFO, BOARD_COLUMNS } from "./constants";
import IdeaCard from "./IdeaCard";

type Props = {
  ideas: Idea[];
  currentUserId: string;
  currentUserRole: Role;
  onCardClick: (idea: Idea) => void;
};

export default function IdeasBoard({ ideas, currentUserId, currentUserRole, onCardClick }: Props) {
  const [areaFilter, setAreaFilter] = useState<IdeaArea | "">("");
  const [impactFilter, setImpactFilter] = useState<IdeaImpact | "">("");
  const [authorFilter, setAuthorFilter] = useState<string>("");
  const [hideRejected, setHideRejected] = useState(false);

  const canFilterByAuthor = ROLE_LEVEL[currentUserRole] >= 2;

  const authors = useMemo(() => {
    const map = new Map<string, string>();
    for (const i of ideas) map.set(i.author.id, i.author.name);
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [ideas]);

  const filtered = useMemo(() => {
    return ideas.filter((i) => {
      if (areaFilter && i.area !== areaFilter) return false;
      if (impactFilter && i.impact !== impactFilter) return false;
      if (canFilterByAuthor && authorFilter && i.author.id !== authorFilter) return false;
      return true;
    });
  }, [ideas, areaFilter, impactFilter, authorFilter, canFilterByAuthor]);

  const columns = hideRejected ? BOARD_COLUMNS.filter((c) => c !== "RECHAZADA") : BOARD_COLUMNS;

  const byStatus = useMemo(() => {
    const map = new Map<string, Idea[]>();
    for (const col of BOARD_COLUMNS) map.set(col, []);
    for (const i of filtered) map.get(i.status)?.push(i);
    return map;
  }, [filtered]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={areaFilter}
          onChange={(e) => setAreaFilter(e.target.value as IdeaArea | "")}
          className="text-sm border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white text-slate-700"
        >
          <option value="">Todas las áreas</option>
          {Object.entries(AREA_LABELS).map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>
        <select
          value={impactFilter}
          onChange={(e) => setImpactFilter(e.target.value as IdeaImpact | "")}
          className="text-sm border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white text-slate-700"
        >
          <option value="">Todo impacto</option>
          {Object.entries(IMPACT_LABELS).map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>
        {canFilterByAuthor && (
          <select
            value={authorFilter}
            onChange={(e) => setAuthorFilter(e.target.value)}
            className="text-sm border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white text-slate-700"
          >
            <option value="">Todos los autores</option>
            {authors.map(([id, name]) => (
              <option key={id} value={id}>{name}</option>
            ))}
          </select>
        )}
        <label className="flex items-center gap-1.5 text-sm text-slate-600 ml-auto">
          <input
            type="checkbox"
            checked={hideRejected}
            onChange={(e) => setHideRejected(e.target.checked)}
            className="rounded"
          />
          Ocultar rechazadas
        </label>
      </div>

      <div className="grid gap-4 overflow-x-auto" style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(220px, 1fr))` }}>
        {columns.map((status) => {
          const info = STATUS_INFO[status];
          const colIdeas = byStatus.get(status) ?? [];
          return (
            <div key={status} className={`flex flex-col rounded-2xl border-2 ${info.border} bg-slate-50 min-h-[300px]`}>
              <div className="p-3 border-b border-slate-200 flex items-center gap-2">
                <span>{info.emoji}</span>
                <span className={`text-sm font-semibold ${info.headerText}`}>{info.label}</span>
                <span className="text-xs text-slate-400 bg-white border border-slate-200 px-1.5 py-0.5 rounded-full ml-auto">
                  {colIdeas.length}
                </span>
              </div>
              <div className="flex-1 p-3 space-y-2 overflow-y-auto">
                {colIdeas.map((idea) => (
                  <IdeaCard key={idea.id} idea={idea} currentUserId={currentUserId} onClick={onCardClick} />
                ))}
                {colIdeas.length === 0 && (
                  <div className="text-center text-xs text-slate-400 py-6">Sin ideas</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
