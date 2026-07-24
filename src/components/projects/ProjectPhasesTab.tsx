"use client";

import { useState } from "react";
import type { ProjectPhase, ProjectPhaseStatus, ProjectUserRef } from "./types";
import { PHASE_STATUS_LABEL } from "./types";
import PhaseDetailModal from "./PhaseDetailModal";
import { StatusChip } from "@/components/ui/Chip";
import { TASK_STATUS_CONFIG } from "@/lib/chipConfig";
import { formatDuration } from "@/lib/utils";

const STATUS_OPTIONS: ProjectPhaseStatus[] = ["PENDIENTE", "EN_PROGRESO", "COMPLETADA"];

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("es-CO", { day: "2-digit", month: "short", year: "numeric" });
}

type Props = {
  projectId: string;
  phases: ProjectPhase[];
  canManage: boolean;
  candidateUsers: ProjectUserRef[];
  onPhasesChanged: (phases: ProjectPhase[]) => void;
};

export default function ProjectPhasesTab({ projectId, phases, canManage, candidateUsers, onPhasesChanged }: Props) {
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [responsibleId, setResponsibleId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const [targetTimeHours, setTargetTimeHours] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [detailPhase, setDetailPhase] = useState<ProjectPhase | null>(null);
  // Progreso local mientras se arrastra el slider — solo se envía al soltar,
  // para no disparar un PATCH por cada píxel de arrastre.
  const [dragProgress, setDragProgress] = useState<Record<string, number>>({});

  async function createPhase() {
    if (!name.trim() || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch(`/api/projects/${projectId}/phases`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          responsibleId: responsibleId || undefined,
          startDate: startDate || undefined,
          targetDate: targetDate || undefined,
          targetTimeHours: targetTimeHours ? parseFloat(targetTimeHours) : undefined,
          notes: notes.trim() || undefined,
        }),
      });
      if (res.ok) {
        const created = await res.json();
        onPhasesChanged([...phases, created]);
        setName("");
        setResponsibleId("");
        setStartDate("");
        setTargetDate("");
        setTargetTimeHours("");
        setNotes("");
        setShowForm(false);
      } else {
        const d = await res.json().catch(() => ({}));
        setError(d.error ?? "Error al crear la fase");
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function updatePhase(phaseId: string, data: Record<string, unknown>) {
    const res = await fetch(`/api/projects/${projectId}/phases/${phaseId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (res.ok) {
      const updated = await res.json();
      onPhasesChanged(phases.map((p) => (p.id === phaseId ? updated : p)));
    }
  }

  async function deletePhase(phaseId: string) {
    if (!window.confirm("¿Eliminar esta fase? Esta acción no se puede deshacer.")) return;
    const res = await fetch(`/api/projects/${projectId}/phases/${phaseId}`, { method: "DELETE" });
    if (res.ok) {
      onPhasesChanged(phases.filter((p) => p.id !== phaseId));
    }
  }

  return (
    <div className="space-y-3">
      {canManage && (
        <div className="flex justify-end">
          <button onClick={() => setShowForm((v) => !v)} className="text-sm font-medium text-primary hover:text-primary-hover">
            {showForm ? "Cancelar" : "+ Agregar fase"}
          </button>
        </div>
      )}

      {showForm && (
        <div className="bg-surface border border-border rounded-2xl p-4 space-y-2">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nombre de la fase"
            className="w-full border border-border rounded-xl px-3 py-2 text-sm text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary"
          />
          <div className="grid grid-cols-2 gap-2">
            <select
              value={responsibleId}
              onChange={(e) => setResponsibleId(e.target.value)}
              className="w-full border border-border rounded-xl px-3 py-2 text-sm text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary"
            >
              <option value="">Sin responsable</option>
              {candidateUsers.map((u) => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
            <input
              type="number"
              min={0}
              value={targetTimeHours}
              onChange={(e) => setTargetTimeHours(e.target.value)}
              placeholder="Tiempo objetivo (h)"
              className="w-full border border-border rounded-xl px-3 py-2 text-sm text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full border border-border rounded-xl px-3 py-2 text-sm text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary"
            />
            <input
              type="date"
              value={targetDate}
              onChange={(e) => setTargetDate(e.target.value)}
              className="w-full border border-border rounded-xl px-3 py-2 text-sm text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary"
            />
          </div>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="Comentarios (opcional)"
            className="w-full border border-border rounded-xl px-3 py-2 text-sm text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary resize-none"
          />
          {error && <p className="text-xs text-danger bg-danger/[.09] rounded-lg px-3 py-2">{error}</p>}
          <button
            onClick={createPhase}
            disabled={!name.trim() || submitting}
            className="w-full bg-primary text-white rounded-xl py-2 text-sm font-medium hover:bg-primary-hover disabled:opacity-40"
          >
            {submitting ? "Creando…" : "Crear fase"}
          </button>
        </div>
      )}

      {phases.length === 0 ? (
        <div className="text-center text-disabled text-sm py-12 bg-surface border border-border rounded-2xl">Sin fases definidas</div>
      ) : (
        // Sprint 2.1 §4: tarjetas independientes en grilla, en vez de una lista tipo tabla.
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {phases.map((phase) => {
            const progress = dragProgress[phase.id] ?? phase.progress;
            return (
              <div key={phase.id} className="bg-surface border border-border rounded-2xl p-4 flex flex-col">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <p className="text-sm font-semibold text-title leading-snug">{phase.name}</p>
                  {canManage ? (
                    <select
                      value={phase.status}
                      onChange={(e) => updatePhase(phase.id, { status: e.target.value })}
                      className="text-[11px] border border-border rounded-lg px-1.5 py-1 bg-surface text-title shrink-0"
                    >
                      {STATUS_OPTIONS.map((s) => (
                        <option key={s} value={s}>{PHASE_STATUS_LABEL[s]}</option>
                      ))}
                    </select>
                  ) : (
                    <StatusChip value={phase.status} config={TASK_STATUS_CONFIG} className="shrink-0" />
                  )}
                </div>

                <p className="text-xs text-secondary mb-1">Responsable: {phase.responsible?.name ?? "Sin asignar"}</p>

                {phase.participants.length > 0 && (
                  <div className="flex flex-wrap gap-1 mb-2">
                    {phase.participants.slice(0, 3).map((p) => (
                      <span key={p.id} className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-surface2 text-secondary">{p.name}</span>
                    ))}
                    {phase.participants.length > 3 && (
                      <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-surface2 text-disabled">+{phase.participants.length - 3}</span>
                    )}
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2 text-[11px] text-secondary mb-2">
                  <span>Objetivo: <span className="font-semibold text-title">{phase.targetTimeHours != null ? `${phase.targetTimeHours}h` : "—"}</span></span>
                  <span>Registrado: <span className="font-semibold text-title">{formatDuration(phase.registeredMinutes)}</span></span>
                </div>

                <div className="mb-2">
                  <div className="flex items-center justify-between text-[11px] text-secondary mb-1">
                    <span>Progreso</span>
                    <span className="font-semibold text-title">{progress}%</span>
                  </div>
                  {canManage ? (
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={progress}
                      onChange={(e) => setDragProgress((prev) => ({ ...prev, [phase.id]: Number(e.target.value) }))}
                      onMouseUp={(e) => updatePhase(phase.id, { progress: Number((e.target as HTMLInputElement).value) })}
                      onTouchEnd={(e) => updatePhase(phase.id, { progress: Number((e.target as HTMLInputElement).value) })}
                      onKeyUp={(e) => updatePhase(phase.id, { progress: Number((e.target as HTMLInputElement).value) })}
                      className="w-full accent-[var(--color-primary)]"
                    />
                  ) : (
                    <div className="h-1.5 rounded-full bg-surface2 overflow-hidden">
                      <div className="h-full rounded-full bg-primary" style={{ width: `${progress}%` }} />
                    </div>
                  )}
                </div>

                <p className="text-[11px] text-disabled mb-3">{phase.targetDate ? `Fecha objetivo: ${formatDate(phase.targetDate)}` : "Sin fecha objetivo"}</p>

                <div className="mt-auto flex items-center justify-between gap-2">
                  <button
                    onClick={() => setDetailPhase(phase)}
                    className="text-xs font-medium text-primary hover:text-primary-hover"
                  >
                    Ver detalle
                  </button>
                  {canManage && (
                    <button onClick={() => deletePhase(phase.id)} className="text-[11px] text-danger hover:underline">
                      Eliminar
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {detailPhase && (
        <PhaseDetailModal projectId={projectId} phase={detailPhase} onClose={() => setDetailPhase(null)} />
      )}
    </div>
  );
}
