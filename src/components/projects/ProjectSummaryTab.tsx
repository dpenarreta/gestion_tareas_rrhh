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

function formatRelative(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Ahora mismo";
  if (mins < 60) return `hace ${mins} min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `hace ${hrs} h`;
  const days = Math.floor(hrs / 24);
  return `hace ${days} d`;
}

function KpiCard({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="bg-surface border border-border rounded-2xl p-4">
      <p className="text-[11px] font-semibold text-disabled uppercase tracking-wide">{label}</p>
      <p className="text-lg font-bold text-title mt-1 truncate">{value}</p>
      {sub && <p className="text-xs text-secondary mt-0.5">{sub}</p>}
    </div>
  );
}

type Props = {
  project: ProjectDetail;
  canManage: boolean;
  canDelete: boolean;
  onUpdated: (project: ProjectDetail) => void;
};

export default function ProjectSummaryTab({ project, canManage, canDelete, onUpdated }: Props) {
  const router = useRouter();
  const [editingObservations, setEditingObservations] = useState(false);
  const [observations, setObservations] = useState(project.observations ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [trashing, setTrashing] = useState(false);

  const pct = project.targetTimeHours > 0 ? Math.min(100, Math.round((project.realHours / project.targetTimeHours) * 100)) : 0;

  // Sprint 2.1 §10: "Avance" del proyecto — promedio de progreso de fases si
  // existen, o el % de tiempo ejecutado como respaldo. Puramente derivado en
  // el cliente, sin tocar el Analytics Engine (compatible con la futura
  // integración del Sprint 3, que leerá estos mismos campos más adelante).
  const advancePct = project.phases.length > 0
    ? Math.round(project.phases.reduce((sum, p) => sum + p.progress, 0) / project.phases.length)
    : pct;

  const nextDeadline = (() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const candidates = [project.targetDate, ...project.phases.map((p) => p.targetDate).filter((d): d is string => !!d)]
      .map((d) => new Date(d))
      .filter((d) => d.getTime() >= today.getTime())
      .sort((a, b) => a.getTime() - b.getTime());
    return candidates[0] ?? null;
  })();

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

  return (
    <div className="space-y-4">
      {/* Sprint 2.1 §10: dashboard ejecutivo con tarjetas KPI. */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard label="Estado" value={PROJECT_STATUS_LABEL[project.status]} />
        <KpiCard label="Avance" value={`${advancePct}%`} sub={project.phases.length > 0 ? "Promedio de fases" : "Por tiempo ejecutado"} />
        <KpiCard label="Participantes" value={project.participants.length} />
        <KpiCard label="Tiempo objetivo" value={`${project.targetTimeHours}h`} />
        <KpiCard label="Tiempo registrado" value={`${project.realHours}h`} sub={`${pct}% del objetivo`} />
        <KpiCard label="Fases" value={project.phases.length} />
        <KpiCard
          label="Última actividad"
          value={project.lastActivity ? formatRelative(project.lastActivity.createdAt) : "Sin actividad"}
          sub={project.lastActivity ? project.lastActivity.authorName : undefined}
        />
        <KpiCard label="Próximo vencimiento" value={nextDeadline ? formatDate(nextDeadline.toISOString()) : "Sin fecha próxima"} />
      </div>

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

          {canDelete && (
            <div className="bg-surface border border-danger/30 rounded-2xl p-4">
              <h3 className="text-sm font-semibold text-danger mb-2">Zona de peligro</h3>
              <p className="text-[11px] text-secondary mb-3 leading-relaxed">
                Mueve el proyecto a la papelera. Podrás restaurarlo dentro del período de retención configurado. Solo el creador del proyecto puede realizar esta acción.
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
    </div>
  );
}
