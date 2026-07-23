"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ProjectDetail, ProjectStatus } from "./types";
import { PROJECT_STATUS_LABEL } from "./types";

const STATUS_OPTIONS: ProjectStatus[] = [
  "PENDIENTE",
  "PLANIFICACION",
  "EN_EJECUCION",
  "EN_REVISION",
  "SUSPENDIDO",
  "COMPLETADO",
  "CANCELADO",
];

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("es-CO", { day: "2-digit", month: "long", year: "numeric" });
}

type Props = {
  project: ProjectDetail;
  canManage: boolean;
  onUpdated: (project: ProjectDetail) => void;
};

export default function ProjectSummaryTab({ project, canManage, onUpdated }: Props) {
  const router = useRouter();
  const [editingObservations, setEditingObservations] = useState(false);
  const [observations, setObservations] = useState(project.observations ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [trashing, setTrashing] = useState(false);

  async function moveToTrash() {
    if (trashing) return;
    if (!window.confirm(`¿Mover "${project.name}" a la papelera? Podrás restaurarlo dentro del período de retención.`)) return;
    setTrashing(true);
    setError("");
    try {
      const res = await fetch(`/api/projects/${project.id}`, { method: "DELETE" });
      if (res.ok) {
        router.push("/projects");
      } else {
        const d = await res.json().catch(() => ({}));
        setError(d.error ?? "Error al mover a la papelera");
        setTrashing(false);
      }
    } catch {
      setError("Error al mover a la papelera");
      setTrashing(false);
    }
  }

  const pct = project.targetTimeHours > 0 ? Math.min(100, Math.round((project.realHours / project.targetTimeHours) * 100)) : 0;

  async function patch(data: Record<string, unknown>) {
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/projects/${project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (res.ok) {
        const updated = await res.json();
        onUpdated(updated);
      } else {
        const d = await res.json().catch(() => ({}));
        setError(d.error ?? "Error al actualizar el proyecto");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div className="lg:col-span-2 space-y-4">
        <div className="bg-surface border border-border rounded-2xl p-4">
          <h3 className="text-sm font-semibold text-title mb-3">Detalle</h3>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-xs text-disabled uppercase tracking-wide">Área</dt>
              <dd className="text-title font-medium">{project.area || "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-disabled uppercase tracking-wide">Creado por</dt>
              <dd className="text-title font-medium">{project.createdBy.name}</dd>
            </div>
            <div>
              <dt className="text-xs text-disabled uppercase tracking-wide">Fecha inicio</dt>
              <dd className="text-title font-medium">{formatDate(project.startDate)}</dd>
            </div>
            <div>
              <dt className="text-xs text-disabled uppercase tracking-wide">Fecha objetivo</dt>
              <dd className="text-title font-medium">{formatDate(project.targetDate)}</dd>
            </div>
            {project.completedAt && (
              <div>
                <dt className="text-xs text-disabled uppercase tracking-wide">Completado</dt>
                <dd className="text-title font-medium">{formatDate(project.completedAt)}</dd>
              </div>
            )}
          </dl>

          {project.tags.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {project.tags.map((t) => (
                <span key={t} className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-primary-surface text-primary">#{t}</span>
              ))}
            </div>
          )}
        </div>

        <div className="bg-surface border border-border rounded-2xl p-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-title">Observaciones</h3>
            {canManage && !editingObservations && (
              <button onClick={() => setEditingObservations(true)} className="text-xs text-primary hover:text-primary-hover font-medium">
                Editar
              </button>
            )}
          </div>
          {editingObservations ? (
            <div className="space-y-2">
              <textarea
                value={observations}
                onChange={(e) => setObservations(e.target.value)}
                rows={3}
                className="w-full border border-border rounded-xl px-3 py-2 text-sm text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary resize-none"
              />
              <div className="flex gap-2">
                <button
                  onClick={async () => {
                    await patch({ observations });
                    setEditingObservations(false);
                  }}
                  disabled={saving}
                  className="bg-primary text-white rounded-lg px-3 py-1.5 text-xs font-medium hover:bg-primary-hover disabled:opacity-40"
                >
                  Guardar
                </button>
                <button
                  onClick={() => {
                    setObservations(project.observations ?? "");
                    setEditingObservations(false);
                  }}
                  className="text-xs text-secondary hover:text-title px-3 py-1.5"
                >
                  Cancelar
                </button>
              </div>
            </div>
          ) : (
            <p className="text-sm text-secondary whitespace-pre-wrap">{project.observations || "Sin observaciones"}</p>
          )}
        </div>
      </div>

      <div className="space-y-4">
        <div className="bg-surface border border-border rounded-2xl p-4">
          <h3 className="text-sm font-semibold text-title mb-3">Tiempo objetivo</h3>
          <div className="flex items-center justify-between text-sm mb-1.5">
            <span className="text-secondary">Real / Objetivo</span>
            <span className="font-semibold text-title">{project.realHours}h / {project.targetTimeHours}h</span>
          </div>
          <div className="h-2 rounded-full bg-surface2 overflow-hidden">
            <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
          </div>
          <p className="text-xs text-disabled mt-1.5">{pct}% del objetivo global</p>
        </div>

        {canManage && (
          <div className="bg-surface border border-border rounded-2xl p-4">
            <h3 className="text-sm font-semibold text-title mb-3">Estado del proyecto</h3>
            <select
              value={project.status}
              onChange={(e) => patch({ status: e.target.value })}
              disabled={saving}
              className="w-full border border-border rounded-xl px-3 py-2 text-sm text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary"
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>{PROJECT_STATUS_LABEL[s]}</option>
              ))}
            </select>
            <p className="text-[11px] text-disabled mt-2 leading-relaxed">
              El proyecto permanece activo entre meses — solo Completado/Cancelado detiene la acumulación de horas.
            </p>
          </div>
        )}

        {canManage && (
          <div className="bg-surface border border-danger/30 rounded-2xl p-4">
            <h3 className="text-sm font-semibold text-danger mb-2">Zona de peligro</h3>
            <p className="text-[11px] text-secondary mb-3 leading-relaxed">
              Mueve el proyecto a la papelera. Podrás restaurarlo dentro del período de retención configurado.
            </p>
            <button
              onClick={moveToTrash}
              disabled={trashing}
              className="w-full border border-danger text-danger rounded-xl py-2 text-sm font-medium hover:bg-danger/[.08] disabled:opacity-40 transition-colors"
            >
              {trashing ? "Moviendo…" : "Mover a la papelera"}
            </button>
          </div>
        )}

        {error && <p className="text-xs text-danger bg-danger/[.09] rounded-lg px-3 py-2">{error}</p>}
      </div>
    </div>
  );
}
