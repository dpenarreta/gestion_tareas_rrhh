"use client";

import { useState } from "react";
import type { ProjectPhase, ProjectPhaseStatus, ProjectUserRef } from "./types";
import { PHASE_STATUS_LABEL } from "./types";

const STATUS_OPTIONS: ProjectPhaseStatus[] = ["PENDIENTE", "EN_PROGRESO", "COMPLETADA"];

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
        <div className="space-y-2">
          {phases.map((phase, i) => (
            <div key={phase.id} className="bg-surface border border-border rounded-2xl p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="w-6 h-6 rounded-full bg-primary-surface text-primary text-xs font-bold flex items-center justify-center shrink-0">
                    {i + 1}
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-title">{phase.name}</p>
                    {phase.responsible && <p className="text-xs text-secondary">{phase.responsible.name}</p>}
                  </div>
                </div>
                {canManage ? (
                  <select
                    value={phase.status}
                    onChange={(e) => updatePhase(phase.id, { status: e.target.value })}
                    className="text-xs border border-border rounded-lg px-2 py-1 bg-surface text-title"
                  >
                    {STATUS_OPTIONS.map((s) => (
                      <option key={s} value={s}>{PHASE_STATUS_LABEL[s]}</option>
                    ))}
                  </select>
                ) : (
                  <span className="text-[10px] font-bold uppercase px-2 py-1 rounded-full bg-surface2 text-secondary">
                    {PHASE_STATUS_LABEL[phase.status]}
                  </span>
                )}
              </div>

              <div className="mt-3">
                <div className="flex items-center justify-between text-[11px] text-secondary mb-1">
                  <span>Progreso</span>
                  <span className="font-semibold text-title">{phase.progress}%</span>
                </div>
                {canManage ? (
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={phase.progress}
                    onChange={(e) => updatePhase(phase.id, { progress: Number(e.target.value) })}
                    className="w-full accent-[var(--color-primary)]"
                  />
                ) : (
                  <div className="h-1.5 rounded-full bg-surface2 overflow-hidden">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${phase.progress}%` }} />
                  </div>
                )}
              </div>

              {phase.notes && <p className="text-xs text-secondary mt-2">{phase.notes}</p>}

              <div className="flex items-center justify-between mt-2 text-[11px] text-disabled">
                <span>
                  {phase.targetTimeHours != null ? `Objetivo: ${phase.targetTimeHours}h` : ""}
                </span>
                {canManage && (
                  <button onClick={() => deletePhase(phase.id)} className="text-danger hover:underline">
                    Eliminar fase
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
