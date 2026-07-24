"use client";

import { useState } from "react";
import type { ProjectListItem, ProjectPriority, ProjectStatus, ProjectUserRef } from "./types";
import { PROJECT_STATUS_LABEL, PROJECT_PRIORITY_LABEL } from "./types";
import { Modal, ModalHeader } from "@/components/ui/Modal";

type Props = {
  currentUserId: string;
  candidateUsers: ProjectUserRef[];
  onClose: () => void;
  onCreated: (project: ProjectListItem) => void;
};

const STATUS_OPTIONS: ProjectStatus[] = ["PENDIENTE", "PLANIFICACION", "EN_EJECUCION"];
const PRIORITY_OPTIONS: ProjectPriority[] = ["ALTA", "MEDIA", "BAJA"];

export default function CreateProjectModal({ currentUserId, candidateUsers, onClose, onCreated }: Props) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [responsibleId, setResponsibleId] = useState(currentUserId);
  const [participantIds, setParticipantIds] = useState<string[]>([]);
  const [startDate, setStartDate] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const [status, setStatus] = useState<ProjectStatus>("PENDIENTE");
  const [priority, setPriority] = useState<ProjectPriority>("MEDIA");
  const [targetTimeHours, setTargetTimeHours] = useState("");
  const [tagsInput, setTagsInput] = useState("");
  const [area, setArea] = useState("");
  const [observations, setObservations] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const responsibleOptions = [{ id: currentUserId, name: "Yo mismo" }, ...candidateUsers.filter((u) => u.id !== currentUserId)];

  function toggleParticipant(id: string) {
    setParticipantIds((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]));
  }

  async function submit() {
    if (submitting) return;
    if (!name.trim() || !responsibleId || !startDate || !targetDate || !targetTimeHours) {
      setError("Completa los campos requeridos");
      return;
    }
    const hours = parseFloat(targetTimeHours);
    if (Number.isNaN(hours) || hours <= 0) {
      setError("El tiempo objetivo global debe ser un número mayor a 0");
      return;
    }
    setError("");
    setSubmitting(true);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || null,
          responsibleId,
          participantIds,
          startDate,
          targetDate,
          status,
          priority,
          targetTimeHours: hours,
          tags: tagsInput.split(",").map((t) => t.trim()).filter(Boolean),
          area: area.trim() || null,
          observations: observations.trim() || null,
        }),
      });
      if (res.ok) {
        const created = await res.json();
        onCreated(created);
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Error al crear el proyecto");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open onClose={onClose} size="md">
      <ModalHeader title="Nuevo proyecto" onClose={onClose} />

          <div className="p-4 space-y-3">
            <div>
              <label className="block text-[10px] font-semibold text-secondary mb-1 uppercase tracking-wide">Nombre</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Nombre del proyecto"
                className="w-full border border-border rounded-xl px-3 py-2 text-sm text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary"
              />
            </div>

            <div>
              <label className="block text-[10px] font-semibold text-secondary mb-1 uppercase tracking-wide">
                Descripción <span className="normal-case font-normal">(opcional)</span>
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                className="w-full border border-border rounded-xl px-3 py-2 text-sm text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary resize-none"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[10px] font-semibold text-secondary mb-1 uppercase tracking-wide">Responsable principal</label>
                <select
                  value={responsibleId}
                  onChange={(e) => setResponsibleId(e.target.value)}
                  className="w-full border border-border rounded-xl px-3 py-2 text-sm text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary"
                >
                  {responsibleOptions.map((u) => (
                    <option key={u.id} value={u.id}>{u.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-secondary mb-1 uppercase tracking-wide">Área</label>
                <input
                  type="text"
                  value={area}
                  onChange={(e) => setArea(e.target.value)}
                  placeholder="Ej. Selección"
                  className="w-full border border-border rounded-xl px-3 py-2 text-sm text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary"
                />
              </div>
            </div>

            <div>
              <label className="block text-[10px] font-semibold text-secondary mb-1 uppercase tracking-wide">
                Participantes {participantIds.length > 0 && `(${participantIds.length})`}
              </label>
              <div className="border border-border rounded-xl p-2 max-h-32 overflow-y-auto space-y-1">
                {candidateUsers.length === 0 && (
                  <p className="text-xs text-disabled px-1 py-1">Sin usuarios disponibles</p>
                )}
                {candidateUsers.map((u) => (
                  <label key={u.id} className="flex items-center gap-2 px-1 py-1 rounded-lg hover:bg-surface2 cursor-pointer text-sm text-title">
                    <input
                      type="checkbox"
                      checked={participantIds.includes(u.id)}
                      onChange={() => toggleParticipant(u.id)}
                      className="rounded border-border"
                    />
                    {u.name}
                  </label>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[10px] font-semibold text-secondary mb-1 uppercase tracking-wide">Fecha inicio</label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full border border-border rounded-xl px-3 py-2 text-sm text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary"
                />
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-secondary mb-1 uppercase tracking-wide">Fecha objetivo</label>
                <input
                  type="date"
                  value={targetDate}
                  onChange={(e) => setTargetDate(e.target.value)}
                  className="w-full border border-border rounded-xl px-3 py-2 text-sm text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary"
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="block text-[10px] font-semibold text-secondary mb-1 uppercase tracking-wide">Estado inicial</label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as ProjectStatus)}
                  className="w-full border border-border rounded-xl px-3 py-2 text-sm text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary"
                >
                  {STATUS_OPTIONS.map((s) => (
                    <option key={s} value={s}>{PROJECT_STATUS_LABEL[s]}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-secondary mb-1 uppercase tracking-wide">Prioridad</label>
                <select
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as ProjectPriority)}
                  className="w-full border border-border rounded-xl px-3 py-2 text-sm text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary"
                >
                  {PRIORITY_OPTIONS.map((p) => (
                    <option key={p} value={p}>{PROJECT_PRIORITY_LABEL[p]}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-secondary mb-1 uppercase tracking-wide">Tiempo objetivo (h)</label>
                <input
                  type="number"
                  min={0}
                  value={targetTimeHours}
                  onChange={(e) => setTargetTimeHours(e.target.value)}
                  placeholder="0"
                  className="w-full border border-border rounded-xl px-3 py-2 text-sm text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary"
                />
              </div>
            </div>

            <div>
              <label className="block text-[10px] font-semibold text-secondary mb-1 uppercase tracking-wide">
                Etiquetas <span className="normal-case font-normal">(separadas por coma)</span>
              </label>
              <input
                type="text"
                value={tagsInput}
                onChange={(e) => setTagsInput(e.target.value)}
                placeholder="ej. sierra, kits, logística"
                className="w-full border border-border rounded-xl px-3 py-2 text-sm text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary"
              />
            </div>

            <div>
              <label className="block text-[10px] font-semibold text-secondary mb-1 uppercase tracking-wide">
                Observaciones <span className="normal-case font-normal">(opcional)</span>
              </label>
              <textarea
                value={observations}
                onChange={(e) => setObservations(e.target.value)}
                rows={2}
                className="w-full border border-border rounded-xl px-3 py-2 text-sm text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary resize-none"
              />
            </div>

            {error && <p className="text-xs text-danger bg-danger/[.09] rounded-lg px-3 py-2">{error}</p>}

            <button
              onClick={submit}
              disabled={submitting}
              className="w-full bg-primary text-white rounded-xl py-2 text-sm font-medium hover:bg-primary-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {submitting ? "Creando…" : "Crear proyecto"}
            </button>
          </div>
    </Modal>
  );
}
