"use client";

import { useEffect, useState } from "react";
import type { ProjectActivity, ProjectPhase } from "./types";
import { PHASE_STATUS_LABEL } from "./types";
import { formatDuration } from "@/lib/utils";

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("es-CO", { day: "2-digit", month: "short", year: "numeric" });
}

function formatWhen(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("es-CO", { day: "2-digit", month: "short" }) + " " + d.toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" });
}

type Props = {
  projectId: string;
  phase: ProjectPhase;
  onClose: () => void;
};

export default function PhaseDetailModal({ projectId, phase, onClose }: Props) {
  const [activities, setActivities] = useState<ProjectActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  function loadActivities() {
    setLoading(true);
    setError(false);
    fetch(`/api/projects/${projectId}/activities`)
      .then((r) => {
        if (!r.ok) throw new Error();
        return r.json();
      })
      .then((data: ProjectActivity[]) => setActivities(Array.isArray(data) ? data.filter((a) => a.phaseId === phase.id) : []))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }

  useEffect(() => { queueMicrotask(loadActivities); }, [projectId, phase.id]);

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="bg-surface border border-border rounded-2xl shadow-xl w-full max-w-lg max-h-[85vh] overflow-y-auto">
          <div className="p-4 border-b border-border flex items-center justify-between">
            <h3 className="font-semibold text-title text-sm">{phase.name}</h3>
            <button onClick={onClose} className="p-1.5 text-disabled hover:text-main rounded-lg hover:bg-black/5 dark:hover:bg-white/5">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="p-4 space-y-3">
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-xs text-disabled uppercase tracking-wide">Estado</dt>
                <dd className="text-title font-medium">{PHASE_STATUS_LABEL[phase.status]}</dd>
              </div>
              <div>
                <dt className="text-xs text-disabled uppercase tracking-wide">Responsable</dt>
                <dd className="text-title font-medium">{phase.responsible?.name ?? "Sin asignar"}</dd>
              </div>
              <div>
                <dt className="text-xs text-disabled uppercase tracking-wide">Tiempo objetivo</dt>
                <dd className="text-title font-medium">{phase.targetTimeHours != null ? `${phase.targetTimeHours}h` : "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-disabled uppercase tracking-wide">Tiempo registrado</dt>
                <dd className="text-title font-medium">{formatDuration(phase.registeredMinutes)}</dd>
              </div>
              <div>
                <dt className="text-xs text-disabled uppercase tracking-wide">Progreso</dt>
                <dd className="text-title font-medium">{phase.progress}%</dd>
              </div>
              <div>
                <dt className="text-xs text-disabled uppercase tracking-wide">Fecha objetivo</dt>
                <dd className="text-title font-medium">{phase.targetDate ? formatDate(phase.targetDate) : "—"}</dd>
              </div>
            </dl>

            {phase.participants.length > 0 && (
              <div>
                <p className="text-xs text-disabled uppercase tracking-wide mb-1">Participantes</p>
                <div className="flex flex-wrap gap-1.5">
                  {phase.participants.map((p) => (
                    <span key={p.id} className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-surface2 text-secondary">{p.name}</span>
                  ))}
                </div>
              </div>
            )}

            {phase.notes && (
              <div>
                <p className="text-xs text-disabled uppercase tracking-wide mb-1">Comentarios</p>
                <p className="text-sm text-secondary">{phase.notes}</p>
              </div>
            )}

            <div>
              <p className="text-xs text-disabled uppercase tracking-wide mb-2">Actividades de esta fase</p>
              {loading && <p className="text-sm text-disabled">Cargando…</p>}
              {!loading && error && (
                <p className="text-sm text-danger">
                  No se pudieron cargar las actividades.{" "}
                  <button onClick={loadActivities} className="font-medium hover:text-danger/80">Reintentar</button>
                </p>
              )}
              {!loading && !error && activities.length === 0 && <p className="text-sm text-disabled">Sin actividades registradas en esta fase</p>}
              <div className="space-y-2">
                {activities.map((a) => (
                  <div key={a.id} className="bg-background border border-border rounded-xl p-3">
                    <p className="text-sm text-title">{a.description}</p>
                    <p className="text-xs text-secondary mt-0.5">
                      {a.author.name} · {formatWhen(a.createdAt)} · {formatDuration(a.duration)}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
