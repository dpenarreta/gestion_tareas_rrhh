"use client";

import { useEffect, useState } from "react";
import { Spinner } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { Users } from "lucide-react";
import { NivelBadge } from "./badges";
import type { TeamSubutilizationMember } from "./types";

/** Bloque 5 — Predicción de Subutilización, vista de equipo. */
export default function TeamSubutilizationScan() {
  const [members, setMembers] = useState<TeamSubutilizationMember[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/predictive/team-subutilization")
      .then((r) => (r.ok ? r.json() : { members: [] }))
      .then((json) => {
        if (!cancelled) setMembers(json.members ?? []);
      })
      .catch(() => {
        if (!cancelled) setMembers([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <Spinner className="w-5 h-5 text-primary" />
      </div>
    );
  }
  if (!members || members.length === 0) {
    return <EmptyState icon={Users} title="Sin colaboradores para evaluar" />;
  }

  return (
    <div className="rounded-[14px] border border-border bg-surface shadow-[var(--shadow)] p-4">
      <p className="text-xs font-semibold text-secondary uppercase tracking-wide mb-2">Predicción de Subutilización — equipo</p>
      <div className="divide-y divide-border">
        {members.map((m) => (
          <div key={m.userId} className="py-2 flex items-center justify-between gap-3">
            <p className="text-sm text-title">{m.name}</p>
            {m.prediction ? (
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-disabled">{m.prediction.confidencePct}% confianza</span>
                <NivelBadge nivel={m.prediction.nivel} />
              </div>
            ) : (
              <span className="text-[11px] text-disabled italic">Sin datos</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
