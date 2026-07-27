"use client";

import { useEffect, useState } from "react";
import { Spinner } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { FolderKanban } from "lucide-react";
import { NivelBadge } from "./badges";
import type { DelayPrediction } from "./types";

type ProjectListItem = { id: string; name: string; status: string };
type ProjectRow = { id: string; name: string; prediction: DelayPrediction };

const CLOSED_STATUSES = new Set(["COMPLETADO", "CANCELADO"]);
// Acotado para no disparar demasiadas llamadas en paralelo desde el cliente
// cuando hay muchos proyectos activos visibles.
const MAX_PROJECTS = 12;

/** Bloque 6 — Predicción de Retrasos, nivel proyecto. Reutiliza GET /api/projects (ya existente, sin modificar) solo para listar proyectos visibles. */
export default function ProjectDelayList() {
  const [rows, setRows] = useState<ProjectRow[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch("/api/projects");
        const projects: ProjectListItem[] = res.ok ? await res.json() : [];
        const active = projects.filter((p) => !CLOSED_STATUSES.has(p.status)).slice(0, MAX_PROJECTS);
        const predictions = await Promise.all(
          active.map(async (p) => {
            const r = await fetch(`/api/predictive/project-delay/${p.id}`);
            const prediction: DelayPrediction = r.ok ? await r.json() : { available: false, reason: "No disponible" };
            return { id: p.id, name: p.name, prediction };
          })
        );
        if (!cancelled) setRows(predictions);
      } catch {
        if (!cancelled) setRows([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
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
  if (!rows || rows.length === 0) {
    return <EmptyState icon={FolderKanban} title="Sin proyectos activos para evaluar" />;
  }

  return (
    <div className="rounded-[14px] border border-border bg-surface shadow-[var(--shadow)] p-4">
      <p className="text-xs font-semibold text-secondary uppercase tracking-wide mb-2">Predicción de Retrasos — proyectos</p>
      <div className="divide-y divide-border">
        {rows.map((row) => (
          <div key={row.id} className="py-2 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm text-title truncate">{row.name}</p>
              {row.prediction.available && row.prediction.motivos.length > 0 && (
                <p className="text-[11px] text-secondary mt-0.5">Motivos: {row.prediction.motivos.join(", ")}</p>
              )}
            </div>
            {row.prediction.available ? (
              <div className="text-right shrink-0">
                <NivelBadge nivel={row.prediction.nivel} />
                <p className="text-[11px] text-disabled mt-0.5">{row.prediction.probabilidadPct}%</p>
              </div>
            ) : (
              <span className="text-[11px] text-disabled italic shrink-0">{row.prediction.reason}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
